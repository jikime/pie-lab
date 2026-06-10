import { createAgentSession } from "../sdk.ts";
import { SettingsManager } from "../settings-manager.ts";
import { SkillCurator } from "./skill-curator.ts";
import { SkillManager } from "./skill-manager.ts";

// Imported by the gateway scheduler loop and CLI directly — deliberately not
// re-exported from learning/index.ts, which sdk.ts depends on (import cycle).

export interface CuratorAutorunResult {
	ran: boolean;
	reason?: "disabled" | "not-due" | "no-llm";
	archived?: number;
	consolidated?: number;
	pruned?: number;
}

/**
 * Run curator maintenance (stale-skill archival + LLM consolidation pass) if
 * the consolidation interval has elapsed. Safe to call frequently: the
 * due-check is cheap and the LLM session is only created when a pass is due.
 */
export async function runCuratorAutorunIfDue(options: {
	cwd: string;
	agentDir: string;
	log?: (message: string) => void;
}): Promise<CuratorAutorunResult> {
	const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
	const learning = settingsManager.getLearningSettings();
	if (!learning.enabled || !learning.skills.enabled || !learning.skills.curatorEnabled) {
		return { ran: false, reason: "disabled" };
	}

	const skillManager = new SkillManager({ agentDir: options.agentDir, cwd: options.cwd });
	const curator = new SkillCurator({ skillManager, policy: learning.skills.curator });
	if (!curator.isConsolidationDue()) {
		return { ran: false, reason: "not-due" };
	}

	const runResult = curator.run({ dryRun: !learning.skills.curator.autoArchive });

	const { session } = await createAgentSession({ cwd: options.cwd, agentDir: options.agentDir, noTools: "all" });
	try {
		const streamFn = session.agent.streamFn?.bind(session.agent);
		if (!streamFn) {
			return { ran: false, reason: "no-llm", archived: runResult.archived.length };
		}
		const result = await curator.maybeConsolidate(streamFn, { onLog: options.log });
		return {
			ran: true,
			archived: runResult.archived.length,
			consolidated: result?.consolidations.length ?? 0,
			pruned: result?.prunings.length ?? 0,
		};
	} finally {
		session.dispose();
	}
}
