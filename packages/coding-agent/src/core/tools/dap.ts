import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { type Static, Type } from "typebox";
import {
	type DapBreakpoint,
	type DapClientLike,
	type DebugResult,
	getOrCreateDapClient,
} from "../../utils/dap-client.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const dapSchema = Type.Object({
	script: Type.Optional(Type.String({ description: "Script file to execute or debug (relative or absolute path)" })),
	action: Type.Union(
		[
			Type.Literal("run"),
			Type.Literal("debug"),
			Type.Literal("set_breakpoints"),
			Type.Literal("continue"),
			Type.Literal("stack_trace"),
			Type.Literal("scopes"),
			Type.Literal("variables"),
			Type.Literal("evaluate"),
			Type.Literal("disconnect"),
			Type.Literal("status"),
		],
		{
			description:
				"Debug action: run, debug, set_breakpoints, continue, stack_trace, scopes, variables, evaluate, disconnect, or status",
		},
	),
	args: Type.Optional(
		Type.Array(Type.String(), {
			description: "Script arguments",
		}),
	),
	sessionId: Type.Optional(Type.String({ description: "DAP session id. Defaults to 'default'." })),
	adapterCommand: Type.Optional(Type.String({ description: "DAP adapter executable for debug sessions" })),
	adapterArgs: Type.Optional(Type.Array(Type.String({ description: "DAP adapter argument" }))),
	breakpoints: Type.Optional(
		Type.Array(
			Type.Object({
				file: Type.Optional(Type.String({ description: "Breakpoint file. Defaults to script." })),
				line: Type.Number({ description: "Breakpoint line, 1-indexed" }),
			}),
		),
	),
	threadId: Type.Optional(Type.Number({ description: "DAP thread id. Defaults to 1." })),
	frameId: Type.Optional(Type.Number({ description: "DAP stack frame id" })),
	variablesReference: Type.Optional(Type.Number({ description: "DAP variables reference id" })),
	expression: Type.Optional(Type.String({ description: "Expression to evaluate in the debug session" })),
});

export type DapToolInput = Static<typeof dapSchema>;

export interface DapToolOptions {
	clientFactory?: (cwd: string) => DapClientLike;
}

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

function requireScript(input: DapToolInput): string {
	if (!input.script) {
		throw new Error(`DAP action ${input.action} requires script.`);
	}
	return input.script;
}

function formatUnknownResult(title: string, result: unknown): string {
	return `### ${title}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
}

function getSessionId(input: DapToolInput): string {
	return input.sessionId || "default";
}

function resolveBreakpoints(input: DapToolInput, scriptPath: string | undefined, cwd: string): DapBreakpoint[] {
	return (input.breakpoints ?? []).map((breakpoint) => {
		const file = breakpoint.file ? resolveToCwd(breakpoint.file, cwd) : scriptPath;
		if (!file) {
			throw new Error("DAP breakpoint without file requires script.");
		}
		return { file, line: breakpoint.line };
	});
}

export function createDapToolDefinition(
	cwd: string,
	options?: DapToolOptions,
): ToolDefinition<typeof dapSchema, undefined> {
	return {
		name: "dap",
		label: "dap",
		description:
			"Execute JavaScript/TypeScript scripts or control a Debug Adapter Protocol session via an adapter command",
		promptSnippet: "Run a script or control a DAP debug session",
		promptGuidelines: [
			"Use dap run to execute a script and capture output",
			"Use dap debug with adapterCommand to launch a real DAP adapter session",
			"Use set_breakpoints, stack_trace, scopes, variables, evaluate, continue, and disconnect to inspect an active DAP session",
		],
		parameters: dapSchema,
		async execute(_toolCallId, input: DapToolInput, _signal?: AbortSignal, _onUpdate?, _ctx?) {
			const client = options?.clientFactory ? options.clientFactory(cwd) : getOrCreateDapClient(cwd);

			if (input.action === "status") {
				return {
					content: [{ type: "text", text: formatUnknownResult("DAP Status", client.status()) }],
					details: undefined,
				};
			}

			const script = input.script ? resolveToCwd(input.script, cwd) : undefined;

			// Guard: ensure file is JavaScript/TypeScript
			if (script && !/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(script)) {
				return {
					content: [{ type: "text", text: "DAP only supports JavaScript/TypeScript files" }],
					details: undefined,
				};
			}

			try {
				let markdown = "";
				const sessionId = getSessionId(input);

				if (input.action === "run") {
					const absolutePath = requireScript(input);
					const result: DebugResult = await client.launch(resolveToCwd(absolutePath, cwd), input.args);
					markdown = formatRunResult(result.exitCode, result.stdout, result.stderr);
				} else if (input.action === "debug") {
					if (!script) throw new Error("DAP action debug requires script.");
					if (!input.adapterCommand) {
						throw new Error("DAP action debug requires adapterCommand for a real DAP adapter session.");
					}
					const result = await client.startSession({
						sessionId,
						adapterCommand: input.adapterCommand,
						adapterArgs: input.adapterArgs,
						program: script,
						args: input.args,
						breakpoints: resolveBreakpoints(input, script, cwd),
					});
					markdown = `### DAP Session Started\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
				} else if (input.action === "set_breakpoints") {
					if (!script) throw new Error("DAP action set_breakpoints requires script.");
					const lines = (input.breakpoints ?? []).map((breakpoint) => breakpoint.line);
					markdown = formatUnknownResult("DAP Breakpoints", await client.setBreakpoints(sessionId, script, lines));
				} else if (input.action === "continue") {
					markdown = formatUnknownResult("DAP Continue", await client.continue(sessionId, input.threadId));
				} else if (input.action === "stack_trace") {
					markdown = formatUnknownResult("DAP Stack Trace", await client.stackTrace(sessionId, input.threadId));
				} else if (input.action === "scopes") {
					if (input.frameId === undefined) throw new Error("DAP action scopes requires frameId.");
					markdown = formatUnknownResult("DAP Scopes", await client.scopes(sessionId, input.frameId));
				} else if (input.action === "variables") {
					if (input.variablesReference === undefined) {
						throw new Error("DAP action variables requires variablesReference.");
					}
					markdown = formatUnknownResult(
						"DAP Variables",
						await client.variables(sessionId, input.variablesReference),
					);
				} else if (input.action === "evaluate") {
					if (!input.expression) throw new Error("DAP action evaluate requires expression.");
					markdown = formatUnknownResult(
						"DAP Evaluate",
						await client.evaluate(sessionId, input.expression, input.frameId),
					);
				} else if (input.action === "disconnect") {
					await client.disconnect(sessionId);
					markdown = `### DAP Disconnect\n\nDisconnected session \`${sessionId}\`.`;
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
