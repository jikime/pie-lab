import type { AgentMessage } from "@pie-lab/agent-core";
import type { Api, AssistantMessage, Model } from "@pie-lab/ai";
import type { AgentSessionEvent } from "@pie-lab/coding-agent";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPieLabRequestHandler, type PieAgentChatSession } from "../src/index.ts";

describe("pie agent chat API", () => {
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

	async function start(options: { sessionFactory: () => Promise<FakePieAgentSession> }) {
		const registry = createModelRegistry([createModel("pie-lab-router", "auto:chat")]);
		server = createServer(
			createPieLabRequestHandler({
				modelRegistry: registry as any,
				sessionFactory: async ({ model }) => {
					const session = await options.sessionFactory();
					if (model) session.agent.state.model = model;
					return session;
				},
				requestIdFactory: () => "piechat_test",
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		return { baseUrl: `http://127.0.0.1:${address.port}` };
	}

	it("streams web chat through a pie AgentSession", async () => {
		const session = new FakePieAgentSession("agent answer");
		const { baseUrl } = await start({ sessionFactory: async () => session });

		const response = await fetch(`${baseUrl}/v1/pie/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: "auto:chat",
				conversation_id: "web_test",
				stream: true,
				messages: [
					{ role: "user", content: "previous" },
					{ role: "assistant", content: "prior answer" },
					{ role: "user", content: "current prompt" },
				],
			}),
		});
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(session.prompts).toEqual(["current prompt"]);
		expect(session.agent.state.messages).toMatchObject([
			{ role: "user", content: "previous" },
			{ role: "assistant", content: [{ type: "text", text: "prior answer" }] },
			{ role: "user", content: "current prompt" },
			{ role: "assistant", content: [{ type: "text", text: "agent answer" }] },
		]);
		expect(body).toContain('"content":"agent answer"');
		expect(body).toContain('"routing_mode":"agent-session"');
		expect(body).toContain('"agent_session_id":"fake_session"');
		expect(body).toContain("data: [DONE]");
	});

	it("reuses the same pie AgentSession for the same web conversation", async () => {
		let factories = 0;
		const session = new FakePieAgentSession("ok");
		const { baseUrl } = await start({
			sessionFactory: async () => {
				factories += 1;
				return session;
			},
		});

		for (const content of ["first", "second"]) {
			const response = await fetch(`${baseUrl}/v1/pie/chat/completions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model: "auto:chat",
					conversation_id: "web_reuse",
					stream: false,
					messages: [{ role: "user", content }],
				}),
			});
			expect(response.status).toBe(200);
		}

		expect(factories).toBe(1);
		expect(session.prompts).toEqual(["first", "second"]);
	});
});

class FakePieAgentSession implements PieAgentChatSession {
	readonly sessionId = "fake_session";
	readonly prompts: string[] = [];
	readonly listeners: Array<(event: AgentSessionEvent) => void> = [];
	readonly agent: PieAgentChatSession["agent"];
	private readonly answer: string;
	private streaming = false;

	constructor(answer: string) {
		this.answer = answer;
		this.agent = {
			state: {
				messages: [],
				model: createModel("pie-lab-router", "auto:chat"),
			},
		};
	}

	get isStreaming(): boolean {
		return this.streaming;
	}

	get model(): Model<Api> | undefined {
		return this.agent.state.model;
	}

	async prompt(text: string): Promise<void> {
		this.prompts.push(text);
		this.streaming = true;
		const user: AgentMessage = { role: "user", content: text, timestamp: Date.now() };
		this.agent.state.messages = [...this.agent.state.messages, user];
		const assistant = assistantMessage(this.agent.state.model ?? createModel("pie-lab-router", "auto:chat"), this.answer);
		this.emit({
			type: "message_update",
			message: assistant,
			assistantMessageEvent: {
				type: "text_delta",
				contentIndex: 0,
				delta: this.answer,
				partial: assistant,
			},
		});
		this.agent.state.messages = [...this.agent.state.messages, assistant];
		this.emit({ type: "message_end", message: assistant });
		this.emit({ type: "agent_end", messages: [user, assistant], willRetry: false });
		this.streaming = false;
	}

	async abort(): Promise<void> {
		this.streaming = false;
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) this.listeners.splice(index, 1);
		};
	}

	dispose(): void {}

	private emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

function createModel(provider: string, id: string): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api: provider,
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100000,
		maxTokens: 4096,
	};
}

function createModelRegistry(models: Model<Api>[]) {
	return {
		find(provider: string, modelId: string) {
			return models.find((model) => model.provider === provider && model.id === modelId);
		},
		getAll() {
			return models;
		},
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
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
