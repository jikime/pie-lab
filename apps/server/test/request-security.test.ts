import { createInMemoryProviderConnectionStore, createInMemoryUsageStore } from "@pie-lab/storage";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPieLabRequestHandler, type PieLabServerOptions } from "../src/index.ts";

describe("request security", () => {
	let server: Server | undefined;

	afterEach(async () => {
		delete process.env.PIE_LAB_SERVER_ALLOWED_ORIGINS;
		delete process.env.PIE_LAB_SERVER_ALLOWED_HOSTS;
		if (server) {
			await new Promise<void>((resolve, reject) => {
				server?.close((error) => (error ? reject(error) : resolve()));
			});
			server = undefined;
		}
	});

	async function start(options: PieLabServerOptions = {}): Promise<number> {
		server = createServer(
			createPieLabRequestHandler({
				usageStore: createInMemoryUsageStore(),
				providerConnectionStore: createInMemoryProviderConnectionStore(),
				...options,
			}),
		);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		return (server.address() as AddressInfo).port;
	}

	function send(
		port: number,
		headers: Record<string, string>,
		method = "GET",
	): Promise<{ status: number; body: string }> {
		return new Promise((resolve, reject) => {
			const req = httpRequest(
				{ host: "127.0.0.1", port, path: "/proxy-pools", method, headers, setHost: false },
				(res) => {
					let body = "";
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
				},
			);
			req.on("error", reject);
			req.end();
		});
	}

	it("allows loopback Host headers", async () => {
		const port = await start();
		for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "localhost"]) {
			const result = await send(port, { host });
			expect(result.status, `host: ${host}`).toBe(200);
		}
	});

	it("rejects non-local Host headers (DNS rebinding)", async () => {
		const port = await start();
		const result = await send(port, { host: `attacker.example:${port}` });
		expect(result.status).toBe(403);
		expect(result.body).toContain("Forbidden Host");
	});

	it("rejects requests without a Host header", async () => {
		const port = await start();
		const result = await send(port, {});
		// Node itself rejects host-less HTTP/1.1 requests with 400 before the
		// handler runs; our guard answers 403 if such a request ever gets through.
		expect([400, 403]).toContain(result.status);
	});

	it("allows local browser origins", async () => {
		const port = await start();
		for (const origin of ["http://localhost:3000", "http://127.0.0.1:3100"]) {
			const result = await send(port, { host: `127.0.0.1:${port}`, origin });
			expect(result.status, `origin: ${origin}`).toBe(200);
		}
	});

	it("rejects non-local browser origins", async () => {
		const port = await start();
		for (const method of ["GET", "OPTIONS"]) {
			const result = await send(port, { host: `127.0.0.1:${port}`, origin: "https://attacker.example" }, method);
			expect(result.status, `method: ${method}`).toBe(403);
			expect(result.body).toContain("Forbidden Origin");
		}
	});

	it("accepts extra origins from options and env", async () => {
		process.env.PIE_LAB_SERVER_ALLOWED_ORIGINS = "https://env.example";
		const port = await start({ allowedOrigins: ["https://opt.example"] });
		for (const origin of ["https://opt.example", "https://env.example"]) {
			const result = await send(port, { host: `127.0.0.1:${port}`, origin });
			expect(result.status, `origin: ${origin}`).toBe(200);
		}
	});

	it("accepts extra hosts from options and env", async () => {
		process.env.PIE_LAB_SERVER_ALLOWED_HOSTS = "env-host.example";
		const port = await start({ allowedHosts: ["opt-host.example"] });
		for (const host of ["opt-host.example", "env-host.example"]) {
			const result = await send(port, { host });
			expect(result.status, `host: ${host}`).toBe(200);
		}
	});
});
