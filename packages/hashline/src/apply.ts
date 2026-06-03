/**
 * Apply hashline edits to file content
 */

import { findAnchorLine, computeLineHash, computeHashContext } from "./hash.ts";
import type { ApplyEditResult, ComputedHashContext, HashlineEdit } from "./types.ts";

/**
 * Apply a single hashline edit to file content
 * Supports both string-match (legacy) and hash-based (hashline) edits
 */
export function applyHashlineEdit(
	content: string,
	edit: HashlineEdit,
): ApplyEditResult {
	const lines = content.split("\n");
	const anchor = edit.anchor;
	const hash = edit.hash;

	// Find the line to edit
	let lineIdx = -1;
	let hashMatched = false;
	const warnings: string[] = [];

	// 1. Try exact string match first
	lineIdx = lines.indexOf(anchor);
	if (lineIdx !== -1) {
		hashMatched = !hash || computeLineHash(lines[lineIdx]) === hash;
		if (!hashMatched) {
			warnings.push(`anchor matched but hash differs (file may have changed)`);
		}
	}

	// 2. Try hash match if exact failed
	if (lineIdx === -1 && hash) {
		for (let i = 0; i < lines.length; i++) {
			if (computeLineHash(lines[i]) === hash) {
				lineIdx = i;
				hashMatched = true;
				warnings.push(`recovered from hash (content at line ${i + 1})`);
				break;
			}
		}
	}

	// 3. Try fuzzy match with context
	if (lineIdx === -1 && edit.before && edit.after) {
		lineIdx = findAnchorByContext(lines, anchor, edit.before, edit.after);
		if (lineIdx !== -1) {
			warnings.push(`recovered from context (matched at line ${lineIdx + 1})`);
		}
	}

	// 4. Failed to find anchor
	if (lineIdx === -1) {
		return {
			text: content,
			error: `anchor not found: "${anchor.substring(0, 50)}${anchor.length > 50 ? "..." : ""}"`,
			warnings,
		};
	}

	// Replace the line
	const newLines = [...lines];
	newLines[lineIdx] = edit.newText;

	return {
		text: newLines.join("\n"),
		hashMatched,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

/**
 * Apply multiple edits to content
 * Edits are applied in reverse order (highest line first) to avoid line number shifts
 */
export function applyHashlineEdits(
	content: string,
	edits: HashlineEdit[],
): ApplyEditResult {
	let currentContent = content;
	const warnings: string[] = [];
	let firstError: string | undefined;

	// Sort edits in reverse order (by line number in original file)
	// This way, applying edits doesn't shift line numbers for subsequent edits
	const sortedEdits = [...edits].sort((a, b) => {
		const aLine = findAnchorLineInContent(currentContent, a);
		const bLine = findAnchorLineInContent(currentContent, b);
		return (bLine ?? Infinity) - (aLine ?? Infinity);
	});

	for (const edit of sortedEdits) {
		const result = applyHashlineEdit(currentContent, edit);

		if (result.error) {
			if (!firstError) firstError = result.error;
			warnings.push(result.error);
			// Continue applying other edits even if one fails
		} else {
			currentContent = result.text;
			if (result.warnings) warnings.push(...result.warnings);
		}
	}

	return {
		text: currentContent,
		error: firstError,
		warnings: warnings.length > 0 ? warnings : undefined,
	};
}

/**
 * Find line number of anchor in current content
 * Used for sorting edits in reverse order
 */
function findAnchorLineInContent(content: string, edit: HashlineEdit): number | undefined {
	const lines = content.split("\n");
	const idx = findAnchorLine(lines, edit.anchor, edit.hash);
	return idx === null ? undefined : idx;
}

/**
 * Try to find anchor line using context (before/after lines)
 */
function findAnchorByContext(
	lines: string[],
	anchor: string,
	beforeLines: string[],
	afterLines: string[],
): number {
	// Search for a position where before + anchor + after sequence matches
	for (let i = beforeLines.length; i < lines.length - afterLines.length; i++) {
		if (lines[i] !== anchor) continue;

		// Check before context
		let beforeOk = true;
		for (let j = 0; j < beforeLines.length; j++) {
			if (lines[i - beforeLines.length + j] !== beforeLines[j]) {
				beforeOk = false;
				break;
			}
		}
		if (!beforeOk) continue;

		// Check after context
		let afterOk = true;
		for (let j = 0; j < afterLines.length; j++) {
			if (lines[i + 1 + j] !== afterLines[j]) {
				afterOk = false;
				break;
			}
		}
		if (afterOk) return i;
	}

	return -1;
}

/**
 * Compute hash context for an edit
 * Called by edit tool to generate hash + context for LLM
 */
export function computeEditContext(
	content: string,
	anchor: string,
	contextLines: number = 2,
): ComputedHashContext | null {
	const lines = content.split("\n");
	const lineIdx = findAnchorLine(lines, anchor);

	if (lineIdx === null) {
		return null;
	}

	const before = lines.slice(Math.max(0, lineIdx - contextLines), lineIdx);
	const after = lines.slice(lineIdx + 1, Math.min(lines.length, lineIdx + 1 + contextLines));
	const hash = computeLineHash(lines[lineIdx]);

	return { hash, before, after };
}
