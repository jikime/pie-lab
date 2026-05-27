import type { AgentMessage } from "@pie-lab/agent-core";
import type { Api, AssistantMessage, ImageContent, Model, TextContent } from "@pie-lab/ai";
import {
	createAgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	getAgentDir,
	loadEntriesFromFile,
	SessionManager,
	type SessionMessageEntry,
} from "@pie-lab/coding-agent";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createDefaultModelRegistry } from "./chat-completions-api.js";

export interface PieAgentChatApiOptions {
	modelRegistry?: CreateAgentSessionOptions["modelRegistry"];
	usageStore?: CreateAgentSessionOptions["usageStore"];
	cwd?: string;
	agentDir?: string;
	maxSessions?: number;
	sessionFactory?: PieAgentSessionFactory;
	now?: () => Date;
	requestIdFactory?: () => string;
}

export interface PieAgentChatSession {
	readonly sessionId: string;
	readonly isStreaming: boolean;
	readonly model?: Model<Api>;
	readonly agent: {
		state: {
			messages: AgentMessage[];
			model?: Model<Api>;
		};
	};
	prompt(text: string, options?: { source?: "interactive" | "rpc" | "extension" }): Promise<void>;
	abort(): Promise<void>;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	dispose(): void;
}

export type PieAgentSessionFactory = (options: {
	conversationId: string;
	model?: Model<Api>;
	modelRegistry?: CreateAgentSessionOptions["modelRegistry"];
	usageStore?: CreateAgentSessionOptions["usageStore"];
	cwd?: string;
	agentDir?: string;
}) => Promise<PieAgentChatSession>;

interface PieAgentChatCompletionRequest {
	model?: unknown;
	messages?: unknown;
	stream?: unknown;
	conversation_id?: unknown;
}

interface OpenAIChatMessage {
	role: string;
	content?: unknown;
}

interface OpenAIContentPart {
	type?: unknown;
	text?: unknown;
	image_url?: unknown;
}

interface SessionEntry {
	session: PieAgentChatSession;
	lastUsedAt: number;
	modelKey?: string;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization, x-pie-client-origin, x-pie-origin",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_ENDPOINT = "/v1/pie/chat/completions";
const SESSIONS_ENDPOINT = "/v1/pie/chat/sessions";
const DEFAULT_MODEL = "auto:chat";
const DEFAULT_MAX_SESSIONS = 20;

export function createPieAgentChatRequestHandler(options: PieAgentChatApiOptions = {}) {
	const modelRegistry = options.modelRegistry ?? createDefaultModelRegistry(options.agentDir);
	const sessionFactory = options.sessionFactory ?? defaultPieAgentSessionFactory;
	const sessions = new Map<string, SessionEntry>();
	const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
	const now = options.now ?? (() => new Date());
	const requestIdFactory = options.requestIdFactory ?? (() => `piechat_${randomUUID()}`);

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handlePieAgentChatRequest(request, response, {
				...options,
				modelRegistry,
				sessionFactory,
				sessions,
				maxSessions,
				now,
				requestIdFactory,
			});
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
					type: "server_error",
				},
			});
		}
	};
}

