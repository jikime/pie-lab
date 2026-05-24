import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SkillManager, SkillUsageRecord } from "./skill-manager.ts";

export interface SkillCuratorPolicy {
	staleAfterDays: number;
	archiveAfterDays: number;
	autoArchive: boolean;
	backupBeforeRun: boolean;
	pruneAfterDays: number;
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

export const DEFAULT_CURATOR_POLICY: SkillCuratorPolicy = {
	staleAfterDays: 30,
	archiveAfterDays: 90,
	autoArchive: true,
	backupBeforeRun: true,
	pruneAfterDays: 180,
};

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
}

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
