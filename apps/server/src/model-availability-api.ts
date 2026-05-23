import {
	createJsonProviderConnectionStore,
	type ProviderConnection,
	type ProviderConnectionStore,
} from "@pie-lab/storage";
import { MODEL_LOCK_ALL, MODEL_LOCK_PREFIX, formatRetryAfter, getModelLockKey } from "@pie-lab/router";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.js";

export interface ModelAvailabilityApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	now?: () => Date;
}

export interface ModelAvailabilityLock {
	key: string;
	scope: "model" | "all";
	model: string | null;
	until: string;
	retryAfterMs: number;
	retryAfterHuman: string;
}

export interface ModelAvailabilityConnection {
	id: string;
	provider: string;
	authType: string;
	name?: string | null;
	displayName?: string | null;
	email?: string | null;
	isActive: boolean;
	testStatus?: string | null;
	lastError?: unknown;
	lastErrorAt?: string | null;
	errorCode?: string | number | null;
	backoffLevel?: number | null;
	locks: ModelAvailabilityLock[];
}

export interface ModelAvailabilityModelLockSummary {
	provider: string;
	model: string | null;
	scope: "model" | "all";
	activeConnectionCount: number;
	connectionIds: string[];
	earliestRetryAfter: string;
	earliestRetryAfterHuman: string;
}

export interface ModelAvailabilityResponse {
	generatedAt: string;
	count: number;
	lockedConnectionCount: number;
	lockedModelCount: number;
	data: ModelAvailabilityConnection[];
	lockedModels: ModelAvailabilityModelLockSummary[];
}

