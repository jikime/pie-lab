import {
	createJsonProviderConnectionStore,
	type CreateProxyPoolInput,
	type ProviderConnection,
	type ProviderConnectionStore,
	type ProxyPool,
	type ProxyPoolFilter,
	type UpdateProxyPoolInput,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.js";

export interface ProxyPoolApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	proxyPoolTester?: ProxyPoolTester;
}

export interface ProxyPoolSummary extends ProxyPool {
	boundConnectionCount?: number;
}

export interface ProviderConnectionProxyStatus {
	id: string;
	provider: string;
	authType: string;
	name?: string | null;
	displayName?: string | null;
	email?: string | null;
	isActive: boolean;
	proxyPoolId?: string | null;
	updatedAt: string;
}

export interface ProxyPoolTestResult {
	ok: boolean;
	status: number;
	statusText?: string;
	url?: string;
	elapsedMs?: number;
	error?: string;
}

export type ProxyPoolTester = (proxyPool: ProxyPool) => Promise<ProxyPoolTestResult>;

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_PROXY_TEST_URL = "https://google.com/";
const DEFAULT_PROXY_TEST_TIMEOUT_MS = 8000;
const DEFAULT_RELAY_TEST_TIMEOUT_MS = 10000;

export function createProxyPoolRequestHandler(options: ProxyPoolApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const proxyPoolTester = options.proxyPoolTester ?? testProxyPool;

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleProxyPoolRequest(request, response, providerConnectionStore, proxyPoolTester);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleProxyPoolRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	proxyPoolTester: ProxyPoolTester = testProxyPool,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	const proxyPoolTestId = parseProxyPoolTestId(url.pathname);
	const proxyPoolId = parseProxyPoolId(url.pathname);
	const providerConnectionId = parseProviderConnectionId(url.pathname);

	if (isProxyPoolListPath(url.pathname)) {
		await handleProxyPoolListRequest(request, response, providerConnectionStore, url);
		return;
	}

	if (proxyPoolTestId) {
		await handleProxyPoolTestRequest(
			request,
			response,
			providerConnectionStore,
			proxyPoolTestId,
			proxyPoolTester,
		);
		return;
	}

	if (proxyPoolId) {
		await handleProxyPoolDetailRequest(request, response, providerConnectionStore, proxyPoolId);
		return;
	}

	if (providerConnectionId) {
		await handleProviderConnectionProxyRequest(request, response, providerConnectionStore, providerConnectionId);
		return;
	}

	writeJson(response, 404, {
		error: {
			message: "Not found",
			path: url.pathname,
		},
	});
}

async function handleProxyPoolListRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	url: URL,
): Promise<void> {
	if (request.method === "GET") {
		const filter: ProxyPoolFilter = {};
		const isActive = parseBoolean(url.searchParams.get("isActive"));
		if (isActive !== undefined) filter.isActive = isActive;
		const testStatus = normalizeString(url.searchParams.get("testStatus"));
		if (testStatus) filter.testStatus = testStatus;

		const proxyPools = await providerConnectionStore.getProxyPools(filter);
		const includeUsage = url.searchParams.get("includeUsage") === "true";
		const data = includeUsage
			? await attachBoundConnectionCounts(providerConnectionStore, proxyPools)
			: proxyPools;

		writeJson(response, 200, {
			count: data.length,
			proxyPools: data,
		});
		return;
	}

	if (request.method === "POST") {
		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;

		const normalized = normalizeProxyPoolInput(body);
		if ("error" in normalized) {
			writeJson(response, 400, { error: normalized.error });
			return;
		}

		const proxyPool = await providerConnectionStore.createProxyPool(normalized);
		writeJson(response, 201, { proxyPool });
		return;
	}

	writeMethodNotAllowed(response, "GET, POST, OPTIONS");
}

