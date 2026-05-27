import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatAccountConfig, ChatConfig, DiscordAccountConfig } from "./chat/core/config-types.js";
import { registerBuiltInGatewayPlatforms } from "./adapters.js";
import { defaultGatewayPlatformRegistry, type GatewayPlatformRegistry } from "./platform-registry.js";

export interface GatewayDeliveryResult {
	delivered: number;
	errors: string[];
	targets: string[];
}

interface DeliveryDestination {
	service: ChatAccountConfig["service"];
	accountId: string;
	channelKey: string;
	channelId: string;
	label: string;
}

function chatConfigPath(agentDir: string): string {
	return join(agentDir, "chat", "config.json");
}

async function loadGatewayDeliveryConfig(agentDir: string): Promise<ChatConfig> {
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
		if (account.service === "discord") {
			const discord = account as DiscordAccountConfig;
			if (discord.homeChannelId) {
				destinations.push({
					service: account.service,
					accountId,
					channelKey: "home",
					channelId: discord.homeChannelId,
					label: `${accountId}/home`,
				});
			}
		}
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

export function parseGatewayDeliverTargets(deliver: string | undefined): string[] {
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
	registry: GatewayPlatformRegistry = defaultGatewayPlatformRegistry,
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

	for (const part of parseGatewayDeliverTargets(deliver)) {
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
		const separator = part.indexOf(":");
		if (separator > 0) {
			const service = part.slice(0, separator);
			const rawChannelId = part.slice(separator + 1);
			const platform = registry.has(service as ChatAccountConfig["service"]);
			if (platform) {
				add(
					all.find((candidate) => candidate.service === service && candidate.channelId === rawChannelId),
					part,
				);
				continue;
			}
		}
		add(
			all.find((candidate) => candidate.label === part),
			part,
		);
	}

	return { destinations: [...destinations.values()], errors };
}

export async function deliverGatewayMessage(options: {
	agentDir: string;
	deliver?: string;
	origin?: string;
	content: string;
	registry?: GatewayPlatformRegistry;
}): Promise<GatewayDeliveryResult> {
	const parts = parseGatewayDeliverTargets(options.deliver);
	if (parts.length === 0 || (parts.length === 1 && parts[0] === "local")) {
		return { delivered: 0, errors: [], targets: [] };
	}

	const registry = registerBuiltInGatewayPlatforms(options.registry ?? defaultGatewayPlatformRegistry);
	const config = await loadGatewayDeliveryConfig(options.agentDir);
	const { destinations, errors } = resolveDestinations(config, options.deliver, options.origin, registry);
	let delivered = 0;
	for (const destination of destinations) {
		try {
			const account = config.accounts?.[destination.accountId];
			if (!account) throw new Error(`account not found: ${destination.accountId}`);
			const platform = registry.require(destination.service);
			if (!platform.sendMessage) throw new Error(`gateway platform cannot send standalone messages: ${destination.service}`);
			await platform.sendMessage(account, destination.channelId, options.content);
			delivered++;
		} catch (error) {
			errors.push(`${destination.label}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { delivered, errors, targets: destinations.map((destination) => destination.label) };
}
