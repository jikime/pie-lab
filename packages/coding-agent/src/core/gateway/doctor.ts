import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getAgentDir } from "../../config.ts";
import { SettingsManager } from "../settings-manager.ts";
import { describeGatewayOpenAiAudioCredentials, resolveGatewayOpenAiAudioCredentials } from "./audio-credentials.ts";
import { CHAT_CONFIG_PATH, listConfiguredConversations, loadChatConfig } from "./chat/config.ts";
import type { ChatAccountConfig, DiscordAccountConfig, TelegramAccountConfig } from "./chat/core/config-types.ts";
import { type GatewayStatus, readGatewayStatus } from "./runner.ts";
import { getGatewayTtsMaxChars, getGatewayTtsOutputDir } from "./speech.ts";
import { getGatewaySttCacheDir, getGatewaySttMaxBytes } from "./transcription.ts";

export type GatewayDoctorLevel = "ok" | "warn" | "fail";

export interface GatewayDoctorCheck {
	level: GatewayDoctorLevel;
	name: string;
	message: string;
	detail?: string;
}

export interface GatewayDoctorReport {
	ok: boolean;
	checks: GatewayDoctorCheck[];
	status: GatewayStatus;
}

function isTelegramAccount(account: ChatAccountConfig): account is TelegramAccountConfig {
	return account.service === "telegram";
}

function isDiscordAccount(account: ChatAccountConfig): account is DiscordAccountConfig {
	return account.service === "discord";
}

function check(level: GatewayDoctorLevel, name: string, message: string, detail?: string): GatewayDoctorCheck {
	return { level, name, message, detail };
}

async function readMaybe(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return undefined;
	}
}

