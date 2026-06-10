import {
	createJsonProviderConnectionStore,
	type CreateProviderConnectionInput,
	type ProviderConnection,
	type ProviderConnectionStore,
} from "@pie-lab/storage";
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.ts";

export interface OAuthApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	fetch?: typeof fetch;
	now?: () => Date;
}

interface OAuthProviderConfig {
	id: string;
	aliases: string[];
	name: string;
	connectionProvider: string;
	authorizationUrl: string;
	tokenUrl: string;
	clientId: string;
	clientSecret?: string;
	scopes: string[];
	tokenBodyFormat: "form" | "json";
	extraAuthorizationParams?: Record<string, string>;
	includeStateInTokenRequest?: boolean;
}

interface OAuthCallbackInput {
	provider?: unknown;
	code?: unknown;
	state?: unknown;
	codeVerifier?: unknown;
	redirectUri?: unknown;
	email?: unknown;
	projectId?: unknown;
	connectionProvider?: unknown;
	providerSpecificData?: unknown;
}

interface TokenExchangeResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
	id_token?: string;
	[key: string]: unknown;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_REDIRECT_URI = "http://localhost:4874/";

const OAUTH_PROVIDERS: OAuthProviderConfig[] = [
	{
		id: "claude",
		aliases: ["anthropic"],
		name: "Claude Pro/Max",
		connectionProvider: "claude",
		authorizationUrl: "https://claude.ai/oauth/authorize",
		tokenUrl: "https://platform.claude.com/v1/oauth/token",
		clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
		scopes: [
			"org:create_api_key",
			"user:profile",
			"user:inference",
			"user:sessions:claude_code",
			"user:mcp_servers",
			"user:file_upload",
		],
		tokenBodyFormat: "json",
		extraAuthorizationParams: { code: "true" },
		includeStateInTokenRequest: true,
	},
	{
		id: "codex",
		aliases: ["openai-codex"],
		name: "ChatGPT Plus/Pro Codex",
		connectionProvider: "codex",
		authorizationUrl: "https://auth.openai.com/oauth/authorize",
		tokenUrl: "https://auth.openai.com/oauth/token",
		clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
		scopes: ["openid", "profile", "email", "offline_access"],
		tokenBodyFormat: "form",
		extraAuthorizationParams: {
			id_token_add_organizations: "true",
			codex_cli_simplified_flow: "true",
			originator: "pie-lab",
		},
	},
	{
		id: "gemini-cli",
		aliases: ["gemini"],
		name: "Google Gemini CLI",
		connectionProvider: "gemini-cli",
		authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
		tokenUrl: "https://oauth2.googleapis.com/token",
		clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
		clientSecret: "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",
		scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/cloud-platform"],
		tokenBodyFormat: "form",
		extraAuthorizationParams: {
			access_type: "offline",
			prompt: "consent",
		},
	},
];

export function createOAuthRequestHandler(options: OAuthApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const fetchImpl = options.fetch ?? fetch;
	const now = options.now ?? (() => new Date());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleOAuthRequest(request, response, { providerConnectionStore, fetchImpl, now });
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleOAuthRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		fetchImpl: typeof fetch;
		now: () => Date;
	},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (url.pathname === "/oauth/providers" || url.pathname === "/v1/oauth/providers") {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response, "GET, OPTIONS");
			return;
		}
		writeJson(response, 200, { providers: OAUTH_PROVIDERS.map(toOAuthProviderSummary) });
		return;
	}

	if (url.pathname === "/oauth/start" || url.pathname === "/v1/oauth/start") {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response, "GET, OPTIONS");
			return;
		}
		const config = requireOAuthProvider(url.searchParams.get("provider"));
		const redirectUri = normalizeString(url.searchParams.get("redirect_uri")) || DEFAULT_REDIRECT_URI;
		const flow = createOAuthAuthorizationFlow(config, redirectUri);
		writeJson(response, 200, {
			provider: config.id,
			authorizationUrl: flow.authorizationUrl,
			state: flow.state,
			codeVerifier: flow.codeVerifier,
			redirectUri,
		});
		return;
	}

	if (url.pathname === "/oauth/callback" || url.pathname === "/v1/oauth/callback") {
		if (request.method === "GET") {
			writeHtml(response, createOAuthCallbackHtml(url));
			return;
		}
		if (request.method !== "POST") {
			writeMethodNotAllowed(response, "GET, POST, OPTIONS");
			return;
		}
		const body = await readJsonBody<OAuthCallbackInput>(request);
		const result = await completeOAuthCallback(body, options);
		writeJson(response, 200, result);
		return;
	}

	writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
}

async function completeOAuthCallback(
	body: OAuthCallbackInput,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		fetchImpl: typeof fetch;
		now: () => Date;
	},
) {
	const config = requireOAuthProvider(normalizeString(body.provider));
	const code = requireString(body.code, "code");
	const codeVerifier = requireString(body.codeVerifier, "codeVerifier");
	const redirectUri = normalizeString(body.redirectUri) || DEFAULT_REDIRECT_URI;
	const state = normalizeString(body.state);
	const token = await exchangeAuthorizationCode(config, {
		code,
		codeVerifier,
		redirectUri,
		state,
		fetchImpl: options.fetchImpl,
	});
	const expiresAt =
		typeof token.expires_in === "number" ? new Date(options.now().getTime() + token.expires_in * 1000).toISOString() : null;
	const providerSpecificData: Record<string, unknown> = {
		...normalizeRecord(body.providerSpecificData),
		oauthProvider: config.id,
		tokenType: token.token_type ?? null,
		scope: token.scope ?? config.scopes.join(" "),
		expiresAt,
		expires: expiresAt ? Date.parse(expiresAt) : null,
		idToken: token.id_token ?? null,
		accountId: extractAccountId(token.access_token),
	};
	const projectId = normalizeString(body.projectId);
	if (projectId) {
		providerSpecificData.projectId = projectId;
	}

	const input: CreateProviderConnectionInput = {
		provider: normalizeString(body.connectionProvider) || config.connectionProvider,
		authType: "oauth",
		name: normalizeString(body.email) || `${config.name} OAuth`,
		email: normalizeString(body.email),
		accessToken: token.access_token,
		refreshToken: token.refresh_token ?? null,
		projectId,
		providerSpecificData,
		testStatus: "unknown",
	};
	const connection = await options.providerConnectionStore.createProviderConnection(input);

	return {
		provider: config.id,
		connection: toConnectionSummary(connection),
	};
}

