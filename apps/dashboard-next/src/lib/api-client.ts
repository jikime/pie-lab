export const API_BASE_URL =
  process.env.NEXT_PUBLIC_PIE_API_BASE_URL ?? "http://127.0.0.1:4873"

export type UsageRecordStatus = "success" | "error" | "aborted" | "skipped"

export interface UsageTokens {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  totalTokens?: number
  estimated?: boolean
}

export interface UsageCost {
  total?: number
  currency?: string
  pricingSource?: string
}

export interface UsageRecord {
  id: string
  requestId: string
  timestamp: string
  requestedModel: string
  routingMode: "fixed" | "router" | "fallback"
  routeSource?: "fixed" | "router" | "fallback"
  resolvedProvider: string
  resolvedModel: string
  connectionId?: string
  attemptIndex: number
  attemptCount: number
  endpoint?: string
  clientOrigin?: string
  status: UsageRecordStatus
  usage?: UsageTokens
  cost?: UsageCost
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  errorMessage?: string
}

export interface UsageSummaryGroup {
  key: string
  records: number
  success: number
  error: number
  aborted: number
  skipped: number
  totalTokens: number
  costUsd: number
}

export interface UsageSummary {
  records: number
  success: number
  error: number
  aborted: number
  skipped: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
  byProvider: UsageSummaryGroup[]
  byModel: UsageSummaryGroup[]
  byEndpoint: UsageSummaryGroup[]
  byClientOrigin: UsageSummaryGroup[]
}

export interface UsageResponse {
  count: number
  records: UsageRecord[]
}

export interface UsageSummaryResponse {
  count: number
  summary: UsageSummary
}

export interface UsageTimelineItem {
  id: string
  timestamp: string
  status: UsageRecordStatus
  endpoint?: string
  clientOrigin?: string
  requestedModel: string
  resolvedProvider: string
  resolvedModel: string
  connectionId?: string
  attemptIndex: number
  attemptCount: number
  routeSource?: string
  tokens: number
  costUsd: number
  errorMessage?: string
}

export interface UsageTraceEvent {
  recordId: string
  requestId: string
  eventIndex: number
  timestamp: string
  phase: string
  message?: string
  provider?: string
  model?: string
  connectionId?: string
  attemptIndex?: number
  status?: string
  metadata?: Record<string, unknown>
}

export interface UsageDetailResponse {
  requestId: string
  count: number
  summary: UsageSummary
  records: UsageRecord[]
  timeline: UsageTimelineItem[]
  trace?: UsageTraceEvent[]
}

export interface ProviderStatus {
  id: string
  name: string
  configured: boolean
  authSource?: string
  authLabel?: string
  models: number
  availableModels: number
  connectionCount: number
  activeConnectionCount: number
  errorConnectionCount: number
  cooldownLockCount: number
  quotaAvailableCount: number
  quotaDepletedCount: number
  health: "healthy" | "degraded" | "cooldown" | "missing"
  healthReason: string
}

export interface ProviderStatusResponse {
  count: number
  data: ProviderStatus[]
}

export interface ProviderConnectionSummary {
  id: string
  provider: string
  authType: string
  name?: string | null
  displayName?: string | null
  email?: string | null
  priority?: number | null
  isActive: boolean
  hasApiKey: boolean
  hasAccessToken: boolean
  hasRefreshToken: boolean
  projectId?: string | null
  providerSpecificData?: Record<string, unknown> | null
  lastUsedAt?: string | null
  consecutiveUseCount?: number | null
  testStatus?: string | null
  lastError?: unknown
  lastErrorAt?: string | null
  errorCode?: string | number | null
  backoffLevel?: number | null
  createdAt: string
  updatedAt: string
}

export interface CreateProviderConnectionInput {
  provider: string
  authType?: string
  name?: string | null
  displayName?: string | null
  email?: string | null
  priority?: number | null
  isActive?: boolean
  apiKey?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  projectId?: string | null
  providerSpecificData?: Record<string, unknown> | null
}

export type UpdateProviderConnectionInput = Partial<CreateProviderConnectionInput>

export interface ProviderConnectionsResponse {
  count: number
  connections: ProviderConnectionSummary[]
}

export interface OAuthProviderSummary {
  id: string
  aliases: string[]
  name: string
  connectionProvider: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
}

