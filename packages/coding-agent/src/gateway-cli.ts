import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { access, mkdir, readdir, rm, watch, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import chalk from "chalk";
import { getAgentDir } from "./config.ts";
import { AuthStorage } from "./core/auth-storage.ts";
import {
	describeGatewayOpenAiAudioCredentials,
	OPENAI_AUDIO_AUTH_PROVIDER,
	resolveGatewayOpenAiAudioCredentials,
} from "./core/gateway/audio-credentials.ts";
import {
	CHAT_CONFIG_PATH,
	listConfiguredConversations,
	loadChatConfig,
	resolveConversation,
	saveChatConfig,
} from "./core/gateway/chat/config.ts";
import type {
	ChatConfig,
	ConfiguredChannel,
	DiscordAccountConfig,
	TelegramAccountConfig,
} from "./core/gateway/chat/core/config-types.ts";
import type { ChatLogRecord } from "./core/gateway/chat/core/runtime-types.ts";
import { type GatewayDoctorCheck, runGatewayDoctor } from "./core/gateway/doctor.ts";
import { getGatewayDir, readGatewayPid, readGatewayStatus, runGateway } from "./core/gateway/runner.ts";

const SERVICE_LABEL = "ai.pielab.gateway";

function usage(): string {
	return [
		"Usage: pie gateway [run|setup|status|doctor|audio|stop|install|uninstall|restart|history|attach]",
		"",
		"Commands:",
		"  run              Run the gateway in the foreground",
		"  setup            Configure Telegram/Discord accounts and optional audio credentials",
		"  status           Show gateway process and configured channels",
		"  doctor           Check gateway config, process, platform credentials, and STT readiness",
		"  audio            Configure OpenAI audio credentials for gateway STT/TTS",
		"  stop             Stop a foreground/background gateway by pid",
		"  install          Install and start an OS user service",
		"  uninstall        Stop and remove the OS user service",
		"  restart          Restart the OS user service when installed",
		"  history [채널]   Show recent conversation history for a channel",
		"  attach  [채널]   Stream live conversation events from a running gateway",
	].join("\n");
}

function audioUsage(): string {
	return [
		"Usage: pie gateway audio [status|set|remove]",
		"",
		"Commands:",
		"  status     Show where gateway OpenAI audio credentials are resolved from",
		"  set        Save an OpenAI API key for gateway STT/TTS",
		"  remove     Remove the saved gateway-only OpenAI audio key",
	].join("\n");
}

function doctorIcon(level: GatewayDoctorCheck["level"]): string {
	if (level === "ok") return chalk.green("OK");
	if (level === "warn") return chalk.yellow("WARN");
	return chalk.red("FAIL");
}

function sanitizeId(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "default"
	);
}

function splitCsv(value: string): string[] | undefined {
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

function resolveDiscordAccountId(
	config: ChatConfig,
	me: { id: string; username?: string; global_name?: string },
): string {
	for (const [accountId, account] of Object.entries(config.accounts ?? {})) {
		if (account.service === "discord" && "botUserId" in account && account.botUserId === me.id) return accountId;
	}
	if (!config.accounts.discord) return "discord";
	const base = sanitizeId(`discord-${me.username || me.global_name || me.id}`);
	if (!config.accounts[base]) return base;
	for (let index = 2; ; index++) {
		const candidate = `${base}-${index}`;
		if (!config.accounts[candidate]) return candidate;
	}
}

async function prompt(question: string, fallback?: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const suffix = fallback ? ` (${fallback})` : "";
		const answer = (await rl.question(`${question}${suffix}: `)).trim();
		return answer || fallback || "";
	} finally {
		rl.close();
	}
}

async function promptSecret(question: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return prompt(question);
	let muted = false;
	const output = new Writable({
		write(chunk, _encoding, callback) {
			if (!muted) process.stdout.write(chunk);
			callback();
		},
	});
	const rl = createInterface({ input: process.stdin, output, terminal: true });
	try {
		const answerPromise = rl.question(`${question}: `);
		muted = true;
		const answer = (await answerPromise).trim();
		process.stdout.write("\n");
		return answer;
	} finally {
		muted = false;
		rl.close();
	}
}

async function promptYesNo(question: string, fallback = false): Promise<boolean> {
	const answer = (await prompt(`${question} ${fallback ? "[Y/n]" : "[y/N]"}`)).toLowerCase();
	if (!answer) return fallback;
	return answer === "y" || answer === "yes";
}

