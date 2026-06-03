/**
 * Conflict detection and resolution for three-way merges
 */
/**
 * Detect merge conflict markers in content
 * Looks for standard git merge markers: <<<<<<<, =======, >>>>>>>
 */
export function detectMergeConflicts(content) {
    const lines = content.split("\n");
    const conflicts = [];
    let i = 0;
    while (i < lines.length) {
        // Look for conflict start marker
        if (lines[i].startsWith("<<<<<<<")) {
            const conflictStart = i;
            const ours = [];
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
            const theirs = [];
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
        }
        else {
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
export function resolveConflicts(content, strategy = "ours") {
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
export function detectSemanticConflicts(edits, contextLines = 3) {
    const conflicts = [];
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
export function wouldConflict(baseStart, baseEnd, change1Start, change1End, change2Start, change2End) {
    // Ranges overlap if one starts before the other ends
    return !(change1End < change2Start || change2End < change1Start);
}
export function threeWayMerge(base, ours, theirs) {
    const baseLines = base.split("\n");
    const ourLines = ours.split("\n");
    const theirLines = theirs.split("\n");
    // Check for obvious non-conflict cases
    if (ours === theirs) {
        return { merged: ours, conflicts: [], hasConflicts: false };
    }
    if (ours === base) {
        return { merged: theirs, conflicts: [], hasConflicts: false };
    }
    if (theirs === base) {
        return { merged: ours, conflicts: [], hasConflicts: false };
    }
    // Simple line-by-line merge: if all three differ, it's a conflict
    const result = [];
    const conflicts = [];
    const maxLines = Math.max(baseLines.length, ourLines.length, theirLines.length);
    for (let i = 0; i < maxLines; i++) {
        const baseLine = baseLines[i] || "";
        const ourLine = ourLines[i] || "";
        const theirLine = theirLines[i] || "";
        if (ourLine === theirLine) {
            // Both agree
            result.push(ourLine);
        }
        else if (ourLine === baseLine) {
            // We didn't change, they did → take theirs
            result.push(theirLine);
        }
        else if (theirLine === baseLine) {
            // They didn't change, we did → take ours
            result.push(ourLine);
        }
        else {
            // Both changed differently → conflict
            result.push(`<<<<<<< HEAD`);
            result.push(ourLine);
            result.push(`=======`);
            result.push(theirLine);
            result.push(`>>>>>>>`);
            conflicts.push({
                lineStart: result.length - 5,
                lineEnd: result.length - 1,
                ours: [ourLine],
                theirs: [theirLine],
                base: [baseLine],
            });
        }
    }
    return {
        merged: result.join("\n"),
        conflicts,
        hasConflicts: conflicts.length > 0,
    };
}
//# sourceMappingURL=conflict.js.map