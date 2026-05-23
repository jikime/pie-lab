import { describe, expect, it } from "vitest";
import {
	applyErrorState,
	checkFallbackError,
	compressPayloadWithRtk,
	createPiRouteResolver,
	explainProviderConnectionSelection,
	extractProviderResetCooldownMs,
	filterAvailableAccounts,
	formatModelSelection,
	getRotatedModels,
	getRoutingMode,
	isRouterAlias,
	ModelSelectionParseError,
	PIE_LAB_QUOTA_SELECTION_KEY,
	PIE_LAB_ROUTER_PROVIDER,
	type PiModelCatalog,
	type PiModelReference,
	parseModelSelection,
	RouteResolutionError,
	resetComboRotation,
	resolvePiModelRoute,
	resolvePiModelRoutePlan,
	resolveRoute,
	selectProviderConnection,
} from "../src/index.js";

describe("parseModelSelection", () => {
	it("parses fixed model selections", () => {
		expect(parseModelSelection("fixed:openai/gpt-4.1-mini")).toEqual({
			mode: "fixed",
			model: "openai/gpt-4.1-mini",
		});
	});

	it("parses explicit fallback model selections", () => {
		expect(parseModelSelection("fallback:anthropic/claude-sonnet-4.5")).toEqual({
			mode: "fallback",
			primary: "anthropic/claude-sonnet-4.5",
		});
	});

	it("defaults provider/model strings to fallback mode", () => {
		expect(parseModelSelection("openai/gpt-4.1-mini")).toEqual({
			mode: "fallback",
			primary: "openai/gpt-4.1-mini",
		});
	});

	it("parses auto aliases as router mode", () => {
		expect(parseModelSelection("auto:coding")).toEqual({
			mode: "router",
			intent: "coding",
			alias: "auto:coding",
		});
	});

	it("parses cheap aliases with low budget constraint", () => {
		expect(parseModelSelection("cheap:coding")).toEqual({
			mode: "router",
			intent: "coding",
			alias: "cheap:coding",
			constraints: { budget: "low" },
		});
	});

	it("parses fast aliases with low latency constraint", () => {
		expect(parseModelSelection("fast:chat")).toEqual({
			mode: "router",
			intent: "chat",
			alias: "fast:chat",
			constraints: { latency: "low" },
		});
	});

	it("parses combo aliases as router mode", () => {
		expect(parseModelSelection("combo:coding")).toEqual({
			mode: "router",
			intent: "coding",
			alias: "combo:coding",
		});
	});

	it("rejects empty selections", () => {
		expect(() => parseModelSelection(" ")).toThrow(ModelSelectionParseError);
	});

	it("rejects missing prefixed values", () => {
		expect(() => parseModelSelection("fixed:")).toThrow(ModelSelectionParseError);
	});
});

describe("resolveRoute", () => {
	it("resolves provider/model strings without a resolver", async () => {
		await expect(resolveRoute({ requestedModel: "openai/gpt-4.1-mini" })).resolves.toEqual({
			requestedModel: "openai/gpt-4.1-mini",
			routingMode: "fallback",
			resolvedProvider: "openai",
			resolvedModel: "gpt-4.1-mini",
			source: "fallback",
			mode: "fallback",
		});
	});

	it("keeps fixed mode when resolving provider/model strings", async () => {
		await expect(resolveRoute({ requestedModel: "fixed:openai/gpt-4.1-mini" })).resolves.toEqual({
			requestedModel: "fixed:openai/gpt-4.1-mini",
			routingMode: "fixed",
			resolvedProvider: "openai",
			resolvedModel: "gpt-4.1-mini",
			source: "fixed",
			mode: "fixed",
		});
	});

	it("uses resolveModel when supplied", async () => {
		await expect(
			resolveRoute({
				requestedModel: "fallback:claude-sonnet-4.5",
				resolver: {
					resolveModel: () => ({
						provider: "anthropic",
						model: "claude-sonnet-4.5",
						connectionId: "anthropic_account_1",
					}),
				},
			}),
		).resolves.toEqual({
			requestedModel: "fallback:claude-sonnet-4.5",
			routingMode: "fallback",
			resolvedProvider: "anthropic",
			resolvedModel: "claude-sonnet-4.5",
			connectionId: "anthropic_account_1",
			source: "fallback",
			mode: "fallback",
		});
	});

	it("uses resolveIntent for router aliases", async () => {
		await expect(
			resolveRoute({
				requestedModel: "auto:coding",
				resolver: {
					resolveIntent: (intent) => ({
						provider: "anthropic",
						model: intent === "coding" ? "claude-sonnet-4.5" : "claude-haiku-4.5",
						connectionId: "anthropic_account_1",
					}),
				},
			}),
		).resolves.toEqual({
			requestedModel: "auto:coding",
			routingMode: "router",
			resolvedProvider: "anthropic",
			resolvedModel: "claude-sonnet-4.5",
			connectionId: "anthropic_account_1",
			source: "router",
			mode: "router",
		});
	});

	it("throws when a router alias has no resolver", async () => {
		await expect(resolveRoute({ requestedModel: "auto:coding" })).rejects.toThrow(RouteResolutionError);
	});

	it("throws when an unqualified fixed model has no resolver", async () => {
		await expect(resolveRoute({ requestedModel: "fixed:gpt-4.1-mini" })).rejects.toThrow(RouteResolutionError);
	});
});

