import {
	createJsonProviderConnectionStore,
	type BudgetLimitSettings,
	type ProviderConnectionSettings,
	type ProviderConnectionStore,
	type ProviderStrategyConfig,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.ts";

export interface ProviderSettingsApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, PUT, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createProviderSettingsRequestHandler(options: ProviderSettingsApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleProviderSettingsRequest(request, response, providerConnectionStore);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleProviderSettingsRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (url.pathname !== "/provider-settings" && url.pathname !== "/v1/provider-settings") {
		writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
		return;
	}

	if (request.method === "GET") {
		writeJson(response, 200, { settings: await providerConnectionStore.getSettings() });
		return;
	}

	if (request.method === "PUT") {
		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;

		const updates = normalizeProviderSettingsInput(body.settings && typeof body.settings === "object" ? body.settings : body);
		const settings = await providerConnectionStore.updateSettings(updates);
		writeJson(response, 200, { settings });
		return;
	}

	writeMethodNotAllowed(response, "GET, PUT, OPTIONS");
}

function normalizeProviderSettingsInput(body: object): ProviderConnectionSettings {
	const data = body as Record<string, unknown>;
	const updates: ProviderConnectionSettings = {};

	for (const key of [
		"fallbackStrategy",
		"stickyRoundRobinLimit",
		"quotaStrategy",
		"quotaMinRemainingPercentage",
		"quotaMaxAgeMs",
		"quotaRefreshTtlMs",
	] as const) {
		if (Object.hasOwn(data, key)) {
			updates[key] = data[key] as never;
		}
	}

	if (Object.hasOwn(data, "quotaRefreshBeforeSelection")) {
		updates.quotaRefreshBeforeSelection = data.quotaRefreshBeforeSelection === true;
	}
	if (Object.hasOwn(data, "rtkEnabled")) {
		updates.rtkEnabled = data.rtkEnabled !== false;
	}
	if (Object.hasOwn(data, "budgetLimits")) {
		updates.budgetLimits = normalizeBudgetLimits(data.budgetLimits);
	}
	if (Object.hasOwn(data, "providerStrategies")) {
		updates.providerStrategies = normalizeProviderStrategies(data.providerStrategies);
	}

	return updates;
}

function normalizeBudgetLimits(value: unknown): BudgetLimitSettings {
	const record = asRecord(value);
	return {
		mode: normalizeString(record.mode) as BudgetLimitSettings["mode"],
		requestUsd: normalizeNullableNumber(record.requestUsd),
		dailyUsd: normalizeNullableNumber(record.dailyUsd),
		monthlyUsd: normalizeNullableNumber(record.monthlyUsd),
		providerLimits: normalizeBudgetProviderLimits(record.providerLimits),
	};
}

function normalizeBudgetProviderLimits(value: unknown): BudgetLimitSettings["providerLimits"] {
	const providerLimits: BudgetLimitSettings["providerLimits"] = {};
	for (const [provider, ruleValue] of Object.entries(asRecord(value))) {
		const name = normalizeString(provider);
		if (!name) continue;
		const rule = asRecord(ruleValue);
		providerLimits[name] = {
			mode: normalizeString(rule.mode) as BudgetLimitSettings["mode"],
			requestUsd: normalizeNullableNumber(rule.requestUsd),
			dailyUsd: normalizeNullableNumber(rule.dailyUsd),
			monthlyUsd: normalizeNullableNumber(rule.monthlyUsd),
		};
	}
	return providerLimits;
}

function normalizeProviderStrategies(value: unknown): Record<string, ProviderStrategyConfig> {
	const strategies: Record<string, ProviderStrategyConfig> = {};
	for (const [provider, strategyValue] of Object.entries(asRecord(value))) {
		const name = normalizeString(provider);
		if (!name) continue;
		const strategy = asRecord(strategyValue);
		strategies[name] = {
			fallbackStrategy: normalizeString(strategy.fallbackStrategy) as ProviderStrategyConfig["fallbackStrategy"],
			stickyRoundRobinLimit: strategy.stickyRoundRobinLimit as ProviderStrategyConfig["stickyRoundRobinLimit"],
			quotaStrategy: normalizeString(strategy.quotaStrategy) as ProviderStrategyConfig["quotaStrategy"],
			quotaMinRemainingPercentage: strategy.quotaMinRemainingPercentage as ProviderStrategyConfig["quotaMinRemainingPercentage"],
			quotaMaxAgeMs: strategy.quotaMaxAgeMs as ProviderStrategyConfig["quotaMaxAgeMs"],
			quotaRefreshBeforeSelection:
				Object.hasOwn(strategy, "quotaRefreshBeforeSelection") ? strategy.quotaRefreshBeforeSelection === true : undefined,
			quotaRefreshTtlMs: strategy.quotaRefreshTtlMs as ProviderStrategyConfig["quotaRefreshTtlMs"],
			proxyPoolId: normalizeString(strategy.proxyPoolId) || undefined,
		};
	}
	return strategies;
}

async function readBodyOrWriteBadRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<Record<string, unknown> | null> {
	try {
		return await readJsonBody(request);
	} catch {
		writeJson(response, 400, { error: "Invalid JSON body" });
		return null;
	}
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	if (!text) return {};
	const parsed = JSON.parse(text) as unknown;
	return asRecord(parsed);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableNumber(value: unknown): number | null {
	if (value === undefined || value === null || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function writeMethodNotAllowed(response: ServerResponse, allow: string): void {
	response.writeHead(405, {
		...CORS_HEADERS,
		allow,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify({ error: { message: "Method not allowed." } })}\n`);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
