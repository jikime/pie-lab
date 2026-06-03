import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
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

		// Handle process exit
		this.process.on("exit", (code) => {
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
				const message = JSON.parse(body);
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

	private handleMessage(message: any): void {
		if (message.id && this.pendingRequests.has(message.id)) {
			const pending = this.pendingRequests.get(message.id)!;
			this.pendingRequests.delete(message.id);
			clearTimeout(pending.timeout);

			if (message.error) {
				pending.reject(new Error(message.error.message));
			} else {
				pending.resolve(message.result);
			}
		}
	}

	private sendMessage(message: any): void {
		if (!this.process || !this.process.stdin) {
			throw new Error("LSP server not running");
		}

		const body = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
		this.process.stdin.write(header + body);
	}

	private async sendRequest(method: string, params?: any): Promise<any> {
		const id = this.nextId++;
		const message = {
			jsonrpc: "2.0",
			id,
			method,
			...(params && { params }),
		};

		return new Promise((resolve, reject) => {
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
		});
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		const result = await this.sendRequest("initialize", {
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

		if (result && result.capabilities) {
			this.initialized = true;
			await this.sendRequest("initialized", {});
		}
	}

	async hover(filePath: string, line: number, character: number): Promise<any> {
		const uri = `file://${filePath}`;
		const content = readFileSync(filePath, "utf-8");

		// Open document
		await this.sendRequest("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "typescript",
				version: 1,
				text: content,
			},
		});

		// Request hover
		const result = await this.sendRequest("textDocument/hover", {
			textDocument: { uri },
			position: { line: line - 1, character: character - 1 },
		});

		// Close document
		await this.sendRequest("textDocument/didClose", {
			textDocument: { uri },
		});

		return result;
	}

	async definition(filePath: string, line: number, character: number): Promise<any> {
		const uri = `file://${filePath}`;
		const content = readFileSync(filePath, "utf-8");

		await this.sendRequest("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "typescript",
				version: 1,
				text: content,
			},
		});

		const result = await this.sendRequest("textDocument/definition", {
			textDocument: { uri },
			position: { line: line - 1, character: character - 1 },
		});

		await this.sendRequest("textDocument/didClose", {
			textDocument: { uri },
		});

		return result;
	}

	async references(filePath: string, line: number, character: number): Promise<any> {
		const uri = `file://${filePath}`;
		const content = readFileSync(filePath, "utf-8");

		await this.sendRequest("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: "typescript",
				version: 1,
				text: content,
			},
		});

		const result = await this.sendRequest("textDocument/references", {
			textDocument: { uri },
			position: { line: line - 1, character: character - 1 },
			context: { includeDeclaration: true },
		});

		await this.sendRequest("textDocument/didClose", {
			textDocument: { uri },
		});

		return result;
	}

	async shutdown(): Promise<void> {
		if (!this.process) return;

		try {
			await this.sendRequest("shutdown", {});
			await this.sendRequest("exit", {});
		} catch (e) {
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
