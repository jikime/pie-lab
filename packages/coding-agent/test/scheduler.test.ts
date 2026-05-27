import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CronJobStore,
	DEFAULT_SCHEDULER_SETTINGS,
	computeGraceWindowSeconds,
	createSchedulerToolDefinitions,
	deliverCronResult,
	parseSchedule,
	tickCronScheduler,
	validateTimezone,
} from "../src/core/scheduler/index.ts";

function tempDir(name: string): string {
	return join(tmpdir(), `pie-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("scheduler schedules", () => {
	it("parses one-shot, interval, and cron schedules", () => {
		const now = new Date("2026-05-26T00:00:00.000Z");

		expect(parseSchedule("30m", { now }).kind).toBe("once");
		expect(parseSchedule("every 2h", { now }).kind).toBe("interval");
		expect(parseSchedule("0 9 * * *", { now }).kind).toBe("cron");
	});

	it("attaches timezone to cron scheduleDisplay", () => {
		const now = new Date("2026-05-26T00:00:00.000Z");
		const parsed = parseSchedule("0 9 * * *", { now, timezone: "Asia/Seoul" });
		expect(parsed.kind).toBe("cron");
		expect(parsed.scheduleDisplay).toContain("Asia/Seoul");
	});

	it("validateTimezone accepts valid IANA timezones and rejects invalid ones", () => {
		expect(() => validateTimezone("Asia/Seoul")).not.toThrow();
		expect(() => validateTimezone("America/New_York")).not.toThrow();
		expect(() => validateTimezone("UTC")).not.toThrow();
		expect(() => validateTimezone("Not/ATimezone")).toThrow(/Invalid timezone/i);
	});
});

describe("scheduler grace window", () => {
	it("returns 120s grace for one-shot jobs", () => {
		expect(computeGraceWindowSeconds({ kind: "once", repeat: false })).toBe(120);
	});

	it("clamps interval grace to [120s, 7200s]", () => {
		// 10s interval → half=5s → clamped to 120
		expect(computeGraceWindowSeconds({ kind: "interval", repeat: true, intervalMs: 10_000 })).toBe(120);
		// 1h interval → half=1800s → within range
		expect(computeGraceWindowSeconds({ kind: "interval", repeat: true, intervalMs: 3_600_000 })).toBe(1800);
		// 24h interval → half=43200s → clamped to 7200
		expect(computeGraceWindowSeconds({ kind: "interval", repeat: true, intervalMs: 86_400_000 })).toBe(7200);
	});

	it("estimates grace for cron jobs from consecutive run gap", () => {
		// "* * * * *" runs every minute → gap=60s → half=30s → clamped to 120
		expect(computeGraceWindowSeconds({ kind: "cron", repeat: true, cronExpression: "* * * * *" })).toBe(120);
		// "0 * * * *" runs every hour → gap=3600s → half=1800s → within range
		expect(computeGraceWindowSeconds({ kind: "cron", repeat: true, cronExpression: "0 * * * *" })).toBe(1800);
	});
});

describe("scheduler delivery", () => {
	it("delivers scheduled output to configured chat destinations", async () => {
		const agentDir = tempDir("cron-delivery");
		mkdirSync(join(agentDir, "chat"), { recursive: true });
		writeFileSync(
			join(agentDir, "chat/config.json"),
			JSON.stringify({
				accounts: {
					tg: {
						service: "telegram",
						botToken: "telegram-token",
						channels: { dm: { id: "123" } },
					},
					discord: {
						service: "discord",
						botToken: "discord-token",
						channels: { general: { id: "456" } },
					},
				},
			}),
			"utf-8",
		);
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			const href = String(url);
			if (href.includes("telegram.org")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
			return new Response(JSON.stringify({ id: "message-id" }), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await deliverCronResult({
			agentDir,
			deliver: "all",
			content: "scheduled result",
		});

		expect(result.errors).toEqual([]);
		expect(result.delivered).toBe(2);
		expect(result.targets.sort()).toEqual(["discord/general", "tg/dm"]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("resolves origin delivery from the chat conversation id", async () => {
		const agentDir = tempDir("cron-origin-delivery");
		mkdirSync(join(agentDir, "chat"), { recursive: true });
		writeFileSync(
			join(agentDir, "chat/config.json"),
			JSON.stringify({
				accounts: {
					tg: {
						service: "telegram",
						botToken: "telegram-token",
						channels: { dm: { id: "123" } },
					},
				},
			}),
			"utf-8",
		);
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await deliverCronResult({
			agentDir,
			deliver: "origin",
			origin: "tg/dm",
			content: "scheduled result",
		});

		expect(result.errors).toEqual([]);
		expect(result.delivered).toBe(1);
		expect(result.targets).toEqual(["tg/dm"]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe("scheduler missed-run and stale recovery", () => {
	it("fast-forwards a missed repeating job instead of running it", async () => {
		const agentDir = tempDir("cron-missed");
		const cwd = tempDir("cron-missed-cwd");
		const store = new CronJobStore({ agentDir, cwd });
		// Create an interval job whose nextRunAt is way in the past (beyond grace window)
		const job = await store.create({ name: "old", prompt: "do it", schedule: "every 1m" });
		// Manually set nextRunAt to 1 hour ago
		await store.trigger(job.id, new Date(Date.now() - 3_600_000));
		// At this point nextRunAt is 1h in the past; grace for "every 1m" is 120s
		// getDueJobs should fast-forward it, not return it
		const due = await store.getDueJobs();
		expect(due.find((j) => j.id === job.id)).toBeUndefined();
		// After fast-forward the job should have a future nextRunAt
		const updated = await store.get(job.id);
		expect(updated?.nextRunAt).toBeDefined();
		expect(new Date(updated!.nextRunAt!).getTime()).toBeGreaterThan(Date.now() - 10_000);
	});

	it("resetStaleRunning resets jobs stuck in running state", async () => {
		const agentDir = tempDir("cron-stale");
		const cwd = tempDir("cron-stale-cwd");
		const store = new CronJobStore({ agentDir, cwd });
		const job = await store.create({ name: "stuck", prompt: "run", schedule: "every 5m" });
		// Manually set job to running state with an old updatedAt
		const oldTime = new Date(Date.now() - 3_600_000).toISOString();
		await store.trigger(job.id);
		// Patch the file directly to simulate a stuck running job
		const { readFileSync: rf, writeFileSync: wf } = await import("node:fs");
		const fileData = JSON.parse(rf(store.jobsFile, "utf-8")) as { version: 1; jobs: typeof job[] };
		const idx = fileData.jobs.findIndex((j) => j.id === job.id);
		fileData.jobs[idx] = { ...fileData.jobs[idx], state: "running", updatedAt: oldTime };
		wf(store.jobsFile, JSON.stringify(fileData, null, 2), "utf-8");

		const count = await store.resetStaleRunning(60_000); // 1 minute threshold
		expect(count).toBe(1);
		const updated = await store.get(job.id);
		expect(updated?.state).toBe("pending");
		expect(updated?.lastError).toMatch(/stale running/i);
	});
});

describe("scheduler wake-gate", () => {
	it("runs a noAgent script and delivers stdout as finalResponse", async () => {
		const agentDir = tempDir("cron-wakegate");
		const cwd = tempDir("cron-wakegate-cwd");
		mkdirSync(join(agentDir, "scripts"), { recursive: true });
		mkdirSync(cwd, { recursive: true });
		// Script that emits a wake-gate JSON on last line (wakeAgent: false)
		const scriptPath = join(agentDir, "scripts/gate.sh");
		writeFileSync(scriptPath, '#!/bin/sh\necho "data produced"\necho \'{"wakeAgent":false}\'\n', "utf-8");
		chmodSync(scriptPath, 0o700);

		const store = new CronJobStore({ agentDir, cwd });
		const job = await store.create({
			name: "gated",
			prompt: "run",
			schedule: "1h",
			script: "gate.sh",
			noAgent: true,
		});
		await store.trigger(job.id);

		const results = await tickCronScheduler({ agentDir, cwd, store, settings: DEFAULT_SCHEDULER_SETTINGS });
		expect(results).toHaveLength(1);
		// Script produced output — status should be success
		expect(results[0].status).toBe("success");
		// The gate JSON line should be stripped from the final response
		expect(results[0].finalResponse).toContain("data produced");
		expect(results[0].finalResponse).not.toContain("wakeAgent");
	});
});

describe("scheduler jobs", () => {
	it("records explicit chat origin when cronjob tool creates a job", async () => {
		const store = new CronJobStore({ agentDir: tempDir("cron-tool-origin"), cwd: tempDir("cron-tool-origin-cwd") });
		const [tool] = createSchedulerToolDefinitions({ store, getOrigin: () => "tg/dm" });

		const result = await tool.execute(
			"tool-call-id",
			{
				action: "create",
				name: "origin-test",
				prompt: "say hello",
				schedule: "1h",
				deliver: "origin",
			},
			undefined,
			undefined,
			undefined as never,
		);

		expect((result.details as { origin?: string }).origin).toBe("tg/dm");
	});

	it("runs a noAgent script job and saves output", async () => {
		const agentDir = tempDir("cron");
		const cwd = tempDir("cron-cwd");
		mkdirSync(join(agentDir, "scripts"), { recursive: true });
		mkdirSync(cwd, { recursive: true });
		const scriptPath = join(agentDir, "scripts/hello.sh");
		writeFileSync(scriptPath, "#!/bin/sh\necho scheduler-ok\n", "utf-8");
		chmodSync(scriptPath, 0o700);

		const store = new CronJobStore({ agentDir, cwd });
		const job = await store.create({
			name: "hello",
			prompt: "say hello",
			schedule: "1h",
			script: "hello.sh",
			noAgent: true,
		});
		await store.trigger(job.id);

		const results = await tickCronScheduler({
			agentDir,
			cwd,
			store,
			settings: DEFAULT_SCHEDULER_SETTINGS,
		});

		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("success");
		expect(results[0].finalResponse).toBe("scheduler-ok");
		expect(results[0].outputPath && existsSync(results[0].outputPath)).toBe(true);
		expect(readFileSync(results[0].outputPath!, "utf-8")).toContain("scheduler-ok");
	});

	it("blocks script path traversal", async () => {
		const store = new CronJobStore({ agentDir: tempDir("cron-traversal"), cwd: tempDir("cron-traversal-cwd") });

		await expect(
			store.create({
				name: "bad",
				prompt: "do it",
				schedule: "1h",
				script: "../escape.sh",
				noAgent: true,
			}),
		).rejects.toThrow(/path traversal/i);
	});
});
