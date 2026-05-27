import { join } from "node:path";
import type { UsageStore } from "@pie-lab/storage";
import { spawnProcess, waitForChildProcess } from "../../utils/child-process.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../agent-session-services.ts";
import { SessionManager } from "../session-manager.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { deliverCronResult } from "./delivery.ts";
import { type CronJob, type CronJobStatus, CronJobStore } from "./job-store.ts";
import type { SchedulerSettings } from "./scheduler-settings.ts";

export interface CronRunResult {
	jobId: string;
	success: boolean;
	status: CronJobStatus;
	output: string;
	finalResponse: string;
	error?: string;
	outputPath?: string;
	delivered?: number;
	deliveryTargets?: string[];
	deliveryError?: string;
}

export interface SchedulerRunnerOptions {
	agentDir: string;
	cwd: string;
	settings: SchedulerSettings;
	store?: CronJobStore;
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n\n[... truncated ...]`;
}

function extractAssistantText(state: { messages: Array<{ role: string; content?: unknown; errorMessage?: string }> }): {
	text: string;
	error?: string;
} {
	const last = [...state.messages].reverse().find((message) => message.role === "assistant");
	if (!last) return { text: "", error: "No assistant response was produced." };
	const content = Array.isArray(last.content) ? last.content : [];
	const text = content
		.map((item) =>
			typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item
				? String(item.text)
				: "",
		)
		.filter(Boolean)
		.join("\n");
	return { text, error: last.errorMessage };
}

function applySchedulerLearningPolicy(settingsManager: SettingsManager, settings: SchedulerSettings): void {
	const learning = settingsManager.getLearningSettings();
	settingsManager.applyOverrides({
		learning: {
			...learning,
			enabled: settings.learning.enabled,
			review: {
				...learning.review,
				mode: settings.learning.reviewEnabled ? learning.review.mode : "off",
			},
		},
	});
}

function createSchedulerUsageStore(base: UsageStore, job: CronJob): UsageStore {
	return {
		recordUsage: (record) =>
			base.recordUsage({
				...record,
				clientOrigin: record.clientOrigin ?? "pie-cron",
				endpoint: record.endpoint ?? `pie-cron:${job.id}`,
				agentRunId: record.agentRunId ?? job.id,
			}),
	};
}

async function runScript(
	job: CronJob,
	store: CronJobStore,
	timeoutMs: number,
): Promise<{
	success: boolean;
	stdout: string;
	stderr: string;
	error?: string;
}> {
	if (!job.script) {
		return { success: true, stdout: "", stderr: "" };
	}
	const scriptPath = await store.resolveScriptPath(job.script);
	const child = spawnProcess(scriptPath, [], {
		cwd: job.workdir ?? process.cwd(),
		env: {
			...process.env,
			PIE_CRON_JOB_ID: job.id,
			PIE_CRON_JOB_NAME: job.name,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.setEncoding("utf-8");
	child.stderr?.setEncoding("utf-8");
	child.stdout?.on("data", (chunk) => {
		stdout += String(chunk);
	});
	child.stderr?.on("data", (chunk) => {
		stderr += String(chunk);
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGTERM");
	}, timeoutMs);
	try {
		const code = await waitForChildProcess(child);
		if (timedOut) {
			return { success: false, stdout, stderr, error: `Script timed out after ${timeoutMs / 1000}s.` };
		}
		if (code !== 0) {
			return { success: false, stdout, stderr, error: `Script exited with code ${code ?? "unknown"}.` };
		}
		return { success: true, stdout, stderr };
	} catch (error) {
		return {
			success: false,
			stdout,
			stderr,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

async function buildPrompt(job: CronJob, store: CronJobStore, scriptOutput?: string): Promise<string> {
	const blocks: string[] = [];
	if (job.contextFrom?.length) {
		for (const sourceJobId of job.contextFrom) {
			const output = await store.latestOutput(sourceJobId);
			if (output?.trim()) {
				blocks.push(
					`The following is the latest output from scheduled job "${sourceJobId}":\n\n${truncate(output.trim(), 20_000)}`,
				);
			}
		}
	}
	if (scriptOutput?.trim()) {
		blocks.push(
			`The pre-run script produced this output:\n\n\`\`\`text\n${truncate(scriptOutput.trim(), 20_000)}\n\`\`\``,
		);
	}
	blocks.push(`Scheduled job prompt:\n\n${job.prompt}`);
	blocks.push("Return only the final scheduled job output. Do not describe the scheduler internals.");
	return blocks.join("\n\n---\n\n");
}

