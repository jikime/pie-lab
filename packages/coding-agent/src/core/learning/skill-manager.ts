import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface SkillSummary {
	name: string;
	description: string;
	location: string;
	source: "user" | "project";
	createdBy?: "agent" | "user";
}

export interface SkillManagerOptions {
	agentDir: string;
	cwd: string;
}

export interface SkillUsageRecord {
	createdBy: "agent" | "user";
	createdAt: string;
	updatedAt: string;
	lastUsedAt?: string;
	lastViewedAt?: string;
	useCount?: number;
	viewCount?: number;
	patchCount?: number;
	pinned?: boolean;
	archivedAt?: string;
	restoredAt?: string;
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,80}$/;

export class SkillManager {
	readonly userSkillsDir: string;
	readonly projectSkillsDir: string;

	constructor(options: SkillManagerOptions) {
		this.userSkillsDir = join(options.agentDir, "skills");
		this.projectSkillsDir = join(options.cwd, ".pie", "skills");
	}

	list(): SkillSummary[] {
		return [...this.listDir(this.userSkillsDir, "user"), ...this.listDir(this.projectSkillsDir, "project")].sort(
			(a, b) => a.name.localeCompare(b.name),
		);
	}

	view(nameOrPath: string): string {
		const path = this.resolveManagedPath(nameOrPath);
		const skillRoot = this.findSkillRoot(path);
		if (skillRoot) {
			this.recordView(skillRoot);
		}
		return readFileSync(path, "utf-8");
	}

	create(name: string, content: string, description?: string): SkillSummary {
		validateSkillName(name);
		const dir = join(this.userSkillsDir, name);
		if (existsSync(dir)) {
			throw new Error(`Skill already exists: ${name}`);
		}
		mkdirSync(dir, { recursive: true });
		const body = ensureSkillFrontmatter(content, name, description);
		writeFileSync(join(dir, "SKILL.md"), body, "utf-8");
		this.writeUsage(dir, {
			createdBy: "agent",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		});
		return this.summaryFromSkillFile(join(dir, "SKILL.md"), "user")!;
	}

	patch(name: string, oldText: string, newText: string): SkillSummary {
		const file = this.resolveSkillFile(name);
		const current = readFileSync(file, "utf-8");
		if (!current.includes(oldText)) {
			throw new Error("Patch failed: oldText was not found.");
		}
		writeFileSync(file, current.replace(oldText, newText), "utf-8");
		this.touchUsage(dirname(file), (usage) => ({
			...usage,
			patchCount: (usage.patchCount ?? 0) + 1,
		}));
		return this.summaryFromSkillFile(file, "user")!;
	}

	edit(name: string, content: string): SkillSummary {
		const file = this.resolveSkillFile(name);
		writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf-8");
		this.touchUsage(dirname(file), (usage) => ({
			...usage,
			patchCount: (usage.patchCount ?? 0) + 1,
		}));
		return this.summaryFromSkillFile(file, "user")!;
	}

	writeFile(skillName: string, relativePath: string, content: string): string {
		const root = dirname(this.resolveSkillFile(skillName));
		const target = resolveInside(root, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, "utf-8");
		this.touchUsage(root, (usage) => ({
			...usage,
			patchCount: (usage.patchCount ?? 0) + 1,
		}));
		return target;
	}

	removeFile(skillName: string, relativePath: string): string {
		const root = dirname(this.resolveSkillFile(skillName));
		const target = resolveInside(root, relativePath);
		if (target.endsWith(`${sep}SKILL.md`) || basename(target) === "SKILL.md") {
			throw new Error("Use archive/delete for SKILL.md instead of remove_file.");
		}
		rmSync(target, { force: true, recursive: false });
		this.touchUsage(root, (usage) => ({
			...usage,
			patchCount: (usage.patchCount ?? 0) + 1,
		}));
		return target;
	}

	archive(name: string): string {
		const file = this.resolveSkillFile(name);
		const root = dirname(file);
		const usage = this.readUsage(root);
		if (usage?.createdBy !== "agent") {
			throw new Error("Only agent-created skills can be archived automatically.");
		}
		if (usage.pinned) {
			throw new Error("Pinned skills cannot be archived.");
		}
		this.writeUsage(root, { ...usage, updatedAt: new Date().toISOString(), archivedAt: new Date().toISOString() });
		const archiveRoot = join(this.userSkillsDir, ".archive");
		mkdirSync(archiveRoot, { recursive: true });
		const target = join(archiveRoot, `${basename(root)}-${Date.now()}`);
		renameSync(root, target);
		return target;
	}

	restore(name: string): string {
		validateSkillName(name);
		const activeRoot = join(this.userSkillsDir, name);
		if (existsSync(activeRoot)) {
			throw new Error(`Skill already exists: ${name}`);
		}
		const archiveRoot = join(this.userSkillsDir, ".archive");
		if (!existsSync(archiveRoot)) {
			throw new Error(`Archived skill not found: ${name}`);
		}
		const archived = readdirSync(archiveRoot)
			.filter((entry) => entry === name || entry.startsWith(`${name}-`))
			.map((entry) => join(archiveRoot, entry))
			.filter((entry) => statSync(entry).isDirectory())
			.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
		if (!archived) {
			throw new Error(`Archived skill not found: ${name}`);
		}
		renameSync(archived, activeRoot);
		this.touchUsage(activeRoot, (usage) => ({
			...usage,
			archivedAt: undefined,
			restoredAt: new Date().toISOString(),
		}));
		return activeRoot;
	}

