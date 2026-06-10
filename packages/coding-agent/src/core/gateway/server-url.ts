/** Resolve the local pie-lab server origin from env (PIE_LAB_* with PIE_ADK_* legacy fallback). */
export function getPieLabServerOrigin(env: NodeJS.ProcessEnv = process.env): string {
	const host = env.PIE_LAB_SERVER_HOST || env.PIE_ADK_SERVER_HOST || "127.0.0.1";
	const port = env.PIE_LAB_SERVER_PORT || env.PIE_ADK_SERVER_PORT || "4873";
	return `http://${host}:${port}`;
}
