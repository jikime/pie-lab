import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { MemoryStore, MemoryTarget } from "./memory-store.ts";
import type { SkillManager } from "./skill-manager.ts";

const memorySchema = Type.Object({
	action: Type.Union([Type.Literal("read"), Type.Literal("append"), Type.Literal("replace"), Type.Literal("clear")]),
	target: Type.Union([Type.Literal("memory"), Type.Literal("user")]),
	text: Type.Optional(Type.String()),
});

const skillViewSchema = Type.Object({
	nameOrPath: Type.String(),
});

const skillManageSchema = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("patch"),
		Type.Literal("edit"),
		Type.Literal("delete"),
		Type.Literal("archive"),
		Type.Literal("write_file"),
		Type.Literal("remove_file"),
	]),
	name: Type.String(),
	content: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	oldText: Type.Optional(Type.String()),
	newText: Type.Optional(Type.String()),
	path: Type.Optional(Type.String()),
});

type MemoryInput = Static<typeof memorySchema>;
type SkillViewInput = Static<typeof skillViewSchema>;
type SkillManageInput = Static<typeof skillManageSchema>;

export function createLearningToolDefinitions(options: {
	memoryStore: MemoryStore;
	skillManager: SkillManager;
	onSkillsChanged?: () => Promise<void> | void;
}): ToolDefinition[] {
	return [
		{
			name: "memory",
			label: "Memory",
			description: "Read or update Pie persistent memory files. Rejects prompt-injection-like memory text.",
			promptSnippet: "Read or update persistent MEMORY.md and USER.md learning files",
			parameters: memorySchema,
			execute: async (_toolCallId, params: MemoryInput) => {
				const target = params.target as MemoryTarget;
				if (params.action === "read") {
					return { content: [{ type: "text", text: options.memoryStore.read(target) }], details: undefined };
				}
				if ((params.action === "append" || params.action === "replace") && !params.text) {
					throw new Error("text is required for append and replace.");
				}
				const result =
					params.action === "append"
						? options.memoryStore.append(target, params.text!)
						: params.action === "replace"
							? options.memoryStore.replace(target, params.text!)
							: options.memoryStore.clear(target);
				return { content: [{ type: "text", text: result }], details: undefined };
			},
		},
		{
			name: "skills_list",
			label: "Skills List",
			description: "List user and project skills with descriptions and locations.",
			promptSnippet: "List available persistent skills and their locations",
			parameters: Type.Object({}),
			execute: async () => ({
				content: [{ type: "text", text: JSON.stringify(options.skillManager.list(), null, 2) }],
				details: undefined,
			}),
		},
		{
			name: "skill_view",
			label: "Skill View",
			description: "Read a skill body or supporting file inside managed skill directories.",
			promptSnippet: "Read a skill file or supporting file",
			parameters: skillViewSchema,
			execute: async (_toolCallId, params: SkillViewInput) => ({
				content: [{ type: "text", text: options.skillManager.view(params.nameOrPath) }],
				details: undefined,
			}),
		},
		{
			name: "skill_manage",
			label: "Skill Manage",
			description: "Create, patch, edit, archive, or update files for agent-managed user skills.",
			promptSnippet: "Create or maintain reusable user skills",
			parameters: skillManageSchema,
			execute: async (_toolCallId, params: SkillManageInput) => {
				let result: unknown;
				if (params.action === "create") {
					if (!params.content) throw new Error("content is required for create.");
					result = options.skillManager.create(params.name, params.content, params.description);
				} else if (params.action === "patch") {
					if (!params.oldText || params.newText === undefined)
						throw new Error("oldText and newText are required.");
					result = options.skillManager.patch(params.name, params.oldText, params.newText);
				} else if (params.action === "edit") {
					if (!params.content) throw new Error("content is required for edit.");
					result = options.skillManager.edit(params.name, params.content);
				} else if (params.action === "write_file") {
					if (!params.path || params.content === undefined) throw new Error("path and content are required.");
					result = { path: options.skillManager.writeFile(params.name, params.path, params.content) };
				} else if (params.action === "remove_file") {
					if (!params.path) throw new Error("path is required.");
					result = { path: options.skillManager.removeFile(params.name, params.path) };
				} else {
					result = { archivedTo: options.skillManager.archive(params.name) };
				}
				await options.onSkillsChanged?.();
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: undefined };
			},
		},
	];
}
