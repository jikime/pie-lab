import { join } from "node:path";
import { Agent, type AgentMessage, type ThinkingLevel } from "@pie-lab/agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	clampThinkingLevel,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
	streamSimple,
} from "@pie-lab/ai";
import { checkFallbackError, compressPayloadWithRtk, type RtkStats, resolvePiModelRoutePlan } from "@pie-lab/router";
import { createQuotaAwareProviderConnectionPreparer } from "@pie-lab/shared";
import {
	createJsonlUsageStore,
	createJsonProviderConnectionStore,
	createUsageRecordId,
	type UsageCost,
	type UsageRecord,
	type UsageRecordStatus,
	type UsageStore,
	type UsageTokens,
	type UsageTraceEvent,
} from "@pie-lab/storage";
import { getAgentDir } from "../config.js";
import { AgentSession } from "./agent-session.js";
import { formatNoModelsAvailableMessage } from "./auth-guidance.js";
import { AuthStorage } from "./auth-storage.js";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import type { ExtensionRunner, LoadExtensionsResult, SessionStartEvent, ToolDefinition } from "./extensions/index.js";
import { convertToLlm } from "./messages.js";
import { ModelRegistry } from "./model-registry.js";
import { findInitialModel } from "./model-resolver.js";
import type { ResourceLoader } from "./resource-loader.js";
import { DefaultResourceLoader } from "./resource-loader.js";
import { getDefaultSessionDir, SessionManager } from "./session-manager.js";
import { SettingsManager } from "./settings-manager.js";
import { isInstallTelemetryEnabled } from "./telemetry.js";
import { time } from "./timings.js";
import {
	createBashTool,
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	type ToolName,
	withFileMutationQueue,
} from "./tools/index.js";

export interface CreateAgentSessionOptions {
	/** Working directory for project-local discovery. Default: process.cwd() */
	cwd?: string;
	/** Global config directory. Default: ~/.pie/agent */
	agentDir?: string;

	/** Auth storage for credentials. Default: AuthStorage.create(agentDir/auth.json) */
	authStorage?: AuthStorage;
	/** Model registry. Default: ModelRegistry.create(authStorage, agentDir/models.json) */
	modelRegistry?: ModelRegistry;

	/** Model to use. Default: from settings, else first available */
	model?: Model<any>;
	/** Thinking level. Default: from settings, else 'medium' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Models available for cycling (Ctrl+P in interactive mode) */
	scopedModels?: Array<{ model: Model<any>; thinkingLevel?: ThinkingLevel }>;

	/**
	 * Optional default tool suppression mode when no explicit allowlist is provided.
	 *
	 * - "all": start with no tools enabled
	 * - "builtin": disable the default built-in tools (read, bash, edit, write)
	 *   but keep extension/custom tools enabled
	 */
	noTools?: "all" | "builtin";
	/**
	 * Optional allowlist of tool names.
	 *
	 * When omitted, pie enables the default built-in tools (read, bash, edit, write)
	 * and leaves extension/custom tools enabled unless `noTools` changes that default.
	 * When provided, only the listed tool names are enabled.
	 */
	tools?: string[];
	/** Custom tools to register (in addition to built-in tools). */
	customTools?: ToolDefinition[];

	/** Resource loader. When omitted, DefaultResourceLoader is used. */
	resourceLoader?: ResourceLoader;

	/** Session manager. Default: SessionManager.create(cwd) */
	sessionManager?: SessionManager;

	/** Settings manager. Default: SettingsManager.create(cwd, agentDir) */
	settingsManager?: SettingsManager;
	/** Session start event metadata for extension runtime startup. */
	sessionStartEvent?: SessionStartEvent;
	/** Usage store for routed model attempts. Pass null to disable usage recording. */
	usageStore?: UsageStore | null;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions result (for UI context setup in interactive mode) */
	extensionsResult: LoadExtensionsResult;
	/** Warning if session was restored with a different model than saved */
	modelFallbackMessage?: string;
}

