import { selectProviderConnection } from "@pie-lab/router";
import { createJsonProviderConnectionStore, type ProviderConnection, type ProviderConnectionStore } from "@pie-lab/storage";
import { join } from "node:path";
import { getAgentDir } from "../../config.js";
import { AuthStorage } from "../auth-storage.js";
import { resolveConfigValue } from "../resolve-config-value.js";

export type GatewayOpenAiAudioKeySource =
	| "VOICE_TOOLS_OPENAI_KEY"
	| "auth.json:openai-audio"
	| "OPENAI_API_KEY"
	| "provider-connections"
	| "auth.json";

export const OPENAI_AUDIO_AUTH_PROVIDER = "openai-audio";
export const OPENAI_AUTH_PROVIDER = "openai";

export interface GatewayOpenAiAudioCredentials {
	apiKey: string;
	source: GatewayOpenAiAudioKeySource;
	connectionId?: string;
}

export interface ResolveGatewayOpenAiAudioCredentialsOptions {
	env?: NodeJS.ProcessEnv;
	agentDir?: string;
	providerConnectionStore?: ProviderConnectionStore;
	authStorage?: AuthStorage;
}

function normalizeOptions(
	envOrOptions: NodeJS.ProcessEnv | ResolveGatewayOpenAiAudioCredentialsOptions = process.env,
): Required<Pick<ResolveGatewayOpenAiAudioCredentialsOptions, "env" | "agentDir">> &
	Pick<ResolveGatewayOpenAiAudioCredentialsOptions, "providerConnectionStore" | "authStorage"> {
	const candidate = envOrOptions as ResolveGatewayOpenAiAudioCredentialsOptions;
	if (
		typeof candidate.env === "object" ||
		typeof candidate.agentDir === "string" ||
		candidate.providerConnectionStore !== undefined ||
		candidate.authStorage !== undefined
	) {
		return {
			env: candidate.env ?? process.env,
			agentDir: candidate.agentDir ?? getAgentDir(),
			providerConnectionStore: candidate.providerConnectionStore,
			authStorage: candidate.authStorage,
		};
	}
	return { env: envOrOptions as NodeJS.ProcessEnv, agentDir: getAgentDir() };
}

function isAuthStorageSyncedConnection(connection: ProviderConnection): boolean {
	return (
		typeof connection.providerSpecificData === "object" &&
		connection.providerSpecificData !== null &&
		connection.providerSpecificData.source === "auth.json"
	);
}

async function resolveProviderConnectionApiKey(
	connection: ProviderConnection,
	authStorage: AuthStorage,
	env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
	if (isAuthStorageSyncedConnection(connection)) {
		return (
			(await authStorage.getApiKey(connection.provider, { includeFallback: false })) ??
			resolveRawProviderConnectionApiKey(connection, env)
		);
	}
	return resolveRawProviderConnectionApiKey(connection, env);
}

function resolveCredentialValue(rawCredential: string, env: NodeJS.ProcessEnv): string | undefined {
	if (!rawCredential.startsWith("!") && env[rawCredential]) return env[rawCredential];
	return resolveConfigValue(rawCredential);
}

function resolveRawProviderConnectionApiKey(connection: ProviderConnection, env: NodeJS.ProcessEnv): string | undefined {
	const rawCredential =
		typeof connection.apiKey === "string" && connection.apiKey.length > 0
			? connection.apiKey
			: typeof connection.accessToken === "string" && connection.accessToken.length > 0
				? connection.accessToken
				: undefined;
	return rawCredential ? resolveCredentialValue(rawCredential, env) : undefined;
}

async function resolveProviderConnectionCredentials(
	options: Required<Pick<ResolveGatewayOpenAiAudioCredentialsOptions, "env" | "agentDir">> &
		Pick<ResolveGatewayOpenAiAudioCredentialsOptions, "providerConnectionStore" | "authStorage">,
): Promise<GatewayOpenAiAudioCredentials | undefined> {
	const store = options.providerConnectionStore ?? createJsonProviderConnectionStore(join(options.agentDir, "provider-connections.json"));
	const authStorage = options.authStorage ?? AuthStorage.create(join(options.agentDir, "auth.json"));
	const connections = await store.getProviderConnections({ provider: OPENAI_AUTH_PROVIDER, isActive: true });
	if (connections.length === 0) return undefined;
	const settings = await store.getSettings();
	const selection = selectProviderConnection({ provider: OPENAI_AUTH_PROVIDER, model: null, connections, settings });
	const orderedConnections =
		selection.status === "selected"
			? [selection.connection, ...connections.filter((connection) => connection.id !== selection.connection.id)]
			: connections;
	for (const connection of orderedConnections) {
		const apiKey = await resolveProviderConnectionApiKey(connection, authStorage, options.env);
		if (apiKey) return { apiKey, source: "provider-connections", connectionId: connection.id };
	}
	return undefined;
}

async function resolveAuthStorageCredentials(
	agentDir: string,
	authStorage: AuthStorage | undefined,
	provider: string,
	source: GatewayOpenAiAudioKeySource,
): Promise<GatewayOpenAiAudioCredentials | undefined> {
	const apiKey = await (authStorage ?? AuthStorage.create(join(agentDir, "auth.json"))).getApiKey(provider, { includeFallback: false });
	return apiKey ? { apiKey, source } : undefined;
}

export async function resolveGatewayOpenAiAudioCredentials(
	envOrOptions: NodeJS.ProcessEnv | ResolveGatewayOpenAiAudioCredentialsOptions = process.env,
): Promise<GatewayOpenAiAudioCredentials | undefined> {
	const options = normalizeOptions(envOrOptions);
	const env = options.env;
	const voiceToolsKey = env.VOICE_TOOLS_OPENAI_KEY?.trim();
	if (voiceToolsKey) return { apiKey: voiceToolsKey, source: "VOICE_TOOLS_OPENAI_KEY" };
	const audioAuth = await resolveAuthStorageCredentials(
		options.agentDir,
		options.authStorage,
		OPENAI_AUDIO_AUTH_PROVIDER,
		"auth.json:openai-audio",
	);
	if (audioAuth) return audioAuth;
	const openAiKey = env.OPENAI_API_KEY?.trim();
	if (openAiKey) return { apiKey: openAiKey, source: "OPENAI_API_KEY" };
	return (
		(await resolveProviderConnectionCredentials(options)) ??
		resolveAuthStorageCredentials(options.agentDir, options.authStorage, OPENAI_AUTH_PROVIDER, "auth.json")
	);
}

export function describeGatewayOpenAiAudioCredentials(credentials: GatewayOpenAiAudioCredentials): string {
	if (credentials.source === "provider-connections") {
		return credentials.connectionId ? `provider connection ${credentials.connectionId}` : "provider connection";
	}
	if (credentials.source === "auth.json:openai-audio") return "auth.json openai-audio";
	return credentials.source;
}
