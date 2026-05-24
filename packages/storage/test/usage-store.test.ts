import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createInMemoryProviderConnectionStore,
	createInMemoryUsageStore,
	createJsonlUsageStore,
	createJsonProviderConnectionStore,
	createUsageRecordId,
	queryUsageRecords,
	summarizeUsageRecords,
	type UsageRecord,
} from "../src/index.js";

describe("usage stores", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pie-lab-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
		return {
			id: createUsageRecordId(),
			requestId: "request_1",
			timestamp: "2026-05-22T00:00:00.000Z",
			requestedModel: "combo:coding",
			routingMode: "router",
			routeSource: "router",
			resolvedProvider: "anthropic",
			resolvedModel: "claude-sonnet-4.5",
			attemptIndex: 0,
			attemptCount: 2,
			status: "success",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
			},
			cost: {
				input: 0.001,
				output: 0.002,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.003,
				currency: "USD",
				pricingSource: "pie-metadata",
			},
			inputTokens: 10,
			outputTokens: 5,
			costUsd: 0.003,
			...overrides,
		};
	}

	it("keeps usage records in memory", () => {
		const store = createInMemoryUsageStore();
		const record = usageRecord();

		store.recordUsage(record);

		expect(store.getUsageRecords()).toEqual([record]);
	});

	it("persists usage records as JSONL", async () => {
		const store = createJsonlUsageStore(join(tempDir, "usage.jsonl"));
		const first = usageRecord({ id: "usage_1", attemptIndex: 0, status: "error", errorMessage: "rate limit" });
		const second = usageRecord({ id: "usage_2", attemptIndex: 1, status: "success" });

		await store.recordUsage(first);
		await store.recordUsage(second);

		await expect(store.getUsageRecords()).resolves.toEqual([first, second]);
	});

	it("queries usage records by route metadata and time", () => {
		const records = [
			usageRecord({
				id: "usage_1",
				timestamp: "2026-05-22T00:00:00.000Z",
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.1",
				clientOrigin: "pie-chat:web",
				status: "success",
			}),
			usageRecord({
				id: "usage_2",
				timestamp: "2026-05-22T00:01:00.000Z",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				status: "error",
			}),
			usageRecord({
				id: "usage_3",
				timestamp: "2026-05-22T00:02:00.000Z",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				status: "success",
			}),
		];

		expect(
			queryUsageRecords(records, {
				provider: "anthropic",
				status: "success",
				from: "2026-05-22T00:01:30.000Z",
			}).map((record) => record.id),
		).toEqual(["usage_3"]);

		expect(queryUsageRecords(records, { limit: 2 }).map((record) => record.id)).toEqual(["usage_3", "usage_2"]);
		expect(queryUsageRecords(records, { limit: 2, order: "asc" }).map((record) => record.id)).toEqual([
			"usage_1",
			"usage_2",
		]);
		expect(queryUsageRecords(records, { clientOrigin: "pie-chat:web" }).map((record) => record.id)).toEqual([
			"usage_1",
		]);
	});

	it("summarizes tokens and cost by provider and model", () => {
		const records = [
			usageRecord({
				id: "usage_1",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				endpoint: "/v1/chat/completions",
				clientOrigin: "pie-chat:telegram",
				status: "success",
				usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, reasoning: 7, totalTokens: 172 },
				cost: {
					input: 0.1,
					output: 0.2,
					cacheRead: 0.01,
					cacheWrite: 0.02,
					reasoning: 0.03,
					total: 0.36,
					currency: "USD",
					pricingSource: "pie-metadata",
				},
			}),
			usageRecord({
				id: "usage_2",
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.1",
				endpoint: "/v1/embeddings",
				clientOrigin: "dashboard-next:media-test",
				status: "error",
				usage: undefined,
				cost: undefined,
				inputTokens: 10,
				outputTokens: 0,
				costUsd: 0,
			}),
		];

		const summary = summarizeUsageRecords(records);

		expect(summary.records).toBe(2);
		expect(summary.success).toBe(1);
		expect(summary.error).toBe(1);
		expect(summary.inputTokens).toBe(110);
		expect(summary.totalTokens).toBe(182);
		expect(summary.costUsd).toBe(0.36);
		expect(summary.byProvider.map((group) => [group.key, group.records])).toEqual([
			["anthropic", 1],
			["openai", 1],
		]);
		expect(summary.byModel[0]).toMatchObject({
			key: "claude-sonnet-4.5",
			totalTokens: 172,
			costUsd: 0.36,
		});
		expect(summary.byEndpoint.map((group) => [group.key, group.records])).toEqual([
			["/v1/chat/completions", 1],
			["/v1/embeddings", 1],
		]);
		expect(summary.byClientOrigin.map((group) => [group.key, group.records])).toEqual([
			["pie-chat:telegram", 1],
			["dashboard-next:media-test", 1],
		]);
	});
});

