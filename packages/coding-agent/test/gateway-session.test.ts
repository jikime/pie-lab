import { describe, expect, it } from "vitest";
import type { ResolvedConversation, TelegramAccountConfig } from "../src/core/gateway/chat/core/config-types.ts";
import { buildGatewaySessionKey, buildGatewaySessionSource } from "../src/core/gateway/session.ts";

function conversation(dm = false): ResolvedConversation {
	const account: TelegramAccountConfig = {
		service: "telegram",
		botToken: "token",
		channels: {
			main: { id: dm ? "100" : "-100", name: dm ? "Direct" : "Group", dm },
		},
	};
	return {
		service: "telegram",
		botName: "pie",
		accountId: "tg",
		account,
		channelKey: "main",
		channel: account.channels.main,
		conversationId: "tg/main",
		conversationName: "Telegram / Main",
		access: {},
		gondolinSecrets: {},
		accountDir: "/tmp/pie-chat/account",
		sharedDir: "/tmp/pie-chat/account/shared",
		conversationDir: "/tmp/pie-chat/account/channels/main",
		workspaceDir: "/tmp/pie-chat/account/channels/main/workspace",
		gondolinDir: "/tmp/pie-chat/account/channels/main/gondolin",
		accountMemoryPath: "/tmp/pie-chat/account/shared/memory.md",
		channelMemoryPath: "/tmp/pie-chat/account/channels/main/workspace/memory.md",
		logPath: "/tmp/pie-chat/account/channels/main/channel.jsonl",
		filesDir: "/tmp/pie-chat/account/channels/main/workspace/incoming",
		lockPath: "/tmp/pie-chat/account/channels/main/.lock",
	};
}

describe("gateway session source", () => {
	it("uses chat identity for direct-message session keys", () => {
		const source = buildGatewaySessionSource(conversation(true), {
			messageId: "1",
			chatId: "100",
			chatType: "dm",
			userId: "user-1",
			text: "hello",
		});

		expect(buildGatewaySessionKey(source)).toBe("gateway:telegram:tg:dm:100");
	});

	it("can isolate thread sessions and optionally split them per user", () => {
		const source = buildGatewaySessionSource(conversation(false), {
			messageId: "1",
			chatId: "-100",
			chatType: "thread",
			threadId: "topic-7",
			parentChatId: "-100",
			userId: "user-1",
			text: "hello",
		});

		expect(buildGatewaySessionKey(source)).toBe("gateway:telegram:tg:thread:-100:topic-7");
		expect(buildGatewaySessionKey(source, { threadSessionsPerUser: true })).toBe(
			"gateway:telegram:tg:thread:-100:topic-7:user:user-1",
		);
	});
});
