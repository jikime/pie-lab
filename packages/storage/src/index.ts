import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
	combos?: RouterPolicyCombo[] | { combos?: RouterPolicyCombo[] };
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

export function createUsageRecordId(prefix = "usage"): string {
	return `${prefix}_${randomUUID()}`;
}

export function queryUsageRecords(records: readonly UsageRecord[], query: UsageRecordQuery = {}): UsageRecord[] {
	const fromTime = toTimestamp(query.from);
	const toTime = toTimestamp(query.to);
	const statuses = toStringSet(query.status);
	const routingModes = toStringSet(query.routingMode);

	const filtered = records.filter((record) => {
		const recordTime = Date.parse(record.timestamp);

		return (
			matchesSet(record.status, statuses) &&
			matchesValue(record.resolvedProvider, query.provider) &&
			matchesValue(record.resolvedModel, query.model) &&
			matchesSet(record.routingMode, routingModes) &&
			matchesValue(record.requestId, query.requestId) &&
			matchesValue(record.agentRunId, query.agentRunId) &&
			matchesValue(record.endpoint, query.endpoint) &&
			matchesValue(record.clientOrigin, query.clientOrigin) &&
			(fromTime === undefined || recordTime >= fromTime) &&
			(toTime === undefined || recordTime <= toTime)
		);
	});

	const order = query.order ?? "desc";
	const sorted = [...filtered].sort((left, right) => {
		const leftTime = Date.parse(left.timestamp);
		const rightTime = Date.parse(right.timestamp);
		return order === "asc" ? leftTime - rightTime : rightTime - leftTime;
	});

	return typeof query.limit === "number" ? sorted.slice(0, Math.max(0, query.limit)) : sorted;
}

export function summarizeUsageRecords(records: readonly UsageRecord[]): UsageSummary {
	const total = createUsageSummaryGroup("total");
	const byProvider = new Map<string, UsageSummaryGroup>();
	const byModel = new Map<string, UsageSummaryGroup>();
	const byEndpoint = new Map<string, UsageSummaryGroup>();
	const byClientOrigin = new Map<string, UsageSummaryGroup>();

	for (const record of records) {
		addRecordToGroup(total, record);
		addRecordToGroup(getOrCreateGroup(byProvider, record.resolvedProvider), record);
		addRecordToGroup(getOrCreateGroup(byModel, record.resolvedModel), record);
		addRecordToGroup(getOrCreateGroup(byEndpoint, record.endpoint ?? "unknown"), record);
		addRecordToGroup(getOrCreateGroup(byClientOrigin, record.clientOrigin ?? "unknown"), record);
	}

	return {
		...total,
		byProvider: sortSummaryGroups([...byProvider.values()]),
		byModel: sortSummaryGroups([...byModel.values()]),
		byEndpoint: sortSummaryGroups([...byEndpoint.values()]),
		byClientOrigin: sortSummaryGroups([...byClientOrigin.values()]),
	};
}

export class InMemoryUsageStore implements UsageStore {
	private readonly records: UsageRecord[] = [];

	recordUsage(record: UsageRecord): void {
		this.records.push({ ...record });
	}

	getUsageRecords(): UsageRecord[] {
		return this.records.map((record) => ({ ...record }));
	}

	clear(): void {
		this.records.length = 0;
	}
}

export function createInMemoryUsageStore(): InMemoryUsageStore {
	return new InMemoryUsageStore();
}

export class InMemoryProviderConnectionStore implements ProviderConnectionStore {
	private readonly connections: ProviderConnection[];
	private readonly proxyPools: ProxyPool[];
	private settings: ProviderConnectionSettings;

	constructor(initialState: Partial<ProviderConnectionJsonState> = {}) {
		this.connections = (initialState.connections ?? []).map(cloneProviderConnection);
		this.proxyPools = (initialState.proxyPools ?? []).map(normalizeProxyPool);
		this.settings = mergeProviderConnectionSettings(initialState.settings);
	}

	async getProviderConnections(filter: ProviderConnectionFilter = {}): Promise<ProviderConnection[]> {
		return sortProviderConnections(
			this.connections.filter((connection) => matchesProviderConnectionFilter(connection, filter)),
		).map(cloneProviderConnection);
	}

	async getProviderConnectionById(id: string): Promise<ProviderConnection | null> {
		const connection = this.connections.find((item) => item.id === id);
		return connection ? cloneProviderConnection(connection) : null;
	}

