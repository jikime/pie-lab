import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentMessage } from "@pie-lab/agent-core";
import type { AssistantMessage, Message, Model } from "@pie-lab/ai";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import type { LearningSettings } from "./learning-settings.ts";

interface HonchoConfig {
	apiKey?: string;
	baseUrl?: string;
	workspaceId: string;
	aiPeer: string;
	sessionStrategy: "per-repo" | "global";
}

type HonchoClientModule = { Honcho?: new (options?: Record<string, unknown>) => any };
type MemoryStreamFn = (
	model: Model<any>,
	context: { systemPrompt?: string; messages: Message[] },
	options?: Record<string, unknown>,
) => any;

const dynamicImport = new Function("specifier", "return import(specifier)") as (
	specifier: string,
) => Promise<HonchoClientModule>;

export class HonchoProvider {
	private client: any | undefined;
	private userPeer: any | undefined;
	private aiPeer: any | undefined;
	private session: any | undefined;
	private disabled = false;
	private contextFetchCount = 0;
	private readonly options: {
		agentDir: string;
		cwd: string;
		sessionId: string;
		settings: LearningSettings;
		streamFn?: MemoryStreamFn;
	};

	constructor(options: {
		agentDir: string;
		cwd: string;
		sessionId: string;
		settings: LearningSettings;
		streamFn?: MemoryStreamFn;
	}) {
		this.options = options;
	}

