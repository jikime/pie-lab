import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "@pie-lab/ai";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { parse as parseYaml } from "yaml";
import type { SkillManager, SkillUsageRecord } from "./skill-manager.ts";
import { createLearningToolDefinitions } from "./tools.ts";

export interface SkillCuratorPolicy {
	staleAfterDays: number;
	archiveAfterDays: number;
	autoArchive: boolean;
	backupBeforeRun: boolean;
	pruneAfterDays: number;
	consolidateIntervalDays: number;
}

export interface CuratedSkillStatus {
	name: string;
	location: string;
	state: "active" | "stale" | "archived" | "pinned";
	pinned: boolean;
	createdAt?: string;
	updatedAt?: string;
	lastUsedAt?: string;
	useCount: number;
	viewCount: number;
	patchCount: number;
	idleDays?: number;
	archivedAt?: string;
}

export interface CuratorRunResult {
	checked: number;
	stale: CuratedSkillStatus[];
	archived: Array<{ name: string; archivedTo: string }>;
	skipped: Array<{ name: string; reason: string }>;
	dryRun: boolean;
	backupPath?: string;
	wouldArchive: CuratedSkillStatus[];
}

export interface CuratorPruneResult {
	checked: number;
	removed: Array<{ name: string; path: string }>;
	skipped: Array<{ name: string; reason: string }>;
	dryRun: boolean;
	wouldRemove: CuratedSkillStatus[];
}

export interface CuratorRollbackResult {
	backupPath: string;
	restoredActive: number;
	restoredArchived: number;
}

export interface CuratorConsolidateOptions {
	dryRun?: boolean;
	onLog?: (msg: string) => void;
}

export interface ConsolidationEntry {
	from: string;
	into: string;
	reason: string;
}

export interface PruningEntry {
	name: string;
	reason: string;
}

export interface CuratorConsolidateResult {
	dryRun: boolean;
	backupPath?: string;
	rawOutput: string;
	consolidations: ConsolidationEntry[];
	prunings: PruningEntry[];
	iterations: number;
}

// ---------------------------------------------------------------------------
// Curator state file — tracks consolidation timing
// ---------------------------------------------------------------------------

interface CuratorState {
	lastConsolidatedAt: string | null;
	consolidationCount: number;
	lastConsolidationSummary: string | null;
}

function defaultCuratorState(): CuratorState {
	return {
		lastConsolidatedAt: null,
		consolidationCount: 0,
		lastConsolidationSummary: null,
	};
}

// ---------------------------------------------------------------------------
// Consolidation prompt — ported from hermes-agent curator.py
// ---------------------------------------------------------------------------