	async createProviderConnection(data: CreateProviderConnectionInput): Promise<ProviderConnection> {
		const now = new Date().toISOString();
		const providerConnections = this.connections.filter((connection) => connection.provider === data.provider);
		const connection: ProviderConnection = {
			...data,
			id: createProviderConnectionId(),
			provider: data.provider,
			authType: data.authType ?? "oauth",
			name: data.name ?? createProviderConnectionName(data, providerConnections.length + 1),
			priority: data.priority ?? nextProviderConnectionPriority(providerConnections),
			isActive: data.isActive ?? true,
			createdAt: now,
			updatedAt: now,
		};

		this.connections.push(connection);
		return cloneProviderConnection(connection);
	}

	async updateProviderConnection(id: string, data: UpdateProviderConnectionInput): Promise<ProviderConnection | null> {
		const index = this.connections.findIndex((connection) => connection.id === id);
		if (index < 0) return null;

		const existing = this.connections[index];
		const updated = {
			...existing,
			...data,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: new Date().toISOString(),
		};
		this.connections[index] = updated;
		return cloneProviderConnection(updated);
	}

	async deleteProviderConnection(id: string): Promise<ProviderConnection | null> {
		const index = this.connections.findIndex((connection) => connection.id === id);
		if (index < 0) return null;

		const [removed] = this.connections.splice(index, 1);
		return removed ? cloneProviderConnection(removed) : null;
	}

	async getSettings(): Promise<ProviderConnectionSettings> {
		return cloneProviderConnectionSettings(this.settings);
	}

	async updateSettings(updates: ProviderConnectionSettings): Promise<ProviderConnectionSettings> {
		this.settings = mergeProviderConnectionSettings({ ...this.settings, ...updates });
		return cloneProviderConnectionSettings(this.settings);
	}

	async getProxyPools(filter: ProxyPoolFilter = {}): Promise<ProxyPool[]> {
		return sortProxyPools(this.proxyPools.filter((proxyPool) => matchesProxyPoolFilter(proxyPool, filter))).map(
			cloneProxyPool,
		);
	}

	async getProxyPoolById(id: string): Promise<ProxyPool | null> {
		const proxyPool = this.proxyPools.find((item) => item.id === id);
		return proxyPool ? cloneProxyPool(proxyPool) : null;
	}

	async createProxyPool(data: CreateProxyPoolInput): Promise<ProxyPool> {
		const proxyPool = createProxyPoolFromInput(data);
		this.proxyPools.push(proxyPool);
		return cloneProxyPool(proxyPool);
	}

	async updateProxyPool(id: string, data: UpdateProxyPoolInput): Promise<ProxyPool | null> {
		const index = this.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
		if (index < 0) return null;

		const updated = updateProxyPoolFromInput(this.proxyPools[index], data);
		this.proxyPools[index] = updated;
		return cloneProxyPool(updated);
	}

	async deleteProxyPool(id: string): Promise<ProxyPool | null> {
		const index = this.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
		if (index < 0) return null;

		const [removed] = this.proxyPools.splice(index, 1);
		return removed ? cloneProxyPool(removed) : null;
	}

	clear(): void {
		this.connections.length = 0;
		this.proxyPools.length = 0;
		this.settings = mergeProviderConnectionSettings();
	}
}

export function createInMemoryProviderConnectionStore(
	initialState: Partial<ProviderConnectionJsonState> = {},
): InMemoryProviderConnectionStore {
	return new InMemoryProviderConnectionStore(initialState);
}

export class JsonlUsageStore implements UsageStore {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async recordUsage(record: UsageRecord): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "a" });
	}

	async getUsageRecords(): Promise<UsageRecord[]> {
		try {
			const content = await readFile(this.filePath, "utf-8");
			return content
				.split(/\r?\n/)
				.filter((line) => line.trim().length > 0)
				.map((line) => JSON.parse(line) as UsageRecord);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return [];
			}
			throw error;
		}
	}
}

export function createJsonlUsageStore(filePath: string): JsonlUsageStore {
	return new JsonlUsageStore(filePath);
}

