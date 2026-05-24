export type RoutingMode = "fixed" | "router" | "fallback";

export * from "./rtk.js";

export type RouterIntent = "coding" | "chat" | "reasoning" | "vision" | "general" | (string & {});

export type RouterBudget = "low" | "medium" | "high";

export type RouterLatency = "low" | "normal";

export type RouteSource = "fixed" | "router" | "fallback";

export type ComboStrategy = "fallback" | "round-robin";

export type ModelSelection =
	| { mode: "fixed"; model: string }
	| { mode: "router"; intent: RouterIntent; constraints?: RouterConstraints; alias?: string }
	| { mode: "fallback"; primary: string; fallback?: string | string[] };

export interface RouterConstraints {
	budget?: RouterBudget;
	latency?: RouterLatency;
	quality?: "low" | "medium" | "high";
	requireTools?: boolean;
	requireVision?: boolean;
	minContextTokens?: number;
	maxCostUsd?: number;
}

export interface ResolvedRoute {
	requestedModel: string;
	routingMode: RoutingMode;
	resolvedProvider: string;
	resolvedModel: string;
	connectionId?: string;
	source?: RouteSource;
	mode: RoutingMode;
}

export interface RouteCandidate {
	provider: string;
	model: string;
	connectionId?: string;
	source?: RouteSource;
}

export interface RouteResolver {
	resolveModel?: (
		model: string,
		selection: Extract<ModelSelection, { mode: "fixed" | "fallback" }>,
	) => RouteCandidate | null | undefined | Promise<RouteCandidate | null | undefined>;
	resolveIntent?: (
		intent: RouterIntent,
		selection: Extract<ModelSelection, { mode: "router" }>,
	) => RouteCandidate | null | undefined | Promise<RouteCandidate | null | undefined>;
}

export interface ResolveRouteOptions {
	requestedModel: string | ModelSelection;
	resolver?: RouteResolver;
}

export const PIE_LAB_ROUTER_PROVIDER = "pie-lab-router";
const LEGACY_ROUTER_PROVIDER = "pie-adk-router";

export const PIE_LAB_ROUTER_MODEL_IDS = [
	"auto:coding",
	"auto:chat",
	"auto:reasoning",
	"auto:learning",
	"auto:memory",
	"cheap:coding",
	"fast:chat",
	"combo:coding",
] as const;

export interface PiModelReference {
	provider: string;
	id: string;
	name?: string;
	input?: string[];
	cost?: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
	};
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
}

export interface PiModelCatalog<TModel extends PiModelReference = PiModelReference> {
	find(provider: string, modelId: string): TModel | undefined;
	getAvailable(): TModel[];
	getAll?(): TModel[];
}

export interface PiRouterCombo {
	name: string;
	models: string[];
	kind?: string | null;
	strategy?: ComboStrategy;
	stickyLimit?: number | string;
}

export type PiRouterCombosData = PiRouterCombo[] | { combos?: PiRouterCombo[] };

export interface PiRouterComboStrategyConfig {
	strategy?: ComboStrategy;
	stickyLimit?: number | string;
}

export interface PiRouterPolicy {
	aliases?: Record<string, string | string[]>;
	intents?: Partial<Record<RouterIntent, string | string[]>>;
	combos?: PiRouterCombosData;
	comboStrategy?: ComboStrategy;
	comboStickyLimit?: number | string;
	comboStrategies?: Record<string, ComboStrategy | PiRouterComboStrategyConfig>;
}

export interface ResolvePiModelRouteOptions<TModel extends PiModelReference = PiModelReference> {
	requestedModel: string | ModelSelection | TModel;
	catalog: PiModelCatalog<TModel>;
	policy?: PiRouterPolicy;
	resolver?: RouteResolver;
}

export interface ResolvedPiModelRoute<TModel extends PiModelReference = PiModelReference> {
	route: ResolvedRoute;
	model: TModel;
}

export interface ResolvedRoutePlan<TRoute = ResolvedRoute> {
	requestedModel: string;
	routingMode: RoutingMode;
	routes: TRoute[];
	primary: TRoute;
}

export type ResolvedPiModelRoutePlan<TModel extends PiModelReference = PiModelReference> = ResolvedRoutePlan<
	ResolvedPiModelRoute<TModel>
>;

const ROUTER_ALIAS_PREFIXES = new Set(["auto", "cheap", "fast", "combo"]);
const DEFAULT_COMBO_ROUTE_LIMIT = 3;
const DEFAULT_COMBO_STICKY_LIMIT = 1;
const AUTO_ROUTING_DEPRECATED_MODEL_IDS = new Set([
	"gemini-2.0-flash",
	"gemini-2.0-flash-001",
	"gemini-2.0-flash-lite",
	"gemini-2.0-flash-lite-001",
]);

const comboRotationState = new Map<string, { index: number; consecutiveUseCount: number }>();

export const ROUTER_BACKOFF_CONFIG = {
	base: 2000,
	max: 5 * 60 * 1000,
	maxLevel: 15,
} as const;

export const ROUTER_TRANSIENT_COOLDOWN_MS = 30 * 1000;
export const ROUTER_MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

const COOLDOWN = {
	long: 2 * 60 * 1000,
	short: 5 * 1000,
} as const;

export interface RouterErrorRule {
	text?: string;
	status?: number;
	cooldownMs?: number;
	backoff?: boolean;
}

export interface RouterFallbackDecision {
	shouldFallback: boolean;
	cooldownMs: number;
	newBackoffLevel?: number;
}

export const ROUTER_ERROR_RULES: RouterErrorRule[] = [
	{ text: "no credentials", cooldownMs: COOLDOWN.long },
	{ text: "request not allowed", cooldownMs: COOLDOWN.short },
	{ text: "improperly formed request", cooldownMs: COOLDOWN.long },
	{ text: "rate limit", backoff: true },
	{ text: "too many requests", backoff: true },
	{ text: "quota exceeded", backoff: true },
	{ text: "out of extra usage", backoff: true },
	{ text: "usage limit", backoff: true },
	{ text: "capacity", backoff: true },
	{ text: "overloaded", backoff: true },
	{ status: 401, cooldownMs: COOLDOWN.long },
	{ status: 402, cooldownMs: COOLDOWN.long },
	{ status: 403, cooldownMs: COOLDOWN.long },
	{ status: 404, cooldownMs: COOLDOWN.long },
	{ status: 429, backoff: true },
];

export const MODEL_LOCK_PREFIX = "modelLock_";
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

export interface RouterAccountState {
	id?: string;
	rateLimitedUntil?: string | null;
	backoffLevel?: number | null;
	lastError?: unknown;
	status?: string;
	[key: string]: unknown;
}

export type AccountSelectionStrategy = "fill-first" | "round-robin" | "quota-aware";
export type QuotaSelectionStrategy = "off" | "prefer-remaining" | "require-remaining";

