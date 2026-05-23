import {
	createJsonlUsageStore,
	queryUsageRecords,
	summarizeUsageRecords,
	type UsageRecord,
	type UsageRecordQuery,
	type UsageRecordStatus,
	type UsageStore,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UsageApiOptions {
	usageStore?: UsageStore;
	usageFilePath?: string;
}

export type PieLabRequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-origin": "*",
};

const USAGE_RECORD_STATUSES = new Set<UsageRecordStatus>(["success", "error", "aborted", "skipped"]);
const ROUTING_MODES = new Set<UsageRecord["routingMode"]>(["fixed", "router", "fallback"]);

export function createUsageRequestHandler(options: UsageApiOptions = {}): PieLabRequestHandler {
	const usageStore = options.usageStore ?? createJsonlUsageStore(options.usageFilePath ?? getDefaultUsageFilePath());

	return async (request, response) => {
		try {
			await handleUsageRequest(request, response, usageStore);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleUsageRequest(
	request: IncomingMessage,
	response: ServerResponse,
	usageStore: UsageStore,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

	if (url.pathname === "/health") {
		writeJson(response, 200, { ok: true });
		return;
	}

	if (request.method !== "GET") {
		writeJson(response, 405, {
			error: {
				message: "Only GET and OPTIONS requests are supported.",
			},
		});
		return;
	}

	if (url.pathname === "/usage" || url.pathname === "/v1/usage") {
		const records = await readUsageRecords(usageStore);
		const query = parseUsageRecordQuery(url.searchParams, { defaultLimit: 100 });
		const matchedRecords = queryUsageRecords(records, query);

		writeJson(response, 200, {
			count: matchedRecords.length,
			records: matchedRecords,
		});
		return;
	}

	if (url.pathname === "/usage/summary" || url.pathname === "/v1/usage/summary") {
		const records = await readUsageRecords(usageStore);
		const query = parseUsageRecordQuery(url.searchParams, { includeLimit: false });
		const matchedRecords = queryUsageRecords(records, query);

		writeJson(response, 200, {
			count: matchedRecords.length,
			summary: summarizeUsageRecords(matchedRecords),
		});
		return;
	}

	const requestId = parseUsageDetailRequestId(url.pathname);
	if (requestId) {
		const records = await readUsageRecords(usageStore);
		const matchedRecords = queryUsageRecords(records, { requestId, order: "asc" });
		writeJson(response, 200, {
			requestId,
			count: matchedRecords.length,
			summary: summarizeUsageRecords(matchedRecords),
			records: matchedRecords,
			timeline: matchedRecords
				.map((record) => ({
					id: record.id,
					timestamp: record.timestamp,
					status: record.status,
					endpoint: record.endpoint,
					requestedModel: record.requestedModel,
					resolvedProvider: record.resolvedProvider,
					resolvedModel: record.resolvedModel,
					connectionId: record.connectionId,
					attemptIndex: record.attemptIndex,
					attemptCount: record.attemptCount,
					routeSource: record.routeSource ?? record.routingMode,
					tokens: record.usage?.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0),
					costUsd: record.cost?.total ?? record.costUsd ?? 0,
					errorMessage: record.errorMessage,
				}))
				.sort((left, right) => left.attemptIndex - right.attemptIndex || Date.parse(left.timestamp) - Date.parse(right.timestamp)),
			trace: createUsageDetailTrace(matchedRecords),
		});
		return;
	}

	writeJson(response, 404, {
		error: {
			message: "Not found",
			path: url.pathname,
		},
	});
}

function parseUsageDetailRequestId(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?usage\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

function createUsageDetailTrace(records: UsageRecord[]) {
	return records
		.flatMap((record) =>
			(record.trace ?? []).map((event, index) => ({
				...event,
				recordId: record.id,
				requestId: record.requestId,
				eventIndex: index,
				attemptIndex: event.attemptIndex ?? record.attemptIndex,
				status: event.status ?? record.status,
				provider: event.provider ?? record.resolvedProvider,
				model: event.model ?? record.resolvedModel,
				connectionId: event.connectionId ?? record.connectionId,
			})),
		)
		.sort(
			(left, right) =>
				(left.attemptIndex ?? 0) - (right.attemptIndex ?? 0) ||
				Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
				left.eventIndex - right.eventIndex,
		);
}

export function getDefaultUsageFilePath(env: NodeJS.ProcessEnv = process.env): string {
	const usagePath = env.PIE_LAB_USAGE_PATH?.trim() || env.PIE_ADK_USAGE_PATH?.trim() || env.PI_ADK_USAGE_PATH?.trim();
	if (usagePath) {
		return usagePath;
	}

	const agentDir = env.PIE_CODING_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pie", "agent");
	return join(agentDir, "usage.jsonl");
}

export function parseUsageRecordQuery(
	searchParams: URLSearchParams,
	options: { defaultLimit?: number; includeLimit?: boolean; maxLimit?: number } = {},
): UsageRecordQuery {
	const query: UsageRecordQuery = {};

	const statuses = getStringList(searchParams, "status").filter(isUsageRecordStatus);
	if (statuses.length > 0) {
		query.status = statuses.length === 1 ? statuses[0] : statuses;
	}

	const routingModes = getStringList(searchParams, "routingMode").filter(isRoutingMode);
	if (routingModes.length > 0) {
		query.routingMode = routingModes.length === 1 ? routingModes[0] : routingModes;
	}

	assignFirstString(query, "provider", searchParams, ["provider", "resolvedProvider"]);
	assignFirstString(query, "model", searchParams, ["model", "resolvedModel"]);
	assignFirstString(query, "requestId", searchParams, ["requestId"]);
	assignFirstString(query, "agentRunId", searchParams, ["agentRunId"]);
	assignFirstString(query, "endpoint", searchParams, ["endpoint"]);
	assignFirstString(query, "from", searchParams, ["from", "since"]);
	assignFirstString(query, "to", searchParams, ["to", "until"]);

	const order = getFirstString(searchParams, ["order"]);
	if (order === "asc" || order === "desc") {
		query.order = order;
	}

	if (options.includeLimit !== false) {
		const limit = parseLimit(getFirstString(searchParams, ["limit"]), options.defaultLimit, options.maxLimit ?? 1000);
		if (limit !== undefined) {
			query.limit = limit;
		}
	}

	return query;
}

async function readUsageRecords(usageStore: UsageStore): Promise<UsageRecord[]> {
	if (!usageStore.getUsageRecords) {
		throw new Error("Configured usage store does not support reads.");
	}

	return usageStore.getUsageRecords();
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function getStringList(searchParams: URLSearchParams, name: string): string[] {
	return searchParams
		.getAll(name)
		.flatMap((value) => value.split(","))
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function getFirstString(searchParams: URLSearchParams, names: string[]): string | undefined {
	for (const name of names) {
		const value = getStringList(searchParams, name)[0];
		if (value) {
			return value;
		}
	}

	return undefined;
}

function assignFirstString<Key extends keyof UsageRecordQuery>(
	query: UsageRecordQuery,
	key: Key,
	searchParams: URLSearchParams,
	names: string[],
): void {
	const value = getFirstString(searchParams, names);
	if (value) {
		query[key] = value as UsageRecordQuery[Key];
	}
}

function parseLimit(value: string | undefined, defaultLimit: number | undefined, maxLimit: number): number | undefined {
	if (!value) {
		return defaultLimit;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed)) {
		return defaultLimit;
	}

	return Math.min(Math.max(parsed, 0), maxLimit);
}

function isUsageRecordStatus(value: string): value is UsageRecordStatus {
	return USAGE_RECORD_STATUSES.has(value as UsageRecordStatus);
}

function isRoutingMode(value: string): value is UsageRecord["routingMode"] {
	return ROUTING_MODES.has(value as UsageRecord["routingMode"]);
}
