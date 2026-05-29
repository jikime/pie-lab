/**
 * web-ipc-server.ts
 *
 * Unix-socket IPC server embedded in the gateway daemon.
 * Allows the web chat API to route conversations through the same
 * GatewayConversationWorker pool as Telegram and Discord — the web
 * becomes a first-class gateway channel.
 *
 * Socket path: <agentDir>/gateway-web.sock
 *
 * Protocol (newline-delimited JSON, one connection per request):
 *   Client → Server: {"type":"chat","conversationId":"web_xxx","text":"Hello","userId":"web-user"}
 *   Client → Server: {"type":"abort","conversationId":"web_xxx"}
 *   Client → Server: {"type":"ping"}
 *   Server → Client: {"type":"pong"}
 *   Server → Client: {"type":"typing","active":true}
 *   Server → Client: {"type":"delta","text":"Hi"}
 *   Server → Client: {"type":"done","text":"full response"}
 *   Server → Client: {"type":"error","message":"..."}
 */

import { createServer } from "node:net";
import type { Server } from "node:net";
import { mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GatewayTransport, GatewayConversationEndpoint } from "./adapters.js";
import type { InboundMessageInput, ResolvedConversation } from "./chat/types.js";
import type { ConfiguredChannel, ChatAccountConfig } from "./chat/core/config-types.js";

export const WEB_IPC_SOCKET_NAME = "gateway-web.sock";

export function getWebIpcSocketPath(agentDir: string): string {
	return join(agentDir, WEB_IPC_SOCKET_NAME);
}

// ─── Web conversation builder ──────────────────────────────────────────────

export function buildWebConversation(agentDir: string, conversationId: string): ResolvedConversation {
	const chatHome = join(agentDir, "chat");
	const webAccountDir = join(chatHome, "accounts", "web");
	const convDir = join(webAccountDir, "channels", conversationId);
	const workspaceDir = join(convDir, "workspace");

	const account = { service: "web" as ChatAccountConfig["service"], name: "Web Chat" } as unknown as ChatAccountConfig;
	const channel: ConfiguredChannel = { id: conversationId, name: conversationId, dm: true };

	return {
		service: "web" as ResolvedConversation["service"],
		botName: "pie",
		accountId: "web",
		account,
		channelKey: conversationId,
		channel,
		conversationId: `web/${conversationId}`,
		conversationName: `Web / ${conversationId}`,
		access: {},
		gondolinSecrets: {},
		accountDir: webAccountDir,
		sharedDir: join(webAccountDir, "shared"),
		conversationDir: convDir,
		workspaceDir,
		gondolinDir: join(convDir, "gondolin"),
		accountMemoryPath: join(webAccountDir, "shared", "memory.md"),
		channelMemoryPath: join(workspaceDir, "memory.md"),
		logPath: join(convDir, "channel.jsonl"),
		filesDir: join(workspaceDir, "incoming"),
		lockPath: join(convDir, ".lock"),
	};
}

// ─── IPC Transport (streams response back over the socket) ─────────────────

class WebIPCTransport implements GatewayTransport {
	private closed: boolean;
	/** True once send() has written a {"type":"done"} frame. */
	private doneSent: boolean;
	private readonly writeLine: (line: string) => void;

	constructor(writeLine: (line: string) => void) {
		this.closed = false;
		this.doneSent = false;
		this.writeLine = writeLine;
	}

	/**
	 * Close the transport.  If send() was never called (empty LLM response,
	 * aborted turn, or error caught in tryDispatch) the IPC client would hang
	 * forever waiting for a "done" frame.  Send one now with empty text so the
	 * client can always resolve its sendMessage() promise.
	 */
	close(): void {
		if (!this.doneSent) {
			try {
				this.writeLine(JSON.stringify({ type: "done", text: "" }));
			} catch {
				// socket may have already closed
			}
		}
		this.closed = true;
	}

	private write(obj: Record<string, unknown>): void {
		if (this.closed) return;
		try {
			this.writeLine(JSON.stringify(obj));
		} catch {
			// socket may have closed mid-write
		}
	}

	async startTyping(): Promise<void> {
		this.write({ type: "typing", active: true });
	}

	async stopTyping(): Promise<void> {
		this.write({ type: "typing", active: false });
	}

	async sendImmediate(text: string, _replyToMessageId?: string): Promise<string> {
		this.write({ type: "delta", text });
		return "";
	}

	async send(text: string, _attachmentPaths?: string[], _signal?: AbortSignal, _replyToMessageId?: string): Promise<string> {
		this.doneSent = true;
		this.write({ type: "done", text });
		return "";
	}
}

// ─── IPC Server ─────────────────────────────────────────────────────────────

export interface WebIPCLogger {
	info(msg: string): void;
	warn(msg: string): void;
	error(msg: string): void;
}

/**
 * Factory provided by runner.ts to create per-conversation workers without
 * introducing a circular dependency (web-ipc-server ↔ runner).
 */
export type WebWorkerFactory = (conversationId: string) => Promise<GatewayConversationEndpoint & { disconnect(): Promise<void> }>;

