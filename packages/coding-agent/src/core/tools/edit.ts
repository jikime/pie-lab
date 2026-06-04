import type { AgentTool } from "@pie-lab/agent-core";
import {
	applyHashlineEdits,
	applyHashlineSectionToText,
	applyHashlineSectionWithRecovery,
	normalizeSnapshotText,
	parseHashlinePatch,
	type SnapshotStore,
	validateHashlineSnapshot,
} from "@pie-lab/hashline";
import { Box, Container, Spacer, Text } from "@pie-lab/tui";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { type Static, Type } from "typebox";
import { renderDiff } from "../../modes/interactive/components/diff.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import type { ConflictHistory } from "./conflict-history.ts";
import {
	applyEditsToNormalizedContent,
	computeEditsDiff,
	detectLineEnding,
	type Edit,
	type EditDiffError,
	type EditDiffResult,
	generateDiffString,
	generateUnifiedPatch,
	normalizeToLF,
	restoreLineEndings,
	stripBom,
} from "./edit-diff.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { invalidArgText, shortenPath, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

type EditPreview = EditDiffResult | EditDiffError;

type EditRenderState = {
	callComponent?: EditCallRenderComponent;
};

const replaceEditSchema = Type.Object(
	{
		oldText: Type.String({
			description:
				"Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call.",
		}),
		newText: Type.String({ description: "Replacement text for this targeted edit." }),
		hash: Type.Optional(
			Type.String({
				description: "Optional SHA256 hash of the target line for anchor recovery when file has changed.",
			}),
		),
		before: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional context lines before the target (for fuzzy recovery).",
			}),
		),
		after: Type.Optional(
			Type.Array(Type.String(), {
				description: "Optional context lines after the target (for fuzzy recovery).",
			}),
		),
	},
	{ additionalProperties: false },
);

