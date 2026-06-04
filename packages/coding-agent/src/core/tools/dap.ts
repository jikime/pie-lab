import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { type Static, Type } from "typebox";
import { type DebugResult, getOrCreateDapClient } from "../../utils/dap-client.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const dapSchema = Type.Object({
	script: Type.String({ description: "Script file to execute (relative or absolute path)" }),
	action: Type.Union([Type.Literal("run"), Type.Literal("debug")], {
		description: "Debug action: run (execute script), debug (execute with debugger enabled)",
	}),
	args: Type.Optional(
		Type.Array(Type.String(), {
			description: "Script arguments",
		}),
	),
});

export type DapToolInput = Static<typeof dapSchema>;

function formatRunResult(exitCode: number, stdout: string, stderr: string): string {
	let markdown = `### Execute: ${exitCode === 0 ? "Success" : "Error"}\n\n`;
	markdown += `**Exit code:** ${exitCode}\n\n`;

	if (stdout.trim()) {
		markdown += `**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n`;
	}

	if (stderr.trim()) {
		markdown += `**Stderr:**\n\`\`\`\n${stderr}\n\`\`\`\n`;
	}

	return markdown;
}

function formatDebugResult(exitCode: number, stdout: string, stderr: string): string {
	let markdown = `### Debug: ${exitCode === 0 ? "Success" : "Error"}\n\n`;
	markdown += `**Exit code:** ${exitCode}\n`;
	markdown += `**Inspector enabled** (--inspect)\n\n`;

	if (stdout.trim()) {
		markdown += `**Output:**\n\`\`\`\n${stdout}\n\`\`\`\n`;
	}

	if (stderr.trim()) {
		markdown += `**Stderr:**\n\`\`\`\n${stderr}\n\`\`\`\n`;
	}

	return markdown;
}

export function createDapToolDefinition(cwd: string): ToolDefinition<typeof dapSchema, undefined> {
	return {
		name: "dap",
		label: "dap",
		description:
			"Execute JavaScript/TypeScript scripts with output capture; debug uses Node's inspector mode, not a full DAP session",
		promptSnippet: "Run or debug a script",
		promptGuidelines: [
			"Use dap run to execute a script and capture output",
			"Use dap debug only when Node inspector output is useful; it is not a full breakpoint/debug-adapter session",
		],
		parameters: dapSchema,
		async execute(_toolCallId, { script, action, args }: DapToolInput, _signal?: AbortSignal, _onUpdate?, _ctx?) {
			const absolutePath = resolveToCwd(script, cwd);

			// Guard: ensure file is JavaScript/TypeScript
			if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(absolutePath)) {
				return {
					content: [{ type: "text", text: "DAP only supports JavaScript/TypeScript files" }],
					details: undefined,
				};
			}

			try {
				const client = getOrCreateDapClient(cwd);

				const result: DebugResult =
					action === "debug"
						? await client.launchWithInspector(absolutePath, args)
						: await client.launch(absolutePath, args);

				const markdown =
					action === "debug"
						? formatDebugResult(result.exitCode, result.stdout, result.stderr)
						: formatRunResult(result.exitCode, result.stdout, result.stderr);

				return {
					content: [{ type: "text", text: markdown }],
					details: undefined,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Execution error: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
				};
			}
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const renderArgs = args as { script?: string; action?: string } | undefined;
			const script = str(renderArgs?.script) ?? "?";
			const action = str(renderArgs?.action) ?? "?";
			const display = `${shortenPath(script)} [${action}]`;
			text.setText(`${theme.fg("toolTitle", theme.bold("dap"))} ${theme.fg("accent", display)}`);
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

export function createDapTool(cwd: string): AgentTool<typeof dapSchema> {
	return wrapToolDefinition(createDapToolDefinition(cwd));
}