export interface OAuthProvidersResponse {
  providers: OAuthProviderSummary[]
}

export interface OAuthStartResponse {
  provider: string
  authorizationUrl: string
  state: string
  codeVerifier: string
  redirectUri: string
}

export interface OAuthCallbackInput {
  provider: string
  code: string
  state?: string
  codeVerifier: string
  redirectUri: string
  email?: string
  projectId?: string
  connectionProvider?: string
  providerSpecificData?: Record<string, unknown>
}

export interface OAuthCallbackResponse {
  provider: string
  connection: ProviderConnectionSummary
}

export interface ProviderProbeCheck {
  name: string
  status: "pass" | "warn" | "fail" | "skip"
  message: string
}

export interface ProviderConnectionProbe {
  id: string
  name?: string | null
  authType: string
  isActive: boolean
  status: "healthy" | "warning" | "blocked" | "missing"
  checks: ProviderProbeCheck[]
}

export interface ProviderProbe {
  id: string
  name: string
  status: "healthy" | "warning" | "blocked" | "missing"
  checkedAt: string
  checks: ProviderProbeCheck[]
  connections: ProviderConnectionProbe[]
}

export interface ProviderProbeResponse {
  count: number
  data: ProviderProbe[]
}

export interface BudgetLimitSettings {
  mode?: "off" | "warn" | "block"
  requestUsd?: number | string | null
  dailyUsd?: number | string | null
  monthlyUsd?: number | string | null
  providerLimits?: Record<
    string,
    {
      mode?: "off" | "warn" | "block"
      requestUsd?: number | string | null
      dailyUsd?: number | string | null
      monthlyUsd?: number | string | null
    }
  >
}

export interface ProviderConnectionSettings {
  fallbackStrategy?: string
  stickyRoundRobinLimit?: number | string
  quotaStrategy?: string
  quotaMinRemainingPercentage?: number | string
  quotaMaxAgeMs?: number | string
  quotaRefreshBeforeSelection?: boolean
  quotaRefreshTtlMs?: number | string
  rtkEnabled?: boolean
  budgetLimits?: BudgetLimitSettings
  providerStrategies?: Record<string, unknown>
  routerPolicy?: RouterPolicy
}

export interface ProviderSettingsResponse {
  settings: ProviderConnectionSettings
}

export interface BudgetUsageWindow {
  from: string
  to: string
  usedUsd: number
  limitUsd: number | null
  projectedUsd: number
  remainingUsd: number | null
  usedPercentage: number | null
  exhausted: boolean
}

export interface BudgetViolation {
  scope: "request" | "daily" | "monthly"
  provider?: string | null
  limitUsd: number
  usedUsd: number
  estimatedUsd: number
  projectedUsd: number
  message: string
}

export interface BudgetStatus {
  mode: "off" | "warn" | "block"
  provider: string | null
  requestLimitUsd: number | null
  estimatedRequestUsd: number | null
  daily: BudgetUsageWindow
  monthly: BudgetUsageWindow
  violations: BudgetViolation[]
  shouldWarn: boolean
  shouldBlock: boolean
  generatedAt: string
}

export interface BudgetResponse {
  budget: BudgetStatus
}

export interface RouterPolicyCombo {
  name: string
  models?: string[]
  strategy?: string
  stickyLimit?: number
}

export interface RouterPolicy {
  aliases?: Record<string, string | string[]>
  intents?: Record<string, string | string[]>
  combos?: RouterPolicyCombo[]
  comboStrategy?: string
  comboStickyLimit?: number
  comboStrategies?: Record<string, string>
}

export interface RoutingPolicyResponse {
  policy: RouterPolicy
}

export interface RoutingPolicyPreviewResponse {
  requestedModel: string
  routingMode: string
  routes: Array<{
    index: number
    source: string
    provider: string
    model: string
    id: string
  }>
}

export interface RoutingPolicyMapping {
  name: string
  models: string[]
}

export interface SaveRoutingComboInput {
  name: string
  models: string | string[]
  strategy?: "fallback" | "round-robin"
  stickyLimit?: number | string
}

export interface SaveRoutingMappingInput {
  name: string
  models: string | string[]
}

