import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

/**
 * Loads the claude-agent-sdk implementation through a variable specifier so
 * bundlers (browser smoke, Bun compile) cannot follow the import into the
 * Node-only @anthropic-ai/claude-agent-sdk. The `.ts`/`.js` rewrite keeps the
 * trick working from both source and built output.
 */
const importNodeOnlyApi = (specifier: string): Promise<unknown> => {
	const runtimeSpecifier = import.meta.url.endsWith(".js") ? specifier.replace(/\.ts$/, ".js") : specifier;
	return import(runtimeSpecifier);
};

let claudeAgentSdkModuleOverride: ProviderStreams | undefined;

/**
 * Overrides the dynamically imported claude-agent-sdk implementation. Used by
 * the Bun binary build, where the variable-specifier import cannot be bundled;
 * the build registers a statically imported module instead.
 */
export function setClaudeAgentSdkProviderModule(module: ProviderStreams): void {
	claudeAgentSdkModuleOverride = module;
}

export const claudeAgentSdkApi = (): ProviderStreams =>
	lazyApi(
		async () =>
			claudeAgentSdkModuleOverride ?? ((await importNodeOnlyApi("./claude-agent-sdk.ts")) as ProviderStreams),
	);
