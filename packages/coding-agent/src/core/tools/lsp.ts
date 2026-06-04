import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { type Static, Type } from "typebox";
import { getOrCreateLspClient } from "../../utils/lsp-client.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const lspSchema = Type.Object({
	file: Type.String({ description: "Path to the TypeScript file (relative or absolute)" }),
	line: Type.Number({ description: "Line number (1-indexed)" }),
	column: Type.Number({ description: "Column number (1-indexed)" }),
	action: Type.Union([Type.Literal("hover"), Type.Literal("definition"), Type.Literal("references")], {
		description: "LSP action: hover (type info), definition (source location), or references (all usages)",
	}),
});

export type LspToolInput = Static<typeof lspSchema>;

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

export function createLspToolDefinition(cwd: string): ToolDefinition<typeof lspSchema, undefined> {
	return {
		name: "lsp",
		label: "lsp",
		description: "Query TypeScript Language Server for hover type info, definition location, or references",
		promptSnippet: "Look up symbol type, definition location, or all usages",
		promptGuidelines: [
			"Use lsp hover to understand what a symbol is",
			"Use lsp definition to find where a symbol is defined",
			"Use lsp references to find all uses of a symbol",
		],
		parameters: lspSchema,
		async execute(
			_toolCallId,
			{ file, line, column, action }: LspToolInput,
			_signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(file, cwd);

			// Guard: ensure file is TypeScript
			if (!/\.(ts|tsx|js|jsx)$/i.test(absolutePath)) {
				return {
					content: [{ type: "text", text: "LSP only supports TypeScript/JavaScript files" }],
					details: undefined,
				};
			}

			try {
				const client = getOrCreateLspClient(cwd);
				await client.start();

				let markdown = "";

				if (action === "hover") {
					const result = (await client.hover(absolutePath, line, column)) as HoverResult | null;
					// Extract symbol name from position (best effort)
					const symbol = `symbol@${line}:${column}`;
					markdown = formatHoverResult(result, symbol);
				} else if (action === "definition") {
					const result = (await client.definition(absolutePath, line, column)) as
						| FileLocation
						| FileLocation[]
						| null;
					const symbol = `symbol@${line}:${column}`;
					markdown = formatDefinitionResult(result, symbol);
				} else if (action === "references") {
					const result = (await client.references(absolutePath, line, column)) as FileLocation[] | null;
					const symbol = `symbol@${line}:${column}`;
					markdown = formatReferencesResult(result, symbol);
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
			const file = str(renderArgs?.file) ?? "?";
			const action = str(renderArgs?.action) ?? "?";
			const display = `${shortenPath(file)} [${action}]`;
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
