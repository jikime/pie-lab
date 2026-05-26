import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client, Events, GatewayIntentBits, type Message, Partials } from "discord.js";
import type {
	ChatAccountConfig,
	DiscordAccountConfig,
	ResolvedConversation,
	TelegramAccountConfig,
} from "./chat/core/config-types.js";
import type { InboundMessageInput } from "./chat/core/runtime-types.js";
import { CHAT_HOME } from "./chat/config.js";
import { fetchBinary, guessAttachmentKind, readLocalAttachment, storeDownloadedAttachment, textMentionsBot } from "./chat/live/common.js";
import { chunkText } from "./chat/render/chunking.js";
import { formatMarkdownForService, maxMessageLength, telegramHtmlToPlainText } from "./chat/render/format.js";

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

export interface GatewayAdapter {
	accountId: string;
	service: "telegram" | "discord";
	disconnect(): Promise<void>;
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
}

interface TelegramPhotoSize {
	file_id: string;
	file_size?: number;
}

interface TelegramDocument {
	file_id: string;
	file_name?: string;
	mime_type?: string;
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
}

interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
}

interface TelegramGetFileResult {
	file_path: string;
}

function sanitize(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
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
	if (!response.ok || !data.ok || data.result === undefined) {
		throw new Error(data.description || `Telegram API ${method} failed`);
	}
	return data.result;
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
	const text = (message.text || message.caption || "").trim();
	const attachments: NonNullable<InboundMessageInput["attachments"]> = [];
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
	return {
		messageId: remoteMessageId,
		userId: String(message.from?.id ?? message.chat.id),
		userName: message.from?.username || message.from?.first_name,
		text,
		mentionedBot: textMentionsBot(text, account.botUsername),
		isBot: message.from?.is_bot ?? false,
		attachments,
	};
}

class TelegramTransport implements GatewayTransport {
	private readonly conversation: ResolvedConversation;
	private readonly account: TelegramAccountConfig;

	constructor(conversation: ResolvedConversation, account: TelegramAccountConfig) {
		this.conversation = conversation;
		this.account = account;
	}

	async sendImmediate(text: string, replyToMessageId?: string): Promise<string> {
		return this.send(text, [], undefined, replyToMessageId);
	}

