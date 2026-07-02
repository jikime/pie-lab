import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool } from "@pie-lab/agent-core";
import type { Api, ImageContent, Model, TextContent } from "@pie-lab/ai";
import {
	formatHashlineHeader,
	formatNumberedLines,
	normalizeSnapshotText,
	type SnapshotStore,
} from "@pie-lab/hashline";
import { Text } from "@pie-lab/tui";
import { constants, createReadStream } from "fs";
import { access as fsAccess, readFile as fsReadFile } from "fs/promises";
import { type Static, Type } from "typebox";
import { getReadmePath } from "../../config.ts";
import { keyHint, keyText } from "../../modes/interactive/components/keybinding-hints.ts";
import { getLanguageFromPath, highlightCode, type Theme } from "../../modes/interactive/theme/theme.ts";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import { formatPathRelativeToCwdOrAbsolute } from "../../utils/paths.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import type { ConflictEntry, ConflictHistory } from "./conflict-history.ts";
import {
	createDefaultInternalURLRouter,
	type InternalURLRouter,
	isInternalURL,
	parseInternalURL,
} from "./internal-urls.ts";
import { resolveReadPathAsync, resolveToCwd } from "./path-utils.ts";
import { getTextOutput, renderToolPath, replaceTabs, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateHead } from "./truncate.ts";

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	truncation?: TruncationResult;
}

interface CompactReadClassification {
	kind: "docs" | "resource" | "skill";
	label: string;
}

const COMPACT_RESOURCE_FILE_NAMES = new Set(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Check if file is readable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
	/** Detect image MIME type, return null or undefined for non-images */
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Custom operations for file reading. Default: local filesystem */
	operations?: ReadOperations;
	/** Emit hashline headers and numbered lines for editable text files. Default: false */
	useHashline?: boolean;
	/** Shared snapshot store for hashline edits. Required when useHashline is true. */
	snapshotStore?: SnapshotStore;
	/** Shared merge-conflict registry for conflict:// reads. */
	conflictHistory?: ConflictHistory;
	/** Router for internal URLs such as agent://, skill://, pr://, and conflict://. */
	internalUrlRouter?: InternalURLRouter;
}

type ReadRenderArgs = { path?: string; file_path?: string; offset?: number; limit?: number };

function formatReadLineRange(args: ReadRenderArgs | undefined, theme: Theme): string {
	if (args?.offset === undefined && args?.limit === undefined) return "";
	const startLine = args.offset ?? 1;
	const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
	return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

function formatReadCall(args: ReadRenderArgs | undefined, theme: Theme, cwd: string): string {
	const pathDisplay = renderToolPath(str(args?.file_path ?? args?.path), theme, cwd);
	return `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}${formatReadLineRange(args, theme)}`;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") {
		end--;
	}
	return lines.slice(0, end);
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
	if (!model || model.input.includes("image")) {
		return undefined;
	}
	return "[Current model does not support images. The image will be omitted from this request.]";
}

function toPosixPath(filePath: string): string {
	return filePath.split(sep).join("/");
}

function splitDisplayLines(text: string): string[] {
	if (text === "") return [""];
	const withoutFinalNewline = text.endsWith("\n") ? text.slice(0, -1) : text;
	return withoutFinalNewline.split("\n");
}

type TextReadSelection = {
	absolutePath: string;
	cwd: string;
	inputPath: string;
	selectedContent: string;
	totalFileLines: number;
	startLine: number;
	startLineDisplay: number;
	firstSelectedLine: string;
	userLimitedLines?: number;
	hashlineTag?: string;
	conflictEntries?: ConflictEntry[];
	truncation?: TruncationResult;
};

type StreamedTextRead = {
	selectedContent: string;
	totalFileLines: number;
	firstSelectedLine: string;
	userLimitedLines?: number;
	truncation: TruncationResult;
};