export class JsonProviderConnectionStore implements ProviderConnectionStore {
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
	}

	async getProviderConnections(filter: ProviderConnectionFilter = {}): Promise<ProviderConnection[]> {
		const state = await this.readState();
		return sortProviderConnections(
			state.connections.filter((connection) => matchesProviderConnectionFilter(connection, filter)),
		).map(cloneProviderConnection);
	}

	async getProviderConnectionById(id: string): Promise<ProviderConnection | null> {
		const state = await this.readState();
		const connection = state.connections.find((item) => item.id === id);
		return connection ? cloneProviderConnection(connection) : null;
	}

	async createProviderConnection(data: CreateProviderConnectionInput): Promise<ProviderConnection> {
		const state = await this.readState();
		const now = new Date().toISOString();
		const providerConnections = state.connections.filter((connection) => connection.provider === data.provider);
		const connection: ProviderConnection = {
			...data,
			id: createProviderConnectionId(),
			provider: data.provider,
			authType: data.authType ?? "oauth",
			name: data.name ?? createProviderConnectionName(data, providerConnections.length + 1),
			priority: data.priority ?? nextProviderConnectionPriority(providerConnections),
			isActive: data.isActive ?? true,
			createdAt: now,
			updatedAt: now,
		};

		state.connections.push(connection);
		await this.writeState(state);
		return cloneProviderConnection(connection);
	}

	async updateProviderConnection(id: string, data: UpdateProviderConnectionInput): Promise<ProviderConnection | null> {
		const state = await this.readState();
		const index = state.connections.findIndex((connection) => connection.id === id);
		if (index < 0) return null;

		const existing = state.connections[index];
		const updated = {
			...existing,
			...data,
			id: existing.id,
			createdAt: existing.createdAt,
			updatedAt: new Date().toISOString(),
		};
		state.connections[index] = updated;
		await this.writeState(state);
		return cloneProviderConnection(updated);
	}

	async deleteProviderConnection(id: string): Promise<ProviderConnection | null> {
		const state = await this.readState();
		const index = state.connections.findIndex((connection) => connection.id === id);
		if (index < 0) return null;

		const [removed] = state.connections.splice(index, 1);
		await this.writeState(state);
		return removed ? cloneProviderConnection(removed) : null;
	}

	async getSettings(): Promise<ProviderConnectionSettings> {
		const state = await this.readState();
		return cloneProviderConnectionSettings(state.settings);
	}

	async updateSettings(updates: ProviderConnectionSettings): Promise<ProviderConnectionSettings> {
		const state = await this.readState();
		state.settings = mergeProviderConnectionSettings({ ...state.settings, ...updates });
		await this.writeState(state);
		return cloneProviderConnectionSettings(state.settings);
	}

	async getProxyPools(filter: ProxyPoolFilter = {}): Promise<ProxyPool[]> {
		const state = await this.readState();
		return sortProxyPools(state.proxyPools.filter((proxyPool) => matchesProxyPoolFilter(proxyPool, filter))).map(
			cloneProxyPool,
		);
	}

	async getProxyPoolById(id: string): Promise<ProxyPool | null> {
		const state = await this.readState();
		const proxyPool = state.proxyPools.find((item) => item.id === id);
		return proxyPool ? cloneProxyPool(proxyPool) : null;
	}

	async createProxyPool(data: CreateProxyPoolInput): Promise<ProxyPool> {
		const state = await this.readState();
		const proxyPool = createProxyPoolFromInput(data);
		state.proxyPools.push(proxyPool);
		await this.writeState(state);
		return cloneProxyPool(proxyPool);
	}

	async updateProxyPool(id: string, data: UpdateProxyPoolInput): Promise<ProxyPool | null> {
		const state = await this.readState();
		const index = state.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
		if (index < 0) return null;

		const updated = updateProxyPoolFromInput(state.proxyPools[index], data);
		state.proxyPools[index] = updated;
		await this.writeState(state);
		return cloneProxyPool(updated);
	}

	async deleteProxyPool(id: string): Promise<ProxyPool | null> {
		const state = await this.readState();
		const index = state.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
		if (index < 0) return null;

		const [removed] = state.proxyPools.splice(index, 1);
		await this.writeState(state);
		return removed ? cloneProxyPool(removed) : null;
	}

	private async readState(): Promise<ProviderConnectionJsonState> {
		try {
			const content = await readFile(this.filePath, "utf-8");
			return normalizeProviderConnectionState(JSON.parse(content) as Partial<ProviderConnectionJsonState>);
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return normalizeProviderConnectionState();
			}
			throw error;
		}
	}

	private async writeState(state: ProviderConnectionJsonState): Promise<void> {
		await mkdir(dirname(this.filePath), { recursive: true });
		await writeFile(this.filePath, `${JSON.stringify(normalizeProviderConnectionState(state), null, 2)}\n`, "utf-8");
	}
}

