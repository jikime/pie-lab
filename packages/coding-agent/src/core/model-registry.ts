/**
 * Model registry - manages built-in and custom models, provides API key resolution.
 */

import {
	type AnthropicMessagesCompat,
	type Api,
	type AssistantMessageEventStream,
	type Context,
	getModels,
	getProviders,
	type KnownProvider,
	type Model,
	type OAuthProviderInterface,
	type OpenAICompletionsCompat,
	type OpenAIResponsesCompat,
	registerApiProvider,
	resetApiProviders,
	type SimpleStreamOptions,
} from "@pie-lab/ai";
import { registerOAuthProvider, resetOAuthProviders } from "@pie-lab/ai/oauth";
import {
	buildModelLockUpdate,
	checkFallbackError,
	extractProviderResetCooldownMs,
	getModelLockKey,
	MODEL_LOCK_ALL,
	MODEL_LOCK_PREFIX,
	PIE_LAB_QUOTA_SELECTION_KEY,
	PIE_LAB_ROUTER_MODEL_IDS,
	PIE_LAB_ROUTER_PROVIDER,
	type PiRouterPolicy,
	selectProviderConnection,
} from "@pie-lab/router";
import type {
	CreateProviderConnectionInput,
	ProviderConnection,
	ProviderConnectionSettings,
	ProviderConnectionStore,
	UpdateProviderConnectionInput,
} from "@pie-lab/storage";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TLocalizedValidationError } from "typebox/error";
import { getAgentDir } from "../config.ts";
import { warnDeprecation } from "../utils/deprecation.ts";
import { stripJsonComments } from "../utils/json.ts";
import { normalizePath } from "../utils/paths.ts";
import type { AuthCredential, AuthStatus, AuthStorage } from "./auth-storage.ts";
import { BUILT_IN_PROVIDER_DISPLAY_NAMES } from "./provider-display-names.ts";
import {
	clearConfigValueCache,
	getConfigValueEnvVarNames,
	isCommandConfigValue,
	isConfigValueConfigured,
	isLegacyEnvVarNameConfigValue,
	resolveConfigValueOrThrow,
	resolveConfigValueUncached,
	resolveHeadersOrThrow,
} from "./resolve-config-value.ts";

// Schema for OpenRouter routing preferences
const PercentileCutoffsSchema = Type.Object({
	p50: Type.Optional(Type.Number()),
	p75: Type.Optional(Type.Number()),
	p90: Type.Optional(Type.Number()),
	p99: Type.Optional(Type.Number()),
});

const OpenRouterRoutingSchema = Type.Object({
	allow_fallbacks: Type.Optional(Type.Boolean()),
	require_parameters: Type.Optional(Type.Boolean()),
	data_collection: Type.Optional(Type.Union([Type.Literal("deny"), Type.Literal("allow")])),
	zdr: Type.Optional(Type.Boolean()),
	enforce_distillable_text: Type.Optional(Type.Boolean()),
	order: Type.Optional(Type.Array(Type.String())),
	only: Type.Optional(Type.Array(Type.String())),
	ignore: Type.Optional(Type.Array(Type.String())),
	quantizations: Type.Optional(Type.Array(Type.String())),
	sort: Type.Optional(
		Type.Union([
			Type.String(),
			Type.Object({
				by: Type.Optional(Type.String()),
				partition: Type.Optional(Type.Union([Type.String(), Type.Null()])),
			}),
		]),
	),
	max_price: Type.Optional(
		Type.Object({
			prompt: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			completion: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			image: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			audio: Type.Optional(Type.Union([Type.Number(), Type.String()])),
			request: Type.Optional(Type.Union([Type.Number(), Type.String()])),
		}),
	),
	preferred_min_throughput: Type.Optional(Type.Union([Type.Number(), PercentileCutoffsSchema])),
	preferred_max_latency: Type.Optional(Type.Union([Type.Number(), PercentileCutoffsSchema])),
});

// Schema for Vercel AI Gateway routing preferences
const VercelGatewayRoutingSchema = Type.Object({
	only: Type.Optional(Type.Array(Type.String())),
	order: Type.Optional(Type.Array(Type.String())),
});

// Schema for thinking level support and provider-specific values
const ThinkingLevelMapValueSchema = Type.Union([Type.String(), Type.Null()]);
const ThinkingLevelMapSchema = Type.Object({
	off: Type.Optional(ThinkingLevelMapValueSchema),
	minimal: Type.Optional(ThinkingLevelMapValueSchema),
	low: Type.Optional(ThinkingLevelMapValueSchema),
	medium: Type.Optional(ThinkingLevelMapValueSchema),
	high: Type.Optional(ThinkingLevelMapValueSchema),
	xhigh: Type.Optional(ThinkingLevelMapValueSchema),
});

