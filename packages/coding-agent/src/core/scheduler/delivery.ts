import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type CronDeliverTarget = string;

interface ConfiguredChannel {
	id: string;
	name?: string;
	dm?: boolean;
}

interface BaseAccountConfig {
	service: "telegram" | "discord";
	name?: string;
	channels?: Record<string, ConfiguredChannel>;
}

interface TelegramAccountConfig extends BaseAccountConfig {
	service: "telegram";
	botToken: string;
}

interface DiscordAccountConfig extends BaseAccountConfig {
	service: "discord";
	botToken: string;
}

type ChatAccountConfig = TelegramAccountConfig | DiscordAccountConfig;

interface ChatConfig {
	accounts?: Record<string, ChatAccountConfig>;
}

export interface CronDeliveryResult {
	delivered: number;
	errors: string[];
	targets: string[];
}

interface DeliveryDestination {
	service: "telegram" | "discord";
	accountId: string;
	channelKey: string;
	channelId: string;
	label: string;
}

function chatConfigPath(agentDir: string): string {
	return join(agentDir, "chat", "config.json");
}

async function loadChatConfig(agentDir: string): Promise<ChatConfig> {
	try {
		return JSON.parse(await readFile(chatConfigPath(agentDir), "utf-8")) as ChatConfig;
	} catch {
		const fallbackPath = join(homedir(), ".pie", "agent", "chat", "config.json");
		if (fallbackPath === chatConfigPath(agentDir)) return { accounts: {} };
		try {
			return JSON.parse(await readFile(fallbackPath, "utf-8")) as ChatConfig;
		} catch {
			return { accounts: {} };
		}
	}
}

function listDestinations(config: ChatConfig): DeliveryDestination[] {
	const destinations: DeliveryDestination[] = [];
	for (const [accountId, account] of Object.entries(config.accounts ?? {}) as Array<[string, ChatAccountConfig]>) {
		for (const [channelKey, channel] of Object.entries(account.channels ?? {})) {
			destinations.push({
				service: account.service,
				accountId,
				channelKey,
				channelId: channel.id,
				label: `${accountId}/${channelKey}`,
			});
		}
	}
	return destinations;
}

function parseDeliverParts(deliver: string | undefined): string[] {
	const value = deliver?.trim() || "local";
	if (value === "local") return ["local"];
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

function resolveDestinations(
	config: ChatConfig,
	deliver: string | undefined,
	origin?: string,
): { destinations: DeliveryDestination[]; errors: string[] } {
	const all = listDestinations(config);
	const destinations = new Map<string, DeliveryDestination>();
	const errors: string[] = [];
	const add = (destination: DeliveryDestination | undefined, ref: string) => {
		if (!destination) {
			errors.push(`no delivery target resolved for ${ref}`);
			return;
		}
		destinations.set(destination.label, destination);
	};

	for (const part of parseDeliverParts(deliver)) {
		if (part === "local") continue;
		if (part === "origin") {
			add(origin ? all.find((candidate) => candidate.label === origin) : undefined, "origin");
			continue;
		}
		if (part === "all") {
			for (const destination of all) add(destination, "all");
			continue;
		}
		if (part.startsWith("chat:")) {
			const conversationId = part.slice("chat:".length).replace(/^\/+/, "").replace(/\/+$/, "");
			add(
				all.find((candidate) => candidate.label === conversationId),
				part,
			);
			continue;
		}
		if (part.startsWith("telegram:") || part.startsWith("discord:")) {
			const separator = part.indexOf(":");
			const service = part.slice(0, separator) as "telegram" | "discord";
			const rawChannelId = part.slice(separator + 1);
			add(
				all.find((candidate) => candidate.service === service && candidate.channelId === rawChannelId),
				part,
			);
			continue;
		}
		add(
			all.find((candidate) => candidate.label === part),
			part,
		);
	}

	return { destinations: [...destinations.values()], errors };
}

function chunkText(text: string, limit: number): string[] {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) return [];
	const chunks: string[] = [];
	let remaining = normalized;
	while (remaining.length > limit) {
		let index = remaining.lastIndexOf("\n", limit);
		if (index < Math.floor(limit / 2)) index = remaining.lastIndexOf(" ", limit);
		if (index < Math.floor(limit / 2)) index = limit;
		chunks.push(remaining.slice(0, index).trim());
		remaining = remaining.slice(index).trim();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

async function sendTelegram(account: TelegramAccountConfig, channelId: string, content: string): Promise<void> {
	for (const chunk of chunkText(content, 4096)) {
		const response = await fetch(`https://api.telegram.org/bot${account.botToken}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				chat_id: Number.isFinite(Number(channelId)) ? Number(channelId) : channelId,
				text: chunk,
				disable_web_page_preview: true,
			}),
		});
		const data = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
		if (!response.ok || data.ok === false) {
			throw new Error(data.description || `Telegram send failed with HTTP ${response.status}`);
		}
	}
}

async function sendDiscord(account: DiscordAccountConfig, channelId: string, content: string): Promise<void> {
	for (const chunk of chunkText(content, 2000)) {
		const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
			method: "POST",
			headers: { authorization: `Bot ${account.botToken}`, "content-type": "application/json" },
			body: JSON.stringify({ content: chunk }),
		});
		const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
		if (!response.ok || !data.id) {
			throw new Error(data.message || `Discord send failed with HTTP ${response.status}`);
		}
	}
}

export async function deliverCronResult(options: {
	agentDir: string;
	deliver?: string;
	origin?: string;
	content: string;
}): Promise<CronDeliveryResult> {
	const parts = parseDeliverParts(options.deliver);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "local")) {
		return { delivered: 0, errors: [], targets: [] };
	}

	const config = await loadChatConfig(options.agentDir);
	const { destinations, errors } = resolveDestinations(config, options.deliver, options.origin);
	let delivered = 0;
	for (const destination of destinations) {
		try {
			const account = config.accounts?.[destination.accountId];
			if (!account) throw new Error(`account not found: ${destination.accountId}`);
			if (destination.service === "telegram") {
				await sendTelegram(account as TelegramAccountConfig, destination.channelId, options.content);
			} else {
				await sendDiscord(account as DiscordAccountConfig, destination.channelId, options.content);
			}
			delivered++;
		} catch (error) {
			errors.push(`${destination.label}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { delivered, errors, targets: destinations.map((destination) => destination.label) };
}
