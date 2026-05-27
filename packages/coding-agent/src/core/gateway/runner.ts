import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createJsonlUsageStore, type UsageStore } from "@pie-lab/storage";
import { getAgentDir } from "../../config.ts";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getDefaultAgentUsageFilePath,
	type AgentSessionServices,
} from "../agent-session-services.ts";
import type { AgentSession } from "../agent-session.ts";
import { CronJobStore, tickCronScheduler } from "../scheduler/index.ts";
import { SessionManager } from "../session-manager.ts";
import { SettingsManager } from "../settings-manager.ts";
import {
	startGatewayChatAdapters,
	type GatewayAdapter,
	type GatewayAdapterHealth,
	type GatewayCheckpoint,
	type GatewayConversationEndpoint,
	type GatewayTransport,
} from "./adapters.ts";
import { buildResolvedConversation, ensureChatHome, listConfiguredConversations, loadChatConfig, saveChatConfig } from "./chat/config.js";
import type { ChatAccountConfig, ConfiguredChannel, InboundMessageInput, ResolvedConversation } from "./chat/types.js";
import { ConversationRuntime } from "./chat/runtime.js";
import { buildGatewaySystemPrompt } from "./prompt.ts";
import { buildGatewaySessionKey, buildGatewaySessionSource } from "./session.ts";
import { createGatewayChatTools } from "./tools.ts";
import { WebIPCServer } from "./web-ipc-server.js";

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
	statusPath: string;
	configuredConversations: number;
	conversations: Array<{ id: string; name: string; service: string }>;
	health?: GatewayHealthSnapshot;
}

export interface GatewayConversationHealth {
	id: string;
	name: string;
	service: string;
	queueLength: number;
	hasActiveJob: boolean;
	recordCount: number;
	sessionCount: number;
	activeSessionKey?: string;
	lastSessionKey?: string;
}

