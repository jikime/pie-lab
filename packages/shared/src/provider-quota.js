import { Resolver } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { Socket } from "node:net";
import { arch, homedir, platform } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { PIE_LAB_QUOTA_SELECTION_KEY } from "@pie-lab/router";
import { createJsonProviderConnectionStore, } from "@pie-lab/storage";
const LEGACY_QUOTA_SELECTION_KEY = "pieAdkQuotaSelection";
const CORS_HEADERS = {
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-origin": "*",
};
// 9router `src/shared/constants/providers.js` 기준 usage/quota 지원 provider 목록입니다.
export const USAGE_SUPPORTED_PROVIDERS = [
    "claude",
    "antigravity",
    "kiro",
    "github",
    "codex",
    "kimi-coding",
    "ollama",
    "gemini-cli",
    "glm",
    "glm-cn",
    "minimax",
    "minimax-cn",
];
// 9router에서 API key quota 조회를 허용하는 provider subset입니다.
export const USAGE_APIKEY_PROVIDERS = ["glm", "glm-cn", "minimax", "minimax-cn"];
const GLM_QUOTA_URLS = {
    international: "https://api.z.ai/api/monitor/usage/quota/limit",
    china: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
};
const MINIMAX_USAGE_URLS = {
    minimax: [
        "https://www.minimax.io/v1/token_plan/remains",
        "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
    ],
    "minimax-cn": [
        "https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains",
        "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    ],
};
const GITHUB_CONFIG = {
    apiVersion: "2022-11-28",
    userAgent: "GitHubCopilotChat/0.26.7",
};
const CLAUDE_CONFIG = {
    oauthUsageUrl: "https://api.anthropic.com/api/oauth/usage",
    apiVersion: "2023-06-01",
};
const CODEX_CONFIG = {
    usageUrl: "https://chatgpt.com/backend-api/wham/usage",
};
const OAUTH_ENDPOINTS = {
    anthropic: "https://api.anthropic.com/v1/oauth/token",
    openai: "https://auth.openai.com/oauth/token",
    google: "https://oauth2.googleapis.com/token",
    github: "https://github.com/login/oauth/access_token",
    kimi: "https://auth.kimi.com/api/oauth/token",
};
const OAUTH_CLIENTS = {
    claude: {
        clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    },
    codex: {
        clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    },
    "gemini-cli": {
        clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
        clientSecret: "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",
    },
    antigravity: {
        clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
        clientSecret: "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",
    },
    github: {
        clientId: "Iv1.b507a08c87ecfe98",
    },
};
const KIMI_CODING_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const GITHUB_COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const KIRO_TOKEN_URL = "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken";
const TOKEN_REFRESH_LEAD_MS = 5 * 60 * 1000;
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
const MITM_BYPASS_HOSTS = [
    "cloudcode-pa.googleapis.com",
    "daily-cloudcode-pa.googleapis.com",
    "api.individual.githubcopilot.com",
    "q.us-east-1.amazonaws.com",
    "codewhisperer.us-east-1.amazonaws.com",
    "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const PROXY_DISPATCHERS_MAX_SIZE = 20;
const DNS_CACHE = new Map();
const PROXY_DISPATCHERS = new Map();
const CLOUD_CODE_QUOTA_URL = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota";
const CLOUD_CODE_LOAD_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ANTIGRAVITY_CONFIG = {
    quotaApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
    loadProjectApiUrl: CLOUD_CODE_LOAD_URL,
    userAgent: `antigravity/1.107.0 ${platform()}/${arch()}`,
};
const ANTIGRAVITY_IMPORTANT_MODELS = new Set([
    "claude-opus-4-6-thinking",
    "claude-sonnet-4-6",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "gemini-3-flash",
    "gpt-oss-120b-medium",
]);
const CLIENT_METADATA = {
    ideType: 9,
    platform: getPlatformEnum(),
    pluginType: 2,
};
const KIRO_DEFAULT_PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX";
const QUOTA_FETCH_TIMEOUT_MS = 10000;
export function createProviderQuotaRequestHandler(options = {}) {
    const providerConnectionStore = options.providerConnectionStore ??
        createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
    const proxyPoolStore = options.proxyPoolStore ?? providerConnectionStore;
    return async (request, response) => {
        try {
            await handleProviderQuotaRequest(request, response, providerConnectionStore, proxyPoolStore, options.fetch ?? fetch);
        }
        catch (error) {
            writeJson(response, 500, {
                error: {
                    message: error instanceof Error ? error.message : "Unexpected server error",
                },
            });
        }
    };
}
function expandTildePath(path) {
    if (path === "~")
        return homedir();
    if (path.startsWith("~/"))
        return homedir() + path.slice(1);
    return path;
}
function getDefaultAgentDir() {
    const envDir = process.env.PIE_CODING_AGENT_DIR || process.env.PI_CODING_AGENT_DIR;
    if (envDir) {
        return expandTildePath(envDir);
    }
    return join(homedir(), ".pie", "agent");
}
export function getDefaultProviderConnectionFilePath(agentDir = getDefaultAgentDir()) {
    return join(agentDir, "provider-connections.json");
}
export async function handleProviderQuotaRequest(request, response, providerConnectionStore, proxyPoolStore = providerConnectionStore, fetchImpl = fetch) {
    if (request.method === "OPTIONS") {
        response.writeHead(204, CORS_HEADERS);
        response.end();
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
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const connectionId = parseQuotaConnectionId(url.pathname);
    if (isQuotaListPath(url.pathname)) {
        const connections = await providerConnectionStore.getProviderConnections();
        const data = connections.map(toProviderQuotaConnectionStatus);
        writeJson(response, 200, {
            count: data.length,
            data,
        });
        return;
    }
    if (connectionId) {
        const connection = await providerConnectionStore.getProviderConnectionById(connectionId);
        if (!connection) {
            writeJson(response, 404, {
                error: {
                    message: "Connection not found.",
                },
            });
            return;
        }
        let quotaConnection = connection;
        let usage;
        if (isUsageEligibleConnection(connection)) {
            const proxyOptions = await resolveConnectionProxyOptions(connection.providerSpecificData, proxyPoolStore);
            const quotaFetch = createProxyAwareFetch(fetchImpl, proxyOptions);
            try {
                quotaConnection = await refreshAndUpdateCredentials(connection, providerConnectionStore, quotaFetch);
            }
            catch (refreshError) {
                writeJson(response, 401, {
                    error: {
                        message: `Credential refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`,
                    },
                });
                return;
            }
            usage = await getUsageForProvider(quotaConnection, quotaFetch);
            if (isOAuthConnection(quotaConnection) && isAuthExpiredMessage(usage) && quotaConnection.refreshToken) {
                quotaConnection = await refreshAndUpdateCredentials(quotaConnection, providerConnectionStore, quotaFetch, true);
                usage = await getUsageForProvider(quotaConnection, quotaFetch);
            }
        }
        else {
            usage = { message: "Usage not available for this connection." };
        }
        quotaConnection = await updateProviderQuotaSelectionSnapshot(providerConnectionStore, quotaConnection, usage);
        writeJson(response, 200, {
            connection: toProviderQuotaConnectionStatus(quotaConnection),
            usage,
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
export async function getUsageForProvider(connection, fetchImpl = fetch) {
    const { provider, accessToken, apiKey, providerSpecificData } = connection;
    switch (provider) {
        case "github":
            return getGitHubUsage(accessToken, fetchImpl);
        case "gemini-cli":
            return getGeminiUsage(accessToken, providerSpecificData, fetchImpl);
        case "antigravity":
            return getAntigravityUsage(accessToken, providerSpecificData, fetchImpl);
        case "claude":
            return getClaudeUsage(accessToken, fetchImpl);
        case "codex":
            return getCodexUsage(accessToken, fetchImpl);
        case "kiro":
            return getKiroUsage(accessToken, providerSpecificData, fetchImpl);
        case "glm":
        case "glm-cn":
            return getGlmUsage(apiKey, provider, fetchImpl);
        case "minimax":
        case "minimax-cn":
            return getMiniMaxUsage(apiKey, provider, fetchImpl);
        case "ollama":
            return {
                plan: readString(providerSpecificData?.plan) ?? "Free",
                message: "Ollama Cloud uses a free tier with light usage limits (resets every 5h & 7d). For detailed usage tracking, visit ollama.com/settings/keys.",
                quotas: {},
            };
        case "kimi-coding":
            return { message: `${provider} quota fetcher is not wired in pie-lab yet.` };
        default:
            return { message: `Usage API not implemented for ${provider}` };
    }
}
function isQuotaListPath(pathname) {
    return pathname === "/quota" || pathname === "/v1/quota";
}
function parseQuotaConnectionId(pathname) {
    const match = pathname.match(/^\/(?:v1\/)?quota\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : undefined;
}
function toProviderQuotaConnectionStatus(connection) {
    const supported = isUsageSupportedProvider(connection.provider);
    const usageAuthType = getUsageAuthType(connection);
    return {
        id: connection.id,
        provider: connection.provider,
        authType: connection.authType,
        name: connection.name,
        displayName: connection.displayName,
        email: connection.email,
        isActive: connection.isActive,
        supported,
        eligible: supported && usageAuthType !== "unsupported",
        usageAuthType,
        proxyPoolId: getConnectionProxyPoolId(connection),
        testStatus: connection.testStatus,
        lastError: connection.lastError,
        lastErrorAt: connection.lastErrorAt,
        errorCode: connection.errorCode,
        quotaSelection: readQuotaSelectionSnapshot(connection),
    };
}
async function updateProviderQuotaSelectionSnapshot(providerConnectionStore, connection, usage) {
    const snapshot = createProviderQuotaSelectionSnapshot(usage);
    const providerSpecificData = {
        ...(connection.providerSpecificData ?? {}),
        [PIE_LAB_QUOTA_SELECTION_KEY]: snapshot,
    };
    const updatedConnection = await providerConnectionStore.updateProviderConnection(connection.id, {
        providerSpecificData,
    });
    return updatedConnection ?? { ...connection, providerSpecificData };
}
export function createProviderQuotaSelectionSnapshot(usage, now = new Date()) {
    const quotaWindows = Object.values(usage.quotas ?? {});
    const quotaScores = quotaWindows.map(quotaWindowToScore).filter((score) => score !== null);
    const resetAt = quotaWindows
        .map((quota) => quota.resetAt)
        .filter((value) => typeof value === "string" && value.length > 0)
        .sort()[0];
    if (quotaScores.length === 0) {
        return {
            checkedAt: now.toISOString(),
            status: usage.message ? "unknown" : "unknown",
            score: 0,
            remainingPercentage: null,
            resetAt: resetAt ?? null,
            message: usage.message ?? null,
        };
    }
    const score = Math.min(...quotaScores);
    const remainingPercentage = Math.round(score * 10000) / 100;
    return {
        checkedAt: now.toISOString(),
        status: score <= 0 ? "depleted" : "available",
        score,
        remainingPercentage,
        resetAt: resetAt ?? null,
        message: usage.message ?? null,
    };
}
function quotaWindowToScore(quota) {
    if (quota.unlimited)
        return 1;
    if (typeof quota.remainingPercentage === "number" && Number.isFinite(quota.remainingPercentage)) {
        return Math.max(0, Math.min(1, quota.remainingPercentage / 100));
    }
    if (typeof quota.remaining === "number" &&
        Number.isFinite(quota.remaining) &&
        typeof quota.total === "number" &&
        Number.isFinite(quota.total) &&
        quota.total > 0) {
        return Math.max(0, Math.min(1, quota.remaining / quota.total));
    }
    return null;
}
function readQuotaSelectionSnapshot(connection) {
    const snapshot = connection.providerSpecificData?.[PIE_LAB_QUOTA_SELECTION_KEY] ??
        connection.providerSpecificData?.[LEGACY_QUOTA_SELECTION_KEY];
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
        return null;
    return snapshot;
}
export function createQuotaAwareProviderConnectionPreparer(options) {
    const proxyPoolStore = options.proxyPoolStore ?? options.providerConnectionStore;
    const fetchImpl = options.fetch ?? fetch;
    const now = options.now ?? (() => new Date());
    return async (input) => {
        const providerOverride = input.settings.providerStrategies?.[input.provider] ?? {};
        const quotaStrategy = providerOverride.quotaStrategy ?? input.settings.quotaStrategy ?? "prefer-remaining";
        const shouldRefresh = providerOverride.quotaRefreshBeforeSelection ?? input.settings.quotaRefreshBeforeSelection ?? true;
        if (quotaStrategy === "off" || !shouldRefresh) {
            return input.connections;
        }
        const refreshTtlMs = readPositiveNumberSetting(providerOverride.quotaRefreshTtlMs ?? input.settings.quotaRefreshTtlMs, 60 * 1000);
        await Promise.all(input.connections.map((connection) => refreshProviderQuotaSelectionSnapshotIfNeeded({
            connection,
            providerConnectionStore: options.providerConnectionStore,
            proxyPoolStore,
            fetchImpl,
            refreshTtlMs,
            now: now(),
        })));
        return options.providerConnectionStore.getProviderConnections({
            provider: input.provider,
            isActive: true,
        });
    };
}
async function refreshProviderQuotaSelectionSnapshotIfNeeded(options) {
    const existing = readQuotaSelectionSnapshot(options.connection);
    if (existing?.checkedAt && Date.parse(existing.checkedAt) + options.refreshTtlMs > options.now.getTime()) {
        return;
    }
    if (!isUsageEligibleConnection(options.connection)) {
        return;
    }
    try {
        const proxyOptions = await resolveConnectionProxyOptions(options.connection.providerSpecificData, options.proxyPoolStore);
        const quotaFetch = createProxyAwareFetch(options.fetchImpl, proxyOptions);
        let quotaConnection = await refreshAndUpdateCredentials(options.connection, options.providerConnectionStore, quotaFetch);
        let usage = await getUsageForProvider(quotaConnection, quotaFetch);
        if (isOAuthConnection(quotaConnection) && isAuthExpiredMessage(usage) && quotaConnection.refreshToken) {
            quotaConnection = await refreshAndUpdateCredentials(quotaConnection, options.providerConnectionStore, quotaFetch, true);
            usage = await getUsageForProvider(quotaConnection, quotaFetch);
        }
        await updateProviderQuotaSelectionSnapshot(options.providerConnectionStore, quotaConnection, usage);
    }
    catch (error) {
        const snapshot = {
            checkedAt: options.now.toISOString(),
            status: "error",
            score: 0,
            remainingPercentage: null,
            resetAt: null,
            message: formatErrorMessage(error),
        };
        await options.providerConnectionStore.updateProviderConnection(options.connection.id, {
            providerSpecificData: {
                ...(options.connection.providerSpecificData ?? {}),
                [PIE_LAB_QUOTA_SELECTION_KEY]: snapshot,
            },
        });
    }
}
function readPositiveNumberSetting(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function getConnectionProxyPoolId(connection) {
    const proxyPoolId = normalizeString(connection.providerSpecificData?.proxyPoolId);
    return proxyPoolId && proxyPoolId !== "__none__" ? proxyPoolId : null;
}
function isUsageEligibleConnection(connection) {
    return isUsageSupportedProvider(connection.provider) && getUsageAuthType(connection) !== "unsupported";
}
function isOAuthConnection(connection) {
    return connection.authType === "oauth";
}
function isUsageSupportedProvider(provider) {
    return USAGE_SUPPORTED_PROVIDERS.includes(provider);
}
function getUsageAuthType(connection) {
    if (connection.authType === "oauth")
        return "oauth";
    if (connection.authType === "apikey" &&
        USAGE_APIKEY_PROVIDERS.includes(connection.provider)) {
        return "apikey";
    }
    return "unsupported";
}
function parseResetTime(resetValue) {
    if (!resetValue)
        return null;
    try {
        if (resetValue instanceof Date) {
            return resetValue.toISOString();
        }
        if (typeof resetValue === "number") {
            return new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue).toISOString();
        }
        if (typeof resetValue === "string") {
            if (/^\d+$/.test(resetValue)) {
                const timestamp = Number(resetValue);
                return new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp).toISOString();
            }
            return new Date(resetValue).toISOString();
        }
        return null;
    }
    catch {
        return null;
    }
}
function normalizeString(value) {
    if (value === undefined || value === null)
        return "";
    return String(value).trim();
}
async function resolveConnectionProxyOptions(providerSpecificData, proxyPoolStore) {
    try {
        const data = providerSpecificData ?? {};
        const proxyPoolIdRaw = normalizeString(data.proxyPoolId);
        const proxyPoolId = proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;
        const legacy = normalizeLegacyProxyOptions(data);
        const directVercelRelayUrl = normalizeString(data.vercelRelayUrl);
        if (proxyPoolId && proxyPoolStore) {
            const proxyPool = await proxyPoolStore.getProxyPoolById(proxyPoolId);
            const proxyUrl = normalizeString(proxyPool?.proxyUrl);
            const noProxy = normalizeString(proxyPool?.noProxy);
            const isValidPool = proxyPool && proxyPool.isActive === true && proxyUrl;
            if (isValidPool) {
                if (proxyPool.type === "vercel") {
                    return {
                        connectionProxyEnabled: false,
                        connectionProxyUrl: "",
                        connectionNoProxy: noProxy,
                        vercelRelayUrl: proxyUrl,
                        // 9router's usage route intentionally lets quota/refresh fall back to direct.
                        strictProxy: false,
                    };
                }
                return {
                    connectionProxyEnabled: true,
                    connectionProxyUrl: proxyUrl,
                    connectionNoProxy: noProxy,
                    // 9router's usage route intentionally lets quota/refresh fall back to direct.
                    strictProxy: false,
                };
            }
        }
        if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
            return {
                ...legacy,
                vercelRelayUrl: directVercelRelayUrl,
                // 9router's usage route intentionally lets quota/refresh fall back to direct.
                strictProxy: false,
            };
        }
        return {
            ...legacy,
            vercelRelayUrl: directVercelRelayUrl,
            // 9router's usage route intentionally lets quota/refresh fall back to direct.
            strictProxy: false,
        };
    }
    catch {
        return {
            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: "",
            strictProxy: false,
        };
    }
}
function normalizeLegacyProxyOptions(providerSpecificData = {}) {
    return {
        connectionProxyEnabled: providerSpecificData.connectionProxyEnabled === true,
        connectionProxyUrl: normalizeString(providerSpecificData.connectionProxyUrl),
        connectionNoProxy: normalizeString(providerSpecificData.connectionNoProxy),
    };
}
function createProxyAwareFetch(fetchImpl, proxyOptions) {
    return ((url, options) => proxyAwareFetch(fetchImpl, url, options ?? {}, proxyOptions));
}
async function proxyAwareFetch(fetchImpl, url, options = {}, proxyOptions = null) {
    const targetUrl = typeof url === "string" ? url : url.toString();
    const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
    if (vercelRelayUrl) {
        const parsed = new URL(targetUrl);
        const relayHeaders = {
            ...headersToRecord(options.headers),
            "x-relay-target": `${parsed.protocol}//${parsed.host}`,
            "x-relay-path": `${parsed.pathname}${parsed.search}`,
        };
        return fetchImpl(vercelRelayUrl, { ...options, headers: relayHeaders });
    }
    const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
    const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
    const proxyUrl = connectionProxyUrl || envProxyUrl;
    if (fetchImpl === globalThis.fetch && shouldBypassMitmDns(targetUrl)) {
        if (proxyUrl) {
            try {
                const dispatcher = await getProxyDispatcher(proxyUrl);
                return await fetchWithDispatcher(fetchImpl, url, options, dispatcher);
            }
            catch (proxyError) {
                if (proxyOptions?.strictProxy === true) {
                    throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${formatErrorMessage(proxyError)}`);
                }
            }
        }
        try {
            const parsedUrl = new URL(targetUrl);
            const realIp = await resolveRealIp(parsedUrl.hostname);
            if (realIp) {
                return await createBypassRequest(parsedUrl, realIp, options);
            }
        }
        catch {
            // Fall through to normal fetch, matching 9router's graceful fallback.
        }
    }
    if (proxyUrl) {
        try {
            const dispatcher = await getProxyDispatcher(proxyUrl);
            return await fetchWithDispatcher(fetchImpl, url, options, dispatcher);
        }
        catch (proxyError) {
            if (proxyOptions?.strictProxy === true) {
                throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${formatErrorMessage(proxyError)}`);
            }
        }
    }
    return fetchImpl(url, options);
}
function headersToRecord(headers) {
    if (!headers)
        return {};
    if (headers instanceof Headers)
        return Object.fromEntries(headers.entries());
    if (Array.isArray(headers))
        return Object.fromEntries(headers.map(([key, value]) => [key, value]));
    const record = {};
    for (const [key, value] of Object.entries(headers)) {
        record[key] = Array.isArray(value) ? value.join(", ") : String(value);
    }
    return record;
}
function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
    const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
    if (!enabled)
        return null;
    const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
    if (!proxyUrlRaw)
        return null;
    const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
    if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy))
        return null;
    return normalizeProxyUrl(proxyUrlRaw);
}
function getEnvProxyUrl(targetUrl) {
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    if (shouldBypassByNoProxy(targetUrl, noProxy))
        return null;
    let protocol = "";
    try {
        protocol = new URL(targetUrl).protocol;
    }
    catch {
        return null;
    }
    if (protocol === "https:") {
        return (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || null);
    }
    return process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || null;
}
function normalizeProxyUrl(proxyUrl) {
    const normalizedInput = normalizeString(proxyUrl);
    if (!normalizedInput)
        return null;
    try {
        new URL(normalizedInput);
        return normalizedInput;
    }
    catch {
        return `http://${normalizedInput}`;
    }
}
function shouldBypassMitmDns(targetUrl) {
    try {
        const hostname = new URL(targetUrl).hostname;
        return MITM_BYPASS_HOSTS.some((host) => hostname.includes(host));
    }
    catch {
        return false;
    }
}
function shouldBypassByNoProxy(targetUrl, noProxyValue) {
    const noProxy = normalizeString(noProxyValue);
    if (!noProxy)
        return false;
    let hostname = "";
    try {
        hostname = new URL(targetUrl).hostname.toLowerCase();
    }
    catch {
        return false;
    }
    const patterns = noProxy
        .split(",")
        .map((pattern) => pattern.trim().toLowerCase())
        .filter(Boolean);
    return patterns.some((pattern) => {
        if (pattern === "*")
            return true;
        if (pattern.startsWith("."))
            return hostname.endsWith(pattern) || hostname === pattern.slice(1);
        return hostname === pattern || hostname.endsWith(`.${pattern}`);
    });
}
async function getProxyDispatcher(proxyUrl) {
    const normalized = normalizeProxyUrl(proxyUrl);
    if (!normalized)
        return null;
    if (!PROXY_DISPATCHERS.has(normalized)) {
        if (PROXY_DISPATCHERS.size >= PROXY_DISPATCHERS_MAX_SIZE) {
            const firstKey = PROXY_DISPATCHERS.keys().next().value;
            if (firstKey)
                PROXY_DISPATCHERS.delete(firstKey);
        }
        const { ProxyAgent } = await import("undici");
        PROXY_DISPATCHERS.set(normalized, new ProxyAgent({ uri: normalized }));
    }
    return PROXY_DISPATCHERS.get(normalized) ?? null;
}
function fetchWithDispatcher(fetchImpl, url, options, dispatcher) {
    return fetchImpl(url, { ...options, dispatcher });
}
async function resolveRealIp(hostname) {
    const cached = DNS_CACHE.get(hostname);
    if (cached && Date.now() < cached.expiry)
        return cached.ip;
    try {
        const resolver = new Resolver();
        resolver.setServers(GOOGLE_DNS_SERVERS);
        const addresses = await resolver.resolve4(hostname);
        const ip = addresses[0];
        if (!ip)
            return null;
        DNS_CACHE.set(hostname, { ip, expiry: Date.now() + DNS_CACHE_TTL_MS });
        return ip;
    }
    catch {
        return null;
    }
}
function createBypassRequest(parsedUrl, realIp, options) {
    return new Promise((resolve, reject) => {
        const socket = new Socket();
        socket.connect(HTTPS_PORT, realIp, () => {
            const req = httpsRequest({
                socket,
                servername: parsedUrl.hostname,
                path: `${parsedUrl.pathname}${parsedUrl.search}`,
                method: options.method || "POST",
                headers: {
                    ...headersToRecord(options.headers),
                    Host: parsedUrl.hostname,
                },
            }, (res) => {
                const headers = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                    if (Array.isArray(value)) {
                        for (const item of value)
                            headers.append(key, item);
                    }
                    else if (value !== undefined) {
                        headers.set(key, String(value));
                    }
                }
                resolve(new Response(Readable.toWeb(res), {
                    status: res.statusCode ?? 0,
                    statusText: res.statusMessage,
                    headers,
                }));
            });
            req.on("error", reject);
            const body = serializeRequestBody(options.body);
            if (body)
                req.write(body);
            req.end();
        });
        socket.on("error", reject);
    });
}
function serializeRequestBody(body) {
    if (!body)
        return undefined;
    if (typeof body === "string" || Buffer.isBuffer(body))
        return body;
    if (body instanceof URLSearchParams)
        return body.toString();
    return JSON.stringify(body);
}
function formatErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function refreshAndUpdateCredentials(connection, providerConnectionStore, fetchImpl, force = false) {
    if (!isOAuthConnection(connection))
        return connection;
    if (!force && !needsCredentialRefresh(connection))
        return connection;
    const refreshResult = await refreshProviderCredentials(connection, fetchImpl);
    if (!refreshResult) {
        if (connection.accessToken)
            return connection;
        throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
    }
    const updateData = {
        updatedAt: new Date().toISOString(),
    };
    if (refreshResult.accessToken) {
        updateData.accessToken = refreshResult.accessToken;
    }
    if (refreshResult.refreshToken) {
        updateData.refreshToken = refreshResult.refreshToken;
    }
    if (refreshResult.expiresIn) {
        updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    }
    else if (refreshResult.expiresAt) {
        updateData.expiresAt = refreshResult.expiresAt;
    }
    if (refreshResult.copilotToken || refreshResult.copilotTokenExpiresAt) {
        updateData.providerSpecificData = {
            ...connection.providerSpecificData,
            copilotToken: refreshResult.copilotToken,
            copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt,
        };
    }
    const updatedConnection = await providerConnectionStore.updateProviderConnection(connection.id, updateData);
    return updatedConnection ?? { ...connection, ...updateData };
}
function needsCredentialRefresh(connection) {
    if (connection.provider === "github") {
        const providerSpecificData = connection.providerSpecificData ?? {};
        if (!providerSpecificData.copilotToken)
            return true;
        const copilotExpiresAt = getExpiryMs(providerSpecificData.copilotTokenExpiresAt);
        if (copilotExpiresAt !== null && copilotExpiresAt - Date.now() < TOKEN_REFRESH_LEAD_MS)
            return true;
    }
    const expiresAt = getExpiryMs(connection.expiresAt ?? connection.tokenExpiresAt);
    return expiresAt !== null && expiresAt - Date.now() < TOKEN_REFRESH_LEAD_MS;
}
function getExpiryMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
        if (Number.isFinite(parsed))
            return parsed < 1e12 ? parsed * 1000 : parsed;
    }
    return null;
}
async function refreshProviderCredentials(connection, fetchImpl) {
    if (!connection.refreshToken && connection.provider !== "github")
        return null;
    try {
        switch (connection.provider) {
            case "claude":
                return refreshWithJson(fetchImpl, OAUTH_ENDPOINTS.anthropic, {
                    grant_type: "refresh_token",
                    refresh_token: connection.refreshToken,
                    client_id: OAUTH_CLIENTS.claude.clientId,
                }, connection.refreshToken);
            case "codex":
                return refreshWithForm(fetchImpl, OAUTH_ENDPOINTS.openai, {
                    grant_type: "refresh_token",
                    refresh_token: connection.refreshToken,
                    client_id: OAUTH_CLIENTS.codex.clientId,
                    scope: "openid profile email offline_access",
                }, connection.refreshToken);
            case "gemini-cli":
                return refreshGoogleToken(fetchImpl, connection.refreshToken, OAUTH_CLIENTS["gemini-cli"]);
            case "antigravity":
                return refreshGoogleToken(fetchImpl, connection.refreshToken, OAUTH_CLIENTS.antigravity);
            case "github":
                return refreshGitHubCredentials(connection, fetchImpl);
            case "kiro":
                return refreshKiroToken(fetchImpl, connection.refreshToken);
            case "kimi-coding":
                return refreshKimiCodingToken(fetchImpl, connection.refreshToken);
            default:
                return null;
        }
    }
    catch {
        return null;
    }
}
async function refreshWithJson(fetchImpl, url, body, fallbackRefreshToken) {
    const response = await fetchImpl(url, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
    if (!response.ok)
        return null;
    const tokens = (await response.json());
    return normalizeOAuthTokenResponse(tokens, fallbackRefreshToken);
}
async function refreshWithForm(fetchImpl, url, params, fallbackRefreshToken, headers = {}) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
            form.set(key, String(value));
        }
    }
    const response = await fetchImpl(url, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            ...headers,
        },
        body: form,
    });
    if (!response.ok)
        return null;
    const tokens = (await response.json());
    return normalizeOAuthTokenResponse(tokens, fallbackRefreshToken);
}
function normalizeOAuthTokenResponse(tokens, fallbackRefreshToken) {
    const accessToken = readString(tokens.access_token) ?? readString(tokens.accessToken);
    if (!accessToken)
        return null;
    return {
        accessToken,
        refreshToken: readString(tokens.refresh_token) ?? readString(tokens.refreshToken) ?? fallbackRefreshToken ?? undefined,
        expiresIn: readOptionalNumber(tokens.expires_in ?? tokens.expiresIn),
        expiresAt: readString(tokens.expires_at) ?? readString(tokens.expiresAt),
    };
}
function refreshGoogleToken(fetchImpl, refreshToken, client) {
    if (!refreshToken)
        return Promise.resolve(null);
    return refreshWithForm(fetchImpl, OAUTH_ENDPOINTS.google, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
    }, refreshToken);
}
async function refreshGitHubCredentials(connection, fetchImpl) {
    let accessToken = connection.accessToken ?? undefined;
    let refreshToken = connection.refreshToken ?? undefined;
    let copilotResult = accessToken ? await refreshCopilotToken(fetchImpl, accessToken) : null;
    if (!copilotResult && refreshToken) {
        const githubTokens = await refreshWithForm(fetchImpl, OAUTH_ENDPOINTS.github, {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
            client_id: OAUTH_CLIENTS.github.clientId,
        }, refreshToken);
        if (githubTokens?.accessToken) {
            accessToken = githubTokens.accessToken;
            refreshToken = githubTokens.refreshToken;
            copilotResult = await refreshCopilotToken(fetchImpl, accessToken);
            return {
                ...githubTokens,
                copilotToken: copilotResult?.copilotToken,
                copilotTokenExpiresAt: copilotResult?.copilotTokenExpiresAt,
            };
        }
    }
    if (copilotResult) {
        return {
            accessToken,
            refreshToken,
            copilotToken: copilotResult.copilotToken,
            copilotTokenExpiresAt: copilotResult.copilotTokenExpiresAt,
        };
    }
    return null;
}
async function refreshCopilotToken(fetchImpl, githubAccessToken) {
    const response = await fetchImpl(GITHUB_COPILOT_TOKEN_URL, {
        headers: {
            Accept: "application/json",
            Authorization: `token ${githubAccessToken}`,
            "Editor-Plugin-Version": "copilot-chat/0.38.0",
            "Editor-Version": "vscode/1.110.0",
            "User-Agent": "GitHubCopilotChat/0.38.0",
            "x-github-api-version": "2025-04-01",
        },
    });
    if (!response.ok)
        return null;
    const data = (await response.json());
    const token = readString(data.token);
    if (!token)
        return null;
    return {
        copilotToken: token,
        copilotTokenExpiresAt: readString(data.expires_at) ?? readOptionalNumber(data.expires_at),
    };
}
async function refreshKiroToken(fetchImpl, refreshToken) {
    if (!refreshToken)
        return null;
    const response = await fetchImpl(KIRO_TOKEN_URL, {
        method: "POST",
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": "kiro-cli/1.0.0",
        },
        body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok)
        return null;
    const tokens = (await response.json());
    return normalizeOAuthTokenResponse(tokens, refreshToken);
}
function refreshKimiCodingToken(fetchImpl, refreshToken) {
    if (!refreshToken)
        return Promise.resolve(null);
    return refreshWithForm(fetchImpl, OAUTH_ENDPOINTS.kimi, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: KIMI_CODING_CLIENT_ID,
    }, refreshToken, buildKimiHeaders());
}
function buildKimiHeaders() {
    return {
        "X-Msh-Platform": "9router",
        "X-Msh-Version": "2.1.2",
        "X-Msh-Device-Model": `${process.platform} ${process.arch}`,
        "X-Msh-Device-Id": `kimi-${Date.now()}`,
    };
}
function isAuthExpiredMessage(usage) {
    if (!usage.message)
        return false;
    const message = usage.message.toLowerCase();
    return AUTH_EXPIRED_PATTERNS.some((pattern) => message.includes(pattern));
}
async function getGitHubUsage(accessToken, fetchImpl) {
    if (!accessToken) {
        throw new Error("No GitHub access token available. Please re-authorize the connection.");
    }
    const response = await fetchImpl("https://api.github.com/copilot_internal/user", {
        headers: {
            Accept: "application/json",
            Authorization: `token ${accessToken}`,
            "Editor-Plugin-Version": "copilot-chat/0.26.7",
            "Editor-Version": "vscode/1.100.0",
            "User-Agent": GITHUB_CONFIG.userAgent,
            "X-GitHub-Api-Version": GITHUB_CONFIG.apiVersion,
        },
    });
    if (!response.ok) {
        throw new Error(`GitHub API error: ${await response.text()}`);
    }
    const data = (await response.json());
    if (isRecord(data.quota_snapshots)) {
        const snapshots = data.quota_snapshots;
        const resetAt = parseResetTime(data.quota_reset_date);
        return {
            plan: readString(data.copilot_plan),
            resetDate: readString(data.quota_reset_date),
            quotas: {
                chat: { ...formatGitHubQuotaSnapshot(snapshots.chat), resetAt },
                completions: { ...formatGitHubQuotaSnapshot(snapshots.completions), resetAt },
                premium_interactions: { ...formatGitHubQuotaSnapshot(snapshots.premium_interactions), resetAt },
            },
        };
    }
    if (isRecord(data.monthly_quotas) || isRecord(data.limited_user_quotas)) {
        const monthlyQuotas = asRecord(data.monthly_quotas);
        const usedQuotas = asRecord(data.limited_user_quotas);
        const resetAt = parseResetTime(data.limited_user_reset_date);
        return {
            plan: readString(data.copilot_plan) ?? readString(data.access_type_sku),
            resetDate: readString(data.limited_user_reset_date),
            quotas: {
                chat: {
                    used: readNumber(usedQuotas.chat),
                    total: readNumber(monthlyQuotas.chat),
                    unlimited: false,
                    resetAt,
                },
                completions: {
                    used: readNumber(usedQuotas.completions),
                    total: readNumber(monthlyQuotas.completions),
                    unlimited: false,
                    resetAt,
                },
            },
        };
    }
    return { message: "GitHub Copilot connected. Unable to parse quota data." };
}
function formatGitHubQuotaSnapshot(quotaValue) {
    const quota = asRecord(quotaValue);
    const entitlement = readNumber(quota.entitlement);
    const remaining = readNumber(quota.remaining);
    if (Object.keys(quota).length === 0)
        return { used: 0, total: 0, unlimited: true };
    return {
        used: Math.max(0, entitlement - remaining),
        total: entitlement,
        remaining,
        unlimited: quota.unlimited === true,
    };
}
async function getClaudeUsage(accessToken, fetchImpl) {
    if (!accessToken) {
        return { message: "Claude access token not available." };
    }
    const response = await fetchImpl(CLAUDE_CONFIG.oauthUsageUrl, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "anthropic-beta": "oauth-2025-04-20",
            "anthropic-version": CLAUDE_CONFIG.apiVersion,
        },
    });
    if (!response.ok) {
        return { message: `Claude connected. Usage API returned ${response.status}.` };
    }
    const data = (await response.json());
    const quotas = {};
    const maybeAddWindow = (key, label) => {
        const window = asRecord(data[key]);
        if (typeof window.utilization !== "number")
            return;
        const used = Math.max(0, Math.min(100, window.utilization));
        const remaining = Math.max(0, 100 - used);
        quotas[label] = {
            used,
            total: 100,
            remaining,
            remainingPercentage: remaining,
            resetAt: parseResetTime(window.resets_at),
            unlimited: false,
        };
    };
    maybeAddWindow("five_hour", "session (5h)");
    maybeAddWindow("seven_day", "weekly (7d)");
    for (const [key, value] of Object.entries(data)) {
        if (!key.startsWith("seven_day_") || key === "seven_day")
            continue;
        const window = asRecord(value);
        if (typeof window.utilization !== "number")
            continue;
        const modelName = key.replace("seven_day_", "");
        const used = Math.max(0, Math.min(100, window.utilization));
        const remaining = Math.max(0, 100 - used);
        quotas[`weekly ${modelName} (7d)`] = {
            used,
            total: 100,
            remaining,
            remainingPercentage: remaining,
            resetAt: parseResetTime(window.resets_at),
            unlimited: false,
        };
    }
    return {
        plan: "Claude Code",
        extraUsage: data.extra_usage ?? null,
        quotas,
    };
}
async function getGeminiUsage(accessToken, providerSpecificData, fetchImpl) {
    if (!accessToken) {
        return { plan: "Free", message: "Gemini CLI access token not available." };
    }
    try {
        let projectId = readString(providerSpecificData?.projectId) ?? null;
        let plan = "Free";
        if (!projectId) {
            const subscriptionInfo = await getGeminiSubscriptionInfo(accessToken, fetchImpl);
            projectId = readString(subscriptionInfo?.cloudaicompanionProject) ?? null;
            plan = readString(asRecord(subscriptionInfo?.currentTier).name) ?? plan;
        }
        if (!projectId) {
            return { plan, message: "Gemini CLI project ID not available." };
        }
        const response = await fetchWithTimeout(fetchImpl, CLOUD_CODE_QUOTA_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ project: projectId }),
        }, QUOTA_FETCH_TIMEOUT_MS);
        if (!response.ok) {
            return { plan, message: `Gemini CLI quota error (${response.status}).` };
        }
        const data = (await response.json());
        const buckets = Array.isArray(data.buckets) ? data.buckets : [];
        const quotas = {};
        for (const bucketValue of buckets) {
            const bucket = asRecord(bucketValue);
            const modelId = readString(bucket.modelId);
            if (!modelId || bucket.remainingFraction === undefined || bucket.remainingFraction === null)
                continue;
            const remainingFraction = Math.max(0, Math.min(1, toFiniteNumber(bucket.remainingFraction, 0)));
            const total = 1000;
            const remaining = Math.round(total * remainingFraction);
            const used = Math.max(0, total - remaining);
            quotas[modelId] = {
                used,
                total,
                remaining,
                resetAt: parseResetTime(bucket.resetTime),
                remainingPercentage: remainingFraction * 100,
                unlimited: false,
            };
        }
        return { plan, quotas };
    }
    catch (error) {
        return { message: `Gemini CLI error: ${error instanceof Error ? error.message : String(error)}` };
    }
}
async function getGeminiSubscriptionInfo(accessToken, fetchImpl) {
    try {
        const response = await fetchWithTimeout(fetchImpl, CLOUD_CODE_LOAD_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ metadata: CLIENT_METADATA }),
        }, QUOTA_FETCH_TIMEOUT_MS);
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
}
async function getAntigravityUsage(accessToken, _providerSpecificData, fetchImpl) {
    if (!accessToken) {
        return { message: "Antigravity access token not available.", quotas: {} };
    }
    try {
        const subscriptionInfo = await getAntigravitySubscriptionInfo(accessToken, fetchImpl);
        const projectId = readString(subscriptionInfo?.cloudaicompanionProject) ?? null;
        const response = await fetchWithTimeout(fetchImpl, ANTIGRAVITY_CONFIG.quotaApiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
                "Content-Type": "application/json",
                "X-Client-Name": "antigravity",
                "X-Client-Version": "1.107.0",
                "x-request-source": "local",
            },
            body: JSON.stringify(projectId ? { project: projectId } : {}),
        }, QUOTA_FETCH_TIMEOUT_MS);
        if (response.status === 403) {
            return {
                message: "Antigravity quota API access forbidden. Chat may still work.",
                quotas: {},
            };
        }
        if (response.status === 401) {
            return {
                message: "Antigravity quota API authentication expired. Chat may still work.",
                quotas: {},
            };
        }
        if (!response.ok) {
            throw new Error(`Antigravity API error: ${response.status}`);
        }
        const data = (await response.json());
        const models = asRecord(data.models);
        const quotas = {};
        for (const [modelKey, infoValue] of Object.entries(models)) {
            const info = asRecord(infoValue);
            const quotaInfo = asRecord(info.quotaInfo);
            if (Object.keys(quotaInfo).length === 0)
                continue;
            if (info.isInternal === true || !ANTIGRAVITY_IMPORTANT_MODELS.has(modelKey))
                continue;
            const remainingFraction = Math.max(0, Math.min(1, toFiniteNumber(quotaInfo.remainingFraction, 0)));
            const total = 1000;
            const remaining = Math.round(total * remainingFraction);
            const used = Math.max(0, total - remaining);
            quotas[modelKey] = {
                used,
                total,
                remaining,
                resetAt: parseResetTime(quotaInfo.resetTime),
                remainingPercentage: remainingFraction * 100,
                unlimited: false,
                displayName: readString(info.displayName) ?? modelKey,
            };
        }
        return {
            plan: readString(asRecord(subscriptionInfo?.currentTier).name) ?? "Unknown",
            quotas,
            subscriptionInfo,
        };
    }
    catch (error) {
        return { message: `Antigravity error: ${error instanceof Error ? error.message : String(error)}` };
    }
}
async function getAntigravitySubscriptionInfo(accessToken, fetchImpl) {
    try {
        const response = await fetchWithTimeout(fetchImpl, ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
                "Content-Type": "application/json",
                "x-request-source": "local",
            },
            body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
        }, QUOTA_FETCH_TIMEOUT_MS);
        if (!response.ok)
            return null;
        return (await response.json());
    }
    catch {
        return null;
    }
}
function toFiniteNumber(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return fallback;
}
function getCodexRateLimitBody(snapshot) {
    if (!isRecord(snapshot))
        return null;
    return isRecord(snapshot.rate_limit) ? snapshot.rate_limit : snapshot;
}
function formatCodexWindow(windowValue) {
    const window = asRecord(windowValue);
    const used = Math.max(0, Math.min(100, toFiniteNumber(window.used_percent ?? window.percent_used, 0)));
    return {
        used,
        total: 100,
        remaining: Math.max(0, 100 - used),
        resetAt: parseResetTime(window.reset_at ?? window.resets_at ?? window.resetAt ?? null),
        unlimited: false,
    };
}
function appendCodexQuotaWindows(quotas, prefix, snapshot) {
    const rateLimit = getCodexRateLimitBody(snapshot);
    if (!rateLimit)
        return false;
    const primary = rateLimit.primary_window ?? rateLimit.primary ?? asRecord(snapshot).primary_window ?? asRecord(snapshot).primary;
    const secondary = rateLimit.secondary_window ??
        rateLimit.secondary ??
        asRecord(snapshot).secondary_window ??
        asRecord(snapshot).secondary;
    let added = false;
    if (primary) {
        quotas[prefix ? `${prefix}_session` : "session"] = formatCodexWindow(primary);
        added = true;
    }
    if (secondary) {
        quotas[prefix ? `${prefix}_weekly` : "weekly"] = formatCodexWindow(secondary);
        added = true;
    }
    return added;
}
function getCodexReviewRateLimit(data) {
    if (data.code_review_rate_limit || data.review_rate_limit) {
        return data.code_review_rate_limit || data.review_rate_limit;
    }
    const byLimitId = asRecord(data.rate_limits_by_limit_id);
    if (Object.keys(byLimitId).length > 0) {
        return byLimitId.code_review ?? byLimitId.codex_review ?? byLimitId.review ?? null;
    }
    const additional = Array.isArray(data.additional_rate_limits) ? data.additional_rate_limits : [];
    return (additional.find((entry) => {
        const record = asRecord(entry);
        const id = String(record.limit_name ?? record.metered_feature ?? record.id ?? "").toLowerCase();
        return id === "code_review" || id === "codex_review" || id === "review" || id.includes("review");
    }) ?? null);
}
async function getCodexUsage(accessToken, fetchImpl) {
    if (!accessToken) {
        return { message: "Codex access token not available." };
    }
    const response = await fetchImpl(CODEX_CONFIG.usageUrl, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
    });
    if (!response.ok) {
        return { message: `Codex connected. Usage API temporarily unavailable (${response.status}).` };
    }
    const data = (await response.json());
    const rateLimitsById = asRecord(data.rate_limits_by_limit_id);
    const normalRateLimit = data.rate_limit ?? data.rate_limits ?? rateLimitsById.codex ?? {};
    const reviewRateLimit = getCodexReviewRateLimit(data);
    const quotas = {};
    appendCodexQuotaWindows(quotas, "", normalRateLimit);
    appendCodexQuotaWindows(quotas, "review", reviewRateLimit);
    return {
        plan: readString(data.plan_type) ?? readString(asRecord(data.summary).plan) ?? "unknown",
        limitReached: getCodexRateLimitBody(normalRateLimit)?.limit_reached === true,
        reviewLimitReached: getCodexRateLimitBody(reviewRateLimit)?.limit_reached === true,
        quotas,
    };
}
async function getGlmUsage(apiKey, provider, fetchImpl) {
    if (!apiKey) {
        return { message: "GLM API key not available." };
    }
    const region = provider === "glm-cn" ? "china" : "international";
    const quotaUrl = GLM_QUOTA_URLS[region];
    try {
        const response = await fetchImpl(quotaUrl, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
        });
        if (!response.ok) {
            if (response.status === 401) {
                return { message: "GLM API key invalid or expired." };
            }
            return { message: `GLM quota API error (${response.status}).` };
        }
        const json = (await response.json());
        const data = asRecord(json.data);
        const limits = Array.isArray(data.limits) ? data.limits : [];
        const quotas = {};
        for (const rawLimit of limits) {
            const limit = asRecord(rawLimit);
            if (limit.type !== "TOKENS_LIMIT")
                continue;
            const usedPercent = Number(limit.percentage) || 0;
            const resetMs = Number(limit.nextResetTime) || 0;
            const remaining = Math.max(0, 100 - usedPercent);
            quotas.session = {
                used: usedPercent,
                total: 100,
                remaining,
                remainingPercentage: remaining,
                resetAt: resetMs > 0 ? new Date(resetMs).toISOString() : null,
                unlimited: false,
            };
        }
        const levelRaw = readString(data.level) ?? "";
        const plan = levelRaw ? levelRaw.charAt(0).toUpperCase() + levelRaw.slice(1).toLowerCase() : "Unknown";
        return { plan, quotas };
    }
    catch (error) {
        return { message: `GLM error: ${error instanceof Error ? error.message : String(error)}` };
    }
}
async function getKiroUsage(accessToken, providerSpecificData, fetchImpl) {
    if (!accessToken) {
        return { message: "Kiro access token not available.", quotas: {} };
    }
    const profileArn = readString(providerSpecificData?.profileArn) ?? KIRO_DEFAULT_PROFILE_ARN;
    const authMethod = readString(providerSpecificData?.authMethod) ?? "builder-id";
    const getUsageParams = new URLSearchParams({
        isEmailRequired: "true",
        origin: "AI_EDITOR",
        resourceType: "AGENTIC_REQUEST",
    });
    const attempts = [
        {
            name: "codewhisperer-get",
            run: () => fetchImpl(`https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits?${getUsageParams.toString()}`, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    Accept: "application/json",
                    "x-amz-user-agent": "aws-sdk-js/1.0.0 KiroIDE",
                    "user-agent": "aws-sdk-js/1.0.0 KiroIDE",
                },
            }),
        },
        {
            name: "codewhisperer-post",
            run: () => fetchImpl("https://codewhisperer.us-east-1.amazonaws.com", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/x-amz-json-1.0",
                    "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    origin: "AI_EDITOR",
                    profileArn,
                    resourceType: "AGENTIC_REQUEST",
                }),
            }),
        },
        {
            name: "q-get",
            run: () => {
                const params = new URLSearchParams({
                    origin: "AI_EDITOR",
                    profileArn,
                    resourceType: "AGENTIC_REQUEST",
                });
                return fetchImpl(`https://q.us-east-1.amazonaws.com/getUsageLimits?${params.toString()}`, {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: "application/json",
                    },
                });
            },
        },
    ];
    let sawAuthError = false;
    const errors = [];
    for (const attempt of attempts) {
        try {
            const response = await attempt.run();
            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                if (response.status === 401 || response.status === 403)
                    sawAuthError = true;
                errors.push(`${attempt.name}:${response.status}${errorText ? `:${errorText}` : ""}`);
                continue;
            }
            const data = (await response.json());
            return parseKiroQuotaData(data);
        }
        catch (error) {
            errors.push(`${attempt.name}:${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (sawAuthError && authMethod === "idc") {
        return {
            message: "Kiro quota API is unavailable for the current AWS IAM Identity Center session. Chat may still work. If this persists after renewing your session, reconnect Kiro.",
            quotas: {},
        };
    }
    if (sawAuthError && (authMethod === "google" || authMethod === "github")) {
        return {
            message: "Kiro quota API authentication expired. Chat may still work.",
            quotas: {},
        };
    }
    if (sawAuthError) {
        return {
            message: "Kiro quota API rejected the current token. Chat may still work.",
            quotas: {},
        };
    }
    return {
        message: errors.length > 0
            ? `Unable to fetch Kiro usage right now. (${errors[errors.length - 1]})`
            : "Unable to fetch Kiro usage right now.",
        quotas: {},
    };
}
function parseKiroQuotaData(data) {
    const usageList = Array.isArray(data.usageBreakdownList) ? data.usageBreakdownList : [];
    const quotas = {};
    const resetAt = parseResetTime(data.nextDateReset ?? data.resetDate);
    for (const breakdownValue of usageList) {
        const breakdown = asRecord(breakdownValue);
        const resourceType = (readString(breakdown.resourceType) ?? "unknown").toLowerCase();
        const used = Math.max(0, toFiniteNumber(breakdown.currentUsageWithPrecision, 0));
        const total = Math.max(0, toFiniteNumber(breakdown.usageLimitWithPrecision, 0));
        const remaining = Math.max(0, total - used);
        quotas[resourceType] = {
            used,
            total,
            remaining,
            resetAt,
            unlimited: false,
        };
        const freeTrialInfo = asRecord(breakdown.freeTrialInfo);
        if (Object.keys(freeTrialInfo).length === 0)
            continue;
        const freeUsed = Math.max(0, toFiniteNumber(freeTrialInfo.currentUsageWithPrecision, 0));
        const freeTotal = Math.max(0, toFiniteNumber(freeTrialInfo.usageLimitWithPrecision, 0));
        quotas[`${resourceType}_freetrial`] = {
            used: freeUsed,
            total: freeTotal,
            remaining: Math.max(0, freeTotal - freeUsed),
            resetAt: parseResetTime(freeTrialInfo.freeTrialExpiry ?? resetAt),
            unlimited: false,
        };
    }
    return {
        plan: readString(asRecord(data.subscriptionInfo).subscriptionTitle) ?? "Kiro",
        quotas,
    };
}
function getMiniMaxField(model, snakeKey, camelKey) {
    return model[snakeKey] ?? model[camelKey] ?? null;
}
function getMiniMaxModelName(model) {
    return String(getMiniMaxField(model, "model_name", "modelName") || "").trim();
}
function formatMiniMaxQuotaName(model) {
    const rawName = getMiniMaxModelName(model);
    if (!rawName)
        return "MiniMax";
    return rawName
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
        .replace(/\bTo\b/g, "to")
        .replace(/\bTts\b/g, "TTS")
        .replace(/\bHd\b/g, "HD");
}
function getMiniMaxSessionTotal(model) {
    return Math.max(0, Number(getMiniMaxField(model, "current_interval_total_count", "currentIntervalTotalCount")) || 0);
}
function getMiniMaxWeeklyTotal(model) {
    return Math.max(0, Number(getMiniMaxField(model, "current_weekly_total_count", "currentWeeklyTotalCount")) || 0);
}
function hasMiniMaxQuota(model) {
    return getMiniMaxSessionTotal(model) > 0 || getMiniMaxWeeklyTotal(model) > 0;
}
function getMiniMaxResetAt(model, capturedAtMs, remainsSnake, remainsCamel, endSnake, endCamel) {
    const remainsMs = Number(getMiniMaxField(model, remainsSnake, remainsCamel)) || 0;
    if (remainsMs > 0)
        return new Date(capturedAtMs + remainsMs).toISOString();
    return parseResetTime(getMiniMaxField(model, endSnake, endCamel));
}
function buildMiniMaxQuota(total, count, resetAt, countMeansRemaining) {
    const safeTotal = Math.max(0, total);
    const used = countMeansRemaining ? Math.max(safeTotal - count, 0) : Math.min(Math.max(0, count), safeTotal);
    const remaining = Math.max(safeTotal - used, 0);
    return {
        used,
        total: safeTotal,
        remaining,
        remainingPercentage: safeTotal > 0 ? Math.max(0, Math.min(100, (remaining / safeTotal) * 100)) : 0,
        resetAt,
        unlimited: false,
    };
}
function addMiniMaxQuota(quotas, key, model, getTotal, countSnake, countCamel, resetArgs, countMeansRemaining) {
    const total = getTotal(model);
    if (total <= 0)
        return;
    const count = Math.max(0, Number(getMiniMaxField(model, countSnake, countCamel)) || 0);
    quotas[key] = buildMiniMaxQuota(total, count, getMiniMaxResetAt(model, ...resetArgs), countMeansRemaining);
}
async function getMiniMaxUsage(apiKey, provider, fetchImpl) {
    if (!apiKey) {
        return { message: "MiniMax API key not available." };
    }
    const usageUrls = MINIMAX_USAGE_URLS[provider] || [];
    let lastErrorMessage = "";
    for (let index = 0; index < usageUrls.length; index += 1) {
        const usageUrl = usageUrls[index];
        const canFallback = index < usageUrls.length - 1;
        try {
            const response = await fetchImpl(usageUrl, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
            });
            const rawText = await response.text();
            let payload = {};
            if (rawText) {
                try {
                    payload = JSON.parse(rawText);
                }
                catch {
                    payload = {};
                }
            }
            const baseResp = asRecord(payload.base_resp ?? payload.baseResp);
            const apiStatusCode = Number(baseResp.status_code ?? baseResp.statusCode) || 0;
            const apiStatusMessage = String(baseResp.status_msg ?? baseResp.statusMsg ?? "").trim();
            const combined = `${apiStatusMessage} ${rawText}`.trim();
            const authLike = /token plan|coding plan|invalid api key|invalid key|unauthorized|inactive/i;
            if (response.status === 401 || response.status === 403 || apiStatusCode === 1004 || authLike.test(combined)) {
                return { message: "MiniMax API key invalid or inactive. Use an active Token/Coding Plan key." };
            }
            if (!response.ok) {
                lastErrorMessage = `MiniMax usage endpoint error (${response.status})`;
                if ((response.status === 404 || response.status === 405 || response.status >= 500) && canFallback)
                    continue;
                return { message: `MiniMax connected. ${lastErrorMessage}` };
            }
            if (apiStatusCode !== 0) {
                return { message: `MiniMax connected. ${apiStatusMessage || "Upstream quota API error"}` };
            }
            const modelRemains = payload.model_remains ?? payload.modelRemains;
            const allModels = Array.isArray(modelRemains) ? modelRemains.map(asRecord) : [];
            const quotaModels = allModels.filter(hasMiniMaxQuota);
            if (quotaModels.length === 0) {
                return { message: "MiniMax connected. No quota data was returned." };
            }
            const capturedAtMs = Date.now();
            const countMeansRemaining = usageUrl.includes("/coding_plan/remains");
            const quotas = {};
            for (const model of quotaModels) {
                const displayName = formatMiniMaxQuotaName(model);
                addMiniMaxQuota(quotas, `${displayName} (5h)`, model, getMiniMaxSessionTotal, "current_interval_usage_count", "currentIntervalUsageCount", [capturedAtMs, "remains_time", "remainsTime", "end_time", "endTime"], countMeansRemaining);
                addMiniMaxQuota(quotas, `${displayName} (7d)`, model, getMiniMaxWeeklyTotal, "current_weekly_usage_count", "currentWeeklyUsageCount", [capturedAtMs, "weekly_remains_time", "weeklyRemainsTime", "weekly_end_time", "weeklyEndTime"], countMeansRemaining);
            }
            if (Object.keys(quotas).length === 0) {
                return { message: "MiniMax connected. Unable to extract quota usage." };
            }
            return { quotas };
        }
        catch (error) {
            lastErrorMessage = error instanceof Error ? error.message : String(error);
            if (!canFallback)
                break;
        }
    }
    return {
        message: lastErrorMessage
            ? `MiniMax connected. Unable to fetch usage: ${lastErrorMessage}`
            : "MiniMax connected. Unable to fetch usage.",
    };
}
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImpl(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
function getPlatformEnum() {
    const os = platform();
    const architecture = arch();
    if (os === "darwin")
        return architecture === "arm64" ? 2 : 1;
    if (os === "linux")
        return architecture === "arm64" ? 4 : 3;
    if (os === "win32")
        return 5;
    return 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asRecord(value) {
    return isRecord(value) ? value : {};
}
function readNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function readOptionalNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return undefined;
}
function readString(value) {
    return typeof value === "string" ? value : undefined;
}
function writeJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        ...CORS_HEADERS,
        "content-type": "application/json; charset=utf-8",
    });
    response.end(`${JSON.stringify(body)}\n`);
}
//# sourceMappingURL=provider-quota.js.map