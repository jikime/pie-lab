import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UsageStore } from "@pie-lab/storage";
import { Client, Events, GatewayIntentBits, type Interaction, type Message, Partials, type VoiceBasedChannel } from "discord.js";
import type {
	ChatAccountConfig,
	ChatConfig,
	ConfiguredChannel,
	DiscordAccountConfig,
	ResolvedConversation,
	TelegramAccountConfig,
} from "./chat/core/config-types.js";
import type { InboundMessageInput } from "./chat/core/runtime-types.js";
import { CHAT_HOME } from "./chat/config.js";
import { fetchBinary, guessAttachmentKind, readLocalAttachment, storeDownloadedAttachment, textMentionsBot } from "./chat/live/common.js";
import { chunkText } from "./chat/render/chunking.js";
import { formatMarkdownForService, maxMessageLength, telegramHtmlToPlainText } from "./chat/render/format.js";
import { DiscordVoiceController, parseDiscordVoiceCommandText, type DiscordVoiceCommand } from "./discord-voice.js";
import { defaultGatewayPlatformRegistry, type GatewayPlatformRegistry } from "./platform-registry.js";
import { transcribeGatewayAudio, type GatewayTranscriptionResult } from "./transcription.js";

export interface GatewayCheckpoint {
	cursor?: string;
	messageId?: string;
}

export interface GatewayTransport {
	sendImmediate(text: string, replyToMessageId?: string): Promise<string>;
	send(text: string, attachmentPaths?: string[], signal?: AbortSignal, replyToMessageId?: string): Promise<string>;
	startTyping(): Promise<void>;
	stopTyping(): Promise<void>;
}

export interface GatewayConversationEndpoint {
	conversation: ResolvedConversation;
	setTransport(transport: GatewayTransport): void;
	getLastCheckpoint(): GatewayCheckpoint;
	onMessage(input: InboundMessageInput, checkpoint?: GatewayCheckpoint): Promise<void>;
	onCaughtUp(): Promise<void>;
	onError(error: Error): Promise<void>;
	onDisconnect?(): Promise<void>;
}

export interface GatewayAccountAdapterContext {
	usageStore?: UsageStore;
	getOrCreateEndpoint(
		accountId: string,
		account: ChatAccountConfig,
		channelKey: string,
		channel: ConfiguredChannel,
	): Promise<GatewayConversationEndpoint>;
}

export interface GatewayAdapter {
	accountId: string;
	service: ChatAccountConfig["service"];
	disconnect(): Promise<void>;
	getHealth?(): GatewayAdapterHealth;
}

export interface GatewayAdapterHealth {
	accountId: string;
	service: ChatAccountConfig["service"];
	connected: boolean;
	startedAt: string;
	lastActivityAt?: string;
	errorCount: number;
	lastError?: string;
}

interface TelegramResponse<T> {
	ok: boolean;
	result?: T;
	description?: string;
}

interface TelegramUser {
	id: number;
	username?: string;
	is_bot?: boolean;
	first_name?: string;
}

interface TelegramChat {
	id: number;
	type: string;
	title?: string;
	username?: string;
	first_name?: string;
}

interface TelegramPhotoSize {
	file_id: string;
	file_size?: number;
}

interface TelegramDocument {
	file_id: string;
	file_name?: string;
	mime_type?: string;
	duration?: number;
}

interface TelegramMessage {
	message_id: number;
	chat: TelegramChat;
	from?: TelegramUser;
	text?: string;
	caption?: string;
	photo?: TelegramPhotoSize[];
	document?: TelegramDocument;
	video?: TelegramDocument;
	audio?: TelegramDocument;
	voice?: TelegramDocument;
	message_thread_id?: number;
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
}

interface TelegramCallbackQuery {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
}

interface TelegramGetFileResult {
	file_path: string;
}

function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

const GATEWAY_CONTROL_COMMANDS = ["status", "new", "compact", "stop", "help"] as const;
type GatewayControlCommand = (typeof GATEWAY_CONTROL_COMMANDS)[number];

function parseGatewayControlData(data: string | undefined): GatewayControlCommand | undefined {
	const value = data?.trim().toLowerCase();
	if (!value?.startsWith("pie:")) return undefined;
	const command = value.slice("pie:".length);
	return GATEWAY_CONTROL_COMMANDS.includes(command as GatewayControlCommand)
		? (command as GatewayControlCommand)
		: undefined;
}

function formatTranscriptionHeader(label: string, result: GatewayTranscriptionResult): string {
	const parts = [label];
	if (result.provider) parts.push(`provider=${result.provider}`);
	if (result.model) parts.push(`model=${result.model}`);
	if (result.cached !== undefined) parts.push(`cached=${result.cached ? "yes" : "no"}`);
	if (result.fileSizeBytes !== undefined) parts.push(`size=${result.fileSizeBytes}B`);
	if (result.durationMs !== undefined) parts.push(`duration=${result.durationMs}ms`);
	return `[${parts.join(" ")}]`;
}

function accountStatePath(accountId: string): string {
	return join(CHAT_HOME, "accounts", sanitize(accountId), "gateway-state.json");
}

async function readTelegramCursor(accountId: string): Promise<number | undefined> {
	try {
		const parsed = JSON.parse(await readFile(accountStatePath(accountId), "utf8")) as { telegramUpdateId?: unknown };
		return typeof parsed.telegramUpdateId === "number" && Number.isFinite(parsed.telegramUpdateId)
			? parsed.telegramUpdateId
			: undefined;
	} catch {
		return undefined;
	}
}