async function handlePieAgentChatRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<Pick<PieAgentChatApiOptions, "modelRegistry" | "sessionFactory" | "maxSessions" | "now" | "requestIdFactory">> &
		Pick<PieAgentChatApiOptions, "usageStore" | "cwd" | "agentDir"> & {
			sessions: Map<string, SessionEntry>;
		},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

	// GET /v1/pie/chat/sessions?conversation_id=… — return session history from disk
	if (url.pathname === SESSIONS_ENDPOINT && request.method === "GET") {
		const conversationId = url.searchParams.get("conversation_id")?.slice(0, 160);
		if (!conversationId) {
			writeJson(response, 400, { error: { message: "conversation_id query param required." } });
			return;
		}
		const agentDir = options.agentDir ?? getAgentDir();
		const sessionDir = process.env.PIE_WEB_CHAT_SESSION_DIR ?? join(agentDir, "sessions", "web-chat");
		const convDir = join(sessionDir, conversationId);
		const messages = loadConversationHistory(convDir);
		writeJson(response, 200, { conversation_id: conversationId, messages });
		return;
	}

	if (url.pathname !== DEFAULT_ENDPOINT) {
		writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
		return;
	}

	if (request.method !== "POST") {
		writeMethodNotAllowed(response);
		return;
	}

	const body = await readJsonBody<PieAgentChatCompletionRequest>(request);
	const validationError = validateRequest(body);
	if (validationError) {
		writeJson(response, 400, { error: { message: validationError, type: "invalid_request_error" } });
		return;
	}

	const requestId = options.requestIdFactory();
	const requestedModel = typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
	const conversationId =
		typeof body.conversation_id === "string" && body.conversation_id.trim()
			? body.conversation_id.trim().slice(0, 160)
			: `web_${randomUUID()}`;
	const messages = body.messages as OpenAIChatMessage[];
	const prompt = latestUserPrompt(messages);
	const model = resolveModelReference(options.modelRegistry, requestedModel);
	if (!model) {
		writeJson(response, 400, {
			error: {
				message: `Model not found: ${requestedModel}`,
				type: "invalid_request_error",
			},
		});
		return;
	}

	const entry = await getOrCreateSession({
		conversationId,
		model,
		requestedModel,
		messages,
		options,
	});

	if (entry.session.isStreaming) {
		writeJson(response, 409, {
			error: {
				message: "Pie agent session is already processing a message for this conversation.",
				type: "busy",
			},
		});
		return;
	}

	entry.lastUsedAt = options.now().getTime();
	entry.modelKey = modelKey(model);
	entry.session.agent.state.model = model;
	evictOldSessions(options.sessions, options.maxSessions);

	if (body.stream === false) {
		await handleNonStreamingAgentChat({
			response,
			session: entry.session,
			prompt,
			requestId,
			requestedModel,
			conversationId,
		});
		return;
	}

	await handleStreamingAgentChat({
		request,
		response,
		session: entry.session,
		prompt,
		requestId,
		requestedModel,
		conversationId,
	});
}

async function getOrCreateSession(options: {
	conversationId: string;
	model: Model<Api>;
	requestedModel: string;
	messages: OpenAIChatMessage[];
	options: Required<Pick<PieAgentChatApiOptions, "modelRegistry" | "sessionFactory" | "maxSessions" | "now" | "requestIdFactory">> &
		Pick<PieAgentChatApiOptions, "usageStore" | "cwd" | "agentDir"> & {
			sessions: Map<string, SessionEntry>;
		};
}): Promise<SessionEntry> {
	const existing = options.options.sessions.get(options.conversationId);
	if (existing) {
		return existing;
	}

	const session = await options.options.sessionFactory({
		conversationId: options.conversationId,
		model: options.model,
		modelRegistry: options.options.modelRegistry,
		usageStore: options.options.usageStore,
		cwd: options.options.cwd,
		agentDir: options.options.agentDir,
	});
	const history = openAiMessagesToAgentHistory(options.messages);
	if (history.length > 0) {
		session.agent.state.messages = history;
	}

	const entry = {
		session,
		lastUsedAt: options.options.now().getTime(),
		modelKey: modelKey(options.model),
	};
	options.options.sessions.set(options.conversationId, entry);
	return entry;
}

async function defaultPieAgentSessionFactory(options: {
	conversationId: string;
	model?: Model<Api>;
	modelRegistry?: CreateAgentSessionOptions["modelRegistry"];
	usageStore?: CreateAgentSessionOptions["usageStore"];
	cwd?: string;
	agentDir?: string;
}): Promise<PieAgentChatSession> {
	const cwd = options.cwd ?? process.env.PIE_WEB_CHAT_CWD ?? process.cwd();
	const agentDir = options.agentDir ?? getAgentDir();
	// Each conversationId gets its own subdirectory so it can be resumed across
	// page refreshes and server restarts. continueRecent() finds the existing
	// JSONL file if one exists, otherwise creates a fresh session.
	const sessionDir = process.env.PIE_WEB_CHAT_SESSION_DIR ?? join(agentDir, "sessions", "web-chat");
	const convDir = join(sessionDir, options.conversationId);
	const result = await createAgentSession({
		cwd,
		agentDir,
		model: options.model,
		modelRegistry: options.modelRegistry,
		usageStore: options.usageStore,
		sessionManager: SessionManager.continueRecent(cwd, convDir),
		sessionStartEvent: {
			type: "session_start",
			reason: "startup",
		},
	});
	return result.session;
}