export interface WebIPCServerOptions {
	agentDir: string;
	logger: WebIPCLogger;
	createWorker: WebWorkerFactory;
}

interface IpcMessage {
	type: "chat" | "abort" | "dispose" | "ping";
	conversationId?: string;
	text?: string;
	userId?: string;
	model?: string;
}

export class WebIPCServer {
	private readonly opts: WebIPCServerOptions;
	private server: Server | null;
	private workers: Map<string, GatewayConversationEndpoint & { disconnect(): Promise<void> }>;
	private abortControllers: Map<string, AbortController>;

	constructor(opts: WebIPCServerOptions) {
		this.opts = opts;
		this.server = null;
		this.workers = new Map();
		this.abortControllers = new Map();
	}

	async start(): Promise<void> {
		const socketPath = getWebIpcSocketPath(this.opts.agentDir);

		// Remove stale socket file from a previous run
		if (existsSync(socketPath)) {
			await unlink(socketPath).catch(() => undefined);
		}

		await mkdir(this.opts.agentDir, { recursive: true });

		this.server = createServer((socket) => {
			let buffer = "";
			socket.setEncoding("utf-8");

			const writeLine = (line: string) => {
				if (!socket.writable) return;
				try {
					socket.write(line + "\n");
				} catch {
					// ignore
				}
			};

			const writeError = (message: string) => {
				writeLine(JSON.stringify({ type: "error", message }));
			};

			socket.on("data", (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let msg: IpcMessage;
					try {
						msg = JSON.parse(trimmed) as IpcMessage;
					} catch {
						writeError("Invalid JSON");
						continue;
					}
					void this.handleMessage(msg, writeLine, writeError).catch((err: unknown) => {
						writeError(err instanceof Error ? err.message : String(err));
					});
				}
			});

			socket.on("error", () => undefined);
		});

		await new Promise<void>((resolve, reject) => {
			this.server!.listen(socketPath, () => resolve());
			this.server!.once("error", reject);
		});

		this.opts.logger.info(`[web-ipc] listening on ${socketPath}`);
	}

	private async handleMessage(
		msg: IpcMessage,
		writeLine: (line: string) => void,
		writeError: (message: string) => void,
	): Promise<void> {
		if (msg.type === "ping") {
			writeLine(JSON.stringify({ type: "pong" }));
			return;
		}

		const conversationId = msg.conversationId;
		if (!conversationId) {
			writeError("conversationId required");
			return;
		}

		if (msg.type === "abort") {
			this.abortControllers.get(conversationId)?.abort();
			// Also abort the gateway worker's in-flight LLM call so it doesn't
			// keep running after the IPC client disconnects.
			this.workers.get(conversationId)?.abortActive?.();
			return;
		}

		if (msg.type === "dispose") {
			const worker = this.workers.get(conversationId);
			if (worker) {
				await worker.disconnect();
				this.workers.delete(conversationId);
			}
			return;
		}

		if (msg.type === "chat") {
			const text = msg.text ?? "";
			const userId = msg.userId ?? "web-user";

			// Create the transport BEFORE any async work so close() can always
			// be called to send the 'done' frame, even if getOrCreateWorker throws
			// (BUG-002: transport missing when getOrCreateWorker fails).
			const transport = new WebIPCTransport(writeLine);
			let worker: GatewayConversationEndpoint & { disconnect(): Promise<void> };
			try {
				worker = await this.getOrCreateWorker(conversationId);
			} catch (err) {
				transport.close();
				throw err;
			}

			// If the worker is still processing a previous turn, abort it so the
			// new message isn't silently queued while the transport is closed.
			// This prevents stale inFlight state (from a previous hung/slow LLM
			// call) from causing the next message to get an empty auto-done.
			worker.abortActive?.();

			const abortController = new AbortController();
			this.abortControllers.set(conversationId, abortController);

			worker.setTransport(transport);

			const input: InboundMessageInput = {
				text,
				userId,
				userName: "Web User",
				chatType: "dm",
				chatId: conversationId,
				chatName: `Web / ${conversationId}`,
				messageId: `web_${Date.now()}`,
				mentionedBot: true,
			};

			try {
				await worker.onMessage(input);
			} finally {
				transport.close();
				this.abortControllers.delete(conversationId);
			}
		}
	}

	private async getOrCreateWorker(
		conversationId: string,
	): Promise<GatewayConversationEndpoint & { disconnect(): Promise<void> }> {
		const existing = this.workers.get(conversationId);
		if (existing) return existing;

		const worker = await this.opts.createWorker(conversationId);
		this.workers.set(conversationId, worker);
		this.opts.logger.info(`[web-ipc] created worker for web/${conversationId}`);
		return worker;
	}

	async stop(): Promise<void> {
		await Promise.allSettled([...this.workers.values()].map((w) => w.disconnect()));
		this.workers.clear();
		if (this.server) {
			await new Promise<void>((resolve) => this.server!.close(() => resolve()));
			this.server = null;
		}
		const socketPath = getWebIpcSocketPath(this.opts.agentDir);
		await unlink(socketPath).catch(() => undefined);
		this.opts.logger.info("[web-ipc] stopped");
	}
}
