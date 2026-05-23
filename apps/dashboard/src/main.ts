import "./styles.css";

type UsageRecordStatus = "success" | "error" | "aborted" | "skipped";

interface UsageTokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	reasoning?: number;
	totalTokens: number;
	estimated?: boolean;
}

interface UsageCost {
	total: number;
	currency: "USD";
	pricingSource: string;
}

interface UsageTokenSaver {
	provider: string;
	bytesBefore: number;
	bytesAfter: number;
	bytesSaved: number;
	hits: number;
	filters: string[];
}

interface UsageRecord {
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
	status: UsageRecordStatus;
	usage?: UsageTokens;
	cost?: UsageCost;
	tokenSaver?: UsageTokenSaver;
	inputTokens?: number;
	outputTokens?: number;
	costUsd?: number;
	errorMessage?: string;
}

interface UsageSummary {
	records: number;
	success: number;
	error: number;
	aborted: number;
	skipped: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	costUsd: number;
	byProvider: UsageSummaryGroup[];
	byModel: UsageSummaryGroup[];
}

interface UsageSummaryGroup {
	key: string;
	records: number;
	success: number;
	error: number;
	aborted: number;
	skipped: number;
	totalTokens: number;
	costUsd: number;
}

interface UsageResponse {
	count: number;
	records: UsageRecord[];
}

interface SummaryResponse {
	count: number;
	summary: UsageSummary;
}

interface ProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	authSource?: string;
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

interface ProviderStatusResponse {
	count: number;
	data: ProviderStatus[];
}

interface ProviderProbeCheck {
	name: string;
	status: "pass" | "warn" | "fail" | "skip";
	message: string;
}

interface ProviderConnectionProbe {
	id: string;
	name?: string | null;
	authType: string;
	isActive: boolean;
	status: "healthy" | "warning" | "blocked" | "missing";
	checks: ProviderProbeCheck[];
}

interface ProviderProbe {
	id: string;
	name: string;
	status: "healthy" | "warning" | "blocked" | "missing";
	checkedAt: string;
	checks: ProviderProbeCheck[];
	connections: ProviderConnectionProbe[];
}

interface ProviderProbeResponse {
	count: number;
	data: ProviderProbe[];
}

interface ProviderConnectionSummary {
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
}

type BudgetPolicyMode = "off" | "warn" | "block";

interface BudgetLimitSettings {
	mode?: BudgetPolicyMode;
	requestUsd?: number | string | null;
	dailyUsd?: number | string | null;
	monthlyUsd?: number | string | null;
	providerLimits?: Record<string, { mode?: BudgetPolicyMode; requestUsd?: number | string | null; dailyUsd?: number | string | null; monthlyUsd?: number | string | null }>;
}

interface ProviderConnectionSettings {
	fallbackStrategy?: string;
	stickyRoundRobinLimit?: number | string;
	quotaStrategy?: string;
	quotaMinRemainingPercentage?: number | string;
	quotaMaxAgeMs?: number | string;
	quotaRefreshBeforeSelection?: boolean;
	quotaRefreshTtlMs?: number | string;
	rtkEnabled?: boolean;
	budgetLimits?: BudgetLimitSettings;
}

interface ProviderSettingsResponse {
	settings: ProviderConnectionSettings;
}

interface BudgetUsageWindow {
	from: string;
	to: string;
	usedUsd: number;
	limitUsd: number | null;
	projectedUsd: number;
	remainingUsd: number | null;
	usedPercentage: number | null;
	exhausted: boolean;
}

interface BudgetStatus {
	mode: BudgetPolicyMode;
	provider: string | null;
	requestLimitUsd: number | null;
	estimatedRequestUsd: number | null;
	daily: BudgetUsageWindow;
	monthly: BudgetUsageWindow;
	violations: Array<{ scope: string; message: string; limitUsd: number; projectedUsd: number }>;
	shouldWarn: boolean;
	shouldBlock: boolean;
	generatedAt: string;
}

interface BudgetStatusResponse {
	budget: BudgetStatus;
}

interface OAuthStartResponse {
	provider: string;
	authorizationUrl: string;
	state: string;
	codeVerifier: string;
	redirectUri: string;
}

interface OAuthCallbackResponse {
	provider: string;
	connection: ProviderConnectionSummary;
}

interface ProviderConnectionsResponse {
	count: number;
	connections: ProviderConnectionSummary[];
}

interface AccountSelectionCandidate {
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
	quotaFresh?: boolean;
	quotaScore?: number | null;
	remainingPercentage?: number | null;
}

interface AccountSelectionGroup {
	provider: string;
	model?: string | null;
	status: "selected" | "unavailable" | "missing";
	selectedConnectionId?: string;
	strategy: string;
	quotaStrategy: string;
	candidates: AccountSelectionCandidate[];
	message?: string;
}

interface AccountSelectionResponse {
	count: number;
	data: AccountSelectionGroup[];
}

type RouterComboStrategy = "fallback" | "round-robin";

interface RouterPolicyCombo {
	name: string;
	models: string[];
	kind?: string | null;
	strategy?: RouterComboStrategy;
	stickyLimit?: number | string;
}

interface RouterPolicy {
	aliases?: Record<string, string | string[]>;
	intents?: Record<string, string | string[]>;
	combos?: RouterPolicyCombo[] | { combos?: RouterPolicyCombo[] };
	comboStrategy?: RouterComboStrategy;
	comboStickyLimit?: number | string;
	comboStrategies?: Record<string, RouterComboStrategy | { strategy?: RouterComboStrategy; stickyLimit?: number | string }>;
}

interface RouterPolicyMapping {
	name: string;
	models: string[];
}

interface RoutingPolicyResponse {
	policy: RouterPolicy;
}

interface RoutingPolicyPreviewResponse {
	requestedModel: string;
	routingMode: string;
	routes: Array<{ index: number; source?: string; provider: string; model: string; id: string }>;
}

interface ProviderQuotaConnectionStatus {
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
	quotaSelection?: {
		checkedAt?: string;
		status?: string;
		score?: number;
		remainingPercentage?: number | null;
		resetAt?: string | null;
		message?: string | null;
	} | null;
}

interface ProviderQuotaResponse {
	count: number;
	data: ProviderQuotaConnectionStatus[];
}

interface ProviderQuotaWindow {
	used: number;
	total: number;
	remaining?: number;
	remainingPercentage?: number;
	resetAt?: string | null;
	unlimited?: boolean;
	displayName?: string;
}

interface ProviderUsageResult {
	plan?: string;
	resetDate?: string | number | null;
	message?: string;
	quotas?: Record<string, ProviderQuotaWindow>;
}

interface ProviderQuotaDetailResponse {
	connection: ProviderQuotaConnectionStatus;
	usage: ProviderUsageResult;
}

interface ModelAvailabilityLock {
	key: string;
	scope: "model" | "all";
	model: string | null;
	until: string;
	retryAfterMs: number;
	retryAfterHuman: string;
}

interface ModelAvailabilityConnection {
	id: string;
	provider: string;
	authType: string;
	name?: string | null;
	displayName?: string | null;
	email?: string | null;
	isActive: boolean;
	testStatus?: string | null;
	lastError?: unknown;
	lastErrorAt?: string | null;
	errorCode?: string | number | null;
	backoffLevel?: number | null;
	locks: ModelAvailabilityLock[];
}

interface ModelAvailabilityResponse {
	generatedAt: string;
	count: number;
	lockedConnectionCount: number;
	lockedModelCount: number;
	data: ModelAvailabilityConnection[];
}

interface ModelAvailabilityClearCooldownResponse {
	ok: true;
	provider: string;
	model: string;
	lockKey: string;
	clearedCount: number;
}

type ProxyPoolType = "http" | "vercel";

interface ProxyPool {
	id: string;
	name: string;
	type: ProxyPoolType;
	proxyUrl: string;
	noProxy?: string | null;
	isActive: boolean;
	strictProxy?: boolean | null;
	testStatus?: string | null;
	lastTestedAt?: string | null;
	lastError?: unknown;
	boundConnectionCount?: number;
	updatedAt?: string;
}

interface ProxyPoolResponse {
	count: number;
	proxyPools: ProxyPool[];
}

interface ProxyPoolTestResponse {
	ok: boolean;
	status: number;
	statusText?: string | null;
	error?: string | null;
	elapsedMs: number;
	testedAt: string;
}

interface MediaRoute {
	provider: string;
	kind: string;
	authHeader: string;
	format?: string | null;
	noAuth: boolean;
	costPerQuery?: number | null;
	timeoutMs?: number | null;
	defaultCandidates: string[];
}

interface MediaRoutesResponse {
	count: number;
	routes: MediaRoute[];
	aliases: Record<string, string[]>;
}

interface ModelsResponse {
	data: Array<{ id: string; owned_by: string }>;
}

interface UsageDetailResponse {
	requestId: string;
	count: number;
	summary: UsageSummary;
	records: UsageRecord[];
	timeline: Array<{
		id: string;
		timestamp: string;
		status: UsageRecordStatus;
		endpoint?: string;
		requestedModel: string;
		resolvedProvider: string;
		resolvedModel: string;
		connectionId?: string;
		attemptIndex: number;
		attemptCount: number;
		routeSource?: string;
		tokens: number;
		costUsd: number;
		errorMessage?: string;
	}>;
	trace?: Array<{
		recordId: string;
		requestId: string;
		eventIndex: number;
		timestamp: string;
		phase: string;
		message?: string;
		provider?: string;
		model?: string;
		connectionId?: string;
		attemptIndex?: number;
		status?: string;
		metadata?: Record<string, unknown>;
	}>;
}

const DEFAULT_API_BASE =
	import.meta.env.VITE_PIE_LAB_API_BASE ?? import.meta.env.VITE_PIE_ADK_API_BASE ?? "http://127.0.0.1:4873";
const API_BASE_STORAGE_KEY = "pie-lab.dashboard.apiBase";
const OAUTH_FLOW_STORAGE_KEY = "pie-lab.dashboard.oauthFlow";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
	throw new Error("Dashboard root element was not found.");
}

