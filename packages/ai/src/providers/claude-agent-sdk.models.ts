// pie-lab fork addition: models served through the local Claude Code CLI
// via @anthropic-ai/claude-agent-sdk. Not part of the generated catalog.

import type { Model } from "../types.ts";

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
