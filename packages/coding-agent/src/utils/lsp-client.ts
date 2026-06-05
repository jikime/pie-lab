import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

export interface LspTextEdit {
	range: LspRange;
	newText: string;
}

export interface LspTextDocumentEdit {
	textDocument: {
		uri: string;
		version?: number | null;
	};
	edits: LspTextEdit[];
}

export interface LspWorkspaceEdit {
	changes?: Record<string, LspTextEdit[]>;
	documentChanges?: LspTextDocumentEdit[];
}

export interface LspCodeAction {
	title: string;
	kind?: string;
	diagnostics?: LspDiagnostic[];
	edit?: LspWorkspaceEdit;
	command?: unknown;
}

export interface LspClientStatus {
	cwd: string;
	running: boolean;
	initialized: boolean;
	openDocuments: number;
	diagnosticFiles: number;
}

export interface LspClientLike {
	start(): Promise<void>;
	hover(filePath: string, line: number, character: number): Promise<unknown>;
	definition(filePath: string, line: number, character: number): Promise<unknown>;
	references(filePath: string, line: number, character: number): Promise<unknown>;
	diagnostics(filePath: string, timeoutMs?: number): Promise<LspDiagnostic[]>;
	rename(filePath: string, line: number, character: number, newName: string): Promise<LspWorkspaceEdit | null>;
	codeActions(filePath: string, line: number, character: number): Promise<LspCodeAction[]>;
	capabilities(): unknown;
	status(): LspClientStatus;
	shutdown(): Promise<void>;
}

export class LspClient {
	private process: ReturnType<typeof spawn> | null = null;
	private messageBuffer = "";
	private nextId = 1;
	private pendingRequests = new Map<number, PendingRequest>();
	private initialized = false;
	private cwd: string;
	private serverCapabilities: unknown;
	private openDocuments = new Set<string>();
	private documentVersions = new Map<string, number>();
	private diagnosticsByUri = new Map<string, LspDiagnostic[]>();

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
			return;
		}

		if ("method" in response && response.method === "textDocument/publishDiagnostics") {
			const params = "params" in response ? response.params : undefined;
			if (!params || typeof params !== "object") return;
			const uri = "uri" in params && typeof params.uri === "string" ? params.uri : undefined;
			const diagnostics = "diagnostics" in params && Array.isArray(params.diagnostics) ? params.diagnostics : [];
			if (!uri) return;
			this.diagnosticsByUri.set(uri, diagnostics.filter(isLspDiagnostic));
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
		const uri = pathToFileURL(filePath).href;
		if (this.openDocuments.has(uri)) return;
		this.openDocuments.add(uri);
		this.documentVersions.set(uri, 1);
		this.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: getLanguageId(filePath),
				version: 1,
				text: readFileSync(filePath, "utf-8"),
			},
		});
	}

	private closeDocument(filePath: string): void {
		const uri = pathToFileURL(filePath).href;
		if (!this.openDocuments.has(uri)) return;
		this.openDocuments.delete(uri);
		this.documentVersions.delete(uri);
		this.sendNotification("textDocument/didClose", {
			textDocument: { uri },
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
			this.serverCapabilities = result.capabilities;
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

	async diagnostics(filePath: string, timeoutMs = 500): Promise<LspDiagnostic[]> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		this.diagnosticsByUri.delete(uri);
		this.sendNotification("textDocument/didSave", {
			textDocument: { uri },
			text: readFileSync(filePath, "utf-8"),
		});
		return await this.waitForDiagnostics(uri, timeoutMs);
	}

	async rename(filePath: string, line: number, character: number, newName: string): Promise<LspWorkspaceEdit | null> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		try {
			const result = await this.sendRequest("textDocument/rename", {
				textDocument: { uri },
				position: { line: line - 1, character: character - 1 },
				newName,
			});
			return isLspWorkspaceEdit(result) ? result : null;
		} finally {
			this.closeDocument(filePath);
		}
	}

	async codeActions(filePath: string, line: number, character: number): Promise<LspCodeAction[]> {
		const uri = pathToFileURL(filePath).href;
		this.openDocument(filePath);
		try {
			const diagnostics = this.diagnosticsByUri.get(uri) ?? [];
			const position = { line: line - 1, character: character - 1 };
			const result = await this.sendRequest("textDocument/codeAction", {
				textDocument: { uri },
				range: { start: position, end: position },
				context: { diagnostics },
			});
			return Array.isArray(result) ? result.filter(isLspCodeAction) : [];
		} finally {
			this.closeDocument(filePath);
		}
	}

	capabilities(): unknown {
		return this.serverCapabilities ?? {};
	}

	status(): LspClientStatus {
		return {
			cwd: this.cwd,
			running: this.process !== null,
			initialized: this.initialized,
			openDocuments: this.openDocuments.size,
			diagnosticFiles: this.diagnosticsByUri.size,
		};
	}

	private async waitForDiagnostics(uri: string, timeoutMs: number): Promise<LspDiagnostic[]> {
		const startedAt = Date.now();
		while (!this.diagnosticsByUri.has(uri) && Date.now() - startedAt < timeoutMs) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return this.diagnosticsByUri.get(uri) ?? [];
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
		this.serverCapabilities = undefined;
		this.openDocuments.clear();
		this.documentVersions.clear();
	}
}