app.innerHTML = `
	<div class="shell">
		<header class="topbar">
			<div>
				<p class="eyebrow">pie-lab</p>
				<h1>사용량 대시보드</h1>
			</div>
			<form class="server-form" id="server-form">
				<label for="api-base">API</label>
				<input id="api-base" name="apiBase" type="url" spellcheck="false" />
				<button type="submit">연결</button>
			</form>
		</header>

		<main>
			<datalist id="model-suggestions"></datalist>
			<section class="toolbar" aria-label="usage filters">
				<label>
					<span>상태</span>
					<select id="status-filter">
						<option value="">전체</option>
						<option value="success">성공</option>
						<option value="error">오류</option>
						<option value="aborted">중단</option>
						<option value="skipped">건너뜀</option>
					</select>
				</label>
				<label>
					<span>Provider</span>
					<input id="provider-filter" type="search" spellcheck="false" placeholder="anthropic" />
				</label>
				<label>
					<span>Model</span>
					<input id="model-filter" type="search" spellcheck="false" placeholder="claude-sonnet-4.5" />
				</label>
				<label>
					<span>Limit</span>
					<select id="limit-filter">
						<option value="20">20</option>
						<option value="50" selected>50</option>
						<option value="100">100</option>
						<option value="250">250</option>
					</select>
				</label>
				<label>
					<span>정렬</span>
					<select id="order-filter">
						<option value="desc" selected>최신순</option>
						<option value="asc">오래된순</option>
					</select>
				</label>
				<button id="refresh-button" type="button">새로고침</button>
			</section>

			<section class="status-line" id="status-line" role="status">대기 중</section>

			<section class="summary-grid" aria-label="usage summary">
				<div class="metric">
					<span>Records</span>
					<strong id="metric-records">0</strong>
				</div>
				<div class="metric">
					<span>Success</span>
					<strong id="metric-success">0</strong>
				</div>
				<div class="metric">
					<span>Errors</span>
					<strong id="metric-errors">0</strong>
				</div>
				<div class="metric">
					<span>Tokens</span>
					<strong id="metric-tokens">0</strong>
				</div>
				<div class="metric">
					<span>Cost</span>
					<strong id="metric-cost">$0.0000</strong>
				</div>
				<div class="metric">
					<span>RTK Saved</span>
					<strong id="metric-rtk-saved">0 B</strong>
				</div>
			</section>

			<section class="table-section provider-connection-section">
				<div class="panel-header">
					<h2>Provider 연결 관리</h2>
				</div>
				<form class="inline-form provider-connection-form" id="provider-connection-form">
					<input id="provider-connection-provider" name="provider" type="text" placeholder="provider" autocomplete="off" spellcheck="false" />
					<input id="provider-connection-name" name="name" type="text" placeholder="이름" autocomplete="off" />
					<select id="provider-connection-auth-type" name="authType">
						<option value="apikey">API key</option>
						<option value="access_token">Access token</option>
						<option value="oauth">OAuth token</option>
					</select>
					<input id="provider-connection-api-key" name="apiKey" type="password" placeholder="API key" autocomplete="off" spellcheck="false" />
					<input id="provider-connection-access-token" name="accessToken" type="password" placeholder="Access token" autocomplete="off" spellcheck="false" />
					<input id="provider-connection-priority" name="priority" type="number" min="1" step="1" placeholder="우선순위" />
					<button type="submit">추가</button>
				</form>
				<form class="inline-form oauth-wizard-form" id="oauth-wizard-form">
					<input id="oauth-provider" name="provider" type="text" placeholder="OAuth provider: claude, gemini-cli, codex" autocomplete="off" spellcheck="false" />
					<input id="oauth-email" name="email" type="email" placeholder="계정 email" autocomplete="off" spellcheck="false" />
					<input id="oauth-access-token" name="accessToken" type="password" placeholder="Access token" autocomplete="off" spellcheck="false" />
					<input id="oauth-refresh-token" name="refreshToken" type="password" placeholder="Refresh token" autocomplete="off" spellcheck="false" />
					<input id="oauth-project-id" name="projectId" type="text" placeholder="Project ID" autocomplete="off" spellcheck="false" />
					<input id="oauth-specific-data" name="providerSpecificData" type="text" placeholder='providerSpecificData JSON' autocomplete="off" spellcheck="false" />
					<button type="submit">OAuth 저장</button>
				</form>
				<form class="inline-form oauth-redirect-form" id="oauth-redirect-form">
					<select id="oauth-login-provider" name="provider">
						<option value="claude">Claude</option>
						<option value="codex">Codex</option>
						<option value="gemini-cli">Gemini CLI</option>
					</select>
					<input id="oauth-login-email" name="email" type="email" placeholder="계정 email" autocomplete="off" spellcheck="false" />
					<input id="oauth-login-project-id" name="projectId" type="text" placeholder="Project ID (Gemini)" autocomplete="off" spellcheck="false" />
					<input id="oauth-redirect-uri" name="redirectUri" type="url" placeholder="Redirect URI" spellcheck="false" />
					<input id="oauth-callback-code" name="code" type="text" placeholder="callback code" autocomplete="off" spellcheck="false" />
					<input id="oauth-callback-state" name="state" type="text" placeholder="state" autocomplete="off" spellcheck="false" />
					<input id="oauth-code-verifier" name="codeVerifier" type="password" placeholder="code verifier" autocomplete="off" spellcheck="false" />
					<button type="submit">브라우저 로그인</button>
					<button id="oauth-complete-button" class="secondary" type="button">Callback 저장</button>
				</form>
				<div class="table-wrap">
					<table class="provider-connection-table">
						<thead>
							<tr>
								<th>Connection</th>
								<th>Provider</th>
								<th>Auth</th>
								<th>Credential</th>
								<th>Priority</th>
								<th>상태</th>
								<th>최근 사용</th>
								<th>작업</th>
							</tr>
						</thead>
						<tbody id="provider-connection-body"></tbody>
					</table>
				</div>
				<div class="table-wrap probe-wrap">
					<table class="provider-probe-table">
						<thead>
							<tr>
								<th>Provider</th>
								<th>Probe</th>
								<th>Checks</th>
								<th>Connections</th>
							</tr>
						</thead>
						<tbody id="provider-probe-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section provider-settings-section">
				<div class="panel-header">
					<h2>Routing / Budget 설정</h2>
					<span id="provider-settings-title" class="panel-subtitle">저장된 전역 정책</span>
				</div>
				<form class="inline-form provider-settings-form" id="provider-settings-form">
					<select id="settings-quota-strategy" name="quotaStrategy">
						<option value="off">quota off</option>
						<option value="prefer-remaining">prefer remaining</option>
						<option value="require-remaining">require remaining</option>
					</select>
					<input id="settings-quota-min" name="quotaMinRemainingPercentage" type="number" min="0" max="100" step="1" placeholder="min quota %" />
					<input id="settings-quota-ttl" name="quotaRefreshTtlMs" type="number" min="0" step="1000" placeholder="quota refresh ttl ms" />
					<select id="settings-budget-mode" name="budgetMode">
						<option value="off">budget off</option>
						<option value="warn">warn</option>
						<option value="block">block</option>
					</select>
					<input id="settings-budget-request" name="requestUsd" type="number" min="0" step="0.0001" placeholder="request $" />
					<input id="settings-budget-daily" name="dailyUsd" type="number" min="0" step="0.01" placeholder="daily $" />
					<input id="settings-budget-monthly" name="monthlyUsd" type="number" min="0" step="0.01" placeholder="monthly $" />
					<button type="submit">설정 저장</button>
				</form>
				<div id="budget-status" class="budget-status">
					<div class="empty">budget 상태 없음</div>
				</div>
			</section>

			<section class="table-section account-selection-section">
				<div class="panel-header">
					<h2>Account 선택 이유</h2>
					<span class="panel-subtitle">현재 Provider/Model 필터 기준</span>
				</div>
				<div class="table-wrap">
					<table class="account-selection-table">
						<thead>
							<tr>
								<th>Provider</th>
								<th>Strategy</th>
								<th>선택</th>
								<th>선택 이유</th>
								<th>후보</th>
							</tr>
						</thead>
						<tbody id="account-selection-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section routing-policy-section">
				<div class="panel-header">
					<h2>Routing policy</h2>
					<span id="routing-policy-preview" class="panel-subtitle">preview 없음</span>
				</div>
				<form class="inline-form routing-policy-form" id="routing-policy-form">
					<input id="routing-policy-name" name="name" type="text" placeholder="combo 이름" autocomplete="off" spellcheck="false" />
					<input id="routing-policy-models" name="models" type="text" placeholder="provider/model, provider/model" autocomplete="off" spellcheck="false" list="model-suggestions" />
					<select id="routing-policy-strategy" name="strategy">
						<option value="fallback">fallback</option>
						<option value="round-robin">round-robin</option>
					</select>
					<input id="routing-policy-sticky-limit" name="stickyLimit" type="number" min="1" step="1" value="1" />
					<input id="routing-policy-preview-model" name="previewModel" type="text" placeholder="preview model: combo:coding" autocomplete="off" spellcheck="false" />
					<button type="submit">저장</button>
					<button id="routing-policy-preview-button" class="secondary" type="button">Preview</button>
				</form>
				<div class="table-wrap">
					<table class="routing-policy-table">
						<thead>
							<tr>
								<th>Combo</th>
								<th>Strategy</th>
								<th>Sticky</th>
								<th>Models</th>
								<th>작업</th>
							</tr>
						</thead>
						<tbody id="routing-policy-body"></tbody>
					</table>
				</div>
				<form class="inline-form routing-policy-mapping-form" id="routing-alias-form">
					<input id="routing-alias-name" name="name" type="text" placeholder="alias: auto:coding" autocomplete="off" spellcheck="false" />
					<input id="routing-alias-models" name="models" type="text" placeholder="provider/model, provider/model" autocomplete="off" spellcheck="false" list="model-suggestions" />
					<button type="submit">Alias 저장</button>
				</form>
				<form class="inline-form routing-policy-mapping-form" id="routing-intent-form">
					<input id="routing-intent-name" name="name" type="text" placeholder="intent: coding" autocomplete="off" spellcheck="false" />
					<input id="routing-intent-models" name="models" type="text" placeholder="provider/model, provider/model" autocomplete="off" spellcheck="false" list="model-suggestions" />
					<button type="submit">Intent 저장</button>
				</form>
				<form class="inline-form routing-policy-import-form" id="routing-policy-import-form">
					<textarea id="routing-policy-json" rows="3" spellcheck="false" placeholder="routing policy JSON"></textarea>
					<button id="routing-policy-export-button" class="secondary" type="button">Export</button>
					<button type="submit">Import</button>
				</form>
				<div class="table-wrap">
					<table class="routing-policy-mapping-table">
						<thead>
							<tr>
								<th>Type</th>
								<th>Name</th>
								<th>Models</th>
								<th>작업</th>
							</tr>
						</thead>
						<tbody id="routing-policy-mapping-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section provider-status-section">
				<div class="panel-header">
					<h2>Provider 인증</h2>
				</div>
				<div class="table-wrap">
					<table class="provider-status-table">
						<thead>
							<tr>
								<th>Provider</th>
								<th>Health</th>
								<th>상태</th>
								<th>Source</th>
								<th>Models</th>
								<th>Available</th>
								<th>Connections</th>
							</tr>
						</thead>
						<tbody id="provider-status-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section proxy-pool-section">
				<div class="panel-header">
					<h2>Proxy Pools</h2>
				</div>
				<form class="inline-form proxy-pool-form" id="proxy-pool-form">
					<input id="proxy-pool-name" name="name" type="text" placeholder="이름" autocomplete="off" />
					<select id="proxy-pool-type" name="type">
						<option value="http">HTTP</option>
						<option value="vercel">Vercel</option>
					</select>
					<input id="proxy-pool-url" name="proxyUrl" type="url" placeholder="Proxy URL" spellcheck="false" />
					<input id="proxy-pool-no-proxy" name="noProxy" type="text" placeholder="No proxy" spellcheck="false" />
					<button type="submit">추가</button>
				</form>
				<div class="table-wrap">
					<table class="proxy-pool-table">
						<thead>
							<tr>
								<th>Pool</th>
								<th>Type</th>
								<th>URL</th>
								<th>상태</th>
								<th>연결</th>
								<th>작업</th>
							</tr>
						</thead>
						<tbody id="proxy-pool-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section provider-quota-section">
				<div class="panel-header">
					<h2>Quota 연결</h2>
				</div>
				<div class="table-wrap">
					<table class="provider-quota-table">
						<thead>
							<tr>
								<th>Connection</th>
								<th>Provider</th>
								<th>Auth</th>
								<th>Proxy Pool</th>
								<th>Quota</th>
								<th>상태</th>
								<th>최근 오류</th>
								<th>상세</th>
							</tr>
						</thead>
						<tbody id="provider-quota-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section model-availability-section">
				<div class="panel-header">
					<h2>Model cooldown</h2>
					<span id="model-availability-title" class="panel-subtitle">잠긴 모델 없음</span>
				</div>
				<div class="table-wrap">
					<table class="model-availability-table">
						<thead>
							<tr>
								<th>Connection</th>
								<th>Provider</th>
								<th>Model</th>
								<th>Cooldown</th>
								<th>Until</th>
								<th>오류</th>
								<th>작업</th>
							</tr>
						</thead>
						<tbody id="model-availability-body"></tbody>
					</table>
				</div>
			</section>

			<section class="table-section quota-detail-section">
				<div class="panel-header">
					<h2>Quota 상세</h2>
					<span id="quota-detail-title" class="panel-subtitle">선택 없음</span>
				</div>
				<div id="quota-detail-body" class="quota-detail-body">
					<div class="empty">선택 없음</div>
				</div>
			</section>

			<section class="table-section media-route-section">
				<div class="panel-header">
					<h2>Media / Tool routes</h2>
					<span class="panel-subtitle">9router endpoint 호환</span>
				</div>
				<div class="table-wrap">
					<table class="media-route-table">
						<thead>
							<tr>
								<th>기능</th>
								<th>Endpoint</th>
								<th>Auth</th>
								<th>Provider 예시</th>
								<th>Default alias</th>
							</tr>
						</thead>
						<tbody id="media-route-body"></tbody>
					</table>
				</div>
			</section>

			<section class="split">
				<div class="panel">
					<div class="panel-header">
						<h2>Provider</h2>
					</div>
					<div id="provider-list" class="rank-list"></div>
				</div>
				<div class="panel">
					<div class="panel-header">
						<h2>Model</h2>
					</div>
					<div id="model-list" class="rank-list"></div>
				</div>
			</section>

			<section class="table-section request-detail-section">
				<div class="panel-header">
					<h2>요청 상세 / Fallback timeline</h2>
					<span id="request-detail-title" class="panel-subtitle">선택 없음</span>
				</div>
				<div id="request-detail-body" class="request-detail-body">
					<div class="empty">최근 요청에서 상세 버튼을 선택하세요</div>
				</div>
			</section>

			<section class="table-section">
				<div class="panel-header">
					<h2>최근 요청</h2>
				</div>
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>시간</th>
								<th>상태</th>
								<th>Endpoint</th>
								<th>요청 모델</th>
								<th>실행 모델</th>
								<th>Route</th>
								<th>Connection</th>
								<th>시도</th>
								<th>Tokens</th>
								<th>Cost</th>
								<th>RTK</th>
								<th>오류</th>
								<th>상세</th>
							</tr>
						</thead>
						<tbody id="records-body"></tbody>
					</table>
				</div>
			</section>
		</main>
	</div>
`;

