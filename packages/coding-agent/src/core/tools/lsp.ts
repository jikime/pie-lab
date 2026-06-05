import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { type Static, Type } from "typebox";
import {
	applyWorkspaceEdit,
	getOrCreateLspClient,
	type LspClientLike,
	type LspCodeAction,
	type LspDiagnostic,
	type LspWorkspaceEdit,
} from "../../utils/lsp-client.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const lspSchema = Type.Object({
	file: Type.Optional(Type.String({ description: "Path to the TypeScript file (relative or absolute)" })),
	line: Type.Optional(Type.Number({ description: "Line number (1-indexed)" })),
	column: Type.Optional(Type.Number({ description: "Column number (1-indexed)" })),
	action: Type.Union(
		[
			Type.Literal("hover"),
			Type.Literal("definition"),
			Type.Literal("references"),
			Type.Literal("diagnostics"),
			Type.Literal("rename"),
			Type.Literal("code_actions"),
			Type.Literal("capabilities"),
			Type.Literal("status"),
		],
		{
			description:
				"LSP action: hover, definition, references, diagnostics, rename, code_actions, capabilities, or status",
		},
	),
	newName: Type.Optional(Type.String({ description: "New symbol name for rename" })),
	apply: Type.Optional(Type.Boolean({ description: "Apply workspace edit returned by rename/code action" })),
	codeActionIndex: Type.Optional(Type.Number({ description: "Zero-based code action index to apply" })),
	timeoutMs: Type.Optional(Type.Number({ description: "Diagnostics wait timeout in milliseconds" })),
});

export type LspToolInput = Static<typeof lspSchema>;

export interface LspToolOptions {
	clientFactory?: (cwd: string) => LspClientLike;
}