async function fetchTelegramMe(token: string): Promise<{ id: string; username?: string; first_name?: string }> {
	const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { method: "POST" });
	const data = (await response.json()) as {
		ok?: boolean;
		result?: { id: number; username?: string; first_name?: string };
		description?: string;
	};
	if (!response.ok || !data.ok || !data.result) {
		throw new Error(data.description || `Telegram getMe failed with HTTP ${response.status}`);
	}
	return { id: String(data.result.id), username: data.result.username, first_name: data.result.first_name };
}

async function fetchDiscordMe(token: string): Promise<{ id: string; username?: string; global_name?: string }> {
	const response = await fetch("https://discord.com/api/v10/users/@me", {
		headers: { Authorization: `Bot ${token}` },
	});
	const data = (await response.json()) as { id?: string; username?: string; global_name?: string; message?: string };
	if (!response.ok || !data.id) {
		throw new Error(data.message || `Discord /users/@me failed with HTTP ${response.status}`);
	}
	return { id: data.id, username: data.username, global_name: data.global_name };
}

function channelWithAccess(channel: ConfiguredChannel, allowedUserIds?: string[], trigger?: "mention" | "message") {
	return {
		...channel,
		access: {
			...(channel.access ?? {}),
			...(trigger ? { trigger } : {}),
			...(allowedUserIds?.length ? { allowedUserIds } : {}),
			ignoreBots: channel.access?.ignoreBots ?? true,
		},
	};
}

async function setupTelegram(config: ChatConfig): Promise<void> {
	const name = await prompt("Telegram account name", "telegram");
	const accountId = sanitizeId(await prompt("Telegram account id", sanitizeId(name)));
	const token = await promptSecret("Telegram bot token");
	const me = await fetchTelegramMe(token);
	const channelName = await prompt("Channel or DM name", "dm");
	const channelKey = sanitizeId(await prompt("Channel key", sanitizeId(channelName)));
	const channelId = await prompt("Telegram chat id");
	const isDm = await promptYesNo("Is this a direct message chat?", true);
	const allowedUserIds = splitCsv(await prompt("Allowed Telegram user ids, comma-separated", ""));
	const account: TelegramAccountConfig = {
		service: "telegram",
		name,
		botToken: token,
		botUsername: me.username,
		botUserId: me.id,
		access: {
			ignoreBots: true,
			...(allowedUserIds?.length ? { allowedUserIds } : {}),
		},
		channels: {
			...(config.accounts[accountId]?.channels ?? {}),
			[channelKey]: channelWithAccess(
				{
					id: channelId,
					name: channelName,
					dm: isDm,
				},
				allowedUserIds,
				isDm ? "message" : "mention",
			),
		},
	};
	config.accounts[accountId] = account;
	await saveChatConfig(config);
	console.log(chalk.green(`Saved Telegram channel ${accountId}/${channelKey} to ${CHAT_CONFIG_PATH}`));
}

async function setupDiscord(config: ChatConfig): Promise<void> {
	const token = await promptSecret("Discord bot token");
	const me = await fetchDiscordMe(token);
	const accountId = resolveDiscordAccountId(config, me);
	const previous =
		config.accounts[accountId]?.service === "discord"
			? (config.accounts[accountId] as DiscordAccountConfig)
			: undefined;
	const name = previous?.name || me.global_name || me.username || "discord";
	const account: DiscordAccountConfig = {
		service: "discord",
		name,
		botToken: token,
		applicationId: previous?.applicationId || me.id,
		serverId: previous?.serverId,
		serverName: previous?.serverName,
		botUserId: me.id,
		botUsername: me.username,
		...(previous?.homeChannelId ? { homeChannelId: previous.homeChannelId } : {}),
		...(previous?.homeChannelName ? { homeChannelName: previous.homeChannelName } : {}),
		...(previous?.allowedChannelIds?.length ? { allowedChannelIds: previous.allowedChannelIds } : {}),
		...(previous?.ignoredChannelIds?.length ? { ignoredChannelIds: previous.ignoredChannelIds } : {}),
		...(previous?.freeResponseChannelIds?.length ? { freeResponseChannelIds: previous.freeResponseChannelIds } : {}),
		access: previous?.access ?? { ignoreBots: true },
		channels: previous?.channels ?? {},
	};
	config.accounts[accountId] = account;
	await saveChatConfig(config);
	console.log(chalk.green(`Saved Discord account ${accountId} to ${CHAT_CONFIG_PATH}`));
	console.log(
		chalk.gray("Discord channels will be auto-discovered when users mention the bot, DM it, or run /pie commands."),
	);
	console.log(chalk.gray("Advanced access/channel limits can be edited later in the chat config if needed."));
}

