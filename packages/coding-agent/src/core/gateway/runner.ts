import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { UsageStore } from "@pie-lab/storage";
import { getAgentDir } from "../../config.ts";
import { createAgentSessionFromServices, createAgentSessionServices, type AgentSessionServices } from "../agent-session-services.ts";
import type { AgentSession } from "../agent-session.ts";
import { CronJobStore, tickCronScheduler } from "../scheduler/index.ts";
import { SessionManager } from "../session-manager.ts";
import { SettingsManager } from "../settings-manager.ts";
import { startGatewayChatAdapters, type GatewayAdapter, type GatewayCheckpoint, type GatewayConversationEndpoint, type GatewayTransport } from "./adapters.ts";
import { ensureChatHome, listConfiguredConversations, loadChatConfig } from "./chat/config.js";
import type { InboundMessageInput, ResolvedConversation } from "./chat/types.js";
import { ConversationRuntime } from "./chat/runtime.js";
import { buildGatewaySystemPrompt } from "./prompt.ts";
import { createGatewayChatTools } from "./tools.ts";

export interface GatewayLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export interface RunGatewayOptions {
	cwd?: string;
	agentDir?: string;
	logger?: GatewayLogger;
}

export interface GatewayStatus {
	pid?: number;
	running: boolean;
	pidPath: string;
	configuredConversations: number;
	conversations: Array<{ id: string; name: string; service: string }>;
}

const GATEWAY_DIR_NAME = "gateway";

function defaultLogger(): GatewayLogger {
	return {
		info: (message) => console.log(message),
		warn: (message) => console.warn(message),
		error: (message) => console.error(message),
	};
}

function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function getGatewayDir(agentDir = getAgentDir()): string {
	return join(agentDir, GATEWAY_DIR_NAME);
}

export function getGatewayPidPath(agentDir = getAgentDir()): string {
	return join(getGatewayDir(agentDir), "pid");
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code =
			error && typeof error === "object" && "code" in error ? String((error as { code?: string }).code) : undefined;
		return code === "EPERM";
	}
}

export async function readGatewayPid(agentDir = getAgentDir()): Promise<number | undefined> {
	try {
		const raw = (await readFile(getGatewayPidPath(agentDir), "utf8")).trim();
		const pid = Number(raw);
		return Number.isFinite(pid) ? pid : undefined;
	} catch {
		return undefined;
	}
}

export async function readGatewayStatus(options: { agentDir?: string } = {}): Promise<GatewayStatus> {
	const agentDir = options.agentDir ?? getAgentDir();
	const pid = await readGatewayPid(agentDir);
	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config).map((conversation) => ({
		id: conversation.conversationId,
		name: conversation.conversationName,
		service: conversation.service,
	}));
	return {
		pid,
		running: pid !== undefined && isPidAlive(pid),
		pidPath: getGatewayPidPath(agentDir),
		configuredConversations: conversations.length,
		conversations,
	};
}

async function writeGatewayPid(agentDir: string): Promise<void> {
	await mkdir(getGatewayDir(agentDir), { recursive: true });
	await writeFile(getGatewayPidPath(agentDir), `${process.pid}\n`, "utf8");
}

async function removeGatewayPid(agentDir: string): Promise<void> {
	const pid = await readGatewayPid(agentDir);
	if (pid === process.pid) {
		await rm(getGatewayPidPath(agentDir), { force: true });
	}
}

function extractAssistantSummary(messages: unknown[]): { text?: string; stopReason?: string; errorMessage?: string } {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || typeof message !== "object") continue;
		const value = message as Record<string, unknown>;
		if (value.role !== "assistant") continue;
		const stopReason = typeof value.stopReason === "string" ? value.stopReason : undefined;
		const errorMessage = typeof value.errorMessage === "string" ? value.errorMessage : undefined;
		const content = Array.isArray(value.content) ? value.content : [];
		const text = content
			.map((block) => {
				if (!block || typeof block !== "object") return "";
				const item = block as Record<string, unknown>;
				return item.type === "text" && typeof item.text === "string" ? item.text : "";
			})
			.filter(Boolean)
			.join("")
			.trim();
		return { text: text || undefined, stopReason, errorMessage };
	}
	return {};
}