const apiBaseInput = getElement<HTMLInputElement>("api-base");
const serverForm = getElement<HTMLFormElement>("server-form");
const statusFilter = getElement<HTMLSelectElement>("status-filter");
const providerFilter = getElement<HTMLInputElement>("provider-filter");
const modelFilter = getElement<HTMLInputElement>("model-filter");
const limitFilter = getElement<HTMLSelectElement>("limit-filter");
const orderFilter = getElement<HTMLSelectElement>("order-filter");
const refreshButton = getElement<HTMLButtonElement>("refresh-button");
const statusLine = getElement<HTMLElement>("status-line");
const recordsBody = getElement<HTMLTableSectionElement>("records-body");
const providerConnectionBody = getElement<HTMLTableSectionElement>("provider-connection-body");
const providerConnectionForm = getElement<HTMLFormElement>("provider-connection-form");
const providerConnectionProviderInput = getElement<HTMLInputElement>("provider-connection-provider");
const providerConnectionNameInput = getElement<HTMLInputElement>("provider-connection-name");
const providerConnectionAuthTypeSelect = getElement<HTMLSelectElement>("provider-connection-auth-type");
const providerConnectionApiKeyInput = getElement<HTMLInputElement>("provider-connection-api-key");
const providerConnectionAccessTokenInput = getElement<HTMLInputElement>("provider-connection-access-token");
const providerConnectionPriorityInput = getElement<HTMLInputElement>("provider-connection-priority");
const oauthWizardForm = getElement<HTMLFormElement>("oauth-wizard-form");
const oauthProviderInput = getElement<HTMLInputElement>("oauth-provider");
const oauthEmailInput = getElement<HTMLInputElement>("oauth-email");
const oauthAccessTokenInput = getElement<HTMLInputElement>("oauth-access-token");
const oauthRefreshTokenInput = getElement<HTMLInputElement>("oauth-refresh-token");
const oauthProjectIdInput = getElement<HTMLInputElement>("oauth-project-id");
const oauthSpecificDataInput = getElement<HTMLInputElement>("oauth-specific-data");
const oauthRedirectForm = getElement<HTMLFormElement>("oauth-redirect-form");
const oauthLoginProviderSelect = getElement<HTMLSelectElement>("oauth-login-provider");
const oauthLoginEmailInput = getElement<HTMLInputElement>("oauth-login-email");
const oauthLoginProjectIdInput = getElement<HTMLInputElement>("oauth-login-project-id");
const oauthRedirectUriInput = getElement<HTMLInputElement>("oauth-redirect-uri");
const oauthCallbackCodeInput = getElement<HTMLInputElement>("oauth-callback-code");
const oauthCallbackStateInput = getElement<HTMLInputElement>("oauth-callback-state");
const oauthCodeVerifierInput = getElement<HTMLInputElement>("oauth-code-verifier");
const oauthCompleteButton = getElement<HTMLButtonElement>("oauth-complete-button");
const providerSettingsForm = getElement<HTMLFormElement>("provider-settings-form");
const providerSettingsTitle = getElement<HTMLElement>("provider-settings-title");
const budgetStatus = getElement<HTMLElement>("budget-status");
const settingsQuotaStrategySelect = getElement<HTMLSelectElement>("settings-quota-strategy");
const settingsQuotaMinInput = getElement<HTMLInputElement>("settings-quota-min");
const settingsQuotaTtlInput = getElement<HTMLInputElement>("settings-quota-ttl");
const settingsBudgetModeSelect = getElement<HTMLSelectElement>("settings-budget-mode");
const settingsBudgetRequestInput = getElement<HTMLInputElement>("settings-budget-request");
const settingsBudgetDailyInput = getElement<HTMLInputElement>("settings-budget-daily");
const settingsBudgetMonthlyInput = getElement<HTMLInputElement>("settings-budget-monthly");
const accountSelectionBody = getElement<HTMLTableSectionElement>("account-selection-body");
const routingPolicyBody = getElement<HTMLTableSectionElement>("routing-policy-body");
const routingPolicyForm = getElement<HTMLFormElement>("routing-policy-form");
const routingPolicyNameInput = getElement<HTMLInputElement>("routing-policy-name");
const routingPolicyModelsInput = getElement<HTMLInputElement>("routing-policy-models");
const routingPolicyStrategySelect = getElement<HTMLSelectElement>("routing-policy-strategy");
const routingPolicyStickyLimitInput = getElement<HTMLInputElement>("routing-policy-sticky-limit");
const routingPolicyPreviewModelInput = getElement<HTMLInputElement>("routing-policy-preview-model");
const routingPolicyPreviewButton = getElement<HTMLButtonElement>("routing-policy-preview-button");
const routingPolicyPreview = getElement<HTMLElement>("routing-policy-preview");
const routingPolicyImportForm = getElement<HTMLFormElement>("routing-policy-import-form");
const routingPolicyJsonInput = getElement<HTMLTextAreaElement>("routing-policy-json");
const routingPolicyExportButton = getElement<HTMLButtonElement>("routing-policy-export-button");
const routingAliasForm = getElement<HTMLFormElement>("routing-alias-form");
const routingAliasNameInput = getElement<HTMLInputElement>("routing-alias-name");
const routingAliasModelsInput = getElement<HTMLInputElement>("routing-alias-models");
const routingIntentForm = getElement<HTMLFormElement>("routing-intent-form");
const routingIntentNameInput = getElement<HTMLInputElement>("routing-intent-name");
const routingIntentModelsInput = getElement<HTMLInputElement>("routing-intent-models");
const routingPolicyMappingBody = getElement<HTMLTableSectionElement>("routing-policy-mapping-body");
const providerStatusBody = getElement<HTMLTableSectionElement>("provider-status-body");
const providerProbeBody = getElement<HTMLTableSectionElement>("provider-probe-body");
const providerQuotaBody = getElement<HTMLTableSectionElement>("provider-quota-body");
const modelAvailabilityTitle = getElement<HTMLElement>("model-availability-title");
const modelAvailabilityBody = getElement<HTMLTableSectionElement>("model-availability-body");
const proxyPoolBody = getElement<HTMLTableSectionElement>("proxy-pool-body");
const proxyPoolForm = getElement<HTMLFormElement>("proxy-pool-form");
const proxyPoolNameInput = getElement<HTMLInputElement>("proxy-pool-name");
const proxyPoolTypeSelect = getElement<HTMLSelectElement>("proxy-pool-type");
const proxyPoolUrlInput = getElement<HTMLInputElement>("proxy-pool-url");
const proxyPoolNoProxyInput = getElement<HTMLInputElement>("proxy-pool-no-proxy");
const quotaDetailTitle = getElement<HTMLElement>("quota-detail-title");
const quotaDetailBody = getElement<HTMLElement>("quota-detail-body");
const mediaRouteBody = getElement<HTMLTableSectionElement>("media-route-body");
const requestDetailTitle = getElement<HTMLElement>("request-detail-title");
const requestDetailBody = getElement<HTMLElement>("request-detail-body");
const modelSuggestions = getElement<HTMLDataListElement>("model-suggestions");
const providerList = getElement<HTMLElement>("provider-list");
const modelList = getElement<HTMLElement>("model-list");

const metricRecords = getElement<HTMLElement>("metric-records");
const metricSuccess = getElement<HTMLElement>("metric-success");
const metricErrors = getElement<HTMLElement>("metric-errors");
const metricTokens = getElement<HTMLElement>("metric-tokens");
const metricCost = getElement<HTMLElement>("metric-cost");
const metricRtkSaved = getElement<HTMLElement>("metric-rtk-saved");

let activeController: AbortController | undefined;
let quotaDetailController: AbortController | undefined;
let requestDetailController: AbortController | undefined;
let currentProxyPools: ProxyPool[] = [];
let currentRoutingPolicy: RouterPolicy = {};
let currentProviderSettings: ProviderConnectionSettings = {};
let currentMediaRoutes: MediaRoutesResponse | null = null;
let currentBudgetStatus: BudgetStatus | null = null;

apiBaseInput.value = localStorage.getItem(API_BASE_STORAGE_KEY) ?? DEFAULT_API_BASE;
oauthRedirectUriInput.value = defaultOAuthRedirectUri();

serverForm.addEventListener("submit", (event) => {
	event.preventDefault();
	localStorage.setItem(API_BASE_STORAGE_KEY, normalizeApiBase(apiBaseInput.value));
	void loadUsage();
});

refreshButton.addEventListener("click", () => {
	void loadUsage();
});

providerConnectionForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void createProviderConnection();
});

oauthWizardForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void createOauthProviderConnection();
});

oauthRedirectForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void startOAuthRedirectLogin();
});

oauthCompleteButton.addEventListener("click", () => {
	void completeOAuthRedirectLoginFromInputs();
});

providerSettingsForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void saveProviderSettings();
});

providerConnectionBody.addEventListener("click", (event) => {
	const toggleButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-toggle-provider-connection-id]");
	if (toggleButton?.dataset.toggleProviderConnectionId) {
		void toggleProviderConnection(toggleButton.dataset.toggleProviderConnectionId, toggleButton.dataset.nextActive === "true");
		return;
	}

	const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-delete-provider-connection-id]");
	if (deleteButton?.dataset.deleteProviderConnectionId) {
		void deleteProviderConnection(deleteButton.dataset.deleteProviderConnectionId);
	}
});

routingPolicyForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void saveRoutingPolicyCombo();
});

routingPolicyPreviewButton.addEventListener("click", () => {
	void previewRoutingPolicy();
});

routingPolicyExportButton.addEventListener("click", () => {
	routingPolicyJsonInput.value = JSON.stringify(currentRoutingPolicy, null, 2);
	setStatus("Routing policy export 완료");
});

routingPolicyImportForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void importRoutingPolicy();
});

routingAliasForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void saveRoutingPolicyAlias();
});

routingIntentForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void saveRoutingPolicyIntent();
});

routingPolicyBody.addEventListener("click", (event) => {
	const moveButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-move-routing-combo]");
	if (moveButton?.dataset.moveRoutingCombo && moveButton.dataset.moveRoutingDirection) {
		void moveRoutingPolicyCombo(moveButton.dataset.moveRoutingCombo, moveButton.dataset.moveRoutingDirection === "up" ? -1 : 1);
		return;
	}

	const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-delete-routing-combo]");
	if (deleteButton?.dataset.deleteRoutingCombo) {
		void deleteRoutingPolicyCombo(deleteButton.dataset.deleteRoutingCombo);
		return;
	}

	const editButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-edit-routing-combo]");
	if (editButton?.dataset.editRoutingCombo) {
		const combo = getRouterPolicyCombos(currentRoutingPolicy).find((item) => item.name === editButton.dataset.editRoutingCombo);
		if (combo) fillRoutingPolicyForm(combo);
	}
});

routingPolicyMappingBody.addEventListener("click", (event) => {
	const deleteAliasButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-delete-routing-alias]");
	if (deleteAliasButton?.dataset.deleteRoutingAlias) {
		void deleteRoutingPolicyAlias(deleteAliasButton.dataset.deleteRoutingAlias);
		return;
	}

	const deleteIntentButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-delete-routing-intent]");
	if (deleteIntentButton?.dataset.deleteRoutingIntent) {
		void deleteRoutingPolicyIntent(deleteIntentButton.dataset.deleteRoutingIntent);
		return;
	}

	const editAliasButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-edit-routing-alias]");
	if (editAliasButton?.dataset.editRoutingAlias) {
		const mapping = getRouterPolicyMappings(currentRoutingPolicy.aliases).find(
			(item) => item.name === editAliasButton.dataset.editRoutingAlias,
		);
		if (mapping) fillRoutingAliasForm(mapping);
		return;
	}

	const editIntentButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-edit-routing-intent]");
	if (editIntentButton?.dataset.editRoutingIntent) {
		const mapping = getRouterPolicyMappings(currentRoutingPolicy.intents).find(
			(item) => item.name === editIntentButton.dataset.editRoutingIntent,
		);
		if (mapping) fillRoutingIntentForm(mapping);
	}
});

providerQuotaBody.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-quota-connection-id]");
	const connectionId = button?.dataset.quotaConnectionId;
	if (!connectionId) return;

	void loadQuotaDetail(connectionId);
});

providerQuotaBody.addEventListener("change", (event) => {
	const select = (event.target as HTMLElement).closest<HTMLSelectElement>("select[data-connection-proxy-pool-id]");
	const connectionId = select?.dataset.connectionProxyPoolId;
	if (!select || !connectionId) return;

	void updateConnectionProxyPool(connectionId, select.value);
});

proxyPoolForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void createProxyPool();
});

modelAvailabilityBody.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-clear-cooldown-provider]");
	const provider = button?.dataset.clearCooldownProvider;
	const model = button?.dataset.clearCooldownModel;
	if (!provider || !model) return;

	void clearModelCooldown(provider, model);
});

proxyPoolBody.addEventListener("click", (event) => {
	const testButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-test-proxy-pool-id]");
	if (testButton?.dataset.testProxyPoolId) {
		void runProxyPoolTest(testButton.dataset.testProxyPoolId);
		return;
	}

	const toggleButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-toggle-proxy-pool-id]");
	if (toggleButton?.dataset.toggleProxyPoolId) {
		void toggleProxyPool(toggleButton.dataset.toggleProxyPoolId, toggleButton.dataset.nextActive === "true");
		return;
	}

	const deleteButton = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-delete-proxy-pool-id]");
	if (deleteButton?.dataset.deleteProxyPoolId) {
		void deleteProxyPool(deleteButton.dataset.deleteProxyPoolId);
	}
});

recordsBody.addEventListener("click", (event) => {
	const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-request-detail-id]");
	if (!button?.dataset.requestDetailId) return;
	void loadRequestDetail(button.dataset.requestDetailId);
});

for (const element of [statusFilter, providerFilter, modelFilter, limitFilter, orderFilter]) {
	element.addEventListener("change", () => void loadUsage());
}

for (const element of [providerFilter, modelFilter]) {
	element.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			void loadUsage();
		}
	});
}

window.addEventListener("message", (event) => {
	const data = event.data as { type?: unknown; code?: unknown; state?: unknown; error?: unknown };
	if (data?.type !== "pie-lab-oauth-callback" && data?.type !== "pie-adk-oauth-callback") return;
	if (typeof data.error === "string" && data.error) {
		setStatus(`OAuth callback 오류: ${data.error}`, true);
		return;
	}
	if (typeof data.code === "string") oauthCallbackCodeInput.value = data.code;
	if (typeof data.state === "string") oauthCallbackStateInput.value = data.state;
	void completeOAuthRedirectLoginFromInputs();
});

void completeOAuthRedirectLoginFromCurrentUrl();
void loadUsage();

