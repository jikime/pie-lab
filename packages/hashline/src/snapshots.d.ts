export interface Snapshot {
    readonly path: string;
    readonly text: string;
    readonly hash: string;
    recordedAt: number;
}
export declare abstract class SnapshotStore {
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
export declare class InMemorySnapshotStore extends SnapshotStore {
    #private;
    constructor(options?: InMemorySnapshotStoreOptions);
    head(path: string): Snapshot | null;
    byHash(path: string, hash: string): Snapshot | null;
    record(path: string, fullText: string): string;
    invalidate(path: string): void;
    clear(): void;
}
//# sourceMappingURL=snapshots.d.ts.map