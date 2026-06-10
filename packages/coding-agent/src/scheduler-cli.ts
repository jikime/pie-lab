import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import { readGatewayStatus } from "./core/gateway/runner.ts";
import { type CronJob, CronJobStore, runCronJob, tickCronScheduler } from "./core/scheduler/index.ts";
import { SettingsManager } from "./core/settings-manager.ts";

interface ParsedCronArgs {
	command: string;
	json: boolean;
	flags: Map<string, string | boolean>;
	positionals: string[];
}

export async function handleCronCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "cron") return false;
	const parsed = parseCronArgs(args.slice(1));
	if (parsed.command === "--help" || parsed.command === "-h" || parsed.flags.has("help")) {
		printCronHelp();
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const settings = settingsManager.getSchedulerSettings();
	const store = new CronJobStore({ agentDir, cwd });

	try {
		if (!settings.enabled && parsed.command !== "status") {
			throw new Error("Scheduler is disabled by settings.");
		}

		switch (parsed.command) {
			case "status": {
				const jobs = await store.list();
				const gatewayStatus = await readGatewayStatus({ agentDir }).catch(() => undefined);
				const gatewayRunning = gatewayStatus?.running ?? false;
				printResult(
					{
						settings,
						gatewayRunning,
						jobs: jobs.length,
						enabled: jobs.filter((job) => job.enabled).length,
						due: jobs.filter((job) => job.enabled && job.nextRunAt && new Date(job.nextRunAt) <= new Date())
							.length,
					},
					parsed.json,
					(value) => {
						const lines = [
							`Scheduler: ${value.settings.enabled ? "enabled" : "disabled"}`,
							`Gateway: ${value.gatewayRunning ? "running" : chalk.yellow("not running")}`,
							`Tick interval: ${value.settings.tickIntervalSeconds}s`,
							`Timeout (agent): ${value.settings.timeoutSeconds}s`,
							`Timeout (script): ${value.settings.scriptTimeoutSeconds}s`,
							`Jobs: ${value.jobs}`,
							`Enabled: ${value.enabled}`,
							`Due now: ${value.due}`,
						];
						if (!value.gatewayRunning && value.settings.enabled) {
							lines.push(
								"",
								chalk.yellow(
									"⚠ Gateway is not running — scheduled jobs will not tick. Start it with: pie gateway run",
								),
							);
						}
						return lines.join("\n");
					},
				);
				return true;
			}
			case "list": {
				const jobs = await store.list();
				printResult(jobs, parsed.json, formatJobList);
				return true;
			}
			case "show": {
				const job = await requireJob(store, parsed.positionals[0]);
				printResult(job, parsed.json, (value) => JSON.stringify(value, null, 2));
				return true;
			}
			case "create": {
				const name = parsed.positionals[0] ?? getStringFlag(parsed, "name");
				const schedule = getStringFlag(parsed, "schedule");
				const prompt = getStringFlag(parsed, "prompt");
				if (!name) throw new Error("create requires <name> or --name.");
				if (!schedule) throw new Error("create requires --schedule.");
				if (!prompt) throw new Error("create requires --prompt.");
				const job = await store.create({
					name,
					schedule,
					prompt,
					repeat: getBooleanFlag(parsed, "repeat"),
					repeatTimes: getNumberFlag(parsed, "repeat-times"),
					deliver: getStringFlag(parsed, "deliver"),
					script: getStringFlag(parsed, "script"),
					noAgent: getBooleanFlag(parsed, "no-agent"),
					contextFrom: getCsvFlag(parsed, "context-from"),
					skills: getCsvFlag(parsed, "skills"),
					tools: getCsvFlag(parsed, "tools"),
					workdir: getStringFlag(parsed, "workdir"),
					model: getModelFlag(parsed),
					timezone: getStringFlag(parsed, "timezone"),
				});
				printResult(
					job,
					parsed.json,
					(value) => `Created ${value.id}: ${value.name}\nNext run: ${value.nextRunAt}`,
				);
				return true;
			}
			case "update": {
				const ref = parsed.positionals[0];
				if (!ref) throw new Error("update requires a job id or name.");
				const job = await store.update(ref, {
					name: getStringFlag(parsed, "name"),
					schedule: getStringFlag(parsed, "schedule"),
					prompt: getStringFlag(parsed, "prompt"),
					repeat: getOptionalBooleanFlag(parsed, "repeat"),
					repeatTimes: getNullableNumberFlag(parsed, "repeat-times"),
					deliver: getStringFlag(parsed, "deliver"),
					script: getNullableStringFlag(parsed, "script"),
					noAgent: getOptionalBooleanFlag(parsed, "no-agent"),
					contextFrom: getNullableCsvFlag(parsed, "context-from"),
					skills: getNullableCsvFlag(parsed, "skills"),
					tools: getNullableCsvFlag(parsed, "tools"),
					workdir: getNullableStringFlag(parsed, "workdir"),
					model: getModelFlag(parsed),
					timezone: getNullableStringFlag(parsed, "timezone"),
				});
				printResult(job, parsed.json, (value) => `Updated ${value.id}: ${value.name}`);
				return true;
			}
			case "pause": {
				const job = await store.pause(requireRef(parsed));
				printResult(job, parsed.json, (value) => `Paused ${value.id}: ${value.name}`);
				return true;
			}
			case "resume": {
				const job = await store.resume(requireRef(parsed));
				printResult(
					job,
					parsed.json,
					(value) => `Resumed ${value.id}: ${value.name}\nNext run: ${value.nextRunAt}`,
				);
				return true;
			}
			case "remove": {
				const job = await store.remove(requireRef(parsed));
				printResult(job, parsed.json, (value) => `Removed ${value.id}: ${value.name}`);
				return true;
			}
			case "trigger": {
				const job = await store.trigger(requireRef(parsed));
				printResult(job, parsed.json, (value) => `Triggered ${value.id}: ${value.name}`);
				return true;
			}
			case "run": {
				const job = await requireJob(store, parsed.positionals[0]);
				const result = await runCronJob(job, { agentDir, cwd, settings, store });
				await store.markRun(job.id, {
					status: result.status,
					outputPath: result.outputPath,
					error: result.error,
				});
				await store.markDelivery(job.id, result.deliveryError);
				printResult(result, parsed.json, (value) =>
					[
						`Ran ${job.id}: ${job.name}`,
						`Status: ${value.status}`,
						value.outputPath ? `Output: ${value.outputPath}` : undefined,
						value.delivered ? `Delivered: ${value.delivered} (${value.deliveryTargets?.join(", ")})` : undefined,
						value.deliveryError ? `Delivery error: ${value.deliveryError}` : undefined,
						value.error ? `Error: ${value.error}` : undefined,
						value.finalResponse ? `\n${value.finalResponse}` : undefined,
					]
						.filter(Boolean)
						.join("\n"),
				);
				return true;
			}
			case "tick": {
				const results = await tickCronScheduler({ agentDir, cwd, settings, store });
				printResult(results, parsed.json, (value) => {
					if (value.length === 0) return "No scheduled jobs are due.";
					return value
						.map((result) => `${result.status.padEnd(8)} ${result.jobId} ${result.outputPath ?? ""}`)
						.join("\n");
				});
				return true;
			}
			case "daemon": {
				console.log(chalk.dim(`Starting ${APP_NAME} cron daemon. Press Ctrl+C to stop.`));
				let stopped = false;
				const stop = () => {
					stopped = true;
				};
				process.once("SIGINT", stop);
				process.once("SIGTERM", stop);
				while (!stopped) {
					const results = await tickCronScheduler({ agentDir, cwd, settings, store });
					for (const result of results) {
						console.log(`${new Date().toISOString()} ${result.status} ${result.jobId}`);
						if (result.error) console.error(chalk.red(result.error));
						if (result.deliveryError) console.error(chalk.yellow(result.deliveryError));
					}
					await sleep(settings.tickIntervalSeconds * 1000);
				}
				return true;
			}
			default:
				throw new Error(`Unknown cron command: ${parsed.command}`);
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
		return true;
	}
}

function parseCronArgs(args: string[]): ParsedCronArgs {
	const command = args[0] ?? "status";
	const flags = new Map<string, string | boolean>();
	const positionals: string[] = [];
	let json = false;
	for (let index = 1; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "-h" || arg === "--help") {
			flags.set("help", true);
			continue;
		}
		if (arg.startsWith("--")) {
			const name = arg.slice(2);
			const next = args[index + 1];
			if (!next || next.startsWith("--")) {
				flags.set(name, true);
			} else {
				flags.set(name, next);
				index++;
			}
			continue;
		}
		positionals.push(arg);
	}
	return { command, flags, positionals, json };
}

function printCronHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} cron`)} - manage Hermes-style scheduled Pie jobs

${chalk.bold("Usage:")}
  ${APP_NAME} cron status [--json]
  ${APP_NAME} cron list [--json]
  ${APP_NAME} cron show <job>
  ${APP_NAME} cron create <name> --schedule <expr> --prompt <text> [--repeat] [--repeat-times N] [--deliver origin] [--skills a,b] [--tools read,bash]
  ${APP_NAME} cron update <job> [--name <name>] [--schedule <expr>] [--prompt <text>] [--deliver origin] [--skills a,b]
  ${APP_NAME} cron pause <job>
  ${APP_NAME} cron resume <job>
  ${APP_NAME} cron remove <job>
  ${APP_NAME} cron trigger <job>
  ${APP_NAME} cron run <job>
  ${APP_NAME} cron tick
  ${APP_NAME} cron daemon

${chalk.bold("Schedules:")}
  30m, in 2h, every 6h, 2026-05-27T09:00:00+09:00, "0 9 * * *"

${chalk.bold("Notes:")}
  Jobs are stored under ~/.pie/agent/cron/jobs.json.
  Outputs are saved under ~/.pie/agent/cron/output/<job-id>/.
  Delivery targets: local, origin, all, chat:<account/channel>, telegram:<channel-id>, discord:<channel-id>.
  Scripts must be relative paths under ~/.pie/agent/scripts/.`);
}

