import type { Api, Model } from "@pie-lab/ai";
import type { AuthStatus } from "@pie-lab/coding-agent/auth-storage";
import type { ModelRegistry } from "@pie-lab/coding-agent/model-registry";
import type { ProviderConnection, ProviderConnectionStore } from "@pie-lab/storage";
import { MODEL_LOCK_PREFIX } from "@pie-lab/router";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface ProviderStatusApiOptions {
	modelRegistry: ModelRegistry;
	providerConnectionStore?: ProviderConnectionStore;
	fetch?: typeof fetch;
	now?: () => Date;
}

export interface ProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	authSource?: AuthStatus["source"];
	authLabel?: string;
	models: number;
	availableModels: number;
	connectionCount: number;
	activeConnectionCount: number;
	errorConnectionCount: number;
	cooldownLockCount: number;
	quotaAvailableCount: number;
	quotaDepletedCount: number;
	health: "healthy" | "degraded" | "cooldown" | "missing";
	healthReason: string;
}

export type ProviderProbeCheckStatus = "pass" | "warn" | "fail" | "skip";

export interface ProviderProbeCheck {
	name: string;
	status: ProviderProbeCheckStatus;
	message: string;
}

export interface ProviderConnectionProbe {
	id: string;
	name?: string | null;
	authType: string;
	isActive: boolean;
	status: "healthy" | "warning" | "blocked" | "missing";
	checks: ProviderProbeCheck[];
}

export interface ProviderProbe {
	id: string;
	name: string;
	status: "healthy" | "warning" | "blocked" | "missing";
	checkedAt: string;
	checks: ProviderProbeCheck[];
	connections: ProviderConnectionProbe[];
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-origin": "*",
};

const LIVE_PROBE_TARGETS: Record<string, { url: string; authHeader: "bearer" | "x-api-key" | "xi-api-key" }> = {
	openai: { url: "https://api.openai.com/v1/models", authHeader: "bearer" },
	openrouter: { url: "https://openrouter.ai/api/v1/models", authHeader: "bearer" },
	groq: { url: "https://api.groq.com/openai/v1/models", authHeader: "bearer" },
	mistral: { url: "https://api.mistral.ai/v1/models", authHeader: "bearer" },
	xai: { url: "https://api.x.ai/v1/models", authHeader: "bearer" },
	cohere: { url: "https://api.cohere.com/v1/models", authHeader: "bearer" },
	elevenlabs: { url: "https://api.elevenlabs.io/v1/models", authHeader: "xi-api-key" },
};

