import { join } from "node:path";
import { Agent, type AgentMessage, type ThinkingLevel } from "@pie-lab/agent-core";
import {
	type AssistantMessage,
	type AssistantMessageEvent,
	clampThinkingLevel,
	createAssistantMessageEventStream,
	type Message,
	type Model,
	streamSimple,
} from "@pie-lab/ai";
import { resolvePiModelRoutePlan } from "@pie-lab/router";
import { createUsageRecordId, type UsageRecordStatus, type UsageStore } from "@pie-lab/storage";
import { getAgentDir } from "../config.ts";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { formatNoModelsAvailableMessage } from "./auth-guidance.ts";
import { AuthStorage } from "./auth-storage.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { ExtensionRunner, LoadExtensionsResult, SessionStartEvent, ToolDefinition } from "./extensions/index.ts";
import {
	BackgroundLearningReview,
	createLearningToolDefinitions,
	HonchoProvider,
	LearningReviewStore,
	MemoryStore,
	SkillManager,
} from "./learning/index.ts";
import { convertToLlm } from "./messages.ts";
import { ModelRegistry } from "./model-registry.ts";
import { findInitialModel } from "./model-resolver.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import { DefaultResourceLoader } from "./resource-loader.ts";
import { createSchedulerToolDefinitions, CronJobStore } from "./scheduler/index.ts";
import { createSessionSearchToolDefinition } from "./session-search-tool.js";
import { getDefaultSessionDir, SessionManager } from "./session-manager.ts";
import { SettingsManager } from "./settings-manager.ts";
import { isInstallTelemetryEnabled } from "./telemetry.ts";
import { time } from "./timings.ts";
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
} from "./tools/index.ts";

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
	 * When omitted, pi enables the default built-in tools (read, bash, edit, write)
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
	/** Optional usage recorder for routed SDK calls. */
	usageStore?: UsageStore;
	/** Session start event metadata for extension runtime startup. */
	sessionStartEvent?: SessionStartEvent;
	/** Conversation id used by remote chat runtimes when creating cron jobs with deliver=origin. */
	chatOrigin?: string;
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

export * from "./agent-session-runtime.ts";
export type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	SlashCommandInfo,
	SlashCommandSource,
	ToolDefinition,
} from "./extensions/index.ts";
export type { PromptTemplate } from "./prompt-templates.ts";
export type { Skill } from "./skills.ts";
export type { Tool } from "./tools/index.ts";

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
	sessionId?: string,
): Record<string, string> | undefined {
	if (
		sessionId &&
		(model.provider === "opencode" || model.provider === "opencode-go" || model.baseUrl.includes("opencode.ai"))
	) {
		return { "x-opencode-session": sessionId, "x-opencode-client": "pi" };
	}

	if (!isInstallTelemetryEnabled(settingsManager)) {
		return undefined;
	}

	if (model.provider === "openrouter" || model.baseUrl.includes("openrouter.ai")) {
		return {
			"HTTP-Referer": "https://pi.dev",
			"X-OpenRouter-Title": "pi",
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
			"User-Agent": "pi-coding-agent",
		};
	}

	return undefined;
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function createStreamErrorMessage(model: Model<any>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: formatUnknownError(error),
		timestamp: Date.now(),
	};
}

function getMessageErrorText(message: AssistantMessage): string | undefined {
	if (message.errorMessage) return message.errorMessage;
	const firstText = message.content.find((item) => item.type === "text");
	return firstText?.text;
}

function getUsageClientOrigin(): string | undefined {
	return process.env.PIE_LAB_USAGE_ORIGIN?.trim() || process.env.PIE_USAGE_ORIGIN?.trim() || undefined;
}

