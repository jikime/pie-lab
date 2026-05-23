import {
	createJsonProviderConnectionStore,
	createJsonlUsageStore,
	type ProviderConnectionStore,
	type UsageStore,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { evaluateBudget } from "./budget-policy.js";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.js";
import { getDefaultUsageFilePath } from "./usage-api.js";

export interface BudgetApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	usageStore?: UsageStore;
	usageFilePath?: string;
	now?: () => Date;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createBudgetRequestHandler(options: BudgetApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const usageStore = options.usageStore ?? createJsonlUsageStore(options.usageFilePath ?? getDefaultUsageFilePath());
	const now = options.now ?? (() => new Date());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleBudgetRequest(request, response, { providerConnectionStore, usageStore, now });
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleBudgetRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		usageStore: UsageStore;
		now: () => Date;
	},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (url.pathname !== "/budget" && url.pathname !== "/v1/budget") {
		writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
		return;
	}

	if (request.method !== "GET") {
		writeMethodNotAllowed(response);
		return;
	}

	const settings = await options.providerConnectionStore.getSettings();
	const budget = await evaluateBudget({
		settings,
		usageStore: options.usageStore,
		provider: normalizeString(url.searchParams.get("provider")),
		estimatedRequestUsd: normalizeNullableNumber(url.searchParams.get("estimateUsd")),
		now: options.now(),
	});

	writeJson(response, 200, { budget });
}

function normalizeString(value: unknown): string | null {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
}

function normalizeNullableNumber(value: unknown): number | null {
	if (value === undefined || value === null || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function writeMethodNotAllowed(response: ServerResponse): void {
	response.writeHead(405, {
		...CORS_HEADERS,
		allow: "GET, OPTIONS",
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
