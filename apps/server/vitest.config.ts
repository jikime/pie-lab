import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@pie-lab/ai/oauth": fileURLToPath(new URL("../../packages/ai/src/oauth.ts", import.meta.url)),
			"@pie-lab/ai": fileURLToPath(new URL("../../packages/ai/src/index.ts", import.meta.url)),
			"@pie-lab/coding-agent/auth-storage": fileURLToPath(
				new URL("../../packages/coding-agent/src/core/auth-storage.ts", import.meta.url),
			),
			"@pie-lab/coding-agent/config": fileURLToPath(
				new URL("../../packages/coding-agent/src/config.ts", import.meta.url),
			),
			"@pie-lab/coding-agent/model-registry": fileURLToPath(
				new URL("../../packages/coding-agent/src/core/model-registry.ts", import.meta.url),
			),
			"@pie-lab/router": fileURLToPath(new URL("../../packages/router/src/index.ts", import.meta.url)),
			"@pie-lab/storage": fileURLToPath(new URL("../../packages/storage/src/index.ts", import.meta.url)),
		},
	},
	test: {
		environment: "node",
	},
});