const CURATOR_CONSOLIDATION_PROMPT = `You are running as Pie's background skill CURATOR. This is an \
UMBRELLA-BUILDING consolidation pass, not a passive audit and not a \
duplicate-finder.

The goal of the skill collection is a LIBRARY OF CLASS-LEVEL \
INSTRUCTIONS AND EXPERIENTIAL KNOWLEDGE. A collection of hundreds of \
narrow skills where each one captures one session's specific bug is \
a FAILURE of the library — not a feature. An agent searching skills \
matches on descriptions, not on exact names; one broad umbrella \
skill with labeled subsections beats five narrow siblings for \
discoverability, not the other way around.

The right target shape is CLASS-LEVEL skills with rich SKILL.md \
bodies + references/, templates/, and scripts/ subfiles for \
session-specific detail — not one-session-one-skill micro-entries.

Hard rules — do not violate:
1. DO NOT touch bundled or project skills. The candidate list \
below is already filtered to agent-created user skills only.
2. DO NOT delete any skill. Archiving (action=archive on skill_manage) is \
the maximum destructive action. Archives are recoverable; deletion is not.
3. DO NOT touch skills shown as pinned=yes. Skip them entirely.
4. DO NOT use usage counters as a reason to skip consolidation. The \
counters are new and often mostly zero. Judge overlap on CONTENT, \
not on use_count. 'use=0' is not evidence a skill is valuable; it's \
absence of evidence either way.
5. DO NOT reject consolidation on the grounds that 'each skill has \
a distinct trigger'. Pairwise distinctness is the wrong bar. The \
right bar is: 'would a human maintainer write this as N separate \
skills, or as one skill with N labeled subsections?' When the \
answer is the latter, merge.

How to work — not optional:
1. Scan the full candidate list. Identify PREFIX CLUSTERS (skills \
sharing a first word or domain keyword). Examples you are likely \
to find: gateway-*, discord-*, telegram-*, cron-*, learning-*, \
session-*, skill-*, memory-*, api-*, debug-*, etc.
2. For each cluster with 2+ members, do NOT ask 'are these pairs \
overlapping?' — ask 'what is the UMBRELLA CLASS these skills all \
serve? Would a maintainer name that class and write one skill for \
it?' If yes, pick (or create) the umbrella and absorb the siblings \
into it.
3. Three ways to consolidate — use the right one per cluster:
   a. MERGE INTO EXISTING UMBRELLA — one skill in the cluster is \
already broad enough to be the umbrella. Use skill_manage action=patch \
to add a labeled section for each sibling's unique insight, then \
archive the siblings with skill_manage action=archive.
   b. CREATE A NEW UMBRELLA SKILL.md — no existing member is broad \
enough. Use skill_manage action=create to write a new class-level \
skill whose SKILL.md covers the shared workflow and has short \
labeled subsections. Archive the now-absorbed narrow siblings.
   c. DEMOTE TO REFERENCES/TEMPLATES/SCRIPTS — a sibling has \
narrow-but-valuable session-specific content. Move it into the \
umbrella's appropriate support directory using skill_manage action=write_file:
      • references/<topic>.md for session-specific detail OR \
condensed knowledge banks
      • templates/<name>.<ext> for starter files meant to be copied
      • scripts/<name>.<ext> for re-runnable verification scripts
      Then archive the old sibling with skill_manage action=archive.
4. Also flag skills whose NAME is too narrow (contains a specific \
error string, an 'audit' / 'diagnosis' / 'salvage' session artifact, \
a specific date or version). These almost always belong as a \
subsection or support file under a class-level umbrella.
5. Iterate. After one consolidation round, scan the remaining set \
and look for the NEXT umbrella opportunity. Don't stop after 3 merges.

Your toolset:
  - skills_list                    — read the current landscape
  - skill_view                     — inspect a specific skill's content
  - skill_manage action=patch      — add sections to the umbrella
  - skill_manage action=create     — create a new umbrella SKILL.md
  - skill_manage action=write_file — add a references/, templates/, \
or scripts/ file under an existing skill
  - skill_manage action=archive    — archive a narrow skill after merging

'keep' is a legitimate decision ONLY when the skill is already a \
class-level umbrella and none of the proposed merges would improve \
discoverability.

Expected output: real umbrella-ification. Process every obvious \
cluster. If you end the pass with fewer than 5 archives and you have \
more than 10 candidate skills, you stopped too early — go back and \
look at the clusters you left alone.

When done, write a human summary AND a structured machine-readable \
block. Format EXACTLY:

## Structured summary (required)
\`\`\`yaml
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence — why merged, not just 'similar'>
prunings:
  - name: <skill-name>
    reason: <one short sentence — why archived with no merge target>
\`\`\`

Every skill you archived MUST appear in exactly one of the two lists. \
If you consolidated X into umbrella Y (patched Y, wrote a references \
file to Y, or created Y with X's content absorbed), X goes under \
\`consolidations\` with \`into: Y\`. If you archived X with no \
absorption — truly stale, irrelevant, or obsolete — X goes under \
\`prunings\`. Leave a list empty (\`consolidations: []\`) if none. \
Do not omit the block.`;

export const DEFAULT_CURATOR_POLICY: SkillCuratorPolicy = {
	staleAfterDays: 30,
	archiveAfterDays: 90,
	autoArchive: true,
	backupBeforeRun: true,
	pruneAfterDays: 180,
	consolidateIntervalDays: 7,
};

// Type alias for streamFn (same as BackgroundLearningReview uses)
type StreamFn = (model: Model<any>, context: { systemPrompt?: string; messages: Message[] }, options?: any) => any;

