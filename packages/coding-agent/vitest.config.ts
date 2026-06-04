import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const aiSrcIndex = fileURLToPath(new URL("../ai/src/index.ts", import.meta.url));
const aiSrcOAuth = fileURLToPath(new URL("../ai/src/oauth.ts", import.meta.url));
const agentSrcIndex = fileURLToPath(new URL("../agent/src/index.ts", import.meta.url));
const hashlineSrcIndex = fileURLToPath(new URL("../hashline/src/index.ts", import.meta.url));
const routerSrcIndex = fileURLToPath(new URL("../router/src/index.ts", import.meta.url));
const storageSrcIndex = fileURLToPath(new URL("../storage/src/index.ts", import.meta.url));
const tuiSrcIndex = fileURLToPath(new URL("../tui/src/index.ts", import.meta.url));

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		testTimeout: 30000,
		server: {
			deps: {
				external: [/@silvia-odwyer\/photon-node/],
			},
		},
	},
	resolve: {
		alias: [
			{ find: /^@pie-lab\/ai$/, replacement: aiSrcIndex },
			{ find: /^@pie-lab\/ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@pie-lab\/agent-core$/, replacement: agentSrcIndex },
			{ find: /^@pie-lab\/hashline$/, replacement: hashlineSrcIndex },
			{ find: /^@pie-lab\/tui$/, replacement: tuiSrcIndex },
			{ find: /^@pie-lab\/router$/, replacement: routerSrcIndex },
			{ find: /^@pie-lab\/storage$/, replacement: storageSrcIndex },
			{ find: /^@mariozechner\/pi-ai$/, replacement: aiSrcIndex },
			{ find: /^@mariozechner\/pi-ai\/oauth$/, replacement: aiSrcOAuth },
			{ find: /^@mariozechner\/pi-agent-core$/, replacement: agentSrcIndex },
			{ find: /^@mariozechner\/pi-tui$/, replacement: tuiSrcIndex },
		],
	},
});