async function handleProxyPoolDetailRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	proxyPoolId: string,
): Promise<void> {
	if (request.method === "GET") {
		const proxyPool = await providerConnectionStore.getProxyPoolById(proxyPoolId);
		if (!proxyPool) {
			writeJson(response, 404, { error: "Proxy pool not found" });
			return;
		}

		writeJson(response, 200, { proxyPool });
		return;
	}

	if (request.method === "PUT") {
		const existing = await providerConnectionStore.getProxyPoolById(proxyPoolId);
		if (!existing) {
			writeJson(response, 404, { error: "Proxy pool not found" });
			return;
		}

		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;

		const normalized = normalizeProxyPoolUpdate(body);
		if ("error" in normalized) {
			writeJson(response, 400, { error: normalized.error });
			return;
		}

		const proxyPool = await providerConnectionStore.updateProxyPool(proxyPoolId, normalized.updates);
		writeJson(response, 200, { proxyPool });
		return;
	}

	if (request.method === "DELETE") {
		const existing = await providerConnectionStore.getProxyPoolById(proxyPoolId);
		if (!existing) {
			writeJson(response, 404, { error: "Proxy pool not found" });
			return;
		}

		const boundConnectionCount = await countBoundConnections(providerConnectionStore, proxyPoolId);
		if (boundConnectionCount > 0) {
			writeJson(response, 409, {
				error: "Proxy pool is currently in use",
				boundConnectionCount,
			});
			return;
		}

		await providerConnectionStore.deleteProxyPool(proxyPoolId);
		writeJson(response, 200, { success: true });
		return;
	}

	writeMethodNotAllowed(response, "GET, PUT, DELETE, OPTIONS");
}

async function handleProxyPoolTestRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	proxyPoolId: string,
	proxyPoolTester: ProxyPoolTester,
): Promise<void> {
	if (request.method !== "POST") {
		writeMethodNotAllowed(response, "POST, OPTIONS");
		return;
	}

	const proxyPool = await providerConnectionStore.getProxyPoolById(proxyPoolId);
	if (!proxyPool) {
		writeJson(response, 404, { error: "Proxy pool not found" });
		return;
	}

	const result = await proxyPoolTester(proxyPool);
	const now = new Date().toISOString();
	const lastError = result.ok ? null : (result.error ?? `Proxy test failed with status ${result.status}`);
	const updatedProxyPool = await providerConnectionStore.updateProxyPool(proxyPoolId, {
		testStatus: result.ok ? "active" : "error",
		lastTestedAt: now,
		lastError,
		isActive: result.ok,
	});

	writeJson(response, 200, {
		ok: result.ok,
		status: result.status,
		statusText: result.statusText ?? null,
		error: result.error ?? null,
		elapsedMs: result.elapsedMs ?? 0,
		testedAt: now,
		proxyPool: updatedProxyPool,
	});
}

async function handleProviderConnectionProxyRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	connectionId: string,
): Promise<void> {
	if (request.method !== "PUT") {
		writeMethodNotAllowed(response, "PUT, OPTIONS");
		return;
	}

	const connection = await providerConnectionStore.getProviderConnectionById(connectionId);
	if (!connection) {
		writeJson(response, 404, { error: "Connection not found" });
		return;
	}

	const body = await readBodyOrWriteBadRequest(request, response);
	if (!body) return;

	const normalized = await normalizeProxyPoolAssignment(providerConnectionStore, body);
	if ("error" in normalized) {
		writeJson(response, 400, { error: normalized.error });
		return;
	}

	const providerSpecificData = { ...(connection.providerSpecificData ?? {}) };
	if (normalized.proxyPoolId) {
		providerSpecificData.proxyPoolId = normalized.proxyPoolId;
	} else {
		delete providerSpecificData.proxyPoolId;
	}

	const updated = await providerConnectionStore.updateProviderConnection(connectionId, { providerSpecificData });
	writeJson(response, 200, {
		connection: updated ? toProviderConnectionProxyStatus(updated) : null,
	});
}

function normalizeProxyPoolInput(body: Record<string, unknown>): CreateProxyPoolInput | { error: string } {
	const name = normalizeString(body.name);
	const proxyUrl = normalizeString(body.proxyUrl);
	if (!name) return { error: "Name is required" };
	if (!proxyUrl) return { error: "Proxy URL is required" };

	return {
		name,
		proxyUrl,
		noProxy: normalizeString(body.noProxy),
		isActive: body.isActive === undefined ? true : body.isActive === true,
		strictProxy: body.strictProxy === true,
		type: body.type === "vercel" ? "vercel" : "http",
	};
}