export class SkillCurator {
	private readonly manager: SkillManager;
	private readonly policy: SkillCuratorPolicy;

	constructor(options: { skillManager: SkillManager; policy?: Partial<SkillCuratorPolicy> }) {
		this.manager = options.skillManager;
		this.policy = { ...DEFAULT_CURATOR_POLICY, ...options.policy };
	}

	status(): CuratedSkillStatus[] {
		const active = this.manager
			.list()
			.filter((skill) => skill.source === "user" && skill.createdBy === "agent")
			.map((skill) => {
				const usage = this.manager.readUsageForRoot(dirname(skill.location));
				return this.toStatus(skill.name, skill.location, usage, false);
			});
		return [...active, ...this.archivedStatuses()].sort((a, b) => a.name.localeCompare(b.name));
	}

	run(options: { dryRun?: boolean } = {}): CuratorRunResult {
		const result: CuratorRunResult = {
			checked: 0,
			stale: [],
			archived: [],
			skipped: [],
			dryRun: options.dryRun === true,
			wouldArchive: [],
		};
		if (this.policy.backupBeforeRun && !result.dryRun) {
			result.backupPath = this.backup();
		}

		for (const status of this.status().filter((skill) => skill.state !== "archived")) {
			result.checked += 1;
			if (status.pinned) {
				result.skipped.push({ name: status.name, reason: "pinned" });
				continue;
			}
			if ((status.idleDays ?? 0) >= this.policy.archiveAfterDays) {
				if (!this.policy.autoArchive || result.dryRun) {
					result.wouldArchive.push(status);
					continue;
				}
				try {
					result.archived.push({ name: status.name, archivedTo: this.manager.archive(status.name) });
				} catch (error) {
					result.skipped.push({
						name: status.name,
						reason: error instanceof Error ? error.message : String(error),
					});
				}
				continue;
			}
			if ((status.idleDays ?? 0) >= this.policy.staleAfterDays) {
				result.stale.push(status);
			}
		}

		return result;
	}

	prune(options: { dryRun?: boolean; pruneAfterDays?: number } = {}): CuratorPruneResult {
		const pruneAfterDays = options.pruneAfterDays ?? this.policy.pruneAfterDays;
		const result: CuratorPruneResult = {
			checked: 0,
			removed: [],
			skipped: [],
			dryRun: options.dryRun === true,
			wouldRemove: [],
		};
		for (const status of this.status().filter((skill) => skill.state === "archived")) {
			result.checked += 1;
			const idleDays = status.archivedAt ? daysSince(status.archivedAt) : status.idleDays;
			if ((idleDays ?? 0) < pruneAfterDays) {
				result.skipped.push({ name: status.name, reason: `archived for ${idleDays ?? "unknown"} days` });
				continue;
			}
			if (result.dryRun) {
				result.wouldRemove.push(status);
				continue;
			}
			rmSync(dirname(status.location), { recursive: true, force: true });
			result.removed.push({ name: status.name, path: dirname(status.location) });
		}
		return result;
	}

	pin(name: string): CuratedSkillStatus {
		this.manager.setPinned(name, true);
		return this.requireStatus(name);
	}

	unpin(name: string): CuratedSkillStatus {
		this.manager.setPinned(name, false);
		return this.requireStatus(name);
	}

	archive(name: string): string {
		return this.manager.archive(name);
	}

	restore(name: string): string {
		return this.manager.restore(name);
	}

	backup(): string {
		const backupRoot = join(this.manager.userSkillsDir, ".backups");
		mkdirSync(backupRoot, { recursive: true });
		const target = join(backupRoot, `curator-${new Date().toISOString().replace(/[:.]/g, "-")}`);
		const activeRoot = join(target, "active");
		const archivedRoot = join(target, "archive");
		mkdirSync(activeRoot, { recursive: true });
		mkdirSync(archivedRoot, { recursive: true });
		for (const status of this.status()) {
			const sourceRoot = dirname(status.location);
			const destinationRoot = status.state === "archived" ? archivedRoot : activeRoot;
			cpSync(sourceRoot, join(destinationRoot, basename(sourceRoot)), { recursive: true });
		}
		writeFileSync(
			join(target, "manifest.json"),
			`${JSON.stringify({ createdAt: new Date().toISOString(), skills: this.status() }, null, 2)}\n`,
			"utf-8",
		);
		return target;
	}

