/**
 * Hashline types for pie-lab
 * Minimal implementation focusing on hash-based edit anchoring
 */

export interface HashlineEdit {
	/** Text to match or anchor to replace */
	anchor: string;

	/** SHA256 hash of surrounding context (computed by edit tool) */
	hash?: string;

	/** Lines before anchor (for context-based recovery) */
	before?: string[];

	/** Lines after anchor (for context-based recovery) */
	after?: string[];

	/** Replacement text */
	newText: string;
}

export interface ApplyEditResult {
	/** Modified file content */
	text: string;

	/** Whether hash matched exactly (true) or was recovered (false) */
	hashMatched?: boolean;

	/** Error message if anchor could not be found or recovered */
	error?: string;

	/** Warning messages (e.g., "recovered from stale anchor") */
	warnings?: string[];
}

export interface ComputedHashContext {
	/** Content hash of the anchor line */
	hash: string;

	/** Lines before anchor for context */
	before: string[];

	/** Lines after anchor for context */
	after: string[];
}