export interface AccountSelectionGroup {
  provider: string
  model?: string | null
  selected?: ProviderConnectionSummary | null
  candidates?: Array<{
    connection: ProviderConnectionSummary
    status: "selected" | "unavailable" | "missing"
    score?: number
    reasons?: string[]
  }>
  unavailable?: Array<{
    connection: ProviderConnectionSummary
    reasons?: string[]
  }>
  reason?: string
}

export interface AccountSelectionResponse {
  count: number
  data: AccountSelectionGroup[]
}

export interface ProviderQuotaConnectionStatus {
  id: string
  provider: string
  authType: string
  name?: string | null
  displayName?: string | null
  email?: string | null
  isActive: boolean
  supported?: boolean
  eligible: boolean
  usageAuthType?: "oauth" | "apikey" | "unsupported"
  proxyPoolId?: string | null
  testStatus?: string | null
  quotaStatus?: string
  quotaSummary?: string
  quotaSelection?: {
    available?: boolean
    reason?: string
    score?: number
    remainingPercentage?: number | null
    checkedAt?: string
    status?: string
    resetAt?: string | null
    message?: string | null
  }
  lastError?: unknown
  lastErrorAt?: string | null
}

export interface ProviderQuotaResponse {
  count: number
  data: ProviderQuotaConnectionStatus[]
}

export interface ProviderQuotaWindow {
  used: number
  total: number
  remaining?: number
  remainingPercentage?: number
  resetAt?: string | number | null
  unlimited?: boolean
  displayName?: string
}

export interface ProviderUsageResult {
  plan?: string
  resetDate?: string | number | null
  message?: string
  quotas?: Record<string, ProviderQuotaWindow>
}

export interface ProviderQuotaDetailResponse {
  connection: ProviderQuotaConnectionStatus
  usage: ProviderUsageResult
}

export interface ModelAvailabilityLock {
  key: string
  scope: "model" | "all"
  model: string | null
  until: string
  retryAfterMs: number
  retryAfterHuman: string
}

export interface ModelAvailabilityConnection {
  id: string
  provider: string
  authType: string
  name?: string | null
  displayName?: string | null
  email?: string | null
  isActive: boolean
  testStatus?: string | null
  lastError?: unknown
  lastErrorAt?: string | null
  errorCode?: string | number | null
  backoffLevel?: number | null
  locks: ModelAvailabilityLock[]
}

export interface ModelAvailabilityModelLockSummary {
  provider: string
  model: string | null
  scope: "model" | "all"
  activeConnectionCount: number
  connectionIds: string[]
  earliestRetryAfter: string
  earliestRetryAfterHuman: string
}

export interface ModelAvailabilityResponse {
  generatedAt: string
  count: number
  lockedConnectionCount: number
  lockedModelCount: number
  data: ModelAvailabilityConnection[]
  lockedModels: ModelAvailabilityModelLockSummary[]
}

export interface ModelAvailabilityClearCooldownResponse {
  ok: true
  provider: string
  model: string
  lockKey: string
  clearedCount: number
}

export interface ProxyPool {
  id: string
  name: string
  type: "http" | "vercel"
  proxyUrl?: string | null
  noProxy?: string | null
  isActive: boolean
  strictProxy?: boolean | null
  testStatus?: string | null
  lastTestedAt?: string | null
  lastError?: string | null
  boundConnectionCount?: number
}

export interface ProxyPoolResponse {
  count: number
  proxyPools: ProxyPool[]
}

export interface ProxyPoolTestResponse {
  ok: boolean
  status: number
  statusText?: string
  url?: string
  elapsedMs?: number
  error?: string
}

export interface ProviderConnectionProxyAssignmentResponse {
  connection: {
    id: string
    provider: string
    authType: string
    name?: string | null
    displayName?: string | null
    email?: string | null
    isActive: boolean
    proxyPoolId?: string | null
    updatedAt: string
  } | null
}

export interface MediaRoute {
  provider: string
  kind: "embedding" | "webSearch" | "webFetch" | "tts" | "stt" | "image"
  authHeader: string
  format?: string | null
  noAuth: boolean
  costPerQuery?: number | null
  timeoutMs?: number | null
  defaultCandidates: string[]
}