const editSchema = Type.Object(
	{
		path: Type.Optional(Type.String({ description: "Path to the file to edit (relative or absolute)" })),
		edits: Type.Optional(
			Type.Array(replaceEditSchema, {
				description:
					"One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
			}),
		),
		input: Type.Optional(
			Type.String({
				description:
					"Hashline patch input using ¶PATH#TAG headers from read output plus replace/delete/insert operations.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;
type LegacyEditToolInput = EditToolInput & {
	oldText?: unknown;
	newText?: unknown;
};

export interface EditToolDetails {
	/** Display-oriented diff of the changes made */
	diff: string;
	/** Standard unified patch of the changes made */
	patch: string;
	/** Line number of the first change in the new file (for editor navigation) */
	firstChangedLine?: number;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (for example SSH).
 */
export interface EditOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Check if file is readable and writable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
	/** Custom operations for file editing. Default: local filesystem */
	operations?: EditOperations;
	/** Shared snapshot store for hashline patch edits. */
	snapshotStore?: SnapshotStore;
	/** Shared merge-conflict registry to invalidate stale conflict:// entries after edits. */
	conflictHistory?: ConflictHistory;
}

function prepareEditArguments(input: unknown): EditToolInput {
	if (!input || typeof input !== "object") {
		return input as EditToolInput;
	}

	const args = input as Record<string, unknown>;

	// Some models (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array
	if (typeof args.edits === "string") {
		try {
			const parsed = JSON.parse(args.edits);
			if (Array.isArray(parsed)) args.edits = parsed;
		} catch {}
	}

	const legacy = args as LegacyEditToolInput;
	if (typeof legacy.oldText !== "string" || typeof legacy.newText !== "string") {
		return args as EditToolInput;
	}

	const edits = Array.isArray(legacy.edits) ? [...legacy.edits] : [];
	edits.push({ oldText: legacy.oldText, newText: legacy.newText });
	const { oldText: _oldText, newText: _newText, ...rest } = legacy;
	return { ...rest, edits } as EditToolInput;
}

function validateEditInput(input: EditToolInput): { path: string; edits: Edit[] } {
	if (typeof input.input === "string") {
		throw new Error("Hashline input must be handled by the hashline edit path.");
	}
	if (typeof input.path !== "string" || input.path.length === 0) {
		throw new Error("Edit tool input is invalid. path is required for replacement edits.");
	}
	if (!Array.isArray(input.edits) || input.edits.length === 0) {
		throw new Error("Edit tool input is invalid. edits must contain at least one replacement.");
	}
	return { path: input.path, edits: input.edits };
}

type RenderableEditArgs = {
	path?: string;
	file_path?: string;
	edits?: Edit[];
	oldText?: string;
	newText?: string;
};

type EditToolResultLike = {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: EditToolDetails;
};

type EditCallRenderComponent = Box & {
	preview?: EditPreview;
	previewArgsKey?: string;
	previewPending?: boolean;
	settledError?: boolean;
};

function createEditCallRenderComponent(): EditCallRenderComponent {
	return Object.assign(new Box(1, 1, (text: string) => text), {
		preview: undefined as EditPreview | undefined,
		previewArgsKey: undefined as string | undefined,
		previewPending: false,
		settledError: false,
	});
}

function getEditCallRenderComponent(state: EditRenderState, lastComponent: unknown): EditCallRenderComponent {
	if (lastComponent instanceof Box) {
		const component = lastComponent as EditCallRenderComponent;
		state.callComponent = component;
		return component;
	}
	if (state.callComponent) {
		return state.callComponent;
	}
	const component = createEditCallRenderComponent();
	state.callComponent = component;
	return component;
}

/**
 * Try to apply edits using Hashline if hash/context info is available.
 * Falls back to traditional string matching if Hashline fails or lacks context.
 */
function tryApplyWithHashline(content: string, edits: Edit[]): { newContent: string; usedHashline: boolean } | null {
	// Only use Hashline if at least one edit has hash/context
	const hasHashlineInfo = edits.some((e) => e.hash || e.before || e.after);
	if (!hasHashlineInfo) return null;
	if (edits.some((edit) => edit.oldText.includes("\n"))) return null;

	const result = applyHashlineEdits(
		content,
		edits.map((edit) => ({
			anchor: edit.oldText,
			hash: edit.hash,
			before: edit.before,
			after: edit.after,
			newText: edit.newText,
		})),
	);
	if (result.error) return null;

	return { newContent: result.text, usedHashline: true };
}

function getRenderablePreviewInput(args: RenderableEditArgs | undefined): { path: string; edits: Edit[] } | null {
	if (!args) {
		return null;
	}

	const path = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
	if (!path) {
		return null;
	}

	if (
		Array.isArray(args.edits) &&
		args.edits.length > 0 &&
		args.edits.every((edit) => typeof edit?.oldText === "string" && typeof edit?.newText === "string")
	) {
		return { path, edits: args.edits };
	}

	if (typeof args.oldText === "string" && typeof args.newText === "string") {
		return { path, edits: [{ oldText: args.oldText, newText: args.newText }] };
	}

	return null;
}

function formatEditCall(args: RenderableEditArgs | undefined, theme: Theme): string {
	const invalidArg = invalidArgText(theme);
	const rawPath = str(args?.file_path ?? args?.path);
	const path = rawPath !== null ? shortenPath(rawPath) : null;
	const pathDisplay = path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
	return `${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`;
}

function formatEditResult(
	args: RenderableEditArgs | undefined,
	preview: EditPreview | undefined,
	result: EditToolResultLike,
	theme: Theme,
	isError: boolean,
): string | undefined {
	const rawPath = str(args?.file_path ?? args?.path);
	const previewDiff = preview && !("error" in preview) ? preview.diff : undefined;
	const previewError = preview && "error" in preview ? preview.error : undefined;
	if (isError) {
		const errorText = result.content
			.filter((c) => c.type === "text")
			.map((c) => c.text || "")
			.join("\n");
		if (!errorText || errorText === previewError) {
			return undefined;
		}
		return theme.fg("error", errorText);
	}

	const resultDiff = result.details?.diff;
	if (resultDiff && resultDiff !== previewDiff) {
		return renderDiff(resultDiff, { filePath: rawPath ?? undefined });
	}

	return undefined;
}

function getEditHeaderBg(
	preview: EditPreview | undefined,
	settledError: boolean | undefined,
	theme: Theme,
): (text: string) => string {
	if (preview) {
		if ("error" in preview) {
			return (text: string) => theme.bg("toolErrorBg", text);
		}
		return (text: string) => theme.bg("toolSuccessBg", text);
	}
	if (settledError) {
		return (text: string) => theme.bg("toolErrorBg", text);
	}
	return (text: string) => theme.bg("toolPendingBg", text);
}

function buildEditCallComponent(
	component: EditCallRenderComponent,
	args: RenderableEditArgs | undefined,
	theme: Theme,
): EditCallRenderComponent {
	component.setBgFn(getEditHeaderBg(component.preview, component.settledError, theme));
	component.clear();
	component.addChild(new Text(formatEditCall(args, theme), 0, 0));

	if (!component.preview) {
		return component;
	}

	const body =
		"error" in component.preview ? theme.fg("error", component.preview.error) : renderDiff(component.preview.diff);
	component.addChild(new Spacer(1));
	component.addChild(new Text(body, 0, 0));
	return component;
}

function setEditPreview(
	component: EditCallRenderComponent,
	preview: EditPreview,
	argsKey: string | undefined,
): boolean {
	const current = component.preview;
	const changed =
		current === undefined ||
		("error" in current && "error" in preview
			? current.error !== preview.error
			: "error" in current !== "error" in preview) ||
		(!("error" in current) &&
			!("error" in preview) &&
			(current.diff !== preview.diff || current.firstChangedLine !== preview.firstChangedLine));
	component.preview = preview;
	component.previewArgsKey = argsKey;
	component.previewPending = false;
	return changed;
}

export function createEditToolDefinition(
	cwd: string,
	options?: EditToolOptions,
): ToolDefinition<typeof editSchema, EditToolDetails | undefined, EditRenderState> {
	const ops = options?.operations ?? defaultEditOperations;
	const snapshotStore = options?.snapshotStore;
	const conflictHistory = options?.conflictHistory;
	return {
		name: "edit",
		label: "edit",
		description:
			"Edit files using either hashline patches from read output or exact text replacement. Prefer hashline input when read returned ¶PATH#TAG numbered content.",
		promptSnippet: "Make precise file edits with hashline patches or exact text replacement",
		promptGuidelines: [
			"When read output includes a ¶PATH#TAG header, prefer edit input with hashline replace/delete/insert operations.",
			"Hashline examples: replace 2..3: followed by +new lines; delete 5; insert after 8: followed by +new lines.",
			"Use edit for precise changes (edits[].oldText must match exactly)",
			"When changing multiple separate locations in one file, use one edit call with multiple entries in edits[] instead of multiple edit calls",
			"Each edits[].oldText is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits. Merge nearby changes into one edit.",
			"Keep edits[].oldText as small as possible while still being unique in the file. Do not pad with large unchanged regions.",
		],
		parameters: editSchema,
		renderShell: "self",
		prepareArguments: prepareEditArguments,
		async execute(_toolCallId, input: EditToolInput, signal?: AbortSignal, _onUpdate?, _ctx?) {
			if (typeof input.input === "string") {
				if (!snapshotStore) {
					throw new Error("Hashline edit input is not available in this session.");
				}
				const patch = parseHashlinePatch(input.input);
				const seenFiles = new Set<string>();
				const updates: Array<{
					path: string;
					absolutePath: string;
					baseContent: string;
					newContent: string;
					originalEnding: "\r\n" | "\n";
					bom: string;
					recovered: boolean;
				}> = [];

				for (const section of patch.sections) {
					const absolutePath = resolveToCwd(section.path, cwd);
					if (seenFiles.has(absolutePath)) {
						throw new Error(`Multiple hashline sections target the same file: ${section.path}`);
					}
					seenFiles.add(absolutePath);

					await ops.access(absolutePath);
					if (signal?.aborted) throw new Error("Operation aborted");
					const buffer = await ops.readFile(absolutePath);
					if (signal?.aborted) throw new Error("Operation aborted");
					const rawContent = buffer.toString("utf-8");
					const { bom, text: content } = stripBom(rawContent);
					const originalEnding = detectLineEnding(content);
					const normalizedContent = normalizeToLF(content);
					const snapshot = snapshotStore.byHash(absolutePath, section.hash);
					let newContent: string;
					let recovered = false;
					if (snapshot) {
						const result = applyHashlineSectionWithRecovery(snapshot.text, normalizedContent, section);
						newContent = result.text;
						recovered = result.recovered;
					} else {
						validateHashlineSnapshot(normalizedContent, section.hash, section.path);
						newContent = applyHashlineSectionToText(normalizeSnapshotText(normalizedContent), section);
					}
					updates.push({
						path: section.path,
						absolutePath,
						baseContent: normalizeSnapshotText(normalizedContent),
						newContent,
						originalEnding,
						bom,
						recovered,
					});
				}

				for (const update of updates) {
					await withFileMutationQueue(update.absolutePath, async () => {
						if (signal?.aborted) throw new Error("Operation aborted");
						await ops.writeFile(
							update.absolutePath,
							update.bom + restoreLineEndings(update.newContent, update.originalEnding),
						);
						snapshotStore.record(update.absolutePath, update.newContent);
						conflictHistory?.clearPath(update.absolutePath);
					});
				}

				const baseContent = updates.map((update) => `--- ${update.path}\n${update.baseContent}`).join("\n");
				const newContent = updates.map((update) => `--- ${update.path}\n${update.newContent}`).join("\n");
				const diffResult = generateDiffString(baseContent, newContent);
				const recoveredCount = updates.filter((update) => update.recovered).length;
				return {
					content: [
						{
							type: "text",
							text:
								`Successfully applied hashline edit to ${updates.length} file(s).` +
								(recoveredCount > 0 ? ` Recovered stale snapshot for ${recoveredCount} file(s).` : ""),
						},
					],
					details: {
						diff: diffResult.diff,
						patch: updates
							.map((update) => generateUnifiedPatch(update.path, update.baseContent, update.newContent))
							.join("\n"),
						firstChangedLine: diffResult.firstChangedLine,
					},
				};
			}

			const { path, edits } = validateEditInput(input);
			const absolutePath = resolveToCwd(path, cwd);

			return withFileMutationQueue(absolutePath, async () => {
				// Do not reject from an abort event listener here: that would release the
				// mutation queue while an in-flight filesystem operation may still finish.
				// Checking signal.aborted after each await observes the same aborts while
				// keeping the queue locked until the current operation has settled.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();

				// Check if file exists.
				try {
					await ops.access(absolutePath);
				} catch (error: unknown) {
					throwIfAborted();
					const errorMessage =
						error instanceof Error && "code" in error ? `Error code: ${error.code}` : String(error);
					throw new Error(`Could not edit file: ${path}. ${errorMessage}.`);
				}
				throwIfAborted();

				// Read the file.
				const buffer = await ops.readFile(absolutePath);
				const rawContent = buffer.toString("utf-8");
				throwIfAborted();

				// Strip BOM before matching. The model will not include an invisible BOM in oldText.
				const { bom, text: content } = stripBom(rawContent);
				const originalEnding = detectLineEnding(content);
				const normalizedContent = normalizeToLF(content);

				// Try Hashline first if hash/context info is available
				let baseContent = normalizedContent;
				let newContent: string;
				const hashlineResult = tryApplyWithHashline(normalizedContent, edits);

				if (hashlineResult) {
					// Hashline succeeded
					newContent = hashlineResult.newContent;
				} else {
					// Fall back to traditional string matching
					const result = applyEditsToNormalizedContent(normalizedContent, edits, path);
					baseContent = result.baseContent;
					newContent = result.newContent;
				}
				throwIfAborted();

				const finalContent = bom + restoreLineEndings(newContent, originalEnding);
				await ops.writeFile(absolutePath, finalContent);
				snapshotStore?.record(absolutePath, newContent);
				conflictHistory?.clearPath(absolutePath);
				throwIfAborted();

				const diffResult = generateDiffString(baseContent, newContent);
				const patch = generateUnifiedPatch(path, baseContent, newContent);
				return {
					content: [
						{
							type: "text",
							text: `Successfully replaced ${edits.length} block(s) in ${path}.`,
						},
					],
					details: { diff: diffResult.diff, patch, firstChangedLine: diffResult.firstChangedLine },
				};
			});
		},
		renderCall(args, theme, context) {
			const component = getEditCallRenderComponent(context.state, context.lastComponent);
			const previewInput = getRenderablePreviewInput(args as RenderableEditArgs | undefined);
			const argsKey = previewInput
				? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
				: undefined;

			if (component.previewArgsKey !== argsKey) {
				component.preview = undefined;
				component.previewArgsKey = argsKey;
				component.previewPending = false;
				component.settledError = false;
			}

			if (context.argsComplete && previewInput && !component.preview && !component.previewPending) {
				component.previewPending = true;
				const requestKey = argsKey;
				void computeEditsDiff(previewInput.path, previewInput.edits, context.cwd).then((preview) => {
					if (component.previewArgsKey === requestKey) {
						setEditPreview(component, preview, requestKey);
						context.invalidate();
					}
				});
			}

			return buildEditCallComponent(component, args, theme);
		},
		renderResult(result, _options, theme, context) {
			const callComponent = context.state.callComponent;
			const previewInput = getRenderablePreviewInput(context.args as RenderableEditArgs | undefined);
			const argsKey = previewInput
				? JSON.stringify({ path: previewInput.path, edits: previewInput.edits })
				: undefined;
			const typedResult = result as EditToolResultLike;
			const resultDiff = !context.isError ? typedResult.details?.diff : undefined;
			let changed = false;
			if (callComponent) {
				if (typeof resultDiff === "string") {
					changed =
						setEditPreview(
							callComponent,
							{ diff: resultDiff, firstChangedLine: typedResult.details?.firstChangedLine },
							argsKey,
						) || changed;
				}
				if (callComponent.settledError !== context.isError) {
					callComponent.settledError = context.isError;
					changed = true;
				}
				if (changed) {
					buildEditCallComponent(callComponent, context.args as RenderableEditArgs | undefined, theme);
				}
			}

			const output = formatEditResult(context.args, callComponent?.preview, typedResult, theme, context.isError);
			const component = (context.lastComponent as Container | undefined) ?? new Container();
			component.clear();
			if (!output) {
				return component;
			}
			component.addChild(new Spacer(1));
			component.addChild(new Text(output, 1, 0));
			return component;
		},
	};
}

export function createEditTool(cwd: string, options?: EditToolOptions): AgentTool<typeof editSchema> {
	return wrapToolDefinition(createEditToolDefinition(cwd, options));
}
