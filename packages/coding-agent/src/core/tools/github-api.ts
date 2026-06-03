/**
 * GitHub API client for internal-urls resolver
 */

type HeadersInit = Record<string, string>;

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
		const data = await this.fetch<any>(`/repos/${owner}/${repo}/pulls/${prNumber}`);

		if (!data) return null;

		return {
			number: data.number,
			title: data.title,
			state: data.state,
			body: data.body || "",
			author: data.user?.login || "unknown",
			createdAt: data.created_at,
			updatedAt: data.updated_at,
			url: data.html_url,
		};
	}

	async getIssue(owner: string, repo: string, issueNumber: string): Promise<GitHubIssueInfo | null> {
		const data = await this.fetch<any>(`/repos/${owner}/${repo}/issues/${issueNumber}`);

		if (!data) return null;

		// Filter out PR label
		const labels = (data.labels || []).map((l: any) => l.name).filter((l: string) => l !== "pull_request");

		return {
			number: data.number,
			title: data.title,
			state: data.state,
			body: data.body || "",
			author: data.user?.login || "unknown",
			createdAt: data.created_at,
			updatedAt: data.updated_at,
			url: data.html_url,
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
