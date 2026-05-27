import type { ChatService, ResolvedConversation } from "./chat/core/config-types.js";
import type { InboundMessageInput } from "./chat/core/runtime-types.js";

export type GatewayChatType = "dm" | "group" | "channel" | "thread";

export interface GatewaySessionSource {
	service: ChatService;
	accountId: string;
	channelKey: string;
	chatId: string;
	chatName?: string;
	chatType: GatewayChatType;
	userId?: string;
	userName?: string;
	threadId?: string;
	parentChatId?: string;
	messageId?: string;
}

export interface GatewaySessionKeyOptions {
	threadSessionsPerUser?: boolean;
	groupSessionsPerUser?: boolean;
	channelSessionsPerUser?: boolean;
}

function sanitizeKeyPart(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown";
}

function inferChatType(conversation: ResolvedConversation, input?: InboundMessageInput): GatewayChatType {
	if (input?.threadId) return "thread";
	if (conversation.channel.dm) return "dm";
	return "channel";
}

export function buildGatewaySessionSource(
	conversation: ResolvedConversation,
	input?: InboundMessageInput,
): GatewaySessionSource {
	return {
		service: conversation.service,
		accountId: conversation.accountId,
		channelKey: conversation.channelKey,
		chatId: input?.chatId || conversation.channel.id,
		chatName: input?.chatName || conversation.channel.name || conversation.channelKey,
		chatType: input?.chatType || inferChatType(conversation, input),
		userId: input?.userId,
		userName: input?.userName,
		threadId: input?.threadId,
		parentChatId: input?.parentChatId,
		messageId: input?.messageId,
	};
}

export function buildGatewaySessionKey(
	source: GatewaySessionSource,
	options: GatewaySessionKeyOptions = {},
): string {
	const parts = ["gateway", source.service, sanitizeKeyPart(source.accountId)];
	if (source.chatType === "dm") {
		parts.push("dm", sanitizeKeyPart(source.chatId));
	} else if (source.chatType === "thread") {
		parts.push(
			"thread",
			sanitizeKeyPart(source.parentChatId || source.chatId),
			sanitizeKeyPart(source.threadId || source.chatId),
		);
		if (options.threadSessionsPerUser && source.userId) parts.push("user", sanitizeKeyPart(source.userId));
	} else {
		parts.push(source.chatType, sanitizeKeyPart(source.chatId));
		const perUser = source.chatType === "group" ? options.groupSessionsPerUser : options.channelSessionsPerUser;
		if (perUser && source.userId) parts.push("user", sanitizeKeyPart(source.userId));
	}
	return parts.join(":");
}

export function formatGatewaySessionSource(source: GatewaySessionSource): string {
	const pieces = [
		`${source.service}/${source.accountId}`,
		`${source.chatType}:${source.chatName || source.chatId}`,
		source.threadId ? `thread:${source.threadId}` : undefined,
		source.userId ? `uid:${source.userId}` : undefined,
	].filter(Boolean);
	return pieces.join(" ");
}
