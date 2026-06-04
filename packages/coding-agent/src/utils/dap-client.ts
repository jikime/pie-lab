import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

interface ExecFileFailure {
	code?: unknown;
	stdout?: unknown;
	stderr?: unknown;
	message?: unknown;
}

export interface DebugResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export class DapClient {
	private cwd: string;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	async launch(scriptPath: string, args?: string[]): Promise<DebugResult> {
		try {
			const { stdout, stderr } = (await execFile("node", [scriptPath, ...(args ?? [])], {
				cwd: this.cwd,
				encoding: "utf-8",
				timeout: 30000,
				maxBuffer: 10 * 1024 * 1024,
			})) as { stdout: string; stderr: string };

			return {
				exitCode: 0,
				stdout,
				stderr,
			};
		} catch (error) {
			const failure = error as ExecFileFailure;
			return {
				exitCode: typeof failure.code === "number" ? failure.code : 1,
				stdout: typeof failure.stdout === "string" ? failure.stdout : "",
				stderr:
					typeof failure.stderr === "string"
						? failure.stderr
						: typeof failure.message === "string"
							? failure.message
							: String(error),
			};
		}
	}

	async launchWithInspector(scriptPath: string, args?: string[]): Promise<DebugResult> {
		try {
			const { stdout, stderr } = (await execFile("node", ["--inspect", scriptPath, ...(args ?? [])], {
				cwd: this.cwd,
				encoding: "utf-8",
				timeout: 30000,
				maxBuffer: 10 * 1024 * 1024,
			})) as { stdout: string; stderr: string };

			return {
				exitCode: 0,
				stdout,
				stderr,
			};
		} catch (error) {
			const failure = error as ExecFileFailure;
			return {
				exitCode: typeof failure.code === "number" ? failure.code : 1,
				stdout: typeof failure.stdout === "string" ? failure.stdout : "",
				stderr:
					typeof failure.stderr === "string"
						? failure.stderr
						: typeof failure.message === "string"
							? failure.message
							: String(error),
			};
		}
	}

	async disconnect(): Promise<void> {
		// No persistent process to disconnect
	}
}

let globalClient: DapClient | null = null;

export function getOrCreateDapClient(cwd: string): DapClient {
	if (!globalClient) {
		globalClient = new DapClient(cwd);
	}
	return globalClient;
}

export async function closeDapClient(): Promise<void> {
	if (globalClient) {
		await globalClient.disconnect();
		globalClient = null;
	}
}