export const PIE_LAB_QUOTA_SELECTION_KEY = "pieLabQuotaSelection";
const LEGACY_QUOTA_SELECTION_KEY = "pieAdkQuotaSelection";

export interface ProviderQuotaSelectionSnapshot {
	checkedAt?: string;
	status?: "available" | "depleted" | "unknown" | "error";
	score?: number | null;
	remainingPercentage?: number | null;
	resetAt?: string | null;
	message?: string | null;
	[key: string]: unknown;
}

export interface ProviderConnectionReference extends RouterAccountState {
	id: string;
	provider: string;
	isActive?: boolean;
	priority?: number | null;
	lastUsedAt?: string | null;
	consecutiveUseCount?: number | null;
	errorCode?: string | number | null;
	providerSpecificData?: Record<string, unknown> | null;
}

export interface ProviderAccountStrategyConfig {
	fallbackStrategy?: AccountSelectionStrategy;
	stickyRoundRobinLimit?: number | string;
	quotaStrategy?: QuotaSelectionStrategy;
	quotaMinRemainingPercentage?: number | string;
	quotaMaxAgeMs?: number | string;
	quotaRefreshBeforeSelection?: boolean;
	quotaRefreshTtlMs?: number | string;
}

export interface ProviderAccountSelectionSettings {
	fallbackStrategy?: AccountSelectionStrategy;
	stickyRoundRobinLimit?: number | string;
	quotaStrategy?: QuotaSelectionStrategy;
	quotaMinRemainingPercentage?: number | string;
	quotaMaxAgeMs?: number | string;
	quotaRefreshBeforeSelection?: boolean;
	quotaRefreshTtlMs?: number | string;
	providerStrategies?: Record<string, ProviderAccountStrategyConfig>;
}

export interface SelectProviderConnectionOptions<TConnection extends ProviderConnectionReference> {
	provider: string;
	model?: string | null;
	connections: readonly TConnection[];
	settings?: ProviderAccountSelectionSettings;
	excludeConnectionIds?: string | string[] | Set<string> | null;
	preferredConnectionId?: string | null;
	now?: Date;
}

export type ProviderConnectionSelectionResult<TConnection extends ProviderConnectionReference> =
	| { status: "selected"; connection: TConnection; updates?: Record<string, unknown> }
	| {
			status: "unavailable";
			retryAfter: string;
			retryAfterHuman: string;
			lastError?: unknown;
			lastErrorCode?: string | number | null;
	  }
	| { status: "missing" };

export interface ProviderConnectionCandidateExplanation {
	id: string;
	provider: string;
	isActive: boolean;
	priority: number | null;
	selected: boolean;
	selectable: boolean;
	reasons: string[];
	lastUsedAt?: string | null;
	consecutiveUseCount?: number | null;
	modelLockUntil?: string | null;
	quotaSelection?: ProviderQuotaSelectionSnapshot | null;
	quotaFresh?: boolean;
	quotaScore?: number | null;
	remainingPercentage?: number | null;
}

export interface ProviderConnectionSelectionExplanation {
	provider: string;
	model?: string | null;
	status: ProviderConnectionSelectionResult<ProviderConnectionReference>["status"];
	selectedConnectionId?: string;
	strategy: AccountSelectionStrategy;
	quotaStrategy: QuotaSelectionStrategy;
	quotaMaxAgeMs: number;
	quotaMinRemainingPercentage: number;
	candidates: ProviderConnectionCandidateExplanation[];
	message?: string;
}

export class ModelSelectionParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelSelectionParseError";
	}
}

export class RouteResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RouteResolutionError";
	}
}

export function getQuotaCooldown(backoffLevel = 0): number {
	const level = Math.max(0, backoffLevel - 1);
	const cooldown = ROUTER_BACKOFF_CONFIG.base * 2 ** level;
	return Math.min(cooldown, ROUTER_BACKOFF_CONFIG.max);
}

export function checkFallbackError(
	status: number | undefined,
	errorText: unknown,
	backoffLevel = 0,
): RouterFallbackDecision {
	const lowerError = normalizeErrorText(errorText).toLowerCase();

	for (const rule of ROUTER_ERROR_RULES) {
		if (rule.text && lowerError && lowerError.includes(rule.text)) {
			return rule.backoff
				? backoffDecision(backoffLevel)
				: { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0 };
		}

		if (rule.status && rule.status === status) {
			return rule.backoff
				? backoffDecision(backoffLevel)
				: { shouldFallback: true, cooldownMs: rule.cooldownMs ?? 0 };
		}
	}

	return { shouldFallback: true, cooldownMs: ROUTER_TRANSIENT_COOLDOWN_MS };
}

export function extractProviderResetCooldownMs(
	error: unknown,
	now = Date.now(),
	maxCooldownMs = ROUTER_MAX_RATE_LIMIT_COOLDOWN_MS,
): number | null {
	const resetAtMs = extractResetAtMs(error, now);
	if (resetAtMs !== null && resetAtMs > now) {
		return Math.min(resetAtMs - now, maxCooldownMs);
	}

	const resetAfterMs = extractResetAfterMs(error);
	if (resetAfterMs !== null && resetAfterMs > 0) {
		return Math.min(resetAfterMs, maxCooldownMs);
	}

	return null;
}

export function isAccountUnavailable(unavailableUntil?: string | null): boolean {
	if (!unavailableUntil) return false;
	return new Date(unavailableUntil).getTime() > Date.now();
}

export function getUnavailableUntil(cooldownMs: number): string {
	return new Date(Date.now() + cooldownMs).toISOString();
}

export function getEarliestRateLimitedUntil(accounts: readonly RouterAccountState[]): string | null {
	let earliest: number | null = null;
	const now = Date.now();

	for (const account of accounts) {
		if (!account.rateLimitedUntil) continue;
		const until = new Date(account.rateLimitedUntil).getTime();
		if (until <= now) continue;
		if (earliest === null || until < earliest) earliest = until;
	}

	return earliest === null ? null : new Date(earliest).toISOString();
}