async function writeTelegramCursor(accountId: string, updateId: number): Promise<void> {
	const path = accountStatePath(accountId);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ telegramUpdateId: updateId }, null, "\t")}\n`, "utf8");
}

async function callTelegram<T>(
	botToken: string,
	method: string,
	body: Record<string, unknown>,
	options?: { signal?: AbortSignal },
): Promise<T> {
	const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: options?.signal,
	});
	const data = (await response.json()) as TelegramResponse<T>;
	if (!response.ok || !data.ok) {
		throw new Error(data.description || `Telegram API ${method} failed`);
	}
	return data.result as T;
}

function isTelegramFormattingError(error: unknown): boolean {
	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return message.includes("can't parse entities") || message.includes("parse entities");
}

async function callTelegramText<T>(
	botToken: string,
	method: string,
	body: Record<string, unknown>,
	fallbackText?: string,
	options?: { signal?: AbortSignal },
): Promise<T> {
	try {
		return await callTelegram<T>(botToken, method, body, options);
	} catch (error) {
		if (!body.parse_mode || !fallbackText || !isTelegramFormattingError(error)) throw error;
		const fallbackBody: Record<string, unknown> = { ...body, text: fallbackText };
		delete fallbackBody.parse_mode;
		return callTelegram<T>(botToken, method, fallbackBody, options);
	}
}

async function downloadTelegramFile(
	conversation: ResolvedConversation,
	botToken: string,
	messageId: string,
	index: number,
	fileId: string,
	fileName: string,
	mimeType?: string,
): Promise<NonNullable<InboundMessageInput["attachments"]>> {
	const info = await callTelegram<TelegramGetFileResult>(botToken, "getFile", { file_id: fileId });
	const data = await fetchBinary(`https://api.telegram.org/file/bot${botToken}/${info.file_path}`);
	return [await storeDownloadedAttachment(conversation, messageId, index, fileName, data, mimeType, info.file_path)];
}

async function telegramMessageToInput(
	conversation: ResolvedConversation,
	account: TelegramAccountConfig,
	message: TelegramMessage,
): Promise<InboundMessageInput | undefined> {
	if (account.botUserId && String(message.from?.id ?? "") === account.botUserId) return undefined;
	let text = (message.text || message.caption || "").trim();
	const attachments: NonNullable<InboundMessageInput["attachments"]> = [];
	const transcriptBlocks: string[] = [];
	const remoteMessageId = String(message.message_id);
	if (message.photo?.length) {
		const largest = [...message.photo].sort((a, b) => (a.file_size ?? 0) - (b.file_size ?? 0)).pop();
		if (largest) {
			attachments.push(
				...(await downloadTelegramFile(
					conversation,
					account.botToken,
					remoteMessageId,
					1,
					largest.file_id,
					`photo-${remoteMessageId}.jpg`,
					"image/jpeg",
				)),
			);
		}
	}
	if (message.document) {
		attachments.push(
			...(await downloadTelegramFile(
				conversation,
				account.botToken,
				remoteMessageId,
				2,
				message.document.file_id,
				message.document.file_name || `document-${remoteMessageId}`,
				message.document.mime_type,
			)),
		);
	}
	if (message.video) {
		attachments.push(
			...(await downloadTelegramFile(
				conversation,
				account.botToken,
				remoteMessageId,
				3,
				message.video.file_id,
				message.video.file_name || `video-${remoteMessageId}.mp4`,
				message.video.mime_type,
			)),
		);
	}
	if (message.audio) {
		attachments.push(
			...(await downloadTelegramFile(
				conversation,
				account.botToken,
				remoteMessageId,
				4,
				message.audio.file_id,
				message.audio.file_name || `audio-${remoteMessageId}.mp3`,
				message.audio.mime_type,
			)),
		);
	}
	if (message.voice) {
		const voiceAttachments = await downloadTelegramFile(
			conversation,
			account.botToken,
			remoteMessageId,
			5,
			message.voice.file_id,
			`voice-${remoteMessageId}.ogg`,
			message.voice.mime_type || "audio/ogg",
		);
		attachments.push(...voiceAttachments);
		for (const attachment of voiceAttachments) {
			const transcription = await transcribeGatewayAudio({ filePath: attachment.path, mimeType: attachment.mimeType });
			if (transcription.text) {
				transcriptBlocks.push(`${formatTranscriptionHeader("Voice transcript", transcription)}\n${transcription.text}`);
			} else if (transcription.skipped && transcription.skippedReason) {
				transcriptBlocks.push(`${formatTranscriptionHeader("Voice transcript skipped", transcription)} ${transcription.skippedReason}`);
			} else if (transcription.error && !transcription.skipped) {
				transcriptBlocks.push(`${formatTranscriptionHeader("Voice transcript unavailable", transcription)} ${transcription.error}`);
			}
		}
	}
	if (transcriptBlocks.length > 0) text = [text, ...transcriptBlocks].filter(Boolean).join("\n\n");
	return {
		messageId: remoteMessageId,
		chatId: String(message.chat.id),
		chatName: message.chat.title || message.chat.username || message.chat.first_name || conversation.channel.name,
		chatType: message.message_thread_id
			? "thread"
			: message.chat.type === "private"
				? "dm"
				: message.chat.type === "group" || message.chat.type === "supergroup"
					? "group"
					: "channel",
		threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
		parentChatId: message.message_thread_id ? String(message.chat.id) : undefined,
		userId: String(message.from?.id ?? message.chat.id),
		userName: message.from?.username || message.from?.first_name,
		text,
		mentionedBot: textMentionsBot(text, account.botUsername),
		isBot: message.from?.is_bot ?? false,
		attachments,
	};
}

function telegramChatId(channelId: string): string | number {
	return Number.isFinite(Number(channelId)) ? Number(channelId) : channelId;
}

function telegramControlKeyboard(): Record<string, unknown> {
	return {
		inline_keyboard: [
			[
				{ text: "Status", callback_data: "pie:status" },
				{ text: "New", callback_data: "pie:new" },
				{ text: "Compact", callback_data: "pie:compact" },
			],
			[
				{ text: "Stop", callback_data: "pie:stop" },
				{ text: "Help", callback_data: "pie:help" },
			],
		],
	};
}

function telegramAttachmentUpload(kind: "image" | "file" | "audio" | "video"): { method: string; field: string } {
	if (kind === "image") return { method: "sendPhoto", field: "photo" };
	if (kind === "audio") return { method: "sendAudio", field: "audio" };
	if (kind === "video") return { method: "sendVideo", field: "video" };
	return { method: "sendDocument", field: "document" };
}