function buildOutputDocument(
	job: CronJob,
	result: {
		status: CronJobStatus;
		finalResponse: string;
		error?: string;
		scriptOutput?: string;
		scriptError?: string;
		ranAt: Date;
	},
): string {
	const lines = [
		`# Cron Job: ${job.name}`,
		"",
		`- Job ID: ${job.id}`,
		`- Status: ${result.status}`,
		`- Ran At: ${result.ranAt.toISOString()}`,
		`- Schedule: ${job.scheduleDisplay}`,
		"",
		"## Prompt",
		"",
		job.prompt,
		"",
	];
	if (result.scriptOutput || result.scriptError) {
		lines.push("## Script", "");
		if (result.scriptOutput) {
			lines.push("```text", result.scriptOutput.trim(), "```", "");
		}
		if (result.scriptError) {
			lines.push(`Script error: ${result.scriptError}`, "");
		}
	}
	if (result.error) {
		lines.push("## Error", "", result.error, "");
	}
	lines.push("## Response", "", result.finalResponse || "(no response)", "");
	return lines.join("\n");
}

async function finalizeRun(
	job: CronJob,
	options: SchedulerRunnerOptions,
	store: CronJobStore,
	result: {
		success: boolean;
		status: CronJobStatus;
		output: string;
		finalResponse: string;
		error?: string;
		ranAt: Date;
	},
): Promise<CronRunResult> {
	const outputPath = await store.saveOutput(job.id, result.output, result.ranAt);
	const delivery = await deliverCronResult({
		agentDir: options.agentDir,
		deliver: job.deliver,
		origin: job.origin,
		content: result.finalResponse || result.error || result.output,
	});
	const deliveryError = delivery.errors.length > 0 ? delivery.errors.join("; ") : undefined;
	return {
		jobId: job.id,
		success: result.success,
		status: result.status,
		output: result.output,
		finalResponse: result.finalResponse,
		error: result.error,
		outputPath,
		delivered: delivery.delivered,
		deliveryTargets: delivery.targets,
		deliveryError,
	};
}