const OpenAICompletionsCompatSchema = Type.Object({
	supportsStore: Type.Optional(Type.Boolean()),
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	supportsReasoningEffort: Type.Optional(Type.Boolean()),
	supportsUsageInStreaming: Type.Optional(Type.Boolean()),
	maxTokensField: Type.Optional(Type.Union([Type.Literal("max_completion_tokens"), Type.Literal("max_tokens")])),
	requiresToolResultName: Type.Optional(Type.Boolean()),
	requiresAssistantAfterToolResult: Type.Optional(Type.Boolean()),
	requiresThinkingAsText: Type.Optional(Type.Boolean()),
	requiresReasoningContentOnAssistantMessages: Type.Optional(Type.Boolean()),
	thinkingFormat: Type.Optional(
		Type.Union([
			Type.Literal("openai"),
			Type.Literal("openrouter"),
			Type.Literal("together"),
			Type.Literal("deepseek"),
			Type.Literal("zai"),
			Type.Literal("qwen"),
			Type.Literal("qwen-chat-template"),
		]),
	),
	cacheControlFormat: Type.Optional(Type.Literal("anthropic")),
	openRouterRouting: Type.Optional(OpenRouterRoutingSchema),
	vercelGatewayRouting: Type.Optional(VercelGatewayRoutingSchema),
	supportsStrictMode: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const OpenAIResponsesCompatSchema = Type.Object({
	supportsDeveloperRole: Type.Optional(Type.Boolean()),
	sendSessionIdHeader: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const AnthropicMessagesCompatSchema = Type.Object({
	supportsEagerToolInputStreaming: Type.Optional(Type.Boolean()),
	supportsLongCacheRetention: Type.Optional(Type.Boolean()),
});

const ProviderCompatSchema = Type.Union([
	OpenAICompletionsCompatSchema,
	OpenAIResponsesCompatSchema,
	AnthropicMessagesCompatSchema,
]);

// Schema for custom model definition
// Most fields are optional with sensible defaults for local models (Ollama, LM Studio, etc.)
const ModelDefinitionSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	name: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Number(),
			output: Type.Number(),
			cacheRead: Type.Number(),
			cacheWrite: Type.Number(),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

// Schema for per-model overrides (all fields optional, merged with built-in model)
const ModelOverrideSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	reasoning: Type.Optional(Type.Boolean()),
	thinkingLevelMap: Type.Optional(ThinkingLevelMapSchema),
	input: Type.Optional(Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")]))),
	cost: Type.Optional(
		Type.Object({
			input: Type.Optional(Type.Number()),
			output: Type.Optional(Type.Number()),
			cacheRead: Type.Optional(Type.Number()),
			cacheWrite: Type.Optional(Type.Number()),
		}),
	),
	contextWindow: Type.Optional(Type.Number()),
	maxTokens: Type.Optional(Type.Number()),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
});

type ModelOverride = Static<typeof ModelOverrideSchema>;

const ProviderConfigSchema = Type.Object({
	name: Type.Optional(Type.String({ minLength: 1 })),
	baseUrl: Type.Optional(Type.String({ minLength: 1 })),
	apiKey: Type.Optional(Type.String({ minLength: 1 })),
	api: Type.Optional(Type.String({ minLength: 1 })),
	headers: Type.Optional(Type.Record(Type.String(), Type.String())),
	compat: Type.Optional(ProviderCompatSchema),
	authHeader: Type.Optional(Type.Boolean()),
	models: Type.Optional(Type.Array(ModelDefinitionSchema)),
	modelOverrides: Type.Optional(Type.Record(Type.String(), ModelOverrideSchema)),
});

const ModelsConfigSchema = Type.Object({
	providers: Type.Record(Type.String(), ProviderConfigSchema),
});

const validateModelsConfig = Compile(ModelsConfigSchema);

type ModelsConfig = Static<typeof ModelsConfigSchema>;

const ROUTER_VIRTUAL_MODELS: Model<Api>[] = PIE_LAB_ROUTER_MODEL_IDS.map((id) => ({
	id,
	name: `Router ${id}`,
	api: PIE_LAB_ROUTER_PROVIDER,
	provider: PIE_LAB_ROUTER_PROVIDER,
	baseUrl: "",
	reasoning: id.includes("reasoning") || id.includes("coding"),
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200000,
	maxTokens: 32768,
}));

const LOCAL_AUTH_PROVIDERS = new Set(["claude-code-adk"]);

function formatValidationPath(error: TLocalizedValidationError): string {
	if (error.keyword === "required") {
		const requiredProperties = (error.params as { requiredProperties?: string[] }).requiredProperties;
		const requiredProperty = requiredProperties?.[0];
		if (requiredProperty) {
			const basePath = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
			return basePath ? `${basePath}.${requiredProperty}` : requiredProperty;
		}
	}
	const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
	return path || "root";
}

/** Provider override config (baseUrl, compat) without request auth/headers */
interface ProviderOverride {
	baseUrl?: string;
	compat?: Model<Api>["compat"];
}

interface ProviderRequestConfig {
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
}

function migrateLegacyRegisterProviderConfigValue(providerName: string, field: string, value: string): string {
	if (!isLegacyEnvVarNameConfigValue(value)) return value;
	warnDeprecation(
		`registerProvider("${providerName}") ${field} value "${value}" is treated as a legacy environment variable reference. This will no longer be detected as an environment variable reference in a future release. Pass "$${value}" instead.`,
	);
	return `$${value}`;
}

function migrateLegacyRegisterProviderHeaders(
	providerName: string,
	field: string,
	headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!headers) return undefined;
	let migratedHeaders: Record<string, string> | undefined;
	for (const [key, value] of Object.entries(headers)) {
		const migratedValue = migrateLegacyRegisterProviderConfigValue(providerName, `${field} header "${key}"`, value);
		if (migratedValue === value) continue;
		migratedHeaders ??= { ...headers };
		migratedHeaders[key] = migratedValue;
	}
	return migratedHeaders ?? headers;
}

function migrateLegacyRegisterProviderConfigValues(
	providerName: string,
	config: ProviderConfigInput,
): ProviderConfigInput {
	let migratedConfig: ProviderConfigInput | undefined;

	const setMigratedConfigValue = <TKey extends keyof ProviderConfigInput>(
		key: TKey,
		value: ProviderConfigInput[TKey],
	) => {
		migratedConfig ??= { ...config };
		migratedConfig[key] = value;
	};

	if (config.apiKey) {
		const apiKey = migrateLegacyRegisterProviderConfigValue(providerName, "apiKey", config.apiKey);
		if (apiKey !== config.apiKey) {
			setMigratedConfigValue("apiKey", apiKey);
		}
	}

	const headers = migrateLegacyRegisterProviderHeaders(providerName, "headers", config.headers);
	if (headers !== config.headers) {
		setMigratedConfigValue("headers", headers);
	}

	if (config.models) {
		let models: ProviderConfigInput["models"] | undefined;
		for (let index = 0; index < config.models.length; index++) {
			const model = config.models[index];
			const modelHeaders = migrateLegacyRegisterProviderHeaders(
				providerName,
				`model "${model.id}" headers`,
				model.headers,
			);
			if (modelHeaders === model.headers) continue;
			models ??= [...config.models];
			models[index] = { ...model, headers: modelHeaders };
		}
		if (models) {
			setMigratedConfigValue("models", models);
		}
	}

	return migratedConfig ?? config;
}

export type ResolvedRequestAuth =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
			connectionId?: string;
	  }
	| {
			ok: false;
			error: string;
	  };

export interface ModelRegistryOptions {
	providerConnectionStore?: ProviderConnectionStore;
	prepareProviderConnections?: (options: {
		provider: string;
		model: Model<Api>;
		connections: ProviderConnection[];
		settings: ProviderConnectionSettings;
	}) => Promise<ProviderConnection[]>;
}

type ProviderConnectionAuthResult =
	| {
			status: "selected";
			apiKey: string;
			connectionId: string;
	  }
	| {
			status: "unavailable";
			error: string;
	  }
	| {
			status: "missing";
	  };

const PIE_LAB_AUTH_STORAGE_SOURCE = "auth.json";
const LEGACY_QUOTA_SELECTION_KEY = "pieAdkQuotaSelection";

/** Result of loading custom models from models.json */
interface CustomModelsResult {
	models: Model<Api>[];
	/** Providers with baseUrl/headers/apiKey overrides for built-in models */
	overrides: Map<string, ProviderOverride>;
	/** Per-model overrides: provider -> modelId -> override */
	modelOverrides: Map<string, Map<string, ModelOverride>>;
	error: string | undefined;
}

function emptyCustomModelsResult(error?: string): CustomModelsResult {
	return { models: [], overrides: new Map(), modelOverrides: new Map(), error };
}

function mergeCompat(
	baseCompat: Model<Api>["compat"],
	overrideCompat: ModelOverride["compat"],
): Model<Api>["compat"] | undefined {
	if (!overrideCompat) return baseCompat;

	const base = baseCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat | undefined;
	const override = overrideCompat as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;
	const merged = { ...base, ...override } as OpenAICompletionsCompat | OpenAIResponsesCompat | AnthropicMessagesCompat;

	const baseCompletions = base as OpenAICompletionsCompat | undefined;
	const overrideCompletions = override as OpenAICompletionsCompat;
	const mergedCompletions = merged as OpenAICompletionsCompat;

	if (baseCompletions?.openRouterRouting || overrideCompletions.openRouterRouting) {
		mergedCompletions.openRouterRouting = {
			...baseCompletions?.openRouterRouting,
			...overrideCompletions.openRouterRouting,
		};
	}

	if (baseCompletions?.vercelGatewayRouting || overrideCompletions.vercelGatewayRouting) {
		mergedCompletions.vercelGatewayRouting = {
			...baseCompletions?.vercelGatewayRouting,
			...overrideCompletions.vercelGatewayRouting,
		};
	}

	return merged as Model<Api>["compat"];
}

/**
 * Deep merge a model override into a model.
 * Handles nested objects (cost, compat) by merging rather than replacing.
 */
function applyModelOverride(model: Model<Api>, override: ModelOverride): Model<Api> {
	const result = { ...model };

	// Simple field overrides
	if (override.name !== undefined) result.name = override.name;
	if (override.reasoning !== undefined) result.reasoning = override.reasoning;
	if (override.thinkingLevelMap !== undefined) {
		result.thinkingLevelMap = { ...model.thinkingLevelMap, ...override.thinkingLevelMap };
	}
	if (override.input !== undefined) result.input = override.input as ("text" | "image")[];
	if (override.contextWindow !== undefined) result.contextWindow = override.contextWindow;
	if (override.maxTokens !== undefined) result.maxTokens = override.maxTokens;

	// Merge cost (partial override)
	if (override.cost) {
		result.cost = {
			input: override.cost.input ?? model.cost.input,
			output: override.cost.output ?? model.cost.output,
			cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
			cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
		};
	}

	// Deep merge compat
	result.compat = mergeCompat(model.compat, override.compat);

	return result;
}

/** Clear the config value command cache. Exported for testing. */
export const clearApiKeyCache = clearConfigValueCache;

/**
 * Model registry - loads and manages models, resolves API keys via AuthStorage.
 */
export class ModelRegistry {
	private models: Model<Api>[] = [];
	private providerRequestConfigs: Map<string, ProviderRequestConfig> = new Map();
	private modelRequestHeaders: Map<string, Record<string, string>> = new Map();
	private registeredProviders: Map<string, ProviderConfigInput> = new Map();
	private loadError: string | undefined = undefined;
	private providerConnectionStore: ProviderConnectionStore | undefined;
	private prepareProviderConnections: ModelRegistryOptions["prepareProviderConnections"] | undefined;
	readonly authStorage: AuthStorage;
	private modelsJsonPath: string | undefined;

	private constructor(
		authStorage: AuthStorage,
		modelsJsonPath: string | undefined,
		options: ModelRegistryOptions = {},
	) {
		this.authStorage = authStorage;
		this.modelsJsonPath = modelsJsonPath ? normalizePath(modelsJsonPath) : undefined;
		this.providerConnectionStore = options.providerConnectionStore;
		this.prepareProviderConnections = options.prepareProviderConnections;
		this.loadModels();
	}

	static create(
		authStorage: AuthStorage,
		modelsJsonPath: string = join(getAgentDir(), "models.json"),
		options: ModelRegistryOptions = {},
	): ModelRegistry {
		return new ModelRegistry(authStorage, modelsJsonPath, options);
	}

	static inMemory(authStorage: AuthStorage, options: ModelRegistryOptions = {}): ModelRegistry {
		return new ModelRegistry(authStorage, undefined, options);
	}

	setProviderConnectionStore(providerConnectionStore: ProviderConnectionStore | undefined): void {
		this.providerConnectionStore = providerConnectionStore;
	}

	async getRouterPolicy(): Promise<PiRouterPolicy | undefined> {
		if (!this.providerConnectionStore) return undefined;
		const settings = await this.providerConnectionStore.getSettings();
		return settings.routerPolicy as PiRouterPolicy | undefined;
	}

	async syncAuthStorageProviderConnections(provider?: string): Promise<void> {
		if (!this.providerConnectionStore) {
			return;
		}

		this.authStorage.reload();
		const providers = provider === undefined ? await this.getAuthStorageSyncedProviders() : [provider];
		await Promise.all(providers.map((providerName) => this.syncAuthStorageProviderConnection(providerName)));
	}

	async markProviderConnectionUnavailable(
		connectionId: string | undefined,
		model: Model<Api>,
		error: unknown,
	): Promise<void> {
		if (!this.providerConnectionStore || !connectionId) {
			return;
		}

		const connection = await this.providerConnectionStore.getProviderConnectionById(connectionId);
		if (!connection) {
			return;
		}

		const status = extractProviderErrorStatus(error);
		const message = providerErrorText(error);
		const backoffLevel = typeof connection.backoffLevel === "number" ? connection.backoffLevel : 0;
		const resetCooldownMs = extractProviderResetCooldownMs(error);
		const decision =
			resetCooldownMs !== null
				? { shouldFallback: true, cooldownMs: resetCooldownMs, newBackoffLevel: 0 }
				: checkFallbackError(status, message, backoffLevel);
		if (!decision.shouldFallback) {
			return;
		}

		await this.providerConnectionStore.updateProviderConnection(connectionId, {
			...buildModelLockUpdate(model.id, decision.cooldownMs),
			testStatus: "unavailable",
			lastError: message.slice(0, 100),
			errorCode: status,
			lastErrorAt: new Date().toISOString(),
			backoffLevel: decision.newBackoffLevel ?? backoffLevel,
		});
	}

	async clearProviderConnectionError(connectionId: string | undefined, model: Model<Api>): Promise<void> {
		if (!this.providerConnectionStore || !connectionId) {
			return;
		}

		const connection = await this.providerConnectionStore.getProviderConnectionById(connectionId);
		if (!connection) {
			return;
		}

		const updates: Record<string, unknown> = {};
		const now = Date.now();
		const currentModelLockKey = getModelLockKey(model.id);

		for (const [key, value] of Object.entries(connection)) {
			if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
			if (key === currentModelLockKey || key === MODEL_LOCK_ALL || isExpiredLock(value, now)) {
				updates[key] = null;
			}
		}

		if (!hasActiveLockAfterUpdates(connection, updates, now)) {
			updates.testStatus = null;
			updates.lastError = null;
			updates.errorCode = null;
			updates.lastErrorAt = null;
			updates.backoffLevel = 0;
		}

		if (Object.keys(updates).length > 0) {
			await this.providerConnectionStore.updateProviderConnection(connectionId, updates);
		}
	}

	/**
	 * Reload models from disk (built-in + custom from models.json).
	 */
	refresh(): void {
		this.providerRequestConfigs.clear();
		this.modelRequestHeaders.clear();
		this.loadError = undefined;

		// Ensure dynamic API/OAuth registrations are rebuilt from current provider state.
		resetApiProviders();
		resetOAuthProviders();

		this.loadModels();

		for (const [providerName, config] of this.registeredProviders.entries()) {
			this.applyProviderConfig(providerName, config);
		}
	}

	/**
	 * Get any error from loading models.json (undefined if no error).
	 */
	getError(): string | undefined {
		return this.loadError;
	}

	private loadModels(): void {
		// Load custom models and overrides from models.json
		const {
			models: customModels,
			overrides,
			modelOverrides,
			error,
		} = this.modelsJsonPath ? this.loadCustomModels(this.modelsJsonPath) : emptyCustomModelsResult();

		if (error) {
			this.loadError = error;
			// Keep built-in models even if custom models failed to load
		}

		const builtInModels = this.loadBuiltInModels(overrides, modelOverrides);
		let combined = this.mergeCustomModels(builtInModels, customModels);

		// Let OAuth providers modify their models (e.g., update baseUrl)
		for (const oauthProvider of this.authStorage.getOAuthProviders()) {
			const cred = this.authStorage.get(oauthProvider.id);
			if (cred?.type === "oauth" && oauthProvider.modifyModels) {
				combined = oauthProvider.modifyModels(combined, cred);
			}
		}

		this.models = this.withRouterVirtualModels(combined);
	}

	private withRouterVirtualModels(models: Model<Api>[]): Model<Api>[] {
		const withoutRouter = models.filter((model) => model.provider !== PIE_LAB_ROUTER_PROVIDER);
		return [...withoutRouter, ...ROUTER_VIRTUAL_MODELS];
	}

	/** Load built-in models and apply provider/model overrides */
	private loadBuiltInModels(
		overrides: Map<string, ProviderOverride>,
		modelOverrides: Map<string, Map<string, ModelOverride>>,
	): Model<Api>[] {
		return getProviders().flatMap((provider) => {
			const models = getModels(provider as KnownProvider) as Model<Api>[];
			const providerOverride = overrides.get(provider);
			const perModelOverrides = modelOverrides.get(provider);

			return models.map((m) => {
				let model = m;

				// Apply provider-level baseUrl/headers/compat override
				if (providerOverride) {
					model = {
						...model,
						baseUrl: providerOverride.baseUrl ?? model.baseUrl,
						compat: mergeCompat(model.compat, providerOverride.compat),
					};
				}

				// Apply per-model override
				const modelOverride = perModelOverrides?.get(m.id);
				if (modelOverride) {
					model = applyModelOverride(model, modelOverride);
				}

				return model;
			});
		});
	}

	/** Merge custom models into built-in list by provider+id (custom wins on conflicts). */
	private mergeCustomModels(builtInModels: Model<Api>[], customModels: Model<Api>[]): Model<Api>[] {
		const merged = [...builtInModels];
		for (const customModel of customModels) {
			const existingIndex = merged.findIndex((m) => m.provider === customModel.provider && m.id === customModel.id);
			if (existingIndex >= 0) {
				merged[existingIndex] = customModel;
			} else {
				merged.push(customModel);
			}
		}
		return merged;
	}

	private loadCustomModels(modelsJsonPath: string): CustomModelsResult {
		if (!existsSync(modelsJsonPath)) {
			return emptyCustomModelsResult();
		}

		try {
			const content = readFileSync(modelsJsonPath, "utf-8");
			const parsed = JSON.parse(stripJsonComments(content)) as unknown;

			if (!validateModelsConfig.Check(parsed)) {
				const errors =
					validateModelsConfig
						.Errors(parsed)
						.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
						.join("\n") || "Unknown schema error";
				return emptyCustomModelsResult(`Invalid models.json schema:\n${errors}\n\nFile: ${modelsJsonPath}`);
			}

			const config = parsed as ModelsConfig;

			// Additional validation
			this.validateConfig(config);

			const overrides = new Map<string, ProviderOverride>();
			const modelOverrides = new Map<string, Map<string, ModelOverride>>();

			for (const [providerName, providerConfig] of Object.entries(config.providers)) {
				if (providerConfig.baseUrl || providerConfig.compat) {
					overrides.set(providerName, {
						baseUrl: providerConfig.baseUrl,
						compat: providerConfig.compat,
					});
				}

				this.storeProviderRequestConfig(providerName, providerConfig);

				if (providerConfig.modelOverrides) {
					modelOverrides.set(providerName, new Map(Object.entries(providerConfig.modelOverrides)));
					for (const [modelId, modelOverride] of Object.entries(providerConfig.modelOverrides)) {
						this.storeModelHeaders(providerName, modelId, modelOverride.headers);
					}
				}
			}

			return { models: this.parseModels(config), overrides, modelOverrides, error: undefined };
		} catch (error) {
			if (error instanceof SyntaxError) {
				return emptyCustomModelsResult(`Failed to parse models.json: ${error.message}\n\nFile: ${modelsJsonPath}`);
			}
			return emptyCustomModelsResult(
				`Failed to load models.json: ${error instanceof Error ? error.message : error}\n\nFile: ${modelsJsonPath}`,
			);
		}
	}

	private validateConfig(config: ModelsConfig): void {
		const builtInProviders = new Set<string>(getProviders());

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const isBuiltIn = builtInProviders.has(providerName);
			const hasProviderApi = !!providerConfig.api;
			const models = providerConfig.models ?? [];
			const hasModelOverrides =
				providerConfig.modelOverrides && Object.keys(providerConfig.modelOverrides).length > 0;

			if (models.length === 0) {
				// Override-only config: needs baseUrl, headers, compat, modelOverrides, or some combination.
				if (!providerConfig.baseUrl && !providerConfig.headers && !providerConfig.compat && !hasModelOverrides) {
					throw new Error(
						`Provider ${providerName}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
					);
				}
			} else if (!isBuiltIn) {
				// Non-built-in providers with custom models require endpoint + auth.
				if (!providerConfig.baseUrl) {
					throw new Error(`Provider ${providerName}: "baseUrl" is required when defining custom models.`);
				}
				if (!providerConfig.apiKey) {
					throw new Error(`Provider ${providerName}: "apiKey" is required when defining custom models.`);
				}
			}
			// Built-in providers with custom models: baseUrl/apiKey/api are optional,
			// inherited from built-in models. Auth comes from env vars / auth storage.

			for (const modelDef of models) {
				const hasModelApi = !!modelDef.api;

				if (!hasProviderApi && !hasModelApi && !isBuiltIn) {
					throw new Error(
						`Provider ${providerName}, model ${modelDef.id}: no "api" specified. Set at provider or model level.`,
					);
				}
				// For built-in providers, api is optional — inherited from built-in models.

				if (!modelDef.id) throw new Error(`Provider ${providerName}: model missing "id"`);
				// Validate contextWindow/maxTokens only if provided (they have defaults)
				if (modelDef.contextWindow !== undefined && modelDef.contextWindow <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid contextWindow`);
				if (modelDef.maxTokens !== undefined && modelDef.maxTokens <= 0)
					throw new Error(`Provider ${providerName}, model ${modelDef.id}: invalid maxTokens`);
			}
		}
	}

	private parseModels(config: ModelsConfig): Model<Api>[] {
		const models: Model<Api>[] = [];
		const builtInProviders = new Set<string>(getProviders());

		// Cache built-in defaults (api, baseUrl) per provider, extracted from first model.
		const builtInDefaultsCache = new Map<string, { api: string; baseUrl: string }>();
		const getBuiltInDefaults = (providerName: string): { api: string; baseUrl: string } | undefined => {
			if (!builtInProviders.has(providerName)) return undefined;
			if (builtInDefaultsCache.has(providerName)) return builtInDefaultsCache.get(providerName);
			const builtIn = getModels(providerName as KnownProvider) as Model<Api>[];
			if (builtIn.length === 0) return undefined;
			const defaults = { api: builtIn[0].api, baseUrl: builtIn[0].baseUrl };
			builtInDefaultsCache.set(providerName, defaults);
			return defaults;
		};

		for (const [providerName, providerConfig] of Object.entries(config.providers)) {
			const modelDefs = providerConfig.models ?? [];
			if (modelDefs.length === 0) continue; // Override-only, no custom models

			const builtInDefaults = getBuiltInDefaults(providerName);

			for (const modelDef of modelDefs) {
				const api = modelDef.api ?? providerConfig.api ?? builtInDefaults?.api;
				if (!api) continue;

				const baseUrl = modelDef.baseUrl ?? providerConfig.baseUrl ?? builtInDefaults?.baseUrl;
				if (!baseUrl) continue;

				const compat = mergeCompat(providerConfig.compat, modelDef.compat);
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				const defaultCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
				models.push({
					id: modelDef.id,
					name: modelDef.name ?? modelDef.id,
					api: api as Api,
					provider: providerName,
					baseUrl,
					reasoning: modelDef.reasoning ?? false,
					thinkingLevelMap: modelDef.thinkingLevelMap,
					input: (modelDef.input ?? ["text"]) as ("text" | "image")[],
					cost: modelDef.cost ?? defaultCost,
					contextWindow: modelDef.contextWindow ?? 128000,
					maxTokens: modelDef.maxTokens ?? 16384,
					headers: undefined,
					compat,
				} as Model<Api>);
			}
		}

		return models;
	}

	/**
	 * Get all models (built-in + custom).
	 * If models.json had errors, returns only built-in models.
	 */
	getAll(): Model<Api>[] {
		return this.models;
	}

	/**
	 * Get only models that have auth configured.
	 * This is a fast check that doesn't refresh OAuth tokens.
	 */
	getAvailable(): Model<Api>[] {
		return this.models.filter((m) => this.hasConfiguredAuth(m));
	}

	/**
	 * Find a model by provider and ID.
	 */
	find(provider: string, modelId: string): Model<Api> | undefined {
		return this.models.find((m) => m.provider === provider && m.id === modelId);
	}

	/**
	 * Get API key for a model.
	 */
	hasConfiguredAuth(model: Model<Api>): boolean {
		if (LOCAL_AUTH_PROVIDERS.has(model.provider)) {
			return true;
		}
		if (model.provider === PIE_LAB_ROUTER_PROVIDER) {
			return this.models.some(
				(m) =>
					m.provider !== PIE_LAB_ROUTER_PROVIDER &&
					(LOCAL_AUTH_PROVIDERS.has(m.provider) ||
						this.authStorage.hasAuth(m.provider) ||
						this.providerRequestConfigs.get(m.provider)?.apiKey !== undefined),
			);
		}
		const providerApiKey = this.providerRequestConfigs.get(model.provider)?.apiKey;
		return (
			this.authStorage.hasAuth(model.provider) ||
			(providerApiKey !== undefined && isConfigValueConfigured(providerApiKey))
		);
	}

	/**
	 * Check whether a provider authenticates through local runtime state rather than request credentials.
	 */
	usesLocalAuthProvider(model: Model<Api>): boolean {
		return LOCAL_AUTH_PROVIDERS.has(model.provider);
	}

	private getModelRequestKey(provider: string, modelId: string): string {
		return `${provider}:${modelId}`;
	}

	private storeProviderRequestConfig(
		providerName: string,
		config: {
			apiKey?: string;
			headers?: Record<string, string>;
			authHeader?: boolean;
		},
	): void {
		if (!config.apiKey && !config.headers && !config.authHeader) {
			return;
		}

		this.providerRequestConfigs.set(providerName, {
			apiKey: config.apiKey,
			headers: config.headers,
			authHeader: config.authHeader,
		});
	}

	private storeModelHeaders(providerName: string, modelId: string, headers?: Record<string, string>): void {
		const key = this.getModelRequestKey(providerName, modelId);
		if (!headers || Object.keys(headers).length === 0) {
			this.modelRequestHeaders.delete(key);
			return;
		}
		this.modelRequestHeaders.set(key, headers);
	}

	/**
	 * Get API key and request headers for a model.
	 */
	async getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth> {
		try {
			if (LOCAL_AUTH_PROVIDERS.has(model.provider)) {
				return { ok: true };
			}
			const providerConfig = this.providerRequestConfigs.get(model.provider);
			const providerConnectionAuth = await this.getProviderConnectionAuth(model);
			if (providerConnectionAuth.status === "unavailable") {
				return { ok: false, error: providerConnectionAuth.error };
			}
			const apiKeyFromAuthStorage =
				providerConnectionAuth.status === "selected"
					? undefined
					: await this.authStorage.getApiKey(model.provider, { includeFallback: false });
			const apiKey =
				providerConnectionAuth.status === "selected"
					? providerConnectionAuth.apiKey
					: (apiKeyFromAuthStorage ??
						(providerConfig?.apiKey
							? resolveConfigValueOrThrow(providerConfig.apiKey, `API key for provider "${model.provider}"`)
							: undefined));

			const providerHeaders = resolveHeadersOrThrow(providerConfig?.headers, `provider "${model.provider}"`);
			const modelHeaders = resolveHeadersOrThrow(
				this.modelRequestHeaders.get(this.getModelRequestKey(model.provider, model.id)),
				`model "${model.provider}/${model.id}"`,
			);

			let headers =
				model.headers || providerHeaders || modelHeaders
					? { ...model.headers, ...providerHeaders, ...modelHeaders }
					: undefined;

			if (providerConfig?.authHeader) {
				if (!apiKey) {
					return { ok: false, error: `No API key found for "${model.provider}"` };
				}
				headers = { ...headers, Authorization: `Bearer ${apiKey}` };
			}

			return {
				ok: true,
				apiKey,
				headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
				connectionId:
					providerConnectionAuth.status === "selected" ? providerConnectionAuth.connectionId : undefined,
			};
		} catch (error) {
			return {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async getProviderConnectionAuth(model: Model<Api>): Promise<ProviderConnectionAuthResult> {
		if (!this.providerConnectionStore) {
			return { status: "missing" };
		}

		this.authStorage.reload();
		await this.syncAuthStorageProviderConnection(model.provider);

		let connections = await this.providerConnectionStore.getProviderConnections({
			provider: model.provider,
			isActive: true,
		});
		if (connections.length === 0) {
			return { status: "missing" };
		}

		const settings = await this.providerConnectionStore.getSettings();
		if (this.prepareProviderConnections) {
			connections = await this.prepareProviderConnections({
				provider: model.provider,
				model,
				connections,
				settings,
			});
		}
		const selection = selectProviderConnection({
			provider: model.provider,
			model: model.id,
			connections,
			settings,
		});

		if (selection.status === "unavailable") {
			return {
				status: "unavailable",
				error: `All provider connections for "${model.provider}" are unavailable (${selection.retryAfterHuman}).`,
			};
		}

		if (selection.status === "missing") {
			return { status: "missing" };
		}

		if (selection.updates) {
			await this.providerConnectionStore.updateProviderConnection(selection.connection.id, selection.updates);
		}

		const apiKey = await this.resolveProviderConnectionApiKey(selection.connection);
		if (!apiKey) {
			return {
				status: "unavailable",
				error: `Provider connection "${selection.connection.id}" for "${model.provider}" has no apiKey or accessToken.`,
			};
		}

		return {
			status: "selected",
			apiKey,
			connectionId: selection.connection.id,
		};
	}

	private async syncAuthStorageProviderConnection(provider: string): Promise<void> {
		if (!this.providerConnectionStore) {
			return;
		}

		const credential = this.authStorage.get(provider);
		const syncedConnections = (await this.providerConnectionStore.getProviderConnections({ provider })).filter(
			isAuthStorageSyncedConnection,
		);
		if (!credential) {
			await Promise.all(
				syncedConnections.map((connection) =>
					this.updateProviderConnectionIfChanged(connection, buildAuthStorageConnectionDeactivation(connection)),
				),
			);
			return;
		}

		const [primaryConnection, ...duplicateConnections] = syncedConnections;
		if (!primaryConnection) {
			await this.providerConnectionStore.createProviderConnection({
				...createAuthStorageProviderConnectionInput(provider, credential),
				...buildAuthStorageConnectionReset(),
			});
		} else {
			await this.updateProviderConnectionIfChanged(
				primaryConnection,
				createAuthStorageProviderConnectionUpdate(primaryConnection, credential),
			);
		}

		await Promise.all(
			duplicateConnections.map((connection) =>
				this.updateProviderConnectionIfChanged(connection, buildAuthStorageConnectionDeactivation(connection)),
			),
		);
	}

	private async getAuthStorageSyncedProviders(): Promise<string[]> {
		if (!this.providerConnectionStore) {
			return [];
		}

		const providers = new Set(this.authStorage.list());
		const connections = await this.providerConnectionStore.getProviderConnections();
		for (const connection of connections) {
			if (isAuthStorageSyncedConnection(connection)) {
				providers.add(connection.provider);
			}
		}

		return [...providers];
	}

	private async updateProviderConnectionIfChanged(
		connection: ProviderConnection,
		updates: UpdateProviderConnectionInput,
	): Promise<void> {
		if (!this.providerConnectionStore || !hasProviderConnectionUpdate(connection, updates)) {
			return;
		}

		await this.providerConnectionStore.updateProviderConnection(connection.id, updates);
	}

	private async resolveProviderConnectionApiKey(connection: ProviderConnection): Promise<string | undefined> {
		if (isAuthStorageSyncedConnection(connection)) {
			return (
				(await this.authStorage.getApiKey(connection.provider, { includeFallback: false })) ??
				resolveRawProviderConnectionApiKey(connection)
			);
		}

		return resolveRawProviderConnectionApiKey(connection);
	}

	/**
	 * Return auth status for a provider, including request auth configured in models.json.
	 * This intentionally does not execute command-backed config values.
	 */
	getProviderAuthStatus(provider: string): AuthStatus {
		if (LOCAL_AUTH_PROVIDERS.has(provider)) {
			return { configured: true, source: "local" };
		}

		const authStatus = this.authStorage.getAuthStatus(provider);
		if (authStatus.source) {
			return authStatus;
		}

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		if (!providerApiKey) {
			return authStatus;
		}

		if (isCommandConfigValue(providerApiKey)) {
			return { configured: true, source: "models_json_command" };
		}

		const envVarNames = getConfigValueEnvVarNames(providerApiKey);
		if (envVarNames.length > 0) {
			return isConfigValueConfigured(providerApiKey)
				? { configured: true, source: "environment", label: envVarNames.join(", ") }
				: { configured: false };
		}

		return { configured: true, source: "models_json_key" };
	}

	/**
	 * Get display name for a provider.
	 */
	getProviderDisplayName(provider: string): string {
		const registeredProvider = this.registeredProviders.get(provider);
		const oauthProvider = this.authStorage.getOAuthProviders().find((p) => p.id === provider);

		return (
			registeredProvider?.name ??
			registeredProvider?.oauth?.name ??
			oauthProvider?.name ??
			BUILT_IN_PROVIDER_DISPLAY_NAMES[provider] ??
			provider
		);
	}

	/**
	 * Get API key for a provider.
	 */
	async getApiKeyForProvider(provider: string): Promise<string | undefined> {
		const apiKey = await this.authStorage.getApiKey(provider, { includeFallback: false });
		if (apiKey !== undefined) {
			return apiKey;
		}

		const providerApiKey = this.providerRequestConfigs.get(provider)?.apiKey;
		return providerApiKey ? resolveConfigValueUncached(providerApiKey) : undefined;
	}

	/**
	 * Check if a model is using OAuth credentials (subscription).
	 */
	isUsingOAuth(model: Model<Api>): boolean {
		const cred = this.authStorage.get(model.provider);
		return cred?.type === "oauth";
	}

	/**
	 * Register a provider dynamically (from extensions).
	 *
	 * If provider has models: replaces all existing models for this provider.
	 * If provider has only baseUrl/headers: overrides existing models' URLs.
	 * If provider has oauth: registers OAuth provider for /login support.
	 */
	registerProvider(providerName: string, config: ProviderConfigInput): void {
		const migratedConfig = migrateLegacyRegisterProviderConfigValues(providerName, config);
		this.validateProviderConfig(providerName, migratedConfig);
		this.applyProviderConfig(providerName, migratedConfig);
		this.upsertRegisteredProvider(providerName, migratedConfig);
	}

	/**
	 * Unregister a previously registered provider.
	 *
	 * Removes the provider from the registry and reloads models from disk so that
	 * built-in models overridden by this provider are restored to their original state.
	 * Also resets dynamic OAuth and API stream registrations before reapplying
	 * remaining dynamic providers.
	 * Has no effect if the provider was never registered.
	 */
	unregisterProvider(providerName: string): void {
		if (!this.registeredProviders.has(providerName)) return;
		this.registeredProviders.delete(providerName);
		this.refresh();
	}

	/**
	 * Upsert a provider config into registeredProviders.
	 * If the provider is already registered, defined values in the incoming config
	 * override existing ones; undefined values are preserved from the stored config.
	 * If the provider is not registered, the incoming config is stored as-is.
	 */
	private upsertRegisteredProvider(providerName: string, config: ProviderConfigInput): void {
		const existing = this.registeredProviders.get(providerName);
		if (!existing) {
			this.registeredProviders.set(providerName, config);
			return;
		}
		for (const k of Object.keys(config) as (keyof ProviderConfigInput)[]) {
			if (config[k] !== undefined) {
				(existing as Record<string, unknown>)[k] = config[k];
			}
		}
	}

	private validateProviderConfig(providerName: string, config: ProviderConfigInput): void {
		if (config.streamSimple && !config.api) {
			throw new Error(`Provider ${providerName}: "api" is required when registering streamSimple.`);
		}

		if (!config.models || config.models.length === 0) {
			return;
		}

		if (!config.baseUrl) {
			throw new Error(`Provider ${providerName}: "baseUrl" is required when defining models.`);
		}
		if (!config.apiKey && !config.oauth) {
			throw new Error(`Provider ${providerName}: "apiKey" or "oauth" is required when defining models.`);
		}

		for (const modelDef of config.models) {
			const api = modelDef.api || config.api;
			if (!api) {
				throw new Error(`Provider ${providerName}, model ${modelDef.id}: no "api" specified.`);
			}
		}
	}

	private applyProviderConfig(providerName: string, config: ProviderConfigInput): void {
		// Register OAuth provider if provided
		if (config.oauth) {
			// Ensure the OAuth provider ID matches the provider name
			const oauthProvider: OAuthProviderInterface = {
				...config.oauth,
				id: providerName,
			};
			registerOAuthProvider(oauthProvider);
		}

		if (config.streamSimple) {
			const streamSimple = config.streamSimple;
			registerApiProvider(
				{
					api: config.api!,
					stream: (model, context, options) => streamSimple(model, context, options as SimpleStreamOptions),
					streamSimple,
				},
				`provider:${providerName}`,
			);
		}

		this.storeProviderRequestConfig(providerName, config);

		if (config.models && config.models.length > 0) {
			// Full replacement: remove existing models for this provider
			this.models = this.models.filter((m) => m.provider !== providerName);

			// Parse and add new models
			for (const modelDef of config.models) {
				const api = modelDef.api || config.api;
				this.storeModelHeaders(providerName, modelDef.id, modelDef.headers);

				this.models.push({
					id: modelDef.id,
					name: modelDef.name,
					api: api as Api,
					provider: providerName,
					baseUrl: modelDef.baseUrl ?? config.baseUrl!,
					reasoning: modelDef.reasoning,
					thinkingLevelMap: modelDef.thinkingLevelMap,
					input: modelDef.input as ("text" | "image")[],
					cost: modelDef.cost,
					contextWindow: modelDef.contextWindow,
					maxTokens: modelDef.maxTokens,
					headers: undefined,
					compat: modelDef.compat,
				} as Model<Api>);
			}

			// Apply OAuth modifyModels if credentials exist (e.g., to update baseUrl)
			if (config.oauth?.modifyModels) {
				const cred = this.authStorage.get(providerName);
				if (cred?.type === "oauth") {
					this.models = config.oauth.modifyModels(this.models, cred);
				}
			}
		} else if (config.baseUrl || config.headers) {
			// Override-only: update baseUrl for existing models. Request headers are resolved per request.
			this.models = this.models.map((m) => {
				if (m.provider !== providerName) return m;
				return {
					...m,
					baseUrl: config.baseUrl ?? m.baseUrl,
				};
			});
		}
	}
}

function createAuthStorageProviderConnectionInput(
	provider: string,
	credential: AuthCredential,
): CreateProviderConnectionInput {
	return {
		provider,
		name: getAuthStorageConnectionName(credential),
		isActive: true,
		...createAuthStorageCredentialFields(credential),
		providerSpecificData: createAuthStorageProviderSpecificData(undefined, credential, {
			clearQuotaSelection: false,
		}),
	};
}

function createAuthStorageProviderConnectionUpdate(
	connection: ProviderConnection,
	credential: AuthCredential,
): UpdateProviderConnectionInput {
	const credentialChanged = !authStorageConnectionCredentialMatches(connection, credential);
	const reactivating = connection.isActive !== true;
	return {
		name: connection.name ?? getAuthStorageConnectionName(credential),
		isActive: true,
		...createAuthStorageCredentialFields(credential),
		providerSpecificData: createAuthStorageProviderSpecificData(connection.providerSpecificData, credential, {
			clearQuotaSelection: credentialChanged,
		}),
		...(credentialChanged || reactivating ? buildAuthStorageConnectionReset(connection) : {}),
	};
}

function buildAuthStorageConnectionDeactivation(connection: ProviderConnection): UpdateProviderConnectionInput {
	return {
		isActive: false,
		apiKey: null,
		accessToken: null,
		refreshToken: null,
		providerSpecificData: createInactiveAuthStorageProviderSpecificData(connection.providerSpecificData),
		...buildAuthStorageConnectionReset(connection),
	};
}

function buildAuthStorageConnectionReset(connection?: ProviderConnection): UpdateProviderConnectionInput {
	return {
		testStatus: null,
		lastError: null,
		errorCode: null,
		lastErrorAt: null,
		backoffLevel: 0,
		...buildModelLockClearUpdates(connection),
	};
}

function createAuthStorageCredentialFields(
	credential: AuthCredential,
): Pick<UpdateProviderConnectionInput, "authType" | "apiKey" | "accessToken" | "refreshToken"> {
	if (credential.type === "api_key") {
		return {
			authType: "apikey",
			apiKey: credential.key,
			accessToken: null,
			refreshToken: null,
		};
	}

	return {
		authType: "oauth",
		apiKey: null,
		accessToken: credential.access,
		refreshToken: credential.refresh,
	};
}

function createAuthStorageProviderSpecificData(
	value: ProviderConnection["providerSpecificData"],
	credential: AuthCredential,
	options: { clearQuotaSelection: boolean },
): Record<string, unknown> {
	const data = isRecord(value) ? { ...value } : {};
	data.source = PIE_LAB_AUTH_STORAGE_SOURCE;
	delete data.authDeletedAt;
	if (options.clearQuotaSelection) {
		delete data[PIE_LAB_QUOTA_SELECTION_KEY];
		delete data[LEGACY_QUOTA_SELECTION_KEY];
	}
	if (credential.type === "oauth") {
		data.expires = credential.expires;
	} else {
		delete data.expires;
	}
	return data;
}

function createInactiveAuthStorageProviderSpecificData(
	value: ProviderConnection["providerSpecificData"],
): Record<string, unknown> {
	const data = isRecord(value) ? { ...value } : {};
	data.source = PIE_LAB_AUTH_STORAGE_SOURCE;
	data.authDeletedAt =
		typeof data.authDeletedAt === "string" && data.authDeletedAt.length > 0
			? data.authDeletedAt
			: new Date().toISOString();
	return data;
}

function buildModelLockClearUpdates(connection: ProviderConnection | undefined): UpdateProviderConnectionInput {
	if (!connection) {
		return {};
	}

	const updates: UpdateProviderConnectionInput = {};
	for (const [key, value] of Object.entries(connection)) {
		if (key.startsWith(MODEL_LOCK_PREFIX) && value !== null) {
			updates[key] = null;
		}
	}
	return updates;
}

function getAuthStorageConnectionName(credential: AuthCredential): string {
	return credential.type === "api_key" ? "auth.json API key" : "auth.json OAuth";
}

function authStorageConnectionCredentialMatches(connection: ProviderConnection, credential: AuthCredential): boolean {
	if (credential.type === "api_key") {
		return (
			connection.authType === "apikey" &&
			connection.apiKey === credential.key &&
			(connection.accessToken ?? null) === null &&
			(connection.refreshToken ?? null) === null
		);
	}

	const data = isRecord(connection.providerSpecificData) ? connection.providerSpecificData : {};
	return (
		connection.authType === "oauth" &&
		(connection.apiKey ?? null) === null &&
		connection.accessToken === credential.access &&
		connection.refreshToken === credential.refresh &&
		data.expires === credential.expires
	);
}

function isAuthStorageSyncedConnection(connection: ProviderConnection): boolean {
	return (
		typeof connection.providerSpecificData === "object" &&
		connection.providerSpecificData !== null &&
		connection.providerSpecificData.source === PIE_LAB_AUTH_STORAGE_SOURCE
	);
}

function resolveRawProviderConnectionApiKey(connection: ProviderConnection): string | undefined {
	const rawCredential =
		typeof connection.apiKey === "string" && connection.apiKey.length > 0
			? connection.apiKey
			: typeof connection.accessToken === "string" && connection.accessToken.length > 0
				? connection.accessToken
				: undefined;

	return rawCredential
		? resolveConfigValueOrThrow(rawCredential, `credential for provider connection "${connection.id}"`)
		: undefined;
}

function hasProviderConnectionUpdate(connection: ProviderConnection, updates: UpdateProviderConnectionInput): boolean {
	for (const [key, value] of Object.entries(updates)) {
		if (!unknownValuesEqual(connection[key], value)) {
			return true;
		}
	}
	return false;
}

function unknownValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (isRecord(left) && isRecord(right)) {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractProviderErrorStatus(error: unknown): number | undefined {
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

function providerErrorText(error: unknown): string {
	if (typeof error === "string") return error;
	if (error instanceof Error) return error.message;
	if (isErrorAssistantMessage(error) && error.errorMessage) return error.errorMessage;
	return String(error);
}

function isErrorAssistantMessage(value: unknown): value is { errorMessage?: string } {
	return typeof value === "object" && value !== null && "errorMessage" in value;
}

function isExpiredLock(value: unknown, now: number): boolean {
	return typeof value === "string" && Date.parse(value) <= now;
}

function isActiveLock(value: unknown, now: number): boolean {
	return typeof value === "string" && Date.parse(value) > now;
}

function hasActiveLockAfterUpdates(
	connection: ProviderConnection,
	updates: Record<string, unknown>,
	now: number,
): boolean {
	for (const [key, value] of Object.entries(connection)) {
		if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
		if (key in updates) continue;
		if (isActiveLock(value, now)) return true;
	}
	return false;
}

/**
 * Input type for registerProvider API.
 */
export interface ProviderConfigInput {
	name?: string;
	baseUrl?: string;
	apiKey?: string;
	api?: Api;
	streamSimple?: (model: Model<Api>, context: Context, options?: SimpleStreamOptions) => AssistantMessageEventStream;
	headers?: Record<string, string>;
	authHeader?: boolean;
	/** OAuth provider for /login support */
	oauth?: Omit<OAuthProviderInterface, "id">;
	models?: Array<{
		id: string;
		name: string;
		api?: Api;
		baseUrl?: string;
		reasoning: boolean;
		thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
		input: ("text" | "image")[];
		cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
		contextWindow: number;
		maxTokens: number;
		headers?: Record<string, string>;
		compat?: Model<Api>["compat"];
	}>;
}