async function sendTelegramMessage(
	account: TelegramAccountConfig,
	channelId: string,
	text: string,
	attachmentPaths: string[] = [],
	signal?: AbortSignal,
	replyToMessageId?: string,
	replyMarkup?: Record<string, unknown>,
): Promise<string> {
	const rendered = formatMarkdownForService("telegram", text);
	const replyParam = replyToMessageId ? { reply_to_message_id: Number(replyToMessageId) } : {};
	if (attachmentPaths.length === 0) {
		const chunks = chunkText(rendered.text, maxMessageLength("telegram"));
		let firstId: string | undefined;
		for (let i = 0; i < chunks.length; i++) {
			const sent = await callTelegramText<{ message_id?: number } | undefined>(
				account.botToken,
				"sendMessage",
				{
					chat_id: telegramChatId(channelId),
					text: chunks[i],
							parse_mode: rendered.parseMode,
							disable_web_page_preview: true,
							...(i === 0 ? replyParam : {}),
							...(i === 0 && replyMarkup ? { reply_markup: replyMarkup } : {}),
						},
						telegramHtmlToPlainText(chunks[i] ?? ""),
						{ signal },
			);
			const id = sent?.message_id !== undefined ? String(sent.message_id) : "";
			firstId ??= id;
		}
		return firstId || "";
	}

	const [firstPath, ...rest] = attachmentPaths;
	const first = await readLocalAttachment(firstPath);
	const firstKind = guessAttachmentKind(first.name, first.mimeType);
	const { method: firstMethod, field: firstField } = telegramAttachmentUpload(firstKind);
	const buildFirstForm = (caption: string, parseMode?: string) => {
		const form = new FormData();
		form.set("chat_id", channelId);
		if (replyToMessageId) form.set("reply_to_message_id", String(Number(replyToMessageId)));
		if (caption) form.set("caption", caption);
		if (caption && parseMode) form.set("parse_mode", parseMode);
		if (replyMarkup) form.set("reply_markup", JSON.stringify(replyMarkup));
		form.set(firstField, new Blob([Buffer.from(first.data)], { type: first.mimeType }), first.name);
		return form;
	};
	let firstResponse = await fetch(`https://api.telegram.org/bot${account.botToken}/${firstMethod}`, {
		method: "POST",
		body: buildFirstForm(rendered.text, rendered.parseMode),
		signal,
	});
	let firstData = (await firstResponse.json()) as TelegramResponse<{ message_id: number }>;
	if (
		(!firstResponse.ok || !firstData.ok || firstData.result === undefined) &&
		rendered.parseMode &&
		isTelegramFormattingError(firstData.description)
	) {
		firstResponse = await fetch(`https://api.telegram.org/bot${account.botToken}/${firstMethod}`, {
			method: "POST",
			body: buildFirstForm(rendered.fallbackText),
			signal,
		});
		firstData = (await firstResponse.json()) as TelegramResponse<{ message_id: number }>;
	}
	if (!firstResponse.ok || !firstData.ok || firstData.result === undefined) {
		throw new Error(firstData.description || `${firstMethod} failed`);
	}
	for (const path of rest) {
		const file = await readLocalAttachment(path);
		const kind = guessAttachmentKind(file.name, file.mimeType);
		const { method, field } = telegramAttachmentUpload(kind);
		const form = new FormData();
		form.set("chat_id", channelId);
		form.set(field, new Blob([Buffer.from(file.data)], { type: file.mimeType }), file.name);
		const response = await fetch(`https://api.telegram.org/bot${account.botToken}/${method}`, {
			method: "POST",
			body: form,
			signal,
		});
		const data = (await response.json()) as TelegramResponse<{ message_id: number }>;
		if (!response.ok || !data.ok || data.result === undefined) {
			throw new Error(data.description || `${method} failed`);
		}
	}
	return String(firstData.result.message_id);
}

class TelegramTransport implements GatewayTransport {
	private readonly conversation: ResolvedConversation;
	private readonly account: TelegramAccountConfig;

	constructor(conversation: ResolvedConversation, account: TelegramAccountConfig) {
		this.conversation = conversation;
		this.account = account;
	}

	async sendImmediate(text: string, replyToMessageId?: string): Promise<string> {
		return sendTelegramMessage(this.account, this.conversation.channel.id, text, [], undefined, replyToMessageId, telegramControlKeyboard());
	}

	async send(
		text: string,
		attachmentPaths: string[] = [],
		signal?: AbortSignal,
		replyToMessageId?: string,
	): Promise<string> {
		return sendTelegramMessage(this.account, this.conversation.channel.id, text, attachmentPaths, signal, replyToMessageId);
	}

	async startTyping(): Promise<void> {
		await callTelegram(this.account.botToken, "sendChatAction", {
			chat_id: telegramChatId(this.conversation.channel.id),
			action: "typing",
		});
	}

	async stopTyping(): Promise<void> {}
}

async function startTelegramAccountAdapter(
	accountId: string,
	account: TelegramAccountConfig,
	endpoints: GatewayConversationEndpoint[],
): Promise<GatewayAdapter> {
	const byChannelId = new Map(endpoints.map((endpoint) => [endpoint.conversation.channel.id, endpoint]));
	for (const endpoint of endpoints) {
		endpoint.setTransport(new TelegramTransport(endpoint.conversation, account));
	}
	const health: GatewayAdapterHealth = {
		accountId,
		service: "telegram",
		connected: true,
		startedAt: new Date().toISOString(),
		errorCount: 0,
	};
	let abort = false;
	let cursor = await readTelegramCursor(accountId);
	let offset = cursor !== undefined ? cursor + 1 : 0;
	const pollController = new AbortController();

	const processCallbackQuery = async (query: TelegramCallbackQuery): Promise<void> => {
		const command = parseGatewayControlData(query.data);
		if (!command || !query.message) return;
		const endpoint = byChannelId.get(String(query.message.chat.id));
		if (!endpoint) return;
		await callTelegram(account.botToken, "answerCallbackQuery", {
			callback_query_id: query.id,
			text: `Pie ${command}`,
		}).catch(() => undefined);
		health.lastActivityAt = new Date().toISOString();
		await endpoint.onMessage({
			messageId: `${query.message.message_id}:callback:${query.id}`,
			chatId: String(query.message.chat.id),
			chatName: query.message.chat.title || query.message.chat.username || query.message.chat.first_name || endpoint.conversation.channel.name,
			chatType: query.message.chat.type === "private" ? "dm" : "channel",
			userId: String(query.from.id),
			userName: query.from.username || query.from.first_name,
			text: `/${command}`,
			mentionedBot: true,
			isBot: query.from.is_bot ?? false,
		});
	};

	const processUpdate = async (update: TelegramUpdate): Promise<void> => {
		cursor = Math.max(cursor ?? 0, update.update_id);
		if (update.callback_query) {
			await processCallbackQuery(update.callback_query);
			await writeTelegramCursor(accountId, cursor);
			return;
		}
		const message = update.message || update.edited_message;
		if (!message) {
			await writeTelegramCursor(accountId, cursor);
			return;
		}
		const endpoint = byChannelId.get(String(message.chat.id));
		if (!endpoint) {
			await writeTelegramCursor(accountId, cursor);
			return;
		}
		const input = await telegramMessageToInput(endpoint.conversation, account, message);
		if (input) {
			health.lastActivityAt = new Date().toISOString();
			await endpoint.onMessage(input, { cursor: String(update.update_id), messageId: input.messageId });
		}
		await writeTelegramCursor(accountId, cursor);
	};

	const initialUpdates = await callTelegram<TelegramUpdate[]>(account.botToken, "getUpdates", {
		offset: offset > 0 ? offset : undefined,
		timeout: 0,
		allowed_updates: ["message", "edited_message", "callback_query"],
	});
	for (const update of initialUpdates) {
		offset = update.update_id + 1;
		await processUpdate(update);
	}
	for (const endpoint of endpoints) {
		await endpoint.onCaughtUp();
	}

	const loop = (async () => {
		while (!abort) {
			try {
				const updates = await callTelegram<TelegramUpdate[]>(
					account.botToken,
					"getUpdates",
					{ offset: offset > 0 ? offset : undefined, timeout: 30, allowed_updates: ["message", "edited_message", "callback_query"] },
					{ signal: pollController.signal },
				);
				for (const update of updates) {
					offset = update.update_id + 1;
					await processUpdate(update);
				}
			} catch (error) {
				if (abort || (error instanceof Error && error.name === "AbortError")) break;
				health.errorCount++;
				health.lastError = error instanceof Error ? error.message : String(error);
				for (const endpoint of endpoints) {
					await endpoint.onError(error instanceof Error ? error : new Error(String(error)));
				}
				await new Promise((resolve) => setTimeout(resolve, 3000));
			}
		}
	})();

	return {
		accountId,
		service: "telegram",
		disconnect: async () => {
			abort = true;
			health.connected = false;
			pollController.abort();
			await loop.catch(() => undefined);
		},
		getHealth: () => ({ ...health }),
	};
}

