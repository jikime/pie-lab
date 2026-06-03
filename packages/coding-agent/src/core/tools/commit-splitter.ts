import type { AgentTool } from "@pie-lab/agent-core";
import { Text } from "@pie-lab/tui";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { type Static, Type } from "typebox";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import { resolveToCwd } from "./path-utils.ts";
import { shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const commitSplitterSchema = Type.Object({
	staged: Type.Optional(Type.Boolean({ description: "Split staged changes only (default: false)" })),
	base: Type.Optional(Type.String({ description: "Base branch or commit for comparison (default: HEAD)" })),
	maxGroups: Type.Optional(Type.Number({ description: "Maximum number of commit groups (default: 10)" })),
});

export type CommitSplitterToolInput = Static<typeof commitSplitterSchema>;

export interface CommitSplitterOperations {
	exec: (
		cmd: string,
		args: string[],
		opts: { cwd: string; signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

const execFile = promisify(execFileCallback);

const defaultCommitSplitterOperations: CommitSplitterOperations = {
	exec: async (cmd, args, opts) => {
		const { stdout, stderr } = (await execFile(cmd, args, {
			cwd: opts.cwd,
			signal: opts.signal,
			encoding: "utf-8",
		})) as { stdout: string; stderr: string };
		return { stdout, stderr, exitCode: 0 };
	},
};

export interface CommitSplitterToolOptions {
	operations?: CommitSplitterOperations;
}

// Data models
interface Hunk {
	file: string;
	header: string;
	oldStart: number;
	newStart: number;
	lines: string[];
}

type CommitCategory = "feat" | "fix" | "test" | "docs" | "chore" | "style" | "refactor";

interface CommitGroup {
	category: CommitCategory;
	label: string;
	files: string[];
	hunks: Hunk[];
	addedLines: number;
	deletedLines: number;
}

// Parser: convert raw diff to hunks
function parseDiffIntoHunks(diffText: string): Hunk[] {
	const hunks: Hunk[] = [];
	const lines = diffText.split("\n");
	let currentFile = "";
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// New file marker: "diff --git a/... b/..."
		if (line.startsWith("diff --git")) {
			const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
			if (match) {
				currentFile = match[2];
			}
		}

		// Hunk header: "@@ -oldStart,oldCount +newStart,newCount @@"
		if (line.startsWith("@@")) {
			const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
			if (match && currentFile) {
				const newStart = parseInt(match[1], 10);
				const header = line;
				const hunkLines: string[] = [];
				i++;

				// Collect hunk lines until next hunk or end
				while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git")) {
					const hunkLine = lines[i];
					if (hunkLine.startsWith("+") || hunkLine.startsWith("-") || hunkLine.startsWith(" ")) {
						hunkLines.push(hunkLine);
					}
					i++;
				}

				// Extract oldStart from header
				const oldMatch = line.match(/@@ -(\d+)/);
				const oldStart = oldMatch ? parseInt(oldMatch[1], 10) : 0;

				hunks.push({
					file: currentFile,
					header,
					oldStart,
					newStart,
					lines: hunkLines,
				});
				continue;
			}
		}

		i++;
	}

	return hunks;
}

// Classifier: assign hunks to commit groups by category
function classifyHunks(hunks: Hunk[]): CommitGroup[] {
	const groupMap = new Map<CommitCategory, CommitGroup>();

	for (const hunk of hunks) {
		let category: CommitCategory = "feat";
		let categoryName = "feat";

		// Classify by file path pattern
		if (/\.test\.ts$|\.spec\.ts$|__tests__/.test(hunk.file)) {
			category = "test";
			categoryName = "test";
		} else if (/\.md$|README|CHANGELOG/i.test(hunk.file)) {
			category = "docs";
			categoryName = "docs";
		} else if (/package\.json|pnpm-lock|package-lock|yarn\.lock/.test(hunk.file)) {
			category = "chore";
			categoryName = "chore";
		} else if (/\.css$|\.scss$|\.less$|\.svg$/.test(hunk.file)) {
			category = "style";
			categoryName = "style";
		} else if (/\.ts$|\.js$/.test(hunk.file)) {
			// Check hunk content for fix/refactor keywords
			const hunkContent = hunk.lines.join("\n");
			if (/fix:|bugfix|error|Error|FIX/i.test(hunkContent)) {
				category = "fix";
				categoryName = "fix";
			} else if (/refactor|optimize|clean/i.test(hunkContent)) {
				category = "refactor";
				categoryName = "refactor";
			}
		}

		// Add to existing group or create new
		if (!groupMap.has(category)) {
			const shortFile = hunk.file.split("/").pop() || hunk.file;
			groupMap.set(category, {
				category,
				label: `${categoryName}: ${shortFile}`,
				files: [hunk.file],
				hunks: [],
				addedLines: 0,
				deletedLines: 0,
			});
		}

		const group = groupMap.get(category)!;
		if (!group.files.includes(hunk.file)) {
			group.files.push(hunk.file);
		}
		group.hunks.push(hunk);

		// Count lines
		for (const line of hunk.lines) {
			if (line.startsWith("+") && !line.startsWith("+++")) {
				group.addedLines++;
			} else if (line.startsWith("-") && !line.startsWith("---")) {
				group.deletedLines++;
			}
		}
	}

	// Sort by category priority
	const categoryOrder: CommitCategory[] = ["chore", "style", "docs", "test", "refactor", "fix", "feat"];
	return Array.from(groupMap.values())
		.sort(
			(a, b) =>
				categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) ||
				a.label.localeCompare(b.label),
		)
		.map((group) => ({
			...group,
			files: group.files.sort(),
		}));
}

// Format: convert groups to readable markdown report
function formatMarkdownReport(groups: CommitGroup[], totalFiles: Set<string>): string {
	let report = "## Commit Split Plan\n\n";

	report += `Found **${groups.length} logical commit${groups.length !== 1 ? "s" : ""}** across **${totalFiles.size} changed file${totalFiles.size !== 1 ? "s" : ""}**:\n\n`;

	for (let i = 0; i < groups.length; i++) {
		const group = groups[i];
		report += `### Commit ${i + 1}: \`${group.label}\`\n`;
		report += `**Files (${group.files.length}):** ${group.files.map((f) => `\`${f}\``).join(", ")}\n`;
		report += `**Changes:** +${group.addedLines} / -${group.deletedLines}\n\n`;
		report += "```bash\n";
		report += `git add ${group.files.join(" ")}\n`;
		report += `git commit -m "${group.label}"\n`;
		report += "```\n\n";
	}

	return report;
}

