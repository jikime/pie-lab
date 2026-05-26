import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CronJobStore,
	DEFAULT_SCHEDULER_SETTINGS,
	deliverCronResult,
	parseSchedule,
	tickCronScheduler,
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

describe("scheduler jobs", () => {
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