function normalizeProxyPoolUpdate(body: Record<string, unknown>): { updates: UpdateProxyPoolInput } | { error: string } {
	const updates: UpdateProxyPoolInput = {};

	if (Object.hasOwn(body, "name")) {
		const name = normalizeString(body.name);
		if (!name) return { error: "Name is required" };
		updates.name = name;
	}

	if (Object.hasOwn(body, "proxyUrl")) {
		const proxyUrl = normalizeString(body.proxyUrl);
		if (!proxyUrl) return { error: "Proxy URL is required" };
		updates.proxyUrl = proxyUrl;
	}

	if (Object.hasOwn(body, "noProxy")) updates.noProxy = normalizeString(body.noProxy);
	if (Object.hasOwn(body, "isActive")) updates.isActive = body.isActive === true;
	if (Object.hasOwn(body, "strictProxy")) updates.strictProxy = body.strictProxy === true;
	if (Object.hasOwn(body, "type")) updates.type = body.type === "vercel" ? "vercel" : "http";
	if (Object.hasOwn(body, "testStatus")) updates.testStatus = normalizeString(body.testStatus) || "unknown";
	if (Object.hasOwn(body, "lastTestedAt")) updates.lastTestedAt = normalizeString(body.lastTestedAt) || null;
	if (Object.hasOwn(body, "lastError")) updates.lastError = body.lastError ?? null;

	return { updates };
}

async function normalizeProxyPoolAssignment(
	providerConnectionStore: ProviderConnectionStore,
	body: Record<string, unknown>,
): Promise<{ proxyPoolId: string | null } | { error: string }> {
	if (!Object.hasOwn(body, "proxyPoolId")) {
		return { error: "proxyPoolId is required" };
	}

	const proxyPoolIdRaw = body.proxyPoolId;
	if (proxyPoolIdRaw === null || proxyPoolIdRaw === undefined) {
		return { proxyPoolId: null };
	}

	const proxyPoolId = normalizeString(proxyPoolIdRaw);
	if (!proxyPoolId || proxyPoolId === "__none__") {
		return { proxyPoolId: null };
	}

	const proxyPool = await providerConnectionStore.getProxyPoolById(proxyPoolId);
	if (!proxyPool) {
		return { error: "Proxy pool not found" };
	}

	return { proxyPoolId };
}

async function attachBoundConnectionCounts(
	providerConnectionStore: ProviderConnectionStore,
	proxyPools: ProxyPool[],
): Promise<ProxyPoolSummary[]> {
	const connections = await providerConnectionStore.getProviderConnections();
	const usageMap = buildUsageMap(connections);

	return proxyPools.map((proxyPool) => ({
		...proxyPool,
		boundConnectionCount: usageMap.get(proxyPool.id) ?? 0,
	}));
}

async function countBoundConnections(
	providerConnectionStore: ProviderConnectionStore,
	proxyPoolId: string,
): Promise<number> {
	const connections = await providerConnectionStore.getProviderConnections();
	return connections.filter((connection) => getConnectionProxyPoolId(connection) === proxyPoolId).length;
}

function buildUsageMap(connections: ProviderConnection[]): Map<string, number> {
	const usageMap = new Map<string, number>();
	for (const connection of connections) {
		const proxyPoolId = getConnectionProxyPoolId(connection);
		if (!proxyPoolId) continue;
		usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) ?? 0) + 1);
	}
	return usageMap;
}

function toProviderConnectionProxyStatus(connection: ProviderConnection): ProviderConnectionProxyStatus {
	return {
		id: connection.id,
		provider: connection.provider,
		authType: connection.authType,
		name: connection.name,
		displayName: connection.displayName,
		email: connection.email,
		isActive: connection.isActive,
		proxyPoolId: getConnectionProxyPoolId(connection),
		updatedAt: connection.updatedAt,
	};
}

function getConnectionProxyPoolId(connection: ProviderConnection): string | null {
	const proxyPoolId = normalizeString(connection.providerSpecificData?.proxyPoolId);
	return proxyPoolId && proxyPoolId !== "__none__" ? proxyPoolId : null;
}

function isProxyPoolListPath(pathname: string): boolean {
	return pathname === "/proxy-pools" || pathname === "/v1/proxy-pools";
}

