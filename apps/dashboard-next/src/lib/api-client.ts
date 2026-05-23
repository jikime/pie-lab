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
}

export interface UsageResponse {
  count: number
  records: UsageRecord[]
}

export interface UsageSummaryResponse {
  count: number
  summary: UsageSummary
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

export interface ProviderConnectionsResponse {
  count: number
  connections: ProviderConnectionSummary[]
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
  eligible: boolean
  proxyPoolId?: string | null
  quotaStatus?: string
  quotaSummary?: string
  quotaSelection?: {
    available: boolean
    reason?: string
    score?: number
    remainingPercentage?: number | null
  }
  lastError?: unknown
  lastErrorAt?: string | null
}

export interface ProviderQuotaResponse {
  count: number
  data: ProviderQuotaConnectionStatus[]
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
  usageSummary: () => apiRequest<UsageSummaryResponse>("/usage/summary?order=desc"),
  providers: () => apiRequest<ProviderStatusResponse>("/providers"),
  providerProbes: () => apiRequest<ProviderProbeResponse>("/providers/probe"),
  providerConnections: () => apiRequest<ProviderConnectionsResponse>("/provider-connections"),
  providerSettings: () => apiRequest<ProviderSettingsResponse>("/provider-settings"),
  saveProviderSettings: (settings: ProviderConnectionSettings) =>
    apiRequest<ProviderSettingsResponse>("/provider-settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    }),
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
  quota: () => apiRequest<ProviderQuotaResponse>("/quota"),
  proxyPools: () => apiRequest<ProxyPoolResponse>("/proxy-pools?includeUsage=true"),
  createProxyPool: (input: { name: string; type: "http" | "vercel"; proxyUrl?: string; noProxy?: string }) =>
    apiRequest<{ proxyPool: ProxyPool }>("/proxy-pools", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  testProxyPool: (id: string) =>
    apiRequest<ProxyPoolTestResponse>(`/proxy-pools/${encodeURIComponent(id)}/test`, {
      method: "POST",
    }),
  mediaRoutes: () => apiRequest<MediaRoutesResponse>("/media/routes"),
}
