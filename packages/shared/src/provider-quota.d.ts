import type { IncomingMessage, ServerResponse } from "node:http";
import { type ProviderQuotaSelectionSnapshot } from "@pie-lab/router";
import { type ProviderConnection, type ProviderConnectionSettings, type ProviderConnectionStore, type ProxyPoolStore } from "@pie-lab/storage";
export interface ProviderQuotaApiOptions {
    providerConnectionStore?: ProviderConnectionStore;
    proxyPoolStore?: ProxyPoolStore;
    providerConnectionFilePath?: string;
    fetch?: typeof fetch;
}
export interface ProviderQuotaConnectionStatus {
    id: string;
    provider: string;
    authType: string;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    isActive: boolean;
    supported: boolean;
    eligible: boolean;
    usageAuthType: "oauth" | "apikey" | "unsupported";
    proxyPoolId?: string | null;
    testStatus?: string | null;
    lastError?: unknown;
    lastErrorAt?: string | null;
    errorCode?: string | number | null;
    quotaSelection?: ProviderQuotaSelectionSnapshot | null;
}
export interface ProviderQuotaWindow {
    used: number;
    total: number;
    remaining?: number;
    remainingPercentage?: number;
    resetAt?: string | null;
    unlimited?: boolean;
    displayName?: string;
}
export interface ProviderUsageResult {
    plan?: string;
    resetDate?: string | number | null;
    message?: string;
    quotas?: Record<string, ProviderQuotaWindow>;
    [key: string]: unknown;
}
export interface ProviderQuotaDetailResponse {
    connection: ProviderQuotaConnectionStatus;
    usage: ProviderUsageResult;
}
type FetchLike = typeof fetch;
export declare const USAGE_SUPPORTED_PROVIDERS: readonly ["claude", "antigravity", "kiro", "github", "codex", "kimi-coding", "ollama", "gemini-cli", "glm", "glm-cn", "minimax", "minimax-cn"];
export declare const USAGE_APIKEY_PROVIDERS: readonly ["glm", "glm-cn", "minimax", "minimax-cn"];
export declare function createProviderQuotaRequestHandler(options?: ProviderQuotaApiOptions): (request: IncomingMessage, response: ServerResponse<IncomingMessage>) => Promise<void>;
export declare function getDefaultProviderConnectionFilePath(agentDir?: string): string;
export declare function handleProviderQuotaRequest(request: IncomingMessage, response: ServerResponse, providerConnectionStore: ProviderConnectionStore, proxyPoolStore?: ProxyPoolStore, fetchImpl?: FetchLike): Promise<void>;
export declare function getUsageForProvider(connection: ProviderConnection, fetchImpl?: FetchLike): Promise<ProviderUsageResult>;
export declare function createProviderQuotaSelectionSnapshot(usage: ProviderUsageResult, now?: Date): ProviderQuotaSelectionSnapshot;
export interface QuotaAwareProviderConnectionPreparerOptions {
    providerConnectionStore: ProviderConnectionStore;
    proxyPoolStore?: ProxyPoolStore;
    fetch?: FetchLike;
    now?: () => Date;
}
export declare function createQuotaAwareProviderConnectionPreparer(options: QuotaAwareProviderConnectionPreparerOptions): (input: {
    provider: string;
    model: {
        id: string;
    };
    connections: ProviderConnection[];
    settings: ProviderConnectionSettings;
}) => Promise<ProviderConnection[]>;
export {};
//# sourceMappingURL=provider-quota.d.ts.map