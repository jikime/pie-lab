import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Readable } from "node:stream";
import {
	type AudioPlayer,
	AudioPlayerStatus,
	createAudioPlayer,
	createAudioResource,
	EndBehaviorType,
	entersState,
	joinVoiceChannel,
	type VoiceConnection,
	VoiceConnectionStatus,
} from "@discordjs/voice";
import type { Client, GuildMember, Message, VoiceBasedChannel } from "discord.js";
import { opus } from "prism-media";
import type { GatewayConversationEndpoint } from "./adapters.ts";
import type { DiscordAccountConfig } from "./chat/core/config-types.ts";
import type { InboundMessageInput } from "./chat/core/runtime-types.ts";
import { guessAttachmentKind } from "./chat/live/common.ts";
import { synthesizeGatewaySpeech } from "./speech.ts";
import { transcribeGatewayAudio } from "./transcription.ts";

export type DiscordVoiceCommand = "join" | "leave" | "status";

interface DiscordVoiceControllerOptions {
	client: Client<true>;
	account: DiscordAccountConfig;
	sendText(channelId: string, text: string): Promise<string>;
	onActivity(): void;
	onError(error: Error): void;
}

interface DiscordVoiceSession {
	textChannelId: string;
	voiceChannelId: string;
	guildId: string;
	endpoint: GatewayConversationEndpoint;
	connection: VoiceConnection;
	player: AudioPlayer;
	activeRecordings: Set<string>;
	playing: boolean;
	startedAt: string;
}

interface DiscordVoiceSpeaker {
	userId: string;
	userName?: string;
	roleIds?: string[];
	isBot?: boolean;
}

const DISCORD_VOICE_SAMPLE_RATE = 48000;
const DISCORD_VOICE_CHANNELS = 2;
const DISCORD_VOICE_BITS_PER_SAMPLE = 16;

