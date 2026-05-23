import { createInMemoryUsageStore, createUsageRecordId, type UsageRecord } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createUsageRequestHandler, getDefaultUsageFilePath, parseUsageRecordQuery } from "../src/index.js";

describe("usage API", () => {
	let server: Server | undefined;

	afterEach(async () => {
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server?.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			server = undefined;
		}
	});

	function usageRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
		return {
			id: createUsageRecordId(),
			requestId: "request_1",
			timestamp: "2026-05-22T00:00:00.000Z",
			requestedModel: "combo:coding",
			routingMode: "router",
			routeSource: "router",
			resolvedProvider: "anthropic",
			resolvedModel: "claude-sonnet-4.5",
			attemptIndex: 0,
			attemptCount: 1,
			status: "success",
			usage: {
				input: 10,
				output: 5,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 15,
			},
			cost: {
				input: 0.001,
				output: 0.002,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0.003,
				currency: "USD",
				pricingSource: "pie-metadata",
			},
			inputTokens: 10,
			outputTokens: 5,
			costUsd: 0.003,
			...overrides,
		};
	}

	async function start(records: UsageRecord[]): Promise<string> {
		const store = createInMemoryUsageStore();
		for (const record of records) {
			store.recordUsage(record);
		}

		server = createServer(createUsageRequestHandler({ usageStore: store }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	it("returns recent usage records with filters", async () => {
		const baseUrl = await start([
			usageRecord({
				id: "usage_1",
				timestamp: "2026-05-22T00:00:00.000Z",
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.1",
			}),
			usageRecord({
				id: "usage_2",
				timestamp: "2026-05-22T00:01:00.000Z",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
			}),
			usageRecord({
				id: "usage_3",
				timestamp: "2026-05-22T00:02:00.000Z",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-haiku-4.5",
				status: "error",
				errorMessage: "rate limit",
			}),
		]);

		const response = await fetch(`${baseUrl}/usage?provider=anthropic&limit=1`);
		const body = (await response.json()) as { count: number; records: UsageRecord[] };

		expect(response.status).toBe(200);
		expect(body.count).toBe(1);
		expect(body.records.map((record) => record.id)).toEqual(["usage_3"]);
	});

	it("returns usage summaries", async () => {
		const baseUrl = await start([
			usageRecord({
				id: "usage_1",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-sonnet-4.5",
			}),
			usageRecord({
				id: "usage_2",
				resolvedProvider: "anthropic",
				resolvedModel: "claude-haiku-4.5",
				status: "error",
				usage: undefined,
				cost: undefined,
				inputTokens: 20,
				outputTokens: 0,
				costUsd: 0,
			}),
		]);

		const response = await fetch(`${baseUrl}/usage/summary?provider=anthropic`);
		const body = (await response.json()) as {
			count: number;
			summary: { records: number; success: number; error: number; inputTokens: number; totalTokens: number; costUsd: number };
		};

		expect(response.status).toBe(200);
		expect(body.count).toBe(2);
		expect(body.summary).toMatchObject({
			records: 2,
			success: 1,
			error: 1,
			inputTokens: 30,
			totalTokens: 35,
			costUsd: 0.003,
		});
	});

	it("returns request detail timelines", async () => {
		const baseUrl = await start([
			usageRecord({
				id: "usage_1",
				requestId: "request_detail_1",
				attemptIndex: 1,
				attemptCount: 2,
				resolvedProvider: "openai",
				resolvedModel: "gpt-5.4",
				trace: [
					{
						timestamp: "2026-05-22T00:00:01.000Z",
						phase: "attempt.success",
						status: "success",
					},
				],
			}),
			usageRecord({
				id: "usage_2",
				requestId: "request_detail_1",
				attemptIndex: 0,
				attemptCount: 2,
				status: "error",
				errorMessage: "rate limit",
				trace: [
					{
						timestamp: "2026-05-22T00:00:00.000Z",
						phase: "fallback.decision",
						status: "fallback",
						metadata: { shouldFallback: true },
					},
				],
			}),
		]);

		const response = await fetch(`${baseUrl}/usage/request_detail_1`);
		const body = (await response.json()) as {
			count: number;
			timeline: Array<{ id: string; attemptIndex: number; status: string }>;
			trace: Array<{ recordId: string; phase: string; attemptIndex: number; status: string }>;
		};

		expect(response.status).toBe(200);
		expect(body.count).toBe(2);
		expect(body.timeline.map((item) => item.id)).toEqual(["usage_2", "usage_1"]);
		expect(body.timeline[0]).toMatchObject({ attemptIndex: 0, status: "error" });
		expect(body.trace.map((event) => `${event.recordId}:${event.phase}:${event.status}`)).toEqual([
			"usage_2:fallback.decision:fallback",
			"usage_1:attempt.success:success",
		]);
	});

	it("parses query params used by the API", () => {
		const query = parseUsageRecordQuery(
			new URLSearchParams("status=success,error&provider=anthropic&from=2026-05-22T00:00:00Z&limit=5000"),
			{ defaultLimit: 100, maxLimit: 1000 },
		);

		expect(query).toEqual({
			status: ["success", "error"],
			provider: "anthropic",
			from: "2026-05-22T00:00:00Z",
			limit: 1000,
		});
	});

	it("uses pie agent usage.jsonl as the default usage path", () => {
		expect(getDefaultUsageFilePath({ PIE_CODING_AGENT_DIR: "/tmp/pie-agent" })).toBe("/tmp/pie-agent/usage.jsonl");
		expect(getDefaultUsageFilePath({ PI_CODING_AGENT_DIR: "/tmp/pi-agent" })).toBe("/tmp/pi-agent/usage.jsonl");
		expect(getDefaultUsageFilePath({ PIE_LAB_USAGE_PATH: "/tmp/custom.jsonl" })).toBe("/tmp/custom.jsonl");
	});
});