export function createProviderStatusRequestHandler(options: ProviderStatusApiOptions) {
	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleProviderStatusRequest(request, response, options);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleProviderStatusRequest(
	request: IncomingMessage,
	response: ServerResponse,
	optionsOrModelRegistry: ProviderStatusApiOptions | ModelRegistry,
	legacyProviderConnectionStore?: ProviderConnectionStore,
): Promise<void> {
	const options = isProviderStatusOptions(optionsOrModelRegistry)
		? optionsOrModelRegistry
		: { modelRegistry: optionsOrModelRegistry, providerConnectionStore: legacyProviderConnectionStore };
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (url.pathname === "/providers/probe" || url.pathname === "/v1/providers/probe") {
		if (request.method !== "GET") {
			writeJson(response, 405, {
				error: {
					message: "Only GET and OPTIONS requests are supported.",
				},
			});
			return;
		}
		const live = url.searchParams.get("live") === "true";
		const data = await createProviderProbeResponse(options.modelRegistry, options.providerConnectionStore, {
			live,
			fetchImpl: options.fetch ?? fetch,
			now: options.now?.() ?? new Date(),
		});
		writeJson(response, 200, { count: data.length, data });
		return;
	}

	if (url.pathname !== "/providers" && url.pathname !== "/v1/providers") {
		writeJson(response, 404, {
			error: {
				message: "Not found",
				path: url.pathname,
			},
		});
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

	const data = await createProviderStatusResponse(options.modelRegistry, options.providerConnectionStore);
	writeJson(response, 200, {
		count: data.length,
		data,
	});
}

function isProviderStatusOptions(value: ProviderStatusApiOptions | ModelRegistry): value is ProviderStatusApiOptions {
	return "modelRegistry" in (value as ProviderStatusApiOptions);
}

export function createProviderStatusResponse(
	modelRegistry: ModelRegistry,
	providerConnectionStore?: ProviderConnectionStore,
): ProviderStatus[] | Promise<ProviderStatus[]> {
	const models = modelRegistry.getAll() as Model<Api>[];
	const availableModels = modelRegistry.getAvailable() as Model<Api>[];
	const providerMap = new Map<string, { models: number; availableModels: number }>();

	for (const model of models) {
		const provider = providerMap.get(model.provider) ?? { models: 0, availableModels: 0 };
		provider.models += 1;
		providerMap.set(model.provider, provider);
	}

	for (const model of availableModels) {
		const provider = providerMap.get(model.provider) ?? { models: 0, availableModels: 0 };
		provider.availableModels += 1;
		providerMap.set(model.provider, provider);
	}

	if (!providerConnectionStore) {
		return buildProviderStatusResponse(modelRegistry, providerMap, []);
	}

	return providerConnectionStore
		.getProviderConnections()
		.then((connections) => buildProviderStatusResponse(modelRegistry, providerMap, connections));
}

export async function createProviderProbeResponse(
	modelRegistry: ModelRegistry,
	providerConnectionStore?: ProviderConnectionStore,
	options: { live?: boolean; fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<ProviderProbe[]> {
	const checkedAt = (options.now ?? new Date()).toISOString();
	const statuses = await createProviderStatusResponse(modelRegistry, providerConnectionStore);
	const connections = providerConnectionStore ? await providerConnectionStore.getProviderConnections() : [];
	const connectionsByProvider = new Map<string, ProviderConnection[]>();
	for (const connection of connections) {
		const list = connectionsByProvider.get(connection.provider) ?? [];
		list.push(connection);
		connectionsByProvider.set(connection.provider, list);
	}

	const probes: ProviderProbe[] = [];
	for (const status of statuses) {
		const providerConnections = connectionsByProvider.get(status.id) ?? [];
		const connectionProbes = await Promise.all(
			providerConnections.map((connection) =>
				createConnectionProbe(connection, {
					live: options.live === true,
					fetchImpl: options.fetchImpl ?? fetch,
					now: options.now ?? new Date(),
				}),
			),
		);
		const checks = createProviderProbeChecks(status, providerConnections);
		probes.push({
			id: status.id,
			name: status.name,
			status: aggregateProbeStatus([...checks, ...connectionProbes.flatMap((probe) => probe.checks)]),
			checkedAt,
			checks,
			connections: connectionProbes,
		});
	}

	return probes.sort((left, right) => probeStatusRank(left.status) - probeStatusRank(right.status) || left.name.localeCompare(right.name));
}

function createProviderProbeChecks(status: ProviderStatus, connections: ProviderConnection[]): ProviderProbeCheck[] {
	return [
		{
			name: "auth",
			status: status.configured || status.activeConnectionCount > 0 ? "pass" : "fail",
			message: status.configured || status.activeConnectionCount > 0 ? "인증 설정 있음" : "인증 설정 없음",
		},
		{
			name: "connections",
			status: status.activeConnectionCount > 0 ? "pass" : connections.length > 0 ? "warn" : "fail",
			message:
				status.activeConnectionCount > 0
					? `${status.activeConnectionCount}개 활성 connection`
					: connections.length > 0
						? "connection은 있지만 활성 connection 없음"
						: "등록된 provider connection 없음",
		},
		{
			name: "cooldown",
			status: status.cooldownLockCount > 0 ? "warn" : "pass",
			message: status.cooldownLockCount > 0 ? `${status.cooldownLockCount}개 model cooldown` : "활성 cooldown 없음",
		},
		{
			name: "quota",
			status: status.quotaDepletedCount > 0 ? "warn" : status.quotaAvailableCount > 0 ? "pass" : "skip",
			message:
				status.quotaDepletedCount > 0
					? `${status.quotaDepletedCount}개 connection quota 소진`
					: status.quotaAvailableCount > 0
						? `${status.quotaAvailableCount}개 connection quota 사용 가능`
						: "저장된 quota snapshot 없음",
		},
	];
}

async function createConnectionProbe(
	connection: ProviderConnection,
	options: { live: boolean; fetchImpl: typeof fetch; now: Date },
): Promise<ProviderConnectionProbe> {
	const checks: ProviderProbeCheck[] = [
		{
			name: "active",
			status: connection.isActive ? "pass" : "fail",
			message: connection.isActive ? "활성화됨" : "비활성 connection",
		},
		{
			name: "credential",
			status: hasCredential(connection) ? "pass" : "fail",
			message: hasCredential(connection) ? `${connection.authType} credential 있음` : "credential 없음",
		},
	];

	const activeLocks = countActiveLockKeys(connection);
	checks.push({
		name: "cooldown",
		status: activeLocks > 0 ? "warn" : "pass",
		message: activeLocks > 0 ? `${activeLocks}개 활성 model lock` : "활성 model lock 없음",
	});

	const quotaStatus = readQuotaStatus(connection);
	checks.push({
		name: "quota",
		status: quotaStatus === "depleted" || quotaStatus === "error" ? "warn" : quotaStatus === "available" ? "pass" : "skip",
		message: quotaStatus ? `quota ${quotaStatus}` : "quota snapshot 없음",
	});

	if (options.live) {
		checks.push(await runLiveConnectionProbe(connection, options.fetchImpl));
	}

	return {
		id: connection.id,
		name: connection.name ?? connection.displayName ?? connection.email ?? null,
		authType: connection.authType,
		isActive: connection.isActive,
		status: aggregateProbeStatus(checks),
		checks,
	};
}

async function runLiveConnectionProbe(connection: ProviderConnection, fetchImpl: typeof fetch): Promise<ProviderProbeCheck> {
	const target = LIVE_PROBE_TARGETS[connection.provider];
	if (!target) {
		return { name: "live", status: "skip", message: "live probe 미지원 provider" };
	}
	if (!hasLiveCredential(connection)) {
		return { name: "live", status: "fail", message: "live probe를 위한 credential 없음" };
	}

	try {
		const response = await fetchWithTimeout(fetchImpl, target.url, {
			method: "GET",
			headers: buildLiveProbeHeaders(connection, target.authHeader),
		});
		return {
			name: "live",
			status: response.ok ? "pass" : "warn",
			message: response.ok ? `live probe OK (${response.status})` : `live probe 실패 (${response.status})`,
		};
	} catch (error) {
		return {
			name: "live",
			status: "warn",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function buildProviderStatusResponse(
	modelRegistry: ModelRegistry,
	providerMap: Map<string, { models: number; availableModels: number }>,
	connections: ProviderConnection[],
): ProviderStatus[] {
	const connectionMap = summarizeConnections(connections);
	return [...providerMap.entries()]
		.map(([provider, counts]) => {
			const authStatus = modelRegistry.getProviderAuthStatus(provider);
			const connectionSummary = connectionMap.get(provider) ?? createEmptyConnectionSummary();
			const health = resolveProviderHealth(authStatus.configured, connectionSummary);
			return {
				id: provider,
				name: modelRegistry.getProviderDisplayName(provider),
				configured: authStatus.configured,
				authSource: authStatus.source,
				authLabel: authStatus.label,
				models: counts.models,
				availableModels: counts.availableModels,
				...connectionSummary,
				...health,
			};
		})
		.sort((left, right) => Number(right.configured) - Number(left.configured) || left.name.localeCompare(right.name));
}

interface ProviderConnectionSummaryStats {
	connectionCount: number;
	activeConnectionCount: number;
	errorConnectionCount: number;
	cooldownLockCount: number;
	quotaAvailableCount: number;
	quotaDepletedCount: number;
}

function summarizeConnections(connections: ProviderConnection[]): Map<string, ProviderConnectionSummaryStats> {
	const map = new Map<string, ProviderConnectionSummaryStats>();
	for (const connection of connections) {
		const summary = map.get(connection.provider) ?? createEmptyConnectionSummary();
		summary.connectionCount += 1;
		if (connection.isActive) summary.activeConnectionCount += 1;
		if (connection.testStatus === "unavailable" || connection.errorCode || connection.lastError) {
			summary.errorConnectionCount += 1;
		}
		summary.cooldownLockCount += countActiveLockKeys(connection);
		const quotaStatus = readQuotaStatus(connection);
		if (quotaStatus === "available") summary.quotaAvailableCount += 1;
		if (quotaStatus === "depleted") summary.quotaDepletedCount += 1;
		map.set(connection.provider, summary);
	}
	return map;
}

function createEmptyConnectionSummary(): ProviderConnectionSummaryStats {
	return {
		connectionCount: 0,
		activeConnectionCount: 0,
		errorConnectionCount: 0,
		cooldownLockCount: 0,
		quotaAvailableCount: 0,
		quotaDepletedCount: 0,
	};
}

function resolveProviderHealth(
	configured: boolean,
	summary: ProviderConnectionSummaryStats,
): Pick<ProviderStatus, "health" | "healthReason"> {
	if (!configured && summary.activeConnectionCount === 0) {
		return { health: "missing", healthReason: "인증 또는 활성 connection 없음" };
	}
	if (summary.activeConnectionCount === 0) {
		return { health: "missing", healthReason: "활성 connection 없음" };
	}
	if (summary.cooldownLockCount > 0) {
		return { health: "cooldown", healthReason: `${summary.cooldownLockCount}개 model cooldown` };
	}
	if (summary.errorConnectionCount > 0 || summary.quotaDepletedCount > 0) {
		return {
			health: "degraded",
			healthReason: `${summary.errorConnectionCount}개 오류 · ${summary.quotaDepletedCount}개 quota 소진`,
		};
	}
	return { health: "healthy", healthReason: "사용 가능" };
}

function countActiveLockKeys(connection: ProviderConnection): number {
	const now = Date.now();
	return Object.entries(connection).filter(([key, value]) => {
		if (!key.startsWith(MODEL_LOCK_PREFIX) || typeof value !== "string") return false;
		const timestamp = Date.parse(value);
		return Number.isFinite(timestamp) && timestamp > now;
	}).length;
}

function readQuotaStatus(connection: ProviderConnection): string | null {
	const data = connection.providerSpecificData;
	if (!data) return null;
	for (const value of Object.values(data)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const status = (value as { status?: unknown }).status;
		if (typeof status === "string" && ["available", "depleted", "error", "unknown"].includes(status)) return status;
	}
	return null;
}

function hasCredential(connection: ProviderConnection): boolean {
	return Boolean(connection.apiKey || connection.accessToken || connection.refreshToken);
}

function hasLiveCredential(connection: ProviderConnection): boolean {
	return Boolean(connection.apiKey || connection.accessToken);
}

function aggregateProbeStatus(checks: ProviderProbeCheck[]): ProviderProbe["status"] {
	if (checks.some((check) => check.status === "fail")) return "blocked";
	if (checks.some((check) => check.status === "warn")) return "warning";
	if (checks.some((check) => check.status === "pass")) return "healthy";
	return "missing";
}

function probeStatusRank(status: ProviderProbe["status"]): number {
	if (status === "blocked") return 0;
	if (status === "warning") return 1;
	if (status === "missing") return 2;
	return 3;
}

function buildLiveProbeHeaders(
	connection: ProviderConnection,
	authHeader: "bearer" | "x-api-key" | "xi-api-key",
): Record<string, string> {
	const token = connection.apiKey || connection.accessToken || "";
	if (authHeader === "bearer") return { authorization: `Bearer ${token}` };
	if (authHeader === "x-api-key") return { "x-api-key": token };
	return { "xi-api-key": token };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 5000);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
