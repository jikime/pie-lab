import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, type AssistantMessage, createAssistantMessageEventStream, type Model } from "@pie-lab/ai";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { createInMemoryUsageStore } from "@pie-lab/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { createAgentSession } from "../src/core/sdk.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("createAgentSession router fallback", () => {
	let tempDir: string;
	let cwd: string;
	let agentDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-sdk-router-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		cwd = join(tempDir, "project");
		agentDir = join(tempDir, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function createMessage(model: Model<Api>, stopReason: "stop" | "error", errorMessage?: string): AssistantMessage {
		return {
			role: "assistant",
			content: stopReason === "stop" ? [{ type: "text", text: "ok" }] : [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			errorMessage,
			timestamp: Date.now(),
		};
	}

	it("tries the next combo route when the primary route fails before streaming starts", async () => {
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const usageStore = createInMemoryUsageStore();
		const attemptedModels: string[] = [];

		modelRegistry.registerProvider("fail-provider", {
			api: "fail-api",
			apiKey: "fail-key",
			baseUrl: "https://fail.test/v1",
			models: [
				{
					id: "claude-sonnet-4.5",
					name: "Claude Sonnet 4.5",
					reasoning: true,
					input: ["text"],
					cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			],
			streamSimple: (model) => {
				attemptedModels.push(`${model.provider}/${model.id}`);
				const stream = createAssistantMessageEventStream();
				stream.push({
					type: "error",
					reason: "error",
					error: createMessage(model, "error", "primary route failed"),
				});
				return stream;
			},
		});

		modelRegistry.registerProvider("ok-provider", {
			api: "ok-api",
			apiKey: "ok-key",
			baseUrl: "https://ok.test/v1",
			models: [
				{
					id: "gpt-5.4",
					name: "GPT 5.4",
					reasoning: true,
					input: ["text"],
					cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 200000,
					maxTokens: 8192,
				},
			],
			streamSimple: (model) => {
				attemptedModels.push(`${model.provider}/${model.id}`);
				const stream = createAssistantMessageEventStream();
				const message = createMessage(model, "stop");
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
		});

		const failModel = modelRegistry.find("fail-provider", "claude-sonnet-4.5")!;
		const okModel = modelRegistry.find("ok-provider", "gpt-5.4")!;
		const routerModel = modelRegistry.find(PIE_LAB_ROUTER_PROVIDER, "combo:coding")!;
		const testModels = [failModel, okModel, routerModel];
		modelRegistry.getAvailable = () => testModels;
		modelRegistry.getAll = () => testModels;
		modelRegistry.find = (provider, modelId) =>
			testModels.find((model) => model.provider === provider && model.id === modelId);

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: routerModel,
			authStorage,
			modelRegistry,
			usageStore,
			settingsManager: SettingsManager.create(cwd, agentDir),
			sessionManager: SessionManager.inMemory(cwd),
		});

		const stream = await session.agent.streamFn(routerModel, { messages: [] });
		const result = await stream.result();

		expect(result.stopReason).toBe("stop");
		expect(result.provider).toBe("ok-provider");
		expect(result.model).toBe("gpt-5.4");
		expect(attemptedModels).toEqual(["fail-provider/claude-sonnet-4.5", "ok-provider/gpt-5.4"]);
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "combo:coding",
				routingMode: "router",
				resolvedProvider: "fail-provider",
				resolvedModel: "claude-sonnet-4.5",
				attemptIndex: 0,
				attemptCount: 2,
				status: "error",
				errorMessage: "primary route failed",
			},
			{
				requestedModel: "combo:coding",
				routingMode: "router",
				resolvedProvider: "ok-provider",
				resolvedModel: "gpt-5.4",
				attemptIndex: 1,
				attemptCount: 2,
				status: "success",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
				},
				cost: {
					total: 0,
					currency: "USD",
					pricingSource: "pie-metadata",
				},
			},
		]);
	});

	it("records usage and cost for learning and memory router aliases", async () => {
		const authStorage = AuthStorage.inMemory();
		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		const usageStore = createInMemoryUsageStore();
		const attemptedModels: string[] = [];

		modelRegistry.registerProvider("metered-provider", {
			api: "metered-api",
			apiKey: "metered-key",
			baseUrl: "https://metered.test/v1",
			models: [
				{
					id: "learning-mini",
					name: "Learning Mini",
					reasoning: false,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				},
				{
					id: "memory-mini",
					name: "Memory Mini",
					reasoning: false,
					input: ["text"],
					cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				},
			],
			streamSimple: (model) => {
				attemptedModels.push(`${model.provider}/${model.id}`);
				const stream = createAssistantMessageEventStream();
				const message = createMessage(model, "stop");
				message.usage = {
					input: 11,
					output: 7,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 23,
					cost: { input: 0.000011, output: 0.000014, cacheRead: 0, cacheWrite: 0, total: 0.000025 },
				};
				stream.push({ type: "done", reason: "stop", message });
				return stream;
			},
		});

		modelRegistry.getRouterPolicy = async () => ({
			aliases: {
				"auto:learning": "metered-provider/learning-mini",
				"auto:memory": "metered-provider/memory-mini",
			},
		});

		const learningModel = modelRegistry.find(PIE_LAB_ROUTER_PROVIDER, "auto:learning")!;
		const memoryModel = modelRegistry.find(PIE_LAB_ROUTER_PROVIDER, "auto:memory")!;
		const { session } = await createAgentSession({
			cwd,
			agentDir,
			model: learningModel,
			authStorage,
			modelRegistry,
			usageStore,
			settingsManager: SettingsManager.create(cwd, agentDir),
			sessionManager: SessionManager.inMemory(cwd),
		});

		await (await session.agent.streamFn(learningModel, { messages: [] })).result();
		await (await session.agent.streamFn(memoryModel, { messages: [] })).result();

		expect(attemptedModels).toEqual(["metered-provider/learning-mini", "metered-provider/memory-mini"]);
		expect(usageStore.getUsageRecords()).toMatchObject([
			{
				requestedModel: "auto:learning",
				routingMode: "router",
				resolvedProvider: "metered-provider",
				resolvedModel: "learning-mini",
				status: "success",
				usage: {
					input: 11,
					output: 7,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 23,
				},
				cost: {
					total: 0.000025,
					currency: "USD",
					pricingSource: "pie-metadata",
				},
				costUsd: 0.000025,
			},
			{
				requestedModel: "auto:memory",
				routingMode: "router",
				resolvedProvider: "metered-provider",
				resolvedModel: "memory-mini",
				status: "success",
				usage: {
					input: 11,
					output: 7,
					cacheRead: 3,
					cacheWrite: 2,
					totalTokens: 23,
				},
				cost: {
					total: 0.000025,
					currency: "USD",
					pricingSource: "pie-metadata",
				},
				costUsd: 0.000025,
			},
		]);
	});
});
