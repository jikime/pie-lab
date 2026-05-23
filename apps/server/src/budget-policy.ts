import {
	queryUsageRecords,
	type BudgetLimitRule,
	type BudgetLimitSettings,
	type BudgetPolicyMode,
	type ProviderConnectionSettings,
	type UsageRecord,
	type UsageStore,
} from "@pie-lab/storage";

export interface BudgetUsageWindow {
	from: string;
	to: string;
	usedUsd: number;
	limitUsd: number | null;
	projectedUsd: number;
	remainingUsd: number | null;
	usedPercentage: number | null;
	exhausted: boolean;
}

export interface BudgetViolation {
	scope: "request" | "daily" | "monthly";
	provider?: string | null;
	limitUsd: number;
	usedUsd: number;
	estimatedUsd: number;
	projectedUsd: number;
	message: string;
}

export interface BudgetStatus {
	mode: BudgetPolicyMode;
	provider: string | null;
	requestLimitUsd: number | null;
	estimatedRequestUsd: number | null;
	daily: BudgetUsageWindow;
	monthly: BudgetUsageWindow;
	violations: BudgetViolation[];
	shouldWarn: boolean;
	shouldBlock: boolean;
	generatedAt: string;
}

export interface EvaluateBudgetInput {
	settings: ProviderConnectionSettings;
	usageStore?: UsageStore;
	provider?: string | null;
	estimatedRequestUsd?: number | null;
	now: Date;
}

export interface EstimateModelRequestCostInput {
	model: {
		cost?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
		};
	};
	inputTokens?: number | null;
	outputTokens?: number | null;
}

const COST_UNITS = 1_000_000;

export async function evaluateBudget(input: EvaluateBudgetInput): Promise<BudgetStatus> {
	const provider = normalizeProvider(input.provider);
	const now = input.now;
	const generatedAt = now.toISOString();
	const rule = resolveBudgetRule(input.settings.budgetLimits, provider);
	const records = await readUsageRecords(input.usageStore);
	const estimate = normalizeUsd(input.estimatedRequestUsd);
	const dailyFrom = startOfUtcDay(now);
	const monthlyFrom = startOfUtcMonth(now);
	const dailyUsed = sumUsageCost(records, { from: dailyFrom, to: now, provider });
	const monthlyUsed = sumUsageCost(records, { from: monthlyFrom, to: now, provider });
	const dailyLimit = normalizeUsd(rule.dailyUsd);
	const monthlyLimit = normalizeUsd(rule.monthlyUsd);
	const requestLimit = normalizeUsd(rule.requestUsd);
	const daily = createBudgetWindow(dailyFrom, now, dailyUsed, dailyLimit, estimate);
	const monthly = createBudgetWindow(monthlyFrom, now, monthlyUsed, monthlyLimit, estimate);
	const violations = collectBudgetViolations({
		provider,
		requestLimit,
		estimate,
		daily,
		monthly,
	});

	return {
		mode: rule.mode ?? "off",
		provider,
		requestLimitUsd: requestLimit,
		estimatedRequestUsd: estimate,
		daily,
		monthly,
		violations,
		shouldWarn: (rule.mode === "warn" || rule.mode === "block") && violations.length > 0,
		shouldBlock: rule.mode === "block" && violations.length > 0,
		generatedAt,
	};
}

export function estimateModelRequestCostUsd(input: EstimateModelRequestCostInput): number | null {
	const inputTokens = normalizeTokenCount(input.inputTokens);
	const outputTokens = normalizeTokenCount(input.outputTokens);
	if (inputTokens === null && outputTokens === null) return null;

	const inputCost = normalizeUsd(input.model.cost?.input) ?? 0;
	const outputCost = normalizeUsd(input.model.cost?.output) ?? 0;
	const total =
		((inputTokens ?? 0) * inputCost) / COST_UNITS +
		((outputTokens ?? 0) * outputCost) / COST_UNITS;
	return Number.isFinite(total) ? roundUsd(total) : null;
}

export function createBudgetLimitErrorBody(options: {
	requestId?: string;
	requestedModel?: string;
	routingMode?: string;
	status: BudgetStatus;
	attempts?: unknown[];
}) {
	return {
		error: {
			message: budgetViolationMessage(options.status),
			type: "budget_limit_exceeded",
			code: "budget_limit_exceeded",
		},
		pi_adk: {
			request_id: options.requestId,
			requested_model: options.requestedModel,
			routing_mode: options.routingMode,
			budget: options.status,
			attempts: options.attempts,
		},
	};
}

