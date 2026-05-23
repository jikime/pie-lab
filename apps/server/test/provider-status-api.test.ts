import type { Api, Model } from "@pie-lab/ai";
import type { ModelRegistry } from "@pie-lab/coding-agent/model-registry";
import { createInMemoryProviderConnectionStore, type ProviderConnection } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderProbeResponse, createProviderStatusRequestHandler, createProviderStatusResponse } from "../src/index.js";

describe("provider status API", () => {
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

	it("summarizes provider auth and model counts", () => {
		const registry = createModelRegistryStub();

		expect(createProviderStatusResponse(registry)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "anthropic",
					name: "Anthropic",
					configured: true,
					authSource: "stored",
					models: 2,
					availableModels: 1,
					health: "missing",
				}),
				expect.objectContaining({
					id: "openai",
					name: "OpenAI",
					configured: false,
					models: 1,
					availableModels: 0,
					health: "missing",
				}),
			]),
		);
	});

	it("returns provider status over HTTP", async () => {
		server = createServer(createProviderStatusRequestHandler({ modelRegistry: createModelRegistryStub() }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		const response = await fetch(`http://127.0.0.1:${address.port}/v1/providers`);
		const body = (await response.json()) as { count: number; data: Array<{ id: string; configured: boolean }> };

		expect(response.status).toBe(200);
		expect(body.count).toBe(2);
		expect(body.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "anthropic", configured: true }),
				expect.objectContaining({ id: "openai", configured: false }),
			]),
		);
	});

	it("returns deep provider probes with connection checks", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "anthropic_conn_1",
					provider: "anthropic",
					apiKey: "test-key",
				}),
				providerConnection({
					id: "openai_conn_1",
					provider: "openai",
					apiKey: null,
					isActive: false,
				}),
			],
		});

		const probes = await createProviderProbeResponse(createModelRegistryStub(), store, {
			now: new Date("2026-05-23T00:00:00.000Z"),
		});

		expect(probes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "anthropic",
					status: "healthy",
					connections: [
						expect.objectContaining({
							id: "anthropic_conn_1",
							status: "healthy",
						}),
					],
				}),
				expect.objectContaining({
					id: "openai",
					status: "blocked",
					connections: [
						expect.objectContaining({
							id: "openai_conn_1",
							status: "blocked",
						}),
					],
				}),
			]),
		);
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

function createModelRegistryStub(): ModelRegistry {
	const models = [
		createModel("anthropic", "claude-sonnet-4.5"),
		createModel("anthropic", "claude-haiku-4.5"),
		createModel("openai", "gpt-5.4"),
	];

	return {
		getAll: () => models,
		getAvailable: () => [models[0]],
		getProviderAuthStatus: (provider: string) =>
			provider === "anthropic" ? { configured: true, source: "stored" } : { configured: false },
		getProviderDisplayName: (provider: string) => (provider === "anthropic" ? "Anthropic" : "OpenAI"),
	} as unknown as ModelRegistry;
}

function createModel(provider: string, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider,
		baseUrl: "https://example.test",
		reasoning: false,
		input: ["text"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 128000,
		maxTokens: 4096,
	};
}