async function handleStreamingAgentChat(options: {
	request: IncomingMessage;
	response: ServerResponse;
	session: PieAgentChatSession;
	prompt: string;
	requestId: string;
	requestedModel: string;
	conversationId: string;
}): Promise<void> {
	writeSseHeaders(options.response);

	let completed = false;
	let roleSent = false;
	let lastAssistant: AssistantMessage | undefined;
	let writeQueue = Promise.resolve();
	const enqueueWrite = (write: () => Promise<void>) => {
		writeQueue = writeQueue.then(write, write);
	};
	const route = () =>
		createRouteInfo({
			requestedModel: options.requestedModel,
			conversationId: options.conversationId,
			session: options.session,
			assistant: lastAssistant,
		});
	const writeRoleChunk = async () => {
		if (roleSent) return;
		roleSent = true;
		await writeSse(
			options.response,
			createChatCompletionChunk({
				requestId: options.requestId,
				route: route(),
				delta: { role: "assistant" },
				finishReason: null,
			}),
		);
	};

	const unsubscribe = options.session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			lastAssistant = event.assistantMessageEvent.partial;
			enqueueWrite(async () => {
				await writeRoleChunk();
				await writeSse(
					options.response,
					createChatCompletionChunk({
						requestId: options.requestId,
						route: route(),
						delta: { content: delta },
						finishReason: null,
					}),
				);
			});
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			lastAssistant = event.message as AssistantMessage;
		}
	});

	const abort = () => {
		if (!completed) void options.session.abort().catch(() => undefined);
	};
	options.request.on("aborted", abort);
	options.response.on("close", abort);

	try {
		await options.session.prompt(options.prompt, { source: "rpc" });
		await writeQueue;
		await writeRoleChunk();
		await writeSse(
			options.response,
			createChatCompletionChunk({
				requestId: options.requestId,
				route: route(),
				delta: {},
				finishReason: toOpenAIFinishReason(lastAssistant),
			}),
		);
		await writeSseDone(options.response);
		completed = true;
		options.response.end();
	} catch (error) {
		completed = true;
		await writeQueue.catch(() => undefined);
		await writeSseError(options.response, error instanceof Error ? error.message : String(error)).catch(() => undefined);
		await writeSseDone(options.response).catch(() => undefined);
		options.response.end();
	} finally {
		unsubscribe();
		options.request.off("aborted", abort);
		options.response.off("close", abort);
	}
}

async function handleNonStreamingAgentChat(options: {
	response: ServerResponse;
	session: PieAgentChatSession;
	prompt: string;
	requestId: string;
	requestedModel: string;
	conversationId: string;
}): Promise<void> {
	let lastAssistant: AssistantMessage | undefined;
	const unsubscribe = options.session.subscribe((event) => {
		if (event.type === "message_end" && event.message.role === "assistant") {
			lastAssistant = event.message as AssistantMessage;
		}
	});

	try {
		await options.session.prompt(options.prompt, { source: "rpc" });
		writeJson(options.response, 200, {
			id: options.requestId,
			object: "chat.completion",
			created: Math.floor((lastAssistant?.timestamp ?? Date.now()) / 1000),
			model: routeModelName(lastAssistant, options.session),
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: lastAssistant ? assistantText(lastAssistant) : "",
					},
					finish_reason: toOpenAIFinishReason(lastAssistant),
				},
			],
			pi_adk: createRouteInfo({
				requestedModel: options.requestedModel,
				conversationId: options.conversationId,
				session: options.session,
				assistant: lastAssistant,
			}),
		});
	} finally {
		unsubscribe();
	}
}

function validateRequest(body: PieAgentChatCompletionRequest): string | undefined {
	if (body.model !== undefined && typeof body.model !== "string") {
		return "model must be a string.";
	}
	if (!Array.isArray(body.messages)) {
		return "messages must be an array.";
	}
	if (body.messages.length === 0) {
		return "messages must contain at least one message.";
	}
	for (const message of body.messages) {
		if (!isOpenAIChatMessage(message)) {
			return "Each message must include a string role.";
		}
	}
	if (!latestUserPrompt(body.messages)) {
		return "messages must contain a non-empty user message.";
	}
	return undefined;
}