async function withReadyDiscordClient(token: string): Promise<Client<true>> {
	const client = new Client({
		intents: [
			GatewayIntentBits.Guilds,
			GatewayIntentBits.GuildMessages,
			GatewayIntentBits.DirectMessages,
			GatewayIntentBits.GuildVoiceStates,
			GatewayIntentBits.MessageContent,
		],
		partials: [Partials.Channel],
	});
	const readyPromise = once(client, "ready");
	try {
		await client.login(token);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("Used disallowed intents")) {
			throw new Error(
				'Discord rejected the configured gateway intents. Enable the "Message Content Intent" in the Discord Developer Portal under Bot settings, then reconnect.',
			);
		}
		throw error;
	}
	if (!client.isReady()) {
		await Promise.race([
			readyPromise,
			new Promise((_, reject) => setTimeout(() => reject(new Error("Discord client failed to become ready")), 10000)),
		]);
	}
	if (!client.isReady()) throw new Error("Discord client failed to become ready");
	return client as Client<true>;
}

function discordCommandDescription(command: GatewayControlCommand): string {
	if (command === "status") return "Show Pie gateway status for this channel.";
	if (command === "new") return "Start a new Pie session for this chat context.";
	if (command === "compact") return "Compact the current Pie session.";
	if (command === "stop") return "Abort the active Pie turn.";
	return "Show Pie gateway command help.";
}

function discordVoiceCommandDescription(command: DiscordVoiceCommand): string {
	if (command === "join") return "Join your current voice channel and listen for speech.";
	if (command === "leave") return "Leave the active voice channel.";
	return "Show Pie voice channel status.";
}

function discordPieCommandPayload(): Record<string, unknown> {
	return {
		name: "pie",
		description: "Control the Pie gateway session.",
		type: 1,
		options: [
			...GATEWAY_CONTROL_COMMANDS.map((command) => ({
				name: command,
				description: discordCommandDescription(command),
				type: 1,
			})),
			{
				name: "voice",
				description: "Control Discord voice channel mode.",
				type: 2,
				options: (["join", "leave", "status"] as const).map((command) => ({
					name: command,
					description: discordVoiceCommandDescription(command),
					type: 1,
				})),
			},
		],
	};
}

async function syncDiscordGatewayCommand(account: DiscordAccountConfig): Promise<void> {
	const applicationId = account.applicationId || account.botUserId;
	if (!applicationId) return;
	const endpoint = account.serverId
		? `https://discord.com/api/v10/applications/${applicationId}/guilds/${account.serverId}/commands`
		: `https://discord.com/api/v10/applications/${applicationId}/commands`;
	const headers = { Authorization: `Bot ${account.botToken}`, "content-type": "application/json" };
	const existingResponse = await fetch(endpoint, { headers });
	const existing = existingResponse.ok ? ((await existingResponse.json()) as Array<{ id: string; name: string }>) : [];
	const current = existing.find((command) => command.name === "pie");
	const method = current ? "PATCH" : "POST";
	const url = current ? `${endpoint}/${current.id}` : endpoint;
	const response = await fetch(url, {
		method,
		headers,
		body: JSON.stringify(discordPieCommandPayload()),
	});
	if (!response.ok) {
		const data = (await response.json().catch(() => ({}))) as { message?: string };
		throw new Error(data.message || `Discord slash command sync failed with HTTP ${response.status}`);
	}
}

function includesDiscordChannel(ids: string[] | undefined, channelId: string, parentChannelId?: string): boolean {
	if (!ids?.length) return false;
	return ids.includes(channelId) || (parentChannelId ? ids.includes(parentChannelId) : false);
}

function isDiscordThreadChannel(channel: Message["channel"] | Interaction["channel"]): boolean {
	const candidate = channel as { isThread?: () => boolean } | null;
	return candidate?.isThread?.() ?? false;
}

function discordParentChannelId(channel: Message["channel"] | Interaction["channel"]): string | undefined {
	const parentId = (channel as { parentId?: string | null } | null)?.parentId;
	return parentId || undefined;
}

function discordChannelDisplayName(
	channel: Message["channel"] | Interaction["channel"],
	fallback: string,
): string {
	const name = (channel as { name?: unknown } | null)?.name;
	return typeof name === "string" && name.trim() ? name : fallback;
}

function discordChannelKey(prefix: "dm" | "channel" | "thread", channelId: string): string {
	return `${prefix}-${channelId.replace(/[^a-zA-Z0-9._-]+/g, "_")}`;
}