// Re-exports

export * from "./agent-session-runtime.js";
export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	SlashCommandInfo,
	SlashCommandSource,
	ToolDefinition,
} from "./extensions/index.js";
export type { PromptTemplate } from "./prompt-templates.js";
export type { Skill } from "./skills.js";
export type { Tool } from "./tools/index.js";

export {
	withFileMutationQueue,
	// Tool factories (for custom cwd)
	createCodingTools,
	createReadOnlyTools,
	createReadTool,
	createBashTool,
	createEditTool,
	createWriteTool,
	createGrepTool,
	createFindTool,
	createLsTool,
};

// Helper Functions

function getDefaultAgentDir(): string {
	return getAgentDir();
}

function getAttributionHeaders(
	model: Model<any>,
	settingsManager: SettingsManager,
): Record<string, string> | undefined {
	if (!isInstallTelemetryEnabled(settingsManager)) {
		return undefined;
	}

	if (model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")) {
		return {
			"HTTP-Referer": "https://pielab.ai",
			"X-OpenRouter-Title": "pie",
			"X-OpenRouter-Categories": "cli-agent",
		};
	}

	if (
		model.provider === "cloudflare-workers-ai" ||
		model.provider === "cloudflare-ai-gateway" ||
		model.baseUrl.includes("api.cloudflare.com") ||
		model.baseUrl.includes("gateway.ai.cloudflare.com")
	) {
		return {
			"User-Agent": "pie-coding-agent",
		};
	}

	return undefined;
}

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type RoutedAttemptResult = { status: "completed" } | { status: "retry"; error: unknown };

function createRoutedStream(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
	usageStore: UsageStore | null,
	agentRunId: string,
): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();

	void runRoutedStream(outer, model, context, options, modelRegistry, settingsManager, usageStore, agentRunId).catch(
		(error) => {
			const reason = options?.signal?.aborted ? "aborted" : "error";
			finishWithError(outer, model, error, reason);
		},
	);

	return outer;
}

async function runRoutedStream(
	outer: AssistantMessageEventStream,
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	modelRegistry: ModelRegistry,
	settingsManager: SettingsManager,
	usageStore: UsageStore | null,
	agentRunId: string,
): Promise<void> {
	const plan = await resolvePiModelRoutePlan({
		requestedModel: model,
		catalog: modelRegistry,
		policy: await modelRegistry.getRouterPolicy(),
	});
	const requestId = createUsageRecordId("request");
	let lastError: unknown;
	let lastModel: Model<any> = model;

	for (const [index, route] of plan.routes.entries()) {
		const routedModel = route.model;
		const canRetry = index < plan.routes.length - 1;
		lastModel = routedModel;

		if (options?.signal?.aborted) {
			finishWithError(outer, routedModel, new Error("Request aborted"), "aborted");
			return;
		}

		const auth = await modelRegistry.getApiKeyAndHeaders(routedModel);
		if (!auth.ok) {
			lastError = new Error(auth.error);
			await recordUsageAttempt({
				usageStore,
				requestId,
				agentRunId,
				requestedModel: plan.requestedModel,
				routingMode: plan.routingMode,
				route,
				attemptIndex: index,
				attemptCount: plan.routes.length,
				status: "error",
				error: lastError,
			});
			if (shouldRetryRoutedAttempt(canRetry, lastError)) continue;
			finishWithError(outer, routedModel, lastError, "error");
			return;
		}

		let attemptStream: AssistantMessageEventStream;
		const tokenSaverStats: RtkStats[] = [];
		try {
			attemptStream = streamSimple(
				routedModel,
				context,
				createRoutedStreamOptions(routedModel, options, auth, settingsManager, tokenSaverStats),
			);
		} catch (error) {
			lastError = error;
			await modelRegistry.markProviderConnectionUnavailable(auth.connectionId, routedModel, error);
			await recordUsageAttempt({
				usageStore,
				requestId,
				agentRunId,
				requestedModel: plan.requestedModel,
				routingMode: plan.routingMode,
				route,
				attemptIndex: index,
				attemptCount: plan.routes.length,
				status: options?.signal?.aborted ? "aborted" : "error",
				connectionId: auth.connectionId,
				error,
			});
			if (!options?.signal?.aborted && shouldRetryRoutedAttempt(canRetry, error)) continue;
			finishWithError(outer, routedModel, error, options?.signal?.aborted ? "aborted" : "error");
			return;
		}

		const result = await forwardRoutedAttempt(
			outer,
			attemptStream,
			routedModel,
			canRetry,
			async (status, message, error) => {
				if (status === "success") {
					await modelRegistry.clearProviderConnectionError(auth.connectionId, routedModel);
				} else if (status === "error") {
					await modelRegistry.markProviderConnectionUnavailable(auth.connectionId, routedModel, error ?? message);
				}
				await recordUsageAttempt({
					usageStore,
					requestId,
					agentRunId,
					requestedModel: plan.requestedModel,
					routingMode: plan.routingMode,
					route,
					attemptIndex: index,
					attemptCount: plan.routes.length,
					status,
					connectionId: auth.connectionId,
					message,
					error,
					tokenSaverStats,
				});
			},
		);
		if (result.status === "completed") return;
		lastError = result.error;
	}

	finishWithError(outer, lastModel, lastError ?? new Error("No routed model attempt succeeded"), "error");
}