function latestUserPrompt(messages: OpenAIChatMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "user") {
			return openAiContentToText(message.content).trim();
		}
	}
	return "";
}

function openAiMessagesToAgentHistory(messages: OpenAIChatMessage[]): AgentMessage[] {
	let latestUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			latestUserIndex = index;
			break;
		}
	}
	const historyMessages = latestUserIndex >= 0 ? messages.slice(0, latestUserIndex) : messages;
	return historyMessages
		.map((message): AgentMessage | undefined => {
			if (message.role === "system" || message.role === "developer" || message.role === "tool") {
				return undefined;
			}
			if (message.role === "assistant") {
				return {
					role: "assistant",
					content: [{ type: "text", text: openAiContentToText(message.content) }],
					api: "openai-completions",
					provider: "external",
					model: "external",
					usage: emptyUsage(),
					stopReason: "stop",
					timestamp: Date.now(),
				};
			}
			if (message.role === "user") {
				return {
					role: "user",
					content: openAiContentToPiUserContent(message.content),
					timestamp: Date.now(),
				};
			}
			return undefined;
		})
		.filter((message): message is AgentMessage => message !== undefined);
}

function resolveModelReference(
	modelRegistry: NonNullable<PieAgentChatApiOptions["modelRegistry"]>,
	requestedModel: string,
): Model<Api> | undefined {
	const routerModel = modelRegistry.find(PIE_LAB_ROUTER_PROVIDER, requestedModel);
	if (routerModel) return routerModel;

	const slashIndex = requestedModel.indexOf("/");
	if (slashIndex > 0) {
		const provider = requestedModel.slice(0, slashIndex);
		const modelId = requestedModel.slice(slashIndex + 1);
		const model = modelRegistry.find(provider, modelId);
		if (model) return model;
	}

	const matches = modelRegistry.getAll().filter((model) => model.id === requestedModel);
	return matches.length === 1 ? matches[0] : undefined;
}

function createRouteInfo(options: {
	requestedModel: string;
	conversationId: string;
	session: PieAgentChatSession;
	assistant?: AssistantMessage;
}) {
	const provider = options.assistant?.provider ?? options.session.model?.provider;
	const model = options.assistant?.model ?? options.session.model?.id;
	return {
		requested_model: options.requestedModel,
		routing_mode: "agent-session",
		resolved_provider: provider,
		resolved_model: model,
		agent_session_id: options.session.sessionId,
		conversation_id: options.conversationId,
	};
}

function createChatCompletionChunk(options: {
	requestId: string;
	route: ReturnType<typeof createRouteInfo>;
	delta: Record<string, unknown>;
	finishReason: string | null;
}) {
	return {
		id: options.requestId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: routeModelNameFromRoute(options.route),
		choices: [
			{
				index: 0,
				delta: options.delta,
				finish_reason: options.finishReason,
			},
		],
		pi_adk: options.route,
	};
}

function routeModelNameFromRoute(route: ReturnType<typeof createRouteInfo>): string {
	if (route.resolved_provider && route.resolved_model) return `${route.resolved_provider}/${route.resolved_model}`;
	return route.requested_model;
}

function routeModelName(assistant: AssistantMessage | undefined, session: PieAgentChatSession): string {
	const provider = assistant?.provider ?? session.model?.provider;
	const model = assistant?.model ?? session.model?.id;
	return provider && model ? `${provider}/${model}` : DEFAULT_MODEL;
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function toOpenAIFinishReason(message: AssistantMessage | undefined): string {
	if (message?.stopReason === "length") return "length";
	if (message?.stopReason === "toolUse") return "tool_calls";
	return "stop";
}

function openAiContentToPiUserContent(content: unknown): string | Array<TextContent | ImageContent> {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}

	const blocks = content
		.map((part): TextContent | ImageContent | undefined => {
			if (!isOpenAIContentPart(part)) return undefined;
			if (part.type === "text" && typeof part.text === "string") {
				return { type: "text", text: part.text };
			}
			if (part.type === "image_url") {
				const imageUrl = getImageUrl(part.image_url);
				const image = imageUrl ? dataUrlToImageContent(imageUrl) : undefined;
				return image ?? (imageUrl ? { type: "text", text: `[image:${imageUrl}]` } : undefined);
			}
			return undefined;
		})
		.filter((block): block is TextContent | ImageContent => block !== undefined);

	return blocks.length > 0 ? blocks : "";
}

