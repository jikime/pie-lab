/**
 * GitHub API client for internal-urls resolver
 */

type HeadersInit = Record<string, string>;

interface GitHubUserResponse {
	login?: unknown;
}

interface GitHubLabelResponse {
	name?: unknown;
}

interface GitHubPullResponse {
	number?: unknown;
	title?: unknown;
	state?: unknown;
	body?: unknown;
	user?: GitHubUserResponse | null;
	created_at?: unknown;
	updated_at?: unknown;
	html_url?: unknown;
}

interface GitHubIssueResponse extends GitHubPullResponse {
	labels?: unknown;
}

export interface GitHubPRInfo {
	number: number;
	title: string;
	state: "open" | "closed";
	body: string;
	author: string;
	createdAt: string;
	updatedAt: string;
	url: string;
}

export interface GitHubIssueInfo {
	number: number;
	title: string;
	state: "open" | "closed";
	body: string;
	author: string;
	createdAt: string;
	updatedAt: string;
	url: string;
	labels: string[];
}

export class GitHubClient {
	private token?: string;
	private baseUrl = "https://api.github.com";

	constructor(token?: string) {
		this.token = token || process.env.GITHUB_TOKEN;
	}

	private async fetch<T>(endpoint: string): Promise<T | null> {
		try {
			const url = `${this.baseUrl}${endpoint}`;
			const headers: HeadersInit = {
				Accept: "application/vnd.github.v3+json",
			};

			if (this.token) {
				headers.Authorization = `token ${this.token}`;
			}

			const response = await fetch(url, { headers });

			if (response.status === 404) {
				return null; // Not found
			}

			if (!response.ok) {
				console.warn(`GitHub API error: ${response.status} ${response.statusText}`);
				return null;
			}

			return (await response.json()) as T;
		} catch (error) {
			console.warn(`GitHub API fetch error: ${error}`);
			return null;
		}
	}

	async getPR(owner: string, repo: string, prNumber: string): Promise<GitHubPRInfo | null> {
		const data = await this.fetch<GitHubPullResponse>(`/repos/${owner}/${repo}/pulls/${prNumber}`);

		if (!data) return null;

		return {
			number: typeof data.number === "number" ? data.number : Number(prNumber),
			title: typeof data.title === "string" ? data.title : "",
			state: data.state === "closed" ? "closed" : "open",
			body: typeof data.body === "string" ? data.body : "",
			author: typeof data.user?.login === "string" ? data.user.login : "unknown",
			createdAt: typeof data.created_at === "string" ? data.created_at : "",
			updatedAt: typeof data.updated_at === "string" ? data.updated_at : "",
			url: typeof data.html_url === "string" ? data.html_url : "",
		};
	}

	async getIssue(owner: string, repo: string, issueNumber: string): Promise<GitHubIssueInfo | null> {
		const data = await this.fetch<GitHubIssueResponse>(`/repos/${owner}/${repo}/issues/${issueNumber}`);

		if (!data) return null;

		const labels = Array.isArray(data.labels)
			? data.labels
					.map((label): string | undefined => {
						if (typeof label === "string") return label;
						const typedLabel = label as GitHubLabelResponse;
						return typeof typedLabel.name === "string" ? typedLabel.name : undefined;
					})
					.filter((label): label is string => Boolean(label) && label !== "pull_request")
			: [];

		return {
			number: typeof data.number === "number" ? data.number : Number(issueNumber),
			title: typeof data.title === "string" ? data.title : "",
			state: data.state === "closed" ? "closed" : "open",
			body: typeof data.body === "string" ? data.body : "",
			author: typeof data.user?.login === "string" ? data.user.login : "unknown",
			createdAt: typeof data.created_at === "string" ? data.created_at : "",
			updatedAt: typeof data.updated_at === "string" ? data.updated_at : "",
			url: typeof data.html_url === "string" ? data.html_url : "",
			labels,
		};
	}
}

// Global client instance
let globalClient: GitHubClient;

export function getGitHubClient(token?: string): GitHubClient {
	if (!globalClient) {
		globalClient = new GitHubClient(token);
	}
	return globalClient;
}
