import type { Api, AssistantMessage, AssistantMessageEvent, Model } from "@pie-lab/ai";
import { createInMemoryUsageStore, type UsageRecord } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
	createPieLabRequestHandler,
	type ChatCompletionAuthResolver,
	type ChatCompletionExecutor,
	type ChatCompletionStreamExecutor,
} from "../src/index.js";

describe("chat completions API", () => {
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
		executor?: ChatCompletionExecutor;
		streamExecutor?: ChatCompletionStreamExecutor;
		authResolver?: ChatCompletionAuthResolver;
		store?: ReturnType<typeof createInMemoryUsageStore>;
	}) {
		const store = options.store ?? createInMemoryUsageStore();
		const catalog = createCatalog([
			createModel("anthropic", "claude-sonnet-4.5", "Claude Sonnet 4.5"),
			createModel("openai", "gpt-5.4", "GPT 5.4"),
		]);

		server = createServer(
			createPieLabRequestHandler({
				catalog,
				authResolver: options.authResolver,
				executor: options.executor ?? (async (model) => assistantMessage(model, "unused")),
				streamExecutor: options.streamExecutor,
				usageStore: store,
				now: () => new Date("2026-05-22T00:00:00.000Z"),
				requestIdFactory: () => "chatcmpl_test",
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return { baseUrl: `http://127.0.0.1:${address.port}`, store };
	}

	it("routes a non-stream chat completion and records usage", async () => {
		const { baseUrl, store } = await start({
			executor: async (model, context, options) => {
				expect(model.provider).toBe("anthropic");
				expect(context.systemPrompt).toBe("You are concise.");
				expect(context.messages.at(-1)).toMatchObject({ role: "user", content: "Hello" });
				expect(options.temperature).toBe(0.2);
				expect(options.apiKey).toBe("test-key");
				expect(options.headers).toEqual({ "x-test-auth": "yes" });
				return assistantMessage(model, "안녕하세요.");
			},
			authResolver: async () => ({
				apiKey: "test-key",
				headers: { "x-test-auth": "yes" },
				connectionId: "anthropic_conn_1",
			}),
		});

		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:coding",
				messages: [
					{ role: "system", content: "You are concise." },
					{ role: "user", content: "Hello" },
				],
				temperature: 0.2,
			}),
		});
		const body = (await response.json()) as {
			id: string;
			model: string;
			choices: Array<{ message: { content: string } }>;
			pi_adk: { requested_model: string; resolved_provider: string; resolved_model: string };
		};

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			id: "chatcmpl_test",
			model: "anthropic/claude-sonnet-4.5",
			choices: [{ message: { content: "안녕하세요." } }],
			pi_adk: {
				requested_model: "auto:coding",
				resolved_provider: "anthropic",
				resolved_model: "claude-sonnet-4.5",
			},
		});

		expect(store.getUsageRecords()).toMatchObject<Partial<UsageRecord>[]>([
			{
				requestId: "chatcmpl_test",
				requestedModel: "auto:coding",
				routingMode: "router",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
				connectionId: "anthropic_conn_1",
				status: "success",
				endpoint: "/v1/chat/completions",
				inputTokens: 10,
				outputTokens: 5,
				costUsd: 0.003,
			},
		]);
		expect(store.getUsageRecords()[0]?.trace?.map((event) => event.phase)).toEqual([
			"attempt.start",
			"budget.check",
			"auth.resolved",
			"upstream.complete",
		]);
	});

	it("tries the next combo route when a prior attempt returns an error message", async () => {
		let calls = 0;
		const { baseUrl, store } = await start({
			executor: async (model) => {
				calls += 1;
				if (calls === 1) {
					return assistantMessage(model, "", { stopReason: "error", errorMessage: "rate limit" });
				}
				return assistantMessage(model, "fallback ok");
			},
		});

		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "combo:coding",
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };

		expect(response.status).toBe(200);
		expect(body.choices[0].message.content).toBe("fallback ok");
		expect(store.getUsageRecords().map((record) => record.status)).toEqual(["error", "success"]);
		expect(store.getUsageRecords().map((record) => record.attemptIndex)).toEqual([0, 1]);
	});

	it("uses 9router fallback rules for upstream status errors", async () => {
		let calls = 0;
		const { baseUrl, store } = await start({
			executor: async (model) => {
				calls += 1;
				if (calls === 1) {
					throw statusError("too many requests", 429);
				}
				return assistantMessage(model, "fallback ok");
			},
		});

		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "combo:coding",
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };

		expect(response.status).toBe(200);
		expect(body.choices[0].message.content).toBe("fallback ok");
		expect(store.getUsageRecords()).toMatchObject<Partial<UsageRecord>[]>([
			{ status: "error", errorCode: 429, errorMessage: "too many requests" },
			{ status: "success" },
		]);
	});

	it("lists routed and concrete models", async () => {
		const { baseUrl } = await start({
			executor: async (model) => assistantMessage(model, "unused"),
		});

		const response = await fetch(`${baseUrl}/v1/models`);
		const body = (await response.json()) as { data: Array<{ id: string }> };

		expect(response.status).toBe(200);
		expect(body.data.map((model) => model.id)).toEqual(
			expect.arrayContaining(["auto:coding", "anthropic/claude-sonnet-4.5", "openai/gpt-5.4"]),
		);
	});

	it("streams chat completion chunks and records usage", async () => {
		const { baseUrl, store } = await start({
			streamExecutor: (model) => streamEvents(model, ["안녕", "하세요."]),
		});

		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:coding",
				stream: true,
				messages: [{ role: "user", content: "Hello" }],
			}),
		});
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(parseSsePayloads(body).map((payload) => payload.choices?.[0]?.delta?.content).filter(Boolean)).toEqual([
			"안녕",
			"하세요.",
		]);
		expect(body).toContain("data: [DONE]");
		expect(store.getUsageRecords()).toMatchObject<Partial<UsageRecord>[]>([
			{
				requestId: "chatcmpl_test",
				requestedModel: "auto:coding",
				routingMode: "router",
				status: "success",
				endpoint: "/v1/chat/completions",
			},
		]);
		expect(store.getUsageRecords()[0]?.trace?.map((event) => event.phase)).toEqual(
			expect.arrayContaining(["stream.open", "stream.event", "attempt.success"]),
		);
	});

	it("falls back to the next stream route before any SSE chunk is sent", async () => {
		let calls = 0;
		const { baseUrl, store } = await start({
			streamExecutor: (model) => {
				calls += 1;
				if (calls === 1) {
					return streamError(model, "rate limit");
				}
				return streamEvents(model, ["fallback stream"]);
			},
		});

		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "combo:coding",
				stream: true,
				messages: [{ role: "user", content: "Run" }],
			}),
		});
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(parseSsePayloads(body).map((payload) => payload.choices?.[0]?.delta?.content).filter(Boolean)).toEqual([
			"fallback stream",
		]);
		expect(store.getUsageRecords().map((record) => record.status)).toEqual(["error", "success"]);
		expect(store.getUsageRecords().map((record) => record.attemptIndex)).toEqual([0, 1]);
	});
});

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