function getUsageEndpoint(): string | undefined {
	return process.env.PIE_LAB_USAGE_ENDPOINT?.trim() || process.env.PIE_USAGE_ENDPOINT?.trim() || undefined;
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
	const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	// Use provided or create AuthStorage and ModelRegistry
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const authStorage = options.authStorage ?? AuthStorage.create(authPath);
	const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage, modelsPath);

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));
	const usageStore = options.usageStore;

	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}

	const learningSettings = settingsManager.getLearningSettings();
	const schedulerSettings = settingsManager.getSchedulerSettings();
	const memoryStore = new MemoryStore({ agentDir });
	const reviewStore = new LearningReviewStore({ agentDir });
	const skillManager = new SkillManager({ agentDir, cwd });
	const cronJobStore = new CronJobStore({ agentDir, cwd });
	const learningMemorySnapshot =
		learningSettings.enabled && learningSettings.memory.enabled
			? memoryStore.formatForSystemPrompt(memoryStore.readSnapshot())
			: undefined;
	let reloadSessionResources: (() => Promise<void>) | undefined;
	const onLearningSkillsChanged = async (): Promise<void> => {
		if (reloadSessionResources) {
			await reloadSessionResources();
			return;
		}
		await resourceLoader.reload();
	};
	const learningTools =
		!options.noTools &&
		learningSettings.enabled &&
		(learningSettings.memory.enabled || learningSettings.skills.enabled)
			? createLearningToolDefinitions({
					memoryStore,
					skillManager,
					onSkillsChanged: onLearningSkillsChanged,
				})
			: [];
	const schedulerTools =
		!options.noTools && schedulerSettings.enabled
			? createSchedulerToolDefinitions({
					store: cronJobStore,
					getOrigin: () => options.chatOrigin,
				})
			: [];
	const sessionSearchTool = !options.noTools ? [createSessionSearchToolDefinition(agentDir)] : [];
	const customTools = [...(options.customTools ?? []), ...learningTools, ...schedulerTools, ...sessionSearchTool];

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
	const honchoProvider = new HonchoProvider({
		agentDir,
		cwd,
		sessionId: sessionManager.getSessionId(),
		settings: learningSettings,
		streamFn: (model, context, options) => agent.streamFn?.(model, context, options),
	});

	agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: async (model, context, options) => {
			const outer = createAssistantMessageEventStream();
			const requestId = createUsageRecordId("request");

			void (async () => {
				try {
					const routerPolicy = await modelRegistry.getRouterPolicy();
					const plan = await resolvePiModelRoutePlan({
						requestedModel: model,
						catalog: modelRegistry,
						policy: routerPolicy,
					});
					const attemptCount = plan.routes.length;

					for (let attemptIndex = 0; attemptIndex < plan.routes.length; attemptIndex++) {
						const resolved = plan.routes[attemptIndex];
						const route = resolved.route;
						const resolvedModel = resolved.model;
						let connectionId = route.connectionId;

						const recordUsage = async (
							message: AssistantMessage,
							status: UsageRecordStatus,
							errorMessage?: string,
						): Promise<void> => {
							const usage = message.usage;
							await usageStore?.recordUsage({
								id: createUsageRecordId(),
								requestId,
								timestamp: new Date().toISOString(),
								requestedModel: plan.requestedModel,
								routingMode: plan.routingMode,
								routeSource: route.source,
								resolvedProvider: route.resolvedProvider,
								resolvedModel: route.resolvedModel,
								connectionId,
								attemptIndex,
								attemptCount,
								endpoint: getUsageEndpoint(),
								clientOrigin: getUsageClientOrigin(),
								usage: usage
									? {
											input: usage.input,
											output: usage.output,
											cacheRead: usage.cacheRead,
											cacheWrite: usage.cacheWrite,
											totalTokens: usage.totalTokens,
										}
									: undefined,
								cost: usage?.cost
									? {
											input: usage.cost.input,
											output: usage.cost.output,
											cacheRead: usage.cost.cacheRead,
											cacheWrite: usage.cost.cacheWrite,
											total: usage.cost.total,
											currency: "USD",
											pricingSource: "pie-metadata",
										}
									: undefined,
								costUsd: usage?.cost.total,
								status,
								errorMessage,
							});
						};

						try {
							const auth = await modelRegistry.getApiKeyAndHeaders(resolvedModel);
							if (!auth.ok) {
								throw new Error(auth.error);
							}
							connectionId = auth.connectionId ?? connectionId;

							const providerRetrySettings = settingsManager.getProviderRetrySettings();
							const attributionHeaders = getAttributionHeaders(
								resolvedModel,
								settingsManager,
								options?.sessionId,
							);
							const inner = await streamSimple(resolvedModel, context, {
								...options,
								apiKey: auth.apiKey,
								timeoutMs: options?.timeoutMs ?? providerRetrySettings.timeoutMs,
								maxRetries: options?.maxRetries ?? providerRetrySettings.maxRetries,
								maxRetryDelayMs: options?.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
								headers:
									attributionHeaders || auth.headers || options?.headers
										? { ...attributionHeaders, ...auth.headers, ...options?.headers }
										: undefined,
							});

							const bufferedEvents: AssistantMessageEvent[] = [];
							let shouldTryNextRoute = false;
							for await (const event of inner) {
								bufferedEvents.push(event);

								if (event.type === "done") {
									await recordUsage(event.message, "success");
									for (const bufferedEvent of bufferedEvents) outer.push(bufferedEvent);
									return;
								}

								if (event.type === "error") {
									const errorText = getMessageErrorText(event.error);
									await recordUsage(
										event.error,
										event.error.stopReason === "aborted" ? "aborted" : "error",
										errorText,
									);
									await modelRegistry.markProviderConnectionUnavailable(
										connectionId,
										resolvedModel,
										event.error,
									);

									const emittedContent = bufferedEvents.some(
										(bufferedEvent) => bufferedEvent.type !== "error",
									);
									if (attemptIndex < attemptCount - 1 && !emittedContent) {
										shouldTryNextRoute = true;
										break;
									}

									for (const bufferedEvent of bufferedEvents) outer.push(bufferedEvent);
									return;
								}
							}

							if (shouldTryNextRoute) {
								continue;
							}

							const errorMessage = createStreamErrorMessage(
								resolvedModel,
								"Provider stream ended without a final event.",
							);
							await recordUsage(errorMessage, "error", errorMessage.errorMessage);
							await modelRegistry.markProviderConnectionUnavailable(connectionId, resolvedModel, errorMessage);
							if (attemptIndex < attemptCount - 1) {
								continue;
							}
							outer.push({ type: "error", reason: "error", error: errorMessage });
							return;
						} catch (error) {
							const errorMessage = createStreamErrorMessage(resolvedModel, error);
							await recordUsage(errorMessage, "error", errorMessage.errorMessage);
							await modelRegistry.markProviderConnectionUnavailable(connectionId, resolvedModel, error);
							if (attemptIndex < attemptCount - 1) {
								continue;
							}
							outer.push({ type: "error", reason: "error", error: errorMessage });
							return;
						}
					}
				} catch (error) {
					const errorMessage = createStreamErrorMessage(model, error);
					outer.push({ type: "error", reason: "error", error: errorMessage });
				}
			})();

			return outer;
		},
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
			const transformed = runner ? await runner.emitContext(messages) : messages;
			return honchoProvider.injectContext(transformed);
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

	const backgroundLearningReview = new BackgroundLearningReview({
		settings: learningSettings,
		memoryStore,
		skillManager,
		reviewStore,
		streamFn: agent.streamFn?.bind(agent),
		onSkillsChanged: onLearningSkillsChanged,
	});

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		scopedModels: options.scopedModels,
		resourceLoader,
		customTools,
		modelRegistry,
		initialActiveToolNames,
		allowedToolNames,
		extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
		learningMemorySnapshot,
		backgroundLearningReview,
		honchoProvider,
		learningSkillManager: skillManager,
	});
	reloadSessionResources = () => session.reload();
	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