function isLspPosition(value: unknown): value is LspPosition {
	return (
		!!value &&
		typeof value === "object" &&
		"line" in value &&
		typeof value.line === "number" &&
		"character" in value &&
		typeof value.character === "number"
	);
}

function isLspRange(value: unknown): value is LspRange {
	return (
		!!value &&
		typeof value === "object" &&
		"start" in value &&
		isLspPosition(value.start) &&
		"end" in value &&
		isLspPosition(value.end)
	);
}

function isLspDiagnostic(value: unknown): value is LspDiagnostic {
	return (
		!!value &&
		typeof value === "object" &&
		"range" in value &&
		isLspRange(value.range) &&
		"message" in value &&
		typeof value.message === "string"
	);
}

function isLspTextEdit(value: unknown): value is LspTextEdit {
	return !!value && typeof value === "object" && "range" in value && isLspRange(value.range) && "newText" in value;
}

function isLspWorkspaceEdit(value: unknown): value is LspWorkspaceEdit {
	return (
		!!value &&
		typeof value === "object" &&
		(("changes" in value && typeof value.changes === "object") ||
			("documentChanges" in value && Array.isArray(value.documentChanges)))
	);
}

function isLspCodeAction(value: unknown): value is LspCodeAction {
	return !!value && typeof value === "object" && "title" in value && typeof value.title === "string";
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
const clientsByCwd = new Map<string, LspClient>();

export function getOrCreateLspClient(cwd: string): LspClient {
	const existing = clientsByCwd.get(cwd);
	if (existing) {
		return existing;
	}
	const client = new LspClient(cwd);
	clientsByCwd.set(cwd, client);
	return client;
}

export async function closeLspClient(): Promise<void> {
	await Promise.all([...clientsByCwd.values()].map((client) => client.shutdown()));
	clientsByCwd.clear();
}

export function applyWorkspaceEdit(edit: LspWorkspaceEdit): string[] {
	const editsByPath = new Map<string, LspTextEdit[]>();
	if (edit.changes) {
		for (const [uri, edits] of Object.entries(edit.changes)) {
			editsByPath.set(fileURLToPath(uri), edits.filter(isLspTextEdit));
		}
	}
	if (edit.documentChanges) {
		for (const change of edit.documentChanges) {
			if (!change || !("textDocument" in change) || !("edits" in change)) continue;
			editsByPath.set(fileURLToPath(change.textDocument.uri), change.edits.filter(isLspTextEdit));
		}
	}

	const applied: string[] = [];
	for (const [filePath, edits] of editsByPath) {
		if (!existsSync(filePath) || edits.length === 0) continue;
		const current = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const updated = applyTextEdits(current, edits);
		writeFileSync(filePath, updated, "utf-8");
		applied.push(filePath);
	}
	return applied;
}

function applyTextEdits(text: string, edits: LspTextEdit[]): string {
	const lineOffsets = getLineOffsets(text);
	const sorted = [...edits].sort((a, b) => {
		const aOffset = positionToOffset(lineOffsets, a.range.start);
		const bOffset = positionToOffset(lineOffsets, b.range.start);
		return bOffset - aOffset;
	});
	let result = text;
	for (const edit of sorted) {
		const start = positionToOffset(lineOffsets, edit.range.start);
		const end = positionToOffset(lineOffsets, edit.range.end);
		result = `${result.slice(0, start)}${edit.newText}${result.slice(end)}`;
	}
	return result;
}

function getLineOffsets(text: string): number[] {
	const offsets = [0];
	for (let index = 0; index < text.length; index++) {
		if (text[index] === "\n") {
			offsets.push(index + 1);
		}
	}
	return offsets;
}

function positionToOffset(lineOffsets: number[], position: LspPosition): number {
	const lineOffset = lineOffsets[position.line] ?? lineOffsets[lineOffsets.length - 1] ?? 0;
	const nextLineOffset = lineOffsets[position.line + 1] ?? Number.POSITIVE_INFINITY;
	return Math.min(lineOffset + position.character, nextLineOffset);
}
