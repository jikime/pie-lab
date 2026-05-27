import { spawnSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
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
import { runGatewayDoctor, type GatewayDoctorCheck } from "./core/gateway/doctor.ts";
import { getGatewayDir, readGatewayPid, readGatewayStatus, runGateway } from "./core/gateway/runner.ts";
import {
	CHAT_CONFIG_PATH,
	listConfiguredConversations,
	loadChatConfig,
	saveChatConfig,
} from "./core/gateway/chat/config.js";
import type {
	ChatConfig,
	ConfiguredChannel,
	DiscordAccountConfig,
	TelegramAccountConfig,
} from "./core/gateway/chat/core/config-types.js";

const SERVICE_LABEL = "ai.pielab.gateway";

function usage(): string {
	return [
		"Usage: pie gateway [run|setup|status|doctor|audio|stop|install|uninstall|restart]",
		"",
		"Commands:",
		"  run        Run the gateway in the foreground",
		"  setup      Configure Telegram/Discord accounts and optional audio credentials",
		"  status     Show gateway process and configured channels",
		"  doctor     Check gateway config, process, platform credentials, and STT readiness",
		"  audio      Configure OpenAI audio credentials for gateway STT/TTS",
		"  stop       Stop a foreground/background gateway by pid",
		"  install    Install and start an OS user service",
		"  uninstall  Stop and remove the OS user service",
		"  restart    Restart the OS user service when installed",
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
	const previous = config.accounts[accountId]?.service === "discord" ? (config.accounts[accountId] as DiscordAccountConfig) : undefined;
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
	console.log(chalk.gray("Discord channels will be auto-discovered when users mention the bot, DM it, or run /pie commands."));
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
	console.log(chalk.gray("This key is used for STT/TTS before the general OPENAI_API_KEY or OpenAI provider connection."));
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
		console.log(chalk.green(`OpenAI audio credential configured via ${describeGatewayOpenAiAudioCredentials(credentials)}.`));
	} else {
		console.log(chalk.yellow("No OpenAI audio credential is configured."));
		console.log(`Run ${chalk.cyan("pie gateway audio set")} or configure an OpenAI provider connection with ${chalk.cyan("/login")}.`);
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
	console.log(`${status.running ? chalk.green("running") : chalk.yellow("stopped")} ${status.pid ? `pid=${status.pid}` : ""}`);
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
		console.log(`No static channels. Discord channels can be auto-discovered at runtime. Config: ${CHAT_CONFIG_PATH}`);
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
		console.log(`Run ${chalk.cyan("pie gateway install")} first, or use ${chalk.cyan("pie gateway run")} for foreground testing.`);
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
		console.log(`Run ${chalk.cyan("pie gateway install")} first, or use ${chalk.cyan("pie gateway run")} for foreground testing.`);
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
