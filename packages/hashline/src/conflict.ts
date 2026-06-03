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
export function detectMergeConflicts(content: string): ConflictDetectionResult {
	const lines = content.split("\n");
	const conflicts: ConflictMarker[] = [];
	let i = 0;

	while (i < lines.length) {
		// Look for conflict start marker
		if (lines[i].startsWith("<<<<<<<")) {
			const conflictStart = i;
			const ours: string[] = [];
			let separatorLine = -1;
			let theirStart = -1;

			// Collect "ours" section
			i++;
			while (i < lines.length && !lines[i].startsWith("=======")) {
				ours.push(lines[i]);
				i++;
			}

			if (i >= lines.length) {
				// Malformed conflict
				i++;
				continue;
			}

			separatorLine = i;
			const theirs: string[] = [];

			// Collect "theirs" section
			i++;
			while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
				theirs.push(lines[i]);
				i++;
			}

			if (i >= lines.length) {
				// Malformed conflict
				i++;
				continue;
			}

			// Found complete conflict marker
			const conflictEnd = i;
			conflicts.push({
				lineStart: conflictStart,
				lineEnd: conflictEnd,
				ours,
				theirs,
				base: [], // Base is not stored in standard git markers
			});

			i++;
		} else {
			i++;
		}
	}

	return {
		hasConflicts: conflicts.length > 0,
		conflicts,
		lines,
	};
}

/**
 * Simple conflict resolution strategy: take "ours" by default
 */
export function resolveConflicts(content: string, strategy: "ours" | "theirs" = "ours"): string {
	const { conflicts, lines } = detectMergeConflicts(content);

	if (conflicts.length === 0) {
		return content;
	}

	// Sort conflicts in reverse order to maintain line numbers
	const sortedConflicts = [...conflicts].sort((a, b) => b.lineStart - a.lineStart);

	let result = [...lines];

	for (const conflict of sortedConflicts) {
		const resolution = strategy === "ours" ? conflict.ours : conflict.theirs;

		// Remove conflict markers and replace with chosen version
		result = [
			...result.slice(0, conflict.lineStart),
			...resolution,
			...result.slice(conflict.lineEnd + 1),
		];
	}

	return result.join("\n");
}

/**
 * Detect semantic conflicts (non-overlapping line edits)
 * Returns pairs of edits that touch nearby lines
 */
export interface LineEdit {
	startLine: number;
	endLine: number;
	newContent: string[];
}

export function detectSemanticConflicts(edits: LineEdit[], contextLines: number = 3): LineEdit[][] {
	const conflicts: LineEdit[][] = [];

	for (let i = 0; i < edits.length; i++) {
		for (let j = i + 1; j < edits.length; j++) {
			const edit1 = edits[i];
			const edit2 = edits[j];

			// Check if edits are close enough to conflict
			// Gap is the number of unchanged lines between edits
			const gap = edit2.startLine - edit1.endLine - 1;

			if (gap <= contextLines) {
				// Potential conflict
				if (!conflicts.some((pair) => pair.includes(edit1) || pair.includes(edit2))) {
					conflicts.push([edit1, edit2]);
				}
			}
		}
	}

	return conflicts;
}

/**
 * Check if two text ranges would conflict in a merge
 */
export function wouldConflict(
	baseStart: number,
	baseEnd: number,
	change1Start: number,
	change1End: number,
	change2Start: number,
	change2End: number,
): boolean {
	// Ranges overlap if one starts before the other ends
	return !(change1End < change2Start || change2End < change1Start);
}
