import { createInMemoryProviderConnectionStore } from "@pie-lab/storage";
import { describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { resolveGatewayOpenAiAudioCredentials } from "../src/core/gateway/audio-credentials.ts";

describe("gateway audio credentials", () => {
	it("prefers the voice tools env key over the general OpenAI env key", async () => {
		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: {
				VOICE_TOOLS_OPENAI_KEY: "voice-key",
				OPENAI_API_KEY: "openai-key",
			} as NodeJS.ProcessEnv,
		});

		expect(credentials).toEqual({ apiKey: "voice-key", source: "VOICE_TOOLS_OPENAI_KEY" });
	});

	it("uses active OpenAI provider connections when env keys are absent", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				{
					id: "conn-openai",
					provider: "openai",
					authType: "apikey",
					isActive: true,
					apiKey: "stored-openai-key",
					priority: 1,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: {} as NodeJS.ProcessEnv,
			providerConnectionStore: store,
			authStorage: AuthStorage.inMemory(),
		});

		expect(credentials).toEqual({
			apiKey: "stored-openai-key",
			source: "provider-connections",
			connectionId: "conn-openai",
		});
	});

	it("uses gateway-only openai-audio auth before the general OpenAI env key", async () => {
		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: { OPENAI_API_KEY: "general-openai-key" } as NodeJS.ProcessEnv,
			providerConnectionStore: createInMemoryProviderConnectionStore(),
			authStorage: AuthStorage.inMemory({
				"openai-audio": { type: "api_key", key: "audio-auth-key" },
			}),
		});

		expect(credentials).toEqual({ apiKey: "audio-auth-key", source: "auth.json:openai-audio" });
	});

	it("resolves env-name credentials stored in OpenAI provider connections", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				{
					id: "conn-openai-env",
					provider: "openai",
					authType: "apikey",
					isActive: true,
					apiKey: "PIE_TEST_OPENAI_AUDIO_KEY",
					priority: 1,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: { PIE_TEST_OPENAI_AUDIO_KEY: "resolved-openai-key" } as NodeJS.ProcessEnv,
			providerConnectionStore: store,
			authStorage: AuthStorage.inMemory(),
		});

		expect(credentials?.apiKey).toBe("resolved-openai-key");
		expect(credentials?.source).toBe("provider-connections");
	});

	it("falls back to auth.json OpenAI credentials", async () => {
		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: {} as NodeJS.ProcessEnv,
			providerConnectionStore: createInMemoryProviderConnectionStore(),
			authStorage: AuthStorage.inMemory({
				openai: { type: "api_key", key: "auth-openai-key" },
			}),
		});

		expect(credentials).toEqual({ apiKey: "auth-openai-key", source: "auth.json" });
	});

	it("uses auth.json when a synced provider connection has no inline key", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				{
					id: "conn-auth-openai",
					provider: "openai",
					authType: "apikey",
					isActive: true,
					apiKey: null,
					priority: 1,
					providerSpecificData: { source: "auth.json" },
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			],
		});

		const credentials = await resolveGatewayOpenAiAudioCredentials({
			env: {} as NodeJS.ProcessEnv,
			providerConnectionStore: store,
			authStorage: AuthStorage.inMemory({
				openai: { type: "api_key", key: "auth-synced-openai-key" },
			}),
		});

		expect(credentials).toEqual({
			apiKey: "auth-synced-openai-key",
			source: "provider-connections",
			connectionId: "conn-auth-openai",
		});
	});
});