export function createJsonProviderConnectionStore(filePath: string): JsonProviderConnectionStore {
	return new JsonProviderConnectionStore(filePath);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function createProviderConnectionId(prefix = "conn"): string {
	return `${prefix}_${randomUUID()}`;
}

export function createProxyPoolId(): string {
	return randomUUID();
}

function createProviderConnectionName(data: CreateProviderConnectionInput, fallbackIndex: number): string | null {
	if ((data.authType === "oauth" || data.authType === "access_token") && data.email) return data.email;
	return data.authType === "apikey" ? `API Key ${fallbackIndex}` : `Account ${fallbackIndex}`;
}

function nextProviderConnectionPriority(connections: readonly ProviderConnection[]): number {
	return connections.reduce((max, connection) => Math.max(max, connection.priority ?? 0), 0) + 1;
}

function matchesProviderConnectionFilter(connection: ProviderConnection, filter: ProviderConnectionFilter): boolean {
	return (
		(filter.provider === undefined || connection.provider === filter.provider) &&
		(filter.isActive === undefined || connection.isActive === filter.isActive)
	);
}

function sortProviderConnections(connections: readonly ProviderConnection[]): ProviderConnection[] {
	return [...connections].sort((left, right) => (left.priority || 999) - (right.priority || 999));
}

function matchesProxyPoolFilter(proxyPool: ProxyPool, filter: ProxyPoolFilter): boolean {
	return (
		(filter.isActive === undefined || proxyPool.isActive === filter.isActive) &&
		(filter.testStatus === undefined || proxyPool.testStatus === filter.testStatus)
	);
}

function sortProxyPools(proxyPools: readonly ProxyPool[]): ProxyPool[] {
	return [...proxyPools].sort((left, right) => {
		const leftTime = Date.parse(left.updatedAt || "");
		const rightTime = Date.parse(right.updatedAt || "");
		return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
	});
}

function normalizeProviderConnectionState(
	state: Partial<ProviderConnectionJsonState> = {},
): ProviderConnectionJsonState {
	return {
		connections: (state.connections ?? []).map((connection) => ({
			...connection,
			authType: connection.authType ?? "oauth",
			isActive: connection.isActive !== false,
			createdAt: connection.createdAt ?? new Date().toISOString(),
			updatedAt: connection.updatedAt ?? new Date().toISOString(),
		})),
		settings: mergeProviderConnectionSettings(state.settings),
		proxyPools: (state.proxyPools ?? []).map(normalizeProxyPool),
	};
}

function createProxyPoolFromInput(data: CreateProxyPoolInput): ProxyPool {
	const now = new Date().toISOString();
	return normalizeProxyPool({
		...data,
		id: data.id ?? createProxyPoolId(),
		noProxy: data.noProxy ?? "",
		type: data.type ?? "http",
		isActive: data.isActive !== undefined ? data.isActive : true,
		strictProxy: data.strictProxy === true,
		testStatus: data.testStatus ?? "unknown",
		lastTestedAt: data.lastTestedAt ?? null,
		lastError: data.lastError ?? null,
		createdAt: now,
		updatedAt: now,
	});
}

function updateProxyPoolFromInput(existing: ProxyPool, data: UpdateProxyPoolInput): ProxyPool {
	return normalizeProxyPool({
		...existing,
		...data,
		id: existing.id,
		createdAt: existing.createdAt,
		updatedAt: new Date().toISOString(),
	});
}

function normalizeProxyPool(proxyPool: ProxyPool | CreateProxyPoolInput): ProxyPool {
	const now = new Date().toISOString();
	return {
		...proxyPool,
		id: normalizeString(proxyPool.id) || createProxyPoolId(),
		name: normalizeString(proxyPool.name),
		proxyUrl: normalizeString(proxyPool.proxyUrl),
		noProxy: normalizeString(proxyPool.noProxy),
		type: normalizeProxyPoolType(proxyPool.type),
		isActive: proxyPool.isActive !== false,
		strictProxy: proxyPool.strictProxy === true,
		testStatus: normalizeString(proxyPool.testStatus) || "unknown",
		lastTestedAt: proxyPool.lastTestedAt ?? null,
		lastError: proxyPool.lastError ?? null,
		createdAt: normalizeString((proxyPool as Partial<ProxyPool>).createdAt) || now,
		updatedAt: normalizeString((proxyPool as Partial<ProxyPool>).updatedAt) || now,
	};
}

function normalizeProxyPoolType(type: unknown): ProxyPoolType {
	return type === "vercel" ? "vercel" : "http";
}

function normalizeString(value: unknown): string {
	if (value === undefined || value === null) return "";
	return String(value).trim();
}

function mergeProviderConnectionSettings(settings: ProviderConnectionSettings = {}): ProviderConnectionSettings {
	return {
		fallbackStrategy: settings.fallbackStrategy ?? "fill-first",
		stickyRoundRobinLimit: settings.stickyRoundRobinLimit ?? 3,
		quotaStrategy: settings.quotaStrategy ?? "prefer-remaining",
		quotaMinRemainingPercentage: settings.quotaMinRemainingPercentage ?? 0,
		quotaMaxAgeMs: settings.quotaMaxAgeMs ?? 5 * 60 * 1000,
		quotaRefreshBeforeSelection: settings.quotaRefreshBeforeSelection ?? true,
		quotaRefreshTtlMs: settings.quotaRefreshTtlMs ?? 60 * 1000,
		rtkEnabled: settings.rtkEnabled ?? true,
		budgetLimits: normalizeBudgetLimitSettings(settings.budgetLimits),
		routerPolicy: normalizeRouterPolicySettings(settings.routerPolicy),
		providerStrategies: { ...(settings.providerStrategies ?? {}) },
	};
}

function normalizeRouterPolicySettings(policy: RouterPolicySettings | undefined): RouterPolicySettings {
	if (!policy) {
		return {
			aliases: {},
			intents: {},
			combos: [],
			comboStrategy: "fallback",
			comboStickyLimit: 1,
			comboStrategies: {},
		};
	}

	return {
		aliases: normalizeStringRecord(policy.aliases),
		intents: normalizeStringRecord(policy.intents),
		combos: normalizeRouterPolicyCombos(policy.combos),
		comboStrategy: normalizeRouterComboStrategy(policy.comboStrategy),
		comboStickyLimit: normalizeStickyLimit(policy.comboStickyLimit, 1),
		comboStrategies: normalizeRouterComboStrategies(policy.comboStrategies),
	};
}

function normalizeStringRecord(
	record: Record<string, string | string[]> | undefined,
): Record<string, string | string[]> {
	const normalized: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(record ?? {})) {
		const name = normalizeString(key);
		if (!name) continue;
		const values = normalizeModelList(value);
		if (values.length === 1) normalized[name] = values[0];
		else if (values.length > 1) normalized[name] = values;
	}
	return normalized;
}

