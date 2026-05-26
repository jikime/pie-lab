import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { getAgentDir } from "./config.ts";
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
		"Usage: pie gateway [run|setup|status|stop|install|uninstall|restart]",
		"",
		"Commands:",
		"  run        Run the gateway in the foreground",
		"  setup      Configure Telegram or Discord accounts/channels",
		"  status     Show gateway process and configured channels",
		"  stop       Stop a foreground/background gateway by pid",
		"  install    Install and start an OS user service",
		"  uninstall  Stop and remove the OS user service",
		"  restart    Restart the OS user service when installed",
	].join("\n");
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
	return prompt(question);
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
	const name = await prompt("Discord account name", "discord");
	const accountId = sanitizeId(await prompt("Discord account id", sanitizeId(name)));
	const token = await promptSecret("Discord bot token");
	const me = await fetchDiscordMe(token);
	const applicationId = await prompt("Discord application id", me.id);
	const serverId = await prompt("Discord server id");
	const serverName = await prompt("Discord server name", serverId);
	const channelName = await prompt("Discord channel name", "general");
	const channelKey = sanitizeId(await prompt("Channel key", sanitizeId(channelName)));
	const channelId = await prompt("Discord channel id");
	const allowedUserIds = splitCsv(await prompt("Allowed Discord user ids, comma-separated", ""));
	const allowedRoleIds = splitCsv(await prompt("Allowed Discord role ids, comma-separated", ""));
	const previous = config.accounts[accountId];
	const account: DiscordAccountConfig = {
		service: "discord",
		name,
		botToken: token,
		applicationId,
		serverId,
		serverName,
		botUserId: me.id,
		botUsername: me.username,
		access: {
			ignoreBots: true,
			...(allowedUserIds?.length ? { allowedUserIds } : {}),
			...(allowedRoleIds?.length ? { allowedRoleIds } : {}),
		},
		channels: {
			...(previous?.channels ?? {}),
			[channelKey]: channelWithAccess(
				{
					id: channelId,
					name: channelName,
					dm: false,
				},
				allowedUserIds,
				"mention",
			),
		},
	};
	config.accounts[accountId] = account;
	await saveChatConfig(config);
	console.log(chalk.green(`Saved Discord channel ${accountId}/${channelKey} to ${CHAT_CONFIG_PATH}`));
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
	const conversations = listConfiguredConversations(await loadChatConfig());
	console.log(chalk.green(`Configured ${conversations.length} channel(s).`));
}

async function printStatus(): Promise<void> {
	const status = await readGatewayStatus();
	console.log(`${status.running ? chalk.green("running") : chalk.yellow("stopped")} ${status.pid ? `pid=${status.pid}` : ""}`);
	console.log(`pid file: ${status.pidPath}`);
	if (status.conversations.length === 0) {
		console.log(`No configured channels. Config: ${CHAT_CONFIG_PATH}`);
		return;
	}
	for (const conversation of status.conversations) {
		console.log(`- ${conversation.id} (${conversation.service}) ${conversation.name}`);
	}
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
	const plistPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
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
	const plistPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
	const domain = `gui/${process.getuid?.() ?? ""}`;
	spawnSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" });
	await rm(plistPath, { force: true });
	console.log(chalk.green(`Removed ${SERVICE_LABEL}`));
}

async function restartMacService(): Promise<void> {
	const domain = `gui/${process.getuid?.() ?? ""}`;
	runServiceCommand("launchctl", ["kickstart", "-k", `${domain}/${SERVICE_LABEL}`]);
	console.log(chalk.green(`Restarted ${SERVICE_LABEL}`));
}

async function installLinuxService(): Promise<void> {
	const agentDir = getAgentDir();
	const gatewayDir = getGatewayDir(agentDir);
	await mkdir(gatewayDir, { recursive: true });
	const unitPath = join(homedir(), ".config", "systemd", "user", "pie-gateway.service");
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
	await rm(join(homedir(), ".config", "systemd", "user", "pie-gateway.service"), { force: true });
	spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
	console.log(chalk.green("Removed pie-gateway.service"));
}

async function restartLinuxService(): Promise<void> {
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