function formatTextReadSelection(selection: TextReadSelection): {
	content: [{ type: "text"; text: string }];
	details: ReadToolDetails | undefined;
} {
	const truncation = selection.truncation ?? truncateHead(selection.selectedContent);
	let fileOutputText: string;
	let includeNumberedContent = true;
	const notices: string[] = [];
	let details: ReadToolDetails | undefined;
	if (truncation.firstLineExceedsLimit) {
		const firstLineSize = formatSize(Buffer.byteLength(selection.firstSelectedLine, "utf-8"));
		fileOutputText = "";
		includeNumberedContent = false;
		notices.push(
			`[Line ${selection.startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${selection.startLineDisplay}p' ${selection.inputPath} | head -c ${DEFAULT_MAX_BYTES}]`,
		);
		details = { truncation };
	} else if (truncation.truncated) {
		const endLineDisplay = selection.startLineDisplay + truncation.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		fileOutputText = truncation.content;
		if (truncation.truncatedBy === "lines") {
			notices.push(
				`[Showing lines ${selection.startLineDisplay}-${endLineDisplay} of ${selection.totalFileLines}. Use offset=${nextOffset} to continue.]`,
			);
		} else {
			notices.push(
				`[Showing lines ${selection.startLineDisplay}-${endLineDisplay} of ${selection.totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`,
			);
		}
		details = { truncation };
	} else if (
		selection.userLimitedLines !== undefined &&
		selection.startLine + selection.userLimitedLines < selection.totalFileLines
	) {
		const remaining = selection.totalFileLines - (selection.startLine + selection.userLimitedLines);
		const nextOffset = selection.startLine + selection.userLimitedLines + 1;
		fileOutputText = truncation.content;
		notices.push(`[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`);
	} else {
		fileOutputText = truncation.content;
	}

	let outputText: string;
	if (selection.hashlineTag) {
		const displayPath = formatPathRelativeToCwdOrAbsolute(selection.absolutePath, selection.cwd);
		outputText = formatHashlineHeader(displayPath, selection.hashlineTag);
		if (includeNumberedContent) {
			outputText += `\n${formatNumberedLines(fileOutputText, selection.startLineDisplay)}`;
		}
		if (notices.length > 0) {
			outputText += `\n\n${notices.join("\n")}`;
		}
	} else if (notices.length > 0) {
		outputText = fileOutputText ? `${fileOutputText}\n\n${notices.join("\n")}` : notices.join("\n");
	} else {
		outputText = fileOutputText;
	}
	const conflictEntries = selection.conflictEntries ?? [];
	if (conflictEntries.length > 0) {
		const urls = conflictEntries.map((entry) => `conflict://${entry.id}`).join(", ");
		outputText += `\n\n[Detected ${conflictEntries.length} merge conflict${conflictEntries.length === 1 ? "" : "s"}: ${urls}]`;
	}

	return {
		content: [{ type: "text", text: outputText }],
		details,
	};
}

function createStreamedTruncation(
	outputLines: string[],
	selectedLineCount: number,
	selectedBytes: number,
	firstLineExceedsLimit: boolean,
	byteLimitReached: boolean,
): TruncationResult {
	const selectedContentIsEmpty = selectedLineCount === 0 || (selectedLineCount === 1 && selectedBytes === 0);
	const totalLines = selectedContentIsEmpty ? 0 : selectedLineCount;
	const totalBytes = selectedContentIsEmpty ? 0 : selectedBytes;
	const outputContent = selectedContentIsEmpty ? "" : outputLines.join("\n");
	const outputBytes = Buffer.byteLength(outputContent, "utf-8");
	const outputLineCount = selectedContentIsEmpty ? 0 : outputLines.length;
	const truncated = firstLineExceedsLimit || totalLines > DEFAULT_MAX_LINES || totalBytes > DEFAULT_MAX_BYTES;
	let truncatedBy: TruncationResult["truncatedBy"] = null;
	if (truncated) {
		truncatedBy = firstLineExceedsLimit || byteLimitReached ? "bytes" : "lines";
	}

	return {
		content: outputContent,
		truncated,
		truncatedBy,
		totalLines,
		totalBytes,
		outputLines: outputLineCount,
		outputBytes,
		lastLinePartial: false,
		firstLineExceedsLimit,
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	};
}