export interface GatewayHealthSnapshot {
	pid: number;
	startedAt: string;
	updatedAt: string;
	cwd: string;
	conversations: GatewayConversationHealth[];
	adapters: GatewayAdapterHealth[];
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

export function getGatewayStatusPath(agentDir = getAgentDir()): string {
	return join(getGatewayDir(agentDir), "status.json");
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
	let health: GatewayHealthSnapshot | undefined;
	try {
		health = JSON.parse(await readFile(getGatewayStatusPath(agentDir), "utf8")) as GatewayHealthSnapshot;
	} catch {
		health = undefined;
	}
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
		statusPath: getGatewayStatusPath(agentDir),
		configuredConversations: conversations.length,
		conversations,
		health,
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

async function writeGatewayHealth(agentDir: string, snapshot: GatewayHealthSnapshot): Promise<void> {
	await mkdir(getGatewayDir(agentDir), { recursive: true });
	await writeFile(getGatewayStatusPath(agentDir), `${JSON.stringify(snapshot, null, "\t")}\n`, "utf8");
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

interface GatewayAgentSessionState {
	sessionKey: string;
	sessionDir: string;
	sessionManager: SessionManager;
	services?: AgentSessionServices;
	session?: AgentSession;
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
	private readonly usageStore: UsageStore;
	private readonly ownerId: string;
	private readonly defaultSessionKey: string;
	private runtimeValue?: ConversationRuntime;
	private transport?: GatewayTransport;
	private readonly sessions = new Map<string, GatewayAgentSessionState>();
	private inFlight = false;
	private typingInterval?: ReturnType<typeof setInterval>;
	private queuedAttachments: string[] = [];
	private activeAbort?: AbortController;
	private activeSessionKey?: string;

	constructor(options: {
		conversation: ResolvedConversation;
		cwd: string;
		agentDir: string;
		logger: GatewayLogger;
		usageStore: UsageStore;
	}) {
		this.conversation = options.conversation;
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.logger = options.logger;
		this.usageStore = options.usageStore;
		this.ownerId = `pie-gateway-${process.pid}-${randomUUID()}`;
		this.defaultSessionKey = buildGatewaySessionKey(buildGatewaySessionSource(this.conversation));
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

	getHealth(): GatewayConversationHealth {
		const status = this.runtimeValue?.getStatus();
		return {
			id: this.conversation.conversationId,
			name: this.conversation.conversationName,
			service: this.conversation.service,
			queueLength: status?.queueLength ?? 0,
			hasActiveJob: this.inFlight || (status?.hasActiveJob ?? false),
			recordCount: status?.recordCount ?? 0,
			sessionCount: this.sessions.size,
			activeSessionKey: this.activeSessionKey,
			lastSessionKey: status?.lastSessionKey,
		};
	}

	async onMessage(input: InboundMessageInput, checkpoint?: GatewayCheckpoint): Promise<void> {
		const runtime = this.runtimeValue;
		if (!runtime) return;
		if (runtime.isArmed()) {
			const control = runtime.parseControlCommand(input);
			if (control) {
				await this.handleControl(control, input);
				if (checkpoint) await runtime.noteCheckpoint(checkpoint);
				return;
			}
		}
		await runtime.ingestInbound(input, checkpoint);
		await this.tryDispatch();
	}

	private sessionKeyForInput(input?: InboundMessageInput): string {
		if (!input) return this.activeSessionKey || this.defaultSessionKey;
		return input.sessionKey || buildGatewaySessionKey(input.sessionSource || buildGatewaySessionSource(this.conversation, input));
	}

	private getActiveSessionState(sessionKey?: string): GatewayAgentSessionState | undefined {
		return this.sessions.get(sessionKey || this.activeSessionKey || this.defaultSessionKey);
	}

	private async handleControl(control: "stop" | "new" | "compact" | "status" | "help", input?: InboundMessageInput): Promise<void> {
		const sessionKey = this.sessionKeyForInput(input);
		if (control === "help") {
			await this.transport?.sendImmediate(this.formatHelp());
			return;
		}
		if (control === "status") {
			await this.transport?.sendImmediate(this.formatStatus(sessionKey));
			return;
		}
		if (control === "stop") {
			if (!this.inFlight) {
				await this.transport?.sendImmediate("No active turn.");
				return;
			}
			this.activeAbort?.abort();
			this.getActiveSessionState()?.session?.agent.abort();
			await this.transport?.sendImmediate("Aborted current turn.");
			return;
		}
		if (control === "compact") {
			const state = this.sessions.get(sessionKey);
			if (!state?.session) {
				await this.transport?.sendImmediate("No session to compact yet.");
				return;
			}
			try {
				await state.session.compact();
				await this.transport?.sendImmediate("Compaction completed.");
			} catch (error) {
				await this.transport?.sendImmediate(`Compaction failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			return;
		}
		await this.resetSession(sessionKey);
		await this.transport?.sendImmediate("Started a new Pie gateway session.");
	}

	private formatHelp(): string {
		return [
			"Pie gateway commands:",
			"- /status: show gateway session status",
			"- /new: start a new Pie session for this chat context",
			"- /compact: compact the current Pie session",
			"- /stop: abort the active turn",
			"- /help: show this help",
		].join("\n");
	}

	private formatStatus(sessionKey?: string): string {
		const status = this.runtimeValue?.getStatus();
		const state = this.getActiveSessionState(sessionKey);
		const model = state?.session?.model ? `${state.session.model.provider}/${state.session.model.id}` : "not initialized";
		const source = state?.sessionKey === status?.lastSessionKey ? state?.sessionKey : sessionKey || status?.lastSessionKey;
		return [
			`Gateway: ${this.conversation.conversationName}`,
			`Model: ${model}`,
			`Queue: ${status?.queueLength ?? 0}${this.inFlight ? " active" : ""}`,
			`Records: ${status?.recordCount ?? 0}`,
			`Sessions: ${this.sessions.size}`,
			`Session key: ${source ?? this.defaultSessionKey}`,
			`Session: ${state?.session?.sessionFile ?? "not initialized"}`,
		].join("\n");
	}

	private sessionDirForKey(sessionKey: string): string {
		return join(this.agentDir, "gateway", "sessions", sanitize(sessionKey));
	}

	private async ensureSession(sessionKey = this.defaultSessionKey, options: { newSession?: boolean } = {}): Promise<AgentSession> {
		const existing = this.sessions.get(sessionKey);
		if (existing?.session && !options.newSession) return existing.session;
		if (existing?.session) {
			existing.session.agent.abort();
			existing.session.dispose();
		}
		const sessionDir = existing?.sessionDir ?? this.sessionDirForKey(sessionKey);
		const sessionManager = options.newSession
			? SessionManager.create(this.cwd, sessionDir)
			: SessionManager.continueRecent(this.cwd, sessionDir);
		if (sessionManager.getBranch().length <= 1) {
			sessionManager.appendSessionInfo(`pie gateway ${this.conversation.conversationName} ${sessionKey}`);
		}
			const services = await createAgentSessionServices({
				cwd: this.cwd,
				agentDir: this.agentDir,
				usageStore: this.usageStore,
				resourceLoaderOptions: {
				noExtensions: true,
				additionalSkillPaths: [
					join(this.conversation.sharedDir, "skills"),
					join(this.conversation.workspaceDir, "skills"),
				],
				appendSystemPromptOverride: (base) => [...base, buildGatewaySystemPrompt(this.conversation, this.cwd)],
			},
		});
		services.usageStore = createGatewayUsageStore(services.usageStore, this.conversation);
		const created = await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "startup" },
				customTools: createGatewayChatTools({
					cwd: this.cwd,
					agentDir: this.agentDir,
					usageStore: services.usageStore,
					runtime: () => this.runtimeValue,
					isTurnActive: () => this.inFlight,
					queueAttachment: (path) => this.queuedAttachments.push(path),
				}),
			chatOrigin: this.conversation.conversationId,
		});
		this.sessions.set(sessionKey, {
			sessionKey,
			sessionDir,
			sessionManager,
			services,
			session: created.session,
		});
		return created.session;
	}

	private async resetSession(sessionKey = this.defaultSessionKey): Promise<void> {
		this.activeAbort?.abort();
		const state = this.sessions.get(sessionKey);
		state?.session?.agent.abort();
		state?.session?.dispose();
		this.sessions.delete(sessionKey);
		await this.ensureSession(sessionKey, { newSession: true });
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
		const sessionKey = next.sessionKey || this.defaultSessionKey;
		this.activeSessionKey = sessionKey;
		try {
			const session = await this.ensureSession(sessionKey);
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
			this.activeSessionKey = undefined;
			this.inFlight = false;
			this.queuedAttachments = [];
			await this.tryDispatch();
		}
	}

	async disconnect(): Promise<void> {
		this.activeAbort?.abort();
		this.stopTypingLoop();
		for (const state of this.sessions.values()) {
			state.session?.agent.abort();
			state.session?.dispose();
		}
		this.sessions.clear();
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
	const usageStore = createJsonlUsageStore(getDefaultAgentUsageFilePath(agentDir));
	await ensureChatHome();
	await writeGatewayPid(agentDir);
	const startedAt = new Date().toISOString();
	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config);
	const configuredAccounts = Object.keys(config.accounts ?? {}).length;
	if (conversations.length === 0 && configuredAccounts === 0) {
		logger.warn("No configured Telegram or Discord accounts. Run `pie gateway setup` or use /chat-config first.");
	} else if (conversations.length === 0) {
		logger.info("No static gateway channels configured. Discord accounts can auto-discover channels at runtime.");
	}
	const workers: GatewayConversationWorker[] = [];
	const workerByConversationId = new Map<string, GatewayConversationWorker>();
	const workerCreatePromises = new Map<string, Promise<GatewayConversationWorker>>();
	// Serialise all saveChatConfig calls to prevent concurrent auto-discovery writes racing.
	let configSaveChain: Promise<void> = Promise.resolve();
	for (const conversation of conversations) {
		const worker = new GatewayConversationWorker({ conversation, cwd, agentDir, logger, usageStore });
		try {
			await worker.start();
			workers.push(worker);
			workerByConversationId.set(conversation.conversationId, worker);
		} catch (error) {
			logger.error(`[${conversation.conversationId}] ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const getOrCreateEndpoint = async (
		accountId: string,
		account: ChatAccountConfig,
		channelKey: string,
		channel: ConfiguredChannel,
	): Promise<GatewayConversationEndpoint> => {
		const conversationId = `${accountId}/${channelKey}`;
		const existing = workerByConversationId.get(conversationId);
		if (existing) return existing;
		const pending = workerCreatePromises.get(conversationId);
		if (pending) return pending;
		const promise = (async () => {
			const configuredAccount = config.accounts[accountId] ?? account;
			config.accounts[accountId] = configuredAccount;
			configuredAccount.channels ??= {};
			if (!configuredAccount.channels[channelKey]) {
				configuredAccount.channels[channelKey] = channel;
				// Chain saves through a single promise to avoid concurrent writes racing.
				const save = configSaveChain
					.then(() => saveChatConfig(config))
					.catch((error) => {
						logger.warn(`[${conversationId}] failed to persist auto-discovered channel: ${error instanceof Error ? error.message : String(error)}`);
					});
				configSaveChain = save.then(() => undefined);
				await save;
			}
			const conversation = buildResolvedConversation(config, accountId, channelKey, configuredAccount.channels[channelKey] ?? channel);
				const worker = new GatewayConversationWorker({ conversation, cwd, agentDir, logger, usageStore });
			await worker.start();
			workers.push(worker);
			workerByConversationId.set(conversationId, worker);
			logger.info(`[${conversationId}] auto-discovered ${conversation.service} channel ${conversation.channel.name ?? conversation.channel.id}`);
			return worker;
		})();
		workerCreatePromises.set(conversationId, promise);
		try {
			return await promise;
		} finally {
			workerCreatePromises.delete(conversationId);
		}
	};
	// Start the web IPC server so web chat can route through the gateway.
	// The createWorker factory builds a GatewayConversationWorker for each
	// web conversationId on demand — keeping web-ipc-server.ts dependency-free
	// of runner internals (avoids circular imports).
	const webIpc = new WebIPCServer({
		agentDir,
		logger,
		createWorker: async (conversationId: string) => {
			const { buildWebConversation } = await import("./web-ipc-server.js");
			const conversation = buildWebConversation(agentDir, conversationId);
			const worker = new GatewayConversationWorker({ conversation, cwd, agentDir, logger, usageStore });
			await worker.start();
			workers.push(worker);
			workerByConversationId.set(`web/${conversationId}`, worker);
			return worker;
		},
	});
	await webIpc.start().catch((err: unknown) => {
		logger.warn(`[web-ipc] failed to start: ${err instanceof Error ? err.message : String(err)}`);
	});

	let adapters: GatewayAdapter[] = [];
	const stopScheduler = startSchedulerLoop({ cwd, agentDir, logger });
	const buildHealth = (): GatewayHealthSnapshot => ({
		pid: process.pid,
		startedAt,
		updatedAt: new Date().toISOString(),
		cwd,
		conversations: workers.map((worker) => worker.getHealth()),
		adapters: adapters.map((adapter) =>
			adapter.getHealth?.() ?? {
				accountId: adapter.accountId,
				service: adapter.service,
				connected: true,
				startedAt,
				errorCount: 0,
			},
		),
	});
	await writeGatewayHealth(agentDir, buildHealth()).catch(() => undefined);
	const healthTimer = setInterval(() => {
		void writeGatewayHealth(agentDir, buildHealth()).catch(() => undefined);
	}, 15000);
	try {
			adapters = await startGatewayChatAdapters(config, workers, { getOrCreateEndpoint, usageStore });
		await writeGatewayHealth(agentDir, buildHealth()).catch(() => undefined);
		logger.info(
			`Pie gateway running. conversations=${workers.length} adapters=${adapters.length} cwd=${cwd} pid=${process.pid}`,
		);
		await waitForShutdown();
	} finally {
		clearInterval(healthTimer);
		stopScheduler();
		await webIpc.stop().catch(() => undefined);
		await Promise.allSettled(adapters.map((adapter) => adapter.disconnect()));
		await Promise.allSettled(workers.map((worker) => worker.disconnect()));
		await writeGatewayHealth(agentDir, buildHealth()).catch(() => undefined);
		await removeGatewayPid(agentDir);
		logger.info("Pie gateway stopped.");
	}
}