	rollback(backupPath?: string): CuratorRollbackResult {
		const selectedBackupPath = backupPath ?? this.latestBackupPath();
		if (!selectedBackupPath) {
			throw new Error("No curator backup found.");
		}
		const manifestPath = join(selectedBackupPath, "manifest.json");
		if (!existsSync(manifestPath)) {
			throw new Error(`Invalid curator backup: ${selectedBackupPath}`);
		}

		this.removeCurrentAgentCreatedSkills();
		const restoredActive = this.restoreBackupGroup(join(selectedBackupPath, "active"), this.manager.userSkillsDir);
		const restoredArchived = this.restoreBackupGroup(
			join(selectedBackupPath, "archive"),
			join(this.manager.userSkillsDir, ".archive"),
		);
		return { backupPath: selectedBackupPath, restoredActive, restoredArchived };
	}

	// ---------------------------------------------------------------------------
	// LLM-driven consolidation pass
	// ---------------------------------------------------------------------------

	/**
	 * Run the LLM umbrella-building consolidation pass.
	 *
	 * The curator LLM reviews all active agent-created skills and identifies
	 * clusters of narrow skills that should be merged into class-level umbrella
	 * skills. This is the primary mechanism for keeping the skill library
	 * manageable as it grows over time.
	 *
	 * @param streamFn - The same streamFn used by BackgroundLearningReview.
	 *   In session context, this is `agent.streamFn`. In CLI context, create
	 *   one via createAgentSession().session.agent.streamFn.
	 * @param options - Dry run flag and optional log callback.
	 */
	async consolidate(streamFn: StreamFn, options: CuratorConsolidateOptions = {}): Promise<CuratorConsolidateResult> {
		const { dryRun = false, onLog } = options;
		const log = (msg: string) => onLog?.(msg);

		const activeSkills = this.status().filter((s) => s.state !== "archived");

		if (activeSkills.length < 2) {
			log("Not enough active skills to consolidate (need ≥ 2).");
			return {
				dryRun,
				rawOutput: "",
				consolidations: [],
				prunings: [],
				iterations: 0,
			};
		}

		let backupPath: string | undefined;
		if (this.policy.backupBeforeRun && !dryRun) {
			backupPath = this.backup();
			log(`Backup created: ${backupPath}`);
		}

		const skillContext = this.buildConsolidationSkillContext(activeSkills);
		const toolDefinitions = createLearningToolDefinitions({
			memoryStore: {
				read: () => "",
				append: () => "",
				replace: () => "",
				clear: () => "",
				readSnapshot: () => ({ memory: "", user: "" }),
				formatForSystemPrompt: () => "",
			} as any,
			skillManager: this.manager,
		});
		// Exclude memory tool — curator only touches skills
		const curatorTools = toolDefinitions.filter((t) => t.name !== "memory");
		const toolsByName = new Map(curatorTools.map((t) => [t.name, t]));

		const systemPrompt = dryRun
			? `DRY-RUN MODE — REPORT ONLY. DO NOT mutate any skills.\n\nDO NOT call skill_manage with action=patch, create, archive, write_file, or remove_file.\nskills_list and skill_view are FINE — read as much as you need.\n\nYour output IS the deliverable. Describe actions you WOULD take, not actions you took.\n\n${CURATOR_CONSOLIDATION_PROMPT}`
			: CURATOR_CONSOLIDATION_PROMPT;

		const model = createRouterModel("auto:learning");
		const messages: Message[] = [
			{
				role: "user",
				content: `Please run the skill consolidation pass on the following agent-created skill library:\n\n${skillContext}\n\nAnalyze clusters, identify umbrella opportunities, and consolidate narrow skills.`,
				timestamp: Date.now(),
			},
		];

		const rawOutputs: string[] = [];
		let iterations = 0;
		const maxIterations = 12;

		log(`Starting consolidation pass on ${activeSkills.length} active skills...`);

		for (let i = 0; i < maxIterations; i++) {
			iterations += 1;
			const assistant = await runConsolidationModelTurn(streamFn, model, {
				systemPrompt,
				messages,
				tools: curatorTools.map(({ name, description, parameters }) => ({ name, description, parameters })),
			});
			messages.push(assistant);

			const assistantText = extractAssistantText(assistant);
			if (assistantText) {
				rawOutputs.push(assistantText);
			}

			const toolCalls = assistant.content.filter((item): item is ToolCall => item.type === "toolCall");
			if (toolCalls.length === 0) {
				// No more tool calls — LLM is done
				break;
			}

			for (const toolCall of toolCalls) {
				const definition = toolsByName.get(toolCall.name);
				if (!definition) {
					messages.push(
						createToolResult(
							toolCall,
							`Unknown tool: ${toolCall.name}. Only skills_list, skill_view, and skill_manage are available.`,
							true,
						),
					);
					continue;
				}

				// In dry-run mode, block mutating tool calls
				if (dryRun && isMutatingSkillCall(toolCall)) {
					const action = (toolCall.arguments as any)?.action ?? "?";
					messages.push(
						createToolResult(
							toolCall,
							`DRY-RUN: Would execute skill_manage action=${action} on '${(toolCall.arguments as any)?.name}'.`,
						),
					);
					log(`  [dry-run] would ${action} '${(toolCall.arguments as any)?.name}'`);
					continue;
				}

				try {
					const result = await definition.execute(
						toolCall.id,
						toolCall.arguments as any,
						undefined,
						undefined,
						undefined as any,
					);
					const text = result.content
						.map((item) => (item.type === "text" ? item.text : `[${item.mimeType} image]`))
						.join("\n");
					messages.push(createToolResult(toolCall, text || JSON.stringify(result.details ?? {})));

					if (!dryRun) {
						const action = (toolCall.arguments as any)?.action;
						const name = (toolCall.arguments as any)?.name;
						if (action && name) {
							log(`  ${action} '${name}'`);
						}
					}
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					messages.push(createToolResult(toolCall, msg, true));
					log(`  error: ${msg}`);
				}
			}
		}

		const rawOutput = rawOutputs.join("\n\n");
		const { consolidations, prunings } = parseStructuredSummary(rawOutput);

		// Persist state
		const state = this.loadState();
		state.lastConsolidatedAt = new Date().toISOString();
		state.consolidationCount += 1;
		state.lastConsolidationSummary = `${consolidations.length} consolidated, ${prunings.length} pruned`;
		this.saveState(state);

		log(`Consolidation complete: ${consolidations.length} merged, ${prunings.length} pruned.`);

		return {
			dryRun,
			backupPath,
			rawOutput,
			consolidations,
			prunings,
			iterations,
		};
	}

