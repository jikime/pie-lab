import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export function createUsageRecordId(prefix = "usage") {
    return `${prefix}_${randomUUID()}`;
}
export function queryUsageRecords(records, query = {}) {
    const fromTime = toTimestamp(query.from);
    const toTime = toTimestamp(query.to);
    const statuses = toStringSet(query.status);
    const routingModes = toStringSet(query.routingMode);
    const filtered = records.filter((record) => {
        const recordTime = Date.parse(record.timestamp);
        return (matchesSet(record.status, statuses) &&
            matchesValue(record.resolvedProvider, query.provider) &&
            matchesValue(record.resolvedModel, query.model) &&
            matchesSet(record.routingMode, routingModes) &&
            matchesValue(record.requestId, query.requestId) &&
            matchesValue(record.agentRunId, query.agentRunId) &&
            matchesValue(record.endpoint, query.endpoint) &&
            matchesValue(record.clientOrigin, query.clientOrigin) &&
            (fromTime === undefined || recordTime >= fromTime) &&
            (toTime === undefined || recordTime <= toTime));
    });
    const order = query.order ?? "desc";
    const sorted = [...filtered].sort((left, right) => {
        const leftTime = Date.parse(left.timestamp);
        const rightTime = Date.parse(right.timestamp);
        return order === "asc" ? leftTime - rightTime : rightTime - leftTime;
    });
    return typeof query.limit === "number" ? sorted.slice(0, Math.max(0, query.limit)) : sorted;
}
export function summarizeUsageRecords(records) {
    const total = createUsageSummaryGroup("total");
    const byProvider = new Map();
    const byModel = new Map();
    const byEndpoint = new Map();
    const byClientOrigin = new Map();
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
export class InMemoryUsageStore {
    records = [];
    recordUsage(record) {
        this.records.push({ ...record });
    }
    getUsageRecords() {
        return this.records.map((record) => ({ ...record }));
    }
    clear() {
        this.records.length = 0;
    }
}
export function createInMemoryUsageStore() {
    return new InMemoryUsageStore();
}
export class InMemoryProviderConnectionStore {
    connections;
    proxyPools;
    settings;
    constructor(initialState = {}) {
        this.connections = (initialState.connections ?? []).map(cloneProviderConnection);
        this.proxyPools = (initialState.proxyPools ?? []).map(normalizeProxyPool);
        this.settings = mergeProviderConnectionSettings(initialState.settings);
    }
    async getProviderConnections(filter = {}) {
        return sortProviderConnections(this.connections.filter((connection) => matchesProviderConnectionFilter(connection, filter))).map(cloneProviderConnection);
    }
    async getProviderConnectionById(id) {
        const connection = this.connections.find((item) => item.id === id);
        return connection ? cloneProviderConnection(connection) : null;
    }
    async createProviderConnection(data) {
        const now = new Date().toISOString();
        const providerConnections = this.connections.filter((connection) => connection.provider === data.provider);
        const connection = {
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
    async updateProviderConnection(id, data) {
        const index = this.connections.findIndex((connection) => connection.id === id);
        if (index < 0)
            return null;
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
    async deleteProviderConnection(id) {
        const index = this.connections.findIndex((connection) => connection.id === id);
        if (index < 0)
            return null;
        const [removed] = this.connections.splice(index, 1);
        return removed ? cloneProviderConnection(removed) : null;
    }
    async getSettings() {
        return cloneProviderConnectionSettings(this.settings);
    }
    async updateSettings(updates) {
        this.settings = mergeProviderConnectionSettings({ ...this.settings, ...updates });
        return cloneProviderConnectionSettings(this.settings);
    }
    async getProxyPools(filter = {}) {
        return sortProxyPools(this.proxyPools.filter((proxyPool) => matchesProxyPoolFilter(proxyPool, filter))).map(cloneProxyPool);
    }
    async getProxyPoolById(id) {
        const proxyPool = this.proxyPools.find((item) => item.id === id);
        return proxyPool ? cloneProxyPool(proxyPool) : null;
    }
    async createProxyPool(data) {
        const proxyPool = createProxyPoolFromInput(data);
        this.proxyPools.push(proxyPool);
        return cloneProxyPool(proxyPool);
    }
    async updateProxyPool(id, data) {
        const index = this.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
        if (index < 0)
            return null;
        const updated = updateProxyPoolFromInput(this.proxyPools[index], data);
        this.proxyPools[index] = updated;
        return cloneProxyPool(updated);
    }
    async deleteProxyPool(id) {
        const index = this.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
        if (index < 0)
            return null;
        const [removed] = this.proxyPools.splice(index, 1);
        return removed ? cloneProxyPool(removed) : null;
    }
    clear() {
        this.connections.length = 0;
        this.proxyPools.length = 0;
        this.settings = mergeProviderConnectionSettings();
    }
}
export function createInMemoryProviderConnectionStore(initialState = {}) {
    return new InMemoryProviderConnectionStore(initialState);
}
export class JsonlUsageStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async recordUsage(record) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf-8", flag: "a" });
    }
    async getUsageRecords() {
        try {
            const content = await readFile(this.filePath, "utf-8");
            return content
                .split(/\r?\n/)
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line));
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                return [];
            }
            throw error;
        }
    }
}
export function createJsonlUsageStore(filePath) {
    return new JsonlUsageStore(filePath);
}
export class JsonProviderConnectionStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async getProviderConnections(filter = {}) {
        const state = await this.readState();
        return sortProviderConnections(state.connections.filter((connection) => matchesProviderConnectionFilter(connection, filter))).map(cloneProviderConnection);
    }
    async getProviderConnectionById(id) {
        const state = await this.readState();
        const connection = state.connections.find((item) => item.id === id);
        return connection ? cloneProviderConnection(connection) : null;
    }
    async createProviderConnection(data) {
        const state = await this.readState();
        const now = new Date().toISOString();
        const providerConnections = state.connections.filter((connection) => connection.provider === data.provider);
        const connection = {
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
    async updateProviderConnection(id, data) {
        const state = await this.readState();
        const index = state.connections.findIndex((connection) => connection.id === id);
        if (index < 0)
            return null;
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
    async deleteProviderConnection(id) {
        const state = await this.readState();
        const index = state.connections.findIndex((connection) => connection.id === id);
        if (index < 0)
            return null;
        const [removed] = state.connections.splice(index, 1);
        await this.writeState(state);
        return removed ? cloneProviderConnection(removed) : null;
    }
    async getSettings() {
        const state = await this.readState();
        return cloneProviderConnectionSettings(state.settings);
    }
    async updateSettings(updates) {
        const state = await this.readState();
        state.settings = mergeProviderConnectionSettings({ ...state.settings, ...updates });
        await this.writeState(state);
        return cloneProviderConnectionSettings(state.settings);
    }
    async getProxyPools(filter = {}) {
        const state = await this.readState();
        return sortProxyPools(state.proxyPools.filter((proxyPool) => matchesProxyPoolFilter(proxyPool, filter))).map(cloneProxyPool);
    }
    async getProxyPoolById(id) {
        const state = await this.readState();
        const proxyPool = state.proxyPools.find((item) => item.id === id);
        return proxyPool ? cloneProxyPool(proxyPool) : null;
    }
    async createProxyPool(data) {
        const state = await this.readState();
        const proxyPool = createProxyPoolFromInput(data);
        state.proxyPools.push(proxyPool);
        await this.writeState(state);
        return cloneProxyPool(proxyPool);
    }
    async updateProxyPool(id, data) {
        const state = await this.readState();
        const index = state.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
        if (index < 0)
            return null;
        const updated = updateProxyPoolFromInput(state.proxyPools[index], data);
        state.proxyPools[index] = updated;
        await this.writeState(state);
        return cloneProxyPool(updated);
    }
    async deleteProxyPool(id) {
        const state = await this.readState();
        const index = state.proxyPools.findIndex((proxyPool) => proxyPool.id === id);
        if (index < 0)
            return null;
        const [removed] = state.proxyPools.splice(index, 1);
        await this.writeState(state);
        return removed ? cloneProxyPool(removed) : null;
    }
    async readState() {
        try {
            const content = await readFile(this.filePath, "utf-8");
            return normalizeProviderConnectionState(JSON.parse(content));
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT") {
                return normalizeProviderConnectionState();
            }
            throw error;
        }
    }
    async writeState(state) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(normalizeProviderConnectionState(state), null, 2)}\n`, "utf-8");
    }
}
export function createJsonProviderConnectionStore(filePath) {
    return new JsonProviderConnectionStore(filePath);
}
function isNodeError(error) {
    return error instanceof Error && "code" in error;
}
function createProviderConnectionId(prefix = "conn") {
    return `${prefix}_${randomUUID()}`;
}
export function createProxyPoolId() {
    return randomUUID();
}
function createProviderConnectionName(data, fallbackIndex) {
    if ((data.authType === "oauth" || data.authType === "access_token") && data.email)
        return data.email;
    return data.authType === "apikey" ? `API Key ${fallbackIndex}` : `Account ${fallbackIndex}`;
}
function nextProviderConnectionPriority(connections) {
    return connections.reduce((max, connection) => Math.max(max, connection.priority ?? 0), 0) + 1;
}
function matchesProviderConnectionFilter(connection, filter) {
    return ((filter.provider === undefined || connection.provider === filter.provider) &&
        (filter.isActive === undefined || connection.isActive === filter.isActive));
}
function sortProviderConnections(connections) {
    return [...connections].sort((left, right) => (left.priority || 999) - (right.priority || 999));
}
function matchesProxyPoolFilter(proxyPool, filter) {
    return ((filter.isActive === undefined || proxyPool.isActive === filter.isActive) &&
        (filter.testStatus === undefined || proxyPool.testStatus === filter.testStatus));
}
function sortProxyPools(proxyPools) {
    return [...proxyPools].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || "");
        const rightTime = Date.parse(right.updatedAt || "");
        return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
}
function normalizeProviderConnectionState(state = {}) {
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
function createProxyPoolFromInput(data) {
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
function updateProxyPoolFromInput(existing, data) {
    return normalizeProxyPool({
        ...existing,
        ...data,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
    });
}
function normalizeProxyPool(proxyPool) {
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
        createdAt: normalizeString(proxyPool.createdAt) || now,
        updatedAt: normalizeString(proxyPool.updatedAt) || now,
    };
}
function normalizeProxyPoolType(type) {
    return type === "vercel" ? "vercel" : "http";
}
function normalizeString(value) {
    if (value === undefined || value === null)
        return "";
    return String(value).trim();
}
function mergeProviderConnectionSettings(settings = {}) {
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
function normalizeRouterPolicySettings(policy) {
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
function normalizeStringRecord(record) {
    const normalized = {};
    for (const [key, value] of Object.entries(record ?? {})) {
        const name = normalizeString(key);
        if (!name)
            continue;
        const values = normalizeModelList(value);
        if (values.length === 1)
            normalized[name] = values[0];
        else if (values.length > 1)
            normalized[name] = values;
    }
    return normalized;
}
function normalizeRouterPolicyCombos(combos) {
    const list = Array.isArray(combos) ? combos : (combos?.combos ?? []);
    const seen = new Set();
    const normalized = [];
    for (const combo of list) {
        const name = normalizeString(combo.name);
        if (!name || seen.has(name))
            continue;
        const models = normalizeModelList(combo.models);
        if (models.length === 0)
            continue;
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
function normalizeRouterComboStrategies(strategies) {
    const normalized = {};
    for (const [key, value] of Object.entries(strategies ?? {})) {
        const name = normalizeString(key);
        if (!name)
            continue;
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
function normalizeModelList(value) {
    const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
    return values.map(normalizeString).filter(Boolean);
}
function normalizeRouterComboStrategy(value) {
    return value === "round-robin" ? "round-robin" : "fallback";
}
function normalizeBudgetLimitSettings(settings) {
    const normalized = {
        mode: normalizeBudgetPolicyMode(settings?.mode),
        requestUsd: normalizeNullablePositiveNumber(settings?.requestUsd),
        dailyUsd: normalizeNullablePositiveNumber(settings?.dailyUsd),
        monthlyUsd: normalizeNullablePositiveNumber(settings?.monthlyUsd),
        providerLimits: {},
    };
    for (const [provider, rule] of Object.entries(settings?.providerLimits ?? {})) {
        const name = normalizeString(provider);
        if (!name)
            continue;
        normalized.providerLimits[name] = {
            mode: normalizeBudgetPolicyMode(rule.mode),
            requestUsd: normalizeNullablePositiveNumber(rule.requestUsd),
            dailyUsd: normalizeNullablePositiveNumber(rule.dailyUsd),
            monthlyUsd: normalizeNullablePositiveNumber(rule.monthlyUsd),
        };
    }
    return normalized;
}
function normalizeBudgetPolicyMode(value) {
    if (value === "warn" || value === "block")
        return value;
    return "off";
}
function normalizeNullablePositiveNumber(value) {
    if (value === undefined || value === null || value === "")
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function normalizeStickyLimit(value, fallback) {
    if (typeof value === "number" && Number.isFinite(value))
        return Math.max(1, Math.floor(value));
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return fallback;
        const parsed = Number.parseInt(trimmed, 10);
        return Number.isFinite(parsed) ? Math.max(1, parsed) : trimmed;
    }
    return fallback;
}
function cloneProviderConnection(connection) {
    return JSON.parse(JSON.stringify(connection));
}
function cloneProviderConnectionSettings(settings) {
    return JSON.parse(JSON.stringify(settings));
}
function cloneProxyPool(proxyPool) {
    return JSON.parse(JSON.stringify(proxyPool));
}
function toStringSet(values) {
    if (values === undefined) {
        return undefined;
    }
    return new Set((Array.isArray(values) ? values : [values]).filter((value) => value.length > 0));
}
function matchesSet(value, values) {
    return values === undefined || values.has(value);
}
function matchesValue(value, expected) {
    return expected === undefined || value === expected;
}
function toTimestamp(value) {
    if (value === undefined) {
        return undefined;
    }
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
}
function createUsageSummaryGroup(key) {
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
function getOrCreateGroup(groups, key) {
    const existing = groups.get(key);
    if (existing) {
        return existing;
    }
    const group = createUsageSummaryGroup(key);
    groups.set(key, group);
    return group;
}
function addRecordToGroup(group, record) {
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
function sortSummaryGroups(groups) {
    return groups.sort((left, right) => right.costUsd - left.costUsd || right.totalTokens - left.totalTokens || left.key.localeCompare(right.key));
}
//# sourceMappingURL=index.js.map