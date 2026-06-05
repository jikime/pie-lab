import { computeFileHash, normalizeSnapshotText } from "./format.js";
export class SnapshotStore {
}
const DEFAULT_MAX_PATHS = 30;
const DEFAULT_MAX_VERSIONS_PER_PATH = 4;
export class InMemorySnapshotStore extends SnapshotStore {
    #versions = new Map();
    #maxPaths;
    #maxVersionsPerPath;
    constructor(options = {}) {
        super();
        this.#maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;
        this.#maxVersionsPerPath = options.maxVersionsPerPath ?? DEFAULT_MAX_VERSIONS_PER_PATH;
    }
    head(path) {
        return this.#versions.get(path)?.[0] ?? null;
    }
    byHash(path, hash) {
        const normalizedHash = hash.toUpperCase();
        return this.#versions.get(path)?.find((snapshot) => snapshot.hash === normalizedHash) ?? null;
    }
    record(path, fullText) {
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
        const snapshot = { path, text, hash, recordedAt: Date.now() };
        this.#versions.delete(path);
        this.#versions.set(path, [snapshot, ...history].slice(0, this.#maxVersionsPerPath));
        this.#evictOldestPathIfNeeded();
        return hash;
    }
    invalidate(path) {
        this.#versions.delete(path);
    }
    clear() {
        this.#versions.clear();
    }
    #evictOldestPathIfNeeded() {
        while (this.#versions.size > this.#maxPaths) {
            const oldest = this.#versions.keys().next().value;
            if (oldest === undefined)
                return;
            this.#versions.delete(oldest);
        }
    }
}
//# sourceMappingURL=snapshots.js.map