/**
 * web-ipc-client.ts
 *
 * IPC client used by the web chat API server to route messages through the
 * running gateway daemon.  Falls back gracefully when the gateway is not up.
 *
 * Usage:
 *   const client = new WebIPCClient(agentDir);
 *   const available = await client.probe();   // false → use standalone
 *   if (available) {
 *     const session = await client.createSession(conversationId, onEvent);
 *   }
 */

import { createConnection, Socket } from "node:net";
import { getWebIpcSocketPath } from "./web-ipc-server.js";

export type WebIPCEvent =
	| { type: "delta"; text: string }
	| { type: "done"; text?: string; sessionId?: string }
	| { type: "error"; message: string }
	| { type: "typing"; active: boolean }
	| { type: "pong" };

export interface WebIPCSessionOptions {
	conversationId: string;
	text: string;
	userId?: string;
	model?: string;
	onEvent: (event: WebIPCEvent) => void;
	signal?: AbortSignal;
}

/** How long to wait for initial IPC connection before declaring gateway absent. */
const CONNECT_TIMEOUT_MS = 300;

export class WebIPCClient {
	private readonly socketPath: string;

	constructor(agentDir: string) {
		this.socketPath = getWebIpcSocketPath(agentDir);
	}

	/**
	 * Quick non-destructive probe: returns true if the gateway IPC socket is
	 * reachable, false otherwise.  Never throws.
	 */
	async probe(): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const socket = createConnection({ path: this.socketPath });
			const timer = setTimeout(() => {
				socket.destroy();
				resolve(false);
			}, CONNECT_TIMEOUT_MS);

			socket.once("connect", () => {
				clearTimeout(timer);
				// Send a ping and wait for pong
				socket.write(JSON.stringify({ type: "ping" }) + "\n");
				let buf = "";
				socket.on("data", (chunk: Buffer) => {
					buf += chunk.toString("utf-8");
					const lines = buf.split("\n");
					buf = lines.pop() ?? "";
					for (const line of lines) {
						try {
							const msg = JSON.parse(line.trim()) as { type: string };
							if (msg.type === "pong") {
								socket.destroy();
								resolve(true);
								return;
							}
						} catch {
							// ignore
						}
					}
				});
			});

			socket.once("error", () => {
				clearTimeout(timer);
				resolve(false);
			});
		});
	}

	/**
	 * Send one chat message, streaming events back via onEvent.
	 * Resolves when the server sends "done" or "error".
	 * Rejects if the socket disconnects unexpectedly.
	 */
	async sendMessage(opts: WebIPCSessionOptions): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let socket: Socket;
			let settled = false;

			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				fn();
				socket?.destroy();
			};

			try {
				socket = createConnection({ path: this.socketPath });
			} catch (err) {
				reject(err);
				return;
			}

			const connectTimer = setTimeout(() => {
				settle(() => reject(new Error("Gateway IPC connection timed out")));
			}, CONNECT_TIMEOUT_MS);

			opts.signal?.addEventListener("abort", () => {
				if (!settled) {
					socket.write(JSON.stringify({ type: "abort", conversationId: opts.conversationId }) + "\n");
					settle(() => resolve());
				}
			});

			socket.once("connect", () => {
				clearTimeout(connectTimer);
				socket.setEncoding("utf-8");

				// Send the chat request
				socket.write(
					JSON.stringify({
						type: "chat",
						conversationId: opts.conversationId,
						text: opts.text,
						userId: opts.userId ?? "web-user",
						model: opts.model,
					}) + "\n",
				);
			});

			let buffer = "";
			socket.on("data", (chunk) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					let event: WebIPCEvent;
					try {
						event = JSON.parse(trimmed) as WebIPCEvent;
					} catch {
						continue;
					}
					opts.onEvent(event);
					if (event.type === "done") settle(() => resolve());
					if (event.type === "error") settle(() => reject(new Error(event.message)));
				}
			});

			socket.once("end", () => settle(() => resolve()));
			socket.once("error", (err) => settle(() => reject(err)));
		});
	}
}
