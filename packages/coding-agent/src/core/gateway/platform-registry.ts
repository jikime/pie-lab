import type { GatewayAccountAdapterContext, GatewayAdapter, GatewayConversationEndpoint } from "./adapters.ts";
import type { ChatAccountConfig, ChatService } from "./chat/core/config-types.ts";

export interface GatewayPlatformCapabilities {
	markdown?: boolean;
	attachments?: boolean;
	typing?: boolean;
	polling?: boolean;
	realtime?: boolean;
	threads?: boolean;
	voiceInput?: boolean;
	voiceOutput?: boolean;
}

export interface GatewayPlatformRegistration {
	service: ChatService;
	label: string;
	capabilities?: GatewayPlatformCapabilities;
	startAccountAdapter(
		accountId: string,
		account: ChatAccountConfig,
		endpoints: GatewayConversationEndpoint[],
		context?: GatewayAccountAdapterContext,
	): Promise<GatewayAdapter>;
	sendMessage?(
		account: ChatAccountConfig,
		channelId: string,
		text: string,
		options?: { attachmentPaths?: string[]; signal?: AbortSignal; replyToMessageId?: string },
	): Promise<string>;
}

export class GatewayPlatformRegistry {
	private readonly entries = new Map<ChatService, GatewayPlatformRegistration>();

	register(entry: GatewayPlatformRegistration, options: { replace?: boolean } = {}): void {
		if (!entry.service.trim()) throw new Error("Gateway platform service is required.");
		if (!options.replace && this.entries.has(entry.service)) {
			throw new Error(`Gateway platform already registered: ${entry.service}`);
		}
		this.entries.set(entry.service, {
			...entry,
			capabilities: { ...entry.capabilities },
		});
	}

	has(service: ChatService): boolean {
		return this.entries.has(service);
	}

	get(service: ChatService): GatewayPlatformRegistration | undefined {
		const entry = this.entries.get(service);
		if (!entry) return undefined;
		return {
			...entry,
			capabilities: { ...entry.capabilities },
		};
	}

	require(service: ChatService): GatewayPlatformRegistration {
		const entry = this.get(service);
		if (!entry) throw new Error(`Unsupported gateway platform: ${service}`);
		return entry;
	}

	list(): GatewayPlatformRegistration[] {
		return [...this.entries.values()]
			.map((entry) => ({
				...entry,
				capabilities: { ...entry.capabilities },
			}))
			.sort((a, b) => a.service.localeCompare(b.service));
	}
}

export const defaultGatewayPlatformRegistry = new GatewayPlatformRegistry();