function createRoutedStreamOptions(
	model: Model<any>,
	options: SimpleStreamOptions | undefined,
	auth: { apiKey?: string; headers?: Record<string, string> },
	settingsManager: SettingsManager,
	tokenSaverStats: RtkStats[],
): SimpleStreamOptions {
	const providerRetrySettings = settingsManager.getProviderRetrySettings();
	const attributionHeaders = getAttributionHeaders(model, settingsManager);
	return {
		...options,
		apiKey: auth.apiKey,
		timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
		maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
		maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
		headers:
			attributionHeaders || auth.headers || options?.headers
				? { ...attributionHeaders, ...auth.headers, ...options?.headers }
				: undefined,
		onPayload: createRtkPayloadHook(options?.onPayload, tokenSaverStats),
	};
}

async function forwardRoutedAttempt(
	outer: AssistantMessageEventStream,
	attemptStream: AssistantMessageEventStream,
	model: Model<any>,
	canRetry: boolean,
	recordAttempt: (
		status: UsageRecordStatus,
		message: AssistantMessage | undefined,
		error: unknown | undefined,
	) => Promise<void>,
): Promise<RoutedAttemptResult> {
	let forwardedEvent = false;

	try {
		for await (const event of attemptStream) {
			if (
				event.type === "error" &&
				!forwardedEvent &&
				event.reason === "error" &&
				shouldRetryRoutedAttempt(canRetry, event.error)
			) {
				await recordAttempt("error", event.error, event.error);
				return { status: "retry", error: event.error };
			}

			if (event.type === "done") {
				await recordAttempt("success", event.message, undefined);
			} else if (event.type === "error") {
				await recordAttempt(event.reason, event.error, event.error);
			}

			forwardedEvent = true;
			outer.push(event);

			if (event.type === "done" || event.type === "error") {
				outer.end(await attemptStream.result());
				return { status: "completed" };
			}
		}
	} catch (error) {
		if (!forwardedEvent && shouldRetryRoutedAttempt(canRetry, error)) {
			await recordAttempt("error", undefined, error);
			return { status: "retry", error };
		}
		await recordAttempt("error", undefined, error);
		finishWithError(outer, model, error, "error");
		return { status: "completed" };
	}

	const finalMessage = await attemptStream.result();
	if (finalMessage.stopReason === "error" && !forwardedEvent && shouldRetryRoutedAttempt(canRetry, finalMessage)) {
		await recordAttempt("error", finalMessage, finalMessage);
		return { status: "retry", error: finalMessage };
	}
	await recordAttempt(
		statusFromMessage(finalMessage),
		finalMessage,
		finalMessage.stopReason === "error" ? finalMessage : undefined,
	);
	if (finalMessage.stopReason === "aborted") {
		outer.push({ type: "error", reason: "aborted", error: finalMessage });
	} else if (finalMessage.stopReason === "error") {
		outer.push({ type: "error", reason: "error", error: finalMessage });
	}
	outer.end(finalMessage);
	return { status: "completed" };
}

