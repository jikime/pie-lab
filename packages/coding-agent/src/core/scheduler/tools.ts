import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import type { CronJobStore } from "./job-store.ts";

const cronModelSchema = Type.Object({
	provider: Type.Optional(Type.String()),
	id: Type.Optional(Type.String()),
});

const cronJobSchema = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("list"),
		Type.Literal("show"),
		Type.Literal("update"),
		Type.Literal("pause"),
		Type.Literal("resume"),
		Type.Literal("remove"),
		Type.Literal("trigger"),
	]),
	id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	prompt: Type.Optional(Type.String()),
	schedule: Type.Optional(Type.String()),
	repeat: Type.Optional(Type.Boolean()),
	deliver: Type.Optional(Type.String()),
	script: Type.Optional(Type.String()),
	noAgent: Type.Optional(Type.Boolean()),
	contextFrom: Type.Optional(Type.Array(Type.String())),
	tools: Type.Optional(Type.Array(Type.String())),
	workdir: Type.Optional(Type.String()),
	model: Type.Optional(cronModelSchema),
});

type CronJobToolInput = Static<typeof cronJobSchema>;

function requireRef(params: CronJobToolInput): string {
	const ref = params.id ?? params.name;
	if (!ref) throw new Error("id or name is required.");
	return ref;
}

function currentChatOrigin(): string | undefined {
	return process.env.PIE_CHAT_CONVERSATION_ID?.trim() || process.env.PIE_LAB_CHAT_CONVERSATION_ID?.trim() || undefined;
}

export function createSchedulerToolDefinitions(options: { store: CronJobStore }): ToolDefinition[] {
	return [
		{
			name: "cronjob",
			label: "Cron Job",
			description:
				"Create and manage persistent scheduled Pie jobs. Jobs run in a fresh session and prompts must be self-contained.",
			promptSnippet:
				"Use cronjob to create, inspect, pause, resume, remove, or trigger reusable scheduled jobs. Do not create recursive scheduler jobs from inside scheduled runs.",
			parameters: cronJobSchema,
			execute: async (_toolCallId, params: CronJobToolInput) => {
				if (process.env.PIE_CRON_JOB_ID && ["create", "update", "trigger"].includes(params.action)) {
					throw new Error("cronjob cannot create, update, or trigger jobs from inside a scheduled job.");
				}
				const store = options.store;
				let result: unknown;
				if (params.action === "list") {
					result = await store.list();
				} else if (params.action === "show") {
					const job = await store.get(requireRef(params));
					if (!job) throw new Error(`Scheduled job not found: ${requireRef(params)}`);
					result = job;
				} else if (params.action === "create") {
					if (!params.name) throw new Error("name is required for create.");
					if (!params.prompt) throw new Error("prompt is required for create.");
					if (!params.schedule) throw new Error("schedule is required for create.");
					result = await store.create({
						name: params.name,
						prompt: params.prompt,
						schedule: params.schedule,
						repeat: params.repeat,
						deliver: params.deliver,
						origin: currentChatOrigin(),
						script: params.script,
						noAgent: params.noAgent,
						contextFrom: params.contextFrom,
						tools: params.tools,
						workdir: params.workdir,
						model: params.model,
					});
				} else if (params.action === "update") {
					result = await store.update(requireRef(params), {
						name: params.name,
						prompt: params.prompt,
						schedule: params.schedule,
						repeat: params.repeat,
						deliver: params.deliver,
						script: params.script,
						noAgent: params.noAgent,
						contextFrom: params.contextFrom,
						tools: params.tools,
						workdir: params.workdir,
						model: params.model,
					});
				} else if (params.action === "pause") {
					result = await store.pause(requireRef(params));
				} else if (params.action === "resume") {
					result = await store.resume(requireRef(params));
				} else if (params.action === "remove") {
					result = await store.remove(requireRef(params));
				} else {
					result = await store.trigger(requireRef(params));
				}
				return {
					content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
					details: result,
				};
			},
		},
	];
}