async function exchangeAuthorizationCode(
	config: OAuthProviderConfig,
	options: {
		code: string;
		codeVerifier: string;
		redirectUri: string;
		state: string | null;
		fetchImpl: typeof fetch;
	},
): Promise<TokenExchangeResponse> {
	const params: Record<string, string> = {
		grant_type: "authorization_code",
		client_id: config.clientId,
		code: options.code,
		redirect_uri: options.redirectUri,
		code_verifier: options.codeVerifier,
	};
	if (config.clientSecret) params.client_secret = config.clientSecret;
	if (config.includeStateInTokenRequest && options.state) params.state = options.state;

	const response = await options.fetchImpl(config.tokenUrl, {
		method: "POST",
		headers:
			config.tokenBodyFormat === "json"
				? { accept: "application/json", "content-type": "application/json" }
				: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
		body: config.tokenBodyFormat === "json" ? JSON.stringify(params) : new URLSearchParams(params),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(`OAuth token exchange failed (${response.status}): ${text || response.statusText}`);
	}

	const token = text ? (JSON.parse(text) as TokenExchangeResponse) : {};
	if (!token.access_token) {
		throw new Error(`OAuth token exchange response missing access_token: ${text}`);
	}
	return token;
}

function createOAuthAuthorizationFlow(config: OAuthProviderConfig, redirectUri: string) {
	const codeVerifier = base64Url(randomBytes(32));
	const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
	const state = base64Url(randomBytes(16));
	const url = new URL(config.authorizationUrl);

	for (const [key, value] of Object.entries(config.extraAuthorizationParams ?? {})) {
		url.searchParams.set(key, value);
	}
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", config.clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("scope", config.scopes.join(" "));
	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	url.searchParams.set("state", state);

	return { authorizationUrl: url.toString(), state, codeVerifier };
}

function requireOAuthProvider(value: unknown): OAuthProviderConfig {
	const provider = normalizeString(value);
	const config = OAUTH_PROVIDERS.find((item) => item.id === provider || item.aliases.includes(provider ?? ""));
	if (!config) {
		throw new Error(`Unsupported OAuth provider: ${provider ?? ""}`);
	}
	return config;
}

function toOAuthProviderSummary(config: OAuthProviderConfig) {
	return {
		id: config.id,
		aliases: config.aliases,
		name: config.name,
		connectionProvider: config.connectionProvider,
		authorizationUrl: config.authorizationUrl,
		tokenUrl: config.tokenUrl,
		scopes: config.scopes,
	};
}

function toConnectionSummary(connection: ProviderConnection) {
	return {
		id: connection.id,
		provider: connection.provider,
		authType: connection.authType,
		name: connection.name,
		email: connection.email,
		isActive: connection.isActive,
		hasAccessToken: Boolean(connection.accessToken),
		hasRefreshToken: Boolean(connection.refreshToken),
		projectId: connection.projectId,
		createdAt: connection.createdAt,
		updatedAt: connection.updatedAt,
	};
}

function createOAuthCallbackHtml(url: URL): string {
	const error = url.searchParams.get("error") ?? "";
	const payload = JSON.stringify({
		type: "pie-lab-oauth-callback",
		code: url.searchParams.get("code") ?? "",
		state: url.searchParams.get("state") ?? "",
		error,
	});
	return `<!doctype html>
<html lang="ko">
<head><meta charset="utf-8"><title>pie-lab OAuth</title></head>
<body>
	<script>
		if (window.opener) {
			window.opener.postMessage(${payload}, "*");
		}
	</script>
	<p>${error ? `OAuth error: ${escapeHtml(error)}` : "OAuth callback received. You can close this window."}</p>
</body>
</html>`;
}

function extractAccountId(accessToken: string | undefined): string | null {
	if (!accessToken) return null;
	const payload = decodeJwt(accessToken);
	const openAiAuth = payload?.["https://api.openai.com/auth"];
	if (openAiAuth && typeof openAiAuth === "object") {
		const accountId = (openAiAuth as Record<string, unknown>).chatgpt_account_id;
		if (typeof accountId === "string") return accountId;
	}
	return typeof payload?.sub === "string" ? payload.sub : null;
}

function decodeJwt(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || !parts[1]) return null;
		return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function readJsonBody<Body>(request: IncomingMessage): Promise<Body> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text ? (JSON.parse(text) as Body) : ({} as Body);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireString(value: unknown, name: string): string {
	const normalized = normalizeString(value);
	if (!normalized) throw new Error(`${name} is required`);
	return normalized;
}

function normalizeString(value: unknown): string | null {
	const normalized = typeof value === "string" ? value.trim() : "";
	return normalized || null;
}

function base64Url(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		switch (character) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&#39;";
			default:
				return character;
		}
	});
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

function writeHtml(response: ServerResponse, body: string): void {
	response.writeHead(200, {
		...CORS_HEADERS,
		"content-type": "text/html; charset=utf-8",
	});
	response.end(body);
}
