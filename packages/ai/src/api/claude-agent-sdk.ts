import { closeSync, existsSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Options, PermissionMode, Query, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Usage,
} from "../types.ts";
import { AssistantMessageEventStream } from "../utils/event-stream.ts";
import { transformMessages } from "./transform-messages.ts";

export interface ClaudeAgentSdkOptions extends StreamOptions {
	cwd?: string;
	permissionMode?: PermissionMode;
	systemPrompt?: Options["systemPrompt"];
	appendSystemPrompt?: string;
	includePieSystemPrompt?: boolean;
	settingSources?: Options["settingSources"];
	tools?: Options["tools"];
	allowedTools?: string[];
	disallowedTools?: string[];
	maxTurns?: number;
	maxBudgetUsd?: number;
	resume?: string;
	continue?: boolean;
	pathToClaudeCodeExecutable?: string;
	claudePath?: string;
	persistSession?: boolean;
}

type MutableAssistantMessage = AssistantMessage & {
	content: AssistantMessage["content"];
};

const CLAUDE_MODEL_ALIASES: Record<string, string> = {
	haiku: "claude-haiku-4-5",
	opus: "claude-opus-4-7",
	sonnet: "claude-sonnet-4-6",
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

export const stream: StreamFunction<"claude-agent-sdk", ClaudeAgentSdkOptions> = (
	model: Model<"claude-agent-sdk">,
	context: Context,
	options?: ClaudeAgentSdkOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output = createAssistantMessage(model);
		let queryHandle: Query | undefined;
		let abortCleanup: (() => void) | undefined;
		let finished = false;
		let activeBlockIndex: number | undefined;
		let activeBlockType: "text" | "thinking" | undefined;
		let sawStreamedContent = false;

		const closeActiveBlock = () => {
			if (activeBlockIndex === undefined || activeBlockType === undefined) return;
			const block = output.content[activeBlockIndex];
			if (activeBlockType === "text" && block?.type === "text") {
				stream.push({
					type: "text_end",
					contentIndex: activeBlockIndex,
					content: block.text,
					partial: output,
				});
			} else if (activeBlockType === "thinking" && block?.type === "thinking") {
				stream.push({
					type: "thinking_end",
					contentIndex: activeBlockIndex,
					content: block.thinking,
					partial: output,
				});
			}
			activeBlockIndex = undefined;
			activeBlockType = undefined;
		};

		const ensureBlock = (type: "text" | "thinking") => {
			if (activeBlockType === type && activeBlockIndex !== undefined) return activeBlockIndex;
			closeActiveBlock();
			activeBlockIndex = output.content.length;
			activeBlockType = type;
			if (type === "text") {
				output.content.push({ type: "text", text: "" });
				stream.push({ type: "text_start", contentIndex: activeBlockIndex, partial: output });
			} else {
				output.content.push({ type: "thinking", thinking: "" });
				stream.push({ type: "thinking_start", contentIndex: activeBlockIndex, partial: output });
			}
			return activeBlockIndex;
		};

		const emitText = (text: string) => {
			if (!text) return;
			const index = ensureBlock("text");
			const block = output.content[index] as TextContent;
			block.text += text;
			stream.push({ type: "text_delta", contentIndex: index, delta: text, partial: output });
			sawStreamedContent = true;
		};

		const emitThinking = (thinking: string) => {
			if (!thinking) return;
			const index = ensureBlock("thinking");
			const block = output.content[index] as ThinkingContent;
			block.thinking += thinking;
			stream.push({ type: "thinking_delta", contentIndex: index, delta: thinking, partial: output });
			sawStreamedContent = true;
		};

		const finishWithError = (reason: "error" | "aborted", errorMessage: string) => {
			if (finished) return;
			finished = true;
			closeActiveBlock();
			output.stopReason = reason;
			output.errorMessage = errorMessage;
			stream.push({ type: "error", reason, error: output });
			stream.end();
		};

		try {
			stream.push({ type: "start", partial: output });

			const { query } = await import("@anthropic-ai/claude-agent-sdk");
			const abortController = new AbortController();
			abortCleanup = forwardAbortSignal(options?.signal, abortController, () => queryHandle?.interrupt());
			const prompt = buildPrompt(model, context);
			let sdkOptions = buildSdkOptions(model, context, abortController, options);
			const overriddenOptions = await options?.onPayload?.(sdkOptions, model);
			if (overriddenOptions !== undefined) {
				sdkOptions = overriddenOptions as Options;
			}
			queryHandle = query({ prompt, options: sdkOptions });

			for await (const message of queryHandle) {
				const event = message as SDKMessage;
				if (event.type === "stream_event") {
					handleStreamEvent(event.event, emitText, emitThinking);
					continue;
				}
				if (event.type === "assistant" && !sawStreamedContent) {
					handleAssistantMessage(event.message?.content, emitText, emitThinking);
					output.responseId ||= event.session_id;
					continue;
				}
				if (event.type === "result") {
					output.responseId ||= event.session_id;
					output.responseModel = extractResponseModel(event) ?? output.responseModel;
					output.usage = usageFromResult(event);

					if (isResultError(event)) {
						const message = resultErrorMessage(event);
						if (!hasVisibleText(output)) emitText(message);
						finishWithError("error", message);
						return;
					}

					if (!hasVisibleText(output) && "result" in event && typeof event.result === "string") {
						emitText(event.result);
					}

					finished = true;
					closeActiveBlock();
					output.stopReason = "stop";
					stream.push({ type: "done", reason: "stop", message: output });
					stream.end();
					return;
				}
			}

			if (!finished) {
				finished = true;
				closeActiveBlock();
				output.stopReason = options?.signal?.aborted ? "aborted" : "stop";
				if (output.stopReason === "aborted") {
					stream.push({ type: "error", reason: "aborted", error: output });
				} else {
					stream.push({ type: "done", reason: "stop", message: output });
				}
				stream.end();
			}
		} catch (error) {
			const aborted = options?.signal?.aborted === true;
			finishWithError(aborted ? "aborted" : "error", error instanceof Error ? error.message : String(error));
		} finally {
			abortCleanup?.();
			queryHandle?.close();
		}
	})();

	return stream;
};