export async function runCronJob(job: CronJob, options: SchedulerRunnerOptions): Promise<CronRunResult> {
	const store = options.store ?? new CronJobStore({ agentDir: options.agentDir, cwd: options.cwd });
	const ranAt = new Date();
	const timeoutMs = options.settings.timeoutSeconds * 1000;

	if (job.noAgent && !options.settings.noAgentEnabled) {
		const error = "noAgent scheduled jobs are disabled by scheduler settings.";
		const output = buildOutputDocument(job, { status: "failed", finalResponse: "", error, ranAt });
		return finalizeRun(job, options, store, {
			success: false,
			status: "failed",
			output,
			finalResponse: "",
			error,
			ranAt,
		});
	}
	if (job.script && !options.settings.scriptsEnabled) {
		const error = "Scheduled job scripts are disabled by scheduler settings.";
		const output = buildOutputDocument(job, { status: "failed", finalResponse: "", error, ranAt });
		return finalizeRun(job, options, store, {
			success: false,
			status: "failed",
			output,
			finalResponse: "",
			error,
			ranAt,
		});
	}

	const scriptResult = await runScript(job, store, timeoutMs);
	const scriptCombined = [scriptResult.stdout, scriptResult.stderr ? `stderr:\n${scriptResult.stderr}` : ""]
		.filter(Boolean)
		.join("\n\n");
	if (!scriptResult.success) {
		const output = buildOutputDocument(job, {
			status: "failed",
			finalResponse: "",
			error: scriptResult.error,
			scriptOutput: scriptCombined,
			scriptError: scriptResult.error,
			ranAt,
		});
		return finalizeRun(job, options, store, {
			success: false,
			status: "failed",
			output,
			finalResponse: "",
			error: scriptResult.error,
			ranAt,
		});
	}

	if (job.noAgent) {
		const finalResponse = scriptResult.stdout.trim();
		const status: CronJobStatus = finalResponse ? "success" : "silent";
		const output = buildOutputDocument(job, {
			status,
			finalResponse,
			scriptOutput: scriptCombined,
			ranAt,
		});
		return finalizeRun(job, options, store, {
			success: true,
			status,
			output,
			finalResponse,
			ranAt,
		});
	}

	const services = await createAgentSessionServices({
		cwd: job.workdir ?? options.cwd,
		agentDir: options.agentDir,
		usageFilePath: undefined,
		resourceLoaderOptions: {
			noExtensions: true,
			noPromptTemplates: true,
		},
	});
	applySchedulerLearningPolicy(services.settingsManager, options.settings);
	services.usageStore = createSchedulerUsageStore(services.usageStore, job);

	let output = "";
	try {
		const model =
			job.model?.provider && job.model.id
				? services.modelRegistry.find(job.model.provider, job.model.id)
				: undefined;
		const sessionManager = SessionManager.create(
			job.workdir ?? options.cwd,
			join(options.agentDir, "cron", "sessions", job.id),
		);
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager,
			model,
			tools: job.tools ?? ["read", "bash", "edit", "write"],
			sessionStartEvent: { type: "session_start", reason: "startup" },
		});
		const timer = setTimeout(() => {
			session.agent.abort();
		}, timeoutMs);
		try {
			await session.prompt(await buildPrompt(job, store, scriptCombined), {
				expandPromptTemplates: false,
				source: "extension",
			});
		} finally {
			clearTimeout(timer);
		}
		const { text, error } = extractAssistantText(session.state);
		const status: CronJobStatus = error ? "failed" : text.trim() ? "success" : "silent";
		output = buildOutputDocument(job, {
			status,
			finalResponse: text,
			error,
			scriptOutput: scriptCombined,
			ranAt,
		});
		session.dispose();
		return finalizeRun(job, options, store, {
			success: status !== "failed",
			status,
			output,
			finalResponse: text,
			error,
			ranAt,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		output = buildOutputDocument(job, {
			status: "failed",
			finalResponse: "",
			error: message,
			scriptOutput: scriptCombined,
			ranAt,
		});
		return finalizeRun(job, options, store, {
			success: false,
			status: "failed",
			output,
			finalResponse: "",
			error: message,
			ranAt,
		});
	}
}

export async function tickCronScheduler(options: SchedulerRunnerOptions): Promise<CronRunResult[]> {
	const store = options.store ?? new CronJobStore({ agentDir: options.agentDir, cwd: options.cwd });
	const due = await store.getDueJobs();
	const results: CronRunResult[] = [];
	const parallel = Math.max(1, options.settings.maxParallelJobs);
	let index = 0;

	async function worker(): Promise<void> {
		while (index < due.length) {
			const job = due[index++];
			const claimed = await store.claimDueJob(job.id);
			if (!claimed) continue;
			const result = await runCronJob(claimed, { ...options, store });
			await store.markRun(claimed.id, {
				status: result.status,
				outputPath: result.outputPath,
				error: result.error,
			});
			await store.markDelivery(claimed.id, result.deliveryError);
			results.push(result);
		}
	}

	await Promise.all(Array.from({ length: Math.min(parallel, due.length) }, () => worker()));
	return results;
}
