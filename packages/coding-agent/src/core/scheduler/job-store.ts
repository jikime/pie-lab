import { randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import lockfile from "proper-lockfile";
import { assertSafeCronPrompt } from "./prompt-scan.ts";
import {
	computeGraceWindowSeconds,
	computeNextRun,
	parseSchedule,
	type ScheduleKind,
	validateTimezone,
} from "./schedule.ts";

export type CronJobStatus = "pending" | "running" | "success" | "failed" | "silent" | "paused" | "completed";

export interface CronJobModelRef {
	provider?: string;
	id?: string;
}

export interface CronJob {
	id: string;
	name: string;
	prompt: string;
	schedule: string;
	scheduleDisplay: string;
	kind: ScheduleKind;
	repeat: boolean;
	/** Stop after this many runs (repeating jobs only). */
	repeatTimes?: number;
	/** How many times this job has run so far. */
	completedRuns?: number;
	intervalMs?: number;
	cronExpression?: string;
	enabled: boolean;
	state: CronJobStatus;
	createdAt: string;
	updatedAt: string;
	nextRunAt?: string;
	lastRunAt?: string;
	lastStatus?: CronJobStatus;
	lastError?: string;
	lastDeliveryError?: string;
	lastOutputPath?: string;
	deliver: string;
	origin?: string;
	script?: string;
	noAgent?: boolean;
	contextFrom?: string[];
	/** Skills loaded into the job prompt at fire time. */
	skills?: string[];
	tools?: string[];
	workdir?: string;
	model?: CronJobModelRef;
	timezone?: string;
}

export interface CreateCronJobInput {
	name: string;
	prompt: string;
	schedule: string;
	repeat?: boolean;
	repeatTimes?: number;
	deliver?: string;
	origin?: string;
	script?: string;
	noAgent?: boolean;
	contextFrom?: string[];
	skills?: string[];
	tools?: string[];
	workdir?: string;
	model?: CronJobModelRef;
	timezone?: string;
}

export interface UpdateCronJobInput {
	name?: string;
	prompt?: string;
	schedule?: string;
	repeat?: boolean;
	repeatTimes?: number | null;
	deliver?: string;
	origin?: string;
	script?: string | null;
	noAgent?: boolean;
	contextFrom?: string[] | null;
	skills?: string[] | null;
	tools?: string[] | null;
	workdir?: string | null;
	model?: CronJobModelRef | null;
	enabled?: boolean;
	timezone?: string | null;
}

interface JobsFile {
	version: 1;
	jobs: CronJob[];
}

export interface CronJobStoreOptions {
	agentDir: string;
	cwd?: string;
}

const JOB_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/;

async function secureDir(path: string): Promise<void> {
	if (process.platform === "win32") return;
	await chmod(path, 0o700).catch(() => undefined);
}

async function secureFile(path: string): Promise<void> {
	if (process.platform === "win32") return;
	await chmod(path, 0o600).catch(() => undefined);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

function normalizeName(value: string): string {
	const name = value.trim();
	if (!name) throw new Error("name is required.");
	if (name.length > 120) throw new Error("name must be 120 characters or fewer.");
	return name;
}

function normalizePrompt(value: string): string {
	const prompt = value.trim();
	if (!prompt) throw new Error("prompt is required.");
	if (prompt.length > 50_000) throw new Error("prompt is too long for a scheduled job.");
	return prompt;
}

function normalizeStringList(value: string[] | undefined | null): string[] | undefined {
	if (!value) return undefined;
	const result = value.map((item) => item.trim()).filter(Boolean);
	return result.length > 0 ? Array.from(new Set(result)) : undefined;
}

function normalizeDeliver(value: string | undefined | null): string {
	const deliver = value?.trim() || "local";
	const parts = deliver
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts.join(",") : "local";
}

function normalizeWorkdir(value: string | undefined | null, cwd: string | undefined): string | undefined {
	if (value === null || value === undefined || value.trim() === "") return undefined;
	const base = cwd ?? process.cwd();
	return resolve(base, value);
}

function assertRelativeSafePath(path: string, label: string): string {
	const trimmed = path.trim();
	if (!trimmed) throw new Error(`${label} is required.`);
	if (isAbsolute(trimmed) || trimmed.startsWith("~")) {
		throw new Error(`${label} must be relative to ~/.pie/agent/scripts.`);
	}
	const normalized = normalize(trimmed);
	if (normalized === ".." || normalized.startsWith(`..${sep}`) || normalized.includes(`${sep}..${sep}`)) {
		throw new Error(`${label} cannot contain path traversal.`);
	}
	return normalized;
}

function normalizeRepeatTimes(value: number | undefined | null): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error("repeatTimes must be a positive integer.");
	}
	return value;
}