function envInt(name: string, fallback: number): number {
	const parsed = Number(process.env[name]);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function stripDiscordAddress(text: string, account: DiscordAccountConfig, botName: string): string {
	let normalized = text;
	if (account.botUserId) normalized = normalized.replace(new RegExp(`<@!?${account.botUserId}>`, "g"), " ");
	const aliases = [botName, account.botUsername].filter(Boolean);
	for (const alias of aliases) {
		const escaped = String(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		normalized = normalized.replace(new RegExp(`@${escaped}\\b`, "ig"), " ");
	}
	return normalized.replace(/\s+/g, " ").trim();
}

export function parseDiscordVoiceCommandText(
	text: string,
	options: { account?: DiscordAccountConfig; botName?: string } = {},
): DiscordVoiceCommand | undefined {
	const stripped =
		options.account && options.botName
			? stripDiscordAddress(text, options.account, options.botName)
			: text.replace(/\s+/g, " ").trim();
	const command = stripped.toLowerCase();
	if (command === "/voice" || command === "voice" || command === "/voice status" || command === "voice status")
		return "status";
	if (
		command === "/voice join" ||
		command === "voice join" ||
		command === "/voice channel" ||
		command === "voice channel"
	) {
		return "join";
	}
	if (command === "/voice leave" || command === "voice leave" || command === "/voice off" || command === "voice off")
		return "leave";
	return undefined;
}

export function createWavBuffer(
	pcm: Buffer,
	options: { sampleRate?: number; channels?: number; bitsPerSample?: number } = {},
): Buffer {
	const sampleRate = options.sampleRate ?? DISCORD_VOICE_SAMPLE_RATE;
	const channels = options.channels ?? DISCORD_VOICE_CHANNELS;
	const bitsPerSample = options.bitsPerSample ?? DISCORD_VOICE_BITS_PER_SAMPLE;
	const blockAlign = (channels * bitsPerSample) / 8;
	const byteRate = sampleRate * blockAlign;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function isAllowed(endpoint: GatewayConversationEndpoint, speaker: DiscordVoiceSpeaker): boolean {
	const access = endpoint.conversation.access;
	if ((speaker.isBot ?? false) && (access.ignoreBots ?? true)) return false;
	if (access.allowedUserIds?.length && !access.allowedUserIds.includes(speaker.userId)) return false;
	if (access.allowedRoleIds?.length) {
		const roleIds = speaker.roleIds ?? [];
		if (!roleIds.some((roleId) => access.allowedRoleIds?.includes(roleId))) return false;
	}
	return true;
}

function memberToSpeaker(member: GuildMember): DiscordVoiceSpeaker {
	return {
		userId: member.id,
		userName: member.displayName || member.user.username,
		roleIds: member.roles.cache.map((role) => role.id),
		isBot: member.user.bot,
	};
}

function textForSpeech(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\[[^\]]+\]\([^)]+\)/g, " ")
		.replace(/[#>*_~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, envInt("PIE_GATEWAY_VOICE_TTS_MAX_CHARS", 900));
}

async function collectDecodedPcm(opusStream: Readable): Promise<Buffer> {
	const decoder = new opus.Decoder({
		rate: DISCORD_VOICE_SAMPLE_RATE,
		channels: DISCORD_VOICE_CHANNELS,
		frameSize: 960,
	});
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	const maxBytes = envInt("PIE_GATEWAY_VOICE_PCM_MAX_BYTES", 8 * 1024 * 1024);
	opusStream.pipe(decoder);
	for await (const chunk of decoder) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
		totalBytes += buffer.length;
		if (maxBytes > 0 && totalBytes > maxBytes) {
			opusStream.destroy(new Error(`voice PCM exceeded ${maxBytes} bytes`));
			break;
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

export class DiscordVoiceController {
	private readonly client: Client<true>;
	private readonly account: DiscordAccountConfig;
	private readonly sendText: (channelId: string, text: string) => Promise<string>;
	private readonly onActivity: () => void;
	private readonly onError: (error: Error) => void;
	private readonly sessions = new Map<string, DiscordVoiceSession>();

	constructor(options: DiscordVoiceControllerOptions) {
		this.client = options.client;
		this.account = options.account;
		this.sendText = options.sendText;
		this.onActivity = options.onActivity;
		this.onError = options.onError;
	}

	async handleMessage(message: Message, endpoint: GatewayConversationEndpoint): Promise<boolean> {
		const command = parseDiscordVoiceCommandText(message.content || "", {
			account: this.account,
			botName: endpoint.conversation.botName,
		});
		if (!command) return false;
		const member = message.member;
		const speaker = member
			? memberToSpeaker(member)
			: { userId: message.author.id, userName: message.author.username, isBot: message.author.bot };
		if (!isAllowed(endpoint, speaker)) return true;
		const response = await this.executeCommand(command, endpoint, member?.voice.channel ?? undefined);
		await this.sendText(message.channelId, response);
		return true;
	}

	async executeCommand(
		command: DiscordVoiceCommand,
		endpoint: GatewayConversationEndpoint,
		voiceChannel?: VoiceBasedChannel,
	): Promise<string> {
		if (command === "leave") return this.leave(endpoint.conversation.channel.id);
		if (command === "status") return this.status(endpoint.conversation.channel.id);
		if (!voiceChannel) return "Join a Discord voice channel first, then run `/voice join` again.";
		return this.join(endpoint, voiceChannel);
	}

	canUse(endpoint: GatewayConversationEndpoint, speaker: DiscordVoiceSpeaker): boolean {
		return isAllowed(endpoint, speaker);
	}

	async join(endpoint: GatewayConversationEndpoint, voiceChannel: VoiceBasedChannel): Promise<string> {
		if (!voiceChannel.guildId) return "That voice channel is not attached to a guild.";
		const textChannelId = endpoint.conversation.channel.id;
		const existing = this.sessions.get(textChannelId);
		if (existing) {
			existing.connection.destroy();
			this.sessions.delete(textChannelId);
		}
		const player = createAudioPlayer();
		const connection = joinVoiceChannel({
			channelId: voiceChannel.id,
			guildId: voiceChannel.guildId,
			adapterCreator: voiceChannel.guild.voiceAdapterCreator,
			selfDeaf: false,
			selfMute: false,
		});
		connection.subscribe(player);
		await entersState(connection, VoiceConnectionStatus.Ready, envInt("PIE_GATEWAY_VOICE_JOIN_TIMEOUT_MS", 20000));
		const session: DiscordVoiceSession = {
			textChannelId,
			voiceChannelId: voiceChannel.id,
			guildId: voiceChannel.guildId,
			endpoint,
			connection,
			player,
			activeRecordings: new Set(),
			playing: false,
			startedAt: new Date().toISOString(),
		};
		this.sessions.set(textChannelId, session);
		connection.receiver.speaking.on("start", (userId) => {
			void this.handleSpeakingStart(session, userId).catch((error) => this.reportError(error));
		});
		connection.on(VoiceConnectionStatus.Disconnected, async () => {
			// Attempt to distinguish a transient network blip from a true disconnect.
			try {
				await Promise.race([
					entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
					entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
				]);
				// Successfully entered a reconnecting state — wait for Ready (20 s).
				try {
					await entersState(
						connection,
						VoiceConnectionStatus.Ready,
						envInt("PIE_GATEWAY_VOICE_JOIN_TIMEOUT_MS", 20_000),
					);
				} catch {
					// Still not ready — give up and clean up.
					if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
					this.sessions.delete(textChannelId);
				}
			} catch {
				// Could not enter a reconnecting state within 5 s — truly disconnected.
				this.sessions.delete(textChannelId);
			}
		});

		// Guard against a connection stuck indefinitely in Signalling.
		connection.on(VoiceConnectionStatus.Signalling, () => {
			entersState(connection, VoiceConnectionStatus.Connecting, 10_000).catch(() => {
				if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
					connection.destroy();
					this.sessions.delete(textChannelId);
				}
			});
		});

		// Guard against a connection stuck indefinitely in Connecting.
		connection.on(VoiceConnectionStatus.Connecting, () => {
			entersState(
				connection,
				VoiceConnectionStatus.Ready,
				envInt("PIE_GATEWAY_VOICE_JOIN_TIMEOUT_MS", 20_000),
			).catch(() => {
				if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
					connection.destroy();
					this.sessions.delete(textChannelId);
				}
			});
		});
		return `Joined voice channel ${voiceChannel.name}. Voice input is active for this text channel.`;
	}

	leave(textChannelId: string): string {
		const session = this.sessions.get(textChannelId);
		if (!session) return "No active Discord voice channel session for this text channel.";
		session.connection.destroy();
		this.sessions.delete(textChannelId);
		return "Left the Discord voice channel.";
	}

	status(textChannelId: string): string {
		const session = this.sessions.get(textChannelId);
		if (!session) return "Discord voice channel session is not active.";
		return [
			"Discord voice channel session is active.",
			`Voice channel: ${session.voiceChannelId}`,
			`Started: ${session.startedAt}`,
			`Recording: ${session.activeRecordings.size}`,
			`Playing: ${session.playing ? "yes" : "no"}`,
		].join("\n");
	}

	async speakReply(textChannelId: string, text: string, attachmentPaths: string[] = []): Promise<void> {
		const session = this.sessions.get(textChannelId);
		if (!session) return;
		const audioAttachments = attachmentPaths.filter((path) => guessAttachmentKind(path) === "audio");
		if (audioAttachments.length > 0) {
			for (const path of audioAttachments) await this.playFile(session, path);
			return;
		}
		const spokenText = textForSpeech(text);
		if (!spokenText) return;
		const speech = await synthesizeGatewaySpeech({ text: spokenText });
		if (!speech.path) return;
		await this.playFile(session, speech.path);
	}

	async disconnect(): Promise<void> {
		for (const session of this.sessions.values()) session.connection.destroy();
		this.sessions.clear();
	}

	private async handleSpeakingStart(session: DiscordVoiceSession, userId: string): Promise<void> {
		if (
			session.playing ||
			userId === this.account.botUserId ||
			userId === this.client.user.id ||
			session.activeRecordings.has(userId)
		)
			return;
		const guild = await this.client.guilds.fetch(session.guildId);
		const member = await guild.members.fetch(userId).catch(() => undefined);
		if (!member) return;
		const speaker = memberToSpeaker(member);
		if (!isAllowed(session.endpoint, speaker)) return;
		session.activeRecordings.add(userId);
		try {
			const opusStream = session.connection.receiver.subscribe(userId, {
				end: {
					behavior: EndBehaviorType.AfterSilence,
					duration: envInt("PIE_GATEWAY_VOICE_SILENCE_MS", 1500),
				},
			});
			setTimeout(() => opusStream.destroy(), envInt("PIE_GATEWAY_VOICE_MAX_MS", 30000)).unref?.();
			const pcm = await collectDecodedPcm(opusStream);
			const minBytes = envInt("PIE_GATEWAY_VOICE_MIN_PCM_BYTES", 24000);
			if (pcm.length < minBytes) return;
			const wav = createWavBuffer(pcm);
			await mkdir(session.endpoint.conversation.filesDir, { recursive: true });
			const filePath = join(session.endpoint.conversation.filesDir, `voice-channel-${Date.now()}-${userId}.wav`);
			await writeFile(filePath, wav);
			const transcription = await transcribeGatewayAudio({ filePath, mimeType: "audio/wav" });
			if (!transcription.text?.trim()) {
				if (transcription.error)
					await this.sendText(session.textChannelId, `[Voice transcript unavailable] ${transcription.error}`);
				return;
			}
			const text = `[Voice] ${speaker.userName ?? userId}: ${transcription.text.trim()}`;
			await this.sendText(session.textChannelId, text);
			const input: InboundMessageInput = {
				messageId: `voice:${session.voiceChannelId}:${userId}:${Date.now()}`,
				chatId: session.textChannelId,
				chatName: session.endpoint.conversation.channel.name,
				chatType: "channel",
				userId,
				userName: speaker.userName,
				roleIds: speaker.roleIds,
				text,
				mentionedBot: true,
				isBot: false,
				attachments: [{ path: filePath, name: basename(filePath), mimeType: "audio/wav", kind: "audio" }],
			};
			this.onActivity();
			await session.endpoint.onMessage(input);
		} finally {
			session.activeRecordings.delete(userId);
		}
	}

	private async playFile(session: DiscordVoiceSession, path: string): Promise<void> {
		session.playing = true;
		try {
			const resource = createAudioResource(path);
			session.player.play(resource);
			await entersState(
				session.player,
				AudioPlayerStatus.Playing,
				envInt("PIE_GATEWAY_VOICE_PLAY_TIMEOUT_MS", 10000),
			).catch(() => undefined);
			await once(session.player, AudioPlayerStatus.Idle).catch(() => undefined);
		} finally {
			session.playing = false;
		}
	}

	private reportError(error: unknown): void {
		this.onError(error instanceof Error ? error : new Error(String(error)));
	}
}