function parseProxyPoolId(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?proxy-pools\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

function parseProxyPoolTestId(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?proxy-pools\/([^/]+)\/test$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

function parseProviderConnectionId(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?provider-connections\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

export async function testProxyPool(proxyPool: ProxyPool): Promise<ProxyPoolTestResult> {
	if (proxyPool.type === "vercel") {
		return testVercelRelay(proxyPool.proxyUrl);
	}

	return testProxyUrl({ proxyUrl: proxyPool.proxyUrl });
}

async function testVercelRelay(relayUrl: string, timeoutMs = DEFAULT_RELAY_TEST_TIMEOUT_MS): Promise<ProxyPoolTestResult> {
	const controller = new AbortController();
	const startedAt = Date.now();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await undiciFetch(relayUrl, {
			method: "GET",
			headers: {
				"x-relay-target": "https://httpbin.org",
				"x-relay-path": "/get",
			},
			signal: controller.signal,
		});
		return {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
			elapsedMs: Date.now() - startedAt,
		};
	} catch (error) {
		return {
			ok: false,
			status: 500,
			error: error instanceof Error && error.name === "AbortError" ? "Relay test timed out" : formatProxyTestError(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

async function testProxyUrl(options: {
	proxyUrl?: string;
	testUrl?: string;
	timeoutMs?: number;
} = {}): Promise<ProxyPoolTestResult> {
	const proxyUrl = normalizeString(options.proxyUrl);
	if (!proxyUrl) {
		return { ok: false, status: 400, error: "proxyUrl is required" };
	}

	const testUrl = normalizeString(options.testUrl) || DEFAULT_PROXY_TEST_URL;
	const timeoutMs = normalizeTimeoutMs(options.timeoutMs, DEFAULT_PROXY_TEST_TIMEOUT_MS);
	let dispatcher: ProxyAgent | undefined;

	try {
		try {
			dispatcher = new ProxyAgent({ uri: proxyUrl });
		} catch (error) {
			return {
				ok: false,
				status: 400,
				error: `Invalid proxy URL: ${formatProxyTestError(error)}`,
			};
		}

		const controller = new AbortController();
		const startedAt = Date.now();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await undiciFetch(testUrl, {
				method: "HEAD",
				dispatcher,
				signal: controller.signal,
				headers: {
					"User-Agent": "9Router",
				},
			});

			return {
				ok: response.ok,
				status: response.status,
				statusText: response.statusText,
				url: testUrl,
				elapsedMs: Date.now() - startedAt,
			};
		} catch (error) {
			return {
				ok: false,
				status: 500,
				error: error instanceof Error && error.name === "AbortError" ? "Proxy test timed out" : formatProxyTestError(error),
			};
		} finally {
			clearTimeout(timer);
		}
	} finally {
		await dispatcher?.close?.();
	}
}

function normalizeTimeoutMs(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 30000) : fallback;
}

function formatProxyTestError(error: unknown): string {
	if (!error) return "Unknown error";
	if (!(error instanceof Error)) return String(error);

	const base = error.message || String(error);
	const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
	const causeCode = typeof cause?.code === "string" ? cause.code : undefined;
	const causeMessage = typeof cause?.message === "string" ? cause.message : undefined;

	if (causeMessage && causeMessage !== base) {
		return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
	}

	if (causeCode && !base.includes(causeCode)) {
		return `${base} (${causeCode})`;
	}

	return base;
}

function parseBoolean(value: string | null): boolean | undefined {
	if (value === "true") return true;
	if (value === "false") return false;
	return undefined;
}

function normalizeString(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).trim();
}

async function readBodyOrWriteBadRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<Record<string, unknown> | null> {
	try {
		return await readJsonBody(request);
	} catch (error) {
		writeJson(response, 400, {
			error: error instanceof Error ? error.message : "Invalid JSON body.",
		});
		return null;
	}
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	let content = "";
	for await (const chunk of request) {
		content += chunk;
	}

	if (!content.trim()) return {};

	const body = JSON.parse(content) as unknown;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("JSON body must be an object.");
	}

	return body as Record<string, unknown>;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function writeMethodNotAllowed(response: ServerResponse, allow: string): void {
	response.writeHead(405, {
		...CORS_HEADERS,
		allow,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify({ error: { message: `Only ${allow} requests are supported.` } })}\n`);
}