describe("model selection helpers", () => {
	it("formats selections back into model strings", () => {
		expect(formatModelSelection({ mode: "fixed", model: "openai/gpt-4.1-mini" })).toBe("fixed:openai/gpt-4.1-mini");
		expect(formatModelSelection({ mode: "fallback", primary: "anthropic/claude-sonnet-4.5" })).toBe(
			"fallback:anthropic/claude-sonnet-4.5",
		);
		expect(formatModelSelection({ mode: "router", intent: "coding", alias: "cheap:coding" })).toBe("cheap:coding");
		expect(formatModelSelection({ mode: "router", intent: "coding" })).toBe("auto:coding");
	});

	it("returns routing modes", () => {
		expect(getRoutingMode("fixed:openai/gpt-4.1-mini")).toBe("fixed");
		expect(getRoutingMode("auto:coding")).toBe("router");
		expect(getRoutingMode("openai/gpt-4.1-mini")).toBe("fallback");
	});

	it("detects router aliases", () => {
		expect(isRouterAlias("auto:coding")).toBe(true);
		expect(isRouterAlias("cheap:coding")).toBe(true);
		expect(isRouterAlias("fixed:openai/gpt-4.1-mini")).toBe(false);
		expect(isRouterAlias("openai/gpt-4.1-mini")).toBe(false);
	});
});