async function readLocalTextSelection(
	absolutePath: string,
	startLine: number,
	limit: number | undefined,
	signal: AbortSignal | undefined,
): Promise<StreamedTextRead> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new Error("Operation aborted"));
			return;
		}

		let settled = false;
		let totalFileLines = 0;
		let selectedLineCount = 0;
		let selectedBytes = 0;
		let outputBytes = 0;
		let firstSelectedLine = "";
		let firstLineExceedsLimit = false;
		let byteLimitReached = false;
		const outputLines: string[] = [];
		const stream = createReadStream(absolutePath, { encoding: "utf8" });
		const rl = createInterface({ input: stream, crlfDelay: Infinity });

		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			cleanup();
			fn();
		};
		const onAbort = () => {
			stream.destroy();
			settle(() => reject(new Error("Operation aborted")));
		};

		signal?.addEventListener("abort", onAbort, { once: true });

		rl.on("line", (line) => {
			const zeroBasedLine = totalFileLines;
			totalFileLines++;
			if (zeroBasedLine < startLine || (limit !== undefined && selectedLineCount >= limit)) {
				return;
			}

			const lineBytes = Buffer.byteLength(line, "utf-8");
			if (selectedLineCount === 0) {
				firstSelectedLine = line;
				firstLineExceedsLimit = lineBytes > DEFAULT_MAX_BYTES;
			}
			selectedLineCount++;
			selectedBytes += lineBytes + (selectedLineCount > 1 ? 1 : 0);

			if (!firstLineExceedsLimit && !byteLimitReached && outputLines.length < DEFAULT_MAX_LINES) {
				const outputLineBytes = lineBytes + (outputLines.length > 0 ? 1 : 0);
				if (outputBytes + outputLineBytes <= DEFAULT_MAX_BYTES) {
					outputLines.push(line);
					outputBytes += outputLineBytes;
				} else {
					byteLimitReached = true;
				}
			}
		});
		rl.on("close", () => {
			if (totalFileLines === 0) {
				totalFileLines = 1;
			}
			const userLimitedLines =
				limit !== undefined ? Math.min(limit, Math.max(0, totalFileLines - startLine)) : undefined;
			settle(() =>
				resolve({
					selectedContent: outputLines.join("\n"),
					totalFileLines,
					firstSelectedLine,
					userLimitedLines,
					truncation: createStreamedTruncation(
						outputLines,
						selectedLineCount,
						selectedBytes,
						firstLineExceedsLimit,
						byteLimitReached,
					),
				}),
			);
		});
		stream.on("error", (error) => {
			settle(() => reject(error));
		});
	});
}

function getPiDocsClassification(absolutePath: string): CompactReadClassification | undefined {
	const packageRoot = dirname(getReadmePath());
	const relativePath = relative(resolvePath(packageRoot), resolvePath(absolutePath));
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return undefined;
	}

	const label = toPosixPath(relativePath);
	if (label === "README.md" || label.startsWith("docs/") || label.startsWith("examples/")) {
		return { kind: "docs", label };
	}
	return undefined;
}

function getCompactReadClassification(
	args: ReadRenderArgs | undefined,
	cwd: string,
): CompactReadClassification | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	if (!rawPath) return undefined;

	const absolutePath = resolveToCwd(rawPath, cwd);
	const fileName = basename(absolutePath);
	if (fileName === "SKILL.md") {
		return { kind: "skill", label: basename(dirname(absolutePath)) || fileName };
	}

	const docsClassification = getPiDocsClassification(absolutePath);
	if (docsClassification) return docsClassification;

	if (COMPACT_RESOURCE_FILE_NAMES.has(fileName)) {
		return { kind: "resource", label: formatPathRelativeToCwdOrAbsolute(absolutePath, cwd) };
	}

	return undefined;
}