function printResult<T>(value: T, json: boolean, format: (value: T) => string): void {
	console.log(json ? JSON.stringify(value, null, 2) : format(value));
}

function formatJobList(jobs: CronJob[]): string {
	if (jobs.length === 0) return "No scheduled jobs found.";
	return jobs
		.map((job) => {
			const enabled = job.enabled ? "on " : "off";
			const next = job.nextRunAt ?? "-";
			const deliver = job.deliver && job.deliver !== "local" ? ` deliver:${job.deliver}` : "";
			return `${enabled} ${job.state.padEnd(9)} ${job.id.padEnd(24)} next:${next}${deliver} ${job.name}`;
		})
		.join("\n");
}

function requireRef(parsed: ParsedCronArgs): string {
	const ref = parsed.positionals[0];
	if (!ref) throw new Error(`${parsed.command} requires a job id or name.`);
	return ref;
}

async function requireJob(store: CronJobStore, ref: string | undefined): Promise<CronJob> {
	if (!ref) throw new Error("job id or name is required.");
	const job = await store.get(ref);
	if (!job) throw new Error(`Scheduled job not found: ${ref}`);
	return job;
}

function getStringFlag(parsed: ParsedCronArgs, name: string): string | undefined {
	const value = parsed.flags.get(name);
	return typeof value === "string" ? value : undefined;
}

function getNullableStringFlag(parsed: ParsedCronArgs, name: string): string | null | undefined {
	if (!parsed.flags.has(name)) return undefined;
	const value = parsed.flags.get(name);
	if (value === true || value === "") return null;
	return String(value);
}

function getNumberFlag(parsed: ParsedCronArgs, name: string): number | undefined {
	const value = getStringFlag(parsed, name);
	if (value === undefined) return undefined;
	const parsedValue = Number(value);
	if (!Number.isFinite(parsedValue)) throw new Error(`--${name} must be a number.`);
	return parsedValue;
}

function getNullableNumberFlag(parsed: ParsedCronArgs, name: string): number | null | undefined {
	if (!parsed.flags.has(name)) return undefined;
	const value = parsed.flags.get(name);
	if (value === true || value === "") return null;
	return getNumberFlag(parsed, name);
}

function getBooleanFlag(parsed: ParsedCronArgs, name: string): boolean {
	return parsed.flags.get(name) === true || parsed.flags.get(name) === "true" || parsed.flags.get(name) === "1";
}

function getOptionalBooleanFlag(parsed: ParsedCronArgs, name: string): boolean | undefined {
	if (!parsed.flags.has(name)) return undefined;
	return getBooleanFlag(parsed, name);
}

function getCsvFlag(parsed: ParsedCronArgs, name: string): string[] | undefined {
	const value = getStringFlag(parsed, name);
	return value
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: undefined;
}

function getNullableCsvFlag(parsed: ParsedCronArgs, name: string): string[] | null | undefined {
	if (!parsed.flags.has(name)) return undefined;
	const value = getStringFlag(parsed, name);
	return value
		? value
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean)
		: null;
}

function getModelFlag(parsed: ParsedCronArgs): { provider?: string; id?: string } | undefined {
	const provider = getStringFlag(parsed, "provider");
	const id = getStringFlag(parsed, "model");
	return provider || id ? { provider, id } : undefined;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