function createGatewayUsageStore(base: UsageStore, conversation: ResolvedConversation): UsageStore {
	return {
		recordUsage: (record) =>
			base.recordUsage({
				...record,
				clientOrigin: record.clientOrigin ?? `pie-gateway:${conversation.service}`,
				endpoint: record.endpoint ?? `pie-gateway:${conversation.conversationId}`,
			}),
	};
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
	if (!signal) return new Promise(() => undefined);
	if (signal.aborted) return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
	return new Promise((_, reject) => {
		signal.addEventListener(
			"abort",
			() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
			{ once: true },
		);
	});
}

class GatewayConversationWorker implements GatewayConversationEndpoint {
	readonly conversation: ResolvedConversation;
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly logger: GatewayLogger;
	private readonly ownerId: string;
	private sessionDir: string;
	private runtimeValue?: ConversationRuntime;
	private transport?: GatewayTransport;
	private services?: AgentSessionServices;
	private sessionManager?: SessionManager;
	private session?: AgentSession;
	private inFlight = false;
	private typingInterval?: ReturnType<typeof setInterval>;
	private queuedAttachments: string[] = [];
	private activeAbort?: AbortController;

	constructor(options: { conversation: ResolvedConversation; cwd: string; agentDir: string; logger: GatewayLogger }) {
		this.conversation = options.conversation;
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.logger = options.logger;
		this.ownerId = `pie-gateway-${process.pid}-${randomUUID()}`;
		this.sessionDir = join(this.agentDir, "gateway", "sessions", sanitize(this.conversation.conversationId));
	}

	get runtime(): ConversationRuntime | undefined {
		return this.runtimeValue;
	}

	async start(): Promise<void> {
		this.runtimeValue = await ConversationRuntime.connect(this.conversation, this.ownerId);
		await mkdir(join(this.conversation.sharedDir, "skills"), { recursive: true });
		await mkdir(join(this.conversation.workspaceDir, "skills"), { recursive: true });
	}

	setTransport(transport: GatewayTransport): void {
		this.transport = transport;
	}

	getLastCheckpoint(): GatewayCheckpoint {
		return this.runtimeValue?.getLastCheckpoint() ?? {};
	}

	async onCaughtUp(): Promise<void> {
		this.runtimeValue?.armAfterCurrentTail();
		await this.tryDispatch();
	}

	async onError(error: Error): Promise<void> {
		await this.runtimeValue?.appendError(error.message);
		this.logger.warn(`[${this.conversation.conversationId}] ${error.message}`);
	}

	async onDisconnect(): Promise<void> {
		await this.onError(new Error("Gateway chat adapter disconnected."));
	}

	async onMessage(input: InboundMessageInput, checkpoint?: GatewayCheckpoint): Promise<void> {
		const runtime = this.runtimeValue;
		if (!runtime) return;
		if (runtime.isArmed()) {
			const control = runtime.parseControlCommand(input);
			if (control) {
				await this.handleControl(control);
				if (checkpoint) await runtime.noteCheckpoint(checkpoint);
				return;
			}
		}
		await runtime.ingestInbound(input, checkpoint);
		await this.tryDispatch();
	}