function shouldRetryRoutedAttempt(canRetry: boolean, error: unknown): boolean {
	if (!canRetry) return false;
	const decision = checkFallbackError(extractStatusCode(error), formatErrorMessage(error));
	return decision.shouldFallback;
}

function extractStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;

	for (const key of ["status", "statusCode", "code"]) {
		if (typeof record[key] === "number") return record[key];
	}

	const response = record.response;
	if (response && typeof response === "object" && typeof (response as Record<string, unknown>).status === "number") {
		return (response as Record<string, number>).status;
	}

	return undefined;
}

async function recordUsageAttempt(options: {
	usageStore: UsageStore | null;
	requestId: string;
	agentRunId: string;
	requestedModel: string;
	routingMode: "fixed" | "router" | "fallback";
	route: Awaited<ReturnType<typeof resolvePiModelRoutePlan<Model<any>>>>["routes"][number];
	attemptIndex: number;
	attemptCount: number;
	status: UsageRecordStatus;
	connectionId?: string;
	message?: AssistantMessage;
	error?: unknown;
	tokenSaverStats?: RtkStats[];
}): Promise<void> {
	if (!options.usageStore) return;

	const { usage, cost } = usageAndCostFromMessage(options.message);
	try {
		await options.usageStore.recordUsage({
			id: createUsageRecordId(),
			requestId: options.requestId,
			timestamp: new Date().toISOString(),
			requestedModel: options.requestedModel,
			routingMode: options.routingMode,
			routeSource: options.route.route.source,
			resolvedProvider: options.route.route.resolvedProvider,
			resolvedModel: options.route.route.resolvedModel,
			connectionId: options.connectionId ?? options.route.route.connectionId,
			attemptIndex: options.attemptIndex,
			attemptCount: options.attemptCount,
			agentRunId: options.agentRunId,
			usage,
			cost,
			tokenSaver: toUsageTokenSaver(options.tokenSaverStats),
			inputTokens: usage?.input,
			outputTokens: usage?.output,
			costUsd: cost?.total,
			status: options.status,
			errorMessage: errorMessageFromAttempt(options.error, options.message),
			trace: createUsageAttemptTrace(options, usage, cost),
		});
	} catch {
		// Usage logging must not break the active model stream.
	}
}

function createUsageAttemptTrace(
	options: {
		requestId: string;
		agentRunId: string;
		requestedModel: string;
		routingMode: "fixed" | "router" | "fallback";
		route: Awaited<ReturnType<typeof resolvePiModelRoutePlan<Model<any>>>>["routes"][number];
		attemptIndex: number;
		attemptCount: number;
		status: UsageRecordStatus;
		connectionId?: string;
		message?: AssistantMessage;
		error?: unknown;
		tokenSaverStats?: RtkStats[];
	},
	usage: UsageTokens | undefined,
	cost: UsageCost | undefined,
): UsageTraceEvent[] {
	const timestamp = new Date().toISOString();
	const connectionId = options.connectionId ?? options.route.route.connectionId;
	const errorMessage = errorMessageFromAttempt(options.error, options.message);
	return [
		{
			timestamp,
			phase: "attempt.recorded",
			message: errorMessage,
			provider: options.route.route.resolvedProvider,
			model: options.route.route.resolvedModel,
			connectionId,
			attemptIndex: options.attemptIndex,
			status: options.status,
			metadata: {
				requestId: options.requestId,
				agentRunId: options.agentRunId,
				requestedModel: options.requestedModel,
				routingMode: options.routingMode,
				routeSource: options.route.route.source,
				attemptCount: options.attemptCount,
				totalTokens: usage?.totalTokens,
				costUsd: cost?.total,
				rtkBytesSaved: toUsageTokenSaver(options.tokenSaverStats)?.bytesSaved,
			},
		},
	];
}

