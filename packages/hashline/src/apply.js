/**
 * Apply hashline edits to file content
 */
import { computeLineHash } from "./hash.js";
function formatAnchor(anchor) {
    return `"${anchor.substring(0, 50)}${anchor.length > 50 ? "..." : ""}"`;
}
function normalizeHash(hash) {
    return hash.substring(0, 16);
}
function findExactLineCandidates(lines, anchor) {
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === anchor) {
            candidates.push(i);
        }
    }
    return candidates;
}
function findHashLineCandidates(lines, hash) {
    const normalizedHash = normalizeHash(hash);
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        if (computeLineHash(lines[i]) === normalizedHash) {
            candidates.push(i);
        }
    }
    return candidates;
}
function hasContext(edit) {
    return Boolean(edit.before?.length || edit.after?.length);
}
function contextMatches(lines, lineIndex, edit) {
    if (edit.before) {
        if (lineIndex < edit.before.length)
            return false;
        for (let i = 0; i < edit.before.length; i++) {
            if (lines[lineIndex - edit.before.length + i] !== edit.before[i]) {
                return false;
            }
        }
    }
    if (edit.after) {
        if (lineIndex + edit.after.length >= lines.length)
            return false;
        for (let i = 0; i < edit.after.length; i++) {
            if (lines[lineIndex + 1 + i] !== edit.after[i]) {
                return false;
            }
        }
    }
    return true;
}
function filterByContext(lines, candidates, edit) {
    if (!hasContext(edit))
        return candidates;
    return candidates.filter((lineIndex) => contextMatches(lines, lineIndex, edit));
}
function resolveHashlineEdit(lines, edit) {
    const warnings = [];
    if (edit.anchor.includes("\n")) {
        return {
            error: `hashline edits are line-based; anchor must not contain newlines: ${formatAnchor(edit.anchor)}`,
            warnings,
        };
    }
    const exactCandidates = filterByContext(lines, findExactLineCandidates(lines, edit.anchor), edit);
    if (exactCandidates.length > 0) {
        if (exactCandidates.length > 1) {
            return {
                error: `anchor is ambiguous; matched ${exactCandidates.length} lines: ${formatAnchor(edit.anchor)}`,
                warnings,
            };
        }
        const lineIndex = exactCandidates[0];
        if (edit.hash && computeLineHash(lines[lineIndex]) !== normalizeHash(edit.hash)) {
            return {
                error: `anchor matched but hash differs: ${formatAnchor(edit.anchor)}`,
                warnings,
            };
        }
        return {
            lineIndex,
            edit,
            hashMatched: edit.hash ? true : undefined,
            warnings,
        };
    }
    if (!edit.hash) {
        return {
            error: `anchor not found: ${formatAnchor(edit.anchor)}`,
            warnings,
        };
    }
    const hashCandidates = filterByContext(lines, findHashLineCandidates(lines, edit.hash), edit);
    if (hashCandidates.length === 0) {
        return {
            error: `anchor not found and hash did not identify a unique fallback: ${formatAnchor(edit.anchor)}`,
            warnings,
        };
    }
    if (hashCandidates.length > 1) {
        return {
            error: `hash fallback is ambiguous; matched ${hashCandidates.length} lines for ${formatAnchor(edit.anchor)}`,
            warnings,
        };
    }
    const lineIndex = hashCandidates[0];
    warnings.push(`recovered by hash at line ${lineIndex + 1}`);
    return {
        lineIndex,
        edit,
        hashMatched: true,
        warnings,
    };
}
function applyResolvedEdits(lines, resolvedEdits) {
    const newLines = [...lines];
    for (const resolved of [...resolvedEdits].sort((a, b) => b.lineIndex - a.lineIndex)) {
        newLines.splice(resolved.lineIndex, 1, ...resolved.edit.newText.split("\n"));
    }
    return newLines;
}
/**
 * Apply a single hashline edit to file content
 * Applies only when the target line can be resolved unambiguously.
 */
export function applyHashlineEdit(content, edit) {
    const lines = content.split("\n");
    const resolved = resolveHashlineEdit(lines, edit);
    if ("error" in resolved) {
        return {
            text: content,
            error: resolved.error,
            warnings: resolved.warnings.length > 0 ? resolved.warnings : undefined,
        };
    }
    const newLines = applyResolvedEdits(lines, [resolved]);
    return {
        text: newLines.join("\n"),
        hashMatched: resolved.hashMatched,
        warnings: resolved.warnings.length > 0 ? resolved.warnings : undefined,
    };
}
/**
 * Apply multiple edits to content
 * Edits are applied in reverse order (highest line first) to avoid line number shifts
 */
export function applyHashlineEdits(content, edits) {
    const lines = content.split("\n");
    const warnings = [];
    const resolvedEdits = [];
    const usedLines = new Set();
    for (const edit of edits) {
        const resolved = resolveHashlineEdit(lines, edit);
        if ("error" in resolved) {
            return {
                text: content,
                error: resolved.error,
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }
        if (usedLines.has(resolved.lineIndex)) {
            return {
                text: content,
                error: `multiple hashline edits target line ${resolved.lineIndex + 1}`,
                warnings: warnings.length > 0 ? warnings : undefined,
            };
        }
        usedLines.add(resolved.lineIndex);
        warnings.push(...resolved.warnings);
        resolvedEdits.push(resolved);
    }
    const newLines = applyResolvedEdits(lines, resolvedEdits);
    return {
        text: newLines.join("\n"),
        hashMatched: resolvedEdits.every((edit) => edit.hashMatched === true) ? true : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
    };
}
/**
 * Compute hash context for an edit
 * Called by edit tool to generate hash + context for LLM
 */
export function computeEditContext(content, anchor, contextLines = 2) {
    const lines = content.split("\n");
    const candidates = findExactLineCandidates(lines, anchor);
    if (candidates.length !== 1) {
        return null;
    }
    const lineIdx = candidates[0];
    const before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
    const after = lines.slice(lineIdx + 1, Math.min(lines.length, lineIdx + 1 + contextLines));
    const hash = computeLineHash(lines[lineIdx]);
    return { hash, before, after };
}
//# sourceMappingURL=apply.js.map