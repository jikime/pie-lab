import { getGitHubClient } from "./github-api.ts";

export type InternalURLScheme = "pr" | "issue" | "agent" | "skill" | "rule" | "conflict";

export interface InternalURL {
	scheme: InternalURLScheme;
	owner?: string;
	repo?: string;
	id: string;
	path?: string;
}

export interface InternalURLResolveContext {
	conflictHistory?: {
		render(id: string): string | null;
	};
}

export interface InternalURLHandler {
	scheme: InternalURLScheme;
	resolve(url: InternalURL, context: InternalURLResolveContext): Promise<string | null> | string | null;
}

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
			if (!owner || !repo || !id) return null;
			return { scheme, owner, repo, id };
		}

		case "agent":
		case "skill":
		case "rule":
		case "conflict": {
			const [id, ...rest] = parts;
			if (!id) return null;
			return {
				scheme,
				id,
				path: rest.length > 0 ? rest.join("/") : undefined,
			};
		}

		default:
			return null;
	}
}

export function isInternalURL(path: string): boolean {
	return /^[a-z]+:\/\//.test(path);
}

export class InternalURLRouter {
	readonly #handlers = new Map<InternalURLScheme, InternalURLHandler>();

	constructor(handlers: InternalURLHandler[] = []) {
		for (const handler of handlers) {
			this.register(handler);
		}
	}

	register(handler: InternalURLHandler): void {
		this.#handlers.set(handler.scheme, handler);
	}

	supports(scheme: InternalURLScheme): boolean {
		return this.#handlers.has(scheme);
	}

	async resolve(url: InternalURL, context: InternalURLResolveContext = {}): Promise<string | null> {
		return (await this.#handlers.get(url.scheme)?.resolve(url, context)) ?? null;
	}
}

export function createDefaultInternalURLRouter(): InternalURLRouter {
	return new InternalURLRouter([
		{ scheme: "pr", resolve: resolvePR },
		{ scheme: "issue", resolve: resolveIssue },
		{ scheme: "agent", resolve: resolveAgent },
		{ scheme: "skill", resolve: resolveSkill },
		{ scheme: "rule", resolve: resolveRule },
		{ scheme: "conflict", resolve: resolveConflict },
	]);
}

const defaultInternalURLRouter = createDefaultInternalURLRouter();

export async function resolveInternalURL(
	url: InternalURL,
	context: InternalURLResolveContext = {},
	router: InternalURLRouter = defaultInternalURLRouter,
): Promise<string | null> {
	return await router.resolve(url, context);
}

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

function resolveAgent(url: InternalURL): string {
	return `[Agent: ${url.id}]\n\nAgent resource\nPath: ${url.path || "(root)"}\n\nImplementation: Use pie session API to load agent state.`;
}

function resolveSkill(url: InternalURL): string {
	return `[Skill: ${url.id}]\n\nSkill resource\nPath: ${url.path || "(root)"}\n\nImplementation: Load from ~/.pie/agent/skills/${url.id}`;
}

function resolveRule(url: InternalURL): string {
	return `[Rule: ${url.id}]\n\nRule resource\nPath: ${url.path || "(root)"}\n\nImplementation: Load from ~/.pie/agent/rules/${url.id}`;
}

function resolveConflict(url: InternalURL, context: InternalURLResolveContext): string | null {
	const rendered = context.conflictHistory?.render(url.id);
	if (rendered !== undefined) {
		return rendered;
	}
	return `[Conflict: ${url.id}]\n\nConflict resolution record\nPath: ${url.path || "(root)"}\n\nImplementation: Retrieve conflict metadata and resolution history.`;
}

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