function shouldAllowDiscordChannel(account: DiscordAccountConfig, channelId: string, parentChannelId?: string): boolean {
	if (includesDiscordChannel(account.ignoredChannelIds, channelId, parentChannelId)) return false;
	if (account.allowedChannelIds?.length && !includesDiscordChannel(account.allowedChannelIds, channelId, parentChannelId)) return false;
	return true;
}

function discordChannelAccess(account: DiscordAccountConfig, channelId: string, isDm: boolean, parentChannelId?: string) {
	const freeResponse = includesDiscordChannel(account.freeResponseChannelIds, channelId, parentChannelId);
	return {
		...(account.access ?? {}),
		ignoreBots: account.access?.ignoreBots ?? true,
		trigger: isDm || freeResponse || account.access?.trigger === "message" ? ("message" as const) : ("mention" as const),
	};
}

function normalizeDiscordMentionName(value?: string): string {
	return (value ?? "").trim().toLowerCase();
}

function discordRoleMentionsBot(account: DiscordAccountConfig, message: Message): boolean {
	const botNames = [account.botUsername, account.name].map(normalizeDiscordMentionName).filter(Boolean);
	if (botNames.length === 0) return false;
	const botNameSet = new Set(botNames);
	if (message.mentions.roles.some((role) => botNameSet.has(normalizeDiscordMentionName(role.name)))) return true;
	return (
		message.guild?.members.me?.roles.cache.some(
			(role) => message.mentions.roles.has(role.id) && botNameSet.has(normalizeDiscordMentionName(role.name)),
		) ?? false
	);
}

export function discordMessageMentionsBot(account: DiscordAccountConfig, message: Message): boolean {
	return (
		message.mentions.users.has(account.botUserId || "") ||
		textMentionsBot(message.content || "", account.botUsername, account.botUserId) ||
		discordRoleMentionsBot(account, message)
	);
}

function discordMessageChannelConfig(account: DiscordAccountConfig, message: Message): { channelKey: string; channel: ConfiguredChannel } {
	const isDm = !message.guildId;
	const isThread = isDiscordThreadChannel(message.channel);
	const parentChannelId = discordParentChannelId(message.channel);
	const prefix = isDm ? "dm" : isThread ? "thread" : "channel";
	const channelName = isDm
		? `DM ${message.author.username}`
		: discordChannelDisplayName(message.channel, `${prefix}:${message.channelId}`);
	return {
		channelKey: discordChannelKey(prefix, message.channelId),
		channel: {
			id: message.channelId,
			name: channelName,
			dm: isDm,
			autoDiscovered: true,
			access: discordChannelAccess(account, message.channelId, isDm, parentChannelId),
		},
	};
}

function discordInteractionChannelConfig(
	account: DiscordAccountConfig,
	interaction: Interaction,
): { channelKey: string; channel: ConfiguredChannel } | undefined {
	const channelId = interaction.channelId;
	if (!channelId) return undefined;
	const isDm = !interaction.guildId;
	const isThread = isDiscordThreadChannel(interaction.channel);
	const parentChannelId = discordParentChannelId(interaction.channel);
	const prefix = isDm ? "dm" : isThread ? "thread" : "channel";
	const channelName = isDm
		? `DM ${interaction.user.username}`
		: discordChannelDisplayName(interaction.channel, `${prefix}:${channelId}`);
	return {
		channelKey: discordChannelKey(prefix, channelId),
		channel: {
			id: channelId,
			name: channelName,
			dm: isDm,
			autoDiscovered: true,
			access: discordChannelAccess(account, channelId, isDm, parentChannelId),
		},
	};
}

function shouldCreateDiscordEndpointForMessage(account: DiscordAccountConfig, message: Message): boolean {
	if (account.serverId && message.guildId && message.guildId !== account.serverId) return false;
	const parentChannelId = discordParentChannelId(message.channel);
	if (!shouldAllowDiscordChannel(account, message.channelId, parentChannelId)) return false;
	if (!message.guildId) return true;
	const voiceCommand = parseDiscordVoiceCommandText(message.content || "", {
		account,
		botName: account.botUsername || "pie",
	});
	if (voiceCommand) return true;
	const freeResponse = includesDiscordChannel(account.freeResponseChannelIds, message.channelId, parentChannelId);
	if (freeResponse || account.access?.trigger === "message") return true;
	return discordMessageMentionsBot(account, message);
}

function getDiscordInteractionCommand(interaction: Interaction): GatewayControlCommand | undefined {
	if (!interaction.isChatInputCommand() || interaction.commandName !== "pie") return undefined;
	if (interaction.options.getSubcommandGroup(false) === "voice") return undefined;
	const subcommand = interaction.options.getSubcommand(false);
	return GATEWAY_CONTROL_COMMANDS.includes(subcommand as GatewayControlCommand)
		? (subcommand as GatewayControlCommand)
		: undefined;
}

function getDiscordInteractionVoiceCommand(interaction: Interaction): DiscordVoiceCommand | undefined {
	if (!interaction.isChatInputCommand() || interaction.commandName !== "pie") return undefined;
	if (interaction.options.getSubcommandGroup(false) !== "voice") return undefined;
	const subcommand = interaction.options.getSubcommand(false);
	if (subcommand === "join" || subcommand === "leave" || subcommand === "status") return subcommand;
	return undefined;
}

function getDiscordInteractionRoleIds(interaction: Interaction): string[] | undefined {
	const roles = (interaction.member as { roles?: unknown } | null)?.roles;
	if (Array.isArray(roles)) return roles.map(String);
	if (roles && typeof roles === "object" && "cache" in roles) {
		const cache = (roles as { cache?: { map?(fn: (role: { id: string }) => string): string[] } }).cache;
		return cache?.map?.((role) => role.id);
	}
	return undefined;
}

async function acknowledgeDiscordInteraction(interaction: Interaction, content: string): Promise<void> {
	if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return;
	await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
}

async function respondDiscordInteraction(interaction: Interaction, content: string): Promise<void> {
	if (!interaction.isRepliable()) return;
	if (interaction.deferred || interaction.replied) {
		await interaction.editReply({ content }).catch(async () => {
			await interaction.followUp({ content, ephemeral: true }).catch(() => undefined);
		});
		return;
	}
	await interaction.reply({ content, ephemeral: true }).catch(() => undefined);
}