export function formatRetryAfter(rateLimitedUntil?: string | null): string {
	if (!rateLimitedUntil) return "";

	const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
	if (diffMs <= 0) return "reset after 0s";

	const totalSeconds = Math.ceil(diffMs / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	const parts: string[] = [];

	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

	return `reset after ${parts.join(" ")}`;
}

export function getModelLockKey(model?: string | null): string {
	return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

export function isModelLockActive(connection: RouterAccountState, model?: string | null): boolean {
	const key = getModelLockKey(model);
	const expiry = connection[key] ?? connection[MODEL_LOCK_ALL];
	return typeof expiry === "string" && new Date(expiry).getTime() > Date.now();
}

export function getEarliestModelLockUntil(connection: RouterAccountState | undefined): string | null {
	if (!connection) return null;

	let earliest: number | null = null;
	const now = Date.now();

	for (const [key, value] of Object.entries(connection)) {
		if (!key.startsWith(MODEL_LOCK_PREFIX) || typeof value !== "string") continue;
		const time = new Date(value).getTime();
		if (time <= now) continue;
		if (earliest === null || time < earliest) earliest = time;
	}

	return earliest === null ? null : new Date(earliest).toISOString();
}

export function buildModelLockUpdate(model: string | null | undefined, cooldownMs: number): Record<string, string> {
	return { [getModelLockKey(model)]: new Date(Date.now() + cooldownMs).toISOString() };
}

export function buildClearModelLocksUpdate(connection: RouterAccountState): Record<string, null> {
	const cleared: Record<string, null> = {};
	for (const key of Object.keys(connection)) {
		if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
	}
	return cleared;
}

export function filterAvailableAccounts<TAccount extends RouterAccountState>(
	accounts: readonly TAccount[],
	excludeId: string | null = null,
): TAccount[] {
	const now = Date.now();
	return accounts.filter((account) => {
		if (excludeId && account.id === excludeId) return false;
		if (!account.rateLimitedUntil) return true;
		return new Date(account.rateLimitedUntil).getTime() <= now;
	});
}

export function selectProviderConnection<TConnection extends ProviderConnectionReference>(
	options: SelectProviderConnectionOptions<TConnection>,
): ProviderConnectionSelectionResult<TConnection> {
	const providerConnections = sortProviderConnections(
		options.connections.filter(
			(connection) => connection.provider === options.provider && connection.isActive !== false,
		),
	);
	const excludeSet = normalizeConnectionIdSet(options.excludeConnectionIds);

	if (providerConnections.length === 0) {
		return { status: "missing" };
	}

	const unlockedConnections = providerConnections.filter((connection) => {
		if (excludeSet.has(connection.id)) return false;
		if (isModelLockActive(connection, options.model)) return false;
		return true;
	});

	if (unlockedConnections.length === 0) {
		const lockedConnections = providerConnections.filter((connection) =>
			isModelLockActive(connection, options.model),
		);
		const expiries = lockedConnections
			.map((connection) => getEarliestModelLockUntil(connection))
			.filter((expiry): expiry is string => Boolean(expiry))
			.sort();
		const retryAfter = expiries[0];

		if (retryAfter) {
			const lockedConnection = lockedConnections[0];
			return {
				status: "unavailable",
				retryAfter,
				retryAfterHuman: formatRetryAfter(retryAfter),
				lastError: lockedConnection?.lastError,
				lastErrorCode: lockedConnection?.errorCode,
			};
		}

		return { status: "missing" };
	}

	const providerOverride = options.settings?.providerStrategies?.[options.provider] ?? {};
	const strategy = providerOverride.fallbackStrategy ?? options.settings?.fallbackStrategy ?? "fill-first";
	const quotaStrategy = normalizeQuotaStrategy(
		providerOverride.quotaStrategy ??
			options.settings?.quotaStrategy ??
			(strategy === "quota-aware" ? "prefer-remaining" : "off"),
	);
	const quotaMaxAgeMs = normalizeDurationMs(
		providerOverride.quotaMaxAgeMs ?? options.settings?.quotaMaxAgeMs,
		5 * 60 * 1000,
	);
	const quotaMinRemainingPercentage = normalizePercentage(
		providerOverride.quotaMinRemainingPercentage ?? options.settings?.quotaMinRemainingPercentage,
		0,
	);
	const availableConnections = applyQuotaSelectionFilter(unlockedConnections, {
		model: options.model,
		now: options.now ?? new Date(),
		quotaStrategy,
		quotaMaxAgeMs,
		quotaMinRemainingPercentage,
	});

	if (availableConnections.length === 0) {
		return { status: "missing" };
	}

	const pinnedConnection = options.preferredConnectionId
		? availableConnections.find((connection) => connection.id === options.preferredConnectionId)
		: undefined;
	if (pinnedConnection) {
		return { status: "selected", connection: pinnedConnection };
	}

	const quotaRankedConnections =
		quotaStrategy === "off"
			? availableConnections
			: sortProviderConnectionsByQuota(availableConnections, {
					model: options.model,
					now: options.now ?? new Date(),
					quotaMaxAgeMs,
				});

	if (strategy !== "round-robin") {
		return { status: "selected", connection: quotaRankedConnections[0] };
	}

	const stickyLimit = normalizeAccountStickyLimit(
		providerOverride.stickyRoundRobinLimit ?? options.settings?.stickyRoundRobinLimit ?? 3,
	);
	const nowIso = (options.now ?? new Date()).toISOString();
	const byRecency = [...availableConnections].sort(sortByMostRecentUseThenPriority);
	const current = byRecency[0];
	const currentCount = typeof current?.consecutiveUseCount === "number" ? current.consecutiveUseCount : 0;

	if (current?.lastUsedAt && currentCount < stickyLimit) {
		return {
			status: "selected",
			connection: current,
			updates: {
				lastUsedAt: nowIso,
				consecutiveUseCount: currentCount + 1,
			},
		};
	}

	const connection = [...availableConnections].sort(sortByOldestUseThenPriority)[0];
	return {
		status: "selected",
		connection,
		updates: {
			lastUsedAt: nowIso,
			consecutiveUseCount: 1,
		},
	};
}

export function explainProviderConnectionSelection<TConnection extends ProviderConnectionReference>(
	options: SelectProviderConnectionOptions<TConnection>,
): ProviderConnectionSelectionExplanation {
	const providerConnections = sortProviderConnections(
		options.connections.filter((connection) => connection.provider === options.provider),
	);
	const providerOverride = options.settings?.providerStrategies?.[options.provider] ?? {};
	const strategy = providerOverride.fallbackStrategy ?? options.settings?.fallbackStrategy ?? "fill-first";
	const quotaStrategy = normalizeQuotaStrategy(
		providerOverride.quotaStrategy ??
			options.settings?.quotaStrategy ??
			(strategy === "quota-aware" ? "prefer-remaining" : "off"),
	);
	const quotaMaxAgeMs = normalizeDurationMs(
		providerOverride.quotaMaxAgeMs ?? options.settings?.quotaMaxAgeMs,
		5 * 60 * 1000,
	);
	const quotaMinRemainingPercentage = normalizePercentage(
		providerOverride.quotaMinRemainingPercentage ?? options.settings?.quotaMinRemainingPercentage,
		0,
	);
	const selection = selectProviderConnection(options);
	const selectedConnectionId = selection.status === "selected" ? selection.connection.id : undefined;
	const excludeSet = normalizeConnectionIdSet(options.excludeConnectionIds);
	const now = options.now ?? new Date();
	const candidates = providerConnections.map((connection) =>
		explainProviderConnectionCandidate(connection, {
			model: options.model,
			now,
			excludeSet,
			selectedConnectionId,
			quotaStrategy,
			quotaMaxAgeMs,
			quotaMinRemainingPercentage,
			preferredConnectionId: options.preferredConnectionId,
		}),
	);

	return {
		provider: options.provider,
		model: options.model,
		status: selection.status,
		selectedConnectionId,
		strategy,
		quotaStrategy,
		quotaMaxAgeMs,
		quotaMinRemainingPercentage,
		candidates,
		message: selection.status === "unavailable" ? selection.retryAfterHuman : undefined,
	};
}

export function resetAccountState<TAccount extends RouterAccountState>(account: TAccount): TAccount {
	return {
		...account,
		rateLimitedUntil: null,
		backoffLevel: 0,
		lastError: null,
		status: "active",
	};
}

export function applyErrorState<TAccount extends RouterAccountState>(
	account: TAccount,
	status: number | undefined,
	errorText: unknown,
): TAccount {
	const backoffLevel = typeof account.backoffLevel === "number" ? account.backoffLevel : 0;
	const decision = checkFallbackError(status, errorText, backoffLevel);

	return {
		...account,
		rateLimitedUntil: decision.cooldownMs > 0 ? getUnavailableUntil(decision.cooldownMs) : null,
		backoffLevel: decision.newBackoffLevel ?? backoffLevel,
		lastError: { status, message: normalizeErrorText(errorText), timestamp: new Date().toISOString() },
		status: "error",
	};
}

export function getRotatedModels(
	models: string[],
	comboName?: string,
	strategy?: ComboStrategy,
	stickyLimit: number | string = DEFAULT_COMBO_STICKY_LIMIT,
): string[] {
	if (models.length <= 1 || strategy !== "round-robin") return models;

	const rotationKey = comboName || "__default__";
	const normalizedStickyLimit = normalizeStickyLimit(stickyLimit);
	const state = comboRotationState.get(rotationKey) ?? { index: 0, consecutiveUseCount: 0 };
	const currentIndex = state.index % models.length;
	const rotatedModels = rotateModelsFromIndex(models, currentIndex);
	const nextUseCount = state.consecutiveUseCount + 1;

	if (nextUseCount >= normalizedStickyLimit) {
		comboRotationState.set(rotationKey, {
			index: (currentIndex + 1) % models.length,
			consecutiveUseCount: 0,
		});
	} else {
		comboRotationState.set(rotationKey, {
			index: currentIndex,
			consecutiveUseCount: nextUseCount,
		});
	}

	return rotatedModels;
}

export function resetComboRotation(comboName?: string): void {
	if (comboName) comboRotationState.delete(comboName);
	else comboRotationState.clear();
}

export function getComboModelsFromData(modelStr: string, combosData?: PiRouterCombosData): string[] | null {
	if (modelStr.includes("/")) return null;
	const combo = findCombo(modelStr, combosData);
	return combo && combo.models.length > 0 ? combo.models : null;
}

export function parseModelSelection(input: string | ModelSelection): ModelSelection {
	if (typeof input !== "string") return input;

	const raw = input.trim();
	if (!raw) throw new ModelSelectionParseError("Model selection cannot be empty");

	const parsed = splitModelPrefix(raw);
	if (!parsed) return { mode: "fallback", primary: raw };

	const { prefix, value } = parsed;
	if (!value) throw new ModelSelectionParseError(`Model selection "${raw}" is missing a value after "${prefix}:"`);

	if (prefix === "fixed") return { mode: "fixed", model: value };
	if (prefix === "fallback") return { mode: "fallback", primary: value };
	if (prefix === "auto") {
		const constraints = value === "learning" || value === "memory" ? { budget: "low" as const } : undefined;
		return { mode: "router", intent: value, alias: raw, constraints };
	}
	if (prefix === "cheap") return { mode: "router", intent: value, alias: raw, constraints: { budget: "low" } };
	if (prefix === "fast") return { mode: "router", intent: value, alias: raw, constraints: { latency: "low" } };
	if (prefix === "combo") return { mode: "router", intent: value, alias: raw };

	return { mode: "fallback", primary: raw };
}

export function formatModelSelection(selection: ModelSelection): string {
	if (selection.mode === "fixed") return `fixed:${selection.model}`;
	if (selection.mode === "fallback") return `fallback:${selection.primary}`;
	if (selection.alias) return selection.alias;
	return `auto:${selection.intent}`;
}

export function getRoutingMode(input: string | ModelSelection): RoutingMode {
	return parseModelSelection(input).mode;
}

export function isRouterAlias(input: string): boolean {
	const parsed = splitModelPrefix(input.trim());
	return !!parsed && ROUTER_ALIAS_PREFIXES.has(parsed.prefix);
}

export async function resolveRoute(options: ResolveRouteOptions): Promise<ResolvedRoute> {
	const selection = parseModelSelection(options.requestedModel);
	const requestedModel =
		typeof options.requestedModel === "string" ? options.requestedModel.trim() : formatModelSelection(selection);

	if (selection.mode === "router") {
		const candidate = await options.resolver?.resolveIntent?.(selection.intent, selection);
		if (!candidate) {
			throw new RouteResolutionError(`No route found for router intent: ${selection.intent}`);
		}
		return toResolvedRoute(requestedModel, selection.mode, candidate, "router");
	}

	const model = selection.mode === "fixed" ? selection.model : selection.primary;
	const candidate = (await options.resolver?.resolveModel?.(model, selection)) ?? parseProviderModel(model);
	if (!candidate) {
		throw new RouteResolutionError(`No route found for model: ${model}`);
	}
	return toResolvedRoute(requestedModel, selection.mode, candidate, selection.mode);
}

export function isPiRouterProvider(provider: string): boolean {
	return provider === PIE_LAB_ROUTER_PROVIDER || provider === LEGACY_ROUTER_PROVIDER || provider === "9router";
}

export function isPiRouterModel(model: PiModelReference): boolean {
	return isPiRouterProvider(model.provider) || isRouterAlias(model.id);
}

export function piModelToSelection(model: PiModelReference): string {
	if (isPiRouterProvider(model.provider)) return model.id;
	if (isRouterAlias(model.id)) return model.id;
	if (model.id.startsWith("fixed:") || model.id.startsWith("fallback:")) return model.id;
	return `${model.provider}/${model.id}`;
}

export function createPiRouteResolver<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	policy: PiRouterPolicy = {},
): RouteResolver {
	return {
		resolveModel: (model, selection) => {
			if (selection.mode === "fallback") {
				return firstResolvedCandidate(catalog, [selection.primary, ...toList(selection.fallback)], "fallback");
			}
			return modelToCandidate(resolveModelReference(catalog, model));
		},
		resolveIntent: (intent, selection) => {
			const policyModels = [
				...toList(selection.alias ? policy.aliases?.[selection.alias] : undefined),
				...toList(policy.intents?.[intent]),
			];
			const policyCandidate = firstResolvedCandidate(catalog, policyModels, "router");
			if (policyCandidate) return policyCandidate;

			const model = selectBestModel(catalog.getAvailable(), intent, selection.constraints);
			return modelToCandidate(model, "router");
		},
	};
}

export async function resolvePiModelRoute<TModel extends PiModelReference>(
	options: ResolvePiModelRouteOptions<TModel>,
): Promise<ResolvedPiModelRoute<TModel>> {
	return (await resolvePiModelRoutePlan(options)).primary;
}

export async function resolvePiModelRoutePlan<TModel extends PiModelReference>(
	options: ResolvePiModelRouteOptions<TModel>,
): Promise<ResolvedPiModelRoutePlan<TModel>> {
	const requestedModel = isPiModelReference(options.requestedModel)
		? piModelToSelection(options.requestedModel)
		: options.requestedModel;
	const selection = parseModelSelection(requestedModel);
	const requestedModelText =
		typeof requestedModel === "string" ? requestedModel.trim() : formatModelSelection(selection);
	const routes =
		options.resolver !== undefined
			? [await resolveRoute({ requestedModel, resolver: options.resolver })]
			: resolvePiRouteCandidates({
					selection,
					requestedModel: requestedModelText,
					requestedModelObject: isPiModelReference(options.requestedModel) ? options.requestedModel : undefined,
					catalog: options.catalog,
					policy: options.policy,
				});

	const resolved = routes.map((route) => ({
		route,
		model: resolveRouteModel(options.catalog, route, options.requestedModel),
	}));

	return {
		requestedModel: requestedModelText,
		routingMode: selection.mode,
		routes: resolved,
		primary: resolved[0],
	};
}

interface ResolvePiRouteCandidatesOptions<TModel extends PiModelReference> {
	selection: ModelSelection;
	requestedModel: string;
	requestedModelObject?: TModel;
	catalog: PiModelCatalog<TModel>;
	policy?: PiRouterPolicy;
}

function resolvePiRouteCandidates<TModel extends PiModelReference>(
	options: ResolvePiRouteCandidatesOptions<TModel>,
): ResolvedRoute[] {
	const candidates = resolveCandidateChain(options);
	if (candidates.length === 0) {
		throw new RouteResolutionError(`No route found for model selection: ${options.requestedModel}`);
	}
	return candidates.map((candidate) =>
		toResolvedRoute(options.requestedModel, options.selection.mode, candidate, options.selection.mode),
	);
}

function splitModelPrefix(input: string): { prefix: string; value: string } | null {
	const index = input.indexOf(":");
	if (index <= 0) return null;

	const prefix = input.slice(0, index).toLowerCase();
	const value = input.slice(index + 1).trim();
	return { prefix, value };
}

function parseProviderModel(model: string): RouteCandidate | null {
	const index = model.indexOf("/");
	if (index <= 0 || index === model.length - 1) return null;
	return {
		provider: model.slice(0, index),
		model: model.slice(index + 1),
	};
}

function toResolvedRoute(
	requestedModel: string,
	mode: RoutingMode,
	candidate: RouteCandidate,
	source: RouteSource,
): ResolvedRoute {
	return {
		requestedModel,
		routingMode: mode,
		resolvedProvider: candidate.provider,
		resolvedModel: candidate.model,
		connectionId: candidate.connectionId,
		source: candidate.source ?? source,
		mode,
	};
}

function isPiModelReference(input: unknown): input is PiModelReference {
	return (
		typeof input === "object" &&
		input !== null &&
		"provider" in input &&
		"id" in input &&
		typeof (input as PiModelReference).provider === "string" &&
		typeof (input as PiModelReference).id === "string"
	);
}

function toList(value: string | string[] | undefined): string[] {
	if (!value) return [];
	return Array.isArray(value) ? value : [value];
}

function firstResolvedCandidate<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	models: string[],
	source: RouteSource,
): RouteCandidate | null {
	for (const model of models) {
		const candidate = modelToCandidate(resolveModelReference(catalog, model), source);
		if (candidate) return candidate;
	}
	return null;
}

