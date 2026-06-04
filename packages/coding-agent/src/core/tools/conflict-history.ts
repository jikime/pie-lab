import { type ConflictMarker, detectMergeConflicts } from "@pie-lab/hashline";
import { readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";

export interface ConflictEntry {
	id: string;
	path: string;
	lineStart: number;
	lineEnd: number;
	ours: string[];
	theirs: string[];
	base: string[];
	markerText: string;
}

export class ConflictHistory {
	#nextId = 1;
	readonly #entries = new Map<string, ConflictEntry>();

	register(path: string, content: string): ConflictEntry[] {
		const result = detectMergeConflicts(content);
		if (!result.hasConflicts) return [];

		const entries: ConflictEntry[] = [];
		for (const conflict of result.conflicts) {
			const existing = this.#findExisting(path, conflict);
			if (existing) {
				entries.push(existing);
				continue;
			}

			const id = String(this.#nextId++);
			const entry: ConflictEntry = {
				id,
				path,
				lineStart: conflict.lineStart,
				lineEnd: conflict.lineEnd,
				ours: conflict.ours,
				theirs: conflict.theirs,
				base: conflict.base,
				markerText: result.lines.slice(conflict.lineStart, conflict.lineEnd + 1).join("\n"),
			};
			this.#entries.set(id, entry);
			entries.push(entry);
		}
		return entries;
	}

	get(id: string): ConflictEntry | undefined {
		return this.#entries.get(id);
	}

	invalidate(id: string): void {
		this.#entries.delete(id);
	}

	clearPath(path: string): void {
		for (const [id, entry] of this.#entries) {
			if (entry.path === path) this.#entries.delete(id);
		}
	}

	render(id: string): string | null {
		const entry = this.get(id);
		if (!entry) return null;
		return [
			`[Conflict: ${entry.id}]`,
			`Path: ${entry.path}`,
			`Lines: ${entry.lineStart + 1}-${entry.lineEnd + 1}`,
			"",
			entry.markerText,
		].join("\n");
	}

	async resolve(id: string, content: string): Promise<string> {
		const entry = this.get(id);
		if (!entry) {
			throw new Error(`Unknown conflict id: ${id}`);
		}

		const current = await fsReadFile(entry.path, "utf-8");
		const lines = current.split("\n");
		const currentMarker = lines.slice(entry.lineStart, entry.lineEnd + 1).join("\n");
		if (currentMarker !== entry.markerText) {
			throw new Error(`Conflict ${id} no longer matches ${entry.path}. Re-read conflicts before resolving.`);
		}

		const replacement = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		lines.splice(entry.lineStart, entry.lineEnd - entry.lineStart + 1, ...replacement);
		const resolved = lines.join("\n");
		await fsWriteFile(entry.path, resolved, "utf-8");
		this.clearPath(entry.path);
		return entry.path;
	}

	#findExisting(path: string, conflict: ConflictMarker): ConflictEntry | undefined {
		for (const entry of this.#entries.values()) {
			if (
				entry.path === path &&
				entry.lineStart === conflict.lineStart &&
				entry.lineEnd === conflict.lineEnd &&
				entry.ours.join("\n") === conflict.ours.join("\n") &&
				entry.theirs.join("\n") === conflict.theirs.join("\n")
			) {
				return entry;
			}
		}
		return undefined;
	}
}