describe("pi model route resolver", () => {
	const models: PiModelReference[] = [
		{
			provider: "openai",
			id: "gpt-5.4",
			name: "GPT 5.4",
			input: ["text"],
			cost: { input: 10, output: 30 },
			contextWindow: 200000,
			reasoning: true,
		},
		{
			provider: "anthropic",
			id: "claude-sonnet-4.5",
			name: "Claude Sonnet 4.5",
			input: ["text", "image"],
			cost: { input: 3, output: 15 },
			contextWindow: 200000,
			reasoning: true,
		},
		{
			provider: "google",
			id: "gemini-flash",
			name: "Gemini Flash",
			input: ["text", "image"],
			cost: { input: 0.3, output: 2.5 },
			contextWindow: 1000000,
			reasoning: false,
		},
	];

	const catalog: PiModelCatalog<PiModelReference> = {
		find: (provider: string, modelId: string) =>
			models.find((model) => model.provider === provider && model.id === modelId),
		getAvailable: () => models,
		getAll: () => models,
	};

	it("resolves pi model objects through the catalog", async () => {
		await expect(resolvePiModelRoute({ requestedModel: models[0], catalog })).resolves.toMatchObject({
			route: {
				requestedModel: "openai/gpt-5.4",
				routingMode: "fallback",
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.4",
			},
			model: models[0],
		});
	});

	it("uses policy aliases before scored selection", async () => {
		await expect(
			resolvePiModelRoute({
				requestedModel: { provider: PIE_LAB_ROUTER_PROVIDER, id: "auto:coding" },
				catalog,
				policy: { aliases: { "auto:coding": "anthropic/claude-sonnet-4.5" } },
			}),
		).resolves.toMatchObject({
			route: {
				requestedModel: "auto:coding",
				routingMode: "router",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
			},
			model: models[1],
		});
	});

	it("builds an ordered route plan for combo aliases", async () => {
		await expect(
			resolvePiModelRoutePlan({
				requestedModel: { provider: PIE_LAB_ROUTER_PROVIDER, id: "combo:coding" },
				catalog,
				policy: {
					aliases: {
						"combo:coding": ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5", "google/gemini-flash"],
					},
				},
			}),
		).resolves.toMatchObject({
			requestedModel: "combo:coding",
			routingMode: "router",
			routes: [
				{ route: { resolvedProvider: "openai", resolvedModel: "gpt-5.4" }, model: models[0] },
				{ route: { resolvedProvider: "anthropic", resolvedModel: "claude-sonnet-4.5" }, model: models[1] },
				{ route: { resolvedProvider: "google", resolvedModel: "gemini-flash" }, model: models[2] },
			],
			primary: {
				route: { resolvedProvider: "openai", resolvedModel: "gpt-5.4" },
				model: models[0],
			},
		});
	});

	it("builds a default multi-model route plan for combo aliases", async () => {
		await expect(
			resolvePiModelRoutePlan({
				requestedModel: { provider: PIE_LAB_ROUTER_PROVIDER, id: "combo:coding" },
				catalog,
			}),
		).resolves.toMatchObject({
			requestedModel: "combo:coding",
			routingMode: "router",
			routes: [
				{ route: { resolvedProvider: "anthropic", resolvedModel: "claude-sonnet-4.5" }, model: models[1] },
				{ route: { resolvedProvider: "openai", resolvedModel: "gpt-5.4" }, model: models[0] },
				{ route: { resolvedProvider: "google", resolvedModel: "gemini-flash" }, model: models[2] },
			],
			primary: {
				route: { resolvedProvider: "anthropic", resolvedModel: "claude-sonnet-4.5" },
				model: models[1],
			},
		});
	});

	it("builds a route plan from structured fallback selections", async () => {
		await expect(
			resolvePiModelRoutePlan({
				requestedModel: {
					mode: "fallback",
					primary: "missing/model",
					fallback: ["anthropic/claude-sonnet-4.5", "google/gemini-flash"],
				},
				catalog,
			}),
		).resolves.toMatchObject({
			requestedModel: "fallback:missing/model",
			routingMode: "fallback",
			routes: [
				{ route: { resolvedProvider: "anthropic", resolvedModel: "claude-sonnet-4.5" }, model: models[1] },
				{ route: { resolvedProvider: "google", resolvedModel: "gemini-flash" }, model: models[2] },
			],
		});
	});

	it("scores cheap aliases toward lower-cost models", async () => {
		await expect(
			resolvePiModelRoute({
				requestedModel: { provider: PIE_LAB_ROUTER_PROVIDER, id: "cheap:coding" },
				catalog,
			}),
		).resolves.toMatchObject({
			route: {
				requestedModel: "cheap:coding",
				routingMode: "router",
				resolvedProvider: "google",
				resolvedModel: "gemini-flash",
			},
			model: models[2],
		});
	});

	it("can create a reusable resolver for resolveRoute", async () => {
		const resolver = createPiRouteResolver(catalog, {
			intents: { coding: ["missing/model", "anthropic/claude-sonnet-4.5"] },
		});

		await expect(resolveRoute({ requestedModel: "auto:coding", resolver })).resolves.toMatchObject({
			resolvedProvider: "anthropic",
			resolvedModel: "claude-sonnet-4.5",
		});
	});

	it("expands 9router-style named combos from policy data", async () => {
		await expect(
			resolvePiModelRoutePlan({
				requestedModel: "premium-coding",
				catalog,
				policy: {
					combos: [
						{
							name: "premium-coding",
							models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5", "google/gemini-flash"],
						},
					],
				},
			}),
		).resolves.toMatchObject({
			requestedModel: "premium-coding",
			routes: [
				{ route: { source: "router", resolvedProvider: "openai", resolvedModel: "gpt-5.4" } },
				{ route: { source: "router", resolvedProvider: "anthropic", resolvedModel: "claude-sonnet-4.5" } },
				{ route: { source: "router", resolvedProvider: "google", resolvedModel: "gemini-flash" } },
			],
		});
	});

	it("applies 9router-style combo round-robin with sticky limits", async () => {
		resetComboRotation("rr-combo");
		const comboModels = ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5", "google/gemini-flash"];

		expect(getRotatedModels(comboModels, "rr-combo", "round-robin", 2)).toEqual(comboModels);
		expect(getRotatedModels(comboModels, "rr-combo", "round-robin", 2)).toEqual(comboModels);
		expect(getRotatedModels(comboModels, "rr-combo", "round-robin", 2)).toEqual([
			"anthropic/claude-sonnet-4.5",
			"google/gemini-flash",
			"openai/gpt-5.4",
		]);
	});
});

