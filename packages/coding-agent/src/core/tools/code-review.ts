import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const codeReviewSchema = Type.Object({
	path: Type.Optional(Type.String({ description: "File or directory to review (default: current directory)" })),
	staged: Type.Optional(Type.Boolean({ description: "Review only staged changes (default: false)" })),
	base: Type.Optional(Type.String({ description: "Base branch or commit for comparison (default: HEAD)" })),
	checks: Type.Optional(
		Type.Array(Type.String(), {
			description: "Checks to run: tsc, diff (default: [tsc, diff])",
		}),
	),
});

export type CodeReviewToolInput = Static<typeof codeReviewSchema>;

export interface CodeReviewOperations {
	exec: (
		cmd: string,
		args: string[],
		opts: { cwd: string; signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

const execFile = promisify(execFileCallback);

interface ExecFailure {
	stdout?: unknown;
	stderr?: unknown;
	message?: unknown;
}

function getExecFailureOutput(error: unknown): string {
	const failure = error as ExecFailure;
	const stdout = typeof failure.stdout === "string" ? failure.stdout : "";
	const stderr = typeof failure.stderr === "string" ? failure.stderr : "";
	return stdout + stderr;
}

const defaultCodeReviewOperations: CodeReviewOperations = {
	exec: async (cmd, args, opts) => {
		const { stdout, stderr } = (await execFile(cmd, args, {
			cwd: opts.cwd,
			signal: opts.signal,
			encoding: "utf-8",
		})) as { stdout: string; stderr: string };
		return { stdout, stderr, exitCode: 0 };
	},
};

export interface CodeReviewToolOptions {
	operations?: CodeReviewOperations;
}

interface DiffStats {
	files: Set<string>;
	additions: number;
	deletions: number;
	issues: Array<{ file: string; line: number; type: string; message: string }>;
}

function parseDiff(diffText: string): DiffStats {
	const stats: DiffStats = {
		files: new Set(),
		additions: 0,
		deletions: 0,
		issues: [],
	};

	const lines = diffText.split("\n");
	let currentFile = "";
	let currentLine = 0;

	for (const line of lines) {
		// Extract file path from diff header
		if (line.startsWith("+++")) {
			const match = line.match(/^\+\+\+ b\/(.+)$/);
			if (match) {
				currentFile = match[1];
				stats.files.add(currentFile);
			}
		}

		// Track line numbers from hunk headers
		if (line.startsWith("@@")) {
			const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
			if (match) {
				currentLine = parseInt(match[1], 10);
			}
		}

		// Count additions/deletions and detect issues
		if (line.startsWith("+") && !line.startsWith("+++")) {
			stats.additions++;
			const content = line.slice(1);
			currentLine++;

			// Detect console.log
			if (/console\.(log|warn|error|info|debug)/.test(content)) {
				stats.issues.push({
					file: currentFile,
					line: currentLine,
					type: "console",
					message: "console.log/warn/error detected",
				});
			}

			// Detect TODO/FIXME
			if (/\/\/\s*(TODO|FIXME)/.test(content)) {
				stats.issues.push({
					file: currentFile,
					line: currentLine,
					type: "todo",
					message: "TODO/FIXME comment detected",
				});
			}

			// Detect potential secrets
			if (/(password|secret|token|key|api_key)\s*=\s*['"]/.test(content.toLowerCase())) {
				stats.issues.push({
					file: currentFile,
					line: currentLine,
					type: "secret",
					message: "Potential hardcoded secret detected",
				});
			}
		} else if (line.startsWith("-") && !line.startsWith("---")) {
			stats.deletions++;
		}
	}

	return stats;
}

interface TypeScriptError {
	file: string;
	line: number;
	column: number;
	message: string;
}

function parseTscOutput(tscOutput: string): TypeScriptError[] {
	const errors: TypeScriptError[] = [];
	const lines = tscOutput.split("\n");

	for (const line of lines) {
		// Match: path/to/file.ts(line,col): error TS123: message
		const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+\w+:\s*(.+)$/);
		if (match) {
			errors.push({
				file: match[1],
				line: parseInt(match[2], 10),
				column: parseInt(match[3], 10),
				message: match[4],
			});
		}
	}

	return errors;
}

function buildMarkdownReport(diffStats: DiffStats, tscErrors: TypeScriptError[], checks: string[]): string {
	let report = "## Code Review Report\n\n";

	// Summary
	report += `**Changed files:** ${diffStats.files.size} | **Lines:** +${diffStats.additions} / -${diffStats.deletions}\n\n`;

	// TypeScript Errors
	if (checks.includes("tsc")) {
		if (tscErrors.length > 0) {
			report += `### TypeScript Errors (${tscErrors.length})\n`;
			for (const err of tscErrors) {
				report += `- \`${err.file}:${err.line}:${err.column}\` - ${err.message}\n`;
			}
			report += "\n";
		}
	}

	// Potential Issues
	if (checks.includes("diff")) {
		if (diffStats.issues.length > 0) {
			report += `### Potential Issues (${diffStats.issues.length})\n`;
			for (const issue of diffStats.issues) {
				const label = issue.type === "secret" ? "secret" : issue.type;
				report += `- [${label}] \`${issue.file}\` +${issue.line}: ${issue.message}\n`;
			}
			report += "\n";
		}
	}

	// Summary line
	const totalIssues = tscErrors.length + diffStats.issues.length;
	if (totalIssues > 0) {
		const blockingCount = tscErrors.length;
		report += `### Summary\n`;
		report += `${blockingCount} blocking issue${blockingCount !== 1 ? "s" : ""} (TypeScript error${blockingCount !== 1 ? "s" : ""})`;
		if (diffStats.issues.length > 0) {
			report += `, ${diffStats.issues.length} potential issue${diffStats.issues.length !== 1 ? "s" : ""}`;
		}
		report += "\n";
	} else {
		report += "### Summary\nNo issues found\n";
	}

	return report;
}

export function createCodeReviewToolDefinition(
	cwd: string,
	options?: CodeReviewToolOptions,
): ToolDefinition<typeof codeReviewSchema, undefined> {
	const ops = options?.operations ?? defaultCodeReviewOperations;

	return {
		name: "code-review",
		label: "code-review",
		description: "Analyze git diff and TypeScript compilation errors to produce a code review report",
		promptSnippet: "Review code changes and compilation errors",
		promptGuidelines: ["Use code-review to check for issues before committing or pushing"],
		parameters: codeReviewSchema,
		async execute(
			_toolCallId,
			{ path = ".", staged = false, base = "HEAD", checks = ["tsc", "diff"] }: CodeReviewToolInput,
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			const absolutePath = resolveToCwd(path, cwd);
			let diffText = "";
			const tscErrors: TypeScriptError[] = [];

			// Run git diff
			if (checks.includes("diff")) {
				const diffArgs = ["diff"];
				if (staged) {
					diffArgs.push("--staged");
				} else {
					diffArgs.push(base);
				}
				diffArgs.push("--", absolutePath);

				try {
					const result = await ops.exec("git", diffArgs, { cwd, signal });
					diffText = result.stdout || "";
				} catch (error) {
					diffText = `Error running git diff: ${error instanceof Error ? error.message : String(error)}\n`;
				}
			}

			// Run tsc --noEmit
			if (checks.includes("tsc")) {
				try {
					const tscArgs = ["--noEmit", "--skipLibCheck"];
					const result = await ops.exec("npx", ["tsc", ...tscArgs], { cwd, signal });
					// tsc writes errors to stdout/stderr, parse both
					const allOutput = (result.stdout || "") + (result.stderr || "");
					tscErrors.push(...parseTscOutput(allOutput));
				} catch (error) {
					// tsc exits with non-zero on errors, which throws in execFile
					const allOutput = getExecFailureOutput(error);
					if (allOutput) tscErrors.push(...parseTscOutput(allOutput));
				}
			}

			// Parse diff and build report
			const diffStats = parseDiff(diffText);
			const markdown = buildMarkdownReport(diffStats, tscErrors, checks);

			return {
				content: [{ type: "text", text: markdown }],
				details: undefined,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const renderArgs = args as { path?: string } | undefined;
			const path = str(renderArgs?.path) ?? ".";
			const display = theme.fg("accent", shortenPath(path));
			text.setText(`${theme.fg("toolTitle", theme.bold("code-review"))} ${display}`);
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

export function createCodeReviewTool(cwd: string, options?: CodeReviewToolOptions): AgentTool<typeof codeReviewSchema> {
	return wrapToolDefinition(createCodeReviewToolDefinition(cwd, options));
}