	/**
	 * Whether an automatic consolidation pass should run now. True when the
	 * configured interval has elapsed since the last pass, or — if a pass has
	 * never run — when there are enough active skills to be worth one.
	 */
	isConsolidationDue(): boolean {
		const state = this.loadState();
		if (!state.lastConsolidatedAt) {
			// Never consolidated — but only auto-run if there are enough skills
			const active = this.status().filter((s) => s.state !== "archived");
			return active.length >= 5;
		}
		const daysSinceLast = daysSince(state.lastConsolidatedAt) ?? 0;
		return daysSinceLast >= this.policy.consolidateIntervalDays;
	}

	/**
	 * Run consolidation if the interval since last run has passed.
	 * Returns null if consolidation was not needed.
	 */
	async maybeConsolidate(
		streamFn: StreamFn,
		options: CuratorConsolidateOptions = {},
	): Promise<CuratorConsolidateResult | null> {
		if (!this.isConsolidationDue()) return null;
		return this.consolidate(streamFn, options);
	}

	/**
	 * Return the curator state (last consolidation time, count, etc.)
	 */
	getConsolidationState(): CuratorState {
		return this.loadState();
	}

	// ---------------------------------------------------------------------------
	// Private helpers
	// ---------------------------------------------------------------------------

	private requireStatus(name: string): CuratedSkillStatus {
		const status = this.status().find((skill) => skill.name === name && skill.state !== "archived");
		if (!status) throw new Error(`Agent-created skill not found: ${name}`);
		return status;
	}