type DiscordTextChannel = {
	sendTyping(): Promise<void>;
	messages: {
		fetch(id: string): Promise<{ edit(payload: unknown): Promise<unknown>; delete(): Promise<unknown> }>;
		fetch(options: { after?: string; limit: number }): Promise<{ size: number; values(): IterableIterator<Message> }>;
	};
};

async function resolveDiscordTextChannel(
	client: Client<true>,
	conversation: ResolvedConversation,
): Promise<DiscordTextChannel> {
	const channel = await client.channels.fetch(conversation.channel.id);
	if (!channel?.isTextBased()) throw new Error(`Discord channel is not text-based: ${conversation.channel.id}`);
	return channel as unknown as DiscordTextChannel;
}

async function resolveInteractionVoiceChannel(
	client: Client<true>,
	interaction: Interaction,
): Promise<VoiceBasedChannel | undefined> {
	if (!interaction.guildId) return undefined;
	const guild = await client.guilds.fetch(interaction.guildId);
	const member = await guild.members.fetch(interaction.user.id).catch(() => undefined);
	return member?.voice.channel ?? undefined;
}

async function discordMessageToInput(
	conversation: ResolvedConversation,
	account: DiscordAccountConfig,
	message: Message,
): Promise<InboundMessageInput | undefined> {
	if (account.serverId && message.guildId && message.guildId !== account.serverId) return undefined;
	if (message.channelId !== conversation.channel.id) return undefined;
	if (message.author.id === account.botUserId) return undefined;
	const attachments: NonNullable<InboundMessageInput["attachments"]> = [];
	const transcriptBlocks: string[] = [];
	let index = 0;
	for (const attachment of message.attachments.values()) {
		const response = await fetch(attachment.url);
		if (!response.ok) continue;
		const data = new Uint8Array(await response.arrayBuffer());
		const stored = await storeDownloadedAttachment(
			conversation,
			message.id,
			++index,
			attachment.name || `attachment-${index}`,
			data,
			attachment.contentType || undefined,
			attachment.url,
		);
		attachments.push(stored);
		const storedName = stored.name || `attachment-${index}`;
		if (guessAttachmentKind(storedName, stored.mimeType) === "audio") {
			const transcription = await transcribeGatewayAudio({ filePath: stored.path, mimeType: stored.mimeType });
			if (transcription.text) {
				transcriptBlocks.push(`${formatTranscriptionHeader(`Audio transcript:${storedName}`, transcription)}\n${transcription.text}`);
			} else if (transcription.skipped && transcription.skippedReason) {
				transcriptBlocks.push(
					`${formatTranscriptionHeader(`Audio transcript skipped:${storedName}`, transcription)} ${transcription.skippedReason}`,
				);
			} else if (transcription.error && !transcription.skipped) {
				transcriptBlocks.push(`${formatTranscriptionHeader(`Audio transcript unavailable:${storedName}`, transcription)} ${transcription.error}`);
			}
		}
	}
	const text = [message.content || "", ...transcriptBlocks].filter(Boolean).join("\n\n");
	const isDm = !message.guildId;
	const isThread = isDiscordThreadChannel(message.channel);
	const parentChannelId = discordParentChannelId(message.channel);
	return {
		messageId: message.id,
		chatId: message.channelId,
		chatName: conversation.channel.name || discordChannelDisplayName(message.channel, message.channelId),
		chatType: isDm ? "dm" : isThread ? "thread" : "channel",
		threadId: isThread ? message.channelId : undefined,
		parentChatId: isThread ? parentChannelId : undefined,
		userId: message.author.id,
		userName: message.member?.displayName || message.author.username,
		roleIds: message.member?.roles.cache.map((role) => role.id),
		text,
		mentionedBot: discordMessageMentionsBot(account, message),
		isBot: message.author.bot,
		attachments,
	};
}

async function postDiscordMessage(
	botToken: string,
	channelId: string,
	payload: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<string> {
	const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		method: "POST",
		headers: { Authorization: `Bot ${botToken}`, "content-type": "application/json" },
		body: JSON.stringify(payload),
		signal,
	});
	const data = (await response.json()) as { id?: string; message?: string };
	if (!response.ok || !data.id) throw new Error(data.message || "Discord send failed");
	return data.id;
}

async function sendDiscordMessage(
	botToken: string,
	channelId: string,
	content: string,
	attachmentPaths: string[] = [],
	signal?: AbortSignal,
	replyToMessageId?: string,
): Promise<string> {
	const rendered = formatMarkdownForService("discord", content);
	const chunks = chunkText(rendered.text || (attachmentPaths.length ? " " : ""), maxMessageLength("discord"));
	let firstMessageId: string | undefined;
	for (let i = 0; i < chunks.length; i++) {
		const payload: Record<string, unknown> = { content: chunks[i] };
		if (i === 0 && replyToMessageId) payload.message_reference = { message_id: replyToMessageId };
		if (i === chunks.length - 1 && attachmentPaths.length > 0) {
			const form = new FormData();
			form.set("payload_json", JSON.stringify(payload));
			for (const [index, path] of attachmentPaths.entries()) {
				const file = await readLocalAttachment(path);
				form.set(`files[${index}]`, new Blob([Buffer.from(file.data)], { type: file.mimeType }), file.name);
			}
			const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
				method: "POST",
				headers: { Authorization: `Bot ${botToken}` },
				body: form,
				signal,
			});
			const data = (await response.json()) as { id?: string; message?: string };
			if (!response.ok || !data.id) throw new Error(data.message || "Discord send failed");
			firstMessageId ??= data.id;
		} else {
			const id = await postDiscordMessage(botToken, channelId, payload, signal);
			firstMessageId ??= id;
		}
	}
	return firstMessageId || "";
}

class DiscordTransport implements GatewayTransport {
	private readonly client: Client<true>;
	private readonly conversation: ResolvedConversation;
	private readonly account: DiscordAccountConfig;
	private readonly voiceController?: DiscordVoiceController;

	constructor(
		client: Client<true>,
		conversation: ResolvedConversation,
		account: DiscordAccountConfig,
		voiceController?: DiscordVoiceController,
	) {
		this.client = client;
		this.conversation = conversation;
		this.account = account;
		this.voiceController = voiceController;
	}

	async sendImmediate(text: string, replyToMessageId?: string): Promise<string> {
		return sendDiscordMessage(this.account.botToken, this.conversation.channel.id, text, [], undefined, replyToMessageId);
	}

