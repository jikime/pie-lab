import {
	createJsonProviderConnectionStore,
	type CreateProviderConnectionInput,
	type ProviderConnection,
	type ProviderConnectionStore,
	type UpdateProviderConnectionInput,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.ts";

export interface ProviderConnectionsApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
}

export interface ProviderConnectionSummary {
	id: string;
	provider: string;
	authType: string;
	name?: string | null;
	displayName?: string | null;
	email?: string | null;
	priority?: number | null;
	isActive: boolean;
	hasApiKey: boolean;
	hasAccessToken: boolean;
	hasRefreshToken: boolean;
	projectId?: string | null;
	providerSpecificData?: Record<string, unknown> | null;
	lastUsedAt?: string | null;
	consecutiveUseCount?: number | null;
	testStatus?: string | null;
	lastError?: unknown;
	lastErrorAt?: string | null;
	errorCode?: string | number | null;
	backoffLevel?: number | null;
	createdAt: string;
	updatedAt: string;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createProviderConnectionsRequestHandler(options: ProviderConnectionsApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleProviderConnectionsRequest(request, response, providerConnectionStore);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleProviderConnectionsRequest(
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
	if (isProviderConnectionListPath(url.pathname)) {
		await handleProviderConnectionListRequest(request, response, providerConnectionStore, url);
		return;
	}

	const connectionId = parseProviderConnectionId(url.pathname);
	if (connectionId) {
		await handleProviderConnectionDetailRequest(request, response, providerConnectionStore, connectionId);
		return;
	}

	writeJson(response, 404, {
		error: {
			message: "Not found",
			path: url.pathname,
		},
	});
}

async function handleProviderConnectionListRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	url: URL,
): Promise<void> {
	if (request.method === "GET") {
		const provider = normalizeString(url.searchParams.get("provider"));
		const connections = await providerConnectionStore.getProviderConnections(provider ? { provider } : {});
		writeJson(response, 200, {
			count: connections.length,
			connections: connections.map(toProviderConnectionSummary),
		});
		return;
	}

	if (request.method === "POST") {
		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;

		const input = normalizeProviderConnectionInput(body);
		if ("error" in input) {
			writeJson(response, 400, { error: input.error });
			return;
		}

		const connection = await providerConnectionStore.createProviderConnection(input);
		writeJson(response, 201, {
			connection: toProviderConnectionSummary(connection),
		});
		return;
	}

	writeMethodNotAllowed(response, "GET, POST, OPTIONS");
}

async function handleProviderConnectionDetailRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	connectionId: string,
): Promise<void> {
	const connection = await providerConnectionStore.getProviderConnectionById(connectionId);
	if (!connection) {
		writeJson(response, 404, { error: "Connection not found" });
		return;
	}

	if (request.method === "GET") {
		writeJson(response, 200, { connection: toProviderConnectionSummary(connection) });
		return;
	}

	if (request.method === "PUT") {
		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;

		const input = await normalizeProviderConnectionUpdate(providerConnectionStore, connection, body);
		if ("error" in input) {
			writeJson(response, 400, { error: input.error });
			return;
		}

		const updated = await providerConnectionStore.updateProviderConnection(connectionId, input);
		writeJson(response, 200, {
			connection: updated ? toProviderConnectionSummary(updated) : null,
		});
		return;
	}

	if (request.method === "DELETE") {
		const hardDelete = new URL(request.url ?? "/", "http://localhost").searchParams.get("hard") === "true";
		if (hardDelete) {
			await providerConnectionStore.deleteProviderConnection(connectionId);
			writeJson(response, 200, { success: true, deleted: true });
			return;
		}

		const updated = await providerConnectionStore.updateProviderConnection(connectionId, {
			isActive: false,
			apiKey: null,
			accessToken: null,
			refreshToken: null,
			testStatus: "inactive",
			lastError: null,
			errorCode: null,
			lastErrorAt: null,
		});
		writeJson(response, 200, {
			success: true,
			deleted: false,
			connection: updated ? toProviderConnectionSummary(updated) : null,
		});
		return;
	}

	writeMethodNotAllowed(response, "GET, PUT, DELETE, OPTIONS");
}

