import { claudeAgentSdkApi } from "../api/claude-agent-sdk.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import type { Model } from "../types.ts";

// pie-lab fork addition: models served through the local Claude Code CLI via
// @anthropic-ai/claude-agent-sdk. Kept inline (not in a *.models.ts file)
// because scripts/generate-models.ts deletes and regenerates every
// providers/*.models.ts from the upstream catalog on each build.
export const CLAUDE_AGENT_SDK_MODELS = {
	"claude-sonnet-4-6": {
		id: "claude-sonnet-4-6",
		name: "Claude Code Sonnet 4.6",
		api: "claude-agent-sdk",
		provider: "claude-code-adk",
		baseUrl: "claude-code://local",
		reasoning: true,
		thinkingLevelMap: { xhigh: "max" },
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	} satisfies Model<"claude-agent-sdk">,
	"claude-opus-4-7": {
		id: "claude-opus-4-7",
		name: "Claude Code Opus 4.7",
		api: "claude-agent-sdk",
		provider: "claude-code-adk",
		baseUrl: "claude-code://local",
		reasoning: true,
		thinkingLevelMap: { xhigh: "xhigh" },
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	} satisfies Model<"claude-agent-sdk">,
	"claude-haiku-4-5": {
		id: "claude-haiku-4-5",
		name: "Claude Code Haiku 4.5",
		api: "claude-agent-sdk",
		provider: "claude-code-adk",
		baseUrl: "claude-code://local",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 64000,
	} satisfies Model<"claude-agent-sdk">,
};

/**
 * pie-lab fork addition: auth is delegated to the local Claude Code CLI
 * (`claude` login), so this provider is always considered configured.
 */
const claudeAgentSdkAuth: ApiKeyAuth = {
	name: "Claude Code CLI login",
	resolve: async () => ({ auth: {}, source: "local Claude Code CLI" }),
};

export function claudeAgentSdkProvider(): Provider<"claude-agent-sdk"> {
	return createProvider({
		id: "claude-code-adk",
		name: "Claude Code (Agent SDK)",
		baseUrl: "claude-code://local",
		auth: { apiKey: claudeAgentSdkAuth },
		models: Object.values(CLAUDE_AGENT_SDK_MODELS),
		api: claudeAgentSdkApi(),
	});
}