async function loadUsage(): Promise<void> {
	activeController?.abort();
	activeController = new AbortController();

	setLoading(true);
	setStatus("조회 중");

	try {
		const apiBase = normalizeApiBase(apiBaseInput.value);
		localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

		const query = createQueryParams();
		const summaryQuery = new URLSearchParams(query);
		summaryQuery.delete("limit");
		const accountSelectionQuery = new URLSearchParams();
		appendQuery(accountSelectionQuery, "provider", providerFilter.value);
		appendQuery(accountSelectionQuery, "model", modelFilter.value);
		const budgetQuery = new URLSearchParams();
		appendQuery(budgetQuery, "provider", providerFilter.value);

		const [
			usageResponse,
			summaryResponse,
			budgetResponse,
			providerConnectionsResponse,
			accountSelectionResponse,
			routingPolicyResponse,
			providerSettingsResponse,
			providerStatusResponse,
			providerProbeResponse,
			providerQuotaResponse,
			modelAvailabilityResponse,
			proxyPoolResponse,
			mediaRoutesResponse,
			modelsResponse,
		] = await Promise.all([
			fetchJson<UsageResponse>(createApiUrl(apiBase, "/usage", query), activeController.signal),
			fetchJson<SummaryResponse>(createApiUrl(apiBase, "/usage/summary", summaryQuery), activeController.signal),
			fetchJson<BudgetStatusResponse>(createApiUrl(apiBase, "/budget", budgetQuery), activeController.signal),
			fetchJson<ProviderConnectionsResponse>(
				createApiUrl(apiBase, "/provider-connections", new URLSearchParams()),
				activeController.signal,
			),
			fetchJson<AccountSelectionResponse>(
				createApiUrl(apiBase, "/account-selection", accountSelectionQuery),
				activeController.signal,
			),
			fetchJson<RoutingPolicyResponse>(
				createApiUrl(apiBase, "/routing-policy", new URLSearchParams()),
				activeController.signal,
			),
			fetchJson<ProviderSettingsResponse>(
				createApiUrl(apiBase, "/provider-settings", new URLSearchParams()),
				activeController.signal,
			),
			fetchJson<ProviderStatusResponse>(createApiUrl(apiBase, "/providers", new URLSearchParams()), activeController.signal),
			fetchJson<ProviderProbeResponse>(createApiUrl(apiBase, "/providers/probe", new URLSearchParams()), activeController.signal),
			fetchJson<ProviderQuotaResponse>(createApiUrl(apiBase, "/quota", new URLSearchParams()), activeController.signal),
			fetchJson<ModelAvailabilityResponse>(
				createApiUrl(apiBase, "/models/availability", new URLSearchParams()),
				activeController.signal,
			),
			fetchJson<ProxyPoolResponse>(
				createApiUrl(apiBase, "/proxy-pools", new URLSearchParams([["includeUsage", "true"]])),
				activeController.signal,
			),
			fetchJson<MediaRoutesResponse>(
				createApiUrl(apiBase, "/media/routes", new URLSearchParams()),
				activeController.signal,
			),
			fetchJson<ModelsResponse>(createApiUrl(apiBase, "/v1/models", new URLSearchParams()), activeController.signal),
		]);

		currentProxyPools = proxyPoolResponse.proxyPools;
		renderSummary(summaryResponse.summary, usageResponse.records);
		renderProviderConnections(providerConnectionsResponse.connections);
		renderAccountSelection(accountSelectionResponse.data);
		currentRoutingPolicy = routingPolicyResponse.policy;
		currentProviderSettings = providerSettingsResponse.settings;
		currentBudgetStatus = budgetResponse.budget;
		currentMediaRoutes = mediaRoutesResponse;
		renderRoutingPolicy(currentRoutingPolicy);
		renderProviderSettings(currentProviderSettings);
		renderBudgetStatus(currentBudgetStatus);
		renderProviderStatuses(providerStatusResponse.data);
		renderProviderProbes(providerProbeResponse.data);
		renderProxyPools(currentProxyPools);
		renderProviderQuotaConnections(providerQuotaResponse.data, currentProxyPools);
		renderModelAvailability(modelAvailabilityResponse);
		renderMediaRoutes(mediaRoutesResponse);
		renderModelSuggestions(modelsResponse, mediaRoutesResponse);
		renderRankList(providerList, summaryResponse.summary.byProvider);
		renderRankList(modelList, summaryResponse.summary.byModel);
		renderRecords(usageResponse.records);
		setStatus(`${formatNumber(usageResponse.count)}개 record`);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return;
		}

		renderSummary(emptySummary(), []);
		renderProviderConnections([]);
		renderAccountSelection([]);
		currentRoutingPolicy = {};
		currentProviderSettings = {};
		currentBudgetStatus = null;
		currentMediaRoutes = null;
		renderRoutingPolicy(currentRoutingPolicy);
		renderProviderSettings(currentProviderSettings);
		renderBudgetStatus(null);
		renderProviderStatuses([]);
		renderProviderProbes([]);
		currentProxyPools = [];
		renderProxyPools([]);
		renderProviderQuotaConnections([], []);
		renderModelAvailability(emptyModelAvailabilityResponse());
		renderMediaRoutes(null);
		renderQuotaDetailEmpty("선택 없음");
		renderRankList(providerList, []);
		renderRankList(modelList, []);
		renderRecords([]);
		setStatus(error instanceof Error ? error.message : "조회 실패", true);
	} finally {
		setLoading(false);
	}
}

async function createProviderConnection(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const priority = providerConnectionPriorityInput.value.trim()
			? Number(providerConnectionPriorityInput.value)
			: undefined;
		await sendJson<{ connection: ProviderConnectionSummary }>(
			createApiUrl(apiBase, "/provider-connections", new URLSearchParams()),
			"POST",
			{
				provider: providerConnectionProviderInput.value,
				name: providerConnectionNameInput.value,
				authType: providerConnectionAuthTypeSelect.value,
				apiKey: providerConnectionApiKeyInput.value,
				accessToken: providerConnectionAccessTokenInput.value,
				priority: Number.isFinite(priority) ? priority : undefined,
			},
		);

		providerConnectionForm.reset();
		setStatus("Provider 연결 추가 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Provider 연결 추가 실패", true);
	}
}

async function createOauthProviderConnection(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson<{ connection: ProviderConnectionSummary }>(
			createApiUrl(apiBase, "/provider-connections", new URLSearchParams()),
			"POST",
			{
				provider: oauthProviderInput.value,
				authType: "oauth",
				name: oauthEmailInput.value || oauthProviderInput.value,
				email: oauthEmailInput.value,
				accessToken: oauthAccessTokenInput.value,
				refreshToken: oauthRefreshTokenInput.value,
				projectId: oauthProjectIdInput.value,
				providerSpecificData: parseJsonObjectInput(oauthSpecificDataInput.value),
			},
		);

		oauthWizardForm.reset();
		setStatus("OAuth connection 저장 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "OAuth connection 저장 실패", true);
	}
}

async function startOAuthRedirectLogin(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const provider = oauthLoginProviderSelect.value;
		const redirectUri = oauthRedirectUriInput.value.trim() || defaultOAuthRedirectUri();
		const query = new URLSearchParams();
		query.set("provider", provider);
		query.set("redirect_uri", redirectUri);
		const flow = await fetchJson<OAuthStartResponse>(createApiUrl(apiBase, "/oauth/start", query), new AbortController().signal);
		const storedFlow = {
			provider: flow.provider,
			state: flow.state,
			codeVerifier: flow.codeVerifier,
			redirectUri: flow.redirectUri,
			email: oauthLoginEmailInput.value.trim(),
			projectId: oauthLoginProjectIdInput.value.trim(),
		};
		localStorage.setItem(OAUTH_FLOW_STORAGE_KEY, JSON.stringify(storedFlow));
		oauthCallbackStateInput.value = flow.state;
		oauthCodeVerifierInput.value = flow.codeVerifier;
		oauthRedirectUriInput.value = flow.redirectUri;
		setStatus(`OAuth 로그인으로 이동합니다: ${flow.provider}`);
		window.location.assign(flow.authorizationUrl);
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "OAuth redirect 시작 실패", true);
	}
}

async function completeOAuthRedirectLoginFromInputs(): Promise<void> {
	const code = oauthCallbackCodeInput.value.trim();
	const state = oauthCallbackStateInput.value.trim();
	if (!code) {
		setStatus("callback code가 필요합니다.", true);
		return;
	}
	await completeOAuthRedirectLogin({ code, state });
}

async function completeOAuthRedirectLoginFromCurrentUrl(): Promise<void> {
	const params = new URLSearchParams(window.location.search);
	const code = params.get("code");
	const state = params.get("state") ?? "";
	const error = params.get("error");
	if (error) {
		setStatus(`OAuth callback 오류: ${error}`, true);
		clearOAuthQueryParams();
		return;
	}
	if (!code) return;

	oauthCallbackCodeInput.value = code;
	oauthCallbackStateInput.value = state;
	clearOAuthQueryParams();
	await completeOAuthRedirectLogin({ code, state });
}

async function completeOAuthRedirectLogin(input: { code: string; state: string }): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const flow = readStoredOAuthFlow();
		const provider = flow?.provider ?? oauthLoginProviderSelect.value;
		const codeVerifier = flow?.codeVerifier ?? oauthCodeVerifierInput.value.trim();
		const redirectUri = flow?.redirectUri ?? (oauthRedirectUriInput.value.trim() || defaultOAuthRedirectUri());
		const expectedState = flow?.state ?? oauthCallbackStateInput.value.trim();
		if (expectedState && input.state && expectedState !== input.state) {
			throw new Error("OAuth state가 일치하지 않습니다.");
		}
		if (!codeVerifier) {
			throw new Error("code verifier가 필요합니다. 브라우저 로그인부터 다시 시작해 주세요.");
		}

		const result = await sendJson<OAuthCallbackResponse>(
			createApiUrl(apiBase, "/oauth/callback", new URLSearchParams()),
			"POST",
			{
				provider,
				code: input.code,
				state: input.state,
				codeVerifier,
				redirectUri,
				email: flow?.email ?? oauthLoginEmailInput.value,
				projectId: flow?.projectId ?? oauthLoginProjectIdInput.value,
			},
		);
		localStorage.removeItem(OAUTH_FLOW_STORAGE_KEY);
		oauthCallbackCodeInput.value = "";
		oauthCallbackStateInput.value = "";
		oauthCodeVerifierInput.value = "";
		setStatus(`OAuth connection 저장 완료: ${result.connection.provider}/${result.connection.id}`);
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "OAuth callback 저장 실패", true);
	}
}

async function saveProviderSettings(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<ProviderSettingsResponse>(
			createApiUrl(apiBase, "/provider-settings", new URLSearchParams()),
			"PUT",
			{
				quotaStrategy: settingsQuotaStrategySelect.value,
				quotaMinRemainingPercentage: nullableInputValue(settingsQuotaMinInput.value),
				quotaRefreshTtlMs: nullableInputValue(settingsQuotaTtlInput.value),
				budgetLimits: {
					mode: settingsBudgetModeSelect.value,
					requestUsd: nullableInputValue(settingsBudgetRequestInput.value),
					dailyUsd: nullableInputValue(settingsBudgetDailyInput.value),
					monthlyUsd: nullableInputValue(settingsBudgetMonthlyInput.value),
				},
			},
		);
		currentProviderSettings = response.settings;
		renderProviderSettings(currentProviderSettings);
		setStatus("Routing / Budget 설정 저장 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Routing / Budget 설정 저장 실패", true);
	}
}

async function toggleProviderConnection(connectionId: string, isActive: boolean): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson(
			createApiUrl(apiBase, `/provider-connections/${encodeURIComponent(connectionId)}`, new URLSearchParams()),
			"PUT",
			{ isActive },
		);
		setStatus("Provider 연결 상태 변경 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Provider 연결 상태 변경 실패", true);
	}
}

async function deleteProviderConnection(connectionId: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson(
			createApiUrl(apiBase, `/provider-connections/${encodeURIComponent(connectionId)}`, new URLSearchParams()),
			"DELETE",
		);
		setStatus("Provider 연결 삭제 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Provider 연결 삭제 실패", true);
	}
}

