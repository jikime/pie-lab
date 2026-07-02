import { claudeAgentSdkApi } from "../api/claude-agent-sdk.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { CLAUDE_AGENT_SDK_MODELS } from "./claude-agent-sdk.models.ts";

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
