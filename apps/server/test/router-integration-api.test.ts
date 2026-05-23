import type { Api, AssistantMessage, Model } from "@pie-lab/ai";
import {
	createInMemoryProviderConnectionStore,
	createInMemoryUsageStore,
	type ProviderConnection,
	type UsageRecord,
} from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPieLabRequestHandler, type ChatCompletionExecutor } from "../src/index.js";

describe("router integration APIs", () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server?.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			server = undefined;
		}
	});

	async function start(options: {
		store?: ReturnType<typeof createInMemoryProviderConnectionStore>;
		usageStore?: ReturnType<typeof createInMemoryUsageStore>;
		fetchImpl?: typeof fetch;
		catalog?: ReturnType<typeof createCatalog>;
		executor?: ChatCompletionExecutor;
	} = {}) {
		const store = options.store ?? createInMemoryProviderConnectionStore();
		const usageStore = options.usageStore ?? createInMemoryUsageStore();
		server = createServer(
			createPieLabRequestHandler({
				providerConnectionStore: store,
				usageStore,
				fetch: options.fetchImpl,
				catalog: options.catalog,
				executor: options.executor,
				now: () => new Date("2026-05-22T00:00:00.000Z"),
				requestIdFactory: () => "media_request_test",
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return { baseUrl: `http://127.0.0.1:${address.port}`, store, usageStore };
	}

	it("creates provider connections through the dashboard API without returning secrets", async () => {
		const { baseUrl, store } = await start();

		const createResponse = await fetch(`${baseUrl}/provider-connections`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "openai",
				authType: "apikey",
				name: "OpenAI key",
				apiKey: "sk-test",
				priority: 3,
			}),
		});
		const createBody = (await createResponse.json()) as {
			connection: { id: string; provider: string; hasApiKey: boolean; apiKey?: string };
		};

		expect(createResponse.status).toBe(201);
		expect(createBody.connection).toMatchObject({ provider: "openai", hasApiKey: true });
		expect(createBody.connection.apiKey).toBeUndefined();

		const stored = await store.getProviderConnectionById(createBody.connection.id);
		expect(stored?.apiKey).toBe("sk-test");

		const deleteResponse = await fetch(`${baseUrl}/provider-connections/${createBody.connection.id}`, { method: "DELETE" });
		const deleted = await store.getProviderConnectionById(createBody.connection.id);

		expect(deleteResponse.status).toBe(200);
		expect(deleted).toMatchObject({ isActive: false, apiKey: null });
	});

	it("explains why an account was selected", async () => {
		const { baseUrl } = await start({
			store: createInMemoryProviderConnectionStore({
				connections: [
					providerConnection({
						id: "openai_key_1",
						provider: "openai",
						apiKey: "sk-1",
						priority: 1,
					}),
					providerConnection({
						id: "openai_key_2",
						provider: "openai",
						apiKey: "sk-2",
						priority: 2,
						isActive: false,
					}),
				],
			}),
		});

		const response = await fetch(`${baseUrl}/account-selection?provider=openai&model=text-embedding-3-small`);
		const body = (await response.json()) as {
			data: Array<{
				status: string;
				selectedConnectionId?: string;
				candidates: Array<{ id: string; selected: boolean; selectable: boolean; reasons: string[] }>;
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.data[0]).toMatchObject({
			status: "selected",
			selectedConnectionId: "openai_key_1",
		});
		expect(body.data[0].candidates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "openai_key_1",
					selected: true,
					reasons: expect.arrayContaining(["selected by account strategy"]),
				}),
				expect.objectContaining({
					id: "openai_key_2",
					selectable: false,
					reasons: expect.arrayContaining(["inactive connection"]),
				}),
			]),
		);
	});

	it("routes embeddings through provider credentials and records media usage", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const { baseUrl, usageStore } = await start({
			store: createInMemoryProviderConnectionStore({
				connections: [
					providerConnection({
						id: "openai_key_1",
						provider: "openai",
						apiKey: "sk-test",
					}),
				],
			}),
			fetchImpl: (async (url, init) => {
				calls.push({ url: String(url), init: init ?? {} });
				return new Response(
					JSON.stringify({
						object: "list",
						data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
						model: "text-embedding-3-small",
						usage: { prompt_tokens: 2, total_tokens: 2 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}) as typeof fetch,
		});

		const response = await fetch(`${baseUrl}/v1/embeddings`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "openai/text-embedding-3-small",
				input: "hello",
			}),
		});
		const body = (await response.json()) as { data: Array<{ embedding: number[] }> };

		expect(response.status).toBe(200);
		expect(body.data[0].embedding).toEqual([0.1, 0.2]);
		expect(calls[0]).toMatchObject({
			url: "https://api.openai.com/v1/embeddings",
		});
		expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer sk-test" });
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestId: "media_request_test",
				requestedModel: "openai/text-embedding-3-small",
				resolvedProvider: "openai",
				resolvedModel: "text-embedding-3-small",
				connectionId: "openai_key_1",
				endpoint: "/v1/embeddings",
				status: "success",
			},
		]);
	});

	it("routes Cohere embeddings and normalizes them to OpenAI-compatible shape", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const { baseUrl, usageStore } = await start({
			store: createInMemoryProviderConnectionStore({
				connections: [
					providerConnection({
						id: "cohere_key_1",
						provider: "cohere",
						apiKey: "cohere-test",
					}),
				],
			}),
			fetchImpl: (async (url, init) => {
				calls.push({ url: String(url), init: init ?? {} });
				return new Response(
					JSON.stringify({
						id: "embed-id",
						embeddings: { float: [[0.1, 0.2, 0.3]] },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}) as typeof fetch,
		});

		const response = await fetch(`${baseUrl}/v1/embeddings`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "cohere/embed-v4.0",
				input: "hello",
			}),
		});
		const body = (await response.json()) as { data: Array<{ embedding: number[] }>; model: string };

		expect(response.status).toBe(200);
		expect(body.model).toBe("embed-v4.0");
		expect(body.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
		expect(calls[0]).toMatchObject({ url: "https://api.cohere.com/v2/embed" });
		expect(calls[0].init.headers).toMatchObject({ authorization: "Bearer cohere-test" });
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
			model: "embed-v4.0",
			input_type: "search_document",
			embedding_types: ["float"],
		});
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "cohere/embed-v4.0",
				resolvedProvider: "cohere",
				resolvedModel: "embed-v4.0",
				endpoint: "/v1/embeddings",
				status: "success",
			},
		]);
	});

	it("routes ElevenLabs TTS with xi-api-key credentials", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const { baseUrl } = await start({
			store: createInMemoryProviderConnectionStore({
				connections: [
					providerConnection({
						id: "eleven_key_1",
						provider: "elevenlabs",
						apiKey: "eleven-test",
						providerSpecificData: { voiceId: "voice-default" },
					}),
				],
			}),
			fetchImpl: (async (url, init) => {
				calls.push({ url: String(url), init: init ?? {} });
				return new Response(Buffer.from("audio"), { status: 200, headers: { "content-type": "audio/mpeg" } });
			}) as typeof fetch,
		});

		const response = await fetch(`${baseUrl}/v1/audio/speech?response_format=json`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "elevenlabs/eleven_multilingual_v2",
				input: "hello",
				voice: "voice-1",
			}),
		});
		const body = (await response.json()) as { audio: string; format: string };

		expect(response.status).toBe(200);
		expect(body.audio).toBe(Buffer.from("audio").toString("base64"));
		expect(body.format).toBe("mp3_44100_128");
		expect(calls[0].url).toContain("https://api.elevenlabs.io/v1/text-to-speech/voice-1");
		expect(calls[0].init.headers).toMatchObject({ "xi-api-key": "eleven-test" });
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
			text: "hello",
			model_id: "eleven_multilingual_v2",
		});
	});

	it("saves editable combo policy and uses it for chat route plans", async () => {
		const store = createInMemoryProviderConnectionStore();
		const { baseUrl, usageStore } = await start({
			store,
			catalog: createCatalog([
				createModel("anthropic", "claude-sonnet-4.5", "Claude Sonnet 4.5"),
				createModel("openai", "gpt-5.4", "GPT 5.4"),
			]),
			executor: async (model) => assistantMessage(model, `selected ${model.provider}/${model.id}`),
		});

		const createResponse = await fetch(`${baseUrl}/routing-policy/combos`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "premium-coding",
				models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
				strategy: "fallback",
			}),
		});
		const createBody = (await createResponse.json()) as { combo: { name: string; models: string[] } };
		expect(createResponse.status).toBe(200);
		expect(createBody.combo).toMatchObject({
			name: "premium-coding",
			models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.5"],
		});

		const previewResponse = await fetch(`${baseUrl}/routing-policy/preview`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "combo:premium-coding" }),
		});
		const previewBody = (await previewResponse.json()) as { routes: Array<{ id: string }> };
		expect(previewResponse.status).toBe(200);
		expect(previewBody.routes.map((route) => route.id)).toEqual([
			"openai/gpt-5.4",
			"anthropic/claude-sonnet-4.5",
		]);

		const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "combo:premium-coding",
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const chatBody = (await chatResponse.json()) as { model: string };
		expect(chatResponse.status).toBe(200);
		expect(chatBody.model).toBe("openai/gpt-5.4");
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "combo:premium-coding",
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.4",
				status: "success",
			},
		]);

		const deleteResponse = await fetch(`${baseUrl}/routing-policy/combos/premium-coding`, { method: "DELETE" });
		const settings = await store.getSettings();
		expect(deleteResponse.status).toBe(200);
		expect(settings.routerPolicy?.combos).toEqual([]);
	});

	it("saves editable alias and intent policy and uses it for chat route plans", async () => {
		const store = createInMemoryProviderConnectionStore();
		const { baseUrl, usageStore } = await start({
			store,
			catalog: createCatalog([
				createModel("anthropic", "claude-sonnet-4.5", "Claude Sonnet 4.5"),
				createModel("openai", "gpt-5.4", "GPT 5.4"),
			]),
			executor: async (model) => assistantMessage(model, `selected ${model.provider}/${model.id}`),
		});

		const aliasResponse = await fetch(`${baseUrl}/routing-policy/aliases`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "auto:coding",
				models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
			}),
		});
		const aliasBody = (await aliasResponse.json()) as { alias: { name: string; models: string[] } };
		expect(aliasResponse.status).toBe(200);
		expect(aliasBody.alias).toEqual({
			name: "auto:coding",
			models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
		});

		const intentResponse = await fetch(`${baseUrl}/routing-policy/intents`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "chat",
				models: ["openai/gpt-5.4"],
			}),
		});
		const intentBody = (await intentResponse.json()) as { intent: { name: string; models: string[] } };
		expect(intentResponse.status).toBe(200);
		expect(intentBody.intent).toEqual({
			name: "chat",
			models: ["openai/gpt-5.4"],
		});

		const aliasPreviewResponse = await fetch(`${baseUrl}/routing-policy/preview`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "auto:coding" }),
		});
		const aliasPreviewBody = (await aliasPreviewResponse.json()) as { routes: Array<{ id: string }> };
		expect(aliasPreviewResponse.status).toBe(200);
		expect(aliasPreviewBody.routes.map((route) => route.id)).toEqual([
			"anthropic/claude-sonnet-4.5",
			"openai/gpt-5.4",
		]);

		const intentPreviewResponse = await fetch(`${baseUrl}/routing-policy/preview`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "auto:chat" }),
		});
		const intentPreviewBody = (await intentPreviewResponse.json()) as { routes: Array<{ id: string }> };
		expect(intentPreviewResponse.status).toBe(200);
		expect(intentPreviewBody.routes.map((route) => route.id)).toEqual(["openai/gpt-5.4"]);

		const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:coding",
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const chatBody = (await chatResponse.json()) as { model: string };
		expect(chatResponse.status).toBe(200);
		expect(chatBody.model).toBe("anthropic/claude-sonnet-4.5");
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "auto:coding",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				status: "success",
			},
		]);

		const deleteAliasResponse = await fetch(`${baseUrl}/routing-policy/aliases/auto%3Acoding`, { method: "DELETE" });
		const deleteIntentResponse = await fetch(`${baseUrl}/routing-policy/intents/chat`, { method: "DELETE" });
		const settings = await store.getSettings();
		expect(deleteAliasResponse.status).toBe(200);
		expect(deleteIntentResponse.status).toBe(200);
		expect(settings.routerPolicy?.aliases).toEqual({});
		expect(settings.routerPolicy?.intents).toEqual({});
	});

	it("saves provider budget settings through the dashboard API", async () => {
		const store = createInMemoryProviderConnectionStore();
		const { baseUrl } = await start({ store });

		const response = await fetch(`${baseUrl}/provider-settings`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				quotaStrategy: "require-remaining",
				quotaMinRemainingPercentage: 20,
				budgetLimits: {
					mode: "warn",
					requestUsd: 0.05,
					dailyUsd: 3,
				},
			}),
		});
		const body = (await response.json()) as {
			settings: { quotaStrategy: string; budgetLimits: { mode: string; requestUsd: number; dailyUsd: number } };
		};

		expect(response.status).toBe(200);
		expect(body.settings).toMatchObject({
			quotaStrategy: "require-remaining",
			quotaMinRemainingPercentage: 20,
			budgetLimits: {
				mode: "warn",
				requestUsd: 0.05,
				dailyUsd: 3,
			},
		});
	});

	it("blocks routed chat requests when provider budget is exhausted", async () => {
		const usageStore = createInMemoryUsageStore();
		usageStore.recordUsage(
			usageRecord({
				requestId: "previous_request",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				costUsd: 0.002,
			}),
		);
		const { baseUrl } = await start({
			usageStore,
			store: createInMemoryProviderConnectionStore({
				settings: {
					budgetLimits: {
						mode: "block",
						dailyUsd: 0.001,
					},
				},
			}),
			catalog: createCatalog([createModel("anthropic", "claude-sonnet-4.5", "Claude Sonnet 4.5")]),
			executor: async (model) => assistantMessage(model, "should not run"),
		});

		const budgetResponse = await fetch(`${baseUrl}/budget?provider=anthropic`);
		const budgetBody = (await budgetResponse.json()) as { budget: { shouldBlock: boolean; daily: { usedUsd: number } } };
		expect(budgetResponse.status).toBe(200);
		expect(budgetBody.budget).toMatchObject({
			shouldBlock: true,
			daily: { usedUsd: 0.002 },
		});

		const chatResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:coding",
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const chatBody = (await chatResponse.json()) as { error: { type: string }; pi_adk: { budget: { shouldBlock: boolean } } };

		expect(chatResponse.status).toBe(402);
		expect(chatBody.error.type).toBe("budget_limit_exceeded");
		expect(chatBody.pi_adk.budget.shouldBlock).toBe(true);
		expect(usageStore.getUsageRecords().at(-1)).toMatchObject({
			status: "skipped",
			errorCode: "budget_limit_exceeded",
			resolvedProvider: "anthropic",
		});
	});

	it("starts OAuth redirect flows and stores callback tokens", async () => {
		const store = createInMemoryProviderConnectionStore();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "access-token",
					refresh_token: "refresh-token",
					expires_in: 3600,
					token_type: "Bearer",
					scope: "openid profile email offline_access",
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		const { baseUrl } = await start({ store, fetchImpl: fetchMock as unknown as typeof fetch });

		const startResponse = await fetch(
			`${baseUrl}/oauth/start?provider=codex&redirect_uri=${encodeURIComponent("http://127.0.0.1:4874/")}`,
		);
		const startBody = (await startResponse.json()) as {
			provider: string;
			authorizationUrl: string;
			state: string;
			codeVerifier: string;
			redirectUri: string;
		};
		expect(startResponse.status).toBe(200);
		expect(startBody.provider).toBe("codex");
		expect(startBody.authorizationUrl).toContain("https://auth.openai.com/oauth/authorize");
		expect(startBody.authorizationUrl).toContain("code_challenge=");

		const callbackResponse = await fetch(`${baseUrl}/oauth/callback`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "codex",
				code: "auth-code",
				state: startBody.state,
				codeVerifier: startBody.codeVerifier,
				redirectUri: startBody.redirectUri,
				email: "codex@example.test",
			}),
		});
		const callbackBody = (await callbackResponse.json()) as {
			connection: { id: string; provider: string; hasAccessToken: boolean; hasRefreshToken: boolean };
		};
		const stored = await store.getProviderConnectionById(callbackBody.connection.id);
		const tokenRequest = fetchMock.mock.calls[0];

		expect(callbackResponse.status).toBe(200);
		expect(callbackBody.connection).toMatchObject({
			provider: "codex",
			hasAccessToken: true,
			hasRefreshToken: true,
		});
		expect(String(tokenRequest?.[0])).toBe("https://auth.openai.com/oauth/token");
		expect(String((tokenRequest?.[1] as RequestInit | undefined)?.body)).toContain("grant_type=authorization_code");
		expect(stored).toMatchObject({
			provider: "codex",
			authType: "oauth",
			email: "codex@example.test",
			accessToken: "access-token",
			refreshToken: "refresh-token",
		});
	});

	it("exposes media routes and resolves media aliases through routing policy", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const { baseUrl, usageStore } = await start({
			store: createInMemoryProviderConnectionStore({
				connections: [
					providerConnection({
						id: "openai_key_1",
						provider: "openai",
						apiKey: "sk-test",
					}),
				],
				settings: {
					routerPolicy: {
						aliases: {
							"auto:image": "openai/gpt-image-1",
						},
					},
				},
			}),
			fetchImpl: (async (url, init) => {
				calls.push({ url: String(url), init: init ?? {} });
				return new Response(JSON.stringify({ data: [{ url: "https://example.test/image.png" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				});
			}) as typeof fetch,
		});

		const routesResponse = await fetch(`${baseUrl}/media/routes`);
		const routesBody = (await routesResponse.json()) as { routes: Array<{ provider: string; kind: string }> };
		expect(routesResponse.status).toBe(200);
		expect(routesBody.routes).toEqual(expect.arrayContaining([expect.objectContaining({ provider: "openai", kind: "image" })]));

		const imageResponse = await fetch(`${baseUrl}/v1/images/generations`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:image",
				prompt: "diagram",
				extra_body: { background: "transparent" },
			}),
		});

		expect(imageResponse.status).toBe(200);
		expect(calls[0]).toMatchObject({ url: "https://api.openai.com/v1/images/generations" });
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
			model: "gpt-image-1",
			prompt: "diagram",
			background: "transparent",
		});
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "auto:image",
				resolvedProvider: "openai",
				resolvedModel: "gpt-image-1",
				endpoint: "/v1/images/generations",
				status: "success",
			},
		]);
	});
});

