import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@pie-lab/ai";
import { afterEach, describe, expect, it } from "vitest";
import {
	createAgentSessionFromServices,
	createAgentSessionServices,
	getDefaultAgentUsageFilePath,
} from "../src/core/agent-session-services.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function tempDir(name: string): string {
	const dir = join(tmpdir(), `pie-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("agent session services usage store", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
	});

	it("uses the agent directory usage file by default", () => {
		expect(getDefaultAgentUsageFilePath("/tmp/pie-agent", {} as NodeJS.ProcessEnv)).toBe(
			"/tmp/pie-agent/usage.jsonl",
		);
		expect(
			getDefaultAgentUsageFilePath("/tmp/pie-agent", {
				PIE_LAB_USAGE_PATH: " /tmp/custom-usage.jsonl ",
			} as NodeJS.ProcessEnv),
		).toBe("/tmp/custom-usage.jsonl");
	});

	it("records routed CLI session usage through services.usageStore", async () => {
		const root = tempDir("session-services-usage");
		const cwd = join(root, "project");
		const agentDir = join(root, "agent");
		mkdirSync(cwd, { recursive: true });
		mkdirSync(agentDir, { recursive: true });

		const faux = registerFauxProvider({
			models: [{ id: "usage-model", reasoning: false }],
		});
		faux.setResponses([fauxAssistantMessage("tracked usage")]);
		cleanups.push(() => {
			faux.unregister();
			if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		});

		const model = faux.getModel();
		const authStorage = AuthStorage.inMemory();
		authStorage.setRuntimeApiKey(model.provider, "faux-key");

		const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
		modelRegistry.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			apiKey: "faux-key",
			api: faux.api,
			models: faux.models.map((registeredModel) => ({
				id: registeredModel.id,
				name: registeredModel.name,
				api: registeredModel.api,
				reasoning: registeredModel.reasoning,
				input: registeredModel.input,
				cost: registeredModel.cost,
				contextWindow: registeredModel.contextWindow,
				maxTokens: registeredModel.maxTokens,
				baseUrl: registeredModel.baseUrl,
			})),
		});

		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			authStorage,
			modelRegistry,
			resourceLoaderOptions: {
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
			},
		});
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(cwd),
			model,
			noTools: "all",
		});

		const stream = await session.agent.streamFn(model, { messages: [] });
		const result = await stream.result();

		expect(result.stopReason).toBe("stop");
		const records = readFileSync(join(agentDir, "usage.jsonl"), "utf-8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line));
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			requestedModel: `${model.provider}/${model.id}`,
			routingMode: "fallback",
			routeSource: "fallback",
			resolvedProvider: model.provider,
			resolvedModel: model.id,
			status: "success",
		});
	});
});