function createRtkPayloadHook(
	previousOnPayload: SimpleStreamOptions["onPayload"],
	statsSink: RtkStats[],
): SimpleStreamOptions["onPayload"] {
	if (process.env.PIE_LAB_RTK_ENABLED === "false" || process.env.PIE_ADK_RTK_ENABLED === "false") {
		return previousOnPayload;
	}

	return async (payload, model) => {
		const inputPayload = previousOnPayload ? ((await previousOnPayload(payload, model)) ?? payload) : payload;
		const result = compressPayloadWithRtk(inputPayload, true);
		if (result.stats && result.stats.hits.length > 0) {
			statsSink.push(result.stats);
			if (result.logLine) console.log(result.logLine);
		}
		return result.payload;
	};
}

function toUsageTokenSaver(statsList: RtkStats[] | undefined): UsageRecord["tokenSaver"] {
	if (!statsList || statsList.length === 0) return undefined;
	const bytesBefore = statsList.reduce((sum, stats) => sum + stats.bytesBefore, 0);
	const bytesAfter = statsList.reduce((sum, stats) => sum + stats.bytesAfter, 0);
	const hits = statsList.flatMap((stats) => stats.hits);
	return {
		provider: "rtk",
		bytesBefore,
		bytesAfter,
		bytesSaved: Math.max(0, bytesBefore - bytesAfter),
		hits: hits.length,
		filters: [...new Set(hits.map((hit) => hit.filter))],
	};
}

function usageAndCostFromMessage(message: AssistantMessage | undefined): { usage?: UsageTokens; cost?: UsageCost } {
	if (!message) return {};
	return {
		usage: {
			input: message.usage.input,
			output: message.usage.output,
			cacheRead: message.usage.cacheRead,
			cacheWrite: message.usage.cacheWrite,
			totalTokens: message.usage.totalTokens,
		},
		cost: {
			input: message.usage.cost.input,
			output: message.usage.cost.output,
			cacheRead: message.usage.cost.cacheRead,
			cacheWrite: message.usage.cost.cacheWrite,
			total: message.usage.cost.total,
			currency: "USD",
			pricingSource: "pie-metadata",
		},
	};
}

function statusFromMessage(message: AssistantMessage): UsageRecordStatus {
	if (message.stopReason === "aborted") return "aborted";
	if (message.stopReason === "error") return "error";
	return "success";
}

function errorMessageFromAttempt(error: unknown, message: AssistantMessage | undefined): string | undefined {
	if (message?.errorMessage) return message.errorMessage;
	if (error === undefined) return undefined;
	return formatErrorMessage(error);
}

function finishWithError(
	stream: AssistantMessageEventStream,
	model: Model<any>,
	error: unknown,
	reason: "error" | "aborted",
): void {
	const message = createErrorMessage(model, error, reason);
	stream.push({ type: "error", reason, error: message });
	stream.end(message);
}

function createErrorMessage(model: Model<any>, error: unknown, stopReason: "error" | "aborted"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason,
		errorMessage: formatErrorMessage(error),
		timestamp: Date.now(),
	};
}

function formatErrorMessage(error: unknown): string {
	if (isAssistantMessage(error) && error.errorMessage) return error.errorMessage;
	if (error instanceof Error) return error.message;
	return String(error);
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
	return typeof value === "object" && value !== null && (value as AssistantMessage).role === "assistant";
}