function providerConnection(overrides: Partial<ProviderConnection> & { id: string; provider: string }): ProviderConnection {
	const { id, provider, ...rest } = overrides;
	return {
		id,
		provider,
		authType: "apikey",
		isActive: true,
		createdAt: "2026-05-22T00:00:00.000Z",
		updatedAt: "2026-05-22T00:00:00.000Z",
		...rest,
	};
}

function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
	return {
		id: "usage_test",
		requestId: "request_test",
		timestamp: "2026-05-22T00:00:00.000Z",
		requestedModel: "anthropic/claude-sonnet-4.5",
		routingMode: "fixed",
		routeSource: "fixed",
		resolvedProvider: "anthropic",
		resolvedModel: "claude-sonnet-4.5",
		attemptIndex: 0,
		attemptCount: 1,
		status: "success",
		costUsd: 0,
		...overrides,
	};
}

function createCatalog(models: Model<Api>[]) {
	return {
		find(provider: string, modelId: string) {
			return models.find((model) => model.provider === provider && model.id === modelId);
		},
		getAvailable() {
			return models;
		},
		getAll() {
			return models;
		},
	};
}

function createModel(provider: string, id: string, name: string): Model<Api> {
	return {
		id,
		name,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 100,
			output: 200,
			cacheRead: 10,
			cacheWrite: 20,
		},
		contextWindow: 128000,
		maxTokens: 4096,
	};
}

function assistantMessage(model: Model<Api>, text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15,
			cost: {
				input: 0.001,
				output: 0.002,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.003,
			},
		},
		stopReason: "stop",
		timestamp: Date.parse("2026-05-22T00:00:00.000Z"),
	};
}