describe("provider connection stores", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pie-lab-provider-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("keeps provider connections sorted by 9router priority", async () => {
		const store = createInMemoryProviderConnectionStore();
		const later = await store.createProviderConnection({
			provider: "openai",
			authType: "apikey",
			name: "later",
			priority: 2,
			apiKey: "sk-later",
		});
		const first = await store.createProviderConnection({
			provider: "openai",
			authType: "apikey",
			name: "first",
			priority: 1,
			apiKey: "sk-first",
		});
		await store.createProviderConnection({
			provider: "openai",
			authType: "apikey",
			name: "inactive",
			priority: 0,
			isActive: false,
		});

		await expect(store.getProviderConnections({ provider: "openai", isActive: true })).resolves.toMatchObject([
			{ id: first.id, name: "first" },
			{ id: later.id, name: "later" },
		]);
	});

	it("persists provider connections and routing settings as JSON", async () => {
		const filePath = join(tempDir, "provider-connections.json");
		const store = createJsonProviderConnectionStore(filePath);
		const connection = await store.createProviderConnection({
			provider: "anthropic",
			authType: "oauth",
			email: "teacher@example.com",
			providerSpecificData: { workspace: "default" },
		});
		await store.updateSettings({
			fallbackStrategy: "round-robin",
			stickyRoundRobinLimit: 2,
			providerStrategies: {
				anthropic: { fallbackStrategy: "fill-first", stickyRoundRobinLimit: 1 },
			},
		});

		const reloaded = createJsonProviderConnectionStore(filePath);

		await expect(reloaded.getProviderConnectionById(connection.id)).resolves.toMatchObject({
			id: connection.id,
			provider: "anthropic",
			authType: "oauth",
			email: "teacher@example.com",
			isActive: true,
			priority: 1,
		});
		await expect(reloaded.getSettings()).resolves.toEqual({
			fallbackStrategy: "round-robin",
			stickyRoundRobinLimit: 2,
			quotaStrategy: "prefer-remaining",
			quotaMinRemainingPercentage: 0,
			quotaMaxAgeMs: 300000,
			quotaRefreshBeforeSelection: true,
			quotaRefreshTtlMs: 60000,
			rtkEnabled: true,
			budgetLimits: {
				mode: "off",
				requestUsd: null,
				dailyUsd: null,
				monthlyUsd: null,
				providerLimits: {},
			},
			routerPolicy: {
				aliases: {},
				intents: {},
				combos: [],
				comboStrategy: "fallback",
				comboStickyLimit: 1,
				comboStrategies: {},
			},
			providerStrategies: {
				anthropic: { fallbackStrategy: "fill-first", stickyRoundRobinLimit: 1 },
			},
		});
	});

	it("normalizes router policy settings for editable fallback chains", async () => {
		const store = createInMemoryProviderConnectionStore();

		await store.updateSettings({
			routerPolicy: {
				aliases: { "auto:coding": "anthropic/claude-sonnet-4.5" },
				intents: { chat: ["openai/gpt-5.4", "anthropic/claude-haiku-4.5"] },
				combos: [
					{
						name: "premium-coding",
						models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
						strategy: "round-robin",
						stickyLimit: "2",
					},
				],
			},
		});

		await expect(store.getSettings()).resolves.toMatchObject({
			routerPolicy: {
				aliases: { "auto:coding": "anthropic/claude-sonnet-4.5" },
				intents: { chat: ["openai/gpt-5.4", "anthropic/claude-haiku-4.5"] },
				combos: [
					{
						name: "premium-coding",
						models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
						strategy: "round-robin",
						stickyLimit: 2,
					},
				],
			},
		});
	});

	it("stores proxy pools with 9router defaults and filters", async () => {
		const store = createInMemoryProviderConnectionStore();
		await store.createProxyPool({
			id: "proxy_pool_inactive",
			name: "Inactive proxy",
			proxyUrl: "http://127.0.0.1:9090",
			isActive: false,
			testStatus: "failed",
		});
		const active = await store.createProxyPool({
			id: "proxy_pool_relay",
			name: "Relay proxy",
			proxyUrl: "https://relay.example/api",
			type: "vercel",
			noProxy: "localhost",
		});

		await expect(store.getProxyPoolById(active.id)).resolves.toMatchObject({
			id: "proxy_pool_relay",
			name: "Relay proxy",
			proxyUrl: "https://relay.example/api",
			noProxy: "localhost",
			type: "vercel",
			isActive: true,
			strictProxy: false,
			testStatus: "unknown",
		});
		await expect(store.getProxyPools({ isActive: true })).resolves.toMatchObject([{ id: "proxy_pool_relay" }]);
		await expect(store.getProxyPools({ testStatus: "failed" })).resolves.toMatchObject([
			{ id: "proxy_pool_inactive" },
		]);
	});

	it("persists proxy pools inside provider connection JSON state", async () => {
		const filePath = join(tempDir, "provider-connections.json");
		const store = createJsonProviderConnectionStore(filePath);
		const proxyPool = await store.createProxyPool({
			id: "proxy_pool_1",
			name: "Local proxy",
			proxyUrl: "127.0.0.1:7890",
			strictProxy: true,
		});
		await store.updateProxyPool(proxyPool.id, {
			testStatus: "ok",
			lastTestedAt: "2026-05-22T00:00:00.000Z",
		});

		const reloaded = createJsonProviderConnectionStore(filePath);

		await expect(reloaded.getProxyPoolById(proxyPool.id)).resolves.toMatchObject({
			id: "proxy_pool_1",
			name: "Local proxy",
			proxyUrl: "127.0.0.1:7890",
			type: "http",
			isActive: true,
			strictProxy: true,
			testStatus: "ok",
			lastTestedAt: "2026-05-22T00:00:00.000Z",
		});
		await expect(reloaded.deleteProxyPool(proxyPool.id)).resolves.toMatchObject({
			id: "proxy_pool_1",
		});
		await expect(reloaded.getProxyPoolById(proxyPool.id)).resolves.toBeNull();
	});
});