/**
 * Create an AgentSession with the specified options.
 *
 * @example
 * ```typescript
 * // Minimal - uses defaults
 * const { session } = await createAgentSession();
 *
 * // With explicit model
 * import { getModel } from '@pie-lab/ai';
 * const { session } = await createAgentSession({
 *   model: getModel('anthropic', 'claude-opus-4-5'),
 *   thinkingLevel: 'high',
 * });
 *
 * // Continue previous session
 * const { session, modelFallbackMessage } = await createAgentSession({
 *   continueSession: true,
 * });
 *
 * // Full control
 * const loader = new DefaultResourceLoader({
 *   cwd: process.cwd(),
 *   agentDir: getAgentDir(),
 *   settingsManager: SettingsManager.create(),
 * });
 * await loader.reload();
 * const { session } = await createAgentSession({
 *   model: myModel,
 *   tools: ["read", "bash"],
 *   resourceLoader: loader,
 *   sessionManager: SessionManager.inMemory(),
 * });
 * ```
 */
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd();
	const agentDir = options.agentDir ?? getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	// Use provided or create AuthStorage and ModelRegistry
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const authStorage = options.authStorage ?? AuthStorage.create(authPath);
	const providerConnectionStore = createJsonProviderConnectionStore(join(agentDir, "provider-connections.json"));
	const modelRegistry =
		options.modelRegistry ??
		ModelRegistry.create(authStorage, modelsPath, {
			providerConnectionStore,
			prepareProviderConnections: createQuotaAwareProviderConnectionPreparer({
				providerConnectionStore,
			}),
		});

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));
	const usageStore =
		options.usageStore === undefined ? createJsonlUsageStore(join(agentDir, "usage.jsonl")) : options.usageStore;

	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}

	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && existingSession.model) {
		const restoredModel = modelRegistry.find(existingSession.model.provider, existingSession.model.modelId);
		if (restoredModel && modelRegistry.hasConfiguredAuth(restoredModel)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${existingSession.model.provider}/${existingSession.model.modelId}`;
		}
	}

	// If still no model, use findInitialModel (checks settings default, then provider defaults)
	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			modelRegistry,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}

	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}

	// Fall back to settings default
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	// Clamp to model capabilities
	if (!model) {
		thinkingLevel = "off";
	} else {
		thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
	}

	const defaultActiveToolNames: ToolName[] = ["read", "bash", "edit", "write"];
	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
	const initialActiveToolNames: string[] = options.tools
		? [...options.tools]
		: options.noTools
			? []
			: defaultActiveToolNames;

	let agent: Agent;

	// Create convertToLlm wrapper that filters images if blockImages is enabled (defense-in-depth)
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) =>
								c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c,
							)
							.filter(
								(c, i, arr) =>
									// Dedupe consecutive "Image reading is disabled." texts
									!(
										c.type === "text" &&
										c.text === "Image reading is disabled." &&
										i > 0 &&
										arr[i - 1].type === "text" &&
										(arr[i - 1] as { type: "text"; text: string }).text === "Image reading is disabled."
									),
							);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};

	const extensionRunnerRef: { current?: ExtensionRunner } = {};

	agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: (model, context, options) =>
			createRoutedStream(
				model,
				context,
				options,
				modelRegistry,
				settingsManager,
				usageStore,
				sessionManager.getSessionId(),
			),
		onPayload: async (payload, _model) => {
			const runner = extensionRunnerRef.current;
			if (!runner?.hasHandlers("before_provider_request")) {
				return payload;
			}
			return runner.emitBeforeProviderRequest(payload);
		},
		onResponse: async (response, _model) => {
			const runner = extensionRunnerRef.current;
			if (!runner?.hasHandlers("after_provider_response")) {
				return;
			}
			await runner.emit({
				type: "after_provider_response",
				status: response.status,
				headers: response.headers,
			});
		},
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		transport: settingsManager.getTransport(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.state.messages = existingSession.messages;
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		scopedModels: options.scopedModels,
		resourceLoader,
		customTools: options.customTools,
		modelRegistry,
		initialActiveToolNames,
		allowedToolNames,
		extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
	});
	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