function formatCompactReadCall(
	classification: CompactReadClassification,
	args: ReadRenderArgs | undefined,
	theme: Theme,
): string {
	const expandHint = theme.fg("dim", ` (${keyText("app.tools.expand")} to expand)`);
	if (classification.kind === "skill") {
		return (
			theme.fg("customMessageLabel", `\x1b[1m[skill]\x1b[22m `) +
			theme.fg("customMessageText", classification.label) +
			formatReadLineRange(args, theme) +
			expandHint
		);
	}

	return (
		theme.fg("toolTitle", theme.bold(`read ${classification.kind}`)) +
		" " +
		theme.fg("accent", classification.label) +
		formatReadLineRange(args, theme) +
		expandHint
	);
}

function formatReadResult(
	args: ReadRenderArgs | undefined,
	result: { content: (TextContent | ImageContent)[]; details?: ReadToolDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	showImages: boolean,
	_cwd: string,
	isError: boolean,
): string {
	if (!options.expanded && !isError) {
		return "";
	}

	const rawPath = str(args?.file_path ?? args?.path);
	const output = getTextOutput(result, showImages);
	const lang = rawPath ? getLanguageFromPath(rawPath) : undefined;
	const renderedLines = lang ? highlightCode(replaceTabs(output), lang) : output.split("\n");
	const lines = trimTrailingEmptyLines(renderedLines);
	const maxLines = options.expanded ? lines.length : 10;
	const displayLines = lines.slice(0, maxLines);
	const remaining = lines.length - maxLines;
	let text = `\n${displayLines.map((line) => (lang ? replaceTabs(line) : theme.fg("toolOutput", replaceTabs(line)))).join("\n")}`;
	if (remaining > 0) {
		text += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}

	const truncation = result.details?.truncation;
	if (truncation?.truncated) {
		if (truncation.firstLineExceedsLimit) {
			text += `\n${theme.fg("warning", `[First line exceeds ${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit]`)}`;
		} else if (truncation.truncatedBy === "lines") {
			text += `\n${theme.fg("warning", `[Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${truncation.maxLines ?? DEFAULT_MAX_LINES} line limit)]`)}`;
		} else {
			text += `\n${theme.fg("warning", `[Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)]`)}`;
		}
	}
	return text;
}

