import { readFileSync } from "node:fs";
import type { AgentMessage } from "@pie-lab/agent-core";
import type { AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "@pie-lab/ai";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import type { LearningSettings } from "./learning-settings.ts";
import type { MemoryStore } from "./memory-store.ts";
import {
	createReviewId,
	type LearningReviewStore,
	type ReviewAction,
	type ReviewActionResult,
} from "./review-store.ts";
import type { SkillManager } from "./skill-manager.ts";
import { createLearningToolDefinitions } from "./tools.ts";

export interface BackgroundReviewOptions {
	settings: LearningSettings;
	memoryStore: MemoryStore;
	skillManager: SkillManager;
	reviewStore: LearningReviewStore;
	streamFn?: (model: Model<any>, context: { systemPrompt?: string; messages: Message[] }, options?: any) => any;
	onSkillsChanged?: () => Promise<void> | void;
}

export class BackgroundLearningReview {
	private turnCount = 0;
	private running = false;
	private lastReviewAt: number | undefined;
	private readonly options: BackgroundReviewOptions;

	constructor(options: BackgroundReviewOptions) {
		this.options = options;
	}

	trigger(messages: AgentMessage[]): void {
		if (!this.options.settings.enabled || this.running) return;
		if (this.options.settings.review.mode === "off") return;
		this.turnCount += 1;

		const intervalMinutes = this.options.settings.memory.reviewIntervalMinutes;
		const elapsedMs = this.lastReviewAt !== undefined ? Date.now() - this.lastReviewAt : Infinity;
		const timeDue = intervalMinutes > 0 && elapsedMs >= intervalMinutes * 60 * 1000;

		const shouldRun =
			timeDue ||
			this.turnCount % this.options.settings.memory.reviewIntervalTurns === 0 ||
			messages.some((message) => message.role === "assistant");
		if (!shouldRun) return;
		this.running = true;
		this.lastReviewAt = Date.now();
		void this.review(messages)
			.catch(() => undefined)
			.finally(() => {
				this.running = false;
			});
	}

	private async review(messages: AgentMessage[]): Promise<void> {
		if (!this.options.streamFn) return;
		const transcript = messages.map(formatAgentMessage).filter(Boolean).join("\n\n");
		if (!transcript) return;

		const model = createRouterModel("auto:learning");
		const record = this.options.reviewStore.write({
			id: createReviewId(),
			createdAt: new Date().toISOString(),
			model: model.id,
			mode: this.options.settings.review.mode,
			status: "skipped",
			actions: [],
			results: [],
		});
		try {
			const review = await this.runReviewToolLoop(model, transcript);
			const actions = review.actions;
			const results = review.results;
			const status = results.some((result) => result.status === "failed")
				? "failed"
				: results.some((result) => result.status === "proposed")
					? "proposed"
					: results.some((result) => result.status === "applied")
						? "applied"
						: "skipped";
			this.options.reviewStore.write({ ...record, rawOutput: review.rawOutput, actions, results, status });
		} catch (error) {
			this.options.reviewStore.write({
				...record,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private async runReviewToolLoop(
		model: Model<any>,
		transcript: string,
	): Promise<{ rawOutput: string; actions: ReviewAction[]; results: ReviewActionResult[] }> {
		if (!this.options.streamFn) return { rawOutput: "", actions: [], results: [] };
		const skillContext = buildSkillContext(this.options.skillManager);
		const toolDefinitions = createLearningToolDefinitions({
			memoryStore: this.options.memoryStore,
			skillManager: this.options.skillManager,
			onSkillsChanged: this.options.onSkillsChanged,
		});
		const toolsByName = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
		const messages: Message[] = [
			{
				role: "user",
				content: `Review the completed turn and update Pie's learning state.\n\n${skillContext}\n\n<transcript>\n${transcript}\n</transcript>`,
				timestamp: Date.now(),
			},
		];
		const results: ReviewActionResult[] = [];
		const rawOutputs: string[] = [];
		const maxIterations = Math.max(1, this.options.settings.skills.reviewToolIterations);

		for (let iteration = 0; iteration < maxIterations; iteration += 1) {
			const assistant = await runReviewModelTurn(this.options.streamFn, model, {
				systemPrompt: REVIEW_SYSTEM_PROMPT,
				messages,
				tools: toolDefinitions.map(({ name, description, parameters }) => ({ name, description, parameters })),
			});
			messages.push(assistant);
			const assistantText = extractAssistantText(assistant);
			if (assistantText) rawOutputs.push(assistantText);

			const toolCalls = assistant.content.filter((item): item is ToolCall => item.type === "toolCall");
			if (toolCalls.length === 0) {
				const fallbackActions = parseReviewActions(assistantText).slice(0, maxIterations - results.length);
				for (const action of fallbackActions) {
					results.push(await this.processAction(action));
				}
				break;
			}

			for (const toolCall of toolCalls) {
				const toolResult = await this.executeReviewToolCall(toolCall, toolsByName, results);
				messages.push(toolResult);
			}
		}

		return {
			rawOutput: rawOutputs.join("\n\n"),
			actions: results.map((result) => result.action),
			results,
		};
	}

	private async executeReviewToolCall(
		toolCall: ToolCall,
		toolsByName: Map<string, ReturnType<typeof createLearningToolDefinitions>[number]>,
		results: ReviewActionResult[],
	): Promise<ToolResultMessage> {
		const definition = toolsByName.get(toolCall.name);
		if (!definition) {
			return createReviewToolResult(
				toolCall,
				`Background review denied non-whitelisted tool: ${toolCall.name}`,
				true,
			);
		}

		const action = reviewActionFromToolCall(toolCall);
		if (action) {
			const duplicateReason = this.findDuplicateReason(action);
			if (duplicateReason) {
				results.push({ action, status: "skipped", reason: duplicateReason });
				return createReviewToolResult(toolCall, `Skipped: ${duplicateReason}`);
			}
			if (this.options.settings.review.mode === "suggest") {
				results.push({ action, status: "proposed" });
				return createReviewToolResult(toolCall, `Proposed ${action.type}.`);
			}
			try {
				await this.applyAction(action);
				results.push({ action, status: "applied" });
				return createReviewToolResult(toolCall, `Applied ${action.type}.`);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				results.push({ action, status: "failed", reason });
				return createReviewToolResult(toolCall, reason, true);
			}
		}

		if (isUnsupportedMutation(toolCall)) {
			return createReviewToolResult(
				toolCall,
				"Background review may only mutate via memory append or skill create/patch/edit/write_file.",
				true,
			);
		}

		try {
			const result = await definition.execute(
				toolCall.id,
				toolCall.arguments as any,
				undefined,
				undefined,
				undefined as any,
			);
			const text = result.content
				.map((item) => (item.type === "text" ? item.text : `[${item.mimeType} image]`))
				.join("\n");
			return createReviewToolResult(toolCall, text || JSON.stringify(result.details ?? {}));
		} catch (error) {
			return createReviewToolResult(toolCall, error instanceof Error ? error.message : String(error), true);
		}
	}

	private async processAction(action: ReviewAction): Promise<ReviewActionResult> {
		const duplicateReason = this.findDuplicateReason(action);
		if (duplicateReason) return { action, status: "skipped", reason: duplicateReason };
		if (this.options.settings.review.mode === "suggest") return { action, status: "proposed" };
		try {
			await this.applyAction(action);
			return { action, status: "applied" };
		} catch (error) {
			return { action, status: "failed", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	async applyAction(action: ReviewAction): Promise<void> {
		if (action.type === "memory_append" && this.options.settings.memory.enabled && action.text) {
			this.options.memoryStore.append("memory", action.text);
			return;
		}
		if (action.type === "user_append" && this.options.settings.memory.enabled && action.text) {
			this.options.memoryStore.append("user", action.text);
			return;
		}
		if (!this.options.settings.skills.enabled || !this.options.settings.skills.autoSave) return;
		if (action.type === "skill_create" && action.name && action.content) {
			this.options.skillManager.create(action.name, action.content, action.description);
			await this.options.onSkillsChanged?.();
			return;
		}
		if (action.type === "skill_patch" && action.name && action.oldText && action.newText !== undefined) {
			this.options.skillManager.patch(action.name, action.oldText, action.newText);
			await this.options.onSkillsChanged?.();
			return;
		}
		if (action.type === "skill_edit" && action.name && action.content) {
			this.options.skillManager.edit(action.name, action.content);
			await this.options.onSkillsChanged?.();
			return;
		}
		if (action.type === "skill_write_file" && action.name && action.path && action.content !== undefined) {
			this.options.skillManager.writeFile(action.name, action.path, action.content);
			await this.options.onSkillsChanged?.();
		}
	}

	private findDuplicateReason(action: ReviewAction): string | undefined {
		if ((action.type === "memory_append" || action.type === "user_append") && action.text) {
			const target = action.type === "memory_append" ? "memory" : "user";
			const text = action.text;
			if (looksDuplicate(this.options.memoryStore.read(target), text)) {
				return "similar memory already exists";
			}
		}
		if (action.type === "skill_create" && action.name) {
			const name = action.name;
			const description = action.description;
			const skills = this.options.skillManager.list();
			const similar = skills.find(
				(skill) =>
					skill.name === name ||
					similarity(skill.name, name) > 0.82 ||
					(description ? similarity(skill.description, description) > 0.72 : false),
			);
			if (similar) return `similar skill exists: ${similar.name}`;
		}
		return undefined;
	}
}

function looksDuplicate(existing: string, candidate: string): boolean {
	const normalizedCandidate = normalizeText(candidate);
	if (!normalizedCandidate) return true;
	return existing
		.split(/\n{2,}/u)
		.map(normalizeText)
		.some((part) => part === normalizedCandidate || similarity(part, normalizedCandidate) > 0.86);
}

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function similarity(left: string, right: string): number {
	const leftTokens = new Set(normalizeText(left).split(/\s+/u).filter(Boolean));
	const rightTokens = new Set(normalizeText(right).split(/\s+/u).filter(Boolean));
	if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
	let intersection = 0;
	for (const token of leftTokens) {
		if (rightTokens.has(token)) intersection += 1;
	}
	return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function createRouterModel(id: string): Model<any> {
	return {
		id,
		name: `Router ${id}`,
		provider: PIE_LAB_ROUTER_PROVIDER,
		api: PIE_LAB_ROUTER_PROVIDER as any,
		baseUrl: "",
		input: ["text"],
		reasoning: false,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 4096,
	};
}

async function runReviewModelTurn(
	streamFn: BackgroundReviewOptions["streamFn"],
	model: Model<any>,
	context: {
		systemPrompt: string;
		messages: Message[];
		tools: { name: string; description: string; parameters: any }[];
	},
): Promise<AssistantMessage> {
	if (!streamFn) throw new Error("streamFn is required for background review.");
	const stream = await Promise.resolve(streamFn(model, context));
	let message: AssistantMessage | undefined;
	for await (const event of stream) {
		if (event.type === "done") {
			message = event.message;
		} else if (event.type === "error") {
			throw new Error(event.error.errorMessage ?? "Background review model error.");
		}
	}
	if (!message) throw new Error("Background review model returned no message.");
	return message;
}

const REVIEW_SYSTEM_PROMPT = `You are Pie's background learning reviewer. Return only JSON: {"actions": ReviewAction[]}.

You are adapting the Hermes Agent learning policy:

Memory = who the user is, what they prefer, and stable facts about their environment.
Skills = how to do a class of task for this user.

Be active. A session with a real correction, reusable workflow, or durable procedure should usually produce a skill update. "Nothing to save" is valid only when no durable signal exists.

Allowed action shapes:
- {"type":"memory_append","text":"..."} for durable project/environment/tool facts.
- {"type":"user_append","text":"..."} for durable user profile facts and broad preferences.
- {"type":"skill_patch","name":"existing-skill","oldText":"exact text","newText":"replacement"} when an existing skill covers the learning.
- {"type":"skill_write_file","name":"existing-skill","path":"references/topic.md","content":"..."} for support material under an existing umbrella.
- {"type":"skill_edit","name":"existing-skill","content":"full updated SKILL.md"} for major rewrites only.
- {"type":"skill_create","name":"class-level-kebab-name","description":"Use when ...","content":"full SKILL.md"} only when no existing skill fits.

Skill update priority:
1. Patch a currently loaded or directly relevant skill first.
2. Patch an existing umbrella skill next.
3. Add concise support files under an existing umbrella with skill_write_file when detail belongs in references/, templates/, or scripts/.
4. Create a new class-level umbrella skill only when nothing existing fits.

User-preference embedding:
- If the user corrects style, tone, format, verbosity, workflow, or says how future requests of a task class should be handled, this is a FIRST-CLASS skill signal, not memory-only.
- If the user says "앞으로", "항상", "다음부터", "when I ask", "whenever", or otherwise asks for a recurring handling rule for a class of requests, memory alone is not enough. Also patch/create the skill that governs that class.
- Memory may store the user's general preference, but skill must store the procedure for that task class.

Create good skills:
- Skill names must be lowercase kebab-case and class-level.
- Do not create names tied to today, a specific bug, a date, a single session, or a one-off artifact.
- SKILL.md must include YAML frontmatter with name and description.
- Body should include trigger conditions, expected workflow, output expectations, pitfalls, and verification/reuse notes.

Do not store:
- Secrets or credentials.
- One-off task narratives.
- Environment-dependent failures as permanent constraints.
- Negative claims like "tool X is broken"; capture the fix or retry pattern instead.

If no action is warranted, return {"actions":[]}.`;

function buildSkillContext(skillManager: SkillManager): string {
	const skills = skillManager.list();
	if (skills.length === 0) {
		return "<skill-library>\nNo existing skills.\n</skill-library>";
	}
	const lines = skills.map(
		(skill) =>
			`- ${skill.name} (${skill.source}${skill.createdBy ? `, ${skill.createdBy}` : ""}): ${skill.description || "(no description)"}`,
	);
	const bodies: string[] = [];
	let budget = 12_000;
	for (const skill of skills.slice(0, 12)) {
		if (budget <= 0) break;
		try {
			const content = readFileSync(skill.location, "utf-8");
			const clipped = content.length > 2_000 ? `${content.slice(0, 2_000)}\n... [truncated]` : content;
			budget -= clipped.length;
			bodies.push(`<skill name="${skill.name}" location="${skill.location}">\n${clipped}\n</skill>`);
		} catch {
			// Ignore unreadable skills in the review context.
		}
	}
	return [
		"<skill-library>",
		"Existing skills. Prefer patching these over creating a new skill when one fits.",
		...lines,
		bodies.length > 0 ? "\n<skill-bodies>" : "",
		...bodies,
		bodies.length > 0 ? "</skill-bodies>" : "",
		"</skill-library>",
	]
		.filter(Boolean)
		.join("\n");
}

function parseReviewActions(output: string): ReviewAction[] {
	const jsonText = output
		.trim()
		.replace(/^```json\s*/u, "")
		.replace(/```$/u, "");
	if (!jsonText) return [];
	try {
		const parsed = JSON.parse(jsonText) as { actions?: ReviewAction[] };
		return Array.isArray(parsed.actions) ? parsed.actions : [];
	} catch {
		return [];
	}
}

function reviewActionFromToolCall(toolCall: ToolCall): ReviewAction | undefined {
	const args = toolCall.arguments ?? {};
	if (toolCall.name === "memory") {
		if (args.action !== "append" || typeof args.text !== "string") return undefined;
		if (args.target === "memory") return { type: "memory_append", text: args.text };
		if (args.target === "user") return { type: "user_append", text: args.text };
		return undefined;
	}
	if (toolCall.name !== "skill_manage" || typeof args.name !== "string") return undefined;
	if (args.action === "create" && typeof args.content === "string") {
		return {
			type: "skill_create",
			name: args.name,
			description: typeof args.description === "string" ? args.description : undefined,
			content: args.content,
		};
	}
	if (args.action === "patch" && typeof args.oldText === "string" && typeof args.newText === "string") {
		return { type: "skill_patch", name: args.name, oldText: args.oldText, newText: args.newText };
	}
	if (args.action === "edit" && typeof args.content === "string") {
		return { type: "skill_edit", name: args.name, content: args.content };
	}
	const path =
		typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : undefined;
	if (args.action === "write_file" && path && typeof args.content === "string") {
		return { type: "skill_write_file", name: args.name, path, content: args.content };
	}
	return undefined;
}

function isUnsupportedMutation(toolCall: ToolCall): boolean {
	const args = toolCall.arguments ?? {};
	if (toolCall.name === "memory") return args.action !== "read";
	if (toolCall.name === "skill_manage") return true;
	return false;
}

function createReviewToolResult(toolCall: ToolCall, text: string, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
	};
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();
}

function formatAgentMessage(message: AgentMessage): string {
	const text = extractText(message);
	if (!text) return "";
	return `${message.role}: ${text}`;
}

function extractText(message: AgentMessage): string {
	const content = (message as any).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((item) => item?.type === "text")
		.map((item) => item.text)
		.join("\n")
		.trim();
}
