import type { ChatService } from "./config-types.js";
import type { GatewayChatType, GatewaySessionSource } from "../../session.js";

export type AttachmentKind = "image" | "file" | "audio" | "video";

export interface AttachmentInput {
	path: string;
	name?: string;
	kind?: AttachmentKind;
	mimeType?: string;
	remoteUrl?: string;
}

export interface StoredAttachment {
	kind: AttachmentKind;
	name: string;
	mimeType?: string;
	size?: number;
	remoteUrl?: string;
	originalPath?: string;
	localPath: string;
}

export interface InboundMessageInput {
	messageId?: string;
	chatId?: string;
	chatName?: string;
	chatType?: GatewayChatType;
	threadId?: string;
	parentChatId?: string;
	sessionSource?: GatewaySessionSource;
	sessionKey?: string;
	userId: string;
	userName?: string;
	roleIds?: string[];
	text: string;
	mentionedBot?: boolean;
	isBot?: boolean;
	attachments?: AttachmentInput[];
}

export interface ChatRecordBase {
	recordId: number;
	timestamp: string;
	service: ChatService;
	accountId: string;
	channelKey: string;
	channelId: string;
	scope: "channel";
	sessionKey?: string;
	sessionSource?: GatewaySessionSource;
}

export interface InboundMessageRecord extends ChatRecordBase {
	type: "inbound";
	messageId: string;
	userId: string;
	userName?: string;
	roleIds?: string[];
	text: string;
	mentionedBot: boolean;
	isBot: boolean;
	attachments: StoredAttachment[];
}
export interface OutboundMessageRecord extends ChatRecordBase {
	type: "outbound";
	messageId: string;
	text: string;
	replyToMessageId?: string;
	jobId: string;
	attachments?: string[];
}
export interface CheckpointRecord extends ChatRecordBase {
	type: "checkpoint";
	cursor?: string;
	messageId?: string;
}
export interface JobQueuedRecord extends ChatRecordBase {
	type: "job_queued";
	jobId: string;
	trigger: "mention" | "dm";
	triggerRecordId: number;
}
export interface JobCompletedRecord extends ChatRecordBase {
	type: "job_completed";
	jobId: string;
	triggerRecordId: number;
	outboundRecordId?: number;
}
export interface JobFailedRecord extends ChatRecordBase {
	type: "job_failed";
	jobId: string;
	triggerRecordId: number;
	error: string;
}
export interface ErrorRecord extends ChatRecordBase {
	type: "error";
	message: string;
}

export type ChatLogRecord =
	| InboundMessageRecord
	| OutboundMessageRecord
	| CheckpointRecord
	| JobQueuedRecord
	| JobCompletedRecord
	| JobFailedRecord
	| ErrorRecord;

export interface PendingJob {
	jobId: string;
	trigger: "mention" | "dm" | "nudge";
	triggerRecordId: number;
	queuedRecordId: number;
	sessionKey?: string;
	sessionSource?: GatewaySessionSource;
	/** Overrides the prompt built from inbound records (used for proactive nudge jobs). */
	overridePrompt?: string;
}

export interface DispatchableJob {
	job: PendingJob;
	prompt: string;
	triggerMessageId?: string;
	sessionKey?: string;
	sessionSource?: GatewaySessionSource;
}

export interface ChatHistoryQuery {
	query?: string;
	after?: string;
	before?: string;
	limit?: number;
}

export interface ConversationStatus {
	conversationId: string;
	conversationName: string;
	logPath: string;
	queueLength: number;
	hasActiveJob: boolean;
	recordCount: number;
	lastRecordId: number;
	lastSessionKey?: string;
}
