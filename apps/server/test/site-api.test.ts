import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPieLabRequestHandler, createSiteRequestHandler } from "../src/index.ts";

describe("site API", () => {
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

	async function start(handler = createSiteRequestHandler({ packageName: "@pie-lab/coding-agent", version: "1.2.3" })): Promise<string> {
		server = createServer(handler);
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		return `http://127.0.0.1:${address.port}`;
	}

	it("serves latest version metadata", async () => {
		const baseUrl = await start();
		const response = await fetch(`${baseUrl}/api/latest-version`);
		const body = (await response.json()) as { packageName: string; version: string };

		expect(response.status).toBe(200);
		expect(body).toEqual({
			packageName: "@pie-lab/coding-agent",
			version: "1.2.3",
		});
	});

	it("accepts install telemetry reports", async () => {
		const baseUrl = await start();
		const response = await fetch(`${baseUrl}/api/report-install?version=1.2.3`);
		const body = (await response.json()) as { ok: boolean; reportedVersion?: string };

		expect(response.status).toBe(200);
		expect(body).toMatchObject({
			ok: true,
			reportedVersion: "1.2.3",
		});
	});

	it("serves install script and session shell through the integrated server", async () => {
		const baseUrl = await start(createPieLabRequestHandler({ packageName: "@pie-lab/coding-agent", version: "1.2.3" }));

		const installResponse = await fetch(`${baseUrl}/install.sh`);
		const installScript = await installResponse.text();
		expect(installResponse.status).toBe(200);
		expect(installScript).toContain("npm install -g '@pie-lab/coding-agent'");

		const sessionResponse = await fetch(`${baseUrl}/session/`);
		const sessionHtml = await sessionResponse.text();
		expect(sessionResponse.status).toBe(200);
		expect(sessionHtml).toContain("pie session viewer");
	});
});