describe("9router-derived account fallback helpers", () => {
	it("classifies rate limit and quota errors with exponential cooldown", () => {
		expect(checkFallbackError(429, "rate limit", 0)).toEqual({
			shouldFallback: true,
			cooldownMs: 2000,
			newBackoffLevel: 1,
		});
		expect(checkFallbackError(429, "quota exceeded", 1)).toEqual({
			shouldFallback: true,
			cooldownMs: 4000,
			newBackoffLevel: 2,
		});
		expect(
			checkFallbackError(400, "You're out of extra usage. Add more at claude.ai/settings/usage and keep going.", 0),
		).toEqual({
			shouldFallback: true,
			cooldownMs: 2000,
			newBackoffLevel: 1,
		});
	});

	it("classifies credential and transient errors with 9router cooldowns", () => {
		expect(checkFallbackError(401, "no credentials", 0)).toEqual({
			shouldFallback: true,
			cooldownMs: 120000,
		});
		expect(checkFallbackError(500, "provider exploded", 0)).toEqual({
			shouldFallback: true,
			cooldownMs: 30000,
		});
	});

	it("extracts provider reset timing for precise quota cooldowns", () => {
		const now = Date.parse("2026-05-22T00:00:00.000Z");

		expect(
			extractProviderResetCooldownMs(
				{
					error: {
						type: "usage_limit_reached",
						resets_at: now / 1000 + 120,
					},
				},
				now,
			),
		).toBe(120000);
		expect(extractProviderResetCooldownMs(new Error("Your quota will reset after 1h30m"), now)).toBe(1800000);
		expect(
			extractProviderResetCooldownMs(new Error("You have hit your ChatGPT usage limit. Try again in ~7 min."), now),
		).toBe(420000);
	});

	it("filters unavailable accounts and applies error state", () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		const accounts = [
			{ id: "a", rateLimitedUntil: future },
			{ id: "b", rateLimitedUntil: null },
		];

		expect(filterAvailableAccounts(accounts).map((account) => account.id)).toEqual(["b"]);
		expect(applyErrorState({ id: "b", backoffLevel: 0 }, 429, "rate limit")).toMatchObject({
			id: "b",
			backoffLevel: 1,
			status: "error",
		});
	});

	it("selects provider accounts by fill-first priority", () => {
		const result = selectProviderConnection({
			provider: "openai",
			connections: [
				{ id: "slow", provider: "openai", isActive: true, priority: 2 },
				{ id: "first", provider: "openai", isActive: true, priority: 1 },
				{ id: "inactive", provider: "openai", isActive: false, priority: 0 },
			],
		});

		expect(result).toMatchObject({
			status: "selected",
			connection: { id: "first" },
		});
	});

	it("pins a preferred account before applying the account strategy", () => {
		const result = selectProviderConnection({
			provider: "anthropic",
			preferredConnectionId: "second",
			connections: [
				{ id: "first", provider: "anthropic", isActive: true, priority: 1 },
				{ id: "second", provider: "anthropic", isActive: true, priority: 2 },
			],
		});

		expect(result).toMatchObject({
			status: "selected",
			connection: { id: "second" },
		});
	});

	it("prefers provider accounts with fresher remaining quota snapshots", () => {
		const now = new Date("2026-05-22T00:00:00.000Z");
		const result = selectProviderConnection({
			provider: "codex",
			model: "gpt-5.4",
			now,
			settings: { fallbackStrategy: "quota-aware", quotaStrategy: "prefer-remaining" },
			connections: [
				{
					id: "low-quota",
					provider: "codex",
					isActive: true,
					priority: 1,
					providerSpecificData: {
						[PIE_LAB_QUOTA_SELECTION_KEY]: {
							checkedAt: now.toISOString(),
							status: "available",
							score: 0.1,
							remainingPercentage: 10,
						},
					},
				},
				{
					id: "high-quota",
					provider: "codex",
					isActive: true,
					priority: 2,
					providerSpecificData: {
						[PIE_LAB_QUOTA_SELECTION_KEY]: {
							checkedAt: now.toISOString(),
							status: "available",
							score: 0.85,
							remainingPercentage: 85,
						},
					},
				},
			],
		});

		expect(result).toMatchObject({
			status: "selected",
			connection: { id: "high-quota" },
		});
	});

	it("excludes depleted provider accounts when quota snapshots are fresh", () => {
		const now = new Date("2026-05-22T00:00:00.000Z");
		const result = selectProviderConnection({
			provider: "codex",
			model: "gpt-5.4",
			now,
			settings: { quotaStrategy: "prefer-remaining" },
			connections: [
				{
					id: "depleted",
					provider: "codex",
					isActive: true,
					priority: 1,
					providerSpecificData: {
						[PIE_LAB_QUOTA_SELECTION_KEY]: {
							checkedAt: now.toISOString(),
							status: "depleted",
							score: 0,
							remainingPercentage: 0,
						},
					},
				},
				{
					id: "available",
					provider: "codex",
					isActive: true,
					priority: 2,
					providerSpecificData: {
						[PIE_LAB_QUOTA_SELECTION_KEY]: {
							checkedAt: now.toISOString(),
							status: "available",
							score: 0.2,
							remainingPercentage: 20,
						},
					},
				},
			],
		});

		expect(result).toMatchObject({
			status: "selected",
			connection: { id: "available" },
		});
	});

	it("selects provider accounts by 9router-style sticky round-robin", () => {
		const now = new Date("2026-05-22T00:00:00.000Z");
		const connections = [
			{
				id: "recent",
				provider: "anthropic",
				isActive: true,
				priority: 1,
				lastUsedAt: "2026-05-21T00:00:00.000Z",
				consecutiveUseCount: 1,
			},
			{
				id: "older",
				provider: "anthropic",
				isActive: true,
				priority: 2,
				lastUsedAt: "2026-05-20T00:00:00.000Z",
				consecutiveUseCount: 1,
			},
		];

		expect(
			selectProviderConnection({
				provider: "anthropic",
				connections,
				now,
				settings: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 },
			}),
		).toMatchObject({
			status: "selected",
			connection: { id: "recent" },
			updates: { lastUsedAt: "2026-05-22T00:00:00.000Z", consecutiveUseCount: 2 },
		});

		expect(
			selectProviderConnection({
				provider: "anthropic",
				connections,
				now,
				settings: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 },
			}),
		).toMatchObject({
			status: "selected",
			connection: { id: "older" },
			updates: { lastUsedAt: "2026-05-22T00:00:00.000Z", consecutiveUseCount: 1 },
		});
	});

	it("reports retry timing when every provider account is model-locked", () => {
		const retryAfter = new Date(Date.now() + 60_000).toISOString();
		const result = selectProviderConnection({
			provider: "openai",
			model: "gpt-5.4",
			connections: [
				{
					id: "locked",
					provider: "openai",
					isActive: true,
					priority: 1,
					"modelLock_gpt-5.4": retryAfter,
					lastError: "rate limit",
					errorCode: 429,
				},
			],
		});

		expect(result).toMatchObject({
			status: "unavailable",
			retryAfter,
			lastError: "rate limit",
			lastErrorCode: 429,
		});
	});

	it("explains selected, inactive, and quota-stale provider account candidates", () => {
		const explanation = explainProviderConnectionSelection({
			provider: "openai",
			model: "gpt-5.4",
			now: new Date("2026-05-22T00:00:00.000Z"),
			settings: { quotaStrategy: "prefer-remaining" },
			connections: [
				{ id: "active", provider: "openai", isActive: true, priority: 1 },
				{ id: "inactive", provider: "openai", isActive: false, priority: 2 },
			],
		});

		expect(explanation).toMatchObject({
			status: "selected",
			selectedConnectionId: "active",
		});
		expect(explanation.candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "active",
					selected: true,
					reasons: expect.arrayContaining(["selected by account strategy", "quota snapshot is missing or stale"]),
				}),
				expect.objectContaining({
					id: "inactive",
					selectable: false,
					reasons: expect.arrayContaining(["inactive connection"]),
				}),
			]),
		);
	});
});

