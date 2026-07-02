import { describe, expect, it } from "vitest";
import { builtinProviders } from "../src/providers/all.ts";
import { claudeAgentSdkProvider } from "../src/providers/claude-agent-sdk.ts";

describe("Claude Agent SDK models", () => {
	it("registers claude-code-adk as a built-in local provider", () => {
		expect(builtinProviders().map((provider) => provider.id)).toContain("claude-code-adk");

		const models = claudeAgentSdkProvider().getModels();
		expect(models.map((model) => model.id)).toEqual(
			expect.arrayContaining(["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"]),
		);
	});

	it("uses the claude-agent-sdk API for Claude Code models", () => {
		const model = claudeAgentSdkProvider()
			.getModels()
			.find((candidate) => candidate.id === "claude-sonnet-4-6");

		expect(model).toMatchObject({
			api: "claude-agent-sdk",
			provider: "claude-code-adk",
			baseUrl: "claude-code://local",
		});
	});
});