function openAiContentToText(content: unknown): string {
	const pieContent = openAiContentToPiUserContent(content);
	if (typeof pieContent === "string") {
		return pieContent;
	}
	return pieContent
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			return `[image:${block.mimeType}]`;
		})
		.join("\n");
}

function getImageUrl(imageUrl: unknown): string | undefined {
	if (typeof imageUrl === "string") return imageUrl;
	if (imageUrl && typeof imageUrl === "object" && "url" in imageUrl && typeof imageUrl.url === "string") {
		return imageUrl.url;
	}
	return undefined;
}

function dataUrlToImageContent(dataUrl: string): ImageContent | undefined {
	const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
	if (!match) return undefined;
	return {
		type: "image",
		mimeType: match[1],
		data: match[2],
	};
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function modelKey(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function evictOldSessions(sessions: Map<string, SessionEntry>, maxSessions: number): void {
	if (sessions.size <= maxSessions) return;
	const oldest = [...sessions.entries()].sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
	if (!oldest) return;
	oldest[1].session.dispose();
	sessions.delete(oldest[0]);
}

async function readJsonBody<Body>(request: IncomingMessage): Promise<Body> {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > 2 * 1024 * 1024) {
			throw new Error("Request body is too large.");
		}
		chunks.push(buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) {
		return {} as Body;
	}

	return JSON.parse(raw) as Body;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function writeSseHeaders(response: ServerResponse): void {
	response.writeHead(200, {
		...CORS_HEADERS,
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"content-type": "text/event-stream; charset=utf-8",
		"x-accel-buffering": "no",
	});
	response.flushHeaders?.();
}

async function writeSse(response: ServerResponse, data: unknown): Promise<void> {
	await writeRawSse(response, `data: ${JSON.stringify(data)}\n\n`);
}

async function writeSseError(response: ServerResponse, message: string): Promise<void> {
	await writeSse(response, {
		error: {
			message,
			type: "agent_session_error",
		},
	});
}

async function writeSseDone(response: ServerResponse): Promise<void> {
	await writeRawSse(response, "data: [DONE]\n\n");
}

async function writeRawSse(response: ServerResponse, chunk: string): Promise<void> {
	if (response.writableEnded) return;
	if (response.write(chunk)) {
		return;
	}

	await new Promise<void>((resolve) => response.once("drain", resolve));
}

function writeMethodNotAllowed(response: ServerResponse): void {
	writeJson(response, 405, {
		error: {
			message: "Method not allowed.",
			type: "invalid_request_error",
		},
	});
}

function isOpenAIChatMessage(value: unknown): value is OpenAIChatMessage {
	return !!value && typeof value === "object" && "role" in value && typeof value.role === "string";
}

function isOpenAIContentPart(value: unknown): value is OpenAIContentPart {
	return !!value && typeof value === "object";
}

/**
 * Read JSONL session files from a per-conversation directory and return
 * the chat history as OpenAI-compatible messages.
 */
function loadConversationHistory(convDir: string): Array<{ role: string; content: string }> {
	let files: string[];
	try {
		files = readdirSync(convDir)
			.filter((f) => f.endsWith(".jsonl"))
			.sort() // lexicographic = chronological (timestamp prefix)
			.map((f) => join(convDir, f));
	} catch {
		// Directory doesn't exist yet — no history
		return [];
	}

	const messages: Array<{ role: string; content: string }> = [];

	for (const file of files) {
		let entries;
		try {
			entries = loadEntriesFromFile(file);
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.type !== "message") continue;
			const msg = (entry as SessionMessageEntry).message;
			if (msg.role !== "user" && msg.role !== "assistant") continue;

			const text = extractMessageText(msg.content);
			if (!text.trim()) continue;
			messages.push({ role: msg.role, content: text });
		}
	}

	return messages;
}

/** Extract plain text from an agent message content (string | content block array). */
function extractMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return (content as Array<{ type: string; text?: string }>)
		.filter((block) => block.type === "text" && typeof block.text === "string")
		.map((block) => block.text as string)
		.join("");
}
