#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_PORTS = [4873, 4876, 4877];
const WAIT_MS = 500;

function parsePorts() {
	const raw = process.argv.slice(2).join(",") || process.env.PIE_DEV_PORTS || DEFAULT_PORTS.join(",");
	const ports = raw
		.split(",")
		.map((value) => Number.parseInt(value.trim(), 10))
		.filter((value) => Number.isInteger(value) && value > 0 && value < 65536);
	return [...new Set(ports)];
}

function run(command, args) {
	const result = spawnSync(command, args, { encoding: "utf8" });
	if (result.error || result.status !== 0) return "";
	return result.stdout;
}

function pidsFromLsof(port) {
	const output = run("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"]);
	return output
		.split(/\s+/)
		.map((value) => Number.parseInt(value, 10))
		.filter((value) => Number.isInteger(value) && value > 0);
}

function pidsFromNetstat(port) {
	if (process.platform !== "win32") return [];
	const output = run("netstat", ["-ano", "-p", "tcp"]);
	const pids = [];
	for (const line of output.split(/\r?\n/)) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 5 || parts[0].toUpperCase() !== "TCP") continue;
		const [localAddress, , state, pid] = parts.slice(1);
		if (state.toUpperCase() !== "LISTENING") continue;
		if (!localAddress.endsWith(`:${port}`)) continue;
		const parsed = Number.parseInt(pid, 10);
		if (Number.isInteger(parsed) && parsed > 0) pids.push(parsed);
	}
	return pids;
}

function pidsForPort(port) {
	const pids = process.platform === "win32" ? pidsFromNetstat(port) : pidsFromLsof(port);
	return [...new Set(pids)].filter((pid) => pid !== process.pid);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPid(pid, signal) {
	if (process.platform === "win32") {
		execFileSync("taskkill", ["/PID", String(pid), "/T", signal === "SIGKILL" ? "/F" : ""].filter(Boolean), {
			stdio: "ignore",
		});
		return;
	}
	process.kill(pid, signal);
}

async function main() {
	if (/^(1|true|yes)$/i.test(process.env.PIE_DEV_SKIP_PORT_CLEANUP ?? "")) {
		console.log("[dev] Skipping port cleanup because PIE_DEV_SKIP_PORT_CLEANUP is set.");
		return;
	}

	const ports = parsePorts();
	if (ports.length === 0) return;

	const killed = [];
	for (const port of ports) {
		const pids = pidsForPort(port);
		if (pids.length === 0) continue;
		for (const pid of pids) {
			try {
				killPid(pid, "SIGTERM");
				killed.push(`${pid}:${port}`);
			} catch {
				// The process may already have exited between lsof/netstat and kill.
			}
		}
	}

	if (killed.length === 0) {
		console.log(`[dev] Ports are free: ${ports.join(", ")}`);
		return;
	}

	console.log(`[dev] Stopped existing processes on ports: ${killed.join(", ")}`);
	await sleep(WAIT_MS);

	const stillListening = [];
	for (const port of ports) {
		for (const pid of pidsForPort(port)) {
			try {
				killPid(pid, "SIGKILL");
				stillListening.push(`${pid}:${port}`);
			} catch {
				// Ignore already-exited processes.
			}
		}
	}

	if (stillListening.length > 0) {
		console.log(`[dev] Force-stopped remaining listeners: ${stillListening.join(", ")}`);
	}
}

await main();