export interface ModelAvailabilityClearCooldownResponse {
	ok: true;
	provider: string;
	model: string;
	lockKey: string;
	clearedCount: number;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createModelAvailabilityRequestHandler(options: ModelAvailabilityApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const now = options.now ?? (() => new Date());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleModelAvailabilityRequest(request, response, providerConnectionStore, now);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleModelAvailabilityRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	now: () => Date = () => new Date(),
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (!isModelAvailabilityPath(url.pathname)) {
		writeJson(response, 404, {
			error: {
				message: "Not found",
				path: url.pathname,
			},
		});
		return;
	}

	if (request.method === "GET") {
		const connections = await providerConnectionStore.getProviderConnections();
		writeJson(response, 200, createModelAvailabilityResponse(connections, now()));
		return;
	}

	if (request.method === "POST") {
		const body = await readJsonBody(request);
		const normalized = normalizeClearCooldownRequest(body);
		if ("error" in normalized) {
			writeJson(response, 400, { error: normalized.error });
			return;
		}

		const result = await clearModelCooldown(providerConnectionStore, normalized.provider, normalized.model);
		writeJson(response, 200, result);
		return;
	}

	if (request.method !== "GET") {
		writeJson(response, 405, {
			error: {
				message: "Only GET, POST, and OPTIONS requests are supported.",
			},
		});
		return;
	}
}

export function createModelAvailabilityResponse(
	connections: readonly ProviderConnection[],
	now: Date = new Date(),
): ModelAvailabilityResponse {
	const nowMs = now.getTime();
	const data = connections.map((connection) => toAvailabilityConnection(connection, nowMs));
	const lockedConnections = data.filter((connection) => connection.locks.length > 0);
	const lockedModels = summarizeLockedModels(data);

	return {
		generatedAt: now.toISOString(),
		count: data.length,
		lockedConnectionCount: lockedConnections.length,
		lockedModelCount: lockedModels.length,
		data,
		lockedModels,
	};
}

export async function clearModelCooldown(
	providerConnectionStore: ProviderConnectionStore,
	provider: string,
	model: string,
): Promise<ModelAvailabilityClearCooldownResponse> {
	const lockKey = getModelLockKey(model);
	const connections = await providerConnectionStore.getProviderConnections({ provider });
	let clearedCount = 0;

	await Promise.all(
		connections
			.filter((connection) => Boolean(connection[lockKey]))
			.map(async (connection) => {
				await providerConnectionStore.updateProviderConnection(connection.id, {
					[lockKey]: null,
					...(connection.testStatus === "unavailable"
						? {
								testStatus: "active",
								lastError: null,
								lastErrorAt: null,
								backoffLevel: 0,
							}
						: {}),
				});
				clearedCount += 1;
			}),
	);

	return {
		ok: true,
		provider,
		model,
		lockKey,
		clearedCount,
	};
}

function toAvailabilityConnection(connection: ProviderConnection, nowMs: number): ModelAvailabilityConnection {
	return {
		id: connection.id,
		provider: connection.provider,
		authType: connection.authType,
		name: connection.name,
		displayName: connection.displayName,
		email: connection.email,
		isActive: connection.isActive,
		testStatus: connection.testStatus,
		lastError: connection.lastError,
		lastErrorAt: connection.lastErrorAt,
		errorCode: connection.errorCode,
		backoffLevel: connection.backoffLevel,
		locks: getActiveModelLocks(connection, nowMs),
	};
}

function getActiveModelLocks(connection: ProviderConnection, nowMs: number): ModelAvailabilityLock[] {
	const locks: ModelAvailabilityLock[] = [];

	for (const [key, value] of Object.entries(connection)) {
		if (!key.startsWith(MODEL_LOCK_PREFIX) || typeof value !== "string") continue;

		const untilMs = Date.parse(value);
		if (!Number.isFinite(untilMs) || untilMs <= nowMs) continue;

		const modelKey = key.slice(MODEL_LOCK_PREFIX.length);
		const scope = key === MODEL_LOCK_ALL ? "all" : "model";
		const retryAfterMs = untilMs - nowMs;

		locks.push({
			key,
			scope,
			model: scope === "all" ? null : modelKey,
			until: new Date(untilMs).toISOString(),
			retryAfterMs,
			retryAfterHuman: formatRetryAfter(new Date(untilMs).toISOString()),
		});
	}

	return locks.sort((left, right) => Date.parse(left.until) - Date.parse(right.until) || left.key.localeCompare(right.key));
}

function summarizeLockedModels(
	connections: readonly ModelAvailabilityConnection[],
): ModelAvailabilityModelLockSummary[] {
	const summaries = new Map<string, ModelAvailabilityModelLockSummary>();

	for (const connection of connections) {
		for (const lock of connection.locks) {
			const summaryKey = `${connection.provider}:${lock.scope}:${lock.model ?? "__all"}`;
			const existing = summaries.get(summaryKey);

			if (!existing) {
				summaries.set(summaryKey, {
					provider: connection.provider,
					model: lock.model,
					scope: lock.scope,
					activeConnectionCount: 1,
					connectionIds: [connection.id],
					earliestRetryAfter: lock.until,
					earliestRetryAfterHuman: lock.retryAfterHuman,
				});
				continue;
			}

			existing.activeConnectionCount += 1;
			existing.connectionIds.push(connection.id);
			if (Date.parse(lock.until) < Date.parse(existing.earliestRetryAfter)) {
				existing.earliestRetryAfter = lock.until;
				existing.earliestRetryAfterHuman = lock.retryAfterHuman;
			}
		}
	}

	return [...summaries.values()].sort(
		(left, right) =>
			left.provider.localeCompare(right.provider) ||
			(left.model ?? "__all").localeCompare(right.model ?? "__all"),
	);
}

function isModelAvailabilityPath(pathname: string): boolean {
	return pathname === "/models/availability" || pathname === "/v1/models/availability";
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}

	const text = Buffer.concat(chunks).toString("utf-8").trim();
	if (!text) return {};

	const parsed = JSON.parse(text) as unknown;
	return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function normalizeClearCooldownRequest(
	body: Record<string, unknown>,
): { provider: string; model: string } | { error: string } {
	const action = normalizeString(body.action);
	const provider = normalizeString(body.provider);
	const model = normalizeString(body.model);

	if (action !== "clearCooldown" || !provider || !model) {
		return { error: "Invalid request" };
	}

	return { provider, model };
}

function normalizeString(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).trim();
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