async function saveRoutingPolicyCombo(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse & { combo: RouterPolicyCombo }>(
			createApiUrl(apiBase, "/routing-policy/combos", new URLSearchParams()),
			"POST",
			{
				name: routingPolicyNameInput.value,
				models: routingPolicyModelsInput.value,
				strategy: routingPolicyStrategySelect.value,
				stickyLimit: routingPolicyStickyLimitInput.value,
			},
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		routingPolicyForm.reset();
		routingPolicyStickyLimitInput.value = "1";
		setStatus(`Fallback chain 저장 완료: ${response.combo.name}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Fallback chain 저장 실패", true);
	}
}

async function deleteRoutingPolicyCombo(comboName: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse>(
			createApiUrl(apiBase, `/routing-policy/combos/${encodeURIComponent(comboName)}`, new URLSearchParams()),
			"DELETE",
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		setStatus(`Fallback chain 삭제 완료: ${comboName}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Fallback chain 삭제 실패", true);
	}
}

async function moveRoutingPolicyCombo(comboName: string, direction: -1 | 1): Promise<void> {
	const combos = getRouterPolicyCombos(currentRoutingPolicy);
	const index = combos.findIndex((combo) => combo.name === comboName);
	const nextIndex = index + direction;
	if (index < 0 || nextIndex < 0 || nextIndex >= combos.length) return;

	const reordered = [...combos];
	const [combo] = reordered.splice(index, 1);
	reordered.splice(nextIndex, 0, combo);
	await saveWholeRoutingPolicy({ ...currentRoutingPolicy, combos: reordered }, `Fallback chain 순서 변경 완료: ${comboName}`);
}

async function importRoutingPolicy(): Promise<void> {
	try {
		const parsed = JSON.parse(routingPolicyJsonInput.value) as RouterPolicy;
		await saveWholeRoutingPolicy(parsed, "Routing policy import 완료");
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Routing policy import 실패", true);
	}
}

async function saveWholeRoutingPolicy(policy: RouterPolicy, successMessage: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse>(
			createApiUrl(apiBase, "/routing-policy", new URLSearchParams()),
			"PUT",
			{ policy },
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		routingPolicyJsonInput.value = JSON.stringify(currentRoutingPolicy, null, 2);
		setStatus(successMessage);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Routing policy 저장 실패", true);
	}
}

async function saveRoutingPolicyAlias(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse & { alias: RouterPolicyMapping }>(
			createApiUrl(apiBase, "/routing-policy/aliases", new URLSearchParams()),
			"POST",
			{
				name: routingAliasNameInput.value,
				models: routingAliasModelsInput.value,
			},
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		routingAliasForm.reset();
		routingPolicyPreviewModelInput.value = response.alias.name;
		setStatus(`Alias 저장 완료: ${response.alias.name}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Alias 저장 실패", true);
	}
}

async function deleteRoutingPolicyAlias(aliasName: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse>(
			createApiUrl(apiBase, `/routing-policy/aliases/${encodeURIComponent(aliasName)}`, new URLSearchParams()),
			"DELETE",
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		setStatus(`Alias 삭제 완료: ${aliasName}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Alias 삭제 실패", true);
	}
}

async function saveRoutingPolicyIntent(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse & { intent: RouterPolicyMapping }>(
			createApiUrl(apiBase, "/routing-policy/intents", new URLSearchParams()),
			"POST",
			{
				name: routingIntentNameInput.value,
				models: routingIntentModelsInput.value,
			},
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		routingIntentForm.reset();
		routingPolicyPreviewModelInput.value = `auto:${response.intent.name}`;
		setStatus(`Intent 저장 완료: ${response.intent.name}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Intent 저장 실패", true);
	}
}

async function deleteRoutingPolicyIntent(intentName: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		const response = await sendJson<RoutingPolicyResponse>(
			createApiUrl(apiBase, `/routing-policy/intents/${encodeURIComponent(intentName)}`, new URLSearchParams()),
			"DELETE",
		);
		currentRoutingPolicy = response.policy;
		renderRoutingPolicy(currentRoutingPolicy);
		setStatus(`Intent 삭제 완료: ${intentName}`);
		void previewRoutingPolicy();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Intent 삭제 실패", true);
	}
}

async function previewRoutingPolicy(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
	const model = routingPolicyPreviewModelInput.value.trim() || "combo:coding";

	try {
		const result = await sendJson<RoutingPolicyPreviewResponse>(
			createApiUrl(apiBase, "/routing-policy/preview", new URLSearchParams()),
			"POST",
			{ model },
		);
		routingPolicyPreview.textContent =
			result.routes.length > 0
				? `${result.requestedModel}: ${result.routes.map((route) => route.id).join(" -> ")}`
				: `${result.requestedModel}: route 없음`;
		setStatus("Fallback chain preview 완료");
	} catch (error) {
		routingPolicyPreview.textContent = "preview 실패";
		setStatus(error instanceof Error ? error.message : "Fallback chain preview 실패", true);
	}
}

async function createProxyPool(): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson<{ proxyPool: ProxyPool }>(createApiUrl(apiBase, "/proxy-pools", new URLSearchParams()), "POST", {
			name: proxyPoolNameInput.value,
			type: proxyPoolTypeSelect.value,
			proxyUrl: proxyPoolUrlInput.value,
			noProxy: proxyPoolNoProxyInput.value,
		});

		proxyPoolForm.reset();
		setStatus("Proxy pool 추가 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Proxy pool 추가 실패", true);
	}
}

async function updateConnectionProxyPool(connectionId: string, proxyPoolId: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson(
			createApiUrl(apiBase, `/provider-connections/${encodeURIComponent(connectionId)}`, new URLSearchParams()),
			"PUT",
			{ proxyPoolId: proxyPoolId || null },
		);
		setStatus("Proxy pool 지정 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Proxy pool 지정 실패", true);
		void loadUsage();
	}
}

async function toggleProxyPool(proxyPoolId: string, isActive: boolean): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson(
			createApiUrl(apiBase, `/proxy-pools/${encodeURIComponent(proxyPoolId)}`, new URLSearchParams()),
			"PUT",
			{ isActive },
		);
		setStatus("Proxy pool 상태 변경 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Proxy pool 상태 변경 실패", true);
	}
}

async function runProxyPoolTest(proxyPoolId: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
	setStatus("Proxy pool 테스트 중...");

	try {
		const result = await sendJson<ProxyPoolTestResponse>(
			createApiUrl(apiBase, `/proxy-pools/${encodeURIComponent(proxyPoolId)}/test`, new URLSearchParams()),
			"POST",
		);
		setStatus(
			result.ok
				? `Proxy pool 테스트 성공 (${formatNumber(result.elapsedMs)}ms)`
				: `Proxy pool 테스트 실패: ${result.error ?? result.status}`,
			!result.ok,
		);
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Proxy pool 테스트 실패", true);
		void loadUsage();
	}
}

async function deleteProxyPool(proxyPoolId: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson(createApiUrl(apiBase, `/proxy-pools/${encodeURIComponent(proxyPoolId)}`, new URLSearchParams()), "DELETE");
		setStatus("Proxy pool 삭제 완료");
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Proxy pool 삭제 실패", true);
	}
}

async function loadQuotaDetail(connectionId: string): Promise<void> {
	quotaDetailController?.abort();
	quotaDetailController = new AbortController();

	renderQuotaDetailLoading(connectionId);

	try {
		const apiBase = normalizeApiBase(apiBaseInput.value);
		localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
		const detail = await fetchJson<ProviderQuotaDetailResponse>(
			createApiUrl(apiBase, `/quota/${encodeURIComponent(connectionId)}`, new URLSearchParams()),
			quotaDetailController.signal,
		);

		renderQuotaDetail(detail);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return;
		}

		renderQuotaDetailError(connectionId, error instanceof Error ? error.message : "조회 실패");
	}
}

async function loadRequestDetail(requestId: string): Promise<void> {
	requestDetailController?.abort();
	requestDetailController = new AbortController();
	requestDetailTitle.textContent = requestId;
	requestDetailBody.innerHTML = `<div class="empty">조회 중</div>`;

	try {
		const apiBase = normalizeApiBase(apiBaseInput.value);
		localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
		const detail = await fetchJson<UsageDetailResponse>(
			createApiUrl(apiBase, `/usage/${encodeURIComponent(requestId)}`, new URLSearchParams()),
			requestDetailController.signal,
		);
		renderRequestDetail(detail);
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") return;
		requestDetailBody.innerHTML = `<div class="empty error-text">${escapeHtml(error instanceof Error ? error.message : "조회 실패")}</div>`;
	}
}

async function clearModelCooldown(provider: string, model: string): Promise<void> {
	const apiBase = normalizeApiBase(apiBaseInput.value);
	localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);

	try {
		await sendJson<ModelAvailabilityClearCooldownResponse>(
			createApiUrl(apiBase, "/models/availability", new URLSearchParams()),
			"POST",
			{ action: "clearCooldown", provider, model },
		);
		setStatus(`Cooldown 해제 완료: ${provider}/${model}`);
		void loadUsage();
	} catch (error) {
		setStatus(error instanceof Error ? error.message : "Cooldown 해제 실패", true);
	}
}

function createQueryParams(): URLSearchParams {
	const query = new URLSearchParams();
	appendQuery(query, "status", statusFilter.value);
	appendQuery(query, "provider", providerFilter.value);
	appendQuery(query, "model", modelFilter.value);
	appendQuery(query, "limit", limitFilter.value);
	appendQuery(query, "order", orderFilter.value);
	return query;
}

function appendQuery(query: URLSearchParams, key: string, value: string): void {
	const trimmed = value.trim();
	if (trimmed) {
		query.set(key, trimmed);
	}
}

function createApiUrl(apiBase: string, path: string, query: URLSearchParams): URL {
	const url = new URL(path, apiBase);
	url.search = query.toString();
	return url;
}

function defaultOAuthRedirectUri(): string {
	return `${window.location.origin}${window.location.pathname}`;
}

function clearOAuthQueryParams(): void {
	window.history.replaceState({}, document.title, defaultOAuthRedirectUri());
}

function readStoredOAuthFlow(): {
	provider: string;
	state: string;
	codeVerifier: string;
	redirectUri: string;
	email?: string;
	projectId?: string;
} | null {
	try {
		const raw = localStorage.getItem(OAUTH_FLOW_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (typeof parsed.provider !== "string" || typeof parsed.codeVerifier !== "string") {
			return null;
		}
		return {
			provider: parsed.provider,
			state: typeof parsed.state === "string" ? parsed.state : "",
			codeVerifier: parsed.codeVerifier,
			redirectUri: typeof parsed.redirectUri === "string" ? parsed.redirectUri : defaultOAuthRedirectUri(),
			email: typeof parsed.email === "string" ? parsed.email : undefined,
			projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
		};
	} catch {
		return null;
	}
}

async function fetchJson<ResponseBody>(url: URL, signal: AbortSignal): Promise<ResponseBody> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		throw new Error(await formatResponseError(response));
	}

	return response.json() as Promise<ResponseBody>;
}

async function sendJson<ResponseBody>(url: URL, method: string, body?: unknown): Promise<ResponseBody> {
	const response = await fetch(url, {
		method,
		headers: body === undefined ? undefined : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(await formatResponseError(response));
	}

	return response.json() as Promise<ResponseBody>;
}

async function formatResponseError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body.error === "string") {
			return `${response.status} ${body.error}`;
		}
		if (body.error && typeof body.error === "object") {
			const message = (body.error as { message?: unknown }).message;
			if (typeof message === "string") {
				return `${response.status} ${message}`;
			}
		}
	} catch {
		// Fall back to HTTP status text below.
	}

	return `${response.status} ${response.statusText}`;
}

function renderSummary(summary: UsageSummary, records: UsageRecord[]): void {
	metricRecords.textContent = formatNumber(summary.records);
	metricSuccess.textContent = formatNumber(summary.success);
	metricErrors.textContent = formatNumber(summary.error + summary.aborted + summary.skipped);
	metricTokens.textContent = formatNumber(summary.totalTokens);
	metricCost.textContent = formatCurrency(summary.costUsd);
	metricRtkSaved.textContent = formatBytes(records.reduce((total, record) => total + (record.tokenSaver?.bytesSaved ?? 0), 0));
}

function renderRankList(container: HTMLElement, groups: UsageSummaryGroup[]): void {
	if (groups.length === 0) {
		container.innerHTML = `<div class="empty">기록 없음</div>`;
		return;
	}

	container.innerHTML = groups
		.slice(0, 6)
		.map(
			(group) => `
				<div class="rank-row">
					<span class="rank-key" title="${escapeHtml(group.key)}">${escapeHtml(group.key)}</span>
					<span>${formatNumber(group.records)}</span>
					<span>${formatNumber(group.totalTokens)}</span>
					<span>${formatCurrency(group.costUsd)}</span>
				</div>
			`,
		)
		.join("");
}

function renderProviderConnections(connections: ProviderConnectionSummary[]): void {
	if (connections.length === 0) {
		providerConnectionBody.innerHTML = `<tr><td colspan="8" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	providerConnectionBody.innerHTML = connections
		.map((connection) => {
			const nextActive = !connection.isActive;
			const name = formatProviderConnectionName(connection);
			const credential = [
				connection.hasApiKey ? "API key" : "",
				connection.hasAccessToken ? "Access token" : "",
				connection.hasRefreshToken ? "Refresh token" : "",
			]
				.filter(Boolean)
				.join(" + ");
			const error = formatProviderConnectionError(connection);
			return `
				<tr>
					<td title="${escapeHtml(connection.id)}">
						<strong>${escapeHtml(name)}</strong>
						<span class="muted-id">${escapeHtml(connection.id)}</span>
					</td>
					<td>${escapeHtml(connection.provider)}</td>
					<td>${escapeHtml(connection.authType)}</td>
					<td>${escapeHtml(credential || "-")}</td>
					<td>${escapeHtml(String(connection.priority ?? "-"))}</td>
					<td title="${escapeHtml(error)}">
						<span class="badge ${connection.isActive ? "configured" : "inactive"}">${connection.isActive ? "활성" : "비활성"}</span>
						${connection.testStatus ? `<span class="muted-id">${escapeHtml(connection.testStatus)}</span>` : ""}
					</td>
					<td>${escapeHtml(connection.lastUsedAt ? formatDateTime(connection.lastUsedAt) : "-")}</td>
					<td class="action-cell">
						<button class="small-button secondary" type="button" data-toggle-provider-connection-id="${escapeHtml(connection.id)}" data-next-active="${String(nextActive)}">
							${connection.isActive ? "끄기" : "켜기"}
						</button>
						<button class="small-button danger" type="button" data-delete-provider-connection-id="${escapeHtml(connection.id)}">
							삭제
						</button>
					</td>
				</tr>
			`;
		})
		.join("");
}

function renderAccountSelection(groups: AccountSelectionGroup[]): void {
	if (groups.length === 0) {
		accountSelectionBody.innerHTML = `<tr><td colspan="5" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	accountSelectionBody.innerHTML = groups
		.map((group) => {
			const selected = group.candidates.find((candidate) => candidate.selected);
			const reason = selected?.reasons.join(" · ") || group.message || group.status;
			const candidates = group.candidates
				.map((candidate) => {
					const quota = typeof candidate.remainingPercentage === "number" ? ` · ${candidate.remainingPercentage.toFixed(1)}%` : "";
					const label = candidate.selected ? "선택" : candidate.selectable ? "가능" : "제외";
					return `${candidate.id} (${label}${quota})`;
				})
				.join("\n");
			return `
				<tr>
					<td>${escapeHtml(group.provider)}</td>
					<td>
						${escapeHtml(group.strategy)}
						<span class="muted-id">${escapeHtml(group.quotaStrategy)}</span>
					</td>
					<td title="${escapeHtml(group.selectedConnectionId ?? "")}">
						<span class="badge ${group.status === "selected" ? "configured" : "missing"}">${escapeHtml(group.status)}</span>
						<span class="muted-id">${escapeHtml(group.selectedConnectionId ?? "-")}</span>
					</td>
					<td title="${escapeHtml(reason)}">${escapeHtml(reason)}</td>
					<td class="multiline-cell" title="${escapeHtml(candidates)}">${escapeHtml(candidates || "-")}</td>
				</tr>
			`;
		})
		.join("");
}

function renderProviderSettings(settings: ProviderConnectionSettings): void {
	settingsQuotaStrategySelect.value = settings.quotaStrategy ?? "prefer-remaining";
	settingsQuotaMinInput.value = settings.quotaMinRemainingPercentage === undefined ? "" : String(settings.quotaMinRemainingPercentage);
	settingsQuotaTtlInput.value = settings.quotaRefreshTtlMs === undefined ? "" : String(settings.quotaRefreshTtlMs);
	settingsBudgetModeSelect.value = settings.budgetLimits?.mode ?? "off";
	settingsBudgetRequestInput.value = settings.budgetLimits?.requestUsd == null ? "" : String(settings.budgetLimits.requestUsd);
	settingsBudgetDailyInput.value = settings.budgetLimits?.dailyUsd == null ? "" : String(settings.budgetLimits.dailyUsd);
	settingsBudgetMonthlyInput.value = settings.budgetLimits?.monthlyUsd == null ? "" : String(settings.budgetLimits.monthlyUsd);
	providerSettingsTitle.textContent = [
		`quota ${settings.quotaStrategy ?? "prefer-remaining"}`,
		`budget ${settings.budgetLimits?.mode ?? "off"}`,
		settings.rtkEnabled === false ? "RTK off" : "RTK on",
	].join(" · ");
}

function renderBudgetStatus(status: BudgetStatus | null): void {
	if (!status) {
		budgetStatus.innerHTML = `<div class="empty">budget 상태 없음</div>`;
		return;
	}

	const badgeClass = status.shouldBlock ? "cooldown" : status.shouldWarn ? "skipped" : status.mode === "off" ? "inactive" : "configured";
	const providerLabel = status.provider ? `provider ${status.provider}` : "global";
	const violations =
		status.violations.length > 0
			? `<div class="budget-violations">${status.violations.map((item) => `<span>${escapeHtml(item.message)}</span>`).join("")}</div>`
			: "";

	budgetStatus.innerHTML = `
		<div class="budget-status-header">
			<span class="badge ${badgeClass}">${escapeHtml(status.mode)}</span>
			<span>${escapeHtml(providerLabel)}</span>
			<span>request ${status.requestLimitUsd === null ? "-" : formatCurrency(status.requestLimitUsd)}</span>
			<span>updated ${escapeHtml(formatDateTime(status.generatedAt))}</span>
		</div>
		<div class="budget-window-grid">
			${renderBudgetWindow("Daily", status.daily)}
			${renderBudgetWindow("Monthly", status.monthly)}
		</div>
		${violations}
	`;
}

function renderBudgetWindow(label: string, window: BudgetUsageWindow): string {
	const percent = window.limitUsd === null ? null : Math.max(0, Math.min(100, window.usedPercentage ?? 0));
	const limitLabel = window.limitUsd === null ? "limit -" : `limit ${formatCurrency(window.limitUsd)}`;
	const remainingLabel = window.remainingUsd === null ? "remaining -" : `remaining ${formatCurrency(window.remainingUsd)}`;
	return `
		<div class="budget-window ${window.exhausted ? "exhausted" : ""}">
			<div>
				<strong>${escapeHtml(label)}</strong>
				<span>${formatCurrency(window.usedUsd)} used · ${limitLabel}</span>
			</div>
			<div>
				<span>${remainingLabel}</span>
				<span>projected ${formatCurrency(window.projectedUsd)}</span>
			</div>
			${percent === null ? "" : `<span class="quota-bar budget-bar"><span style="width: ${percent}%"></span></span>`}
		</div>
	`;
}

function renderRoutingPolicy(policy: RouterPolicy): void {
	renderRoutingPolicyMappings(policy);

	const combos = getRouterPolicyCombos(policy);
	if (combos.length === 0) {
		routingPolicyBody.innerHTML = `<tr><td colspan="5" class="empty-row">등록된 fallback chain 없음</td></tr>`;
		return;
	}

	routingPolicyBody.innerHTML = combos
		.map(
			(combo, index) => `
				<tr>
					<td>
						<strong>${escapeHtml(combo.name)}</strong>
						${combo.kind ? `<span class="muted-id">${escapeHtml(combo.kind)}</span>` : ""}
					</td>
					<td>${escapeHtml(combo.strategy ?? policy.comboStrategy ?? "fallback")}</td>
					<td>${escapeHtml(String(combo.stickyLimit ?? policy.comboStickyLimit ?? 1))}</td>
					<td class="multiline-cell">${escapeHtml(combo.models.join("\n"))}</td>
					<td class="action-cell">
						<button class="small-button secondary" type="button" data-move-routing-combo="${escapeHtml(combo.name)}" data-move-routing-direction="up" ${index === 0 ? "disabled" : ""}>
							위
						</button>
						<button class="small-button secondary" type="button" data-move-routing-combo="${escapeHtml(combo.name)}" data-move-routing-direction="down" ${index === combos.length - 1 ? "disabled" : ""}>
							아래
						</button>
						<button class="small-button secondary" type="button" data-edit-routing-combo="${escapeHtml(combo.name)}">
							수정
						</button>
						<button class="small-button danger" type="button" data-delete-routing-combo="${escapeHtml(combo.name)}">
							삭제
						</button>
					</td>
				</tr>
			`,
		)
		.join("");
}

function renderRoutingPolicyMappings(policy: RouterPolicy): void {
	const aliases = getRouterPolicyMappings(policy.aliases);
	const intents = getRouterPolicyMappings(policy.intents);
	if (aliases.length === 0 && intents.length === 0) {
		routingPolicyMappingBody.innerHTML = `<tr><td colspan="4" class="empty-row">등록된 alias / intent 없음</td></tr>`;
		return;
	}

	const aliasRows = aliases.map((mapping) => renderRoutingPolicyMappingRow("alias", mapping));
	const intentRows = intents.map((mapping) => renderRoutingPolicyMappingRow("intent", mapping));
	routingPolicyMappingBody.innerHTML = [...aliasRows, ...intentRows].join("");
}

function renderRoutingPolicyMappingRow(type: "alias" | "intent", mapping: RouterPolicyMapping): string {
	const editAttribute = type === "alias" ? "data-edit-routing-alias" : "data-edit-routing-intent";
	const deleteAttribute = type === "alias" ? "data-delete-routing-alias" : "data-delete-routing-intent";
	return `
		<tr>
			<td><span class="badge configured">${type}</span></td>
			<td><strong>${escapeHtml(mapping.name)}</strong></td>
			<td class="multiline-cell">${escapeHtml(mapping.models.join("\n"))}</td>
			<td class="action-cell">
				<button class="small-button secondary" type="button" ${editAttribute}="${escapeHtml(mapping.name)}">
					수정
				</button>
				<button class="small-button danger" type="button" ${deleteAttribute}="${escapeHtml(mapping.name)}">
					삭제
				</button>
			</td>
		</tr>
	`;
}

function fillRoutingPolicyForm(combo: RouterPolicyCombo): void {
	routingPolicyNameInput.value = combo.name;
	routingPolicyModelsInput.value = combo.models.join(", ");
	routingPolicyStrategySelect.value = combo.strategy ?? "fallback";
	routingPolicyStickyLimitInput.value = String(combo.stickyLimit ?? 1);
	routingPolicyPreviewModelInput.value = combo.name.startsWith("combo:") ? combo.name : `combo:${combo.name}`;
}

function fillRoutingAliasForm(mapping: RouterPolicyMapping): void {
	routingAliasNameInput.value = mapping.name;
	routingAliasModelsInput.value = mapping.models.join(", ");
	routingPolicyPreviewModelInput.value = mapping.name;
}

function fillRoutingIntentForm(mapping: RouterPolicyMapping): void {
	routingIntentNameInput.value = mapping.name;
	routingIntentModelsInput.value = mapping.models.join(", ");
	routingPolicyPreviewModelInput.value = `auto:${mapping.name}`;
}

function renderProviderStatuses(providers: ProviderStatus[]): void {
	if (providers.length === 0) {
		providerStatusBody.innerHTML = `<tr><td colspan="7" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	providerStatusBody.innerHTML = providers
		.slice(0, 12)
		.map(
			(provider) => `
				<tr>
					<td title="${escapeHtml(provider.id)}">
						<strong>${escapeHtml(provider.name)}</strong>
						<span class="muted-id">${escapeHtml(provider.id)}</span>
					</td>
					<td title="${escapeHtml(provider.healthReason)}">
						<span class="badge ${providerHealthClass(provider.health)}">${escapeHtml(provider.health)}</span>
						<span class="muted-id">${escapeHtml(provider.healthReason)}</span>
					</td>
					<td><span class="badge ${provider.configured ? "configured" : "missing"}">${provider.configured ? "설정됨" : "미설정"}</span></td>
					<td>${escapeHtml(provider.authLabel ?? provider.authSource ?? "-")}</td>
					<td>${formatNumber(provider.models)}</td>
					<td>${formatNumber(provider.availableModels)}</td>
					<td>
						${formatNumber(provider.activeConnectionCount)}/${formatNumber(provider.connectionCount)}
						<span class="muted-id">${formatNumber(provider.errorConnectionCount)} 오류 · ${formatNumber(provider.cooldownLockCount)} cooldown</span>
					</td>
				</tr>
			`,
		)
		.join("");
}

function renderProviderProbes(probes: ProviderProbe[]): void {
	if (probes.length === 0) {
		providerProbeBody.innerHTML = `<tr><td colspan="4" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	providerProbeBody.innerHTML = probes
		.slice(0, 12)
		.map(
			(probe) => `
				<tr>
					<td title="${escapeHtml(probe.id)}">
						<strong>${escapeHtml(probe.name)}</strong>
						<span class="muted-id">${escapeHtml(probe.id)}</span>
					</td>
					<td>
						<span class="badge ${providerProbeClass(probe.status)}">${escapeHtml(probe.status)}</span>
						<span class="muted-id">${escapeHtml(formatDateTime(probe.checkedAt))}</span>
					</td>
					<td class="multiline-cell">${escapeHtml(formatProbeChecks(probe.checks))}</td>
					<td class="multiline-cell">${escapeHtml(
						probe.connections.length === 0
							? "-"
							: probe.connections
									.map((connection) => `${connection.name ?? connection.id}: ${connection.status} (${formatProbeChecks(connection.checks)})`)
									.join("\n"),
					)}</td>
				</tr>
			`,
		)
		.join("");
}

function renderProxyPools(proxyPools: ProxyPool[]): void {
	if (proxyPools.length === 0) {
		proxyPoolBody.innerHTML = `<tr><td colspan="6" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	proxyPoolBody.innerHTML = proxyPools
		.map((proxyPool) => {
			const nextActive = !proxyPool.isActive;
			const testMeta =
				[proxyPool.testStatus, proxyPool.lastTestedAt ? formatDateTime(proxyPool.lastTestedAt) : ""]
					.filter(Boolean)
					.join(" · ") || "-";
			const lastError = proxyPool.lastError ? ` title="${escapeHtml(formatUnknownError(proxyPool.lastError))}"` : "";
			return `
				<tr>
					<td title="${escapeHtml(proxyPool.id)}">
						<strong>${escapeHtml(proxyPool.name)}</strong>
						<span class="muted-id">${escapeHtml(proxyPool.id)}</span>
					</td>
					<td>${escapeHtml(proxyPool.type)}</td>
					<td title="${escapeHtml(proxyPool.proxyUrl)}">${escapeHtml(proxyPool.proxyUrl)}</td>
					<td${lastError}>
						<span class="badge ${proxyPool.isActive ? "configured" : "inactive"}">${proxyPool.isActive ? "활성" : "비활성"}</span>
						<span class="muted-id">${escapeHtml(testMeta)}</span>
					</td>
					<td>${formatNumber(proxyPool.boundConnectionCount ?? 0)}</td>
					<td class="action-cell">
						<button class="small-button" type="button" data-test-proxy-pool-id="${escapeHtml(proxyPool.id)}">
							테스트
						</button>
						<button class="small-button secondary" type="button" data-toggle-proxy-pool-id="${escapeHtml(proxyPool.id)}" data-next-active="${String(nextActive)}">
							${proxyPool.isActive ? "끄기" : "켜기"}
						</button>
						<button class="small-button danger" type="button" data-delete-proxy-pool-id="${escapeHtml(proxyPool.id)}" ${proxyPool.boundConnectionCount ? "disabled" : ""}>
							삭제
						</button>
					</td>
				</tr>
			`;
		})
		.join("");
}

function renderProviderQuotaConnections(connections: ProviderQuotaConnectionStatus[], proxyPools: ProxyPool[]): void {
	if (connections.length === 0) {
		providerQuotaBody.innerHTML = `<tr><td colspan="8" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	providerQuotaBody.innerHTML = connections
		.slice(0, 20)
		.map((connection) => {
			const connectionName = formatQuotaConnectionName(connection);
			const errorText = formatQuotaConnectionError(connection);
			const testStatus = connection.testStatus ? ` · ${connection.testStatus}` : "";
			const quotaSnapshot = formatQuotaSnapshot(connection);

			return `
				<tr>
					<td title="${escapeHtml(connection.id)}">
						<strong>${escapeHtml(connectionName)}</strong>
						<span class="muted-id">${escapeHtml(connection.id)}</span>
					</td>
					<td>${escapeHtml(connection.provider)}</td>
					<td>${escapeHtml(formatQuotaAuth(connection))}</td>
					<td>${renderProxyPoolSelect(connection, proxyPools)}</td>
					<td title="${escapeHtml(quotaSnapshot)}">
						<span class="badge ${quotaBadgeClass(connection)}">${quotaBadgeLabel(connection)}</span>
						<span class="muted-id">${escapeHtml(quotaSnapshot)}</span>
					</td>
					<td>${escapeHtml(connection.isActive ? `활성${testStatus}` : `비활성${testStatus}`)}</td>
					<td title="${escapeHtml(errorText)}">${escapeHtml(errorText || "-")}</td>
					<td>
						<button class="small-button" type="button" data-quota-connection-id="${escapeHtml(connection.id)}" ${connection.eligible ? "" : "disabled"}>
							조회
						</button>
					</td>
				</tr>
			`;
		})
		.join("");
}

function renderModelAvailability(response: ModelAvailabilityResponse): void {
	const rows = response.data
		.flatMap((connection) => connection.locks.map((lock) => ({ connection, lock })))
		.sort((left, right) => Date.parse(left.lock.until) - Date.parse(right.lock.until));

	modelAvailabilityTitle.textContent =
		rows.length === 0
			? `전체 ${formatNumber(response.count)}개 connection · 잠긴 모델 없음`
			: `${formatNumber(response.lockedConnectionCount)}개 connection · ${formatNumber(response.lockedModelCount)}개 model`;

	if (rows.length === 0) {
		modelAvailabilityBody.innerHTML = `<tr><td colspan="7" class="empty-row">쿨다운 없음</td></tr>`;
		return;
	}

	modelAvailabilityBody.innerHTML = rows
		.map(({ connection, lock }) => {
			const connectionName = formatAvailabilityConnectionName(connection);
			const errorText = formatAvailabilityConnectionError(connection);
			const clearModel = lock.model ?? "__all";

			return `
				<tr>
					<td title="${escapeHtml(connection.id)}">
						<strong>${escapeHtml(connectionName)}</strong>
						<span class="muted-id">${escapeHtml(connection.id)}</span>
					</td>
					<td>${escapeHtml(connection.provider)}</td>
					<td title="${escapeHtml(lock.key)}">${escapeHtml(lock.scope === "all" ? "전체 모델" : (lock.model ?? "-"))}</td>
					<td><span class="badge cooldown">${escapeHtml(lock.retryAfterHuman)}</span></td>
					<td>${escapeHtml(formatDateTime(lock.until))}</td>
					<td title="${escapeHtml(errorText)}">${escapeHtml(errorText || "-")}</td>
					<td>
						<button
							class="small-button secondary"
							type="button"
							data-clear-cooldown-provider="${escapeHtml(connection.provider)}"
							data-clear-cooldown-model="${escapeHtml(clearModel)}"
						>
							해제
						</button>
					</td>
				</tr>
			`;
		})
		.join("");
}

function renderMediaRoutes(response: MediaRoutesResponse | null): void {
	if (!response) {
		mediaRouteBody.innerHTML = `<tr><td colspan="5" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	const grouped = response.routes.reduce<Map<string, MediaRoute[]>>((map, route) => {
		const routes = map.get(route.kind) ?? [];
		routes.push(route);
		map.set(route.kind, routes);
		return map;
	}, new Map());

	mediaRouteBody.innerHTML = [...grouped.entries()]
		.map(
			([kind, routes]) => `
				<tr>
					<td>${escapeHtml(mediaKindLabel(kind))}</td>
					<td><code>${escapeHtml(mediaEndpointForKind(kind))}</code></td>
					<td>${escapeHtml([...new Set(routes.map((route) => route.authHeader))].join(", "))}</td>
					<td class="multiline-cell">${escapeHtml(routes.map((route) => `${route.provider}${route.format ? ` (${route.format})` : ""}`).join("\n"))}</td>
					<td class="multiline-cell">${escapeHtml((response.aliases[`auto:${kind}`] ?? []).join("\n"))}</td>
				</tr>
			`,
		)
		.join("");
}

function renderProxyPoolSelect(connection: ProviderQuotaConnectionStatus, proxyPools: ProxyPool[]): string {
	const selectedProxyPoolId = connection.proxyPoolId ?? "";
	const options = [
		`<option value="" ${selectedProxyPoolId ? "" : "selected"}>없음</option>`,
		...proxyPools.map(
			(proxyPool) =>
				`<option value="${escapeHtml(proxyPool.id)}" ${proxyPool.id === selectedProxyPoolId ? "selected" : ""}>${escapeHtml(proxyPool.name)}</option>`,
		),
	];

	return `
		<select class="compact-select" data-connection-proxy-pool-id="${escapeHtml(connection.id)}">
			${options.join("")}
		</select>
	`;
}

function renderQuotaDetail(detail: ProviderQuotaDetailResponse): void {
	const connectionName = formatQuotaConnectionName(detail.connection);
	const usage = detail.usage;
	const quotas = Object.entries(usage.quotas ?? {});
	const selection = detail.connection.quotaSelection;
	const metaItems = [
		usage.plan ? `Plan ${usage.plan}` : "",
		usage.resetDate ? `Reset ${formatResetValue(usage.resetDate)}` : "",
		selection?.status ? `Selection ${selection.status}` : "",
		typeof selection?.remainingPercentage === "number" ? `Remaining ${selection.remainingPercentage.toFixed(1)}%` : "",
	].filter(Boolean);

	quotaDetailTitle.textContent = `${detail.connection.provider} / ${connectionName}`;
	quotaDetailBody.innerHTML = `
		${metaItems.length > 0 ? `<div class="quota-meta">${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
		${selection ? renderQuotaSelection(selection) : ""}
		${usage.message ? `<div class="quota-message">${escapeHtml(usage.message)}</div>` : ""}
		${
			quotas.length > 0
				? `
					<div class="table-wrap">
						<table class="quota-detail-table">
							<thead>
								<tr>
									<th>Quota</th>
									<th>Used</th>
									<th>Remaining</th>
									<th>Total</th>
									<th>Reset</th>
								</tr>
							</thead>
							<tbody>
								${quotas.map(([name, quota]) => renderQuotaDetailRow(name, quota)).join("")}
							</tbody>
						</table>
					</div>
				`
				: `<div class="empty">상세 기록 없음</div>`
		}
	`;
}

function renderQuotaDetailRow(name: string, quota: ProviderQuotaWindow): string {
	const percent = typeof quota.remainingPercentage === "number" ? Math.max(0, Math.min(100, quota.remainingPercentage)) : null;
	return `
		<tr>
			<td title="${escapeHtml(name)}">${escapeHtml(quota.displayName ?? name)}</td>
			<td>${escapeHtml(formatQuotaNumber(quota.used))}</td>
			<td>
				${escapeHtml(formatQuotaRemaining(quota))}
				${percent === null ? "" : `<span class="quota-bar"><span style="width: ${percent}%"></span></span>`}
			</td>
			<td>${escapeHtml(quota.unlimited ? "무제한" : formatQuotaNumber(quota.total))}</td>
			<td>${escapeHtml(formatResetValue(quota.resetAt))}</td>
		</tr>
	`;
}

function renderQuotaSelection(selection: NonNullable<ProviderQuotaConnectionStatus["quotaSelection"]>): string {
	return `
		<div class="quota-selection">
			<span>checked ${escapeHtml(selection.checkedAt ? formatDateTime(selection.checkedAt) : "-")}</span>
			<span>score ${escapeHtml(typeof selection.score === "number" ? selection.score.toFixed(2) : "-")}</span>
			<span>reset ${escapeHtml(formatResetValue(selection.resetAt))}</span>
			${selection.message ? `<span title="${escapeHtml(selection.message)}">${escapeHtml(selection.message)}</span>` : ""}
		</div>
	`;
}

function renderQuotaDetailLoading(connectionId: string): void {
	quotaDetailTitle.textContent = connectionId;
	quotaDetailBody.innerHTML = `<div class="empty">조회 중</div>`;
}

function renderQuotaDetailError(connectionId: string, message: string): void {
	quotaDetailTitle.textContent = connectionId;
	quotaDetailBody.innerHTML = `<div class="empty error-text">${escapeHtml(message)}</div>`;
}

function renderQuotaDetailEmpty(title: string): void {
	quotaDetailTitle.textContent = title;
	quotaDetailBody.innerHTML = `<div class="empty">선택 없음</div>`;
}

function renderRecords(records: UsageRecord[]): void {
	if (records.length === 0) {
		recordsBody.innerHTML = `<tr><td colspan="13" class="empty-row">기록 없음</td></tr>`;
		return;
	}

	recordsBody.innerHTML = records
		.map((record) => {
			const routeDisplay = formatRouteDisplay(record);
			return `
					<tr>
						<td>${formatDateTime(record.timestamp)}</td>
						<td><span class="badge ${record.status}">${statusLabel(record.status)}</span></td>
						<td title="${escapeHtml(record.endpoint ?? "")}">${escapeHtml(record.endpoint ?? "-")}</td>
						<td title="${escapeHtml(record.requestedModel)}">${escapeHtml(record.requestedModel)}</td>
					<td title="${escapeHtml(`${record.resolvedProvider}/${record.resolvedModel}`)}">
						${escapeHtml(record.resolvedProvider)}/${escapeHtml(record.resolvedModel)}
					</td>
						<td title="${escapeHtml(routeDisplay.title)}">${renderRouteDisplay(routeDisplay)}</td>
						<td title="${escapeHtml(record.connectionId ?? "")}">${escapeHtml(record.connectionId ?? "-")}</td>
						<td>${record.attemptIndex + 1}/${record.attemptCount}</td>
						<td title="${escapeHtml(formatTokenBreakdown(record))}">${formatNumber(recordTokenTotal(record))}</td>
						<td title="${escapeHtml(record.cost?.pricingSource ?? "")}">${formatCurrency(recordCost(record))}</td>
					<td title="${escapeHtml(record.tokenSaver?.filters.join(", ") ?? "")}">${formatBytes(record.tokenSaver?.bytesSaved ?? 0)}</td>
					<td title="${escapeHtml(record.errorMessage ?? "")}">${escapeHtml(record.errorMessage ?? "")}</td>
					<td>
						<button class="small-button secondary" type="button" data-request-detail-id="${escapeHtml(record.requestId)}">
							상세
						</button>
						</td>
					</tr>
				`;
		})
		.join("");
}

function renderRequestDetail(detail: UsageDetailResponse): void {
	requestDetailTitle.textContent = `${detail.requestId} · ${formatNumber(detail.count)} attempt`;
	if (detail.timeline.length === 0) {
		requestDetailBody.innerHTML = `<div class="empty">기록 없음</div>`;
		return;
	}

	const trace = detail.trace ?? [];
	requestDetailBody.innerHTML = `
		<div class="quota-meta">
			<span>tokens ${formatNumber(detail.summary.totalTokens)}</span>
			<span>cost ${formatCurrency(detail.summary.costUsd)}</span>
			<span>success ${formatNumber(detail.summary.success)}</span>
			<span>error ${formatNumber(detail.summary.error + detail.summary.aborted + detail.summary.skipped)}</span>
			<span>trace ${formatNumber(trace.length)}</span>
		</div>
			<div class="timeline">
				${detail.timeline
					.map((item) => {
						const routeDisplay = formatRouteDisplay(item);
						return `
							<div class="timeline-item ${escapeHtml(item.status)}">
								<div>
									<strong>${escapeHtml(`${item.resolvedProvider}/${item.resolvedModel}`)}</strong>
									<span class="muted-id" title="${escapeHtml(routeDisplay.title)}">
										${escapeHtml(routeDisplay.label)} · ${escapeHtml(routeDisplay.note)} · attempt ${item.attemptIndex + 1}/${item.attemptCount}
									</span>
								</div>
								<div>
									<span class="badge ${item.status}">${statusLabel(item.status)}</span>
									<span class="muted-id">${escapeHtml(formatDateTime(item.timestamp))}</span>
								</div>
							<div title="${escapeHtml(item.connectionId ?? "")}">
								${escapeHtml(item.connectionId ?? "-")}
								<span class="muted-id">${formatNumber(item.tokens)} tokens · ${formatCurrency(item.costUsd)}</span>
								</div>
								<div title="${escapeHtml(item.errorMessage ?? "")}">${escapeHtml(item.errorMessage ?? "")}</div>
							</div>
						`;
					})
					.join("")}
			</div>
			<div class="raw-trace">
			<h3>Raw event trace</h3>
			${
				trace.length === 0
					? `<div class="empty">trace 없음</div>`
					: trace
							.map(
								(event) => `
									<div class="trace-row">
										<span>${escapeHtml(formatDateTime(event.timestamp))}</span>
										<strong>${escapeHtml(event.phase)}</strong>
										<span>${escapeHtml(event.status ?? "-")}</span>
										<span title="${escapeHtml(event.connectionId ?? "")}">${escapeHtml(event.connectionId ?? "-")}</span>
										<span>${escapeHtml(formatTraceMetadata(event.metadata))}</span>
										<span title="${escapeHtml(event.message ?? "")}">${escapeHtml(event.message ?? "")}</span>
									</div>
								`,
							)
							.join("")
			}
		</div>
	`;
}

function quotaBadgeLabel(connection: ProviderQuotaConnectionStatus): string {
	if (!connection.isActive) return "비활성";
	if (connection.eligible) return "조회 가능";
	if (connection.supported) return "인증 확인";
	return "미지원";
}

function quotaBadgeClass(connection: ProviderQuotaConnectionStatus): string {
	if (!connection.isActive) return "inactive";
	if (connection.eligible) return "configured";
	if (connection.supported) return "skipped";
	return "missing";
}

function providerHealthClass(health: ProviderStatus["health"]): string {
	if (health === "healthy") return "configured";
	if (health === "degraded") return "skipped";
	if (health === "cooldown") return "cooldown";
	return "missing";
}

function providerProbeClass(status: ProviderProbe["status"]): string {
	if (status === "healthy") return "configured";
	if (status === "warning") return "skipped";
	if (status === "blocked") return "missing";
	return "inactive";
}

function formatProbeChecks(checks: ProviderProbeCheck[]): string {
	return checks.map((check) => `${check.name}: ${check.status} - ${check.message}`).join("\n");
}

function mediaKindLabel(kind: string): string {
	switch (kind) {
		case "embedding":
			return "Embeddings";
		case "webSearch":
			return "Web search";
		case "webFetch":
			return "Web fetch";
		case "tts":
			return "TTS";
		case "stt":
			return "STT";
		case "image":
			return "Image";
		default:
			return kind;
	}
}

function mediaEndpointForKind(kind: string): string {
	switch (kind) {
		case "embedding":
			return "/v1/embeddings";
		case "webSearch":
			return "/v1/search";
		case "webFetch":
			return "/v1/web/fetch";
		case "tts":
			return "/v1/audio/speech";
		case "stt":
			return "/v1/audio/transcriptions";
		case "image":
			return "/v1/images/generations";
		default:
			return "-";
	}
}

function formatQuotaConnectionName(connection: ProviderQuotaConnectionStatus): string {
	return connection.displayName ?? connection.name ?? connection.email ?? connection.id;
}

function formatProviderConnectionName(connection: ProviderConnectionSummary): string {
	return connection.displayName ?? connection.name ?? connection.email ?? connection.id;
}

function formatProviderConnectionError(connection: ProviderConnectionSummary): string {
	const parts = [
		connection.errorCode ? `code ${connection.errorCode}` : "",
		formatUnknownError(connection.lastError),
		connection.lastErrorAt ? formatDateTime(connection.lastErrorAt) : "",
	].filter(Boolean);

	return parts.join(" · ");
}

function formatQuotaAuth(connection: ProviderQuotaConnectionStatus): string {
	if (connection.usageAuthType !== "unsupported") {
		return connection.usageAuthType;
	}
	return connection.authType;
}

function formatQuotaSnapshot(connection: ProviderQuotaConnectionStatus): string {
	const snapshot = connection.quotaSelection;
	if (!snapshot) return "-";
	const parts = [
		snapshot.status ?? "",
		typeof snapshot.remainingPercentage === "number" ? `${snapshot.remainingPercentage.toFixed(1)}%` : "",
		snapshot.checkedAt ? formatDateTime(snapshot.checkedAt) : "",
	].filter(Boolean);
	return parts.join(" · ") || "-";
}

function formatQuotaNumber(value: number | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "-";
	return formatNumber(Number.isInteger(value) ? value : Number(value.toFixed(2)));
}

function formatQuotaRemaining(quota: ProviderQuotaWindow): string {
	if (quota.unlimited) return "무제한";
	const value = formatQuotaNumber(quota.remaining);
	if (typeof quota.remainingPercentage !== "number" || !Number.isFinite(quota.remainingPercentage)) {
		return value;
	}

	return `${value} (${quota.remainingPercentage.toFixed(1)}%)`;
}

function formatResetValue(value: string | number | null | undefined): string {
	if (value === null || value === undefined || value === "") return "-";
	if (typeof value === "number") {
		return formatDateTime(new Date(value < 1e12 ? value * 1000 : value).toISOString());
	}
	return formatDateTime(value);
}

function formatQuotaConnectionError(connection: ProviderQuotaConnectionStatus): string {
	const parts = [
		connection.errorCode ? `code ${connection.errorCode}` : "",
		formatUnknownError(connection.lastError),
		connection.lastErrorAt ? formatDateTime(connection.lastErrorAt) : "",
	].filter(Boolean);

	return parts.join(" · ");
}

function formatAvailabilityConnectionName(connection: ModelAvailabilityConnection): string {
	return connection.displayName ?? connection.name ?? connection.email ?? connection.id;
}

function formatAvailabilityConnectionError(connection: ModelAvailabilityConnection): string {
	const parts = [
		connection.errorCode ? `code ${connection.errorCode}` : "",
		formatUnknownError(connection.lastError),
		connection.lastErrorAt ? formatDateTime(connection.lastErrorAt) : "",
	].filter(Boolean);

	return parts.join(" · ");
}

function formatUnknownError(value: unknown): string {
	if (!value) return "";
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.message;
	if (typeof value === "object") {
		const maybeMessage = (value as { message?: unknown }).message;
		if (typeof maybeMessage === "string") return maybeMessage;
		try {
			return JSON.stringify(value);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

function setLoading(isLoading: boolean): void {
	refreshButton.disabled = isLoading;
	refreshButton.textContent = isLoading ? "조회 중" : "새로고침";
}

function setStatus(message: string, isError = false): void {
	statusLine.textContent = message;
	statusLine.classList.toggle("error", isError);
}

function recordTokenTotal(record: UsageRecord): number {
	return record.usage?.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
}

function recordCost(record: UsageRecord): number {
	return record.cost?.total ?? record.costUsd ?? 0;
}

interface RouteDisplayInput {
	requestedModel?: string;
	routingMode?: string;
	routeSource?: string;
	resolvedProvider: string;
	resolvedModel: string;
	attemptIndex: number;
	attemptCount: number;
}

interface RouteDisplay {
	label: string;
	note: string;
	className: string;
	title: string;
}

function formatRouteDisplay(input: RouteDisplayInput): RouteDisplay {
	const source = input.routeSource ?? input.routingMode ?? "-";
	const sourceKey = source.toLowerCase();
	const requestedModel = normalizeRequestedModel(input.requestedModel);
	const resolvedModel = `${input.resolvedProvider}/${input.resolvedModel}`;
	const routeSummary = [
		`raw route: ${source}`,
		requestedModel ? `requested: ${requestedModel}` : "",
		`resolved: ${resolvedModel}`,
		`attempt: ${input.attemptIndex + 1}/${input.attemptCount}`,
	]
		.filter(Boolean)
		.join(" · ");

	if (sourceKey === "fallback") {
		if (input.attemptCount <= 1) {
			return {
				label: "Direct",
				note: "fallback-ready",
				className: "direct",
				title: `직접 지정한 모델이 그대로 실행되었습니다. 실패하면 fallback 후보가 있을 때 다음 후보로 전환됩니다. ${routeSummary}`,
			};
		}

		if (input.attemptIndex === 0) {
			return {
				label: "Primary",
				note: "fallback chain",
				className: "primary",
				title: `fallback chain의 첫 번째 후보입니다. ${routeSummary}`,
			};
		}

		return {
			label: "Fallback",
			note: `attempt ${input.attemptIndex + 1}/${input.attemptCount}`,
			className: "fallback",
			title: `앞선 후보 실패 후 fallback 후보가 실행되었습니다. ${routeSummary}`,
		};
	}

	if (sourceKey === "router") {
		return {
			label: "Router",
			note: "auto selected",
			className: "router",
			title: `라우터 정책으로 모델이 선택되었습니다. ${routeSummary}`,
		};
	}

	if (sourceKey === "fixed") {
		return {
			label: "Fixed",
			note: "locked model",
			className: "fixed",
			title: `고정 모델로 실행되었습니다. ${routeSummary}`,
		};
	}

	return {
		label: source || "-",
		note: "unknown",
		className: "unknown",
		title: routeSummary,
	};
}

function normalizeRequestedModel(value: string | undefined): string {
	const trimmed = value?.trim() ?? "";
	if (!trimmed) return "";
	for (const prefix of ["fixed:", "fallback:"]) {
		if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim();
	}
	return trimmed;
}

function renderRouteDisplay(display: RouteDisplay): string {
	return `
		<span class="route-display">
			<span class="route-label ${escapeHtml(display.className)}">${escapeHtml(display.label)}</span>
			<span class="route-note">${escapeHtml(display.note)}</span>
		</span>
	`;
}

function formatTokenBreakdown(record: UsageRecord): string {
	if (!record.usage) {
		return `${formatNumber(record.inputTokens ?? 0)} input · ${formatNumber(record.outputTokens ?? 0)} output`;
	}
	const parts = [
		`${formatNumber(record.usage.input)} input`,
		`${formatNumber(record.usage.output)} output`,
		record.usage.cacheRead ? `${formatNumber(record.usage.cacheRead)} cache read` : "",
		record.usage.cacheWrite ? `${formatNumber(record.usage.cacheWrite)} cache write` : "",
		record.usage.reasoning ? `${formatNumber(record.usage.reasoning)} reasoning` : "",
	].filter(Boolean);
	return parts.join(" · ");
}

function formatTraceMetadata(metadata: Record<string, unknown> | undefined): string {
	if (!metadata) return "";
	const compact = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null));
	return Object.keys(compact).length === 0 ? "" : formatUnknownError(compact);
}

function getRouterPolicyCombos(policy: RouterPolicy): RouterPolicyCombo[] {
	return Array.isArray(policy.combos) ? policy.combos : (policy.combos?.combos ?? []);
}

function getRouterPolicyMappings(record: Record<string, string | string[]> | undefined): RouterPolicyMapping[] {
	return Object.entries(record ?? {})
		.map(([name, value]) => ({
			name,
			models: Array.isArray(value) ? value : [value],
		}))
		.map((mapping) => ({
			name: mapping.name.trim(),
			models: mapping.models.map((model) => model.trim()).filter(Boolean),
		}))
		.filter((mapping) => mapping.name && mapping.models.length > 0)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function renderModelSuggestions(modelsResponse: ModelsResponse, mediaRoutes: MediaRoutesResponse | null): void {
	const ids = new Set<string>();
	for (const model of modelsResponse.data) ids.add(model.id);
	for (const values of Object.values(mediaRoutes?.aliases ?? {})) {
		for (const value of values) ids.add(value);
	}
	for (const alias of Object.keys(mediaRoutes?.aliases ?? {})) ids.add(alias);
	modelSuggestions.innerHTML = [...ids]
		.sort((left, right) => left.localeCompare(right))
		.slice(0, 600)
		.map((id) => `<option value="${escapeHtml(id)}"></option>`)
		.join("");
}

function parseJsonObjectInput(value: string): Record<string, unknown> | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = JSON.parse(trimmed) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("providerSpecificData는 JSON object여야 합니다.");
	}
	return parsed as Record<string, unknown>;
}

function nullableInputValue(value: string): string | null {
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function statusLabel(status: UsageRecordStatus): string {
	switch (status) {
		case "success":
			return "성공";
		case "error":
			return "오류";
		case "aborted":
			return "중단";
		case "skipped":
			return "건너뜀";
	}
}

function emptySummary(): UsageSummary {
	return {
		records: 0,
		success: 0,
		error: 0,
		aborted: 0,
		skipped: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		byProvider: [],
		byModel: [],
	};
}

function emptyModelAvailabilityResponse(): ModelAvailabilityResponse {
	return {
		generatedAt: new Date().toISOString(),
		count: 0,
		lockedConnectionCount: 0,
		lockedModelCount: 0,
		data: [],
	};
}

function normalizeApiBase(value: string): string {
	const trimmed = value.trim() || DEFAULT_API_BASE;
	return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function formatDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat("ko-KR", {
		dateStyle: "short",
		timeStyle: "medium",
	}).format(date);
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat("ko-KR").format(value);
}

function formatCurrency(value: number): string {
	return `$${value.toFixed(4)}`;
}

function formatBytes(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "0 B";
	if (value < 1024) return `${Math.round(value)} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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

function getElement<ElementType extends HTMLElement>(id: string): ElementType {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Element #${id} was not found.`);
	}

	return element as ElementType;
}