interface FileLocation {
	uri: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

interface HoverResult {
	contents:
		| {
				language?: string;
				value?: string;
		  }
		| string;
	range?: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
}

function formatHoverResult(result: HoverResult | null, symbol: string): string {
	if (!result) {
		return `No hover information found for "${symbol}"`;
	}

	let markdown = `### Hover: \`${symbol}\`\n\n`;

	if (result.contents) {
		const content = result.contents;
		if (typeof content === "string") {
			markdown += `${content}\n`;
		} else if (content.value) {
			if (content.language) {
				markdown += `\`\`\`${content.language}\n${content.value}\n\`\`\`\n`;
			} else {
				markdown += `\`\`\`\n${content.value}\n\`\`\`\n`;
			}
		}
	}

	return markdown;
}

function fileUriToPath(uri: string): string {
	// Convert file:///path/to/file to /path/to/file (or C:\\path on Windows)
	const path = uri.replace(/^file:\/\//, "");
	return decodeURIComponent(path);
}

function formatDefinitionResult(result: FileLocation | FileLocation[] | null, symbol: string): string {
	if (!result) {
		return `No definition found for "${symbol}"`;
	}

	const locations = Array.isArray(result) ? result : [result];
	if (locations.length === 0) {
		return `No definition found for "${symbol}"`;
	}

	let markdown = `### Definition: \`${symbol}\`\n\n`;

	for (const loc of locations.slice(0, 1)) {
		const path = fileUriToPath(loc.uri);
		const line = loc.range.start.line + 1;
		markdown += `**Location:** \`${path}:${line}\`\n`;
	}

	return markdown;
}

function formatReferencesResult(result: FileLocation[] | null, symbol: string): string {
	if (!result || result.length === 0) {
		return `No references found for "${symbol}"`;
	}

	let markdown = `### References: \`${symbol}\` (${result.length} found)\n\n`;

	for (const ref of result.slice(0, 20)) {
		const path = fileUriToPath(ref.uri);
		const line = ref.range.start.line + 1;
		markdown += `- \`${path}:${line}\`\n`;
	}

	if (result.length > 20) {
		markdown += `\n... and ${result.length - 20} more references\n`;
	}

	return markdown;
}

function formatDiagnosticsResult(diagnostics: LspDiagnostic[], file: string): string {
	if (diagnostics.length === 0) {
		return `### Diagnostics: \`${file}\`\n\nOK`;
	}

	const lines = [`### Diagnostics: \`${file}\` (${diagnostics.length})`, ""];
	for (const diagnostic of diagnostics) {
		const line = diagnostic.range.start.line + 1;
		const column = diagnostic.range.start.character + 1;
		const source = diagnostic.source ? ` ${diagnostic.source}` : "";
		const code = diagnostic.code !== undefined ? ` ${diagnostic.code}` : "";
		lines.push(`- ${line}:${column}${source}${code} ${diagnostic.message}`);
	}
	return lines.join("\n");
}

function formatWorkspaceEdit(edit: LspWorkspaceEdit | null): string {
	if (!edit) {
		return "No workspace edit returned.";
	}

	const lines = ["Workspace edit:"];
	if (edit.changes) {
		for (const [uri, edits] of Object.entries(edit.changes)) {
			lines.push(`- ${fileUriToPath(uri)}: ${edits.length} edit(s)`);
		}
	}
	if (edit.documentChanges) {
		for (const change of edit.documentChanges) {
			lines.push(`- ${fileUriToPath(change.textDocument.uri)}: ${change.edits.length} edit(s)`);
		}
	}
	return lines.join("\n");
}

function formatCodeActions(actions: LspCodeAction[]): string {
	if (actions.length === 0) {
		return "### Code Actions\n\nNo code actions found.";
	}
	const lines = ["### Code Actions", ""];
	for (const [index, action] of actions.entries()) {
		const kind = action.kind ? ` (${action.kind})` : "";
		lines.push(`${index}. ${action.title}${kind}`);
	}
	return lines.join("\n");
}

function requireFile(input: LspToolInput): string {
	if (!input.file) {
		throw new Error(`LSP action ${input.action} requires file.`);
	}
	return input.file;
}

function requirePosition(input: LspToolInput): { line: number; column: number } {
	if (input.line === undefined || input.column === undefined) {
		throw new Error(`LSP action ${input.action} requires line and column.`);
	}
	return { line: input.line, column: input.column };
}

export function createLspToolDefinition(
	cwd: string,
	options?: LspToolOptions,
): ToolDefinition<typeof lspSchema, undefined> {
	return {
		name: "lsp",
		label: "lsp",
		description:
			"Query TypeScript Language Server for hover, definition, references, diagnostics, rename, code actions, capabilities, or status",
		promptSnippet: "Look up symbol info, diagnostics, references, rename edits, or code actions",
		promptGuidelines: [
			"Use lsp hover to understand what a symbol is",
			"Use lsp definition to find where a symbol is defined",
			"Use lsp references to find all uses of a symbol",
			"Use lsp diagnostics before or after edits to inspect TypeScript/JavaScript errors",
			"Use lsp rename to request workspace edits for safe symbol renames",
			"Use lsp code_actions to inspect available fixes at a location",
		],
		parameters: lspSchema,
		async execute(_toolCallId, input: LspToolInput, _signal?: AbortSignal, _onUpdate?, _ctx?) {
			if (input.action === "status") {
				const client = options?.clientFactory ? options.clientFactory(cwd) : getOrCreateLspClient(cwd);
				return { content: [{ type: "text", text: JSON.stringify(client.status(), null, 2) }], details: undefined };
			}

			const client = options?.clientFactory ? options.clientFactory(cwd) : getOrCreateLspClient(cwd);
			await client.start();

			if (input.action === "capabilities") {
				return {
					content: [{ type: "text", text: JSON.stringify(client.capabilities(), null, 2) }],
					details: undefined,
				};
			}

			const file = requireFile(input);
			const absolutePath = resolveToCwd(file, cwd);

			// Guard: ensure file is TypeScript
			if (!/\.(ts|tsx|js|jsx)$/i.test(absolutePath)) {
				return {
					content: [{ type: "text", text: "LSP only supports TypeScript/JavaScript files" }],
					details: undefined,
				};
			}

			try {
				let markdown = "";

				if (input.action === "hover") {
					const { line, column } = requirePosition(input);
					const result = (await client.hover(absolutePath, line, column)) as HoverResult | null;
					// Extract symbol name from position (best effort)
					const symbol = `symbol@${line}:${column}`;
					markdown = formatHoverResult(result, symbol);
				} else if (input.action === "definition") {
					const { line, column } = requirePosition(input);
					const result = (await client.definition(absolutePath, line, column)) as
						| FileLocation
						| FileLocation[]
						| null;
					const symbol = `symbol@${line}:${column}`;
					markdown = formatDefinitionResult(result, symbol);
				} else if (input.action === "references") {
					const { line, column } = requirePosition(input);
					const result = (await client.references(absolutePath, line, column)) as FileLocation[] | null;
					const symbol = `symbol@${line}:${column}`;
					markdown = formatReferencesResult(result, symbol);
				} else if (input.action === "diagnostics") {
					const diagnostics = await client.diagnostics(absolutePath, input.timeoutMs);
					markdown = formatDiagnosticsResult(diagnostics, file);
				} else if (input.action === "rename") {
					const { line, column } = requirePosition(input);
					if (!input.newName) {
						throw new Error("LSP action rename requires newName.");
					}
					const edit = await client.rename(absolutePath, line, column, input.newName);
					const applied = input.apply && edit ? applyWorkspaceEdit(edit) : [];
					markdown = `### Rename\n\n${formatWorkspaceEdit(edit)}${
						applied.length > 0 ? `\n\nApplied to:\n${applied.map((filePath) => `- ${filePath}`).join("\n")}` : ""
					}`;
				} else if (input.action === "code_actions") {
					const { line, column } = requirePosition(input);
					const actions = await client.codeActions(absolutePath, line, column);
					const selected = input.codeActionIndex !== undefined ? actions[input.codeActionIndex] : undefined;
					const applied = input.apply && selected?.edit ? applyWorkspaceEdit(selected.edit) : [];
					markdown = `${formatCodeActions(actions)}${
						applied.length > 0 ? `\n\nApplied to:\n${applied.map((filePath) => `- ${filePath}`).join("\n")}` : ""
					}`;
				}

				return {
					content: [{ type: "text", text: markdown }],
					details: undefined,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `LSP error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
				};
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const renderArgs = args as { file?: string; action?: string } | undefined;
			const file = str(renderArgs?.file) ?? "";
			const action = str(renderArgs?.action) ?? "?";
			const display = file ? `${shortenPath(file)} [${action}]` : `[${action}]`;
			text.setText(`${theme.fg("toolTitle", theme.bold("lsp"))} ${theme.fg("accent", display)}`);
			return text;
		},
		renderResult(result, _options, _theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const content = result.content[0];
			if (content && content.type === "text") {
				text.setText(content.text);
			}
			return text;
		},
	};
}

export function createLspTool(cwd: string): AgentTool<typeof lspSchema> {
	return wrapToolDefinition(createLspToolDefinition(cwd));
}