function audioAuthStorage(): AuthStorage {
	return AuthStorage.create(join(getAgentDir(), "auth.json"));
}

async function saveOpenAiAudioKey(): Promise<void> {
	const apiKey = await promptSecret("OpenAI API key for gateway STT/TTS");
	if (!apiKey) {
		console.log(chalk.yellow("Skipped OpenAI audio key setup."));
		return;
	}
	audioAuthStorage().set(OPENAI_AUDIO_AUTH_PROVIDER, { type: "api_key", key: apiKey });
	console.log(chalk.green(`Saved gateway OpenAI audio key to ${join(getAgentDir(), "auth.json")}`));
	console.log(
		chalk.gray("This key is used for STT/TTS before the general OPENAI_API_KEY or OpenAI provider connection."),
	);
}

async function removeOpenAiAudioKey(): Promise<void> {
	const authStorage = audioAuthStorage();
	if (!authStorage.has(OPENAI_AUDIO_AUTH_PROVIDER)) {
		console.log(chalk.yellow("No gateway-only OpenAI audio key is saved."));
		return;
	}
	authStorage.remove(OPENAI_AUDIO_AUTH_PROVIDER);
	console.log(chalk.green("Removed gateway-only OpenAI audio key."));
}

async function printAudioStatus(): Promise<void> {
	const credentials = await resolveGatewayOpenAiAudioCredentials({ agentDir: getAgentDir() });
	if (credentials) {
		console.log(
			chalk.green(`OpenAI audio credential configured via ${describeGatewayOpenAiAudioCredentials(credentials)}.`),
		);
	} else {
		console.log(chalk.yellow("No OpenAI audio credential is configured."));
		console.log(
			`Run ${chalk.cyan("pie gateway audio set")} or configure an OpenAI provider connection with ${chalk.cyan("/login")}.`,
		);
	}
}

async function handleAudioCommand(args: string[]): Promise<void> {
	const command = args[0] ?? "status";
	if (command === "status") {
		await printAudioStatus();
		return;
	}
	if (command === "set") {
		await saveOpenAiAudioKey();
		return;
	}
	if (command === "remove" || command === "delete" || command === "unset") {
		await removeOpenAiAudioKey();
		return;
	}
	if (command === "help" || command === "--help" || command === "-h") {
		console.log(audioUsage());
		return;
	}
	console.error(chalk.red(`Unknown gateway audio command: ${command}`));
	console.error(audioUsage());
	process.exitCode = 1;
}

async function setupGateway(): Promise<void> {
	const config = await loadChatConfig();
	config.accounts ??= {};
	while (true) {
		const service = (await prompt("Add service: telegram, discord, or done", "done")).toLowerCase();
		if (service === "done" || service === "exit" || service === "quit") break;
		if (service === "telegram") {
			await setupTelegram(config);
			continue;
		}
		if (service === "discord") {
			await setupDiscord(config);
			continue;
		}
		console.log(chalk.yellow("Choose telegram, discord, or done."));
	}
	if (await promptYesNo("Configure OpenAI audio key for gateway STT/TTS now?", false)) {
		await saveOpenAiAudioKey();
	}
	const conversations = listConfiguredConversations(await loadChatConfig());
	console.log(chalk.green(`Configured ${conversations.length} channel(s).`));
}

async function printStatus(): Promise<void> {
	const status = await readGatewayStatus();
	console.log(
		`${status.running ? chalk.green("running") : chalk.yellow("stopped")} ${status.pid ? `pid=${status.pid}` : ""}`,
	);
	console.log(`pid file: ${status.pidPath}`);
	console.log(`status file: ${status.statusPath}`);
	if (status.health) {
		console.log(`updated: ${status.health.updatedAt}`);
		if (status.health.adapters.length > 0) {
			console.log("adapters:");
			for (const adapter of status.health.adapters) {
				const state = adapter.connected ? chalk.green("connected") : chalk.yellow("disconnected");
				const suffix = adapter.lastError ? ` lastError=${adapter.lastError}` : "";
				console.log(
					`- ${adapter.accountId} (${adapter.service}) ${state} errors=${adapter.errorCount}${adapter.lastActivityAt ? ` lastActivity=${adapter.lastActivityAt}` : ""}${suffix}`,
				);
			}
		}
	}
	if (status.conversations.length === 0) {
		console.log(
			`No static channels. Discord channels can be auto-discovered at runtime. Config: ${CHAT_CONFIG_PATH}`,
		);
		return;
	}
	for (const conversation of status.conversations) {
		const health = status.health?.conversations.find((item) => item.id === conversation.id);
		const sessionInfo = health ? ` queue=${health.queueLength} sessions=${health.sessionCount}` : "";
		console.log(`- ${conversation.id} (${conversation.service}) ${conversation.name}${sessionInfo}`);
	}
}