	async send(
		text: string,
		attachmentPaths: string[] = [],
		signal?: AbortSignal,
		replyToMessageId?: string,
	): Promise<string> {
		const id = await sendDiscordMessage(this.account.botToken, this.conversation.channel.id, text, attachmentPaths, signal, replyToMessageId);
		void this.voiceController?.speakReply(this.conversation.channel.id, text, attachmentPaths).catch(() => undefined);
		return id;
	}

	async startTyping(): Promise<void> {
		const channel = await resolveDiscordTextChannel(this.client, this.conversation);
		await channel.sendTyping();
	}

	async stopTyping(): Promise<void> {}
}

async function catchUpDiscordChannel(
	client: Client<true>,
	endpoint: GatewayConversationEndpoint,
	account: DiscordAccountConfig,
	afterId?: string,
): Promise<void> {
	const channel = await resolveDiscordTextChannel(client, endpoint.conversation);
	const allMessages: Message[] = [];
	let cursor = afterId;
	while (true) {
		const batch = await channel.messages.fetch(cursor ? { after: cursor, limit: 100 } : { limit: 25 });
		if (batch.size === 0) break;
		const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
		allMessages.push(...sorted);
		cursor = sorted.at(-1)?.id;
		if (batch.size < 100) break;
	}
	for (const message of allMessages) {
		const input = await discordMessageToInput(endpoint.conversation, account, message);
		if (input) await endpoint.onMessage(input, { cursor: input.messageId, messageId: input.messageId });
	}
}

async function startDiscordAccountAdapter(
	accountId: string,
	account: DiscordAccountConfig,
	endpoints: GatewayConversationEndpoint[],
	context?: GatewayAccountAdapterContext,
): Promise<GatewayAdapter> {
	const client = await withReadyDiscordClient(account.botToken);
	account.botUserId ??= client.user.id;
	account.botUsername ??= client.user.username;
	account.applicationId ??= client.user.id;
	const health: GatewayAdapterHealth = {
		accountId,
		service: "discord",
		connected: true,
		startedAt: new Date().toISOString(),
		errorCount: 0,
	};
	await syncDiscordGatewayCommand(account).catch((error) => {
		health.errorCount++;
		health.lastError = error instanceof Error ? error.message : String(error);
	});
	const byChannelId = new Map(endpoints.map((endpoint) => [endpoint.conversation.channel.id, endpoint]));
	const activeEndpoints = new Set(endpoints);
	const ensureTransport = (endpoint: GatewayConversationEndpoint) => {
		activeEndpoints.add(endpoint);
		byChannelId.set(endpoint.conversation.channel.id, endpoint);
		endpoint.setTransport(new DiscordTransport(client, endpoint.conversation, account, voiceController));
	};
	const voiceController = new DiscordVoiceController({
		client,
		account,
		sendText: (channelId, text) => sendDiscordMessage(account.botToken, channelId, text),
		onActivity: () => {
			health.lastActivityAt = new Date().toISOString();
		},
		onError: (error) => {
			health.errorCount++;
			health.lastError = error.message;
			for (const endpoint of activeEndpoints) void endpoint.onError(error);
		},
	});
	const resolveMessageEndpoint = async (message: Message): Promise<GatewayConversationEndpoint | undefined> => {
		const configured = byChannelId.get(message.channelId);
		if (configured) return configured;
		if (!context || !shouldCreateDiscordEndpointForMessage(account, message)) return undefined;
		const { channelKey, channel } = discordMessageChannelConfig(account, message);
		const endpoint = await context.getOrCreateEndpoint(accountId, account, channelKey, channel);
		ensureTransport(endpoint);
		await endpoint.onCaughtUp();
		return endpoint;
	};
	const resolveInteractionEndpoint = async (interaction: Interaction): Promise<GatewayConversationEndpoint | undefined> => {
		if (!interaction.channelId) return undefined;
		const configured = byChannelId.get(interaction.channelId);
		if (configured) return configured;
		if (!context) return undefined;
		if (account.serverId && interaction.guildId && interaction.guildId !== account.serverId) return undefined;
		const parentChannelId = discordParentChannelId(interaction.channel);
		if (!shouldAllowDiscordChannel(account, interaction.channelId, parentChannelId)) return undefined;
		const resolved = discordInteractionChannelConfig(account, interaction);
		if (!resolved) return undefined;
		const endpoint = await context.getOrCreateEndpoint(accountId, account, resolved.channelKey, resolved.channel);
		ensureTransport(endpoint);
		await endpoint.onCaughtUp();
		return endpoint;
	};
	for (const endpoint of endpoints) {
		ensureTransport(endpoint);
		await catchUpDiscordChannel(client, endpoint, account, endpoint.getLastCheckpoint().messageId);
		await endpoint.onCaughtUp();
	}

	const onMessageCreate = async (message: Message) => {
		if (message.author.id === client.user.id) return;
		const endpoint = await resolveMessageEndpoint(message);
		if (!endpoint) return;
		try {
			if (await voiceController.handleMessage(message, endpoint)) {
				health.lastActivityAt = new Date().toISOString();
				return;
			}
			const input = await discordMessageToInput(endpoint.conversation, account, message);
			if (input) {
				health.lastActivityAt = new Date().toISOString();
				await endpoint.onMessage(input, { cursor: input.messageId, messageId: input.messageId });
			}
		} catch (error) {
			health.errorCount++;
			health.lastError = error instanceof Error ? error.message : String(error);
			await endpoint.onError(error instanceof Error ? error : new Error(String(error)));
		}
	};
	const onInteractionCreate = async (interaction: Interaction) => {
		const voiceCommand = getDiscordInteractionVoiceCommand(interaction);
		if (voiceCommand) {
			const channelId = interaction.channelId;
			const endpoint = await resolveInteractionEndpoint(interaction);
			if (!channelId || !endpoint) {
				await respondDiscordInteraction(interaction, "No Pie gateway channel is available for this command.");
				return;
			}
			const allowed = voiceController.canUse(endpoint, {
				userId: interaction.user.id,
				userName: interaction.user.username,
				roleIds: getDiscordInteractionRoleIds(interaction),
				isBot: interaction.user.bot,
			});
			if (!allowed) {
				await respondDiscordInteraction(interaction, "You are not allowed to control this Pie gateway channel.");
				return;
			}
			await acknowledgeDiscordInteraction(interaction, `Pie /voice ${voiceCommand} received.`);
			try {
				health.lastActivityAt = new Date().toISOString();
				const voiceChannel = await resolveInteractionVoiceChannel(client, interaction);
				const response = await voiceController.executeCommand(voiceCommand, endpoint, voiceChannel);
				await respondDiscordInteraction(interaction, response);
			} catch (error) {
				health.errorCount++;
				health.lastError = error instanceof Error ? error.message : String(error);
				await respondDiscordInteraction(interaction, `Pie voice error: ${health.lastError}`);
				await endpoint.onError(error instanceof Error ? error : new Error(String(error)));
			}
			return;
		}
		const command = getDiscordInteractionCommand(interaction);
		if (!command) return;
		const channelId = interaction.channelId;
		const endpoint = await resolveInteractionEndpoint(interaction);
		if (!channelId || !endpoint) {
			await acknowledgeDiscordInteraction(interaction, "No Pie gateway channel is available for this command.");
			return;
		}
		await acknowledgeDiscordInteraction(interaction, `Pie /${command} received.`);
		try {
			health.lastActivityAt = new Date().toISOString();
			await endpoint.onMessage({
				messageId: `interaction:${interaction.id}`,
				chatId: channelId,
				chatName: endpoint.conversation.channel.name,
				chatType: "channel",
				userId: interaction.user.id,
				userName: interaction.member && "displayName" in interaction.member ? interaction.member.displayName : interaction.user.username,
				roleIds: getDiscordInteractionRoleIds(interaction),
				text: `/${command}`,
				mentionedBot: true,
				isBot: interaction.user.bot,
			});
		} catch (error) {
			health.errorCount++;
			health.lastError = error instanceof Error ? error.message : String(error);
			await endpoint.onError(error instanceof Error ? error : new Error(String(error)));
		}
	};
	client.on(Events.MessageCreate, onMessageCreate);
	client.on(Events.InteractionCreate, onInteractionCreate);
	client.on(Events.Error, (error) => {
		health.errorCount++;
		health.lastError = error instanceof Error ? error.message : String(error);
		for (const endpoint of activeEndpoints) void endpoint.onError(error instanceof Error ? error : new Error(String(error)));
	});
	client.on(Events.Invalidated, () => {
		health.connected = false;
		for (const endpoint of activeEndpoints) void endpoint.onDisconnect?.();
	});

	return {
		accountId,
		service: "discord",
		disconnect: async () => {
			client.off(Events.MessageCreate, onMessageCreate);
			client.off(Events.InteractionCreate, onInteractionCreate);
			health.connected = false;
			await voiceController.disconnect().catch(() => undefined);
			client.destroy();
		},
		getHealth: () => ({ ...health }),
	};
}

