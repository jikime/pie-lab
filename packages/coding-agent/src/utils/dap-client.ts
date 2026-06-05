import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

interface ExecFileFailure {
	code?: unknown;
	stdout?: unknown;
	stderr?: unknown;
	message?: unknown;
}

export interface DebugResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface DapBreakpoint {
	file: string;
	line: number;
}

export interface DapLaunchOptions {
	sessionId: string;
	adapterCommand: string;
	adapterArgs?: string[];
	program: string;
	args?: string[];
	breakpoints?: DapBreakpoint[];
}

export interface DapSessionResult {
	sessionId: string;
	initialized: boolean;
	output: string[];
	stoppedReason?: string;
	exited?: boolean;
}

export interface DapClientLike {
	launch(scriptPath: string, args?: string[]): Promise<DebugResult>;
	startSession(options: DapLaunchOptions): Promise<DapSessionResult>;
	setBreakpoints(sessionId: string, file: string, lines: number[]): Promise<unknown>;
	continue(sessionId: string, threadId?: number): Promise<unknown>;
	stackTrace(sessionId: string, threadId?: number): Promise<unknown>;
	scopes(sessionId: string, frameId: number): Promise<unknown>;
	variables(sessionId: string, variablesReference: number): Promise<unknown>;
	evaluate(sessionId: string, expression: string, frameId?: number): Promise<unknown>;
	disconnect(sessionId: string): Promise<void>;
	status(): DapStatus[];
	disconnectAll(): Promise<void>;
}

export interface DapStatus {
	sessionId: string;
	running: boolean;
	outputEvents: number;
	stoppedReason?: string;
}

interface PendingDapRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout: NodeJS.Timeout;
}

interface DapProtocolMessage {
	type?: unknown;
	seq?: unknown;
	command?: unknown;
	event?: unknown;
	request_seq?: unknown;
	success?: unknown;
	message?: unknown;
	body?: unknown;
}

class DapAdapterSession {
	readonly sessionId: string;
	readonly output: string[] = [];
	stoppedReason: string | undefined;
	exited = false;

	#process: ReturnType<typeof spawn> | null = null;
	#buffer = "";
	#nextSeq = 1;
	#pending = new Map<number, PendingDapRequest>();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	start(command: string, args: string[], cwd: string): void {
		if (this.#process) return;
		this.#process = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
		this.#process.stdout?.on("data", (chunk: Buffer) => {
			this.#buffer += chunk.toString("utf-8");
			this.#processMessages();
		});
		this.#process.stderr?.on("data", (chunk: Buffer) => {
			this.output.push(chunk.toString("utf-8"));
		});
		this.#process.on("exit", () => {
			this.exited = true;
			this.#failPending(new Error(`DAP adapter ${this.sessionId} exited`));
		});
		this.#process.on("error", (error) => {
			this.exited = true;
			this.#failPending(error instanceof Error ? error : new Error(String(error)));
		});
	}

	async request(command: string, args?: unknown, timeoutMs = 5000): Promise<unknown> {
		const seq = this.#nextSeq++;
		const message: Record<string, unknown> = { seq, type: "request", command };
		if (args !== undefined) {
			message.arguments = args;
		}

		return await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.#pending.delete(seq);
				reject(new Error(`DAP request ${command} timed out`));
			}, timeoutMs);
			this.#pending.set(seq, { resolve, reject, timeout });
			try {
				this.#send(message);
			} catch (error) {
				this.#pending.delete(seq);
				clearTimeout(timeout);
				reject(error);
			}
		});
	}

	notification(command: string, args?: unknown): void {
		this.#send({
			seq: this.#nextSeq++,
			type: "event",
			command,
			...(args === undefined ? {} : { arguments: args }),
		});
	}

	async disconnect(): Promise<void> {
		if (!this.#process) return;
		try {
			await this.request("disconnect", { terminateDebuggee: true }, 1000);
		} catch {}
		this.#process.kill();
		this.#process = null;
		this.#failPending(new Error("DAP session disconnected"));
	}

	get running(): boolean {
		return this.#process !== null && !this.exited;
	}

	#send(message: Record<string, unknown>): void {
		if (!this.#process?.stdin) {
			throw new Error("DAP adapter is not running");
		}
		const body = JSON.stringify(message);
		this.#process.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	}

	#processMessages(): void {
		while (true) {
			const headerEnd = this.#buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;
			const header = this.#buffer.slice(0, headerEnd);
			const match = header.match(/Content-Length: (\d+)/i);
			if (!match) {
				this.#buffer = this.#buffer.slice(headerEnd + 4);
				continue;
			}
			const bodyStart = headerEnd + 4;
			const bodyEnd = bodyStart + Number(match[1]);
			if (this.#buffer.length < bodyEnd) break;
			const body = this.#buffer.slice(bodyStart, bodyEnd);
			this.#buffer = this.#buffer.slice(bodyEnd);
			try {
				this.#handleMessage(JSON.parse(body) as DapProtocolMessage);
			} catch {}
		}
	}

	#handleMessage(message: DapProtocolMessage): void {
		if (message.type === "response" && typeof message.request_seq === "number") {
			const pending = this.#pending.get(message.request_seq);
			if (!pending) return;
			this.#pending.delete(message.request_seq);
			clearTimeout(pending.timeout);
			if (message.success === false) {
				pending.reject(new Error(typeof message.message === "string" ? message.message : "DAP request failed"));
			} else {
				pending.resolve(message.body);
			}
			return;
		}

		if (message.type === "event" && message.event === "output") {
			const output = getObjectString(message.body, "output");
			if (output) this.output.push(output);
			return;
		}
		if (message.type === "event" && message.event === "stopped") {
			this.stoppedReason = getObjectString(message.body, "reason") ?? "stopped";
			return;
		}
		if (message.type === "event" && (message.event === "terminated" || message.event === "exited")) {
			this.exited = true;
		}
	}

	#failPending(error: Error): void {
		for (const [seq, pending] of this.#pending) {
			this.#pending.delete(seq);
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
	}
}