export const streamSimple: StreamFunction<"claude-agent-sdk", SimpleStreamOptions> = (
	model: Model<"claude-agent-sdk">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	return stream(model, context, options as ClaudeAgentSdkOptions);
};

function createAssistantMessage(model: Model<"claude-agent-sdk">): MutableAssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "claude-agent-sdk" as Api,
		provider: model.provider,
		model: model.id,
		responseModel: resolveClaudeModelId(model.id),
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { ...ZERO_COST },
	};
}

function buildSdkOptions(
	model: Model<"claude-agent-sdk">,
	context: Context,
	abortController: AbortController,
	options?: ClaudeAgentSdkOptions,
): Options {
	const permissionMode = options?.permissionMode ?? defaultPermissionMode();
	const claudePath = options?.pathToClaudeCodeExecutable ?? options?.claudePath ?? findClaudeCodeExecutable();

	return {
		abortController,
		cwd: options?.cwd ?? process.cwd(),
		model: resolveClaudeModelId(model.id),
		permissionMode,
		settingSources: options?.settingSources ?? ["user", "project"],
		includePartialMessages: true,
		systemPrompt:
			options?.systemPrompt ??
			buildSystemPrompt(
				options?.appendSystemPrompt ?? (options?.includePieSystemPrompt ? context.systemPrompt : undefined),
			),
		tools: options?.tools ?? { type: "preset", preset: "claude_code" },
		allowedTools: options?.allowedTools,
		disallowedTools: options?.disallowedTools,
		maxTurns: options?.maxTurns,
		maxBudgetUsd: options?.maxBudgetUsd,
		resume: options?.resume,
		continue: options?.continue,
		persistSession: options?.persistSession,
		env: {
			...process.env,
			CLAUDE_AGENT_SDK_CLIENT_APP: process.env.CLAUDE_AGENT_SDK_CLIENT_APP ?? "pie-lab/0.75.3",
		},
		...(permissionMode === "bypassPermissions" ? { allowDangerouslySkipPermissions: true } : {}),
		...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
	};
}