describe("RTK token saver", () => {
	it("compresses large tool outputs and reports saved bytes", () => {
		const diff = [
			"diff --git a/src/a.ts b/src/a.ts",
			"@@ -1,2 +1,2 @@",
			"-const oldValue = 1;",
			"+const newValue = 2;",
			...Array.from({ length: 120 }, (_, index) => `+line ${index}`),
		].join("\n");
		const result = compressPayloadWithRtk({
			messages: [{ role: "tool", content: diff.repeat(8) }],
		});

		expect(result.stats?.hits.length).toBeGreaterThan(0);
		expect(result.stats?.bytesAfter).toBeLessThan(result.stats?.bytesBefore ?? 0);
		expect(result.stats?.hits.map((hit) => hit.filter)).toContain("gitDiff");
		expect(result.logLine).toContain("[RTK]");
	});

	it("preserves AbortSignal instances inside provider payloads", () => {
		const controller = new AbortController();
		const result = compressPayloadWithRtk({
			model: "gemini-3.1-pro-preview",
			contents: [{ role: "user", parts: [{ text: "hello" }] }],
			config: {
				abortSignal: controller.signal,
			},
		});

		const payload = result.payload as { config?: { abortSignal?: AbortSignal } };
		expect(payload.config?.abortSignal).toBe(controller.signal);
		expect(typeof payload.config?.abortSignal?.addEventListener).toBe("function");
	});
});
