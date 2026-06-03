/**
 * Hash computation for anchor lines
 * Used to validate edit anchors haven't drifted
 */
/**
 * Compute SHA256 hash of a line
 * Used to detect if file has changed since edit was generated
 */
export declare function computeLineHash(line: string): string;
/**
 * Compute hash of content around an anchor for recovery
 * Returns hash, before/after context for fuzzy matching
 */
export declare function computeHashContext(lines: string[], lineIndex: number, contextLines?: number): {
    hash: string;
    before: string[];
    after: string[];
};
/**
 * Quick check if a line is likely at the right location
 * Used before expensive fuzzy matching
 */
export declare function isLikelyMatch(currentLine: string, targetAnchor: string, currentHash?: string, targetHash?: string): boolean;
/**
 * Find best match for anchor in text
 * Uses exact match → hash match → fuzzy match → proximity search
 */
export declare function findAnchorLine(lines: string[], anchor: string, targetHash?: string, nearLine?: number): number | null;
//# sourceMappingURL=hash.d.ts.map