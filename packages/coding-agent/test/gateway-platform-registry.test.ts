import { describe, expect, it, vi } from "vitest";
import {
	type GatewayConversationEndpoint,
	type GatewayTransport,
	registerBuiltInGatewayPlatforms,
	startGatewayChatAdapters,
} from "../src/core/gateway/adapters.ts";
import type {
	ChatConfig,
	DiscordAccountConfig,
	ResolvedConversation,
	TelegramAccountConfig,
} from "../src/core/gateway/chat/core/config-types.ts";
import { defaultGatewayPlatformRegistry, GatewayPlatformRegistry } from "../src/core/gateway/platform-registry.ts";

function telegramConversation(accountId = "telegram"): ResolvedConversation {
	const account: TelegramAccountConfig = {
		service: "telegram",
		botToken: "token",
		channels: {
			dm: { id: "123", name: "DM", dm: true },
		},
	};
	return {
		service: "telegram",
		botName: "pie",
		accountId,
		account,
		channelKey: "dm",
		channel: account.channels.dm,
		conversationId: `${accountId}/dm`,
		conversationName: "Telegram / DM",
		access: {},
		gondolinSecrets: {},
		accountDir: "/tmp/pie-chat/account",
		sharedDir: "/tmp/pie-chat/account/shared",
		conversationDir: "/tmp/pie-chat/account/channels/dm",
		workspaceDir: "/tmp/pie-chat/account/channels/dm/workspace",
		gondolinDir: "/tmp/pie-chat/account/channels/dm/gondolin",
		accountMemoryPath: "/tmp/pie-chat/account/shared/memory.md",
		channelMemoryPath: "/tmp/pie-chat/account/channels/dm/workspace/memory.md",
		logPath: "/tmp/pie-chat/account/channels/dm/channel.jsonl",
		filesDir: "/tmp/pie-chat/account/channels/dm/workspace/incoming",
		lockPath: "/tmp/pie-chat/account/channels/dm/.lock",
	};
}

function endpoint(conversation: ResolvedConversation): GatewayConversationEndpoint {
	return {
		conversation,
		setTransport: vi.fn((_transport: GatewayTransport) => undefined),
		getLastCheckpoint: () => ({}),
		onMessage: vi.fn(),
		onCaughtUp: vi.fn(),
		onError: vi.fn(),
		onDisconnect: vi.fn(),
	};
}

describe("gateway platform registry", () => {
	it("registers the built-in Telegram and Discord platforms", () => {
		const services = defaultGatewayPlatformRegistry.list().map((entry) => entry.service);

		expect(services).toEqual(["discord", "telegram"]);
		expect(defaultGatewayPlatformRegistry.require("telegram").capabilities?.attachments).toBe(true);
		expect(defaultGatewayPlatformRegistry.require("discord").capabilities?.realtime).toBe(true);
		expect(defaultGatewayPlatformRegistry.require("discord").capabilities?.voiceInput).toBe(true);
		expect(defaultGatewayPlatformRegistry.require("discord").capabilities?.voiceOutput).toBe(true);
	});

	it("routes account startup through the registered platform adapter", async () => {
		const registry = new GatewayPlatformRegistry();
		const startAccountAdapter = vi.fn(async (accountId) => ({
			accountId,
			service: "telegram" as const,
			disconnect: vi.fn(),
		}));
		registry.register({
			service: "telegram",
			label: "Test Telegram",
			startAccountAdapter,
		});
		const conversation = telegramConversation("test-telegram");
		const config: ChatConfig = {
			accounts: {
				"test-telegram": conversation.account,
			},
		};
		const context = {
			getOrCreateEndpoint: vi.fn(),
		};

		const adapters = await startGatewayChatAdapters(config, [endpoint(conversation)], context, registry);

		expect(adapters).toHaveLength(1);
		expect(adapters[0].accountId).toBe("test-telegram");
		expect(startAccountAdapter).toHaveBeenCalledWith(
			"test-telegram",
			conversation.account,
			expect.arrayContaining([expect.objectContaining({ conversation })]),
			context,
		);
	});

	it("starts Discord account adapters even before static channels exist", async () => {
		const registry = new GatewayPlatformRegistry();
		const startAccountAdapter = vi.fn(async (accountId) => ({
			accountId,
			service: "discord" as const,
			disconnect: vi.fn(),
		}));
		registry.register({
			service: "discord",
			label: "Test Discord",
			startAccountAdapter,
		});
		const account: DiscordAccountConfig = {
			service: "discord",
			botToken: "token",
			botUserId: "bot-1",
			botUsername: "pie",
			channels: {},
		};
		const config: ChatConfig = {
			accounts: {
				discord: account,
			},
		};
		const context = {
			getOrCreateEndpoint: vi.fn(),
		};

		const adapters = await startGatewayChatAdapters(config, [], context, registry);

		expect(adapters).toHaveLength(1);
		expect(startAccountAdapter).toHaveBeenCalledWith("discord", account, [], context);
	});

	it("does not duplicate built-ins when registration is invoked more than once", () => {
		const registry = new GatewayPlatformRegistry();

		registerBuiltInGatewayPlatforms(registry);
		registerBuiltInGatewayPlatforms(registry);

		expect(registry.list().map((entry) => entry.service)).toEqual(["discord", "telegram"]);
	});
});
