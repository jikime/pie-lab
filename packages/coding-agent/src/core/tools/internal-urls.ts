/**
 * Internal URL resolver for pie-lab resources
 * Supports: pr://, issue://, agent://, skill://, rule://, conflict://
 */

export interface InternalURL {
	scheme: "pr" | "issue" | "agent" | "skill" | "rule" | "conflict";
	owner?: string;
	repo?: string;
	id: string;
	path?: string;
}

/**
 * Parse internal URL string
 * Examples:
 * - pr://owner/repo/123
 * - issue://owner/repo/456
 * - agent://agent-name
 * - skill://skill-name
 * - rule://rule-id
 * - conflict://conflict-id
 */
export function parseInternalURL(url: string): InternalURL | null {
	const match = url.match(/^([a-z]+):\/\/(.+)$/);
	if (!match) return null;

	const [, scheme, path] = match;
	const parts = path.split("/");

	switch (scheme) {
		case "pr":
		case "issue": {
			if (parts.length < 3) return null;
			const [owner, repo, id] = parts;
			return { scheme: scheme as "pr" | "issue", owner, repo, id };
		}

		case "agent":
		case "skill":
		case "rule":
		case "conflict": {
			const [id, ...rest] = parts;
			return {
				scheme: scheme as "agent" | "skill" | "rule" | "conflict",
				id,
				path: rest.length > 0 ? rest.join("/") : undefined,
			};
		}

		default:
			return null;
	}
}

/**
 * Check if a path looks like an internal URL
 */
export function isInternalURL(path: string): boolean {
	return /^[a-z]+:\/\//.test(path);
}

/**
 * Resolve internal URL to content
 * Currently returns stub/placeholder data
 * Full GitHub API integration will be added later
 */
export async function resolveInternalURL(url: InternalURL): Promise<string | null> {
	switch (url.scheme) {
		case "pr":
			return `[GitHub PR: ${url.owner}/${url.repo}#${url.id}]\n\nPull Request content placeholder.\nImplementation pending GitHub API integration.`;

		case "issue":
			return `[GitHub Issue: ${url.owner}/${url.repo}#${url.id}]\n\nIssue content placeholder.\nImplementation pending GitHub API integration.`;

		case "agent":
			return `[Agent: ${url.id}]\n\nAgent resource placeholder.\nPath: ${url.path || "(root)"}\nImplementation pending.`;

		case "skill":
			return `[Skill: ${url.id}]\n\nSkill resource placeholder.\nPath: ${url.path || "(root)"}\nImplementation pending.`;

		case "rule":
			return `[Rule: ${url.id}]\n\nRule resource placeholder.\nPath: ${url.path || "(root)"}\nImplementation pending.`;

		case "conflict":
			return `[Conflict: ${url.id}]\n\nConflict resolution record placeholder.\nImplementation pending.`;

		default:
			return null;
	}
}

/**
 * Format internal URL from components
 */
export function formatInternalURL(url: InternalURL): string {
	switch (url.scheme) {
		case "pr":
		case "issue":
			return `${url.scheme}://${url.owner}/${url.repo}/${url.id}`;

		case "agent":
		case "skill":
		case "rule":
		case "conflict":
			return url.path ? `${url.scheme}://${url.id}/${url.path}` : `${url.scheme}://${url.id}`;

		default:
			return "";
	}
}
