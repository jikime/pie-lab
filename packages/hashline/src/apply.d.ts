/**
 * Apply hashline edits to file content
 */
import type { ApplyEditResult, ComputedHashContext, HashlineEdit } from "./types.ts";
/**
 * Apply a single hashline edit to file content
 * Supports both string-match (legacy) and hash-based (hashline) edits
 */
export declare function applyHashlineEdit(content: string, edit: HashlineEdit): ApplyEditResult;
/**
 * Apply multiple edits to content
 * Edits are applied in reverse order (highest line first) to avoid line number shifts
 */
export declare function applyHashlineEdits(content: string, edits: HashlineEdit[]): ApplyEditResult;
/**
 * Compute hash context for an edit
 * Called by edit tool to generate hash + context for LLM
 */
export declare function computeEditContext(content: string, anchor: string, contextLines?: number): ComputedHashContext | null;
//# sourceMappingURL=apply.d.ts.map