function groupEndpointsByAccount(endpoints: GatewayConversationEndpoint[]): Map<string, GatewayConversationEndpoint[]> {
	const grouped = new Map<string, GatewayConversationEndpoint[]>();
	for (const endpoint of endpoints) {
		const list = grouped.get(endpoint.conversation.accountId) ?? [];
		list.push(endpoint);
		grouped.set(endpoint.conversation.accountId, list);
	}
	return grouped;
}

function assertSameAccount(accountId: string, account: ChatAccountConfig, endpoints: GatewayConversationEndpoint[]): void {
	for (const endpoint of endpoints) {
		if (endpoint.conversation.account !== account) {
			throw new Error(`Gateway account grouping mismatch for ${accountId}`);
		}
	}
}

function assertTelegramAccount(account: ChatAccountConfig): asserts account is TelegramAccountConfig {
	if (account.service !== "telegram") throw new Error(`Expected telegram account, got ${account.service}`);
}

function assertDiscordAccount(account: ChatAccountConfig): asserts account is DiscordAccountConfig {
	if (account.service !== "discord") throw new Error(`Expected discord account, got ${account.service}`);
}

export function registerBuiltInGatewayPlatforms(
	registry: GatewayPlatformRegistry = defaultGatewayPlatformRegistry,
): GatewayPlatformRegistry {
	if (!registry.has("telegram")) {
		registry.register({
			service: "telegram",
			label: "Telegram",
			capabilities: {
				markdown: true,
				attachments: true,
				typing: true,
				polling: true,
			},
			startAccountAdapter: async (accountId, account, endpoints) => {
				assertTelegramAccount(account);
				return startTelegramAccountAdapter(accountId, account, endpoints);
			},
			sendMessage: async (account, channelId, text, options) => {
				assertTelegramAccount(account);
				return sendTelegramMessage(account, channelId, text, options?.attachmentPaths, options?.signal, options?.replyToMessageId);
			},
		});
	}
	if (!registry.has("discord")) {
		registry.register({
			service: "discord",
			label: "Discord",
			capabilities: {
				markdown: true,
				attachments: true,
				typing: true,
				realtime: true,
				threads: true,
				voiceInput: true,
				voiceOutput: true,
			},
			startAccountAdapter: async (accountId, account, endpoints, context) => {
				assertDiscordAccount(account);
				return startDiscordAccountAdapter(accountId, account, endpoints, context);
			},
			sendMessage: async (account, channelId, text, options) => {
				assertDiscordAccount(account);
				return sendDiscordMessage(account.botToken, channelId, text, options?.attachmentPaths, options?.signal, options?.replyToMessageId);
			},
		});
	}
	return registry;
}

registerBuiltInGatewayPlatforms();

export async function startGatewayChatAdapters(
	config: ChatConfig,
	endpoints: GatewayConversationEndpoint[],
	context: GatewayAccountAdapterContext,
	registry: GatewayPlatformRegistry = defaultGatewayPlatformRegistry,
): Promise<GatewayAdapter[]> {
	const adapters: GatewayAdapter[] = [];
	const grouped = groupEndpointsByAccount(endpoints);
	const accountIds = new Set<string>(grouped.keys());
	for (const [accountId, account] of Object.entries(config.accounts ?? {})) {
		if (account.service === "discord") accountIds.add(accountId);
	}
	for (const accountId of [...accountIds].sort()) {
		const group = grouped.get(accountId) ?? [];
		const account = group[0]?.conversation.account ?? config.accounts?.[accountId];
		if (!account) continue;
		if (group.length > 0) assertSameAccount(accountId, account, group);
		const platform = registry.require(account.service);
		adapters.push(await platform.startAccountAdapter(accountId, account, group, context));
	}
	return adapters;
}