function resolveCandidateChain<TModel extends PiModelReference>(
	options: ResolvePiRouteCandidatesOptions<TModel>,
): RouteCandidate[] {
	const { selection, catalog, policy, requestedModelObject } = options;

	if (selection.mode === "fixed") {
		return compactCandidates([
			modelToCandidate(resolveModelReferenceWithRequested(catalog, selection.model, requestedModelObject), "fixed"),
		]);
	}

	if (selection.mode === "fallback") {
		const combo = resolvePolicyCombo(selection.primary, policy);
		if (combo) {
			return resolveModelReferenceChain(catalog, combo.models, "router", requestedModelObject);
		}

		return resolveModelReferenceChain(
			catalog,
			[selection.primary, ...toList(selection.fallback)],
			"fallback",
			requestedModelObject,
		);
	}

	const policyModels = [
		...toList(selection.alias ? policy?.aliases?.[selection.alias] : undefined),
		...toList(policy?.intents?.[selection.intent]),
	];
	const policyCandidates = resolveModelReferenceChain(catalog, policyModels, "router", requestedModelObject);
	if (policyCandidates.length > 0) return policyCandidates;

	for (const comboName of comboLookupNames(selection)) {
		const combo = resolvePolicyCombo(comboName, policy);
		if (combo) {
			return resolveModelReferenceChain(catalog, combo.models, "router", requestedModelObject);
		}
	}

	const selectedModels = isComboSelection(selection)
		? selectBestModels(catalog.getAvailable(), selection.intent, selection.constraints, DEFAULT_COMBO_ROUTE_LIMIT)
		: [selectBestModel(catalog.getAvailable(), selection.intent, selection.constraints)];
	return compactCandidates(selectedModels.map((model) => modelToCandidate(model, "router")));
}

