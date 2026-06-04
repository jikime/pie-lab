import { computeFileHash, normalizeSnapshotText } from "./format.ts";

export interface Snapshot {
	readonly path: string;
	readonly text: string;
	readonly hash: string;
	recordedAt: number;
}

export abstract class SnapshotStore {
	abstract head(path: string): Snapshot | null;
	abstract byHash(path: string, hash: string): Snapshot | null;
	abstract record(path: string, fullText: string): string;
	abstract invalidate(path: string): void;
	abstract clear(): void;
}

export interface InMemorySnapshotStoreOptions {
	maxPaths?: number;
	maxVersionsPerPath?: number;
}

const DEFAULT_MAX_PATHS = 30;
const DEFAULT_MAX_VERSIONS_PER_PATH = 4;

export class InMemorySnapshotStore extends SnapshotStore {
	readonly #versions = new Map<string, Snapshot[]>();
	readonly #maxPaths: number;
	readonly #maxVersionsPerPath: number;

	constructor(options: InMemorySnapshotStoreOptions = {}) {
		super();
		this.#maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
		this.#maxVersionsPerPath = options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS_PER_PATH;
	}

	head(path: string): Snapshot | null {
		return this.#versions.get(path)?.[0] ?? null;
	}

	byHash(path: string, hash: string): Snapshot | null {
		const normalizedHash = hash.toUpperCase();
		return this.#versions.get(path)?.find((snapshot) => snapshot.hash === normalizedHash) ?? null;
	}

	record(path: string, fullText: string): string {
		const text = normalizeSnapshotText(fullText);
		const hash = computeFileHash(text);
		const history = this.#versions.get(path) ?? [];
		const existing = history.find((snapshot) => snapshot.hash === hash);
		if (existing) {
			existing.recordedAt = Date.now();
			this.#versions.delete(path);
			this.#versions.set(path, [existing, ...history.filter((snapshot) => snapshot !== existing)]);
			return hash;
		}

		const snapshot: Snapshot = { path, text, hash, recordedAt: Date.now() };
		this.#versions.delete(path);
		this.#versions.set(path, [snapshot, ...history].slice(0, this.#maxVersionsPerPath));
		this.#evictOldestPathIfNeeded();
		return hash;
	}

	invalidate(path: string): void {
		this.#versions.delete(path);
	}

	clear(): void {
		this.#versions.clear();
	}

	#evictOldestPathIfNeeded(): void {
		while (this.#versions.size > this.#maxPaths) {
			const oldest = this.#versions.keys().next().value;
			if (oldest === undefined) return;
			this.#versions.delete(oldest);
		}
	}
}
