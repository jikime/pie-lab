/**
 * Conflict detection and resolution for three-way merges
 */
export interface ConflictMarker {
    lineStart: number;
    lineEnd: number;
    ours: string[];
    theirs: string[];
    base: string[];
}
export interface ConflictDetectionResult {
    hasConflicts: boolean;
    conflicts: ConflictMarker[];
    lines: string[];
}
/**
 * Detect merge conflict markers in content
 * Looks for standard git merge markers: <<<<<<<, =======, >>>>>>>
 */
export declare function detectMergeConflicts(content: string): ConflictDetectionResult;
/**
 * Simple conflict resolution strategy: take "ours" by default
 */
export declare function resolveConflicts(content: string, strategy?: "ours" | "theirs"): string;
/**
 * Detect semantic conflicts (non-overlapping line edits)
 * Returns pairs of edits that touch nearby lines
 */
export interface LineEdit {
    startLine: number;
    endLine: number;
    newContent: string[];
}
export declare function detectSemanticConflicts(edits: LineEdit[], contextLines?: number): LineEdit[][];
/**
 * Check if two text ranges would conflict in a merge
 */
export declare function wouldConflict(_baseStart: number, _baseEnd: number, change1Start: number, change1End: number, change2Start: number, change2End: number): boolean;
/**
 * Simple 3-way merge
 * Merges changes from two versions against a base
 */
export interface MergeResult {
    merged: string;
    conflicts: ConflictMarker[];
    hasConflicts: boolean;
}
export declare function threeWayMerge(base: string, ours: string, theirs: string): MergeResult;
//# sourceMappingURL=conflict.d.ts.map