function resolveModelReferenceChain<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	models: string[],
	source: RouteSource,
	requestedModelObject?: TModel,
): RouteCandidate[] {
	return compactCandidates(
		models.map((modelReference) =>
			modelToCandidate(resolveModelReferenceWithRequested(catalog, modelReference, requestedModelObject), source),
		),
	);
}

function compactCandidates(candidates: Array<RouteCandidate | null>): RouteCandidate[] {
	const seen = new Set<string>();
	const result: RouteCandidate[] = [];
	for (const candidate of candidates) {
		if (!candidate) continue;
		const key = `${candidate.provider}/${candidate.model}/${candidate.connectionId ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(candidate);
	}
	return result;
}

function resolveRouteModel<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	route: ResolvedRoute,
	requestedModel: string | ModelSelection | TModel,
): TModel {
	let model = catalog.find(route.resolvedProvider, route.resolvedModel);
	if (!model && isPiModelReference(requestedModel)) {
		if (requestedModel.provider === route.resolvedProvider && requestedModel.id === route.resolvedModel) {
			model = requestedModel;
		}
	}
	if (!model) {
		throw new RouteResolutionError(
			`Resolved model is not in catalog: ${route.resolvedProvider}/${route.resolvedModel}`,
		);
	}
	return model;
}

function resolveModelReferenceWithRequested<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	modelReference: string,
	requestedModelObject?: TModel,
): TModel | undefined {
	const model = resolveModelReference(catalog, modelReference);
	if (model) return model;
	if (requestedModelObject && piModelToSelection(requestedModelObject) === modelReference) return requestedModelObject;
	return undefined;
}

function resolveModelReference<TModel extends PiModelReference>(
	catalog: PiModelCatalog<TModel>,
	modelReference: string,
): TModel | undefined {
	const providerModel = parseProviderModel(modelReference);
	if (providerModel) {
		return catalog.find(providerModel.provider, providerModel.model);
	}

	const matches = (catalog.getAll?.() ?? catalog.getAvailable()).filter((model) => model.id === modelReference);
	return matches.length === 1 ? matches[0] : undefined;
}

function modelToCandidate(model: PiModelReference | undefined, source?: RouteSource): RouteCandidate | null {
	if (!model) return null;
	return {
		provider: model.provider,
		model: model.id,
		source,
	};
}

function isComboSelection(selection: ModelSelection): boolean {
	return selection.mode === "router" && selection.alias?.startsWith("combo:") === true;
}

function selectBestModel<TModel extends PiModelReference>(
	models: TModel[],
	intent: RouterIntent,
	constraints: RouterConstraints | undefined,
): TModel | undefined {
	return selectBestModels(models, intent, constraints, 1)[0];
}

function selectBestModels<TModel extends PiModelReference>(
	models: TModel[],
	intent: RouterIntent,
	constraints: RouterConstraints | undefined,
	limit: number,
): TModel[] {
	const candidates = models.filter((model) => {
		if (isPiRouterModel(model)) return false;
		if (isDeprecatedForAutoRouting(model)) return false;
		if (constraints?.requireVision && !model.input?.includes("image")) return false;
		if (constraints?.minContextTokens && (model.contextWindow ?? 0) < constraints.minContextTokens) return false;
		if (constraints?.maxCostUsd && estimateModelCost(model) > constraints.maxCostUsd) return false;
		return true;
	});

	return candidates
		.map((model, index) => ({
			model,
			score: scoreModel(model, intent, constraints) - index / 100000,
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((candidate) => candidate.model);
}

function scoreModel(model: PiModelReference, intent: RouterIntent, constraints: RouterConstraints | undefined): number {
	const text = `${model.provider} ${model.id} ${model.name ?? ""}`.toLowerCase();
	let score = 0;

	if (intent === "coding") {
		score += keywordScore(text, [
			"codex",
			"coding",
			"coder",
			"claude",
			"sonnet",
			"opus",
			"gpt-5",
			"glm",
			"kimi",
			"qwen",
			"deepseek",
		]);
	}
	if (intent === "chat") {
		score += keywordScore(text, ["chat", "mini", "flash", "haiku", "gpt-5", "gemini"]);
	}
	if (intent === "reasoning") {
		score += keywordScore(text, ["reasoning", "thinking", "opus", "pro", "gpt-5", "o3", "o4", "grok"]);
		if (model.reasoning) score += 4;
	}
	if (intent === "vision") {
		if (model.input?.includes("image")) score += 10;
		score += keywordScore(text, ["vision", "gpt", "gemini", "claude"]);
	}
	if (intent === "learning" || intent === "memory") {
		score += keywordScore(text, ["mini", "flash", "haiku", "small", "cheap", "gpt-5"]);
		score -= keywordScore(text, ["opus", "pro", "reasoning", "thinking"]) / 2;
	}

	if (constraints?.budget === "low") {
		score -= estimateModelCost(model) / 2;
		score += keywordScore(text, ["mini", "flash", "haiku", "cheap", "free", "groq", "cerebras"]);
	}
	if (constraints?.latency === "low") {
		score += keywordScore(text, ["mini", "flash", "haiku", "groq", "cerebras", "fast"]);
		score -= keywordScore(text, ["opus", "reasoning", "thinking", "pro"]) / 2;
	}
	if (constraints?.quality === "high") {
		score += keywordScore(text, ["opus", "sonnet", "pro", "gpt-5", "claude"]);
	}

	score += Math.min((model.contextWindow ?? 0) / 100000, 3);
	return score;
}

function keywordScore(text: string, keywords: string[]): number {
	return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 2 : 0), 0);
}

function estimateModelCost(model: PiModelReference): number {
	return (model.cost?.input ?? 0) + (model.cost?.output ?? 0);
}

function isDeprecatedForAutoRouting(model: PiModelReference): boolean {
	const id = model.id.toLowerCase();
	const bareId = id.includes("/") ? (id.split("/").pop() ?? id) : id;
	return AUTO_ROUTING_DEPRECATED_MODEL_IDS.has(bareId);
}

function backoffDecision(backoffLevel: number): RouterFallbackDecision {
	const newBackoffLevel = Math.min(backoffLevel + 1, ROUTER_BACKOFF_CONFIG.maxLevel);
	return {
		shouldFallback: true,
		cooldownMs: getQuotaCooldown(newBackoffLevel),
		newBackoffLevel,
	};
}

function normalizeErrorText(errorText: unknown): string {
	if (typeof errorText === "string") return errorText;
	if (errorText instanceof Error) return errorText.message;
	try {
		return JSON.stringify(errorText ?? "");
	} catch {
		return String(errorText);
	}
}

function extractResetAtMs(error: unknown, now: number): number | null {
	for (const value of walkErrorValues(error)) {
		const key = value.key.toLowerCase();
		if (!["resetsatms", "resetatms", "resets_at", "reset_at", "resetat", "ratelimitreset"].includes(key)) {
			continue;
		}

		const timestamp = parseResetTimestamp(value.value, now);
		if (timestamp !== null) return timestamp;
	}

	return null;
}

function extractResetAfterMs(error: unknown): number | null {
	for (const value of walkErrorValues(error)) {
		const key = value.key.toLowerCase();
		if (
			[
				"resetsinseconds",
				"resets_in_seconds",
				"retryafterseconds",
				"retry_after_seconds",
				"retryafterms",
				"retry_after_ms",
				"x-ratelimit-reset-after",
			].includes(key)
		) {
			const duration = parseDurationValue(value.value, key.endsWith("ms") ? "ms" : "seconds");
			if (duration !== null) return duration;
		}

		if (["retryafter", "retry_after"].includes(key)) {
			const duration = parseRetryAfterValue(value.value);
			if (duration !== null) return duration;
		}
	}

	return parseResetDurationFromText(normalizeErrorText(error));
}

function parseResetTimestamp(value: unknown, now: number): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const timestamp = value < 1e12 ? value * 1000 : value;
		return timestamp > now ? timestamp : null;
	}

	if (typeof value === "string" && value.trim()) {
		if (/^\d+$/.test(value.trim())) {
			return parseResetTimestamp(Number(value), now);
		}
		const timestamp = Date.parse(value);
		return Number.isNaN(timestamp) || timestamp <= now ? null : timestamp;
	}

	return null;
}

function parseDurationValue(value: unknown, unit: "ms" | "seconds"): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return unit === "ms" ? value : value * 1000;
	}

	if (typeof value === "string" && value.trim() && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		return parseDurationValue(Number(value), unit);
	}

	return null;
}

function parseRetryAfterValue(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value * 1000;
	}

	if (typeof value !== "string" || !value.trim()) return null;

	const trimmed = value.trim();
	if (/^\d+(\.\d+)?$/.test(trimmed)) {
		return Number(trimmed) * 1000;
	}

	const timestamp = Date.parse(trimmed);
	if (!Number.isNaN(timestamp)) {
		const diff = timestamp - Date.now();
		return diff > 0 ? diff : null;
	}

	return parseResetDurationFromText(trimmed);
}

function parseResetDurationFromText(text: string): number | null {
	const resetAfter = text.match(/reset after\s+(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
	if (resetAfter) {
		const hours = Number(resetAfter[1] ?? 0);
		const minutes = Number(resetAfter[2] ?? 0);
		const seconds = Number(resetAfter[3] ?? 0);
		const totalMs = hours * 3_600_000 + minutes * 60_000 + seconds * 1000;
		if (totalMs > 0) return totalMs;
	}

	const tryAgain = text.match(/try again in\s+~?\s*(\d+)\s*(min|mins|minute|minutes|m|sec|secs|second|seconds|s)\b/i);
	if (tryAgain) {
		const amount = Number(tryAgain[1]);
		const unit = tryAgain[2].toLowerCase();
		return unit.startsWith("m") ? amount * 60_000 : amount * 1000;
	}

	return null;
}

function walkErrorValues(error: unknown): Array<{ key: string; value: unknown }> {
	const values: Array<{ key: string; value: unknown }> = [];
	const seen = new Set<unknown>();

	function visit(value: unknown, depth: number): void {
		if (!value || typeof value !== "object" || seen.has(value) || depth > 4) return;
		seen.add(value);
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			values.push({ key, value: nested });
			visit(nested, depth + 1);
		}
	}

	visit(error, 0);
	return values;
}

function normalizeStickyLimit(stickyLimit: number | string): number {
	const parsed = Number.parseInt(String(stickyLimit), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_COMBO_STICKY_LIMIT;
}

function normalizeAccountStickyLimit(stickyLimit: number | string): number {
	const parsed = Number.parseInt(String(stickyLimit), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function normalizeQuotaStrategy(value: unknown): QuotaSelectionStrategy {
	if (value === "off" || value === "prefer-remaining" || value === "require-remaining") return value;
	return "off";
}

function normalizeDurationMs(value: unknown, fallback: number): number {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePercentage(value: unknown, fallback: number): number {
	const parsed = Number.parseFloat(String(value ?? ""));
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(0, Math.min(100, parsed));
}

function normalizeConnectionIdSet(value?: string | string[] | Set<string> | null): Set<string> {
	if (!value) return new Set();
	if (value instanceof Set) return value;
	return new Set(Array.isArray(value) ? value : [value]);
}

function applyQuotaSelectionFilter<TConnection extends ProviderConnectionReference>(
	connections: readonly TConnection[],
	options: {
		model?: string | null;
		now: Date;
		quotaStrategy: QuotaSelectionStrategy;
		quotaMaxAgeMs: number;
		quotaMinRemainingPercentage: number;
	},
): TConnection[] {
	if (options.quotaStrategy === "off") return [...connections];

	return connections.filter((connection) => {
		const score = getProviderConnectionQuotaScore(connection, options.model, options.now, options.quotaMaxAgeMs);
		if (!score.hasFreshSnapshot) return options.quotaStrategy !== "require-remaining";
		if (score.status === "depleted") return false;
		if (options.quotaStrategy === "require-remaining") {
			return score.remainingPercentage === null || score.remainingPercentage >= options.quotaMinRemainingPercentage;
		}
		return true;
	});
}

function sortProviderConnectionsByQuota<TConnection extends ProviderConnectionReference>(
	connections: readonly TConnection[],
	options: { model?: string | null; now: Date; quotaMaxAgeMs: number },
): TConnection[] {
	return [...connections].sort((left, right) => {
		const leftScore = getProviderConnectionQuotaScore(left, options.model, options.now, options.quotaMaxAgeMs);
		const rightScore = getProviderConnectionQuotaScore(right, options.model, options.now, options.quotaMaxAgeMs);
		if (rightScore.score !== leftScore.score) return rightScore.score - leftScore.score;
		return priorityValue(left) - priorityValue(right);
	});
}

function explainProviderConnectionCandidate(
	connection: ProviderConnectionReference,
	options: {
		model?: string | null;
		now: Date;
		excludeSet: Set<string>;
		selectedConnectionId?: string;
		quotaStrategy: QuotaSelectionStrategy;
		quotaMaxAgeMs: number;
		quotaMinRemainingPercentage: number;
		preferredConnectionId?: string | null;
	},
): ProviderConnectionCandidateExplanation {
	const reasons: string[] = [];
	const modelLockUntil = getEarliestModelLockUntil(connection);
	const quotaSelection = readProviderConnectionQuotaSnapshot(connection);
	const quotaScore = getProviderConnectionQuotaScore(connection, options.model, options.now, options.quotaMaxAgeMs);
	let selectable = true;

	if (connection.isActive === false) {
		selectable = false;
		reasons.push("inactive connection");
	}

	if (options.excludeSet.has(connection.id)) {
		selectable = false;
		reasons.push("excluded by current fallback attempt");
	}

	if (isModelLockActive(connection, options.model)) {
		selectable = false;
		reasons.push(options.model ? `model cooldown for ${options.model}` : "provider cooldown");
	}

	if (options.quotaStrategy !== "off") {
		if (!quotaScore.hasFreshSnapshot) {
			reasons.push("quota snapshot is missing or stale");
			if (options.quotaStrategy === "require-remaining") {
				selectable = false;
			}
		} else if (quotaScore.status === "depleted") {
			selectable = false;
			reasons.push("quota snapshot is depleted");
		} else if (
			options.quotaStrategy === "require-remaining" &&
			quotaScore.remainingPercentage !== null &&
			quotaScore.remainingPercentage < options.quotaMinRemainingPercentage
		) {
			selectable = false;
			reasons.push(`remaining quota is below ${options.quotaMinRemainingPercentage}%`);
		} else {
			reasons.push(`quota score ${quotaScore.score.toFixed(2)}`);
		}
	}

	if (options.preferredConnectionId) {
		reasons.push(
			connection.id === options.preferredConnectionId
				? "preferred connection requested"
				: "not the requested preferred connection",
		);
	}

	if (connection.id === options.selectedConnectionId) {
		reasons.unshift("selected by account strategy");
	} else if (selectable && reasons.length === 0) {
		reasons.push("available but lower priority than selected connection");
	}

	return {
		id: connection.id,
		provider: connection.provider,
		isActive: connection.isActive !== false,
		priority: connection.priority ?? null,
		selected: connection.id === options.selectedConnectionId,
		selectable,
		reasons,
		lastUsedAt: connection.lastUsedAt,
		consecutiveUseCount: connection.consecutiveUseCount,
		modelLockUntil,
		quotaSelection,
		quotaFresh: quotaScore.hasFreshSnapshot,
		quotaScore: quotaScore.score,
		remainingPercentage: quotaScore.remainingPercentage,
	};
}

function getProviderConnectionQuotaScore(
	connection: ProviderConnectionReference,
	_model: string | null | undefined,
	now: Date,
	maxAgeMs: number,
): {
	hasFreshSnapshot: boolean;
	status: ProviderQuotaSelectionSnapshot["status"];
	score: number;
	remainingPercentage: number | null;
} {
	const snapshot = readProviderConnectionQuotaSnapshot(connection);
	if (!snapshot) {
		return { hasFreshSnapshot: false, status: "unknown", score: -1, remainingPercentage: null };
	}

	const checkedAt = typeof snapshot.checkedAt === "string" ? Date.parse(snapshot.checkedAt) : Number.NaN;
	const fresh = Number.isFinite(checkedAt) && now.getTime() - checkedAt <= maxAgeMs;
	if (!fresh) {
		return { hasFreshSnapshot: false, status: snapshot.status ?? "unknown", score: -1, remainingPercentage: null };
	}

	const rawScore = typeof snapshot.score === "number" && Number.isFinite(snapshot.score) ? snapshot.score : -1;
	const remainingPercentage =
		typeof snapshot.remainingPercentage === "number" && Number.isFinite(snapshot.remainingPercentage)
			? snapshot.remainingPercentage
			: null;

	return {
		hasFreshSnapshot: true,
		status: snapshot.status ?? "unknown",
		score: Math.max(-1, Math.min(1, rawScore)),
		remainingPercentage,
	};
}

function readProviderConnectionQuotaSnapshot(
	connection: ProviderConnectionReference,
): ProviderQuotaSelectionSnapshot | null {
	const providerSpecificData = connection.providerSpecificData;
	if (!providerSpecificData || typeof providerSpecificData !== "object") return null;
	const snapshot =
		providerSpecificData[PIE_LAB_QUOTA_SELECTION_KEY] ?? providerSpecificData[LEGACY_QUOTA_SELECTION_KEY];
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
	return snapshot as ProviderQuotaSelectionSnapshot;
}

function sortProviderConnections<TConnection extends ProviderConnectionReference>(
	connections: readonly TConnection[],
): TConnection[] {
	return [...connections].sort((left, right) => priorityValue(left) - priorityValue(right));
}

function sortByMostRecentUseThenPriority(
	left: ProviderConnectionReference,
	right: ProviderConnectionReference,
): number {
	const leftTime = parseOptionalTime(left.lastUsedAt);
	const rightTime = parseOptionalTime(right.lastUsedAt);

	if (leftTime === null && rightTime === null) return priorityValue(left) - priorityValue(right);
	if (leftTime === null) return 1;
	if (rightTime === null) return -1;
	return rightTime - leftTime;
}

function sortByOldestUseThenPriority(left: ProviderConnectionReference, right: ProviderConnectionReference): number {
	const leftTime = parseOptionalTime(left.lastUsedAt);
	const rightTime = parseOptionalTime(right.lastUsedAt);

	if (leftTime === null && rightTime === null) return priorityValue(left) - priorityValue(right);
	if (leftTime === null) return -1;
	if (rightTime === null) return 1;
	return leftTime - rightTime;
}

function parseOptionalTime(value?: string | null): number | null {
	if (!value) return null;
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : time;
}

function priorityValue(connection: ProviderConnectionReference): number {
	return connection.priority || 999;
}

function rotateModelsFromIndex(models: string[], currentIndex: number): string[] {
	const rotatedModels = [...models];
	for (let index = 0; index < currentIndex; index++) {
		const moved = rotatedModels.shift();
		if (moved !== undefined) rotatedModels.push(moved);
	}
	return rotatedModels;
}

function normalizeCombosData(combosData?: PiRouterCombosData): PiRouterCombo[] {
	if (!combosData) return [];
	return Array.isArray(combosData) ? combosData : (combosData.combos ?? []);
}

function findCombo(name: string, combosData?: PiRouterCombosData): PiRouterCombo | undefined {
	return normalizeCombosData(combosData).find((combo) => combo.name === name);
}

function comboLookupNames(selection: Extract<ModelSelection, { mode: "router" }>): string[] {
	if (!selection.alias?.startsWith("combo:")) return [];
	const comboName = selection.alias.slice("combo:".length);
	return comboName ? [comboName, selection.alias] : [selection.alias];
}

function resolvePolicyCombo(name: string, policy: PiRouterPolicy | undefined): { models: string[] } | null {
	const combo = findCombo(name, policy?.combos);
	if (!combo || combo.models.length === 0) return null;

	const { strategy, stickyLimit } = resolveComboStrategy(combo, policy);
	return {
		models: getRotatedModels(combo.models, combo.name, strategy, stickyLimit),
	};
}

function resolveComboStrategy(
	combo: PiRouterCombo,
	policy: PiRouterPolicy | undefined,
): { strategy: ComboStrategy; stickyLimit: number | string } {
	const override = policy?.comboStrategies?.[combo.name];
	const overrideConfig = typeof override === "string" ? { strategy: override } : override;

	return {
		strategy: overrideConfig?.strategy ?? combo.strategy ?? policy?.comboStrategy ?? "fallback",
		stickyLimit:
			overrideConfig?.stickyLimit ?? combo.stickyLimit ?? policy?.comboStickyLimit ?? DEFAULT_COMBO_STICKY_LIMIT,
	};
}
