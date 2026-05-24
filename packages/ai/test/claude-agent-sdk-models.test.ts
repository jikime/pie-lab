import { describe, expect, it } from "vitest";
import { getApiProvider, getModel, getModels, getProviders } from "../src/index.ts";

describe("Claude Agent SDK models", () => {
	it("registers claude-code-adk as a built-in local provider", () => {
		expect(getProviders()).toContain("claude-code-adk");

		const models = getModels("claude-code-adk");
		expect(models.map((model) => model.id)).toEqual(
			expect.arrayContaining(["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"]),
		);
	});

	it("uses the claude-agent-sdk API for Claude Code models", () => {
		const model = getModel("claude-code-adk", "claude-sonnet-4-6");

		expect(model).toMatchObject({
			api: "claude-agent-sdk",
			provider: "claude-code-adk",
			baseUrl: "claude-code://local",
		});
		expect(getApiProvider("claude-agent-sdk")).toBeDefined();
	});
});
