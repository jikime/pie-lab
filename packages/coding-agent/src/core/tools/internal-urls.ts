/**
 * Internal URL resolver for pie-lab resources
 * Supports: pr://, issue://, agent://, skill://, rule://, conflict://
 */

import { getGitHubClient } from "./github-api.ts";

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
 */
export async function resolveInternalURL(url: InternalURL): Promise<string | null> {
	switch (url.scheme) {
		case "pr":
			return await resolvePR(url);

		case "issue":
			return await resolveIssue(url);

		case "agent":
			return resolveAgent(url);

		case "skill":
			return resolveSkill(url);

		case "rule":
			return resolveRule(url);

		case "conflict":
			return resolveConflict(url);

		default:
			return null;
	}
}

/**
 * Resolve GitHub PR
 */
async function resolvePR(url: InternalURL): Promise<string | null> {
	if (!url.owner || !url.repo) return null;

	try {
		const client = getGitHubClient();
		const pr = await client.getPR(url.owner, url.repo, url.id);

		if (!pr) {
			return `[GitHub PR: ${url.owner}/${url.repo}#${url.id}]\n\nPull request not found.`;
		}

		return `[GitHub PR: ${url.owner}/${url.repo}#${url.id}]\n\n**${pr.title}**\n\nState: ${pr.state}\nAuthor: ${pr.author}\nCreated: ${pr.createdAt}\n\n${pr.body}\n\nURL: ${pr.url}`;
	} catch (error) {
		return `[GitHub PR: ${url.owner}/${url.repo}#${url.id}]\n\nError fetching PR: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Resolve GitHub Issue
 */
async function resolveIssue(url: InternalURL): Promise<string | null> {
	if (!url.owner || !url.repo) return null;

	try {
		const client = getGitHubClient();
		const issue = await client.getIssue(url.owner, url.repo, url.id);

		if (!issue) {
			return `[GitHub Issue: ${url.owner}/${url.repo}#${url.id}]\n\nIssue not found.`;
		}

		const labels = issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}\n` : "";

		return `[GitHub Issue: ${url.owner}/${url.repo}#${url.id}]\n\n**${issue.title}**\n\nState: ${issue.state}\nAuthor: ${issue.author}\n${labels}Created: ${issue.createdAt}\n\n${issue.body}\n\nURL: ${issue.url}`;
	} catch (error) {
		return `[GitHub Issue: ${url.owner}/${url.repo}#${url.id}]\n\nError fetching issue: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Resolve Agent resource
 */
function resolveAgent(url: InternalURL): string {
	return `[Agent: ${url.id}]\n\nAgent resource\nPath: ${url.path || "(root)"}\n\nImplementation: Use pie session API to load agent state.`;
}

/**
 * Resolve Skill resource
 */
function resolveSkill(url: InternalURL): string {
	return `[Skill: ${url.id}]\n\nSkill resource\nPath: ${url.path || "(root)"}\n\nImplementation: Load from ~/.pie/agent/skills/${url.id}`;
}

/**
 * Resolve Rule resource
 */
function resolveRule(url: InternalURL): string {
	return `[Rule: ${url.id}]\n\nRule resource\nPath: ${url.path || "(root)"}\n\nImplementation: Load from ~/.pie/agent/rules/${url.id}`;
}

/**
 * Resolve Conflict resource
 */
function resolveConflict(url: InternalURL): string {
	return `[Conflict: ${url.id}]\n\nConflict resolution record\nPath: ${url.path || "(root)"}\n\nImplementation: Retrieve conflict metadata and resolution history.`;
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
