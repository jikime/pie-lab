import { describe, expect, it } from "vitest";
import { discordMessageMentionsBot } from "../src/core/gateway/adapters.ts";
import type { DiscordAccountConfig } from "../src/core/gateway/chat/core/config-types.ts";

const account: DiscordAccountConfig = {
	service: "discord",
	name: "PIE-LAB",
	botToken: "token",
	botUserId: "bot-1",
	botUsername: "PIE-LAB",
	channels: {},
};

function discordMessage(options: {
	content?: string;
	userMentionIds?: string[];
	roleMentions?: Array<{ id: string; name: string }>;
	botRoles?: Array<{ id: string; name: string }>;
}) {
	const roleMentions = options.roleMentions ?? [];
	const botRoles = options.botRoles ?? [];
	return {
		content: options.content ?? "",
		mentions: {
			users: {
				has: (id: string) => (options.userMentionIds ?? []).includes(id),
			},
			roles: {
				has: (id: string) => roleMentions.some((role) => role.id === id),
				some: (predicate: (role: { id: string; name: string }) => boolean) => roleMentions.some(predicate),
			},
		},
		guild: {
			members: {
				me: {
					roles: {
						cache: {
							some: (predicate: (role: { id: string; name: string }) => boolean) => botRoles.some(predicate),
						},
					},
				},
			},
		},
	} as any;
}

describe("Discord gateway mentions", () => {
	it("detects direct bot user mentions", () => {
		expect(discordMessageMentionsBot(account, discordMessage({ userMentionIds: ["bot-1"] }))).toBe(true);
	});

	it("detects textual bot mentions", () => {
		expect(discordMessageMentionsBot(account, discordMessage({ content: "@PIE-LAB 안녕" }))).toBe(true);
	});

	it("detects role mentions that use the bot name", () => {
		expect(
			discordMessageMentionsBot(
				account,
				discordMessage({
					content: "<@&role-1> 안녕",
					roleMentions: [{ id: "role-1", name: "PIE-LAB" }],
				}),
			),
		).toBe(true);
	});

	it("detects mentions of the bot's matching guild role", () => {
		expect(
			discordMessageMentionsBot(
				account,
				discordMessage({
					content: "<@&role-1> 안녕",
					roleMentions: [{ id: "role-1", name: "Managed Role" }],
					botRoles: [{ id: "role-1", name: "PIE-LAB" }],
				}),
			),
		).toBe(true);
	});

	it("ignores unrelated role mentions", () => {
		expect(
			discordMessageMentionsBot(
				account,
				discordMessage({
					content: "<@&role-2> 안녕",
					roleMentions: [{ id: "role-2", name: "Other" }],
					botRoles: [{ id: "role-1", name: "PIE-LAB" }],
				}),
			),
		).toBe(false);
	});
});