export function createCommitSplitterToolDefinition(
	cwd: string,
	options?: CommitSplitterToolOptions,
): ToolDefinition<typeof commitSplitterSchema, undefined> {
	const ops = options?.operations ?? defaultCommitSplitterOperations;

	return {
		name: "commit-splitter",
		label: "commit-splitter",
		description: "Split git diff into logical commits by analyzing file paths and content patterns",
		promptSnippet: "Plan how to split changes into multiple commits",
		promptGuidelines: ["Use commit-splitter to organize changes before committing"],
		parameters: commitSplitterSchema,
		async execute(
			_toolCallId,
			{ staged = false, base = "HEAD", maxGroups = 10 }: CommitSplitterToolInput,
			signal?: AbortSignal,
			_onUpdate?,
			_ctx?,
		) {
			let diffText = "";

			// Run git diff
			try {
				const diffArgs = ["diff"];
				if (staged) {
					diffArgs.push("--staged");
				} else {
					diffArgs.push(base);
				}

				const result = await ops.exec("git", diffArgs, { cwd, signal });
				diffText = result.stdout || "";

				if (!diffText) {
					return {
						content: [{ type: "text", text: "No changes found to split." }],
						details: undefined,
					};
				}
			} catch (error) {
				return {
					content: [{ type: "text", text: `Error running git diff: ${error instanceof Error ? error.message : String(error)}` }],
					details: undefined,
				};
			}

			// Parse and classify
			const hunks = parseDiffIntoHunks(diffText);
			if (hunks.length === 0) {
				return {
					content: [{ type: "text", text: "No changes found to split." }],
					details: undefined,
				};
			}

			let groups = classifyHunks(hunks);

			// Limit to maxGroups
			if (groups.length > maxGroups) {
				groups = groups.slice(0, maxGroups);
			}

			// Collect all files
			const allFiles = new Set<string>();
			for (const group of groups) {
				for (const file of group.files) {
					allFiles.add(file);
				}
			}

			const markdown = formatMarkdownReport(groups, allFiles);

			return {
				content: [{ type: "text", text: markdown }],
				details: undefined,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const renderArgs = args as { staged?: boolean } | undefined;
			const staged = renderArgs?.staged ? " (staged)" : "";
			text.setText(`${theme.fg("toolTitle", theme.bold("commit-splitter"))}${staged}`);
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

export function createCommitSplitterTool(
	cwd: string,
	options?: CommitSplitterToolOptions,
): AgentTool<typeof commitSplitterSchema> {
	return wrapToolDefinition(createCommitSplitterToolDefinition(cwd, options));
}