	private archivedStatuses(): CuratedSkillStatus[] {
		const archiveRoot = join(this.manager.userSkillsDir, ".archive");
		if (!existsSync(archiveRoot)) return [];
		const statuses: CuratedSkillStatus[] = [];
		for (const entry of readdirSync(archiveRoot)) {
			const root = join(archiveRoot, entry);
			if (!statSync(root).isDirectory()) continue;
			const skillFile = join(root, "SKILL.md");
			if (!existsSync(skillFile)) continue;
			const usage = this.manager.readUsageForRoot(root);
			if (usage?.createdBy !== "agent") continue;
			statuses.push(this.toStatus(readSkillName(skillFile, entry), skillFile, usage, true));
		}
		return statuses;
	}

	private latestBackupPath(): string | undefined {
		const backupRoot = join(this.manager.userSkillsDir, ".backups");
		if (!existsSync(backupRoot)) return undefined;
		return readdirSync(backupRoot)
			.map((entry) => join(backupRoot, entry))
			.filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, "manifest.json")))
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
	}

	private removeCurrentAgentCreatedSkills(): void {
		for (const status of this.status()) {
			const root = dirname(status.location);
			if (status.pinned) continue;
			rmSync(root, { recursive: true, force: true });
		}
	}

	private restoreBackupGroup(sourceRoot: string, destinationRoot: string): number {
		if (!existsSync(sourceRoot)) return 0;
		mkdirSync(destinationRoot, { recursive: true });
		let restored = 0;
		for (const entry of readdirSync(sourceRoot)) {
			const source = join(sourceRoot, entry);
			if (!statSync(source).isDirectory()) continue;
			cpSync(source, join(destinationRoot, entry), { recursive: true });
			restored += 1;
		}
		return restored;
	}

	private toStatus(
		name: string,
		location: string,
		usage: SkillUsageRecord | undefined,
		archived: boolean,
	): CuratedSkillStatus {
		const idleDays = usage ? daysSince(usage.lastUsedAt ?? usage.updatedAt ?? usage.createdAt) : undefined;
		const pinned = usage?.pinned === true;
		const state = archived
			? "archived"
			: pinned
				? "pinned"
				: (idleDays ?? 0) >= this.policy.staleAfterDays
					? "stale"
					: "active";
		return {
			name,
			location,
			state,
			pinned,
			createdAt: usage?.createdAt,
			updatedAt: usage?.updatedAt,
			lastUsedAt: usage?.lastUsedAt,
			useCount: usage?.useCount ?? 0,
			viewCount: usage?.viewCount ?? 0,
			patchCount: usage?.patchCount ?? 0,
			idleDays,
			archivedAt: usage?.archivedAt,
		};
	}

	private buildConsolidationSkillContext(activeSkills: CuratedSkillStatus[]): string {
		if (activeSkills.length === 0) {
			return "<skill-library>\nNo active agent-created skills.\n</skill-library>";
		}

		const lines = activeSkills.map((s) => {
			const flags = [
				s.pinned ? "pinned=yes" : "pinned=no",
				`use=${s.useCount}`,
				`idle=${s.idleDays ?? "?"} days`,
			].join(", ");
			return `- ${s.name} (${flags})`;
		});

		const bodies: string[] = [];
		let budget = 16_000;
		for (const skill of activeSkills) {
			if (budget <= 0) break;
			try {
				const content = readFileSync(skill.location, "utf-8");
				const clipped = content.length > 2_500 ? `${content.slice(0, 2_500)}\n... [truncated]` : content;
				budget -= clipped.length;
				bodies.push(
					`<skill name="${skill.name}" state="${skill.state}" idle="${skill.idleDays ?? "?"}d">\n${clipped}\n</skill>`,
				);
			} catch {
				// Ignore unreadable skills.
			}
		}

		return [
			"<skill-library>",
			`${activeSkills.length} active agent-created skills to consolidate:`,
			...lines,
			bodies.length > 0 ? "\n<skill-bodies>" : "",
			...bodies,
			bodies.length > 0 ? "</skill-bodies>" : "",
			"</skill-library>",
		]
			.filter(Boolean)
			.join("\n");
	}

	private stateFilePath(): string {
		return join(this.manager.userSkillsDir, ".curator_state");
	}

	private loadState(): CuratorState {
		const path = this.stateFilePath();
		if (!existsSync(path)) return defaultCuratorState();
		try {
			const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<CuratorState>;
			return { ...defaultCuratorState(), ...data };
		} catch {
			return defaultCuratorState();
		}
	}

	private saveState(state: CuratorState): void {
		const path = this.stateFilePath();
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
		} catch {
			// Ignore state write failures — not critical.
		}
	}
}