function normalizeRouterPolicyCombos(combos: RouterPolicySettings["combos"] | undefined): RouterPolicyCombo[] {
	const list = Array.isArray(combos) ? combos : (combos?.combos ?? []);
	const seen = new Set<string>();
	const normalized: RouterPolicyCombo[] = [];
	for (const combo of list) {
		const name = normalizeString(combo.name);
		if (!name || seen.has(name)) continue;
		const models = normalizeModelList(combo.models);
		if (models.length === 0) continue;
		seen.add(name);
		normalized.push({
			name,
			models,
			kind: normalizeString(combo.kind) || null,
			strategy: normalizeRouterComboStrategy(combo.strategy),
			stickyLimit: normalizeStickyLimit(combo.stickyLimit, 1),
		});
	}
	return normalized;
}

function normalizeRouterComboStrategies(
	strategies: RouterPolicySettings["comboStrategies"] | undefined,
): Record<string, RouterComboStrategy | RouterPolicyComboStrategyConfig> {
	const normalized: Record<string, RouterComboStrategy | RouterPolicyComboStrategyConfig> = {};
	for (const [key, value] of Object.entries(strategies ?? {})) {
		const name = normalizeString(key);
		if (!name) continue;
		if (typeof value === "string") {
			normalized[name] = normalizeRouterComboStrategy(value);
			continue;
		}
		normalized[name] = {
			strategy: normalizeRouterComboStrategy(value?.strategy),
			stickyLimit: normalizeStickyLimit(value?.stickyLimit, 1),
		};
	}
	return normalized;
}