export function budgetViolationMessage(status: BudgetStatus): string {
	const first = status.violations[0];
	if (!first) return "Budget policy blocked this request.";
	return first.message;
}

async function readUsageRecords(usageStore: UsageStore | undefined): Promise<UsageRecord[]> {
	if (!usageStore?.getUsageRecords) return [];
	return usageStore.getUsageRecords();
}

function resolveBudgetRule(settings: BudgetLimitSettings | undefined, provider: string | null): Required<BudgetLimitRule> {
	const globalRule = settings ?? {};
	const providerRule = provider ? globalRule.providerLimits?.[provider] : undefined;
	return {
		mode: providerRule?.mode ?? globalRule.mode ?? "off",
		requestUsd: providerRule?.requestUsd ?? globalRule.requestUsd ?? null,
		dailyUsd: providerRule?.dailyUsd ?? globalRule.dailyUsd ?? null,
		monthlyUsd: providerRule?.monthlyUsd ?? globalRule.monthlyUsd ?? null,
	};
}

function collectBudgetViolations(input: {
	provider: string | null;
	requestLimit: number | null;
	estimate: number | null;
	daily: BudgetUsageWindow;
	monthly: BudgetUsageWindow;
}): BudgetViolation[] {
	const violations: BudgetViolation[] = [];

	if (input.requestLimit !== null && input.estimate !== null && input.estimate > input.requestLimit) {
		violations.push({
			scope: "request",
			provider: input.provider,
			limitUsd: input.requestLimit,
			usedUsd: 0,
			estimatedUsd: input.estimate,
			projectedUsd: input.estimate,
			message: `Estimated request cost ${formatUsd(input.estimate)} exceeds request budget ${formatUsd(input.requestLimit)}.`,
		});
	}

	for (const [scope, window] of [
		["daily", input.daily],
		["monthly", input.monthly],
	] as const) {
		if (window.limitUsd === null || !window.exhausted) continue;
		violations.push({
			scope,
			provider: input.provider,
			limitUsd: window.limitUsd,
			usedUsd: window.usedUsd,
			estimatedUsd: input.estimate ?? 0,
			projectedUsd: window.projectedUsd,
			message: `${capitalize(scope)} budget ${formatUsd(window.limitUsd)} would be exceeded (projected ${formatUsd(window.projectedUsd)}).`,
		});
	}

	return violations;
}

function createBudgetWindow(from: Date, to: Date, usedUsd: number, limitUsd: number | null, estimateUsd: number | null): BudgetUsageWindow {
	const projectedUsd = roundUsd(usedUsd + (estimateUsd ?? 0));
	const remainingUsd = limitUsd === null ? null : roundUsd(limitUsd - usedUsd);
	const usedPercentage = limitUsd === null || limitUsd === 0 ? null : Math.max(0, (usedUsd / limitUsd) * 100);
	return {
		from: from.toISOString(),
		to: to.toISOString(),
		usedUsd: roundUsd(usedUsd),
		limitUsd,
		projectedUsd,
		remainingUsd,
		usedPercentage: usedPercentage === null ? null : Math.min(999, Number(usedPercentage.toFixed(2))),
		exhausted: limitUsd !== null && projectedUsd > limitUsd,
	};
}

function sumUsageCost(
	records: readonly UsageRecord[],
	options: { from: Date; to: Date; provider: string | null },
): number {
	const matched = queryUsageRecords(records, {
		from: options.from,
		to: options.to,
		provider: options.provider ?? undefined,
		order: "asc",
	});

	return roundUsd(
		matched.reduce((total, record) => {
			const cost = normalizeUsd(record.cost?.total ?? record.costUsd);
			return total + (cost ?? 0);
		}, 0),
	);
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcMonth(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function normalizeProvider(provider: string | null | undefined): string | null {
	const normalized = provider?.trim();
	return normalized ? normalized : null;
}

function normalizeUsd(value: unknown): number | null {
	if (value === undefined || value === null || value === "") return null;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}

function normalizeTokenCount(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return Math.floor(value);
}

function roundUsd(value: number): number {
	return Number(value.toFixed(8));
}

function formatUsd(value: number): string {
	return `$${value.toFixed(4)}`;
}

function capitalize(value: string): string {
	return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