export class CronJobStore {
	readonly cronDir: string;
	readonly jobsFile: string;
	readonly outputDir: string;
	readonly scriptsDir: string;
	private readonly cwd?: string;

	constructor(options: CronJobStoreOptions) {
		this.cronDir = join(options.agentDir, "cron");
		this.jobsFile = join(this.cronDir, "jobs.json");
		this.outputDir = join(this.cronDir, "output");
		this.scriptsDir = join(options.agentDir, "scripts");
		this.cwd = options.cwd;
	}

	async ensure(): Promise<void> {
		await mkdir(this.cronDir, { recursive: true });
		await mkdir(this.outputDir, { recursive: true });
		await mkdir(this.scriptsDir, { recursive: true });
		await secureDir(this.cronDir);
		await secureDir(this.outputDir);
		await secureDir(this.scriptsDir);
		if (!(await pathExists(this.jobsFile))) {
			await this.writeJobsFile({ version: 1, jobs: [] });
		}
	}

	async list(): Promise<CronJob[]> {
		return this.withLock(async () => (await this.readJobsFile()).jobs);
	}

	async get(idOrName: string): Promise<CronJob | undefined> {
		return this.withLock(async () => this.resolveJob((await this.readJobsFile()).jobs, idOrName));
	}

	async create(input: CreateCronJobInput): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const name = normalizeName(input.name);
			if (file.jobs.some((job) => job.name === name)) {
				throw new Error(`Scheduled job already exists: ${name}`);
			}
			const prompt = normalizePrompt(input.prompt);
			assertSafeCronPrompt(prompt);
			const timezone = input.timezone ? validateTimezone(input.timezone) : undefined;
			const parsed = parseSchedule(input.schedule, { forceRepeat: input.repeat, timezone });
			const now = new Date().toISOString();
			if (input.script) assertRelativeSafePath(input.script, "script");
			if (input.noAgent && !input.script) {
				throw new Error("noAgent jobs require a script.");
			}
			const repeatTimes = normalizeRepeatTimes(input.repeatTimes);
			if (repeatTimes !== undefined && !parsed.repeat) {
				throw new Error("repeatTimes requires a repeating schedule.");
			}
			const job: CronJob = {
				id: this.createJobId(name, file.jobs),
				name,
				prompt,
				schedule: parsed.schedule,
				scheduleDisplay: parsed.scheduleDisplay,
				kind: parsed.kind,
				repeat: parsed.repeat,
				repeatTimes,
				intervalMs: parsed.intervalMs,
				cronExpression: parsed.cronExpression,
				enabled: true,
				state: "pending",
				createdAt: now,
				updatedAt: now,
				nextRunAt: parsed.nextRunAt,
				deliver: normalizeDeliver(input.deliver),
				origin: input.origin,
				script: input.script ? assertRelativeSafePath(input.script, "script") : undefined,
				noAgent: input.noAgent === true,
				contextFrom: normalizeStringList(input.contextFrom),
				skills: normalizeStringList(input.skills),
				tools: normalizeStringList(input.tools),
				workdir: normalizeWorkdir(input.workdir, this.cwd),
				model: input.model,
				timezone,
			};
			file.jobs.push(job);
			await this.writeJobsFile(file);
			return job;
		});
	}

	async update(idOrName: string, input: UpdateCronJobInput): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = this.resolveJobIndex(file.jobs, idOrName);
			const current = file.jobs[index];
			const next: CronJob = { ...current, updatedAt: new Date().toISOString() };

			if (input.name !== undefined) {
				const name = normalizeName(input.name);
				if (file.jobs.some((job) => job.id !== current.id && job.name === name)) {
					throw new Error(`Scheduled job already exists: ${name}`);
				}
				next.name = name;
			}
			if (input.prompt !== undefined) {
				next.prompt = normalizePrompt(input.prompt);
				assertSafeCronPrompt(next.prompt);
			}
			if (input.timezone !== undefined) {
				next.timezone = input.timezone === null ? undefined : validateTimezone(input.timezone);
			}
			if (input.schedule !== undefined || input.repeat !== undefined || input.timezone !== undefined) {
				const parsed = parseSchedule(input.schedule ?? current.schedule, {
					forceRepeat: input.repeat ?? current.repeat,
					timezone: next.timezone,
				});
				next.schedule = parsed.schedule;
				next.scheduleDisplay = parsed.scheduleDisplay;
				next.kind = parsed.kind;
				next.repeat = parsed.repeat;
				next.intervalMs = parsed.intervalMs;
				next.cronExpression = parsed.cronExpression;
				next.nextRunAt = parsed.nextRunAt;
				next.state = "pending";
			}
			if (input.enabled !== undefined) {
				next.enabled = input.enabled;
				next.state = input.enabled ? "pending" : "paused";
				if (input.enabled && !next.nextRunAt) {
					next.nextRunAt = computeNextRun(next, new Date()) ?? new Date().toISOString();
				}
			}
			if (input.deliver !== undefined) next.deliver = normalizeDeliver(input.deliver);
			if (input.origin !== undefined) next.origin = input.origin;
			if (input.script !== undefined) {
				next.script = input.script === null ? undefined : assertRelativeSafePath(input.script, "script");
			}
			if (input.noAgent !== undefined) next.noAgent = input.noAgent;
			if (next.noAgent && !next.script) throw new Error("noAgent jobs require a script.");
			if (input.repeatTimes !== undefined) next.repeatTimes = normalizeRepeatTimes(input.repeatTimes);
			if (next.repeatTimes !== undefined && !next.repeat) {
				throw new Error("repeatTimes requires a repeating schedule.");
			}
			if (input.contextFrom !== undefined) next.contextFrom = normalizeStringList(input.contextFrom);
			if (input.skills !== undefined) next.skills = normalizeStringList(input.skills);
			if (input.tools !== undefined) next.tools = normalizeStringList(input.tools);
			if (input.workdir !== undefined) next.workdir = normalizeWorkdir(input.workdir, this.cwd);
			if (input.model !== undefined) next.model = input.model ?? undefined;

			file.jobs[index] = next;
			await this.writeJobsFile(file);
			return next;
		});
	}

	async pause(idOrName: string): Promise<CronJob> {
		return this.update(idOrName, { enabled: false });
	}

	async resume(idOrName: string): Promise<CronJob> {
		return this.update(idOrName, { enabled: true });
	}

	async remove(idOrName: string): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = this.resolveJobIndex(file.jobs, idOrName);
			const [removed] = file.jobs.splice(index, 1);
			await this.writeJobsFile(file);
			await rm(join(this.outputDir, removed.id), { recursive: true, force: true });
			return removed;
		});
	}

	async trigger(idOrName: string, now = new Date()): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = this.resolveJobIndex(file.jobs, idOrName);
			const job = {
				...file.jobs[index],
				enabled: true,
				state: "pending" as const,
				nextRunAt: now.toISOString(),
				updatedAt: now.toISOString(),
			};
			file.jobs[index] = job;
			await this.writeJobsFile(file);
			return job;
		});
	}

	async getDueJobs(now = new Date()): Promise<CronJob[]> {
		const time = now.getTime();
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const due: CronJob[] = [];
			let mutated = false;
			for (let i = 0; i < file.jobs.length; i++) {
				const job = file.jobs[i];
				if (!job.enabled || job.state === "running" || !job.nextRunAt) continue;
				const scheduledAt = new Date(job.nextRunAt).getTime();
				if (scheduledAt > time) continue;

				// Grace window — if we're too late, fast-forward instead of running
				const graceMs = computeGraceWindowSeconds(job) * 1000;
				if (time - scheduledAt > graceMs) {
					if (job.repeat) {
						const nextRunAt = computeNextRun(job, now);
						file.jobs[i] = { ...job, nextRunAt, updatedAt: now.toISOString() };
						mutated = true;
					}
					// One-shot missed: leave as pending (will never become due again — caller should reap)
					continue;
				}

				due.push(job);
			}
			if (mutated) await this.writeJobsFile(file);
			return due;
		});
	}

	async claimDueJob(id: string, now = new Date()): Promise<CronJob | undefined> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = file.jobs.findIndex((job) => job.id === id);
			if (index < 0) return undefined;
			const current = file.jobs[index];
			if (!current.enabled || current.state === "running" || !current.nextRunAt) return undefined;
			const scheduledAt = new Date(current.nextRunAt).getTime();
			if (scheduledAt > now.getTime()) return undefined;

			// Grace window double-check (may have elapsed between getDueJobs and claimDueJob)
			const graceMs = computeGraceWindowSeconds(current) * 1000;
			if (now.getTime() - scheduledAt > graceMs) {
				if (current.repeat) {
					const nextRunAt = computeNextRun(current, now);
					file.jobs[index] = { ...current, nextRunAt, updatedAt: now.toISOString() };
					await this.writeJobsFile(file);
				}
				return undefined;
			}

			const nextRunAt = computeNextRun(current, now);
			const claimed: CronJob = {
				...current,
				state: "running",
				enabled: current.repeat,
				nextRunAt,
				updatedAt: now.toISOString(),
			};
			file.jobs[index] = claimed;
			await this.writeJobsFile(file);
			return claimed;
		});
	}

	async markRun(
		id: string,
		result: { status: CronJobStatus; outputPath?: string; error?: string; ranAt?: Date },
	): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = this.resolveJobIndex(file.jobs, id);
			const current = file.jobs[index];
			const completedRuns = (current.completedRuns ?? 0) + 1;
			const reachedRunLimit = current.repeatTimes !== undefined && completedRuns >= current.repeatTimes;
			const finalState: CronJobStatus = reachedRunLimit
				? "completed"
				: current.repeat && current.enabled
					? "pending"
					: result.status;
			const job: CronJob = {
				...current,
				state: finalState,
				enabled: current.enabled && !reachedRunLimit,
				nextRunAt: reachedRunLimit ? undefined : current.nextRunAt,
				completedRuns,
				lastRunAt: (result.ranAt ?? new Date()).toISOString(),
				lastStatus: result.status,
				lastError: result.error,
				lastOutputPath: result.outputPath,
				updatedAt: new Date().toISOString(),
			};
			file.jobs[index] = job;
			await this.writeJobsFile(file);
			return job;
		});
	}

	async markDelivery(id: string, deliveryError?: string): Promise<CronJob> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			const index = this.resolveJobIndex(file.jobs, id);
			const job: CronJob = {
				...file.jobs[index],
				lastDeliveryError: deliveryError,
				updatedAt: new Date().toISOString(),
			};
			file.jobs[index] = job;
			await this.writeJobsFile(file);
			return job;
		});
	}

	/**
	 * Reset jobs stuck in "running" state whose `updatedAt` is older than `timeoutMs`.
	 * Called at scheduler startup to recover from crashed runs.
	 */
	async resetStaleRunning(timeoutMs: number, now = new Date()): Promise<number> {
		return this.withLock(async () => {
			const file = await this.readJobsFile();
			let count = 0;
			const time = now.getTime();
			for (let i = 0; i < file.jobs.length; i++) {
				const job = file.jobs[i];
				if (job.state !== "running") continue;
				const updatedAt = new Date(job.updatedAt).getTime();
				if (time - updatedAt < timeoutMs) continue;
				// Stale — reset to pending or failed
				const nextRunAt = job.repeat ? computeNextRun(job, now) : undefined;
				file.jobs[i] = {
					...job,
					state: job.repeat && job.enabled ? "pending" : "failed",
					nextRunAt,
					lastError: `Job was reset after stale running state (>${Math.round(timeoutMs / 1000)}s).`,
					updatedAt: now.toISOString(),
				};
				count++;
			}
			if (count > 0) await this.writeJobsFile(file);
			return count;
		});
	}

	async saveOutput(jobId: string, output: string, now = new Date()): Promise<string> {
		await this.ensure();
		const dir = join(this.outputDir, jobId);
		await mkdir(dir, { recursive: true });
		await secureDir(dir);
		const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
		const outputPath = join(dir, `${safeTimestamp}.md`);
		const tmpPath = join(dir, `.${safeTimestamp}.${randomUUID()}.tmp`);
		await writeFile(tmpPath, output, "utf-8");
		await secureFile(tmpPath);
		await rename(tmpPath, outputPath);
		await secureFile(outputPath);
		return outputPath;
	}

	async latestOutput(jobId: string): Promise<string | undefined> {
		const dir = join(this.outputDir, jobId);
		try {
			const entries = (await readdir(dir))
				.filter((entry) => entry.endsWith(".md"))
				.sort()
				.reverse();
			if (!entries[0]) return undefined;
			return await readFile(join(dir, entries[0]), "utf-8");
		} catch {
			return undefined;
		}
	}

	async resolveScriptPath(script: string): Promise<string> {
		const safeScript = assertRelativeSafePath(script, "script");
		const root = resolve(this.scriptsDir);
		const candidate = resolve(root, safeScript);
		const rootReal = await realpath(root);
		const candidateReal = await realpath(candidate);
		const rel = relative(rootReal, candidateReal);
		if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
			throw new Error("script escapes ~/.pie/agent/scripts.");
		}
		return candidateReal;
	}

	private async withLock<T>(fn: () => Promise<T>): Promise<T> {
		await this.ensureUnlocked();
		const release = await lockfile.lock(this.cronDir, {
			realpath: false,
			retries: { retries: 10, minTimeout: 20, maxTimeout: 100 },
		});
		try {
			return await fn();
		} finally {
			await release();
		}
	}

	private async ensureUnlocked(): Promise<void> {
		await mkdir(this.cronDir, { recursive: true });
		await mkdir(this.outputDir, { recursive: true });
		await mkdir(this.scriptsDir, { recursive: true });
		await secureDir(this.cronDir);
		await secureDir(this.outputDir);
		await secureDir(this.scriptsDir);
		if (!(await pathExists(this.jobsFile))) {
			await this.writeJobsFile({ version: 1, jobs: [] });
		}
	}

	private async readJobsFile(): Promise<JobsFile> {
		await this.ensureFileOnly();
		const content = await readFile(this.jobsFile, "utf-8");
		try {
			const parsed = JSON.parse(content) as Partial<JobsFile>;
			const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.filter(isCronJobLike) : [];
			return { version: 1, jobs };
		} catch {
			// Corruption recovery: return empty job list to avoid crashing the scheduler
			return { version: 1, jobs: [] };
		}
	}

	private async ensureFileOnly(): Promise<void> {
		if (!(await pathExists(this.jobsFile))) {
			await this.writeJobsFile({ version: 1, jobs: [] });
		}
	}

	private async writeJobsFile(file: JobsFile): Promise<void> {
		await mkdir(this.cronDir, { recursive: true });
		await secureDir(this.cronDir);
		const tmpPath = join(this.cronDir, `.jobs.${randomUUID()}.tmp`);
		await writeFile(tmpPath, JSON.stringify(file, null, 2), "utf-8");
		await secureFile(tmpPath);
		await rename(tmpPath, this.jobsFile);
		await secureFile(this.jobsFile);
	}

	private resolveJob(jobs: CronJob[], idOrName: string): CronJob | undefined {
		return jobs.find((job) => job.id === idOrName || job.name === idOrName);
	}

	private resolveJobIndex(jobs: CronJob[], idOrName: string): number {
		const index = jobs.findIndex((job) => job.id === idOrName || job.name === idOrName);
		if (index < 0) throw new Error(`Scheduled job not found: ${idOrName}`);
		return index;
	}

	private createJobId(name: string, jobs: CronJob[]): string {
		const slug = name
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48);
		const base = JOB_ID_RE.test(slug) ? slug : `job-${randomUUID().slice(0, 8)}`;
		let candidate = base;
		let suffix = 2;
		while (jobs.some((job) => job.id === candidate)) {
			candidate = `${base}-${suffix++}`;
		}
		return candidate;
	}
}

function isCronJobLike(value: unknown): value is CronJob {
	if (typeof value !== "object" || value === null) return false;
	const job = value as Record<string, unknown>;
	return (
		typeof job.id === "string" &&
		typeof job.name === "string" &&
		typeof job.prompt === "string" &&
		typeof job.schedule === "string" &&
		typeof job.scheduleDisplay === "string" &&
		(job.kind === "once" || job.kind === "interval" || job.kind === "cron") &&
		typeof job.repeat === "boolean" &&
		typeof job.enabled === "boolean" &&
		typeof job.state === "string" &&
		typeof job.createdAt === "string"
	);
}