	async injectContext(messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> {
		if (!this.options.settings.enabled || !this.options.settings.honcho.enabled || signal?.aborted) return messages;
		const context = await this.fetchContext(signal).catch(() => undefined);
		if (!context) return messages;

		const index = findLastUserMessageIndex(messages);
		if (index === -1) return messages;
		const cloned = messages.slice();
		const target = cloned[index];
		if (target.role !== "user") return messages;
		cloned[index] = {
			...target,
			content: prependTextContent(target.content, `<memory-context>\n${context}\n</memory-context>\n\n`),
		};
		return cloned;
	}

	async syncTurn(messages: AgentMessage[]): Promise<void> {
		if (!this.options.settings.enabled || !this.options.settings.honcho.enabled) return;
		const session = await this.getSession().catch(() => undefined);
		if (!session || !this.userPeer || !this.aiPeer) return;
		const honchoMessages = messages
			.map((message) => {
				const text = extractText(message);
				if (!text) return undefined;
				if (message.role === "user") return this.userPeer.message(text);
				if (message.role === "assistant") return this.aiPeer.message(text);
				return undefined;
			})
			.filter(Boolean);
		if (honchoMessages.length === 0) return;
		await session.addMessages(honchoMessages).catch(() => undefined);
	}

	private async fetchContext(signal?: AbortSignal): Promise<string | undefined> {
		const session = await this.getSession();
		if (!session || !this.userPeer) return undefined;
		const tokenBudget = this.options.settings.honcho.contextTokenBudget;
		const parts: string[] = [];

		const userContext = await this.userPeer.context?.({ target: this.config().aiPeer }).catch(() => undefined);
		if (userContext?.representation) parts.push(`User representation:\n${userContext.representation}`);
		if (Array.isArray(userContext?.peerCard) && userContext.peerCard.length > 0) {
			parts.push(`User card:\n${userContext.peerCard.join("\n")}`);
		}

		const sessionContext = await session.context?.({ tokens: tokenBudget }).catch(() => undefined);
		const sessionText = stringifyHonchoContext(sessionContext);
		if (sessionText) parts.push(`Session summary:\n${sessionText}`);

		const dialectic = this.shouldFetchDialecticSummary()
			? await this.fetchDialecticSummary(parts.join("\n\n"), signal).catch(() => undefined)
			: undefined;
		if (dialectic) parts.push(`Dialectic summary:\n${String(dialectic)}`);

		return truncateByApproxTokens(parts.join("\n\n"), tokenBudget);
	}

	private shouldFetchDialecticSummary(): boolean {
		this.contextFetchCount += 1;
		const cadence = Math.max(1, this.options.settings.honcho.dialecticCadence);
		return (this.contextFetchCount - 1) % cadence === 0;
	}

	private async fetchDialecticSummary(context: string, signal?: AbortSignal): Promise<string | undefined> {
		if (!context.trim()) return undefined;
		if (this.options.streamFn) {
			const summary = await summarizeWithRouterMemory(this.options.streamFn, context, signal).catch(() => undefined);
			if (summary) return summary;
		}
		const fallback = this.userPeer?.chat?.("Summarize the current working relationship and recurring preferences.", {
			session: this.session?.id,
		});
		if (fallback && typeof fallback.catch === "function") return fallback.catch(() => undefined);
		return fallback;
	}

	private async getSession(): Promise<any | undefined> {
		if (this.disabled) return undefined;
		if (this.session) return this.session;
		const client = await this.getClient();
		if (!client) return undefined;
		const config = this.config();
		this.userPeer = await client.peer("user").catch(() => undefined);
		this.aiPeer = await client.peer(config.aiPeer).catch(() => undefined);
		this.session = await client.session(this.sessionKey()).catch(() => undefined);
		if (this.session?.addPeers && this.userPeer && this.aiPeer) {
			await this.session.addPeers([this.userPeer, this.aiPeer]).catch(() => undefined);
		}
		return this.session;
	}

	private async getClient(): Promise<any | undefined> {
		if (this.disabled) return undefined;
		if (this.client) return this.client;
		const config = this.config();
		if (!config.apiKey && !process.env.HONCHO_API_KEY) {
			this.disabled = true;
			return undefined;
		}
		try {
			const module = await dynamicImport("@honcho-ai/sdk");
			if (!module.Honcho) {
				this.disabled = true;
				return undefined;
			}
			this.client = new module.Honcho({
				workspaceId: config.workspaceId,
				apiKey: config.apiKey,
				baseURL: config.baseUrl,
				environment: config.baseUrl ? undefined : "production",
			});
			return this.client;
		} catch {
			this.disabled = true;
			return undefined;
		}
	}

	private config(): HonchoConfig {
		const path = join(this.options.agentDir, "honcho.json");
		let fileConfig: Partial<HonchoConfig> = {};
		if (existsSync(path)) {
			try {
				fileConfig = JSON.parse(readFileSync(path, "utf-8")) as Partial<HonchoConfig>;
			} catch {
				fileConfig = {};
			}
		}
		return {
			apiKey: process.env.HONCHO_API_KEY ?? fileConfig.apiKey,
			baseUrl: process.env.HONCHO_BASE_URL ?? fileConfig.baseUrl,
			workspaceId: process.env.HONCHO_WORKSPACE_ID ?? fileConfig.workspaceId ?? "pie-lab",
			aiPeer: fileConfig.aiPeer ?? "pie",
			sessionStrategy: fileConfig.sessionStrategy ?? this.options.settings.honcho.sessionStrategy,
		};
	}

	private sessionKey(): string {
		const config = this.config();
		if (config.sessionStrategy === "global") return "global";
		const hash = createHash("sha256").update(this.options.cwd).digest("hex").slice(0, 16);
		return `${basename(this.options.cwd) || "repo"}-${hash}-${this.options.sessionId}`;
	}
}

function findLastUserMessageIndex(messages: AgentMessage[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return i;
	}
	return -1;
}

function prependTextContent(content: any, text: string): any {
	if (typeof content === "string") return `${text}${content}`;
	if (!Array.isArray(content)) return [{ type: "text", text }];
	return [{ type: "text", text }, ...content];
}

function extractText(message: AgentMessage): string {
	const content = (message as any).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item) => item?.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function stringifyHonchoContext(context: unknown): string {
	if (!context) return "";
	if (typeof context === "string") return context;
	if (typeof (context as any).toString === "function") {
		const text = String(context);
		if (text !== "[object Object]") return text;
	}
	try {
		return JSON.stringify(context, null, 2);
	} catch {
		return "";
	}
}

async function summarizeWithRouterMemory(
	streamFn: MemoryStreamFn,
	context: string,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (signal?.aborted) return undefined;
	const stream = await Promise.resolve(
		streamFn(
			createRouterModel("auto:memory"),
			{
				systemPrompt:
					"Summarize durable user modeling context for Pie. Keep only recurring preferences, working style, stable relationship notes, and reusable collaboration patterns. Do not include secrets.",
				messages: [
					{
						role: "user",
						content: `Summarize this Honcho context for prompt injection:\n\n<context>\n${context}\n</context>`,
						timestamp: Date.now(),
					},
				],
			},
			{ signal, maxTokens: 700 },
		),
	);
	let message: AssistantMessage | undefined;
	for await (const event of stream) {
		if (event.type === "done") {
			message = event.message;
		} else if (event.type === "error") {
			return undefined;
		}
	}
	return message ? extractAssistantText(message) : undefined;
}

function createRouterModel(id: "auto:memory"): Model<any> {
	return {
		id,
		name: `Router ${id}`,
		provider: PIE_LAB_ROUTER_PROVIDER,
		api: PIE_LAB_ROUTER_PROVIDER as any,
		baseUrl: "",
		input: ["text"],
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	};
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function truncateByApproxTokens(text: string, maxTokens: number): string {
	const maxChars = Math.max(1, maxTokens) * 4;
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n[truncated]`;
}