	setPinned(name: string, pinned: boolean): SkillUsageRecord {
		const root = dirname(this.resolveSkillFile(name));
		const usage = this.readUsage(root);
		if (usage?.createdBy !== "agent") {
			throw new Error("Only agent-created skills can be pinned by curator.");
		}
		const next = { ...usage, pinned, updatedAt: new Date().toISOString() };
		this.writeUsage(root, next);
		return next;
	}

	recordUseByPath(filePath: string): void {
		const skillRoot = this.findSkillRoot(filePath);
		if (skillRoot) {
			this.recordUse(skillRoot);
		}
	}

	readUsageForSkill(name: string): SkillUsageRecord | undefined {
		const root = dirname(this.resolveSkillFile(name));
		return this.readUsage(root);
	}

	readUsageForRoot(root: string): SkillUsageRecord | undefined {
		return this.readUsage(root);
	}

	private listDir(dir: string, source: "user" | "project"): SkillSummary[] {
		if (!existsSync(dir)) return [];
		const summaries: SkillSummary[] = [];
		for (const entry of readdirSync(dir)) {
			if (entry === ".archive") continue;
			const path = join(dir, entry);
			const stats = statSync(path);
			const skillFile = stats.isDirectory() ? join(path, "SKILL.md") : path.endsWith(".md") ? path : undefined;
			if (skillFile && existsSync(skillFile)) {
				const summary = this.summaryFromSkillFile(skillFile, source);
				if (summary) summaries.push(summary);
			}
		}
		return summaries;
	}

	private summaryFromSkillFile(file: string, source: "user" | "project"): SkillSummary | undefined {
		const content = readFileSync(file, "utf-8");
		const frontmatter = readFrontmatter(content);
		const name = typeof frontmatter.name === "string" ? frontmatter.name : basename(dirname(file));
		const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
		const usage = this.readUsage(dirname(file));
		return { name, description, location: file, source, createdBy: usage?.createdBy };
	}

	private resolveSkillFile(name: string): string {
		validateSkillName(name);
		const file = join(this.userSkillsDir, name, "SKILL.md");
		if (!existsSync(file)) {
			throw new Error(`Managed skill not found: ${name}`);
		}
		return file;
	}

	private resolveManagedPath(nameOrPath: string): string {
		if (SKILL_NAME_PATTERN.test(nameOrPath)) {
			return this.resolveSkillFile(nameOrPath);
		}
		const userRoot = resolve(this.userSkillsDir);
		const projectRoot = resolve(this.projectSkillsDir);
		const target = resolve(nameOrPath);
		if (!isInside(target, userRoot) && !isInside(target, projectRoot)) {
			throw new Error("Skill path must stay inside user or project skill directories.");
		}
		return target;
	}

	private usagePath(root: string): string {
		return join(root, ".usage.json");
	}

	private readUsage(root: string): SkillUsageRecord | undefined {
		try {
			return JSON.parse(readFileSync(this.usagePath(root), "utf-8")) as SkillUsageRecord;
		} catch {
			return undefined;
		}
	}

	private writeUsage(root: string, usage: SkillUsageRecord): void {
		writeFileSync(this.usagePath(root), `${JSON.stringify(usage, null, 2)}\n`, "utf-8");
	}

	private touchUsage(root: string, update?: (usage: SkillUsageRecord) => SkillUsageRecord): void {
		const usage = this.readUsage(root);
		if (!usage) return;
		const next = update ? update(usage) : usage;
		this.writeUsage(root, { ...next, updatedAt: new Date().toISOString() });
	}

	private recordUse(root: string): void {
		this.touchUsage(root, (usage) => ({
			...usage,
			lastUsedAt: new Date().toISOString(),
			useCount: (usage.useCount ?? 0) + 1,
		}));
	}

	private recordView(root: string): void {
		this.touchUsage(root, (usage) => ({
			...usage,
			lastViewedAt: new Date().toISOString(),
			viewCount: (usage.viewCount ?? 0) + 1,
		}));
	}

	private findSkillRoot(path: string): string | undefined {
		let current = statSync(path).isDirectory() ? path : dirname(path);
		const userRoot = resolve(this.userSkillsDir);
		const projectRoot = resolve(this.projectSkillsDir);
		while (isInside(resolve(current), userRoot) || isInside(resolve(current), projectRoot)) {
			if (existsSync(join(current, "SKILL.md"))) return current;
			const parent = dirname(current);
			if (parent === current) return undefined;
			current = parent;
		}
		return undefined;
	}
}

function validateSkillName(name: string): void {
	if (!SKILL_NAME_PATTERN.test(name)) {
		throw new Error("Skill name must be lowercase kebab-case and class-level, e.g. router-integration-debugging.");
	}
}

function resolveInside(root: string, input: string): string {
	const target = resolve(root, input);
	if (!isInside(target, resolve(root))) {
		throw new Error("Path traversal is not allowed.");
	}
	return target;
}

function isInside(target: string, root: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readFrontmatter(content: string): Record<string, unknown> {
	if (!content.startsWith("---\n")) return {};
	const end = content.indexOf("\n---", 4);
	if (end === -1) return {};
	try {
		return parseYaml(content.slice(4, end)) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function ensureSkillFrontmatter(content: string, name: string, description?: string): string {
	const trimmed = content.trim();
	if (trimmed.startsWith("---\n")) return `${trimmed}\n`;
	const frontmatter = stringifyYaml({
		name,
		description: description ?? "Reusable workflow captured by Pie learning loop.",
	});
	return `---\n${frontmatter}---\n\n${trimmed}\n`;
}
