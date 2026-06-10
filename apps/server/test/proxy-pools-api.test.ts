import { createInMemoryProviderConnectionStore, createInMemoryUsageStore, type ProviderConnection } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPieLabRequestHandler, createProxyPoolRequestHandler, type ProxyPoolTester } from "../src/index.ts";

describe("proxy pools API", () => {
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
			authType: "oauth",
			isActive: true,
			createdAt: "2026-05-22T00:00:00.000Z",
			updatedAt: "2026-05-22T00:00:00.000Z",
			...rest,
		};
	}

	async function start(
		store: ReturnType<typeof createInMemoryProviderConnectionStore>,
		proxyPoolTester?: ProxyPoolTester,
	): Promise<string> {
		server = createServer(createProxyPoolRequestHandler({ providerConnectionStore: store, proxyPoolTester }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	async function startPieLab(
		store: ReturnType<typeof createInMemoryProviderConnectionStore>,
		proxyPoolTester?: ProxyPoolTester,
	): Promise<string> {
		server = createServer(
			createPieLabRequestHandler({
				providerConnectionStore: store,
				proxyPoolTester,
				usageStore: createInMemoryUsageStore(),
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	it("creates, lists, updates, and deletes proxy pools", async () => {
		const store = createInMemoryProviderConnectionStore();
		const baseUrl = await start(store);

		const createResponse = await fetch(`${baseUrl}/proxy-pools`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Relay",
				type: "vercel",
				proxyUrl: "https://relay.example/api",
				noProxy: "localhost",
			}),
		});
		const createBody = (await createResponse.json()) as { proxyPool: { id: string; type: string; isActive: boolean } };

		expect(createResponse.status).toBe(201);
		expect(createBody.proxyPool).toMatchObject({
			type: "vercel",
			isActive: true,
		});

		const updateResponse = await fetch(`${baseUrl}/proxy-pools/${createBody.proxyPool.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ isActive: false, testStatus: "ok" }),
		});
		const updateBody = (await updateResponse.json()) as { proxyPool: { isActive: boolean; testStatus: string } };

		expect(updateResponse.status).toBe(200);
		expect(updateBody.proxyPool).toMatchObject({ isActive: false, testStatus: "ok" });

		const listResponse = await fetch(`${baseUrl}/v1/proxy-pools?includeUsage=true`);
		const listBody = (await listResponse.json()) as {
			count: number;
			proxyPools: Array<{ id: string; boundConnectionCount: number }>;
		};

		expect(listResponse.status).toBe(200);
		expect(listBody.count).toBe(1);
		expect(listBody.proxyPools[0]).toMatchObject({
			id: createBody.proxyPool.id,
			boundConnectionCount: 0,
		});

		const deleteResponse = await fetch(`${baseUrl}/proxy-pools/${createBody.proxyPool.id}`, { method: "DELETE" });
		const deleteBody = (await deleteResponse.json()) as { success: boolean };

		expect(deleteResponse.status).toBe(200);
		expect(deleteBody.success).toBe(true);
	});

	it("assigns and clears a proxy pool on a provider connection", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "gemini_conn_1",
					provider: "gemini-cli",
					providerSpecificData: { projectId: "project-1" },
				}),
			],
			proxyPools: [
				{
					id: "proxy_pool_1",
					name: "Local proxy",
					type: "http",
					proxyUrl: "127.0.0.1:7890",
					noProxy: "",
					isActive: true,
					strictProxy: false,
					testStatus: "unknown",
					createdAt: "2026-05-22T00:00:00.000Z",
					updatedAt: "2026-05-22T00:00:00.000Z",
				},
			],
		});
		const baseUrl = await start(store);

		const assignResponse = await fetch(`${baseUrl}/provider-connections/gemini_conn_1`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ proxyPoolId: "proxy_pool_1" }),
		});
		const assignBody = (await assignResponse.json()) as { connection: { proxyPoolId: string } };
		const assigned = await store.getProviderConnectionById("gemini_conn_1");

		expect(assignResponse.status).toBe(200);
		expect(assignBody.connection.proxyPoolId).toBe("proxy_pool_1");
		expect(assigned?.providerSpecificData?.proxyPoolId).toBe("proxy_pool_1");

		const conflictResponse = await fetch(`${baseUrl}/proxy-pools/proxy_pool_1`, { method: "DELETE" });
		const conflictBody = (await conflictResponse.json()) as { boundConnectionCount: number };

		expect(conflictResponse.status).toBe(409);
		expect(conflictBody.boundConnectionCount).toBe(1);

		const clearResponse = await fetch(`${baseUrl}/provider-connections/gemini_conn_1`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ proxyPoolId: "__none__" }),
		});
		const cleared = await store.getProviderConnectionById("gemini_conn_1");

		expect(clearResponse.status).toBe(200);
		expect(cleared?.providerSpecificData?.proxyPoolId).toBeUndefined();
	});

	it("rejects assigning an unknown proxy pool", async () => {
		const store = createInMemoryProviderConnectionStore({
			connections: [providerConnection({ id: "conn_1", provider: "claude" })],
		});
		const baseUrl = await start(store);

		const response = await fetch(`${baseUrl}/provider-connections/conn_1`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ proxyPoolId: "missing_pool" }),
		});

		expect(response.status).toBe(400);
	});

	it("tests a proxy pool and stores successful test metadata", async () => {
		const store = createInMemoryProviderConnectionStore({
			proxyPools: [
				{
					id: "proxy_pool_1",
					name: "Local proxy",
					type: "http",
					proxyUrl: "http://127.0.0.1:7890",
					isActive: false,
					testStatus: "error",
					lastError: "previous failure",
					createdAt: "2026-05-22T00:00:00.000Z",
					updatedAt: "2026-05-22T00:00:00.000Z",
				},
			],
		});
		const baseUrl = await start(store, async (proxyPool) => ({
			ok: true,
			status: 200,
			statusText: "OK",
			url: proxyPool.proxyUrl,
			elapsedMs: 12,
		}));

		const response = await fetch(`${baseUrl}/proxy-pools/proxy_pool_1/test`, { method: "POST" });
		const body = (await response.json()) as {
			ok: boolean;
			status: number;
			error: string | null;
			elapsedMs: number;
			testedAt: string;
		};
		const updated = await store.getProxyPoolById("proxy_pool_1");

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			ok: true,
			status: 200,
			error: null,
			elapsedMs: 12,
			testedAt: expect.any(String),
		});
		expect(updated).toMatchObject({
			isActive: true,
			testStatus: "active",
			lastTestedAt: body.testedAt,
			lastError: null,
		});
	});

	it("tests a proxy pool and stores failure metadata", async () => {
		const store = createInMemoryProviderConnectionStore({
			proxyPools: [
				{
					id: "proxy_pool_1",
					name: "Broken proxy",
					type: "http",
					proxyUrl: "http://127.0.0.1:1",
					isActive: true,
					testStatus: "active",
					createdAt: "2026-05-22T00:00:00.000Z",
					updatedAt: "2026-05-22T00:00:00.000Z",
				},
			],
		});
		const baseUrl = await start(store, async () => ({
			ok: false,
			status: 500,
			error: "Proxy test timed out",
			elapsedMs: 8000,
		}));

		const response = await fetch(`${baseUrl}/v1/proxy-pools/proxy_pool_1/test`, { method: "POST" });
		const body = (await response.json()) as {
			ok: boolean;
			status: number;
			error: string | null;
			testedAt: string;
		};
		const updated = await store.getProxyPoolById("proxy_pool_1");

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			ok: false,
			status: 500,
			error: "Proxy test timed out",
			testedAt: expect.any(String),
		});
		expect(updated).toMatchObject({
			isActive: false,
			testStatus: "error",
			lastTestedAt: body.testedAt,
			lastError: "Proxy test timed out",
		});
	});

	it("masks proxy URL credentials in responses and preserves them on masked round-trip", async () => {
		const store = createInMemoryProviderConnectionStore();
		const baseUrl = await start(store);

		const createResponse = await fetch(`${baseUrl}/proxy-pools`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Authed",
				type: "http",
				proxyUrl: "http://user:hunter2@proxy.example:8080/",
			}),
		});
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { proxyPool: { id: string; proxyUrl: string } };
		expect(created.proxyPool.proxyUrl).toBe("http://user:****@proxy.example:8080/");

		const listResponse = await fetch(`${baseUrl}/proxy-pools`);
		const listed = (await listResponse.json()) as { proxyPools: Array<{ proxyUrl: string }> };
		expect(listed.proxyPools[0]?.proxyUrl).toBe("http://user:****@proxy.example:8080/");

		// Editing other fields with the masked URL echoed back must not clobber the credential.
		const updateResponse = await fetch(`${baseUrl}/proxy-pools/${created.proxyPool.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "Authed v2", proxyUrl: "http://user:****@proxy.example:8080/" }),
		});
		expect(updateResponse.status).toBe(200);
		const stored = await store.getProxyPoolById(created.proxyPool.id);
		expect(stored?.proxyUrl).toBe("http://user:hunter2@proxy.example:8080/");
		expect(stored?.name).toBe("Authed v2");

		// Sending a genuinely new URL still updates the credential.
		const replaceResponse = await fetch(`${baseUrl}/proxy-pools/${created.proxyPool.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ proxyUrl: "http://user:newpass@proxy.example:8080/" }),
		});
		expect(replaceResponse.status).toBe(200);
		const replaced = await store.getProxyPoolById(created.proxyPool.id);
		expect(replaced?.proxyUrl).toBe("http://user:newpass@proxy.example:8080/");
	});

	it("returns 404 when testing an unknown proxy pool", async () => {
		const store = createInMemoryProviderConnectionStore();
		const baseUrl = await start(store);

		const response = await fetch(`${baseUrl}/proxy-pools/missing_pool/test`, { method: "POST" });

		expect(response.status).toBe(404);
	});

	it("routes proxy pool test requests through the top-level pie-lab handler", async () => {
		const store = createInMemoryProviderConnectionStore({
			proxyPools: [
				{
					id: "proxy_pool_1",
					name: "Local proxy",
					type: "http",
					proxyUrl: "http://127.0.0.1:7890",
					isActive: false,
					createdAt: "2026-05-22T00:00:00.000Z",
					updatedAt: "2026-05-22T00:00:00.000Z",
				},
			],
		});
		const baseUrl = await startPieLab(store, async () => ({
			ok: true,
			status: 200,
			statusText: "OK",
			elapsedMs: 3,
		}));

		const response = await fetch(`${baseUrl}/proxy-pools/proxy_pool_1/test`, { method: "POST" });
		const updated = await store.getProxyPoolById("proxy_pool_1");

		expect(response.status).toBe(200);
		expect(updated).toMatchObject({
			isActive: true,
			testStatus: "active",
			lastError: null,
		});
	});
});