function defaultPermissionMode(): PermissionMode {
	return process.getuid?.() === 0 ? "acceptEdits" : "bypassPermissions";
}

function buildSystemPrompt(systemPrompt: string | undefined): Options["systemPrompt"] {
	if (!systemPrompt?.trim()) {
		return { type: "preset", preset: "claude_code" };
	}
	return {
		type: "preset",
		preset: "claude_code",
		append: systemPrompt,
	};
}

function buildPrompt(model: Model<"claude-agent-sdk">, context: Context): string {
	const messages = transformMessages(context.messages, model);
	const latestUserIndex = findLatestUserMessageIndex(messages);

	if (latestUserIndex === -1) {
		return "Continue.";
	}

	if (messages.length === 1 && messages[latestUserIndex]?.role === "user") {
		return formatUserContent(messages[latestUserIndex].content);
	}

	const parts = ["Use the previous transcript as context, then answer the latest user request."];

	if (latestUserIndex > 0) {
		const previousMessages = messages.slice(0, latestUserIndex);
		parts.push("Previous transcript:");
		for (const message of previousMessages) {
			parts.push(formatMessage(message));
		}
	}

	const latestUserMessage = messages[latestUserIndex];
	if (latestUserMessage?.role === "user") {
		parts.push("Latest user request:");
		parts.push(formatUserContent(latestUserMessage.content));
	} else {
		parts.push("Transcript:");
		for (const message of messages) {
			parts.push(formatMessage(message));
		}
	}

	return parts.join("\n\n");
}

function findLatestUserMessageIndex(messages: Message[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index]?.role === "user") return index;
	}
	return -1;
}

function formatMessage(message: Message): string {
	if (message.role === "user") {
		return `User:\n${formatUserContent(message.content)}`;
	}
	if (message.role === "toolResult") {
		return `Tool result (${message.toolName}${message.isError ? ", error" : ""}):\n${formatContentBlocks(message.content)}`;
	}
	return `Assistant:\n${formatAssistantContent(message.content)}`;
}

function formatUserContent(content: string | (TextContent | ImageContent)[]): string {
	return typeof content === "string" ? content : formatContentBlocks(content);
}

function formatContentBlocks(blocks: (TextContent | ImageContent)[]): string {
	return blocks
		.map((block) => {
			if (block.type === "image") return `[image: ${block.mimeType}]`;
			return block.text;
		})
		.join("\n");
}

function formatAssistantContent(content: AssistantMessage["content"]): string {
	const rendered = content.flatMap((block) => {
		if (block.type === "text") return [block.text];
		if (block.type === "thinking") return block.thinking.trim() ? [`[thinking]\n${block.thinking}`] : [];
		return [`[tool call: ${block.name}] ${JSON.stringify(block.arguments)}`];
	});
	return rendered.join("\n");
}

function handleStreamEvent(
	event: unknown,
	emitText: (text: string) => void,
	emitThinking: (thinking: string) => void,
): void {
	const raw = asRecord(event);
	if (raw?.type !== "content_block_delta") return;
	const delta = asRecord(raw.delta);
	if (!delta) return;
	if (typeof delta.text === "string") emitText(delta.text);
	if (typeof delta.thinking === "string") emitThinking(delta.thinking);
}