function normalizeModelList(value: string | string[] | undefined): string[] {
	const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
	return values.map(normalizeString).filter(Boolean);
}

function normalizeRouterComboStrategy(value: unknown): RouterComboStrategy {
	return value === "round-robin" ? "round-robin" : "fallback";
}

function normalizeBudgetLimitSettings(settings: BudgetLimitSettings | undefined): BudgetLimitSettings {
	const normalized: BudgetLimitSettings = {
		mode: normalizeBudgetPolicyMode(settings?.mode),
		requestUsd: normalizeNullablePositiveNumber(settings?.requestUsd),
		dailyUsd: normalizeNullablePositiveNumber(settings?.dailyUsd),
		monthlyUsd: normalizeNullablePositiveNumber(settings?.monthlyUsd),
		providerLimits: {},
	};

	for (const [provider, rule] of Object.entries(settings?.providerLimits ?? {})) {
		const name = normalizeString(provider);
		if (!name) continue;
		normalized.providerLimits![name] = {
			mode: normalizeBudgetPolicyMode(rule.mode),
			requestUsd: normalizeNullablePositiveNumber(rule.requestUsd),
			dailyUsd: normalizeNullablePositiveNumber(rule.dailyUsd),
			monthlyUsd: normalizeNullablePositiveNumber(rule.monthlyUsd),
		};
	}

	return normalized;
}

function normalizeBudgetPolicyMode(value: unknown): BudgetPolicyMode {
	if (value === "warn" || value === "block") return value;
	return "off";
}

function normalizeNullablePositiveNumber(value: unknown): number | null {
	if (value === undefined || value === null || value === "") return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeStickyLimit(value: unknown, fallback: number): number | string {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.floor(value));
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed) return fallback;
		const parsed = Number.parseInt(trimmed, 10);
		return Number.isFinite(parsed) ? Math.max(1, parsed) : trimmed;
	}
	return fallback;
}

function cloneProviderConnection(connection: ProviderConnection): ProviderConnection {
	return JSON.parse(JSON.stringify(connection)) as ProviderConnection;
}

function cloneProviderConnectionSettings(settings: ProviderConnectionSettings): ProviderConnectionSettings {
	return JSON.parse(JSON.stringify(settings)) as ProviderConnectionSettings;
}

function cloneProxyPool(proxyPool: ProxyPool): ProxyPool {
	return JSON.parse(JSON.stringify(proxyPool)) as ProxyPool;
}

function toStringSet(values?: string | string[]): Set<string> | undefined {
	if (values === undefined) {
		return undefined;
	}

	return new Set((Array.isArray(values) ? values : [values]).filter((value) => value.length > 0));
}

function matchesSet(value: string, values?: Set<string>): boolean {
	return values === undefined || values.has(value);
}

function matchesValue(value: string | undefined, expected?: string): boolean {
	return expected === undefined || value === expected;
}

function toTimestamp(value?: string | Date): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isNaN(timestamp) ? undefined : timestamp;
}

function createUsageSummaryGroup(key: string): UsageSummaryGroup {
	return {
		key,
		records: 0,
		success: 0,
		error: 0,
		aborted: 0,
		skipped: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		costUsd: 0,
	};
}

function getOrCreateGroup(groups: Map<string, UsageSummaryGroup>, key: string): UsageSummaryGroup {
	const existing = groups.get(key);
	if (existing) {
		return existing;
	}

	const group = createUsageSummaryGroup(key);
	groups.set(key, group);
	return group;
}

function addRecordToGroup(group: UsageSummaryGroup, record: UsageRecord): void {
	group.records += 1;
	group[record.status] += 1;
	group.inputTokens += record.usage?.input ?? record.inputTokens ?? 0;
	group.outputTokens += record.usage?.output ?? record.outputTokens ?? 0;
	group.cacheReadTokens += record.usage?.cacheRead ?? 0;
	group.cacheWriteTokens += record.usage?.cacheWrite ?? 0;
	group.reasoningTokens += record.usage?.reasoning ?? 0;
	group.totalTokens += record.usage?.totalTokens ?? (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
	group.costUsd += record.cost?.total ?? record.costUsd ?? 0;
}

function sortSummaryGroups(groups: UsageSummaryGroup[]): UsageSummaryGroup[] {
	return groups.sort(
		(left, right) =>
			right.costUsd - left.costUsd || right.totalTokens - left.totalTokens || left.key.localeCompare(right.key),
	);
}
