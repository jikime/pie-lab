import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// This app manages its own dependencies with pnpm inside the npm monorepo,
	// so pin the workspace root here instead of letting Next.js infer it from
	// the repo-root package-lock.json.
	turbopack: {
		root: fileURLToPath(new URL(".", import.meta.url)),
	},
};

export default nextConfig;
