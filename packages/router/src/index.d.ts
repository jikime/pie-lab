export type RoutingMode = "fixed" | "router" | "fallback";
export * from "./rtk.js";
export type RouterIntent = "coding" | "chat" | "reasoning" | "vision" | "general" | (string & {});
export type RouterBudget = "low" | "medium" | "high";
export type RouterLatency = "low" | "normal";
export type RouteSource = "fixed" | "router" | "fallback";
export type ComboStrategy = "fallback" | "round-robin";
export type ModelSelection = {
    mode: "fixed";
    model: string;
} | {
    mode: "router";
    intent: RouterIntent;
    constraints?: RouterConstraints;
    alias?: string;
} | {
    mode: "fallback";
    primary: string;
    fallback?: string | string[];
};
export interface RouterConstraints {
    budget?: RouterBudget;
    latency?: RouterLatency;
    quality?: "low" | "medium" | "high";
    requireTools?: boolean;
    requireVision?: boolean;
    minContextTokens?: number;
    maxCostUsd?: number;
}
export interface ResolvedRoute {
    requestedModel: string;
    routingMode: RoutingMode;
    resolvedProvider: string;
    resolvedModel: string;
    connectionId?: string;
    source?: RouteSource;
    mode: RoutingMode;
}
export interface RouteCandidate {
    provider: string;
    model: string;
    connectionId?: string;
    source?: RouteSource;
}
export interface RouteResolver {
    resolveModel?: (model: string, selection: Extract<ModelSelection, {
        mode: "fixed" | "fallback";
    }>) => RouteCandidate | null | undefined | Promise<RouteCandidate | null | undefined>;
    resolveIntent?: (intent: RouterIntent, selection: Extract<ModelSelection, {
        mode: "router";
    }>) => RouteCandidate | null | undefined | Promise<RouteCandidate | null | undefined>;
}
export interface ResolveRouteOptions {
    requestedModel: string | ModelSelection;
    resolver?: RouteResolver;
}
export declare const PIE_LAB_ROUTER_PROVIDER = "pie-lab-router";
export declare const PIE_LAB_ROUTER_MODEL_IDS: readonly ["auto:coding", "auto:chat", "auto:reasoning", "auto:learning", "auto:memory", "cheap:coding", "fast:chat", "combo:coding"];
export interface PiModelReference {
    provider: string;
    id: string;
    name?: string;
    input?: string[];
    cost?: {
        input: number;
        output: number;
        cacheRead?: number;
        cacheWrite?: number;
    };
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
}
export interface PiModelCatalog<TModel extends PiModelReference = PiModelReference> {
    find(provider: string, modelId: string): TModel | undefined;
    getAvailable(): TModel[];
    getAll?(): TModel[];
}
export interface PiRouterCombo {
    name: string;
    models: string[];
    kind?: string | null;
    strategy?: ComboStrategy;
    stickyLimit?: number | string;
}
export type PiRouterCombosData = PiRouterCombo[] | {
    combos?: PiRouterCombo[];
};
export interface PiRouterComboStrategyConfig {
    strategy?: ComboStrategy;
    stickyLimit?: number | string;
}
export interface PiRouterPolicy {
    aliases?: Record<string, string | string[]>;
    intents?: Partial<Record<RouterIntent, string | string[]>>;
    combos?: PiRouterCombosData;
    comboStrategy?: ComboStrategy;
    comboStickyLimit?: number | string;
    comboStrategies?: Record<string, ComboStrategy | PiRouterComboStrategyConfig>;
}
export interface ResolvePiModelRouteOptions<TModel extends PiModelReference = PiModelReference> {
    requestedModel: string | ModelSelection | TModel;
    catalog: PiModelCatalog<TModel>;
    policy?: PiRouterPolicy;
    resolver?: RouteResolver;
}
export interface ResolvedPiModelRoute<TModel extends PiModelReference = PiModelReference> {
    route: ResolvedRoute;
    model: TModel;
}
export interface ResolvedRoutePlan<TRoute = ResolvedRoute> {
    requestedModel: string;
    routingMode: RoutingMode;
    routes: TRoute[];
    primary: TRoute;
}
export type ResolvedPiModelRoutePlan<TModel extends PiModelReference = PiModelReference> = ResolvedRoutePlan<ResolvedPiModelRoute<TModel>>;
export declare const ROUTER_BACKOFF_CONFIG: {
    readonly base: 2000;
    readonly max: number;
    readonly maxLevel: 15;
};
export declare const ROUTER_TRANSIENT_COOLDOWN_MS: number;
export declare const ROUTER_MAX_RATE_LIMIT_COOLDOWN_MS: number;
export interface RouterErrorRule {
    text?: string;
    status?: number;
    cooldownMs?: number;
    backoff?: boolean;
}
export interface RouterFallbackDecision {
    shouldFallback: boolean;
    cooldownMs: number;
    newBackoffLevel?: number;
}
export declare const ROUTER_ERROR_RULES: RouterErrorRule[];
export declare const MODEL_LOCK_PREFIX = "modelLock_";
export declare const MODEL_LOCK_ALL = "modelLock___all";
export interface RouterAccountState {
    id?: string;
    rateLimitedUntil?: string | null;
    backoffLevel?: number | null;
    lastError?: unknown;
    status?: string;
    [key: string]: unknown;
}
export type AccountSelectionStrategy = "fill-first" | "round-robin" | "quota-aware";
export type QuotaSelectionStrategy = "off" | "prefer-remaining" | "require-remaining";
export declare const PIE_LAB_QUOTA_SELECTION_KEY = "pieLabQuotaSelection";
export interface ProviderQuotaSelectionSnapshot {
    checkedAt?: string;
    status?: "available" | "depleted" | "unknown" | "error";
    score?: number | null;
    remainingPercentage?: number | null;
    resetAt?: string | null;
    message?: string | null;
    [key: string]: unknown;
}
export interface ProviderConnectionReference extends RouterAccountState {
    id: string;
    provider: string;
    isActive?: boolean;
    priority?: number | null;
    lastUsedAt?: string | null;
    consecutiveUseCount?: number | null;
    errorCode?: string | number | null;
    providerSpecificData?: Record<string, unknown> | null;
}
export interface ProviderAccountStrategyConfig {
    fallbackStrategy?: AccountSelectionStrategy;
    stickyRoundRobinLimit?: number | string;
    quotaStrategy?: QuotaSelectionStrategy;
    quotaMinRemainingPercentage?: number | string;
    quotaMaxAgeMs?: number | string;
    quotaRefreshBeforeSelection?: boolean;
    quotaRefreshTtlMs?: number | string;
}
export interface ProviderAccountSelectionSettings {
    fallbackStrategy?: AccountSelectionStrategy;
    stickyRoundRobinLimit?: number | string;
    quotaStrategy?: QuotaSelectionStrategy;
    quotaMinRemainingPercentage?: number | string;
    quotaMaxAgeMs?: number | string;
    quotaRefreshBeforeSelection?: boolean;
    quotaRefreshTtlMs?: number | string;
    providerStrategies?: Record<string, ProviderAccountStrategyConfig>;
}
export interface SelectProviderConnectionOptions<TConnection extends ProviderConnectionReference> {
    provider: string;
    model?: string | null;
    connections: readonly TConnection[];
    settings?: ProviderAccountSelectionSettings;
    excludeConnectionIds?: string | string[] | Set<string> | null;
    preferredConnectionId?: string | null;
    now?: Date;
}
export type ProviderConnectionSelectionResult<TConnection extends ProviderConnectionReference> = {
    status: "selected";
    connection: TConnection;
    updates?: Record<string, unknown>;
} | {
    status: "unavailable";
    retryAfter: string;
    retryAfterHuman: string;
    lastError?: unknown;
    lastErrorCode?: string | number | null;
} | {
    status: "missing";
};
export interface ProviderConnectionCandidateExplanation {
    id: string;
    provider: string;
    isActive: boolean;
    priority: number | null;
    selected: boolean;
    selectable: boolean;
    reasons: string[];
    lastUsedAt?: string | null;
    consecutiveUseCount?: number | null;
    modelLockUntil?: string | null;
    quotaSelection?: ProviderQuotaSelectionSnapshot | null;
    quotaFresh?: boolean;
    quotaScore?: number | null;
    remainingPercentage?: number | null;
}
export interface ProviderConnectionSelectionExplanation {
    provider: string;
    model?: string | null;
    status: ProviderConnectionSelectionResult<ProviderConnectionReference>["status"];
    selectedConnectionId?: string;
    strategy: AccountSelectionStrategy;
    quotaStrategy: QuotaSelectionStrategy;
    quotaMaxAgeMs: number;
    quotaMinRemainingPercentage: number;
    candidates: ProviderConnectionCandidateExplanation[];
    message?: string;
}
export declare class ModelSelectionParseError extends Error {
    constructor(message: string);
}
export declare class RouteResolutionError extends Error {
    constructor(message: string);
}
export declare function getQuotaCooldown(backoffLevel?: number): number;
export declare function checkFallbackError(status: number | undefined, errorText: unknown, backoffLevel?: number): RouterFallbackDecision;
export declare function extractProviderResetCooldownMs(error: unknown, now?: number, maxCooldownMs?: number): number | null;
export declare function isAccountUnavailable(unavailableUntil?: string | null): boolean;
export declare function getUnavailableUntil(cooldownMs: number): string;
export declare function getEarliestRateLimitedUntil(accounts: readonly RouterAccountState[]): string | null;
export declare function formatRetryAfter(rateLimitedUntil?: string | null): string;
export declare function getModelLockKey(model?: string | null): string;
export declare function isModelLockActive(connection: RouterAccountState, model?: string | null): boolean;
export declare function getEarliestModelLockUntil(connection: RouterAccountState | undefined): string | null;
export declare function buildModelLockUpdate(model: string | null | undefined, cooldownMs: number): Record<string, string>;
export declare function buildClearModelLocksUpdate(connection: RouterAccountState): Record<string, null>;
export declare function filterAvailableAccounts<TAccount extends RouterAccountState>(accounts: readonly TAccount[], excludeId?: string | null): TAccount[];
export declare function selectProviderConnection<TConnection extends ProviderConnectionReference>(options: SelectProviderConnectionOptions<TConnection>): ProviderConnectionSelectionResult<TConnection>;
export declare function explainProviderConnectionSelection<TConnection extends ProviderConnectionReference>(options: SelectProviderConnectionOptions<TConnection>): ProviderConnectionSelectionExplanation;
export declare function resetAccountState<TAccount extends RouterAccountState>(account: TAccount): TAccount;
export declare function applyErrorState<TAccount extends RouterAccountState>(account: TAccount, status: number | undefined, errorText: unknown): TAccount;
export declare function getRotatedModels(models: string[], comboName?: string, strategy?: ComboStrategy, stickyLimit?: number | string): string[];
export declare function resetComboRotation(comboName?: string): void;
export declare function getComboModelsFromData(modelStr: string, combosData?: PiRouterCombosData): string[] | null;
export declare function parseModelSelection(input: string | ModelSelection): ModelSelection;
export declare function formatModelSelection(selection: ModelSelection): string;
export declare function getRoutingMode(input: string | ModelSelection): RoutingMode;
export declare function isRouterAlias(input: string): boolean;
export declare function resolveRoute(options: ResolveRouteOptions): Promise<ResolvedRoute>;
export declare function isPiRouterProvider(provider: string): boolean;
export declare function isPiRouterModel(model: PiModelReference): boolean;
export declare function piModelToSelection(model: PiModelReference): string;
export declare function createPiRouteResolver<TModel extends PiModelReference>(catalog: PiModelCatalog<TModel>, policy?: PiRouterPolicy): RouteResolver;
export declare function resolvePiModelRoute<TModel extends PiModelReference>(options: ResolvePiModelRouteOptions<TModel>): Promise<ResolvedPiModelRoute<TModel>>;
export declare function resolvePiModelRoutePlan<TModel extends PiModelReference>(options: ResolvePiModelRouteOptions<TModel>): Promise<ResolvedPiModelRoutePlan<TModel>>;
//# sourceMappingURL=index.d.ts.map