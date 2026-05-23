import { createInMemoryProviderConnectionStore, type ProviderConnection } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createModelAvailabilityRequestHandler, createModelAvailabilityResponse } from "../src/index.js";

describe("model availability API", () => {
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

	it("summarizes active model locks without exposing credentials", () => {
		const now = new Date();
		const lockUntil = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
		const expiredLock = new Date(now.getTime() - 60 * 1000).toISOString();
		const response = createModelAvailabilityResponse(
			[
				providerConnection({
					id: "openai_conn_1",
					provider: "openai",
					apiKey: "secret-key",
					accessToken: "secret-token",
					lastError: "quota exceeded",
					errorCode: 429,
					"modelLock_gpt-5.4": lockUntil,
					"modelLock_old-model": expiredLock,
				}),
				providerConnection({
					id: "anthropic_conn_1",
					provider: "anthropic",
					apiKey: "secret-anthropic-key",
				}),
			],
			now,
		);

		expect(response.count).toBe(2);
		expect(response.lockedConnectionCount).toBe(1);
		expect(response.lockedModelCount).toBe(1);
		expect(response.lockedModels[0]).toMatchObject({
			provider: "openai",
			model: "gpt-5.4",
			scope: "model",
			activeConnectionCount: 1,
			connectionIds: ["openai_conn_1"],
		});
		expect(response.data[0]?.locks).toHaveLength(1);
		expect(response.data[0]?.locks[0]).toMatchObject({
			key: "modelLock_gpt-5.4",
			model: "gpt-5.4",
			scope: "model",
			until: lockUntil,
		});
		expect(JSON.stringify(response)).not.toContain("secret-key");
		expect(JSON.stringify(response)).not.toContain("secret-token");
	});

	it("returns model availability over HTTP", async () => {
		const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "codex_conn_1",
					provider: "codex",
					authType: "oauth",
					accessToken: "secret-token",
					"modelLock_gpt-5.4": lockUntil,
				}),
			],
		});
		server = createServer(createModelAvailabilityRequestHandler({ providerConnectionStore: store }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		const response = await fetch(`http://127.0.0.1:${address.port}/v1/models/availability`);
		const body = (await response.json()) as {
			count: number;
			lockedConnectionCount: number;
			data: Array<{ id: string; locks: Array<{ model: string; until: string }> }>;
		};

		expect(response.status).toBe(200);
		expect(body.count).toBe(1);
		expect(body.lockedConnectionCount).toBe(1);
		expect(body.data[0]).toMatchObject({
			id: "codex_conn_1",
			locks: [expect.objectContaining({ model: "gpt-5.4", until: lockUntil })],
		});
		expect(JSON.stringify(body)).not.toContain("secret-token");
	});

	it("clears cooldowns with the 9router clearCooldown action", async () => {
		const lockUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString();
		const store = createInMemoryProviderConnectionStore({
			connections: [
				providerConnection({
					id: "codex_conn_1",
					provider: "codex",
					authType: "oauth",
					accessToken: "secret-token-1",
					testStatus: "unavailable",
					lastError: "quota exceeded",
					lastErrorAt: "2026-05-22T00:01:00.000Z",
					backoffLevel: 2,
					"modelLock_gpt-5.4": lockUntil,
				}),
				providerConnection({
					id: "codex_conn_2",
					provider: "codex",
					authType: "oauth",
					accessToken: "secret-token-2",
					"modelLock_gpt-5.4": lockUntil,
				}),
				providerConnection({
					id: "openai_conn_1",
					provider: "openai",
					"modelLock_gpt-5.4": lockUntil,
				}),
			],
		});
		server = createServer(createModelAvailabilityRequestHandler({ providerConnectionStore: store }));
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));

		const address = server.address() as AddressInfo;
		const response = await fetch(`http://127.0.0.1:${address.port}/models/availability`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ action: "clearCooldown", provider: "codex", model: "gpt-5.4" }),
		});
		const body = (await response.json()) as {
			ok: true;
			clearedCount: number;
			lockKey: string;
		};

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			ok: true,
			clearedCount: 2,
			lockKey: "modelLock_gpt-5.4",
		});

		const codexConnection = await store.getProviderConnectionById("codex_conn_1");
		const secondCodexConnection = await store.getProviderConnectionById("codex_conn_2");
		const openAiConnection = await store.getProviderConnectionById("openai_conn_1");

		expect(codexConnection?.["modelLock_gpt-5.4"]).toBeNull();
		expect(codexConnection?.testStatus).toBe("active");
		expect(codexConnection?.lastError).toBeNull();
		expect(codexConnection?.lastErrorAt).toBeNull();
		expect(codexConnection?.backoffLevel).toBe(0);
		expect(secondCodexConnection?.["modelLock_gpt-5.4"]).toBeNull();
		expect(openAiConnection?.["modelLock_gpt-5.4"]).toBe(lockUntil);
		expect(JSON.stringify(body)).not.toContain("secret-token");
	});
});

function providerConnection(overrides: Partial<ProviderConnection> & { id: string; provider: string }): ProviderConnection {
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