export interface MediaRoutesResponse {
  count: number
  routes: MediaRoute[]
  aliases: Record<string, string[]>
}

export type MediaKind = MediaRoute["kind"]

export interface MediaTestResponse {
  ok: boolean
  status: number
  statusText: string
  contentType: string
  bodyText: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message)
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  })
  const text = await response.text()
  const body = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    throw new ApiError(readErrorMessage(body) ?? response.statusText, response.status, body)
  }

  return body as T
}

function readErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const data = body as { error?: unknown }
  if (typeof data.error === "string") return data.error
  if (data.error && typeof data.error === "object" && "message" in data.error) {
    const message = (data.error as { message?: unknown }).message
    return typeof message === "string" ? message : undefined
  }
  return undefined
}

export const dashboardApi = {
  health: () => apiRequest<{ ok: boolean }>("/health"),
  usage: (limit = 50) => apiRequest<UsageResponse>(`/usage?limit=${limit}&order=desc`),
  usageDetail: (requestId: string, init?: RequestInit) =>
    apiRequest<UsageDetailResponse>(`/usage/${encodeURIComponent(requestId)}`, init),
  usageSummary: () => apiRequest<UsageSummaryResponse>("/usage/summary?order=desc"),
  providers: () => apiRequest<ProviderStatusResponse>("/providers"),
  providerProbes: () => apiRequest<ProviderProbeResponse>("/providers/probe"),
  providerConnections: () => apiRequest<ProviderConnectionsResponse>("/provider-connections"),
  createProviderConnection: (input: CreateProviderConnectionInput) =>
    apiRequest<{ connection: ProviderConnectionSummary }>("/provider-connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProviderConnection: (id: string, input: UpdateProviderConnectionInput) =>
    apiRequest<{ connection: ProviderConnectionSummary | null }>(`/provider-connections/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteProviderConnection: (id: string) =>
    apiRequest<{ success: boolean; deleted: boolean; connection?: ProviderConnectionSummary | null }>(
      `/provider-connections/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  oauthProviders: () => apiRequest<OAuthProvidersResponse>("/oauth/providers"),
  startOAuthLogin: (provider: string, redirectUri: string) =>
    apiRequest<OAuthStartResponse>(`/oauth/start?provider=${encodeURIComponent(provider)}&redirect_uri=${encodeURIComponent(redirectUri)}`),
  completeOAuthCallback: (input: OAuthCallbackInput) =>
    apiRequest<OAuthCallbackResponse>("/oauth/callback", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  providerSettings: () => apiRequest<ProviderSettingsResponse>("/provider-settings"),
  saveProviderSettings: (settings: ProviderConnectionSettings) =>
    apiRequest<ProviderSettingsResponse>("/provider-settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),
  budget: (input: { provider?: string; estimateUsd?: string | number } = {}) => {
    const params = new URLSearchParams()
    if (input.provider) params.set("provider", input.provider)
    if (input.estimateUsd !== undefined && input.estimateUsd !== "") params.set("estimateUsd", String(input.estimateUsd))
    const query = params.toString()
    return apiRequest<BudgetResponse>(`/budget${query ? `?${query}` : ""}`)
  },
  accountSelection: () => apiRequest<AccountSelectionResponse>("/account-selection"),
  routingPolicy: () => apiRequest<RoutingPolicyResponse>("/routing-policy"),
  saveRoutingPolicy: (policy: RouterPolicy) =>
    apiRequest<RoutingPolicyResponse>("/routing-policy", {
      method: "PUT",
      body: JSON.stringify({ policy }),
    }),
  previewRoutingPolicy: (model: string, policy?: RouterPolicy) =>
    apiRequest<RoutingPolicyPreviewResponse>("/routing-policy/preview", {
      method: "POST",
      body: JSON.stringify({ model, policy }),
    }),
  saveRoutingCombo: (input: SaveRoutingComboInput) =>
    apiRequest<RoutingPolicyResponse & { combo: RouterPolicyCombo }>("/routing-policy/combos", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteRoutingCombo: (name: string) =>
    apiRequest<RoutingPolicyResponse & { deleted: string }>(`/routing-policy/combos/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  saveRoutingAlias: (input: SaveRoutingMappingInput) =>
    apiRequest<RoutingPolicyResponse & { alias: RoutingPolicyMapping }>("/routing-policy/aliases", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteRoutingAlias: (name: string) =>
    apiRequest<RoutingPolicyResponse & { deleted: string }>(`/routing-policy/aliases/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  saveRoutingIntent: (input: SaveRoutingMappingInput) =>
    apiRequest<RoutingPolicyResponse & { intent: RoutingPolicyMapping }>("/routing-policy/intents", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteRoutingIntent: (name: string) =>
    apiRequest<RoutingPolicyResponse & { deleted: string }>(`/routing-policy/intents/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  quota: () => apiRequest<ProviderQuotaResponse>("/quota"),
  quotaDetail: (connectionId: string, init?: RequestInit) =>
    apiRequest<ProviderQuotaDetailResponse>(`/quota/${encodeURIComponent(connectionId)}`, init),
  modelAvailability: () => apiRequest<ModelAvailabilityResponse>("/models/availability"),
  clearModelCooldown: (provider: string, model: string) =>
    apiRequest<ModelAvailabilityClearCooldownResponse>("/models/availability", {
      method: "POST",
      body: JSON.stringify({ action: "clearCooldown", provider, model }),
    }),
  proxyPools: () => apiRequest<ProxyPoolResponse>("/proxy-pools?includeUsage=true"),
  createProxyPool: (input: { name: string; type: "http" | "vercel"; proxyUrl?: string; noProxy?: string; strictProxy?: boolean }) =>
    apiRequest<{ proxyPool: ProxyPool }>("/proxy-pools", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProxyPool: (id: string, input: Partial<Pick<ProxyPool, "name" | "type" | "proxyUrl" | "noProxy" | "isActive" | "strictProxy">>) =>
    apiRequest<{ proxyPool: ProxyPool | null }>(`/proxy-pools/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteProxyPool: (id: string) =>
    apiRequest<{ success: boolean }>(`/proxy-pools/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  testProxyPool: (id: string) =>
    apiRequest<ProxyPoolTestResponse>(`/proxy-pools/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  assignConnectionProxyPool: (connectionId: string, proxyPoolId: string | null) =>
    apiRequest<ProviderConnectionProxyAssignmentResponse>(`/provider-connections/${encodeURIComponent(connectionId)}`, {
      method: "PUT",
      body: JSON.stringify({ proxyPoolId }),
    }),
  mediaRoutes: () => apiRequest<MediaRoutesResponse>("/media/routes"),
  testMediaEndpoint: (kind: MediaKind, input: Record<string, unknown>, file?: File) =>
    mediaTestRequest(kind, input, file),
}

async function mediaTestRequest(kind: MediaKind, input: Record<string, unknown>, file?: File): Promise<MediaTestResponse> {
  const endpoint = mediaEndpoint(kind)
  const init: RequestInit =
    kind === "stt"
      ? {
          method: "POST",
          headers: {
            "x-pie-client-origin": "dashboard-next:media-test",
          },
          body: createMediaFormData(input, file),
        }
      : {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-pie-client-origin": "dashboard-next:media-test",
          },
          body: JSON.stringify(input),
        }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, init)
  const contentType = response.headers.get("content-type") ?? ""
  const bodyText = await readMediaTestBody(response, contentType)
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    contentType,
    bodyText,
  }
}

function mediaEndpoint(kind: MediaKind): string {
  switch (kind) {
    case "embedding":
      return "/v1/embeddings"
    case "webSearch":
      return "/v1/search"
    case "webFetch":
      return "/v1/web/fetch"
    case "tts":
      return "/v1/audio/speech?response_format=json"
    case "stt":
      return "/v1/audio/transcriptions"
    case "image":
      return "/v1/images/generations"
  }
}

function createMediaFormData(input: Record<string, unknown>, file?: File): FormData {
  const formData = new FormData()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || key === "file") continue
    formData.set(key, String(value))
  }
  if (file) formData.set("file", file)
  return formData
}

async function readMediaTestBody(response: Response, contentType: string): Promise<string> {
  if (contentType.includes("application/json") || contentType.startsWith("text/")) {
    return await response.text()
  }

  const buffer = await response.arrayBuffer()
  return `[${contentType || "binary"} response, ${buffer.byteLength} bytes]`
}
