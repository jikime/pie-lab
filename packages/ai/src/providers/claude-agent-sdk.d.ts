import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { SimpleStreamOptions, StreamFunction, StreamOptions } from "../types.ts";
export interface ClaudeAgentSdkOptions extends StreamOptions {
    cwd?: string;
    permissionMode?: PermissionMode;
    systemPrompt?: Options["systemPrompt"];
    appendSystemPrompt?: string;
    includePieSystemPrompt?: boolean;
    settingSources?: Options["settingSources"];
    tools?: Options["tools"];
    allowedTools?: string[];
    disallowedTools?: string[];
    maxTurns?: number;
    maxBudgetUsd?: number;
    resume?: string;
    continue?: boolean;
    pathToClaudeCodeExecutable?: string;
    claudePath?: string;
    persistSession?: boolean;
}
export declare const streamClaudeAgentSdk: StreamFunction<"claude-agent-sdk", ClaudeAgentSdkOptions>;
export declare const streamSimpleClaudeAgentSdk: StreamFunction<"claude-agent-sdk", SimpleStreamOptions>;
//# sourceMappingURL=claude-agent-sdk.d.ts.map