// ---------------------------------------------------------------------------
// Standalone helpers
// ---------------------------------------------------------------------------

function daysSince(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const time = Date.parse(value);
	if (!Number.isFinite(time)) return undefined;
	return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function readSkillName(skillFile: string, fallback: string): string {
	const content = readFileSync(skillFile, "utf-8");
	if (content.startsWith("---\n")) {
		const end = content.indexOf("\n---", 4);
		if (end !== -1) {
			try {
				const frontmatter = parseYaml(content.slice(4, end)) as Record<string, unknown>;
				if (typeof frontmatter.name === "string") return frontmatter.name;
			} catch {
				// Fall through to directory-derived fallback.
			}
		}
	}
	return basename(fallback).replace(/-\d+$/u, "");
}

function createRouterModel(id: string): Model<any> {
	return {
		id,
		name: `Router ${id}`,
		provider: PIE_LAB_ROUTER_PROVIDER,
		api: PIE_LAB_ROUTER_PROVIDER as any,
		baseUrl: "",
		input: ["text"],
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8192,
	};
}

async function runConsolidationModelTurn(
	streamFn: StreamFn,
	model: Model<any>,
	context: {
		systemPrompt: string;
		messages: Message[];
		tools: { name: string; description: string; parameters: any }[];
	},
): Promise<AssistantMessage> {
	const stream = await Promise.resolve(streamFn(model, context));
	let message: AssistantMessage | undefined;
	for await (const event of stream) {
		if (event.type === "done") {
			message = event.message;
		} else if (event.type === "error") {
			throw new Error(event.error?.errorMessage ?? "Consolidation model error.");
		}
	}
	if (!message) throw new Error("Consolidation model returned no message.");
	return message;
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function createToolResult(toolCall: ToolCall, text: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
	};
}

function isMutatingSkillCall(toolCall: ToolCall): boolean {
	if (toolCall.name !== "skill_manage") return false;
	const action = (toolCall.arguments as any)?.action;
	return action !== undefined && action !== "list";
}

/**
 * Parse the structured YAML summary from the curator's final response.
 *
 * Expected format:
 * ```yaml
 * consolidations:
 *   - from: <old-skill-name>
 *     into: <umbrella-skill-name>
 *     reason: <why merged>
 * prunings:
 *   - name: <skill-name>
 *     reason: <why archived with no merge target>
 * ```
 */
function parseStructuredSummary(output: string): {
	consolidations: ConsolidationEntry[];
	prunings: PruningEntry[];
} {
	const empty = { consolidations: [], prunings: [] };
	if (!output) return empty;

	// Find the ```yaml block under ## Structured summary
	const match = output.match(/```ya?ml\s*\n([\s\S]*?)\n```/i);
	if (!match) return empty;

	try {
		const parsed = parseYaml(match[1]) as {
			consolidations?: Array<{ from?: string; into?: string; reason?: string }>;
			prunings?: Array<{ name?: string; reason?: string }>;
		};

		const consolidations: ConsolidationEntry[] = (parsed?.consolidations ?? [])
			.filter((item) => item?.from && item?.into)
			.map((item) => ({
				from: String(item.from),
				into: String(item.into),
				reason: String(item.reason ?? ""),
			}));

		const prunings: PruningEntry[] = (parsed?.prunings ?? [])
			.filter((item) => item?.name)
			.map((item) => ({
				name: String(item.name),
				reason: String(item.reason ?? ""),
			}));

		return { consolidations, prunings };
	} catch {
		return empty;
	}
}
