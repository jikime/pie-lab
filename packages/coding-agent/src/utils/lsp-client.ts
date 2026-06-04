import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

interface JsonRpcError {
	message?: unknown;
}

interface JsonRpcResponse {
	id?: unknown;
	result?: unknown;
	error?: JsonRpcError;
}

interface InitializeResult {
	capabilities?: unknown;
}

export class LspClient {
	private process: ReturnType<typeof spawn> | null = null;
	private messageBuffer = "";
	private nextId = 1;
	private pendingRequests = new Map<number, PendingRequest>();
	private initialized = false;
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async start(): Promise<void> {
		if (this.process) return;

		this.process = spawn("typescript-language-server", ["--stdio"], {
			cwd: this.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Handle stdout
		this.process.stdout?.on("data", (chunk: Buffer) => {
			this.messageBuffer += chunk.toString("utf-8");
			this.processMessages();
		});

		// Handle stderr (log warnings)
		this.process.stderr?.on("data", (chunk: Buffer) => {
			console.warn(`[LSP] ${chunk.toString("utf-8")}`);
		});

		this.process.on("error", (error) => {
			this.failPendingRequests(error instanceof Error ? error : new Error(String(error)));
			this.process = null;
			this.initialized = false;
		});

		// Handle process exit
		this.process.on("exit", (code) => {
			this.failPendingRequests(new Error(`LSP server exited with code ${code}`));
			this.process = null;
			this.initialized = false;
			console.warn(`[LSP] Server exited with code ${code}`);
		});

		// Initialize
		await this.initialize();
	}

	private processMessages(): void {
		while (true) {
			const headerEnd = this.messageBuffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const headerSection = this.messageBuffer.substring(0, headerEnd);
			const contentLength = this.parseContentLength(headerSection);

			if (contentLength === -1) {
				// Invalid header, skip
				this.messageBuffer = this.messageBuffer.substring(headerEnd + 4);
				continue;
			}

			const bodyStart = headerEnd + 4;
			const bodyEnd = bodyStart + contentLength;

			if (this.messageBuffer.length < bodyEnd) break;

			const body = this.messageBuffer.substring(bodyStart, bodyEnd);
			this.messageBuffer = this.messageBuffer.substring(bodyEnd);

			try {
				const message = JSON.parse(body) as unknown;
				this.handleMessage(message);
			} catch (e) {
				console.warn(`[LSP] Failed to parse message: ${e}`);
			}
		}
	}

	private parseContentLength(header: string): number {
		const match = header.match(/Content-Length: (\d+)/);
		return match ? parseInt(match[1], 10) : -1;
	}

	private handleMessage(message: unknown): void {
		if (!message || typeof message !== "object") return;
		const response = message as JsonRpcResponse;
		if (typeof response.id === "number" && this.pendingRequests.has(response.id)) {
			const pending = this.pendingRequests.get(response.id);
			if (!pending) return;
			this.pendingRequests.delete(response.id);
			clearTimeout(pending.timeout);

			if (response.error) {
				const messageText =
					typeof response.error.message === "string" ? response.error.message : "LSP request failed";
				pending.reject(new Error(messageText));
			} else {
				pending.resolve(response.result);
			}
		}
	}

	private failPendingRequests(error: Error): void {
		for (const [id, pending] of this.pendingRequests) {
			this.pendingRequests.delete(id);
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
	}

	private sendMessage(message: Record<string, unknown>): void {
		if (!this.process || !this.process.stdin) {
			throw new Error("LSP server not running");
		}

		const body = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		this.process.stdin.write(header + body);
	}

	private async sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
		const id = this.nextId++;
		const message: Record<string, unknown> = {
			jsonrpc: "2.0",
			id,
			method,
		};
		if (params !== undefined) {
			message.params = params;
		}

		return new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`LSP request ${method} timed out`));
			}, 5000);

			this.pendingRequests.set(id, { resolve, reject, timeout });
			try {
				this.sendMessage(message);
			} catch (e) {
				this.pendingRequests.delete(id);
				clearTimeout(timeout);
				reject(e);
			}
		}) as Promise<T>;
	}

	private sendNotification(method: string, params?: unknown): void {
		this.sendMessage({
			jsonrpc: "2.0",
			method,
			...(params === undefined ? {} : { params }),
		});
	}

	private openDocument(filePath: string): void {
		this.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri: pathToFileURL(filePath).href,
				languageId: getLanguageId(filePath),
				version: 1,
				text: readFileSync(filePath, "utf-8"),
			},
		});
	}

	private closeDocument(filePath: string): void {
		this.sendNotification("textDocument/didClose", {
			textDocument: { uri: pathToFileURL(filePath).href },
		});
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		const result = await this.sendRequest<InitializeResult>("initialize", {
			processId: process.pid,
			rootPath: this.cwd,
			capabilities: {
				textDocument: {
					synchronization: {
						didSave: true,
					},
				},
			},
		});

		if (result?.capabilities) {
			this.initialized = true;
			this.sendNotification("initialized", {});
		}
	}

	async hover(filePath: string, line: number, character: number): Promise<unknown> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		try {
			return await this.sendRequest("textDocument/hover", {
				textDocument: { uri },
				position: { line: line - 1, character: character - 1 },
			});
		} finally {
			this.closeDocument(filePath);
		}
	}

	async definition(filePath: string, line: number, character: number): Promise<unknown> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		try {
			return await this.sendRequest("textDocument/definition", {
				textDocument: { uri },
				position: { line: line - 1, character: character - 1 },
			});
		} finally {
			this.closeDocument(filePath);
		}
	}

	async references(filePath: string, line: number, character: number): Promise<unknown> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		try {
			return await this.sendRequest("textDocument/references", {
				textDocument: { uri },
				position: { line: line - 1, character: character - 1 },
				context: { includeDeclaration: true },
			});
		} finally {
			this.closeDocument(filePath);
		}
	}

	async shutdown(): Promise<void> {
		if (!this.process) return;

		try {
			await this.sendRequest("shutdown", {});
			this.sendNotification("exit", {});
		} catch (_e) {
			// Ignore errors during shutdown
		}

		if (this.process.stdin) {
			this.process.stdin.destroy();
		}
		this.process.kill();
		this.process = null;
		this.initialized = false;
	}
}

function getLanguageId(filePath: string): string {
	switch (extname(filePath).toLowerCase()) {
		case ".js":
		case ".mjs":
		case ".cjs":
			return "javascript";
		case ".jsx":
			return "javascriptreact";
		case ".tsx":
			return "typescriptreact";
		default:
			return "typescript";
	}
}

// Global client instance
let globalClient: LspClient | null = null;

export function getOrCreateLspClient(cwd: string): LspClient {
	if (!globalClient) {
		globalClient = new LspClient(cwd);
	}
	return globalClient;
}

export async function closeLspClient(): Promise<void> {
	if (globalClient) {
		await globalClient.shutdown();
		globalClient = null;
	}
}