async function printDoctor(): Promise<void> {
	const report = await runGatewayDoctor();
	console.log(chalk.bold("Pie gateway doctor"));
	for (const item of report.checks) {
		console.log(`${doctorIcon(item.level)} ${item.name}: ${item.message}`);
		if (item.detail) console.log(chalk.gray(`     ${item.detail}`));
	}
	const failures = report.checks.filter((item) => item.level === "fail").length;
	const warnings = report.checks.filter((item) => item.level === "warn").length;
	console.log("");
	console.log(
		report.ok
			? chalk.green(`Doctor completed with ${warnings} warning(s).`)
			: chalk.red(`Doctor found ${failures} failure(s) and ${warnings} warning(s).`),
	);
	if (!report.ok) process.exitCode = 1;
}

async function stopGateway(): Promise<void> {
	const pid = await readGatewayPid();
	if (!pid) {
		console.log(chalk.yellow("No gateway pid file found."));
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
		console.log(chalk.green(`Sent SIGTERM to pie gateway pid ${pid}.`));
	} catch (error) {
		console.log(chalk.yellow(`Could not stop pid ${pid}: ${error instanceof Error ? error.message : String(error)}`));
	}
}

function xmlEscape(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cliPath(): string {
	if (!process.argv[1]) throw new Error("Cannot determine current pie CLI path.");
	return resolve(process.argv[1]);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function macServicePlistPath(): string {
	return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

function linuxServiceUnitPath(): string {
	return join(homedir(), ".config", "systemd", "user", "pie-gateway.service");
}

function runServiceCommand(command: string, args: string[]): void {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.error || result.status !== 0) {
		throw new Error(result.stderr.trim() || result.error?.message || `${command} ${args.join(" ")} failed`);
	}
}

async function installMacService(): Promise<void> {
	const agentDir = getAgentDir();
	const gatewayDir = getGatewayDir(agentDir);
	await mkdir(gatewayDir, { recursive: true });
	const plistPath = macServicePlistPath();
	const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${SERVICE_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xmlEscape(process.execPath)}</string>
		<string>${xmlEscape(cliPath())}</string>
		<string>gateway</string>
		<string>run</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${xmlEscape(process.cwd())}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${xmlEscape(join(gatewayDir, "gateway.out.log"))}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(join(gatewayDir, "gateway.err.log"))}</string>
</dict>
</plist>
`;
	await mkdir(dirname(plistPath), { recursive: true });
	await writeFile(plistPath, plist, "utf8");
	const domain = `gui/${process.getuid?.() ?? ""}`;
	spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
	runServiceCommand("launchctl", ["bootstrap", domain, plistPath]);
	runServiceCommand("launchctl", ["enable", `${domain}/${SERVICE_LABEL}`]);
	console.log(chalk.green(`Installed ${SERVICE_LABEL} at ${plistPath}`));
}

async function uninstallMacService(): Promise<void> {
	const plistPath = macServicePlistPath();
	const domain = `gui/${process.getuid?.() ?? ""}`;
	spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
	await rm(plistPath, { force: true });
	console.log(chalk.green(`Removed ${SERVICE_LABEL}`));
}

async function restartMacService(): Promise<void> {
	const plistPath = macServicePlistPath();
	if (!(await pathExists(plistPath))) {
		console.log(chalk.yellow(`Pie gateway service is not installed yet: ${plistPath}`));
		console.log(
			`Run ${chalk.cyan("pie gateway install")} first, or use ${chalk.cyan("pie gateway run")} for foreground testing.`,
		);
		return;
	}
	const domain = `gui/${process.getuid?.() ?? ""}`;
	runServiceCommand("launchctl", ["kickstart", "-k", `${domain}/${SERVICE_LABEL}`]);
	console.log(chalk.green(`Restarted ${SERVICE_LABEL}`));
}

async function installLinuxService(): Promise<void> {
	const agentDir = getAgentDir();
	const gatewayDir = getGatewayDir(agentDir);
	await mkdir(gatewayDir, { recursive: true });
	const unitPath = linuxServiceUnitPath();
	const unit = `[Unit]
Description=Pie Gateway

[Service]
Type=simple
WorkingDirectory=${process.cwd()}
ExecStart=${process.execPath} ${cliPath()} gateway run
Restart=always
RestartSec=5
StandardOutput=append:${join(gatewayDir, "gateway.out.log")}
StandardError=append:${join(gatewayDir, "gateway.err.log")}

[Install]
WantedBy=default.target
`;
	await mkdir(dirname(unitPath), { recursive: true });
	await writeFile(unitPath, unit, "utf8");
	runServiceCommand("systemctl", ["--user", "daemon-reload"]);
	runServiceCommand("systemctl", ["--user", "enable", "--now", "pie-gateway.service"]);
	console.log(chalk.green(`Installed pie-gateway.service at ${unitPath}`));
}

async function uninstallLinuxService(): Promise<void> {
	spawnSync("systemctl", ["--user", "disable", "--now", "pie-gateway.service"], { stdio: "ignore" });
	await rm(linuxServiceUnitPath(), { force: true });
	spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
	console.log(chalk.green("Removed pie-gateway.service"));
}

async function restartLinuxService(): Promise<void> {
	const unitPath = linuxServiceUnitPath();
	if (!(await pathExists(unitPath))) {
		console.log(chalk.yellow(`Pie gateway service is not installed yet: ${unitPath}`));
		console.log(
			`Run ${chalk.cyan("pie gateway install")} first, or use ${chalk.cyan("pie gateway run")} for foreground testing.`,
		);
		return;
	}
	runServiceCommand("systemctl", ["--user", "restart", "pie-gateway.service"]);
	console.log(chalk.green("Restarted pie-gateway.service"));
}

async function installService(): Promise<void> {
	if (process.platform === "darwin") {
		await installMacService();
		return;
	}
	if (process.platform === "linux") {
		await installLinuxService();
		return;
	}
	throw new Error("pie gateway install currently supports macOS launchd and Linux systemd user services.");
}

async function uninstallService(): Promise<void> {
	if (process.platform === "darwin") {
		await uninstallMacService();
		return;
	}
	if (process.platform === "linux") {
		await uninstallLinuxService();
		return;
	}
	throw new Error("pie gateway uninstall currently supports macOS launchd and Linux systemd user services.");
}

async function restartService(): Promise<void> {
	if (process.platform === "darwin") {
		await restartMacService();
		return;
	}
	if (process.platform === "linux") {
		await restartLinuxService();
		return;
	}
	throw new Error("pie gateway restart currently supports macOS launchd and Linux systemd user services.");
}

export async function handleGatewayCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "gateway") return false;
	const command = args[1] ?? "run";
	try {
		if (command === "run" || command === "foreground") {
			await runGateway();
			return true;
		}
		if (command === "setup") {
			await setupGateway();
			return true;
		}
		if (command === "status") {
			await printStatus();
			return true;
		}
		if (command === "doctor") {
			await printDoctor();
			return true;
		}
		if (command === "audio") {
			await handleAudioCommand(args.slice(2));
			return true;
		}
		if (command === "stop") {
			await stopGateway();
			return true;
		}
		if (command === "install") {
			await installService();
			return true;
		}
		if (command === "uninstall") {
			await uninstallService();
			return true;
		}
		if (command === "restart") {
			await restartService();
			return true;
		}
		if (command === "history") {
			await printHistory(args.slice(2));
			return true;
		}
		if (command === "attach") {
			await attachGateway(args.slice(2));
			return true;
		}
		if (command === "help" || command === "--help" || command === "-h") {
			console.log(usage());
			return true;
		}
		console.error(chalk.red(`Unknown gateway command: ${command}`));
		console.error(usage());
		process.exitCode = 1;
		return true;
	} catch (error) {
		console.error(chalk.red(error instanceof Error ? error.message : String(error)));
		process.exitCode = 1;
		return true;
	}
}

// ─── Web chat conversation discovery ────────────────────────────────────────

interface WebConversationInfo {
	conversationId: string;
	conversationName: string;
	channelKey: string;
	service: "web";
	logPath: string;
}

async function listWebConversations(agentDir = getAgentDir()): Promise<WebConversationInfo[]> {
	const webChannelsDir = join(agentDir, "chat", "accounts", "web", "channels");
	if (!existsSync(webChannelsDir)) return [];
	let entries: string[];
	try {
		entries = await readdir(webChannelsDir);
	} catch {
		return [];
	}
	const results: WebConversationInfo[] = [];
	for (const entry of entries) {
		const logPath = join(webChannelsDir, entry, "channel.jsonl");
		if (!existsSync(logPath)) continue;
		results.push({
			conversationId: entry,
			conversationName: `Web / ${entry}`,
			channelKey: entry,
			service: "web",
			logPath,
		});
	}
	return results.sort((a, b) => {
		try {
			return statSync(b.logPath).mtimeMs - statSync(a.logPath).mtimeMs;
		} catch {
			return 0;
		}
	});
}

// ─── pie gateway history ────────────────────────────────────────────────────

function fmtRecordTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleString("ko-KR", { hour12: false, timeZone: "Asia/Seoul" }).slice(0, 16);
}

function renderRecord(record: ChatLogRecord): string | undefined {
	switch (record.type) {
		case "inbound": {
			const who = record.userName ? chalk.cyan(record.userName) : chalk.cyan(`uid:${record.userId}`);
			const text = record.text.slice(0, 300);
			const attachInfo = record.attachments?.length ? chalk.dim(` [+${record.attachments.length}첨부]`) : "";
			return `${chalk.dim(fmtRecordTime(record.timestamp))}  ${who}: ${text}${attachInfo}`;
		}
		case "outbound": {
			const text = record.text.slice(0, 300);
			return `${chalk.dim(fmtRecordTime(record.timestamp))}  ${chalk.green("AI")}: ${text}`;
		}
		case "job_queued":
			return chalk.dim(`${fmtRecordTime(record.timestamp)}  [작업 시작]`);
		case "job_completed":
			return chalk.dim(`${fmtRecordTime(record.timestamp)}  [작업 완료]`);
		case "job_failed":
			return chalk.red(`${fmtRecordTime(record.timestamp)}  [오류] ${record.error.slice(0, 120)}`);
		case "error":
			return chalk.red(`${fmtRecordTime(record.timestamp)}  [오류] ${record.message.slice(0, 120)}`);
		default:
			return undefined;
	}
}

async function printHistory(args: string[]): Promise<void> {
	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config);
	const webConvs = await listWebConversations();

	// Parse args: [channelSpec] [--limit N] [--all]
	const limitIdx = args.findIndex((a) => a === "--limit" || a === "-n");
	const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? "50", 10) || 50 : 50;
	const showAll = args.includes("--all");
	const channelSpec = args.find((a) => !a.startsWith("-") && Number.isNaN(Number(a)));

	const serviceBadge = (service: string) =>
		service === "discord"
			? chalk.blue(`[discord]`)
			: service === "web"
				? chalk.magenta(`[web]`)
				: chalk.cyan(`[telegram]`);

	// No channel specified → list available channels
	if (!channelSpec) {
		const hasAny = conversations.length > 0 || webConvs.length > 0;
		if (!hasAny) {
			console.log(chalk.dim("설정된 채널이 없습니다. pie gateway setup을 실행하세요."));
			return;
		}
		console.log(chalk.bold("\n사용 가능한 채널:\n"));
		for (const conv of conversations) {
			console.log(
				`  ${serviceBadge(conv.service)} ${chalk.white(conv.conversationName)}  ${chalk.dim(conv.channelKey)}`,
			);
		}
		for (const wc of webConvs) {
			console.log(`  ${serviceBadge("web")} ${chalk.white(wc.conversationName)}  ${chalk.dim(wc.channelKey)}`);
		}
		const example = conversations[0]?.channelKey ?? webConvs[0]?.channelKey ?? "telegram-pio/dm-john";
		console.log(chalk.dim(`\nUsage: pie gateway history <channelKey> [--limit N]`));
		console.log(chalk.dim(`Example: pie gateway history ${example}`));
		return;
	}

	// Resolve conversation — check Telegram/Discord first, then web
	const conv =
		resolveConversation(config, channelSpec) ??
		conversations.find((c) => c.conversationName.toLowerCase().includes(channelSpec.toLowerCase())) ??
		conversations.find((c) => c.channelKey.includes(channelSpec));

	// Helper: print records from a resolved logPath
	const printRecords = async (name: string, service: string, logPath: string) => {
		let rawRecords: ChatLogRecord[];
		try {
			const { readFile } = await import("node:fs/promises");
			const text = await readFile(logPath, "utf8");
			rawRecords = text
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as ChatLogRecord);
		} catch {
			rawRecords = [];
		}
		if (rawRecords.length === 0) {
			console.log(chalk.dim(`${name}: 대화 내역이 없습니다.`));
			return;
		}
		const displayable = showAll
			? rawRecords
			: rawRecords.filter(
					(r) => r.type === "inbound" || r.type === "outbound" || r.type === "job_failed" || r.type === "error",
				);
		const slice = displayable.slice(-limit);
		console.log(
			chalk.bold(`\n${serviceBadge(service)} ${name}`) +
				chalk.dim(`  (최근 ${slice.length}/${displayable.length}개)`),
		);
		console.log(chalk.dim("─".repeat(70)));
		for (const record of slice) {
			const line = renderRecord(record);
			if (line) console.log(line);
		}
		if (displayable.length > limit) {
			console.log(
				chalk.dim(`\n(${displayable.length - limit}개 더 있음. --limit ${displayable.length} 로 전체 조회)`),
			);
		}
	};

	if (conv) {
		await printRecords(conv.conversationName, conv.service, conv.logPath);
		return;
	}

	// Try web chat channels
	const webMatch = webConvs.find(
		(wc) =>
			wc.channelKey === channelSpec ||
			wc.conversationName.toLowerCase().includes(channelSpec.toLowerCase()) ||
			wc.channelKey.includes(channelSpec),
	);
	if (webMatch) {
		await printRecords(webMatch.conversationName, "web", webMatch.logPath);
		return;
	}

	console.error(chalk.red(`채널을 찾을 수 없습니다: ${channelSpec}`));
	console.error(chalk.dim("pie gateway history 를 인수 없이 실행하면 채널 목록을 볼 수 있습니다."));
	process.exitCode = 1;
}

// ─── pie gateway attach ─────────────────────────────────────────────────────

async function attachGateway(args: string[]): Promise<void> {
	const config = await loadChatConfig();
	const conversations = listConfiguredConversations(config);
	const webConvs = await listWebConversations();
	const channelSpec = args.find((a) => !a.startsWith("-"));

	const serviceBadge = (service: string) =>
		service === "discord"
			? chalk.blue(`[discord]`)
			: service === "web"
				? chalk.magenta(`[web]`)
				: chalk.cyan(`[telegram]`);

	// Unified target list: { service, conversationName, logPath }
	type AttachTarget = { service: string; conversationName: string; logPath: string };

	let targets: AttachTarget[];

	if (channelSpec) {
		// Match in Telegram/Discord first
		const conv =
			resolveConversation(config, channelSpec) ??
			conversations.find((c) => c.conversationName.toLowerCase().includes(channelSpec.toLowerCase())) ??
			conversations.find((c) => c.channelKey.includes(channelSpec));
		if (conv) {
			targets = [{ service: conv.service, conversationName: conv.conversationName, logPath: conv.logPath }];
		} else {
			// Try web channels
			const wc = webConvs.find(
				(w) =>
					w.channelKey === channelSpec ||
					w.conversationName.toLowerCase().includes(channelSpec.toLowerCase()) ||
					w.channelKey.includes(channelSpec),
			);
			if (!wc) {
				console.error(chalk.red(`채널을 찾을 수 없습니다: ${channelSpec}`));
				process.exitCode = 1;
				return;
			}
			targets = [{ service: "web", conversationName: wc.conversationName, logPath: wc.logPath }];
		}
	} else {
		// No filter — watch everything: Telegram/Discord + web
		const configTargets: AttachTarget[] = conversations.map((c) => ({
			service: c.service,
			conversationName: c.conversationName,
			logPath: c.logPath,
		}));
		const webTargets: AttachTarget[] = webConvs.map((wc) => ({
			service: "web",
			conversationName: wc.conversationName,
			logPath: wc.logPath,
		}));
		targets = [...configTargets, ...webTargets];
	}

	if (targets.length === 0) {
		console.log(chalk.dim("설정된 채널이 없습니다. pie gateway setup을 실행하거나 웹 채팅을 사용해보세요."));
		return;
	}

	// Check gateway status
	const status = await readGatewayStatus();

	console.log(chalk.bold("\n🔗 Gateway Attach"));
	if (status.running) {
		console.log(chalk.green(`● gateway 실행 중 (pid ${status.pid})`));
	} else {
		console.log(chalk.yellow("○ gateway가 실행되고 있지 않습니다. 로그 파일만 tailing합니다."));
	}
	console.log(chalk.dim(`모니터링 채널 (${targets.length}개): ${targets.map((t) => t.conversationName).join(", ")}`));
	console.log(chalk.dim("중지하려면 Ctrl+C\n"));
	console.log(chalk.dim("─".repeat(70)));

	// Track file sizes for tail-mode reading
	const fileSizes = new Map<string, number>();
	for (const t of targets) {
		try {
			fileSizes.set(t.logPath, statSync(t.logPath).size);
		} catch {
			fileSizes.set(t.logPath, 0);
		}
	}

	const abortController = new AbortController();

	const processNewLines = async (t: AttachTarget, lastSize: number): Promise<number> => {
		const { readFile } = await import("node:fs/promises");
		let content: string;
		try {
			content = await readFile(t.logPath, "utf8");
		} catch {
			return lastSize;
		}
		const currentSize = Buffer.byteLength(content, "utf8");
		if (currentSize <= lastSize) return lastSize;

		const newContent = content.slice(lastSize);
		const lines = newContent
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		for (const line of lines) {
			try {
				const record = JSON.parse(line) as ChatLogRecord;
				const rendered = renderRecord(record);
				if (rendered) {
					console.log(`${serviceBadge(t.service)} ${chalk.dim(t.conversationName)}  ${rendered}`);
				}
			} catch {
				// malformed JSON line — skip
			}
		}
		return currentSize;
	};

	// Watch existing log files
	for (const t of targets) {
		if (!existsSync(t.logPath)) continue;
		try {
			const watcher = watch(t.logPath, { signal: abortController.signal });
			(async () => {
				try {
					for await (const _event of watcher) {
						const prevSize = fileSizes.get(t.logPath) ?? 0;
						const newSize = await processNewLines(t, prevSize);
						fileSizes.set(t.logPath, newSize);
					}
				} catch (e) {
					if (e instanceof Error && e.name === "AbortError") return;
				}
			})();
		} catch {
			// ignore watch setup errors
		}
	}

	// Also watch the web channels directory for newly created conversations
	const webChannelsDir = join(getAgentDir(), "chat", "accounts", "web", "channels");
	const watchedLogPaths = new Set(targets.map((t) => t.logPath));
	if (existsSync(webChannelsDir) && !channelSpec) {
		try {
			const dirWatcher = watch(webChannelsDir, { recursive: true, signal: abortController.signal });
			(async () => {
				try {
					for await (const event of dirWatcher) {
						if (typeof event.filename !== "string") continue;
						if (!event.filename.endsWith("channel.jsonl")) continue;
						const logPath = join(webChannelsDir, event.filename);
						if (watchedLogPaths.has(logPath)) continue;
						watchedLogPaths.add(logPath);
						const parts = event.filename.split("/");
						const convId = parts[0] ?? event.filename;
						const newTarget: AttachTarget = {
							service: "web",
							conversationName: `Web / ${convId}`,
							logPath,
						};
						targets.push(newTarget);
						fileSizes.set(logPath, 0);
						console.log(chalk.dim(`[web] 새 대화 감지: ${convId}`));
						// Start watching the new file
						try {
							const newWatcher = watch(logPath, { signal: abortController.signal });
							(async () => {
								try {
									for await (const _e of newWatcher) {
										const prevSize = fileSizes.get(logPath) ?? 0;
										const newSize = await processNewLines(newTarget, prevSize);
										fileSizes.set(logPath, newSize);
									}
								} catch (e2) {
									if (e2 instanceof Error && e2.name === "AbortError") return;
								}
							})();
						} catch {
							// ignore
						}
					}
				} catch (e) {
					if (e instanceof Error && e.name === "AbortError") return;
				}
			})();
		} catch {
			// ignore directory watch errors
		}
	}

	// Graceful Ctrl+C
	await new Promise<void>((resolve) => {
		const onSignal = () => {
			abortController.abort();
			console.log(chalk.dim("\nattach 종료"));
			resolve();
		};
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
		abortController.signal.addEventListener("abort", () => resolve(), { once: true });
	});
}