export function createReadToolDefinition(
	cwd: string,
	options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails | undefined> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const ops = options?.operations ?? defaultReadOperations;
	const useHashline = options?.useHashline ?? false;
	const snapshotStore = options?.snapshotStore;
	const conflictHistory = options?.conflictHistory;
	const internalUrlRouter = options?.internalUrlRouter ?? createDefaultInternalURLRouter();
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
		promptSnippet: "Read file contents",
		promptGuidelines: ["Use read to examine files instead of cat or sed."],
		parameters: readSchema,
		async execute(
			_toolCallId,
			{ path, offset, limit }: { path: string; offset?: number; limit?: number },
			signal?: AbortSignal,
			_onUpdate?,
			ctx?,
		) {
			const throwIfAborted = (): void => {
				if (signal?.aborted) throw new Error("Operation aborted");
			};

			throwIfAborted();
			const nonVisionImageNote = getNonVisionImageNote(ctx?.model);

			if (isInternalURL(path)) {
				const parsedUrl = parseInternalURL(path);
				if (!parsedUrl) {
					throw new Error(`Invalid internal URL format: ${path}`);
				}
				const resolvedContent = await internalUrlRouter.resolve(parsedUrl, { conflictHistory });
				throwIfAborted();
				if (resolvedContent === null) {
					throw new Error(`Could not resolve internal URL: ${path}`);
				}
				return {
					content: [{ type: "text", text: resolvedContent }],
					details: undefined,
				};
			}

			const absolutePath = await resolveReadPathAsync(path, cwd);
			throwIfAborted();
			await ops.access(absolutePath);
			throwIfAborted();

			const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
			throwIfAborted();
			if (mimeType) {
				const buffer = await ops.readFile(absolutePath);
				throwIfAborted();
				const processed = await processImage(buffer, mimeType, { autoResizeImages });
				throwIfAborted();
				if (!processed.ok) {
					let textNote = `Read image file [${mimeType}]\n${processed.message}`;
					if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
					return { content: [{ type: "text", text: textNote }], details: undefined };
				}

				let textNote = `Read image file [${processed.mimeType}]`;
				if (processed.hints.length > 0) textNote += `\n${processed.hints.join("\n")}`;
				if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
				return {
					content: [
						{ type: "text", text: textNote },
						{ type: "image", data: processed.data, mimeType: processed.mimeType },
					],
					details: undefined,
				};
			}

			const startLine = offset ? Math.max(0, offset - 1) : 0;
			const startLineDisplay = startLine + 1;
			const canStreamText =
				(offset !== undefined || (limit !== undefined && limit > 0)) &&
				ops === defaultReadOperations &&
				!useHashline &&
				!conflictHistory;
			if (canStreamText) {
				const streamedRead = await readLocalTextSelection(absolutePath, startLine, limit, signal);
				throwIfAborted();
				if (startLine >= streamedRead.totalFileLines) {
					throw new Error(`Offset ${offset} is beyond end of file (${streamedRead.totalFileLines} lines total)`);
				}
				return formatTextReadSelection({
					absolutePath,
					cwd,
					inputPath: path,
					selectedContent: streamedRead.selectedContent,
					totalFileLines: streamedRead.totalFileLines,
					startLine,
					startLineDisplay,
					firstSelectedLine: streamedRead.firstSelectedLine,
					userLimitedLines: streamedRead.userLimitedLines,
					truncation: streamedRead.truncation,
				});
			}

			const buffer = await ops.readFile(absolutePath);
			throwIfAborted();
			const textContent = buffer.toString("utf-8");
			const normalizedTextContent = normalizeSnapshotText(textContent);
			const hashlineTag =
				useHashline && snapshotStore ? snapshotStore.record(absolutePath, normalizedTextContent) : undefined;
			const allLines = splitDisplayLines(normalizedTextContent);
			const conflictEntries = conflictHistory?.register(absolutePath, normalizedTextContent) ?? [];
			const totalFileLines = allLines.length;
			if (startLine >= totalFileLines) {
				throw new Error(`Offset ${offset} is beyond end of file (${totalFileLines} lines total)`);
			}

			let selectedContent: string;
			let userLimitedLines: number | undefined;
			if (limit !== undefined) {
				const endLine = Math.min(startLine + limit, totalFileLines);
				selectedContent = allLines.slice(startLine, endLine).join("\n");
				userLimitedLines = endLine - startLine;
			} else {
				selectedContent = allLines.slice(startLine).join("\n");
			}

			return formatTextReadSelection({
				absolutePath,
				cwd,
				inputPath: path,
				selectedContent,
				totalFileLines,
				startLine,
				startLineDisplay,
				firstSelectedLine: allLines[startLine] ?? "",
				userLimitedLines,
				hashlineTag,
				conflictEntries,
			});
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const classification = !context.expanded ? getCompactReadClassification(args, context.cwd) : undefined;
			text.setText(
				classification
					? formatCompactReadCall(classification, args, theme)
					: formatReadCall(args, theme, context.cwd),
			);
			return text;
		},
		renderResult(result, options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				formatReadResult(context.args, result, options, theme, context.showImages, context.cwd, context.isError),
			);
			return text;
		},
	};
}

export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
	return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
