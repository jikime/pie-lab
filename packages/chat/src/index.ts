export type ChatProvider = "discord" | "telegram";

export interface ChatMessage {
	provider: ChatProvider;
	accountId: string;
	channelId: string;
	messageId: string;
	authorId: string;
	text: string;
	attachments?: ChatAttachment[];
	timestamp: string;
}

export interface ChatAttachment {
	id: string;
	name: string;
	mimeType?: string;
	sizeBytes?: number;
	url?: string;
	localPath?: string;
}
