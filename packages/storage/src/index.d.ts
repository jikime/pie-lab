export type UsageRecordStatus = "success" | "error" | "aborted" | "skipped";
export type UsagePricingSource = "pie-metadata" | "override" | "provider" | "estimated" | "unknown";
export type AccountFallbackStrategy = "fill-first" | "round-robin" | "quota-aware";
export type QuotaSelectionStrategy = "off" | "prefer-remaining" | "require-remaining";
export type ProviderAuthType = "oauth" | "apikey" | "access_token" | (string & {});
export type ProxyPoolType = "http" | "vercel";
export type RouterComboStrategy = "fallback" | "round-robin";
export type BudgetPolicyMode = "off" | "warn" | "block";
export interface BudgetLimitRule {
    mode?: BudgetPolicyMode;
    requestUsd?: number | string | null;
    dailyUsd?: number | string | null;
    monthlyUsd?: number | string | null;
}
export interface BudgetLimitSettings extends BudgetLimitRule {
    providerLimits?: Record<string, BudgetLimitRule>;
}
export interface UsageTokens {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
    estimated?: boolean;
}
export interface UsageCost {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    total: number;
    currency: "USD";
    pricingSource: UsagePricingSource;
}
export interface UsageMedia {
    kind: "stt" | "tts" | "embedding" | "webSearch" | "webFetch" | "image" | (string & {});
    inputBytes?: number;
    outputBytes?: number;
    inputChars?: number;
    audioSeconds?: number;
    billableSeconds?: number;
    billableTokens?: number;
    billingUnit?: "audio-minute" | "input-token" | "request" | "byte" | (string & {});
    cached?: boolean;
    estimated?: boolean;
    pricingVersion?: string;
}
export interface UsageTokenSaver {
    provider: "rtk" | (string & {});
    bytesBefore: number;
    bytesAfter: number;
    bytesSaved: number;
    hits: number;
    filters: string[];
}
export interface UsageTraceEvent {
    timestamp: string;
    phase: string;
    message?: string;
    provider?: string;
    model?: string;
    connectionId?: string;
    attemptIndex?: number;
    status?: string;
    metadata?: Record<string, unknown>;
}
export interface UsageRecord {
    id: string;
    requestId: string;
    timestamp: string;
    requestedModel: string;
    routingMode: "fixed" | "router" | "fallback";
    routeSource?: "fixed" | "router" | "fallback";
    resolvedProvider: string;
    resolvedModel: string;
    connectionId?: string;
    attemptIndex: number;
    attemptCount: number;
    endpoint?: string;
    clientOrigin?: string;
    apiKeyId?: string;
    agentRunId?: string;
    usage?: UsageTokens;
    cost?: UsageCost;
    media?: UsageMedia;
    tokenSaver?: UsageTokenSaver;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    status: UsageRecordStatus;
    errorCode?: string | number;
    errorMessage?: string;
    trace?: UsageTraceEvent[];
}
export interface ProviderConnection {
    id: string;
    provider: string;
    authType: ProviderAuthType;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    priority?: number | null;
    isActive: boolean;
    apiKey?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
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
    [key: string]: unknown;
}
export interface CreateProviderConnectionInput {
    provider: string;
    authType?: ProviderAuthType;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    priority?: number | null;
    isActive?: boolean;
    apiKey?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
    projectId?: string | null;
    providerSpecificData?: Record<string, unknown> | null;
    lastUsedAt?: string | null;
    consecutiveUseCount?: number | null;
    testStatus?: string | null;
    lastError?: unknown;
    lastErrorAt?: string | null;
    errorCode?: string | number | null;
    backoffLevel?: number | null;
    [key: string]: unknown;
}
export interface UpdateProviderConnectionInput {
    provider?: string;
    authType?: ProviderAuthType;
    name?: string | null;
    displayName?: string | null;
    email?: string | null;
    priority?: number | null;
    isActive?: boolean;
    apiKey?: string | null;
    accessToken?: string | null;
    refreshToken?: string | null;
    projectId?: string | null;
    providerSpecificData?: Record<string, unknown> | null;
    lastUsedAt?: string | null;
    consecutiveUseCount?: number | null;
    testStatus?: string | null;
    lastError?: unknown;
    lastErrorAt?: string | null;
    errorCode?: string | number | null;
    backoffLevel?: number | null;
    [key: string]: unknown;
}
export interface ProviderConnectionFilter {
    provider?: string;
    isActive?: boolean;
}
export interface ProviderStrategyConfig {
    fallbackStrategy?: AccountFallbackStrategy;
    stickyRoundRobinLimit?: number | string;
    quotaStrategy?: QuotaSelectionStrategy;
    quotaMinRemainingPercentage?: number | string;
    quotaMaxAgeMs?: number | string;
    quotaRefreshBeforeSelection?: boolean;
    quotaRefreshTtlMs?: number | string;
    proxyPoolId?: string;
}
export interface RouterPolicyCombo {
    name: string;
    models: string[];
    kind?: string | null;
    strategy?: RouterComboStrategy;
    stickyLimit?: number | string;
}
export interface RouterPolicyComboStrategyConfig {
    strategy?: RouterComboStrategy;
    stickyLimit?: number | string;
}
export interface RouterPolicySettings {
    aliases?: Record<string, string | string[]>;
    intents?: Record<string, string | string[]>;
    combos?: RouterPolicyCombo[] | {
        combos?: RouterPolicyCombo[];
    };
    comboStrategy?: RouterComboStrategy;
    comboStickyLimit?: number | string;
    comboStrategies?: Record<string, RouterComboStrategy | RouterPolicyComboStrategyConfig>;
}
export interface ProviderConnectionSettings {
    fallbackStrategy?: AccountFallbackStrategy;
    stickyRoundRobinLimit?: number | string;
    quotaStrategy?: QuotaSelectionStrategy;
    quotaMinRemainingPercentage?: number | string;
    quotaMaxAgeMs?: number | string;
    quotaRefreshBeforeSelection?: boolean;
    quotaRefreshTtlMs?: number | string;
    rtkEnabled?: boolean;
    budgetLimits?: BudgetLimitSettings;
    routerPolicy?: RouterPolicySettings;
    providerStrategies?: Record<string, ProviderStrategyConfig>;
}
export interface ProxyPool {
    id: string;
    name: string;
    proxyUrl: string;
    noProxy?: string | null;
    type: ProxyPoolType;
    isActive: boolean;
    strictProxy?: boolean | null;
    testStatus?: string | null;
    lastTestedAt?: string | null;
    lastError?: unknown;
    createdAt: string;
    updatedAt: string;
    [key: string]: unknown;
}
export interface CreateProxyPoolInput {
    id?: string;
    name: string;
    proxyUrl: string;
    noProxy?: string | null;
    type?: ProxyPoolType;
    isActive?: boolean;
    strictProxy?: boolean | null;
    testStatus?: string | null;
    lastTestedAt?: string | null;
    lastError?: unknown;
    [key: string]: unknown;
}
export interface UpdateProxyPoolInput {
    name?: string;
    proxyUrl?: string;
    noProxy?: string | null;
    type?: ProxyPoolType;
    isActive?: boolean;
    strictProxy?: boolean | null;
    testStatus?: string | null;
    lastTestedAt?: string | null;
    lastError?: unknown;
    [key: string]: unknown;
}
export interface ProxyPoolFilter {
    isActive?: boolean;
    testStatus?: string;
}
export interface ProxyPoolStore {
    getProxyPools(filter?: ProxyPoolFilter): Promise<ProxyPool[]>;
    getProxyPoolById(id: string): Promise<ProxyPool | null>;
    createProxyPool(data: CreateProxyPoolInput): Promise<ProxyPool>;
    updateProxyPool(id: string, data: UpdateProxyPoolInput): Promise<ProxyPool | null>;
    deleteProxyPool(id: string): Promise<ProxyPool | null>;
}
export interface ProviderConnectionStore extends ProxyPoolStore {
    getProviderConnections(filter?: ProviderConnectionFilter): Promise<ProviderConnection[]>;
    getProviderConnectionById(id: string): Promise<ProviderConnection | null>;
    createProviderConnection(data: CreateProviderConnectionInput): Promise<ProviderConnection>;
    updateProviderConnection(id: string, data: UpdateProviderConnectionInput): Promise<ProviderConnection | null>;
    deleteProviderConnection(id: string): Promise<ProviderConnection | null>;
    getSettings(): Promise<ProviderConnectionSettings>;
    updateSettings(updates: ProviderConnectionSettings): Promise<ProviderConnectionSettings>;
}
export interface ProviderConnectionJsonState {
    connections: ProviderConnection[];
    settings: ProviderConnectionSettings;
    proxyPools: ProxyPool[];
}
export interface UsageStore {
    recordUsage(record: UsageRecord): void | Promise<void>;
    getUsageRecords?(): UsageRecord[] | Promise<UsageRecord[]>;
}
export interface UsageRecordQuery {
    status?: UsageRecordStatus | UsageRecordStatus[];
    provider?: string;
    model?: string;
    routingMode?: UsageRecord["routingMode"] | UsageRecord["routingMode"][];
    requestId?: string;
    agentRunId?: string;
    endpoint?: string;
    clientOrigin?: string;
    from?: string | Date;
    to?: string | Date;
    limit?: number;
    order?: "asc" | "desc";
}
export interface UsageSummaryGroup {
    key: string;
    records: number;
    success: number;
    error: number;
    aborted: number;
    skipped: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costUsd: number;
}
export interface UsageSummary extends UsageSummaryGroup {
    byProvider: UsageSummaryGroup[];
    byModel: UsageSummaryGroup[];
    byEndpoint: UsageSummaryGroup[];
    byClientOrigin: UsageSummaryGroup[];
}
export declare function createUsageRecordId(prefix?: string): string;
export declare function queryUsageRecords(records: readonly UsageRecord[], query?: UsageRecordQuery): UsageRecord[];
export declare function summarizeUsageRecords(records: readonly UsageRecord[]): UsageSummary;
export declare class InMemoryUsageStore implements UsageStore {
    private readonly records;
    recordUsage(record: UsageRecord): void;
    getUsageRecords(): UsageRecord[];
    clear(): void;
}
export declare function createInMemoryUsageStore(): InMemoryUsageStore;
export declare class InMemoryProviderConnectionStore implements ProviderConnectionStore {
    private readonly connections;
    private readonly proxyPools;
    private settings;
    constructor(initialState?: Partial<ProviderConnectionJsonState>);
    getProviderConnections(filter?: ProviderConnectionFilter): Promise<ProviderConnection[]>;
    getProviderConnectionById(id: string): Promise<ProviderConnection | null>;
    createProviderConnection(data: CreateProviderConnectionInput): Promise<ProviderConnection>;
    updateProviderConnection(id: string, data: UpdateProviderConnectionInput): Promise<ProviderConnection | null>;
    deleteProviderConnection(id: string): Promise<ProviderConnection | null>;
    getSettings(): Promise<ProviderConnectionSettings>;
    updateSettings(updates: ProviderConnectionSettings): Promise<ProviderConnectionSettings>;
    getProxyPools(filter?: ProxyPoolFilter): Promise<ProxyPool[]>;
    getProxyPoolById(id: string): Promise<ProxyPool | null>;
    createProxyPool(data: CreateProxyPoolInput): Promise<ProxyPool>;
    updateProxyPool(id: string, data: UpdateProxyPoolInput): Promise<ProxyPool | null>;
    deleteProxyPool(id: string): Promise<ProxyPool | null>;
    clear(): void;
}
export declare function createInMemoryProviderConnectionStore(initialState?: Partial<ProviderConnectionJsonState>): InMemoryProviderConnectionStore;
export declare class JsonlUsageStore implements UsageStore {
    private readonly filePath;
    constructor(filePath: string);
    recordUsage(record: UsageRecord): Promise<void>;
    getUsageRecords(): Promise<UsageRecord[]>;
}
export declare function createJsonlUsageStore(filePath: string): JsonlUsageStore;
export declare class JsonProviderConnectionStore implements ProviderConnectionStore {
    private readonly filePath;
    constructor(filePath: string);
    getProviderConnections(filter?: ProviderConnectionFilter): Promise<ProviderConnection[]>;
    getProviderConnectionById(id: string): Promise<ProviderConnection | null>;
    createProviderConnection(data: CreateProviderConnectionInput): Promise<ProviderConnection>;
    updateProviderConnection(id: string, data: UpdateProviderConnectionInput): Promise<ProviderConnection | null>;
    deleteProviderConnection(id: string): Promise<ProviderConnection | null>;
    getSettings(): Promise<ProviderConnectionSettings>;
    updateSettings(updates: ProviderConnectionSettings): Promise<ProviderConnectionSettings>;
    getProxyPools(filter?: ProxyPoolFilter): Promise<ProxyPool[]>;
    getProxyPoolById(id: string): Promise<ProxyPool | null>;
    createProxyPool(data: CreateProxyPoolInput): Promise<ProxyPool>;
    updateProxyPool(id: string, data: UpdateProxyPoolInput): Promise<ProxyPool | null>;
    deleteProxyPool(id: string): Promise<ProxyPool | null>;
    private readState;
    private writeState;
}
export declare function createJsonProviderConnectionStore(filePath: string): JsonProviderConnectionStore;
export declare function createProxyPoolId(): string;
//# sourceMappingURL=index.d.ts.map