	async send(
		text: string,
		attachmentPaths: string[] = [],
		signal?: AbortSignal,
		replyToMessageId?: string,
	): Promise<string> {
		const rendered = formatMarkdownForService("telegram", text);
		const replyParam = replyToMessageId ? { reply_to_message_id: Number(replyToMessageId) } : {};
		if (attachmentPaths.length === 0) {
			const chunks = chunkText(rendered.text, maxMessageLength("telegram"));
			let firstId: string | undefined;
			for (let i = 0; i < chunks.length; i++) {
				const id = String(
					(
						await callTelegramText<{ message_id: number }>(
							this.account.botToken,
							"sendMessage",
							{
								chat_id: Number.isFinite(Number(this.conversation.channel.id))
									? Number(this.conversation.channel.id)
									: this.conversation.channel.id,
								text: chunks[i],
								parse_mode: rendered.parseMode,
								disable_web_page_preview: true,
								...(i === 0 ? replyParam : {}),
							},
							telegramHtmlToPlainText(chunks[i] ?? ""),
							{ signal },
						)
					).message_id,
				);
				firstId ??= id;
			}
			return firstId || "";
		}

		const [firstPath, ...rest] = attachmentPaths;
		const first = await readLocalAttachment(firstPath);
		const firstKind = guessAttachmentKind(first.name, first.mimeType);
		const firstMethod = firstKind === "image" ? "sendPhoto" : "sendDocument";
		const firstField = firstKind === "image" ? "photo" : "document";
		const buildFirstForm = (caption: string, parseMode?: string) => {
			const form = new FormData();
			form.set("chat_id", this.conversation.channel.id);
			if (replyToMessageId) form.set("reply_to_message_id", String(Number(replyToMessageId)));
			if (caption) form.set("caption", caption);
			if (caption && parseMode) form.set("parse_mode", parseMode);
			form.set(firstField, new Blob([Buffer.from(first.data)], { type: first.mimeType }), first.name);
			return form;
		};
		let firstResponse = await fetch(`https://api.telegram.org/bot${this.account.botToken}/${firstMethod}`, {
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
			firstResponse = await fetch(`https://api.telegram.org/bot${this.account.botToken}/${firstMethod}`, {
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
			const method = kind === "image" ? "sendPhoto" : "sendDocument";
			const field = kind === "image" ? "photo" : "document";
			const form = new FormData();
			form.set("chat_id", this.conversation.channel.id);
			form.set(field, new Blob([Buffer.from(file.data)], { type: file.mimeType }), file.name);
			const response = await fetch(`https://api.telegram.org/bot${this.account.botToken}/${method}`, {
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

	async startTyping(): Promise<void> {
		await callTelegram(this.account.botToken, "sendChatAction", {
			chat_id: Number.isFinite(Number(this.conversation.channel.id))
				? Number(this.conversation.channel.id)
				: this.conversation.channel.id,
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
	let abort = false;
	let cursor = await readTelegramCursor(accountId);
	let offset = cursor !== undefined ? cursor + 1 : 0;
	const pollController = new AbortController();

	const processUpdate = async (update: TelegramUpdate): Promise<void> => {
		cursor = Math.max(cursor ?? 0, update.update_id);
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
			await endpoint.onMessage(input, { cursor: String(update.update_id), messageId: input.messageId });
		}
		await writeTelegramCursor(accountId, cursor);
	};

	const initialUpdates = await callTelegram<TelegramUpdate[]>(account.botToken, "getUpdates", {
		offset: offset > 0 ? offset : undefined,
		timeout: 0,
		allowed_updates: ["message", "edited_message"],
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
					{ offset: offset > 0 ? offset : undefined, timeout: 30, allowed_updates: ["message", "edited_message"] },
					{ signal: pollController.signal },
				);
				for (const update of updates) {
					offset = update.update_id + 1;
					await processUpdate(update);
				}
			} catch (error) {
				if (abort || (error instanceof Error && error.name === "AbortError")) break;
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
			pollController.abort();
			await loop.catch(() => undefined);
		},
	};
}

async function withReadyDiscordClient(token: string): Promise<Client<true>> {
	const client = new Client({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
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

async function discordMessageToInput(
	conversation: ResolvedConversation,
	account: DiscordAccountConfig,
	message: Message,
): Promise<InboundMessageInput | undefined> {
	if (message.guildId !== account.serverId) return undefined;
	if (message.channelId !== conversation.channel.id) return undefined;
	if (message.author.id === account.botUserId) return undefined;
	const attachments: NonNullable<InboundMessageInput["attachments"]> = [];
	let index = 0;
	for (const attachment of message.attachments.values()) {
		const response = await fetch(attachment.url);
		if (!response.ok) continue;
		const data = new Uint8Array(await response.arrayBuffer());
		attachments.push(
			await storeDownloadedAttachment(
				conversation,
				message.id,
				++index,
				attachment.name || `attachment-${index}`,
				data,
				attachment.contentType || undefined,
				attachment.url,
			),
		);
	}
	return {
		messageId: message.id,
		userId: message.author.id,
		userName: message.member?.displayName || message.author.username,
		roleIds: message.member?.roles.cache.map((role) => role.id),
		text: message.content || "",
		mentionedBot:
			message.mentions.users.has(account.botUserId || "") ||
			textMentionsBot(message.content || "", account.botUsername, account.botUserId),
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

	constructor(client: Client<true>, conversation: ResolvedConversation, account: DiscordAccountConfig) {
		this.client = client;
		this.conversation = conversation;
		this.account = account;
	}

	async sendImmediate(text: string, replyToMessageId?: string): Promise<string> {
		return this.send(text, [], undefined, replyToMessageId);
	}

	async send(
		text: string,
		attachmentPaths: string[] = [],
		signal?: AbortSignal,
		replyToMessageId?: string,
	): Promise<string> {
		return sendDiscordMessage(this.account.botToken, this.conversation.channel.id, text, attachmentPaths, signal, replyToMessageId);
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
): Promise<GatewayAdapter> {
	const client = await withReadyDiscordClient(account.botToken);
	const byChannelId = new Map(endpoints.map((endpoint) => [endpoint.conversation.channel.id, endpoint]));
	for (const endpoint of endpoints) {
		endpoint.setTransport(new DiscordTransport(client, endpoint.conversation, account));
		await catchUpDiscordChannel(client, endpoint, account, endpoint.getLastCheckpoint().messageId);
		await endpoint.onCaughtUp();
	}

	const onMessageCreate = async (message: Message) => {
		const endpoint = byChannelId.get(message.channelId);
		if (!endpoint) return;
		try {
			const input = await discordMessageToInput(endpoint.conversation, account, message);
			if (input) await endpoint.onMessage(input, { cursor: input.messageId, messageId: input.messageId });
		} catch (error) {
			await endpoint.onError(error instanceof Error ? error : new Error(String(error)));
		}
	};
	client.on(Events.MessageCreate, onMessageCreate);
	client.on(Events.Error, (error) => {
		for (const endpoint of endpoints) void endpoint.onError(error instanceof Error ? error : new Error(String(error)));
	});
	client.on(Events.Invalidated, () => {
		for (const endpoint of endpoints) void endpoint.onDisconnect?.();
	});

	return {
		accountId,
		service: "discord",
		disconnect: async () => {
			client.off(Events.MessageCreate, onMessageCreate);
			client.destroy();
		},
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

export async function startGatewayChatAdapters(endpoints: GatewayConversationEndpoint[]): Promise<GatewayAdapter[]> {
	const adapters: GatewayAdapter[] = [];
	for (const [accountId, group] of groupEndpointsByAccount(endpoints)) {
		const account = group[0]?.conversation.account;
		if (!account) continue;
		assertSameAccount(accountId, account, group);
		if (account.service === "telegram") {
			adapters.push(await startTelegramAccountAdapter(accountId, account, group));
		} else {
			adapters.push(await startDiscordAccountAdapter(accountId, account, group));
		}
	}
	return adapters;
}