export class DapClient {
	private cwd: string;
	private sessions = new Map<string, DapAdapterSession>();

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async launch(scriptPath: string, args?: string[]): Promise<DebugResult> {
		try {
			const { stdout, stderr } = (await execFile("node", [scriptPath, ...(args ?? [])], {
				cwd: this.cwd,
				encoding: "utf-8",
				timeout: 30000,
				maxBuffer: 10 * 1024 * 1024,
			})) as { stdout: string; stderr: string };

			return {
				exitCode: 0,
				stdout,
				stderr,
			};
		} catch (error) {
			const failure = error as ExecFileFailure;
			return {
				exitCode: typeof failure.code === "number" ? failure.code : 1,
				stdout: typeof failure.stdout === "string" ? failure.stdout : "",
				stderr:
					typeof failure.stderr === "string"
						? failure.stderr
						: typeof failure.message === "string"
							? failure.message
							: String(error),
			};
		}
	}

	async startSession(options: DapLaunchOptions): Promise<DapSessionResult> {
		if (this.sessions.has(options.sessionId)) {
			throw new Error(`DAP session already exists: ${options.sessionId}`);
		}
		const session = new DapAdapterSession(options.sessionId);
		this.sessions.set(options.sessionId, session);
		session.start(options.adapterCommand, options.adapterArgs ?? [], this.cwd);

		await session.request("initialize", {
			adapterID: "pie",
			linesStartAt1: true,
			columnsStartAt1: true,
			pathFormat: "path",
		});

		for (const [file, lines] of groupBreakpoints(options.breakpoints ?? [])) {
			await this.setBreakpoints(options.sessionId, file, lines);
		}

		await session.request("launch", {
			program: options.program,
			args: options.args ?? [],
			cwd: this.cwd,
			noDebug: false,
		});
		try {
			await session.request("configurationDone", {});
		} catch {}

		return {
			sessionId: options.sessionId,
			initialized: true,
			output: [...session.output],
			stoppedReason: session.stoppedReason,
			exited: session.exited,
		};
	}

	async setBreakpoints(sessionId: string, file: string, lines: number[]): Promise<unknown> {
		return await this.getSession(sessionId).request("setBreakpoints", {
			source: { path: file },
			breakpoints: lines.map((line) => ({ line })),
		});
	}

	async continue(sessionId: string, threadId = 1): Promise<unknown> {
		return await this.getSession(sessionId).request("continue", { threadId });
	}

	async stackTrace(sessionId: string, threadId = 1): Promise<unknown> {
		return await this.getSession(sessionId).request("stackTrace", { threadId });
	}

	async scopes(sessionId: string, frameId: number): Promise<unknown> {
		return await this.getSession(sessionId).request("scopes", { frameId });
	}

	async variables(sessionId: string, variablesReference: number): Promise<unknown> {
		return await this.getSession(sessionId).request("variables", { variablesReference });
	}

	async evaluate(sessionId: string, expression: string, frameId?: number): Promise<unknown> {
		return await this.getSession(sessionId).request("evaluate", {
			expression,
			...(frameId === undefined ? {} : { frameId }),
			context: "repl",
		});
	}

	async disconnect(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		await session.disconnect();
		this.sessions.delete(sessionId);
	}

	status(): DapStatus[] {
		return [...this.sessions.values()].map((session) => ({
			sessionId: session.sessionId,
			running: session.running,
			outputEvents: session.output.length,
			stoppedReason: session.stoppedReason,
		}));
	}

	async disconnectAll(): Promise<void> {
		await Promise.all([...this.sessions.keys()].map((sessionId) => this.disconnect(sessionId)));
	}

	private getSession(sessionId: string): DapAdapterSession {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`DAP session not found: ${sessionId}`);
		}
		return session;
	}
}

function getObjectString(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object" || !(key in value)) return undefined;
	const field = value[key as keyof typeof value];
	return typeof field === "string" ? field : undefined;
}

function groupBreakpoints(breakpoints: DapBreakpoint[]): Map<string, number[]> {
	const grouped = new Map<string, number[]>();
	for (const breakpoint of breakpoints) {
		const lines = grouped.get(breakpoint.file) ?? [];
		lines.push(breakpoint.line);
		grouped.set(breakpoint.file, lines);
	}
	return grouped;
}

const clientsByCwd = new Map<string, DapClient>();

export function getOrCreateDapClient(cwd: string): DapClient {
	const existing = clientsByCwd.get(cwd);
	if (existing) return existing;
	const client = new DapClient(cwd);
	clientsByCwd.set(cwd, client);
	return client;
}

export async function closeDapClient(): Promise<void> {
	await Promise.all([...clientsByCwd.values()].map((client) => client.disconnectAll()));
	clientsByCwd.clear();
}