async function checkTelegramAccount(accountId: string, account: TelegramAccountConfig): Promise<GatewayDoctorCheck[]> {
	const checks: GatewayDoctorCheck[] = [];
	if (!account.botToken?.trim()) {
		return [check("fail", `telegram:${accountId}`, "Missing Telegram bot token.")];
	}
	try {
		const response = await fetch(`https://api.telegram.org/bot${account.botToken}/getMe`, { method: "POST" });
		const data = (await response.json().catch(() => ({}))) as {
			ok?: boolean;
			result?: { id?: number; username?: string };
			description?: string;
		};
		if (!response.ok || !data.ok) {
			checks.push(check("fail", `telegram:${accountId}`, "Telegram bot token is not valid.", data.description));
		} else {
			checks.push(
				check(
					"ok",
					`telegram:${accountId}`,
					`Telegram bot token is valid${data.result?.username ? ` for @${data.result.username}` : ""}.`,
				),
			);
		}
	} catch (error) {
		checks.push(check("fail", `telegram:${accountId}`, "Could not reach Telegram API.", String(error)));
	}

	for (const [channelKey, channel] of Object.entries(account.channels ?? {})) {
		if (!channel.id?.trim()) {
			checks.push(check("fail", `telegram:${accountId}/${channelKey}`, "Missing Telegram chat id."));
			continue;
		}
		try {
			const response = await fetch(`https://api.telegram.org/bot${account.botToken}/getChat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ chat_id: Number.isFinite(Number(channel.id)) ? Number(channel.id) : channel.id }),
			});
			const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
			checks.push(
				response.ok && data.ok
					? check("ok", `telegram:${accountId}/${channelKey}`, "Telegram chat is reachable.")
					: check(
							"fail",
							`telegram:${accountId}/${channelKey}`,
							"Telegram chat is not reachable.",
							data.description,
						),
			);
		} catch (error) {
			checks.push(
				check("fail", `telegram:${accountId}/${channelKey}`, "Could not check Telegram chat.", String(error)),
			);
		}
	}
	return checks;
}

async function checkDiscordAccount(accountId: string, account: DiscordAccountConfig): Promise<GatewayDoctorCheck[]> {
	const checks: GatewayDoctorCheck[] = [];
	const headers = { Authorization: `Bot ${account.botToken}` };
	if (!account.botToken?.trim()) {
		return [check("fail", `discord:${accountId}`, "Missing Discord bot token.")];
	}
	try {
		const response = await fetch("https://discord.com/api/v10/users/@me", { headers });
		const data = (await response.json().catch(() => ({}))) as { id?: string; username?: string; message?: string };
		if (!response.ok || !data.id) {
			checks.push(check("fail", `discord:${accountId}`, "Discord bot token is not valid.", data.message));
		} else {
			checks.push(
				check("ok", `discord:${accountId}`, `Discord bot token is valid for ${data.username ?? data.id}.`),
			);
		}
	} catch (error) {
		checks.push(check("fail", `discord:${accountId}`, "Could not reach Discord API.", String(error)));
	}

	const applicationId = account.applicationId || account.botUserId;
	if (!applicationId?.trim())
		checks.push(
			check("warn", `discord:${accountId}`, "Missing Discord application id; slash command sync will be skipped."),
		);
	if (!account.serverId?.trim()) {
		checks.push(
			check(
				"ok",
				`discord:${accountId}`,
				"No Discord server id configured; the bot will listen in accessible guilds/DMs and use global slash command sync when possible.",
			),
		);
	}

	if (account.serverId?.trim()) {
		try {
			const response = await fetch(`https://discord.com/api/v10/guilds/${account.serverId}`, { headers });
			const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
			checks.push(
				response.ok && data.id
					? check("ok", `discord:${accountId}`, "Discord guild is reachable.")
					: check("fail", `discord:${accountId}`, "Discord guild is not reachable.", data.message),
			);
		} catch (error) {
			checks.push(check("fail", `discord:${accountId}`, "Could not check Discord guild.", String(error)));
		}
	}

	if (applicationId?.trim()) {
		try {
			const endpoint = account.serverId?.trim()
				? `https://discord.com/api/v10/applications/${applicationId}/guilds/${account.serverId}/commands`
				: `https://discord.com/api/v10/applications/${applicationId}/commands`;
			const response = await fetch(endpoint, { headers });
			const data = (await response.json().catch(() => ({}))) as { message?: string };
			checks.push(
				response.ok
					? check("ok", `discord:${accountId}`, "Discord application commands are accessible.")
					: check(
							"warn",
							`discord:${accountId}`,
							"Discord slash commands are not accessible. Reinvite the bot with applications.commands scope.",
							data.message,
						),
			);
		} catch (error) {
			checks.push(
				check("warn", `discord:${accountId}`, "Could not check Discord slash command access.", String(error)),
			);
		}
	}

	for (const [channelKey, channel] of Object.entries(account.channels ?? {})) {
		if (!channel.id?.trim()) {
			checks.push(check("fail", `discord:${accountId}/${channelKey}`, "Missing Discord channel id."));
			continue;
		}
		try {
			const response = await fetch(`https://discord.com/api/v10/channels/${channel.id}`, { headers });
			const data = (await response.json().catch(() => ({}))) as { id?: string; type?: number; message?: string };
			checks.push(
				response.ok && data.id
					? check("ok", `discord:${accountId}/${channelKey}`, "Discord channel is reachable.")
					: check("fail", `discord:${accountId}/${channelKey}`, "Discord channel is not reachable.", data.message),
			);
		} catch (error) {
			checks.push(
				check("fail", `discord:${accountId}/${channelKey}`, "Could not check Discord channel.", String(error)),
			);
		}
	}
	if (account.homeChannelId?.trim()) {
		try {
			const response = await fetch(`https://discord.com/api/v10/channels/${account.homeChannelId}`, { headers });
			const data = (await response.json().catch(() => ({}))) as { id?: string; type?: number; message?: string };
			checks.push(
				response.ok && data.id
					? check("ok", `discord:${accountId}/home`, "Discord home channel is reachable.")
					: check("warn", `discord:${accountId}/home`, "Discord home channel is not reachable.", data.message),
			);
		} catch (error) {
			checks.push(
				check("warn", `discord:${accountId}/home`, "Could not check Discord home channel.", String(error)),
			);
		}
	}
	return checks;
}

async function checkStt(env: NodeJS.ProcessEnv = process.env): Promise<GatewayDoctorCheck[]> {
	const checks: GatewayDoctorCheck[] = [];
	const cacheDisabled = env.PIE_GATEWAY_STT_CACHE === "0" || env.PIE_GATEWAY_STT_CACHE?.toLowerCase() === "false";
	const maxBytes = getGatewaySttMaxBytes(env);
	checks.push(
		check(
			cacheDisabled ? "warn" : "ok",
			"stt-cache",
			cacheDisabled
				? "Gateway STT cache is disabled by PIE_GATEWAY_STT_CACHE."
				: `Gateway STT cache is enabled at ${getGatewaySttCacheDir(env)}.`,
		),
	);
	checks.push(
		check(
			maxBytes > 0 ? "ok" : "warn",
			"stt-limit",
			maxBytes > 0
				? `Gateway STT max file size is ${maxBytes} bytes.`
				: "Gateway STT max file size guard is disabled.",
		),
	);
	if (env.PIE_GATEWAY_STT === "0" || env.PIE_GATEWAY_STT?.toLowerCase() === "false") {
		return [...checks, check("warn", "stt", "Gateway STT is disabled by PIE_GATEWAY_STT.")];
	}
	if (env.PIE_GATEWAY_STT_ENDPOINT) {
		return [...checks, check("ok", "stt", `Custom STT endpoint configured: ${env.PIE_GATEWAY_STT_ENDPOINT}`)];
	}
	const openAiAudio = await resolveGatewayOpenAiAudioCredentials(env);
	if (openAiAudio) {
		return [
			...checks,
			check(
				"ok",
				"stt",
				`${describeGatewayOpenAiAudioCredentials(openAiAudio)} is present for direct OpenAI transcription fallback.`,
			),
		];
	}
	const host = env.PIE_LAB_SERVER_HOST || env.PIE_ADK_SERVER_HOST || "127.0.0.1";
	const port = env.PIE_LAB_SERVER_PORT || env.PIE_ADK_SERVER_PORT || "4873";
	const endpoint = `http://${host}:${port}/media/routes`;
	try {
		const response = await fetch(endpoint);
		if (!response.ok) {
			return [
				...checks,
				check("warn", "stt", "Local Pie server media routes are not reachable.", `HTTP ${response.status}`),
			];
		}
		return [...checks, check("ok", "stt", "Local Pie server is reachable for auto:stt routing.")];
	} catch {
		return [
			...checks,
			check(
				"warn",
				"stt",
				"STT has no OpenAI credential from env/provider settings/auth.json and local Pie server is not reachable. Run `pie gateway audio set` for direct OpenAI audio. Voice messages will continue without transcription.",
				endpoint,
			),
		];
	}
}

async function checkTts(env: NodeJS.ProcessEnv = process.env): Promise<GatewayDoctorCheck[]> {
	const checks: GatewayDoctorCheck[] = [];
	const maxChars = getGatewayTtsMaxChars(env);
	checks.push(check("ok", "tts-output", `Gateway TTS output directory is ${getGatewayTtsOutputDir(env)}.`));
	checks.push(
		check(
			maxChars > 0 ? "ok" : "warn",
			"tts-limit",
			maxChars > 0
				? `Gateway TTS max text length is ${maxChars} chars.`
				: "Gateway TTS text length guard is disabled.",
		),
	);
	if (env.PIE_GATEWAY_TTS === "0" || env.PIE_GATEWAY_TTS?.toLowerCase() === "false") {
		return [...checks, check("warn", "tts", "Gateway TTS is disabled by PIE_GATEWAY_TTS.")];
	}
	if (env.PIE_GATEWAY_TTS_ENDPOINT) {
		return [...checks, check("ok", "tts", `Custom TTS endpoint configured: ${env.PIE_GATEWAY_TTS_ENDPOINT}`)];
	}
	const openAiAudio = await resolveGatewayOpenAiAudioCredentials(env);
	if (openAiAudio) {
		return [
			...checks,
			check(
				"ok",
				"tts",
				`${describeGatewayOpenAiAudioCredentials(openAiAudio)} is present for direct OpenAI speech fallback.`,
			),
		];
	}
	const host = env.PIE_LAB_SERVER_HOST || env.PIE_ADK_SERVER_HOST || "127.0.0.1";
	const port = env.PIE_LAB_SERVER_PORT || env.PIE_ADK_SERVER_PORT || "4873";
	const endpoint = `http://${host}:${port}/media/routes`;
	try {
		const response = await fetch(endpoint);
		if (!response.ok) {
			return [
				...checks,
				check("warn", "tts", "Local Pie server media routes are not reachable.", `HTTP ${response.status}`),
			];
		}
		return [...checks, check("ok", "tts", "Local Pie server is reachable for auto:tts routing.")];
	} catch {
		return [
			...checks,
			check(
				"warn",
				"tts",
				"TTS has no OpenAI credential from env/provider settings/auth.json and local Pie server is not reachable. Run `pie gateway audio set` for direct OpenAI audio. Voice replies will be skipped or fail gracefully.",
				endpoint,
			),
		];
	}
}

async function checkDiscordVoiceRuntime(): Promise<GatewayDoctorCheck[]> {
	const checks: GatewayDoctorCheck[] = [];
	try {
		await import("@discordjs/voice");
		checks.push(check("ok", "discord-voice", "@discordjs/voice is installed."));
	} catch (error) {
		checks.push(check("fail", "discord-voice", "@discordjs/voice is not available.", String(error)));
	}
	try {
		await import("prism-media");
		checks.push(check("ok", "discord-voice", "prism-media is installed for Opus decoding."));
	} catch (error) {
		checks.push(check("fail", "discord-voice", "prism-media is not available.", String(error)));
	}
	try {
		await import("opusscript");
		checks.push(check("ok", "discord-voice", "opusscript is installed for received voice decoding."));
	} catch (error) {
		checks.push(check("fail", "discord-voice", "opusscript is not available.", String(error)));
	}
	const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
	checks.push(
		check(
			ffmpeg.status === 0 ? "ok" : "warn",
			"discord-voice",
			ffmpeg.status === 0
				? "ffmpeg is available for Discord voice playback transcoding."
				: "ffmpeg is not available. Discord voice input can still decode Opus, but voice playback from MP3/WAV may fail.",
		),
	);
	return checks;
}

export async function runGatewayDoctor(
	options: { agentDir?: string; cwd?: string } = {},
): Promise<GatewayDoctorReport> {
	const agentDir = options.agentDir ?? getAgentDir();
	const cwd = options.cwd ?? process.cwd();
	const checks: GatewayDoctorCheck[] = [];
	const status = await readGatewayStatus({ agentDir });

	try {
		await access(dirname(CHAT_CONFIG_PATH));
		checks.push(check("ok", "config", `Chat config directory exists: ${dirname(CHAT_CONFIG_PATH)}`));
	} catch {
		checks.push(check("fail", "config", `Chat config directory is not accessible: ${dirname(CHAT_CONFIG_PATH)}`));
	}

	const rawConfig = await readMaybe(CHAT_CONFIG_PATH);
	if (rawConfig === undefined) {
		checks.push(check("warn", "config", `Chat config does not exist yet: ${CHAT_CONFIG_PATH}`));
	} else {
		try {
			JSON.parse(rawConfig);
			checks.push(check("ok", "config", `Chat config is valid JSON: ${CHAT_CONFIG_PATH}`));
		} catch (error) {
			checks.push(check("fail", "config", "Chat config is not valid JSON.", String(error)));
		}
	}

	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config);
	if (conversations.length === 0) {
		const accountCount = Object.keys(config.accounts ?? {}).length;
		checks.push(
			accountCount > 0
				? check(
						"ok",
						"config",
						`${accountCount} gateway account(s) configured. Discord channels can be auto-discovered at runtime.`,
					)
				: check(
						"warn",
						"config",
						"No gateway accounts or channels are configured. Run `pie gateway setup` or `/chat-config`.",
					),
		);
	} else {
		checks.push(check("ok", "config", `${conversations.length} gateway channel(s) configured.`));
	}

	if (status.running) {
		checks.push(check("ok", "process", `Gateway process is running. pid=${status.pid}`));
	} else {
		checks.push(check("warn", "process", "Gateway process is not running."));
	}
	if (status.health) {
		checks.push(check("ok", "health", `Gateway status file was updated at ${status.health.updatedAt}.`));
		for (const adapter of status.health.adapters) {
			checks.push(
				check(
					adapter.connected ? "ok" : "warn",
					`health:${adapter.accountId}`,
					`${adapter.service} adapter is ${adapter.connected ? "connected" : "disconnected"} with ${adapter.errorCount} error(s).`,
					adapter.lastError,
				),
			);
		}
	} else {
		checks.push(check("warn", "health", `Gateway status file is missing or unreadable: ${status.statusPath}`));
	}

	const scheduler = SettingsManager.create(cwd, agentDir).getSchedulerSettings();
	checks.push(
		check(
			scheduler.enabled ? "ok" : "warn",
			"scheduler",
			scheduler.enabled
				? `Scheduler is enabled. tick=${scheduler.tickIntervalSeconds}s timeout=${scheduler.timeoutSeconds}s`
				: "Scheduler is disabled in settings.",
		),
	);

	for (const [accountId, account] of Object.entries(config.accounts ?? {})) {
		if (isTelegramAccount(account)) checks.push(...(await checkTelegramAccount(accountId, account)));
		else if (isDiscordAccount(account)) {
			checks.push(...(await checkDiscordAccount(accountId, account)));
			checks.push(...(await checkDiscordVoiceRuntime()));
		} else
			checks.push(
				check("warn", `platform:${accountId}`, `Unsupported gateway platform in config: ${account.service}`),
			);
	}

	checks.push(...(await checkStt()));
	checks.push(...(await checkTts()));
	return {
		ok: checks.every((item) => item.level !== "fail"),
		checks,
		status,
	};
}
