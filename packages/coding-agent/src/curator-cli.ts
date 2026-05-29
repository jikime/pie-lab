import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import { type CuratorConsolidateResult, SkillCurator, SkillManager } from "./core/learning/index.ts";
import { createAgentSession } from "./core/sdk.ts";
import { SettingsManager } from "./core/settings-manager.ts";

export async function handleCuratorCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "curator") return false;

	const command = args[1] ?? "status";
	const json = args.includes("--json");
	if (command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
		printCuratorHelp();
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const learningSettings = settingsManager.getLearningSettings();
	if (!learningSettings.enabled || !learningSettings.skills.enabled || !learningSettings.skills.curatorEnabled) {
		console.error(chalk.yellow("Curator is disabled by learning settings."));
		process.exitCode = 1;
		return true;
	}

	const skillManager = new SkillManager({ agentDir, cwd });
	const curator = new SkillCurator({ skillManager, policy: learningSettings.skills.curator });
	const dryRun = args.includes("--dry-run");

	try {
		switch (command) {
			case "status": {
				const status = curator.status();
				const state = curator.getConsolidationState();
				printResult({ status, state }, json, ({ status, state }) => {
					const lines = [formatStatus(status)];
					if (state.lastConsolidatedAt) {
						lines.push(
							`\nLast consolidation: ${new Date(state.lastConsolidatedAt).toLocaleString()} (run #${state.consolidationCount})`,
						);
						if (state.lastConsolidationSummary) {
							lines.push(`Summary: ${state.lastConsolidationSummary}`);
						}
					} else {
						lines.push("\nConsolidation: never run");
					}
					return lines.join("\n");
				});
				return true;
			}
			case "run": {
				const result = curator.run({ dryRun });
				printResult(result, json, formatRunResult);
				return true;
			}
			case "consolidate": {
				return handleConsolidate(curator, cwd, agentDir, dryRun, json);
			}
			case "pin":
			case "unpin":
			case "archive":
			case "restore": {
				const name = args[2];
				if (!name) throw new Error(`${command} requires a skill name.`);
				const result =
					command === "pin"
						? curator.pin(name)
						: command === "unpin"
							? curator.unpin(name)
							: command === "archive"
								? { archivedTo: curator.archive(name) }
								: { restoredTo: curator.restore(name) };
				printResult(result, json, (value) => JSON.stringify(value, null, 2));
				return true;
			}
			case "backup": {
				const backupPath = curator.backup();
				printResult({ backupPath }, json, (value) => `Backup written to ${value.backupPath}`);
				return true;
			}
			case "prune": {
				const result = curator.prune({ dryRun });
				printResult(result, json, formatPruneResult);
				return true;
			}
			case "rollback": {
				const result = curator.rollback(args[2]);
				printResult(result, json, (value) =>
					[
						`Rollback complete: ${value.backupPath}`,
						`Restored active: ${value.restoredActive}`,
						`Restored archived: ${value.restoredArchived}`,
					].join("\n"),
				);
				return true;
			}
			case "settings": {
				const next = parseCuratorSettingsArgs(args.slice(2));
				if (Object.keys(next).length === 0) {
					printResult(learningSettings.skills.curator, json, (value) => JSON.stringify(value, null, 2));
					return true;
				}
				settingsManager.setLearningCuratorSettings(next);
				await settingsManager.flush();
				const updated = settingsManager.getLearningSettings().skills.curator;
				printResult(updated, json, (value) => JSON.stringify(value, null, 2));
				return true;
			}
			default:
				throw new Error(`Unknown curator command: ${command}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exitCode = 1;
		return true;
	}
}

// ---------------------------------------------------------------------------
// Consolidate command implementation
// ---------------------------------------------------------------------------

async function handleConsolidate(
	curator: SkillCurator,
	cwd: string,
	agentDir: string,
	dryRun: boolean,
	json: boolean,
): Promise<boolean> {
	// We need a streamFn from a real session to call the LLM.
	// Create a minimal session to obtain the router-backed streamFn.
	console.log(chalk.dim("Initializing LLM router for consolidation pass..."));

	const { session } = await createAgentSession({ cwd, agentDir, noTools: "all" });
	const streamFn = session.agent.streamFn?.bind(session.agent);

	if (!streamFn) {
		console.error(chalk.red("Error: No LLM provider configured. Run `pie setup` first."));
		process.exitCode = 1;
		return true;
	}

	if (dryRun) {
		console.log(chalk.yellow("Dry-run mode: no skills will be mutated."));
	}

	console.log(chalk.dim("Running consolidation pass..."));

	const result = await curator.consolidate(streamFn, {
		dryRun,
		onLog: (msg) => console.log(chalk.dim(`  ${msg}`)),
	});

	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(formatConsolidateResult(result));
	}

	return true;
}

// ---------------------------------------------------------------------------
// CLI help and formatting
// ---------------------------------------------------------------------------

function printCuratorHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} curator`)} - manage agent-created learning skills

${chalk.bold("Usage:")}
  ${APP_NAME} curator status [--json]
  ${APP_NAME} curator run [--json]
  ${APP_NAME} curator consolidate [--dry-run] [--json]
  ${APP_NAME} curator pin <skill>
  ${APP_NAME} curator unpin <skill>
  ${APP_NAME} curator archive <skill>
  ${APP_NAME} curator restore <skill>
  ${APP_NAME} curator backup
  ${APP_NAME} curator prune [--dry-run]
  ${APP_NAME} curator rollback [backupPath]
  ${APP_NAME} curator settings [--stale-days N] [--archive-days N] [--prune-days N] [--consolidate-days N] [--auto-archive true|false] [--backup-before-run true|false]

${chalk.bold("Commands:")}
  status      Show skill lifecycle states and last consolidation info
  run         Apply idleness-based archival policy (no LLM)
  consolidate LLM umbrella-building pass: merge narrow skills into class-level umbrellas
  pin         Pin a skill (skip all auto-transitions including consolidation)
  unpin       Unpin a skill
  archive     Manually archive a skill
  restore     Restore an archived skill
  backup      Create a snapshot of all skills
  prune       Permanently delete archived skills past pruneAfterDays
  rollback    Restore skills from a previous backup

${chalk.bold("Notes:")}
  Curator only manages skills created by Pie's learning loop.
  Archive moves skills under ~/.pie/agent/skills/.archive instead of deleting them.
  consolidate uses the configured LLM router (same as learning reviews).`);
}

function printResult<T>(value: T, json: boolean, format: (value: T) => string): void {
	console.log(json ? JSON.stringify(value, null, 2) : format(value));
}

function formatStatus(statuses: ReturnType<SkillCurator["status"]>): string {
	if (statuses.length === 0) {
		return "No agent-created skills found.";
	}
	const rows = statuses.map((status) => {
		const idle = status.idleDays === undefined ? "-" : `${status.idleDays}d`;
		const counts = `use:${status.useCount} view:${status.viewCount} patch:${status.patchCount}`;
		return `${status.state.padEnd(8)} ${status.name.padEnd(32)} idle:${idle.padEnd(5)} ${counts}`;
	});
	return rows.join("\n");
}

function formatRunResult(result: ReturnType<SkillCurator["run"]>): string {
	const lines = [
		`Checked ${result.checked} agent-created skill(s).`,
		result.backupPath ? `Backup: ${result.backupPath}` : "Backup: skipped",
		result.dryRun ? "Mode: dry-run" : "Mode: apply",
		`Archived: ${result.archived.length}`,
		`Would archive: ${result.wouldArchive.length}`,
		`Stale: ${result.stale.length}`,
	];
	for (const archived of result.archived) {
		lines.push(`  archived ${archived.name} -> ${archived.archivedTo}`);
	}
	for (const stale of result.stale) {
		lines.push(`  stale ${stale.name} (${stale.idleDays ?? "?"} idle days)`);
	}
	for (const item of result.wouldArchive) {
		lines.push(`  would archive ${item.name} (${item.idleDays ?? "?"} idle days)`);
	}
	for (const skipped of result.skipped) {
		lines.push(`  skipped ${skipped.name}: ${skipped.reason}`);
	}
	return lines.join("\n");
}

function formatConsolidateResult(result: CuratorConsolidateResult): string {
	const lines: string[] = [];

	lines.push(`${chalk.bold("Consolidation pass complete")}`);
	lines.push(`Mode: ${result.dryRun ? chalk.yellow("dry-run") : chalk.green("apply")}`);
	lines.push(`Iterations: ${result.iterations}`);
	if (result.backupPath) {
		lines.push(`Backup: ${result.backupPath}`);
	}
	lines.push("");

	if (result.consolidations.length > 0) {
		lines.push(chalk.bold(`Consolidations (${result.consolidations.length}):`));
		for (const c of result.consolidations) {
			lines.push(`  ${chalk.cyan(c.from)} → ${chalk.green(c.into)}`);
			if (c.reason) lines.push(`    ${chalk.dim(c.reason)}`);
		}
	} else {
		lines.push(chalk.dim("No consolidations performed."));
	}

	if (result.prunings.length > 0) {
		lines.push("");
		lines.push(chalk.bold(`Prunings (${result.prunings.length}):`));
		for (const p of result.prunings) {
			lines.push(`  ${chalk.yellow(p.name)} (no merge target)`);
			if (p.reason) lines.push(`    ${chalk.dim(p.reason)}`);
		}
	}

	if (result.rawOutput && !result.dryRun && result.consolidations.length === 0 && result.prunings.length === 0) {
		lines.push("");
		lines.push(chalk.dim("No structured summary found in output. Full output:"));
		lines.push(chalk.dim(result.rawOutput.slice(0, 1000)));
	}

	return lines.join("\n");
}

function formatPruneResult(result: ReturnType<SkillCurator["prune"]>): string {
	const lines = [
		`Checked ${result.checked} archived skill(s).`,
		result.dryRun ? "Mode: dry-run" : "Mode: apply",
		`Removed: ${result.removed.length}`,
		`Would remove: ${result.wouldRemove.length}`,
	];
	for (const removed of result.removed) {
		lines.push(`  removed ${removed.name} -> ${removed.path}`);
	}
	for (const item of result.wouldRemove) {
		lines.push(`  would remove ${item.name} (${item.archivedAt ?? "unknown archivedAt"})`);
	}
	for (const skipped of result.skipped) {
		lines.push(`  skipped ${skipped.name}: ${skipped.reason}`);
	}
	return lines.join("\n");
}

function parseCuratorSettingsArgs(args: string[]) {
	const settings: Record<string, unknown> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const next = args[i + 1];
		if (!next) continue;
		if (arg === "--stale-days") {
			settings.staleAfterDays = Number(next);
			i++;
		} else if (arg === "--archive-days") {
			settings.archiveAfterDays = Number(next);
			i++;
		} else if (arg === "--prune-days") {
			settings.pruneAfterDays = Number(next);
			i++;
		} else if (arg === "--consolidate-days") {
			settings.consolidateIntervalDays = Number(next);
			i++;
		} else if (arg === "--auto-archive") {
			settings.autoArchive = parseBoolean(next);
			i++;
		} else if (arg === "--backup-before-run") {
			settings.backupBeforeRun = parseBoolean(next);
			i++;
		}
	}
	return settings;
}

function parseBoolean(value: string): boolean {
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