	private async handleControl(control: "stop" | "new" | "compact" | "status"): Promise<void> {
		if (control === "status") {
			await this.transport?.sendImmediate(this.formatStatus());
			return;
		}
		if (control === "stop") {
			if (!this.inFlight || !this.session) {
				await this.transport?.sendImmediate("No active turn.");
				return;
			}
			this.activeAbort?.abort();
			this.session.agent.abort();
			await this.transport?.sendImmediate("Aborted current turn.");
			return;
		}
		if (control === "compact") {
			if (!this.session) {
				await this.transport?.sendImmediate("No session to compact yet.");
				return;
			}
			try {
				await this.session.compact();
				await this.transport?.sendImmediate("Compaction completed.");
			} catch (error) {
				await this.transport?.sendImmediate(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}
		await this.resetSession();
		await this.transport?.sendImmediate("Started a new Pie gateway session.");
	}

	private formatStatus(): string {
		const status = this.runtimeValue?.getStatus();
		const model = this.session?.model ? `${this.session.model.provider}/${this.session.model.id}` : "not initialized";
		return [
			`Gateway: ${this.conversation.conversationName}`,
			`Model: ${model}`,
			`Queue: ${status?.queueLength ?? 0}${this.inFlight ? " active" : ""}`,
			`Records: ${status?.recordCount ?? 0}`,
			`Session: ${this.session?.sessionFile ?? "not initialized"}`,
		].join("\n");
	}

	private async ensureSession(): Promise<AgentSession> {
		if (this.session) return this.session;
		this.sessionManager = SessionManager.continueRecent(this.cwd, this.sessionDir);
		if (this.sessionManager.getBranch().length <= 1) {
			this.sessionManager.appendSessionInfo(`pie gateway ${this.conversation.conversationName}`);
		}
		this.services = await createAgentSessionServices({
			cwd: this.cwd,
			agentDir: this.agentDir,
			resourceLoaderOptions: {
				noExtensions: true,
				additionalSkillPaths: [
					join(this.conversation.sharedDir, "skills"),
					join(this.conversation.workspaceDir, "skills"),
				],
				appendSystemPromptOverride: (base) => [...base, buildGatewaySystemPrompt(this.conversation, this.cwd)],
			},
		});
		this.services.usageStore = createGatewayUsageStore(this.services.usageStore, this.conversation);
		const created = await createAgentSessionFromServices({
			services: this.services,
			sessionManager: this.sessionManager,
			sessionStartEvent: { type: "session_start", reason: "startup" },
			customTools: createGatewayChatTools({
				cwd: this.cwd,
				runtime: () => this.runtimeValue,
				isTurnActive: () => this.inFlight,
				queueAttachment: (path) => this.queuedAttachments.push(path),
			}),
			chatOrigin: this.conversation.conversationId,
		});
		this.session = created.session;
		return this.session;
	}

	private async resetSession(): Promise<void> {
		this.activeAbort?.abort();
		this.session?.agent.abort();
		this.session?.dispose();
		this.session = undefined;
		this.services = undefined;
		this.sessionManager = SessionManager.create(this.cwd, this.sessionDir);
		this.sessionManager.appendSessionInfo(`pie gateway ${this.conversation.conversationName}`);
		await this.ensureSession();
	}

	private startTypingLoop(): void {
		if (!this.transport || this.typingInterval) return;
		void this.transport.startTyping().catch(() => undefined);
		this.typingInterval = setInterval(() => {
			void this.transport?.startTyping().catch(() => undefined);
		}, 4000);
	}

	private stopTypingLoop(): void {
		if (this.typingInterval) {
			clearInterval(this.typingInterval);
			this.typingInterval = undefined;
		}
		void this.transport?.stopTyping().catch(() => undefined);
	}

	private async tryDispatch(): Promise<void> {
		const runtime = this.runtimeValue;
		if (!runtime || this.inFlight) return;
		const next = runtime.beginNextJob();
		if (!next) return;
		this.inFlight = true;
		this.queuedAttachments = [];
		const abortController = new AbortController();
		this.activeAbort = abortController;
		this.startTypingLoop();
		try {
			const session = await this.ensureSession();
			await session.reload();
			await session.prompt(next.prompt, {
				expandPromptTemplates: false,
				source: "extension",
			});
			const summary = extractAssistantSummary(session.messages);
			if (summary.stopReason === "aborted") {
				await runtime.failActiveJob("aborted");
				return;
			}
			if (summary.stopReason === "error" || summary.stopReason === "length") {
				const errorMessage = summary.errorMessage || `agent ${summary.stopReason}`;
				await runtime.failActiveJob(errorMessage);
				await this.transport?.sendImmediate(`Pie gateway error: ${errorMessage}`, next.triggerMessageId);
				return;
			}
			const attachmentPaths = [...this.queuedAttachments];
			const finalText = summary.text || (attachmentPaths.length > 0 ? "Attached requested file(s)." : "");
			let remoteMessageId: string | undefined;
			if (this.transport && finalText) {
				remoteMessageId = await Promise.race([
					this.transport.send(finalText, attachmentPaths, abortController.signal, next.triggerMessageId),
					new Promise<string>((_, reject) => setTimeout(() => reject(new Error("send timed out")), 120000)),
					waitForAbort(abortController.signal),
				]);
			}
			await runtime.completeActiveJob(finalText, remoteMessageId, attachmentPaths);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await runtime.failActiveJob(message);
			await this.runtimeValue?.appendError(message);
			await this.transport?.sendImmediate(`Pie gateway error: ${message}`, next.triggerMessageId).catch(() => undefined);
			this.logger.error(`[${this.conversation.conversationId}] ${message}`);
		} finally {
			this.stopTypingLoop();
			this.activeAbort = undefined;
			this.inFlight = false;
			this.queuedAttachments = [];
			await this.tryDispatch();
		}
	}

	async disconnect(): Promise<void> {
		this.activeAbort?.abort();
		this.session?.agent.abort();
		this.stopTypingLoop();
		this.session?.dispose();
		this.session = undefined;
		if (this.runtimeValue) {
			await this.runtimeValue.disconnect().catch(() => undefined);
			this.runtimeValue = undefined;
		}
	}
}

async function waitForShutdown(): Promise<void> {
	return new Promise((resolveShutdown) => {
		let resolved = false;
		const done = () => {
			if (resolved) return;
			resolved = true;
			process.off("SIGINT", done);
			process.off("SIGTERM", done);
			resolveShutdown();
		};
		process.once("SIGINT", done);
		process.once("SIGTERM", done);
	});
}

function startSchedulerLoop(options: { cwd: string; agentDir: string; logger: GatewayLogger }): () => void {
	const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
	const settings = settingsManager.getSchedulerSettings();
	if (!settings.enabled) return () => undefined;
	const store = new CronJobStore({ agentDir: options.agentDir, cwd: options.cwd });
	let inFlight = false;
	const runTick = async () => {
		if (inFlight) return;
		inFlight = true;
		try {
			const results = await tickCronScheduler({
				agentDir: options.agentDir,
				cwd: options.cwd,
				settings,
				store,
			});
			for (const result of results) {
				options.logger.info(
					`[cron] ${result.jobId} ${result.status}${result.delivered ? ` delivered:${result.delivered}` : ""}`,
				);
			}
		} catch (error) {
			options.logger.error(`[cron] ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			inFlight = false;
		}
	};
	void runTick();
	const timer = setInterval(() => void runTick(), settings.tickIntervalSeconds * 1000);
	return () => clearInterval(timer);
}

export async function runGateway(options: RunGatewayOptions = {}): Promise<void> {
	const cwd = resolve(options.cwd ?? process.cwd());
	const agentDir = options.agentDir ?? getAgentDir();
	const logger = options.logger ?? defaultLogger();
	await ensureChatHome();
	await writeGatewayPid(agentDir);
	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config);
	if (conversations.length === 0) {
		logger.warn("No configured Telegram or Discord channels. Run `pie gateway setup` or use /chat-config first.");
	}
	const workers: GatewayConversationWorker[] = [];
	for (const conversation of conversations) {
		const worker = new GatewayConversationWorker({ conversation, cwd, agentDir, logger });
		try {
			await worker.start();
			workers.push(worker);
		} catch (error) {
			logger.error(`[${conversation.conversationId}] ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	let adapters: GatewayAdapter[] = [];
	const stopScheduler = startSchedulerLoop({ cwd, agentDir, logger });
	try {
		adapters = await startGatewayChatAdapters(workers);
		logger.info(
			`Pie gateway running. conversations=${workers.length} adapters=${adapters.length} cwd=${cwd} pid=${process.pid}`,
		);
		await waitForShutdown();
	} finally {
		stopScheduler();
		await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
		await Promise.allSettled(workers.map((worker) => worker.disconnect()));
		await removeGatewayPid(agentDir);
		logger.info("Pie gateway stopped.");
	}
}