function handleAssistantMessage(
	content: unknown,
	emitText: (text: string) => void,
	emitThinking: (thinking: string) => void,
): void {
	if (!Array.isArray(content)) return;
	for (const block of content) {
		const item = asRecord(block);
		if (!item) continue;
		if (item.type === "text" && typeof item.text === "string") {
			emitText(item.text);
		} else if (item.type === "thinking" && typeof item.thinking === "string") {
			emitThinking(item.thinking);
		}
	}
}

function hasVisibleText(output: AssistantMessage): boolean {
	return output.content.some((block) => block.type === "text" && block.text.trim().length > 0);
}

function isResultError(event: SDKResultMessage): boolean {
	return event.subtype !== "success" || event.is_error === true;
}

function resultErrorMessage(event: SDKResultMessage): string {
	if ("errors" in event && Array.isArray(event.errors) && event.errors.length > 0) {
		return event.errors.join("\n");
	}
	if ("result" in event && typeof event.result === "string" && event.result.trim()) {
		return event.result;
	}
	return event.stop_reason ?? "Claude Agent SDK execution failed";
}

function usageFromResult(event: SDKResultMessage): Usage {
	const usage = emptyUsage();
	const modelUsage = Object.values(event.modelUsage ?? {});

	for (const item of modelUsage) {
		usage.input += readNumber(item, "inputTokens");
		usage.output += readNumber(item, "outputTokens");
		usage.cacheRead += readNumber(item, "cacheReadInputTokens");
		usage.cacheWrite += readNumber(item, "cacheCreationInputTokens");
		usage.cost.total += readNumber(item, "costUSD");
	}

	if (usage.cost.total === 0) {
		usage.cost.total = event.total_cost_usd ?? 0;
	}

	usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return usage;
}

function extractResponseModel(event: SDKResultMessage): string | undefined {
	const [first] = Object.keys(event.modelUsage ?? {});
	return first;
}

function readNumber(source: unknown, key: string): number {
	const record = asRecord(source);
	const value = record?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolveClaudeModelId(modelId: string): string {
	return CLAUDE_MODEL_ALIASES[modelId] ?? modelId;
}

function forwardAbortSignal(
	signal: AbortSignal | undefined,
	abortController: AbortController,
	onAbort?: () => unknown,
): () => void {
	if (!signal) return () => {};
	const abort = () => {
		abortController.abort();
		runAbortCallback(onAbort);
	};
	if (signal.aborted) {
		abort();
		return () => {};
	}
	if (typeof signal.addEventListener !== "function") {
		return () => {};
	}
	signal.addEventListener("abort", abort, { once: true });
	return () => signal.removeEventListener("abort", abort);
}

function runAbortCallback(onAbort: (() => unknown) | undefined): void {
	if (!onAbort) return;
	try {
		const result = onAbort();
		if (result && typeof (result as Promise<unknown>).catch === "function") {
			void (result as Promise<unknown>).catch(() => {
				// Interrupt is best-effort. The abortController signal is the authoritative cancellation path.
			});
		}
	} catch {
		// Interrupt can throw when the SDK has already observed the same abort.
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function findClaudeCodeExecutable(): string | undefined {
	if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;

	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const found = findNativeExecutable(join(dir, "claude"));
		if (found) return found;
	}

	for (const candidate of [
		join(homedir(), ".claude", "local", "claude"),
		join(homedir(), ".local", "bin", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
		"/usr/bin/claude",
	]) {
		const found = findNativeExecutable(candidate);
		if (found) return found;
	}

	return undefined;
}

function findNativeExecutable(filePath: string): string | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const real = realpathSync(filePath);
		return isNativeBinary(real) ? filePath : undefined;
	} catch {
		return undefined;
	}
}

function isNativeBinary(filePath: string): boolean {
	let fd: number | undefined;
	try {
		const bytes = Buffer.alloc(4);
		fd = openSync(filePath, "r");
		readSync(fd, bytes, 0, 4, 0);
		if (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return true;
		const magic = bytes.readUInt32LE(0);
		return [0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe].includes(magic);
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
