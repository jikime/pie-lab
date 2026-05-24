import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ReviewAction {
	type: "memory_append" | "user_append" | "skill_create" | "skill_patch" | "skill_edit" | "skill_write_file";
	text?: string;
	name?: string;
	description?: string;
	content?: string;
	oldText?: string;
	newText?: string;
	path?: string;
}

export interface ReviewActionResult {
	action: ReviewAction;
	status: "applied" | "proposed" | "skipped" | "failed";
	reason?: string;
}

export interface LearningReviewRecord {
	id: string;
	createdAt: string;
	model: string;
	mode: "auto" | "suggest" | "off";
	status: "applied" | "proposed" | "skipped" | "failed";
	rawOutput?: string;
	actions: ReviewAction[];
	results: ReviewActionResult[];
	error?: string;
}

export class LearningReviewStore {
	readonly dir: string;

	constructor(options: { agentDir: string }) {
		this.dir = join(options.agentDir, "learning", "reviews");
	}

	list(): LearningReviewRecord[] {
		if (!existsSync(this.dir)) return [];
		return readdirSync(this.dir)
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => this.read(entry.replace(/\.json$/u, "")))
			.filter((record): record is LearningReviewRecord => record !== undefined)
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	read(id: string): LearningReviewRecord | undefined {
		try {
			return JSON.parse(readFileSync(this.pathFor(id), "utf-8")) as LearningReviewRecord;
		} catch {
			return undefined;
		}
	}

	write(record: LearningReviewRecord): LearningReviewRecord {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(this.pathFor(record.id), `${JSON.stringify(record, null, 2)}\n`, "utf-8");
		return record;
	}

	update(id: string, update: (record: LearningReviewRecord) => LearningReviewRecord): LearningReviewRecord {
		const record = this.read(id);
		if (!record) throw new Error(`Learning review not found: ${id}`);
		return this.write(update(record));
	}

	private pathFor(id: string): string {
		return join(this.dir, `${id}.json`);
	}
}

export function createReviewId(date = new Date()): string {
	const stamp = date.toISOString().replace(/[:.]/g, "-");
	const suffix = Math.random().toString(36).slice(2, 8);
	return `review-${stamp}-${suffix}`;
}
