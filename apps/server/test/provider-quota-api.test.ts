import {
	createInMemoryProviderConnectionStore,
	type ProviderConnection,
	type ProviderConnectionJsonState,
} from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createProviderQuotaRequestHandler,
	createProviderQuotaSelectionSnapshot,
	getUsageForProvider,
} from "../src/index.js";

describe("provider quota API", () => {
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

	function providerConnection(
		overrides: Partial<ProviderConnection> & { id: string; provider: string },
	): ProviderConnection {
		const { id, provider, ...rest } = overrides;
		return {
			id,
			provider,
			authType: "apikey",
			isActive: true,
			createdAt: "2026-05-22T00:00:00.000Z",
			updatedAt: "2026-05-22T00:00:00.000Z",
			...rest,
		};
	}

	function usageResponse(modelRemains: unknown[]): Response {
		return new Response(
			JSON.stringify({
				base_resp: { status_code: 0, status_msg: "success" },
				model_remains: modelRemains,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	}

	function jsonResponse(data: unknown, status = 200): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: { "Content-Type": "application/json" },
		});
	}

	async function start(
		connections: ProviderConnection[],
		fetchImpl?: typeof fetch,
		extraState: Omit<Partial<ProviderConnectionJsonState>, "connections"> = {},
	): Promise<string> {
		const store = createInMemoryProviderConnectionStore({ ...extraState, connections });
		server = createServer(
			createProviderQuotaRequestHandler({
				providerConnectionStore: store,
				fetch: fetchImpl,
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	it("lists provider quota connection statuses without exposing credentials", async () => {
		const baseUrl = await start([
			providerConnection({
				id: "minimax_conn_1",
				provider: "minimax",
				apiKey: "secret-minimax-key",
				name: "MiniMax key",
			}),
			providerConnection({
				id: "openai_conn_1",
				provider: "openai",
				apiKey: "secret-openai-key",
				name: "OpenAI key",
			}),
		]);

		const response = await fetch(`${baseUrl}/quota`);
		const body = (await response.json()) as {
			count: number;
			data: Array<{
				id: string;
				provider: string;
				supported: boolean;
				eligible: boolean;
				usageAuthType: string;
			}>;
		};

		expect(response.status).toBe(200);
		expect(body.count).toBe(2);
		expect(body.data).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "minimax_conn_1",
					provider: "minimax",
					supported: true,
					eligible: true,
					usageAuthType: "apikey",
				}),
				expect.objectContaining({
					id: "openai_conn_1",
					provider: "openai",
					supported: false,
					eligible: false,
					usageAuthType: "unsupported",
				}),
			]),
		);
		expect(JSON.stringify(body)).not.toContain("secret-minimax-key");
		expect(JSON.stringify(body)).not.toContain("secret-openai-key");
	});

	it("parses 9router MiniMax token-plan quota counts as used counts", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			usageResponse([
				{
					model_name: "text to speech hd",
					current_interval_total_count: 4000,
					current_interval_usage_count: 25,
					current_weekly_total_count: 12000,
					current_weekly_usage_count: 100,
					end_time: "2026-05-12T10:00:00.000Z",
					weekly_end_time: "2026-05-19T10:00:00.000Z",
				},
			]),
		);

		const usage = await getUsageForProvider(
			providerConnection({ id: "minimax_conn_1", provider: "minimax", apiKey: "test-key" }),
			fetchMock as unknown as typeof fetch,
		);

		expect(usage.message).toBeUndefined();
		expect(usage.quotas?.["Text to Speech HD (5h)"]).toMatchObject({
			used: 25,
			total: 4000,
			remaining: 3975,
		});
		expect(usage.quotas?.["Text to Speech HD (7d)"]).toMatchObject({
			used: 100,
			total: 12000,
			remaining: 11900,
		});
	});

	it("parses 9router MiniMax coding-plan quota counts as remaining counts", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			usageResponse([
				{
					modelName: "Text to Speech HD",
					currentIntervalTotalCount: 4000,
					currentIntervalUsageCount: 4000,
					currentWeeklyTotalCount: 12000,
					currentWeeklyUsageCount: 11800,
					remainsTime: 1000,
					weeklyRemainsTime: 2000,
				},
			]),
		);

		const usage = await getUsageForProvider(
			providerConnection({ id: "minimax_cn_conn_1", provider: "minimax-cn", apiKey: "test-key" }),
			fetchMock as unknown as typeof fetch,
		);

		expect(usage.message).toBeUndefined();
		expect(usage.quotas?.["Text to Speech HD (5h)"]).toMatchObject({
			used: 0,
			total: 4000,
			remaining: 4000,
		});
		expect(usage.quotas?.["Text to Speech HD (7d)"]).toMatchObject({
			used: 200,
			total: 12000,
			remaining: 11800,
		});
	});

	it("returns quota detail over HTTP for a specific connection", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			usageResponse([
				{
					model_name: "music-2.6",
					current_interval_total_count: 100,
					current_interval_usage_count: 5,
				},
			]),
		);
		const baseUrl = await start(
			[
				providerConnection({
					id: "minimax_conn_1",
					provider: "minimax",
					apiKey: "test-key",
				}),
			],
			fetchMock as unknown as typeof fetch,
		);

		const response = await fetch(`${baseUrl}/v1/quota/minimax_conn_1`);
		const body = (await response.json()) as {
			connection: { id: string; provider: string };
			usage: { quotas?: Record<string, { used: number; total: number; remaining: number }> };
		};

		expect(response.status).toBe(200);
		expect(body.connection).toMatchObject({ id: "minimax_conn_1", provider: "minimax" });
		expect(body.usage.quotas?.["Music 2.6 (5h)"]).toMatchObject({
			used: 5,
			total: 100,
			remaining: 95,
		});
	});

	it("parses 9router Gemini CLI quota buckets", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				buckets: [
					{
						modelId: "gemini-2.5-pro",
						remainingFraction: 0.25,
						resetTime: "2026-05-22T12:00:00.000Z",
					},
				],
			}),
		);

		const usage = await getUsageForProvider(
			providerConnection({
				id: "gemini_conn_1",
				provider: "gemini-cli",
				authType: "oauth",
				accessToken: "test-token",
				providerSpecificData: { projectId: "project-1" },
			}),
			fetchMock as unknown as typeof fetch,
		);

		expect(usage.quotas?.["gemini-2.5-pro"]).toMatchObject({
			used: 750,
			total: 1000,
			remaining: 250,
			remainingPercentage: 25,
			resetAt: "2026-05-22T12:00:00.000Z",
		});
	});

	it("parses 9router Antigravity recommended model quota", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					cloudaicompanionProject: "ag-project",
					currentTier: { name: "Pro" },
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					models: {
						"claude-sonnet-4-6": {
							displayName: "Claude Sonnet 4.6",
							quotaInfo: {
								remainingFraction: 0.4,
								resetTime: "2026-05-22T13:00:00.000Z",
							},
						},
						"internal-model": {
							isInternal: true,
							quotaInfo: { remainingFraction: 0.9 },
						},
					},
				}),
			);

		const usage = await getUsageForProvider(
			providerConnection({
				id: "antigravity_conn_1",
				provider: "antigravity",
				authType: "oauth",
				accessToken: "test-token",
			}),
			fetchMock as unknown as typeof fetch,
		);

		expect(usage.plan).toBe("Pro");
		expect(usage.quotas?.["claude-sonnet-4-6"]).toMatchObject({
			used: 600,
			total: 1000,
			remaining: 400,
			remainingPercentage: 40,
			displayName: "Claude Sonnet 4.6",
		});
		expect(usage.quotas?.["internal-model"]).toBeUndefined();
	});

	it("parses 9router Kiro usage limits", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				nextDateReset: "2026-05-22T14:00:00.000Z",
				subscriptionInfo: { subscriptionTitle: "Kiro Pro" },
				usageBreakdownList: [
					{
						resourceType: "AGENTIC_REQUEST",
						currentUsageWithPrecision: 6,
						usageLimitWithPrecision: 20,
						freeTrialInfo: {
							currentUsageWithPrecision: 2,
							usageLimitWithPrecision: 5,
							freeTrialExpiry: "2026-05-23T00:00:00.000Z",
						},
					},
				],
			}),
		);

		const usage = await getUsageForProvider(
			providerConnection({
				id: "kiro_conn_1",
				provider: "kiro",
				authType: "oauth",
				accessToken: "test-token",
			}),
			fetchMock as unknown as typeof fetch,
		);

		expect(usage.plan).toBe("Kiro Pro");
		expect(usage.quotas?.agentic_request).toMatchObject({
			used: 6,
			total: 20,
			remaining: 14,
			resetAt: "2026-05-22T14:00:00.000Z",
		});
		expect(usage.quotas?.agentic_request_freetrial).toMatchObject({
			used: 2,
			total: 5,
			remaining: 3,
			resetAt: "2026-05-23T00:00:00.000Z",
		});
	});

	it("refreshes expired OAuth credentials before quota detail fetch", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "old-token",
					refreshToken: "old-refresh",
					expiresAt: "2026-05-21T00:00:00.000Z",
					providerSpecificData: { projectId: "project-1" },
				}),
			],
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "new-token",
					refresh_token: "new-refresh",
					expires_in: 3600,
				}),
			)
			.mockResolvedValueOnce(jsonResponse({ buckets: [] }));
		server = createServer(
			createProviderQuotaRequestHandler({
				providerConnectionStore: store,
				fetch: fetchMock as unknown as typeof fetch,
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		const response = await fetch(`http://127.0.0.1:${address.port}/quota/gemini_conn_1`);
		const body = (await response.json()) as { connection: { id: string }; usage: { quotas?: Record<string, unknown> } };
		const updated = await store.getProviderConnectionById("gemini_conn_1");
		const usageRequest = fetchMock.mock.calls[1];

		expect(response.status).toBe(200);
		expect(body.connection.id).toBe("gemini_conn_1");
		expect(updated?.accessToken).toBe("new-token");
		expect(updated?.refreshToken).toBe("new-refresh");
		expect(typeof updated?.expiresAt).toBe("string");
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://oauth2.googleapis.com/token");
		expect(String(usageRequest?.[0])).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
		expect((usageRequest?.[1] as RequestInit | undefined)?.headers).toMatchObject({
			Authorization: "Bearer new-token",
		});
	});

	it("force refreshes OAuth credentials and retries once when usage reports auth expiry", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "old-token",
					refreshToken: "old-refresh",
					expiresAt: "2099-05-23T00:00:00.000Z",
					providerSpecificData: { projectId: "project-1" },
				}),
			],
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
			.mockResolvedValueOnce(
				jsonResponse({
					access_token: "new-token",
					refresh_token: "new-refresh",
					expires_in: 3600,
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					buckets: [{ modelId: "gemini-2.5-pro", remainingFraction: 0.5 }],
				}),
			);
		server = createServer(
			createProviderQuotaRequestHandler({
				providerConnectionStore: store,
				fetch: fetchMock as unknown as typeof fetch,
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		const response = await fetch(`http://127.0.0.1:${address.port}/quota/gemini_conn_1`);
		const body = (await response.json()) as {
			usage: { quotas?: Record<string, { used: number; remaining: number }> };
		};
		const retryRequest = fetchMock.mock.calls[2];

		expect(response.status).toBe(200);
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
		expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://oauth2.googleapis.com/token");
		expect(String(retryRequest?.[0])).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
		expect((retryRequest?.[1] as RequestInit | undefined)?.headers).toMatchObject({
			Authorization: "Bearer new-token",
		});
		expect(body.usage.quotas?.["gemini-2.5-pro"]).toMatchObject({
			used: 500,
			remaining: 500,
		});
	});

	it("routes quota detail fetch through a 9router-style Vercel relay proxy", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				buckets: [{ modelId: "gemini-2.5-pro", remainingFraction: 0.75 }],
			}),
		);
		const baseUrl = await start(
			[
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "test-token",
					providerSpecificData: {
						projectId: "project-1",
						vercelRelayUrl: "https://relay.example/api",
					},
				}),
			],
			fetchMock as unknown as typeof fetch,
		);

		const response = await fetch(`${baseUrl}/quota/gemini_conn_1`);
		const body = (await response.json()) as { usage: { quotas?: Record<string, { remaining: number }> } };
		const relayRequest = fetchMock.mock.calls[0];
		const relayHeaders = (relayRequest?.[1] as RequestInit | undefined)?.headers;

		expect(response.status).toBe(200);
		expect(String(relayRequest?.[0])).toBe("https://relay.example/api");
		expect(relayHeaders).toMatchObject({
			Authorization: "Bearer test-token",
			"x-relay-target": "https://cloudcode-pa.googleapis.com",
			"x-relay-path": "/v1internal:retrieveUserQuota",
		});
		expect(body.usage.quotas?.["gemini-2.5-pro"]).toMatchObject({ remaining: 750 });
	});

	it("routes quota detail fetch through a 9router proxy pool Vercel relay", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				buckets: [{ modelId: "gemini-2.5-pro", remainingFraction: 0.4 }],
			}),
		);
		const baseUrl = await start(
			[
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "test-token",
					providerSpecificData: {
						projectId: "project-1",
						proxyPoolId: "proxy_pool_relay",
					},
				}),
			],
			fetchMock as unknown as typeof fetch,
			{
				proxyPools: [
					{
						id: "proxy_pool_relay",
						name: "Relay",
						proxyUrl: "https://relay.example/api",
						noProxy: "",
						type: "vercel",
						isActive: true,
						strictProxy: true,
						testStatus: "ok",
						createdAt: "2026-05-22T00:00:00.000Z",
						updatedAt: "2026-05-22T00:00:00.000Z",
					},
				],
			},
		);

		const response = await fetch(`${baseUrl}/quota/gemini_conn_1`);
		const relayRequest = fetchMock.mock.calls[0];
		const relayHeaders = (relayRequest?.[1] as RequestInit | undefined)?.headers;

		expect(response.status).toBe(200);
		expect(String(relayRequest?.[0])).toBe("https://relay.example/api");
		expect(relayHeaders).toMatchObject({
			Authorization: "Bearer test-token",
			"x-relay-target": "https://cloudcode-pa.googleapis.com",
			"x-relay-path": "/v1internal:retrieveUserQuota",
		});
	});

	it("attaches a dispatcher when a 9router standard proxy pool is active", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				buckets: [{ modelId: "gemini-2.5-flash", remainingFraction: 0.2 }],
			}),
		);
		const baseUrl = await start(
			[
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "test-token",
					providerSpecificData: {
						projectId: "project-1",
						proxyPoolId: "proxy_pool_http",
					},
				}),
			],
			fetchMock as unknown as typeof fetch,
			{
				proxyPools: [
					{
						id: "proxy_pool_http",
						name: "HTTP proxy",
						proxyUrl: "127.0.0.1:7890",
						noProxy: "",
						type: "http",
						isActive: true,
						strictProxy: true,
						testStatus: "ok",
						createdAt: "2026-05-22T00:00:00.000Z",
						updatedAt: "2026-05-22T00:00:00.000Z",
					},
				],
			},
		);

		const response = await fetch(`${baseUrl}/quota/gemini_conn_1`);
		const proxiedRequest = fetchMock.mock.calls[0];

		expect(response.status).toBe(200);
		expect(String(proxiedRequest?.[0])).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
		expect((proxiedRequest?.[1] as RequestInit & { dispatcher?: unknown })?.dispatcher).toBeTruthy();
	});

	it("attaches a dispatcher when legacy connection proxy config is enabled", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			jsonResponse({
				buckets: [{ modelId: "gemini-2.5-flash", remainingFraction: 0.2 }],
			}),
		);
		const baseUrl = await start(
			[
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					authType: "oauth",
					accessToken: "test-token",
					providerSpecificData: {
						projectId: "project-1",
						connectionProxyEnabled: true,
						connectionProxyUrl: "127.0.0.1:7890",
					},
				}),
			],
			fetchMock as unknown as typeof fetch,
		);

		const response = await fetch(`${baseUrl}/quota/gemini_conn_1`);
		const proxiedRequest = fetchMock.mock.calls[0];

		expect(response.status).toBe(200);
		expect(String(proxiedRequest?.[0])).toBe("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota");
		expect((proxiedRequest?.[1] as RequestInit & { dispatcher?: unknown })?.dispatcher).toBeTruthy();
	});

	it("summarizes provider quotas into account-selection snapshots", () => {
		expect(
			createProviderQuotaSelectionSnapshot(
				{
					quotas: {
						session: { used: 40, total: 100, remaining: 60, remainingPercentage: 60 },
						weekly: { used: 90, total: 100, remaining: 10, remainingPercentage: 10 },
					},
				},
				new Date("2026-05-22T00:00:00.000Z"),
			),
		).toMatchObject({
			checkedAt: "2026-05-22T00:00:00.000Z",
			status: "available",
			score: 0.1,
			remainingPercentage: 10,
		});

		expect(
			createProviderQuotaSelectionSnapshot(
				{
					quotas: {
						session: { used: 100, total: 100, remaining: 0, remainingPercentage: 0 },
					},
				},
				new Date("2026-05-22T00:00:00.000Z"),
			),
		).toMatchObject({
			status: "depleted",
			score: 0,
			remainingPercentage: 0,
		});
	});
});