function normalizeProviderConnectionInput(
	body: Record<string, unknown>,
): CreateProviderConnectionInput | { error: string } {
	const provider = normalizeString(body.provider);
	if (!provider) return { error: "provider is required" };

	return {
		provider,
		authType: normalizeString(body.authType) || "apikey",
		name: normalizeNullableString(body.name),
		displayName: normalizeNullableString(body.displayName),
		email: normalizeNullableString(body.email),
		priority: normalizeOptionalNumber(body.priority),
		isActive: body.isActive === undefined ? true : body.isActive === true,
		apiKey: normalizeNullableSecret(body.apiKey),
		accessToken: normalizeNullableSecret(body.accessToken),
		refreshToken: normalizeNullableSecret(body.refreshToken),
		projectId: normalizeNullableString(body.projectId),
		providerSpecificData: normalizeProviderSpecificData(body.providerSpecificData),
		testStatus: "unknown",
	};
}

async function normalizeProviderConnectionUpdate(
	providerConnectionStore: ProviderConnectionStore,
	connection: ProviderConnection,
	body: Record<string, unknown>,
): Promise<UpdateProviderConnectionInput | { error: string }> {
	const updates: UpdateProviderConnectionInput = {};
	if (Object.hasOwn(body, "provider")) {
		const provider = normalizeString(body.provider);
		if (!provider) return { error: "provider cannot be empty" };
		updates.provider = provider;
	}
	if (Object.hasOwn(body, "authType")) updates.authType = normalizeString(body.authType) || connection.authType;
	if (Object.hasOwn(body, "name")) updates.name = normalizeNullableString(body.name);
	if (Object.hasOwn(body, "displayName")) updates.displayName = normalizeNullableString(body.displayName);
	if (Object.hasOwn(body, "email")) updates.email = normalizeNullableString(body.email);
	if (Object.hasOwn(body, "priority")) updates.priority = normalizeOptionalNumber(body.priority);
	if (Object.hasOwn(body, "isActive")) updates.isActive = body.isActive === true;
	if (Object.hasOwn(body, "apiKey")) updates.apiKey = normalizeNullableSecret(body.apiKey);
	if (Object.hasOwn(body, "accessToken")) updates.accessToken = normalizeNullableSecret(body.accessToken);
	if (Object.hasOwn(body, "refreshToken")) updates.refreshToken = normalizeNullableSecret(body.refreshToken);
	if (Object.hasOwn(body, "projectId")) updates.projectId = normalizeNullableString(body.projectId);
	if (Object.hasOwn(body, "providerSpecificData")) {
		updates.providerSpecificData = normalizeProviderSpecificData(body.providerSpecificData);
	}
	if (Object.hasOwn(body, "proxyPoolId")) {
		const proxyPoolId = normalizeString(body.proxyPoolId);
		if (proxyPoolId) {
			const proxyPool = await providerConnectionStore.getProxyPoolById(proxyPoolId);
			if (!proxyPool) return { error: "Proxy pool not found" };
		}
		const providerSpecificData = { ...(connection.providerSpecificData ?? {}) };
		if (proxyPoolId) providerSpecificData.proxyPoolId = proxyPoolId;
		else delete providerSpecificData.proxyPoolId;
		updates.providerSpecificData = providerSpecificData;
	}

	return updates;
}

function toProviderConnectionSummary(connection: ProviderConnection): ProviderConnectionSummary {
	return {
		id: connection.id,
		provider: connection.provider,
		authType: connection.authType,
		name: connection.name,
		displayName: connection.displayName,
		email: connection.email,
		priority: connection.priority,
		isActive: connection.isActive,
		hasApiKey: Boolean(connection.apiKey),
		hasAccessToken: Boolean(connection.accessToken),
		hasRefreshToken: Boolean(connection.refreshToken),
		projectId: connection.projectId,
		providerSpecificData: redactProviderSpecificData(connection.providerSpecificData),
		lastUsedAt: connection.lastUsedAt,
		consecutiveUseCount: connection.consecutiveUseCount,
		testStatus: connection.testStatus,
		lastError: connection.lastError,
		lastErrorAt: connection.lastErrorAt,
		errorCode: connection.errorCode,
		backoffLevel: connection.backoffLevel,
		createdAt: connection.createdAt,
		updatedAt: connection.updatedAt,
	};
}

function redactProviderSpecificData(
	value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	if (!value) return null;
	const redacted: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(value)) {
		if (/token|secret|key|password/i.test(key)) {
			redacted[key] = "[redacted]";
		} else {
			redacted[key] = nested;
		}
	}
	return redacted;
}

function isProviderConnectionListPath(pathname: string): boolean {
	return pathname === "/provider-connections" || pathname === "/v1/provider-connections";
}

function parseProviderConnectionId(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?provider-connections\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
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
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableString(value: unknown): string | null {
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizeNullableSecret(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	const normalized = normalizeString(value);
	return normalized || null;
}

function normalizeOptionalNumber(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProviderSpecificData(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
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