function assistantMessage(
	model: Model<Api>,
	text: string,
	options: Partial<Pick<AssistantMessage, "stopReason" | "errorMessage">> = {},
): AssistantMessage {
	return {
		role: "assistant",
		content: text.length > 0 ? [{ type: "text", text }] : [],
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
		stopReason: options.stopReason ?? "stop",
		errorMessage: options.errorMessage,
		timestamp: Date.parse("2026-05-22T00:00:00.000Z"),
	};
}

async function* streamEvents(model: Model<Api>, chunks: string[]): AsyncIterable<AssistantMessageEvent> {
	const partial = assistantMessage(model, "");
	yield { type: "start", partial };
	yield { type: "text_start", contentIndex: 0, partial };
	for (const chunk of chunks) {
		yield { type: "text_delta", contentIndex: 0, delta: chunk, partial };
	}
	yield { type: "text_end", contentIndex: 0, content: chunks.join(""), partial };
	yield { type: "done", reason: "stop", message: assistantMessage(model, chunks.join("")) };
}

async function* streamError(model: Model<Api>, message: string): AsyncIterable<AssistantMessageEvent> {
	yield {
		type: "error",
		reason: "error",
		error: assistantMessage(model, "", { stopReason: "error", errorMessage: message }),
	};
}

function statusError(message: string, status: number): Error & { status: number } {
	const error = new Error(message) as Error & { status: number };
	error.status = status;
	return error;
}

function parseSsePayloads(body: string): Array<any> {
	return body
		.split("\n\n")
		.map((chunk) => chunk.trim())
		.filter((chunk) => chunk.startsWith("data: ") && chunk !== "data: [DONE]")
		.map((chunk) => JSON.parse(chunk.slice("data: ".length)));
}
