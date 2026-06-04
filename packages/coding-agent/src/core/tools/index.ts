export {
	type BashOperations,
	type BashSpawnContext,
	type BashSpawnHook,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
	createLocalBashOperations,
} from "./bash.ts";
export {
	type CodeReviewOperations,
	type CodeReviewToolInput,
	type CodeReviewToolOptions,
	createCodeReviewTool,
	createCodeReviewToolDefinition,
} from "./code-review.ts";
export {
	type CommitSplitterOperations,
	type CommitSplitterToolInput,
	type CommitSplitterToolOptions,
	createCommitSplitterTool,
	createCommitSplitterToolDefinition,
} from "./commit-splitter.ts";
export { createDapTool, createDapToolDefinition, type DapToolInput } from "./dap.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditOperations,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindOperations,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsOperations,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export { createLspTool, createLspToolDefinition, type LspToolInput } from "./lsp.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadOperations,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationOptions,
	type TruncationResult,
	truncateHead,
	truncateLine,
	truncateTail,
} from "./truncate.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteOperations,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@pie-lab/agent-core";
import type { SnapshotStore } from "@pie-lab/hashline";
import type { ToolDefinition } from "../extensions/types.ts";
import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { type CodeReviewToolOptions, createCodeReviewTool, createCodeReviewToolDefinition } from "./code-review.ts";
import {
	type CommitSplitterToolOptions,
	createCommitSplitterTool,
	createCommitSplitterToolDefinition,
} from "./commit-splitter.ts";
import type { ConflictHistory } from "./conflict-history.ts";
import { createDapTool, createDapToolDefinition } from "./dap.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createLspTool, createLspToolDefinition } from "./lsp.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "code-review"
	| "commit-splitter"
	| "lsp"
	| "dap";
export const allToolNames: Set<ToolName> = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"code-review",
	"commit-splitter",
	"lsp",
	"dap",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	"code-review"?: CodeReviewToolOptions;
	"commit-splitter"?: CommitSplitterToolOptions;
	hashlineSnapshotStore?: SnapshotStore;
	conflictHistory?: ConflictHistory;
	useHashline?: boolean;
}

function mergeReadOptions(options?: ToolsOptions): ReadToolOptions | undefined {
	return {
		...options?.read,
		useHashline: options?.useHashline ?? options?.read?.useHashline,
		snapshotStore: options?.hashlineSnapshotStore ?? options?.read?.snapshotStore,
		conflictHistory: options?.conflictHistory ?? options?.read?.conflictHistory,
	};
}

function mergeEditOptions(options?: ToolsOptions): EditToolOptions | undefined {
	return {
		...options?.edit,
		snapshotStore: options?.hashlineSnapshotStore ?? options?.edit?.snapshotStore,
		conflictHistory: options?.conflictHistory ?? options?.edit?.conflictHistory,
	};
}

function mergeWriteOptions(options?: ToolsOptions): WriteToolOptions | undefined {
	return {
		...options?.write,
		snapshotStore: options?.hashlineSnapshotStore ?? options?.write?.snapshotStore,
		conflictHistory: options?.conflictHistory ?? options?.write?.conflictHistory,
	};
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "read":
			return createReadToolDefinition(cwd, mergeReadOptions(options));
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "edit":
			return createEditToolDefinition(cwd, mergeEditOptions(options));
		case "write":
			return createWriteToolDefinition(cwd, mergeWriteOptions(options));
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "code-review":
			return createCodeReviewToolDefinition(cwd, options?.["code-review"]);
		case "commit-splitter":
			return createCommitSplitterToolDefinition(cwd, options?.["commit-splitter"]);
		case "lsp":
			return createLspToolDefinition(cwd);
		case "dap":
			return createDapToolDefinition(cwd);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, mergeReadOptions(options));
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, mergeEditOptions(options));
		case "write":
			return createWriteTool(cwd, mergeWriteOptions(options));
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "code-review":
			return createCodeReviewTool(cwd, options?.["code-review"]);
		case "commit-splitter":
			return createCommitSplitterTool(cwd, options?.["commit-splitter"]);
		case "lsp":
			return createLspTool(cwd);
		case "dap":
			return createDapTool(cwd);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, mergeReadOptions(options)),
		createBashToolDefinition(cwd, options?.bash),
		createEditToolDefinition(cwd, mergeEditOptions(options)),
		createWriteToolDefinition(cwd, mergeWriteOptions(options)),
	];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
	return [
		createReadToolDefinition(cwd, mergeReadOptions(options)),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
	];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
	return {
		read: createReadToolDefinition(cwd, mergeReadOptions(options)),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, mergeEditOptions(options)),
		write: createWriteToolDefinition(cwd, mergeWriteOptions(options)),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		"code-review": createCodeReviewToolDefinition(cwd, options?.["code-review"]),
		"commit-splitter": createCommitSplitterToolDefinition(cwd, options?.["commit-splitter"]),
		lsp: createLspToolDefinition(cwd),
		dap: createDapToolDefinition(cwd),
	};
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, mergeReadOptions(options)),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, mergeEditOptions(options)),
		createWriteTool(cwd, mergeWriteOptions(options)),
	];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, mergeReadOptions(options)),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, mergeReadOptions(options)),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, mergeEditOptions(options)),
		write: createWriteTool(cwd, mergeWriteOptions(options)),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		"code-review": createCodeReviewTool(cwd, options?.["code-review"]),
		"commit-splitter": createCommitSplitterTool(cwd, options?.["commit-splitter"]),
		lsp: createLspTool(cwd),
		dap: createDapTool(cwd),
	};
}
