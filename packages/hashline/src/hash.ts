/**
 * Hash computation for anchor lines
 * Used to validate edit anchors haven't drifted
 */

import { createHash } from "crypto";

/**
 * Compute SHA256 hash of a line
 * Used to detect if file has changed since edit was generated
 */
export function computeLineHash(line: string): string {
	return createHash("sha256").update(line).digest("hex").substring(0, 16);
}

/**
 * Compute hash of content around an anchor for recovery
 * Returns hash, before/after context for fuzzy matching
 */
export function computeHashContext(
	lines: string[],
	lineIndex: number,
	contextLines: number = 2,
): { hash: string; before: string[]; after: string[] } {
	const beforeStart = Math.max(0, lineIndex - contextLines);
	const afterEnd = Math.min(lines.length, lineIndex + contextLines + 1);

	const before = lines.slice(beforeStart, lineIndex);
	const after = lines.slice(lineIndex + 1, afterEnd);
	const hash = computeLineHash(lines[lineIndex]);

	return { hash, before, after };
}

/**
 * Quick check if a line is likely at the right location
 * Used before expensive fuzzy matching
 */
export function isLikelyMatch(
	currentLine: string,
	targetAnchor: string,
	currentHash?: string,
	targetHash?: string,
): boolean {
	// Exact match
	if (currentLine === targetAnchor) return true;

	// Hash match (if both provided)
	if (currentHash && targetHash && currentHash === targetHash) return true;

	// Fuzzy match: first 50 chars match
	if (currentLine.substring(0, 50) === targetAnchor.substring(0, 50)) return true;

	return false;
}

/**
 * Find best match for anchor in text
 * Uses exact match → hash match → fuzzy match → proximity search
 */
export function findAnchorLine(
	lines: string[],
	anchor: string,
	targetHash?: string,
	nearLine?: number,
): number | null {
	// 1. Exact match
	let idx = lines.indexOf(anchor);
	if (idx !== -1) return idx;

	// 2. Hash match (if provided)
	if (targetHash) {
		const targetHashShort = targetHash.substring(0, 16);
		for (let i = 0; i < lines.length; i++) {
			if (computeLineHash(lines[i]) === targetHashShort) {
				return i;
			}
		}
	}

	// 3. Fuzzy match (first 50 chars)
	const anchorPrefix = anchor.substring(0, Math.min(50, anchor.length));
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].substring(0, anchorPrefix.length) === anchorPrefix) {
			return i;
		}
	}

	// 4. Proximity search (if near-line hint provided)
	if (nearLine !== undefined) {
		const searchRadius = Math.min(10, lines.length);
		for (let offset = 1; offset <= searchRadius; offset++) {
			const up = nearLine - offset;
			const down = nearLine + offset;

			if (up >= 0 && lines[up] === anchor) return up;
			if (down < lines.length && lines[down] === anchor) return down;
		}
	}

	return null;
}
