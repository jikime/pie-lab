import { LearningReviewStore, SkillManager } from "@pie-lab/coding-agent";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLearningRequestHandler } from "../src/learning-api.js";

describe("learning API", () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server?.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
			server = undefined;
		}
	});

	async function start() {
		const agentDir = mkdtempSync(join(tmpdir(), "pie-learning-api-agent-"));
		const cwd = mkdtempSync(join(tmpdir(), "pie-learning-api-cwd-"));
		server = createServer(createLearningRequestHandler({ agentDir, cwd }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		return { agentDir, cwd, baseUrl: `http://127.0.0.1:${address.port}` };
	}

	it("returns memory and curator status", async () => {
		const { agentDir, cwd, baseUrl } = await start();
		const manager = new SkillManager({ agentDir, cwd });
		manager.create("router-integration-debugging", "Use this for router debugging.");

		const response = await fetch(`${baseUrl}/learning`);
		const body = (await response.json()) as { curator: { status: Array<{ name: string }> } };

		expect(response.status).toBe(200);
		expect(body.curator.status.map((skill) => skill.name)).toContain("router-integration-debugging");
	});

	it("runs curator dry-run and updates curator settings", async () => {
		const { agentDir, cwd, baseUrl } = await start();
		const manager = new SkillManager({ agentDir, cwd });
		manager.create("nextjs-dashboard-migration", "Use this for dashboard migrations.");
		const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
		writeFileSync(
			join(agentDir, "skills/nextjs-dashboard-migration/.usage.json"),
			`${JSON.stringify({ createdBy: "agent", createdAt: oldDate, updatedAt: oldDate }, null, 2)}\n`,
			"utf-8",
		);

		const settingsResponse = await fetch(`${baseUrl}/learning/curator`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "settings",
				settings: { staleAfterDays: 1, archiveAfterDays: 2, pruneAfterDays: 3, autoArchive: false },
			}),
		});
		const settingsBody = (await settingsResponse.json()) as { settings: { archiveAfterDays: number; autoArchive: boolean } };
		expect(settingsBody.settings).toMatchObject({ archiveAfterDays: 2, autoArchive: false });

		const runResponse = await fetch(`${baseUrl}/learning/curator`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "run", dryRun: true }),
		});
		const runBody = (await runResponse.json()) as { result: { wouldArchive: Array<{ name: string }> } };

		expect(runResponse.status).toBe(200);
		expect(runBody.result.wouldArchive.map((skill) => skill.name)).toContain("nextjs-dashboard-migration");
	});

	it("runs curator archive action and reflects archived status", async () => {
		const { agentDir, cwd, baseUrl } = await start();
		const manager = new SkillManager({ agentDir, cwd });
		manager.create("old-agent-workflow", "Use this for old agent workflows.");
		const oldDate = new Date(Date.now() - 120 * 86_400_000).toISOString();
		writeFileSync(
			join(agentDir, "skills/old-agent-workflow/.usage.json"),
			`${JSON.stringify({ createdBy: "agent", createdAt: oldDate, updatedAt: oldDate }, null, 2)}\n`,
			"utf-8",
		);

		const runResponse = await fetch(`${baseUrl}/learning/curator`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "run" }),
		});
		const runBody = (await runResponse.json()) as { result: { archived: Array<{ name: string }> } };
		expect(runResponse.status).toBe(200);
		expect(runBody.result.archived.map((skill) => skill.name)).toContain("old-agent-workflow");

		const statusResponse = await fetch(`${baseUrl}/learning/curator`);
		const statusBody = (await statusResponse.json()) as { status: Array<{ name: string; state: string }> };
		expect(statusBody.status).toContainEqual(expect.objectContaining({ name: "old-agent-workflow", state: "archived" }));
	});

	it("returns and rejects learning review proposals", async () => {
		const { agentDir, baseUrl } = await start();
		const store = new LearningReviewStore({ agentDir });
		store.write({
			id: "review-test",
			createdAt: new Date().toISOString(),
			model: "auto:learning",
			mode: "suggest",
			status: "proposed",
			actions: [{ type: "memory_append", text: "Remember dashboard owns Learning UI." }],
			results: [{ action: { type: "memory_append", text: "Remember dashboard owns Learning UI." }, status: "proposed" }],
		});

		const listResponse = await fetch(`${baseUrl}/learning/reviews`);
		const listBody = (await listResponse.json()) as { proposals: number; reviews: Array<{ id: string }> };
		expect(listResponse.status).toBe(200);
		expect(listBody.proposals).toBe(1);
		expect(listBody.reviews.map((review) => review.id)).toContain("review-test");

		const rejectResponse = await fetch(`${baseUrl}/learning/reviews`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "reject", id: "review-test" }),
		});
		const rejectBody = (await rejectResponse.json()) as { review: { status: string } };
		expect(rejectResponse.status).toBe(200);
		expect(rejectBody.review.status).toBe("skipped");
	});

	it("approves learning review proposals and applies proposed actions", async () => {
		const { agentDir, baseUrl } = await start();
		const store = new LearningReviewStore({ agentDir });
		store.write({
			id: "review-approve-test",
			createdAt: new Date().toISOString(),
			model: "auto:learning",
			mode: "suggest",
			status: "proposed",
			actions: [
				{ type: "memory_append", text: "Remember dashboard approves Learning proposals." },
				{
					type: "skill_create",
					name: "dashboard-learning-review",
					description: "Use this when validating dashboard Learning review actions.",
					content:
						"---\nname: dashboard-learning-review\ndescription: Use this when validating dashboard Learning review actions.\n---\n\n# Dashboard Learning Review\n\nValidate proposal approval through the Learning dashboard API.",
				},
			],
			results: [
				{
					action: { type: "memory_append", text: "Remember dashboard approves Learning proposals." },
					status: "proposed",
				},
				{
					action: {
						type: "skill_create",
						name: "dashboard-learning-review",
						description: "Use this when validating dashboard Learning review actions.",
						content:
							"---\nname: dashboard-learning-review\ndescription: Use this when validating dashboard Learning review actions.\n---\n\n# Dashboard Learning Review\n\nValidate proposal approval through the Learning dashboard API.",
					},
					status: "proposed",
				},
			],
		});

		const approveResponse = await fetch(`${baseUrl}/learning/reviews`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "approve", id: "review-approve-test" }),
		});
		const approveBody = (await approveResponse.json()) as {
			review: { status: string; results: Array<{ status: string }> };
		};

		expect(approveResponse.status).toBe(200);
		expect(approveBody.review.status).toBe("applied");
		expect(approveBody.review.results.map((result) => result.status)).toEqual(["applied", "applied"]);

		const learningResponse = await fetch(`${baseUrl}/learning`);
		const learningBody = (await learningResponse.json()) as {
			memory: { memory: string };
			curator: { status: Array<{ name: string }> };
		};
		expect(learningBody.memory.memory).toContain("dashboard approves Learning proposals");
		expect(learningBody.curator.status.map((skill) => skill.name)).toContain("dashboard-learning-review");
	});
});
