import { visibleWidth } from "@pie-lab/tui";
import { beforeAll, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../src/core/footer-data-provider.ts";
import { FooterComponent, formatCwdForFooter } from "../src/modes/interactive/components/footer.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type AssistantUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
};

function createSession(options: {
	sessionName: string;
	modelId?: string;
	provider?: string;
	assistantModel?: string;
	assistantProvider?: string;
	reasoning?: boolean;
	thinkingLevel?: string;
	usage?: AssistantUsage;
}): AgentSession {
	const usage = options.usage;
	const entries =
		usage === undefined
			? []
			: [
					{
						type: "message",
						message: {
							role: "assistant",
							provider: options.assistantProvider ?? options.provider ?? "test",
							model: options.assistantModel ?? options.modelId ?? "test-model",
							usage,
						},
					},
				];

	const session = {
		state: {
			model: {
				id: options.modelId ?? "test-model",
				provider: options.provider ?? "test",
				contextWindow: 200_000,
				reasoning: options.reasoning ?? false,
			},
			thinkingLevel: options.thinkingLevel ?? "off",
		},
		sessionManager: {
			getEntries: () => entries,
			getSessionName: () => options.sessionName,
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 200_000, percent: 12.3 }),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};

	return session as unknown as AgentSession;
}

function createFooterData(
	providerCount: number,
	extensionStatuses = new Map<string, string>(),
): ReadonlyFooterDataProvider {
	const provider = {
		getGitBranch: () => "main",
		getExtensionStatuses: () => extensionStatuses,
		getAvailableProviderCount: () => providerCount,
		onBranchChange: (callback: () => void) => {
			void callback;
			return () => {};
		},
	};

	return provider;
}

describe("formatCwdForFooter", () => {
	it("does not abbreviate sibling paths that share the home prefix", () => {
		expect(formatCwdForFooter("/home/user2", "/home/user")).toBe("/home/user2");
	});

	it("abbreviates the home directory and descendants", () => {
		expect(formatCwdForFooter("/home/user", "/home/user")).toBe("~");
		expect(formatCwdForFooter("/home/user/project", "/home/user")).toBe("~/project");
	});
});

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("FooterComponent width handling", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("keeps all lines within width for wide session names", () => {
		const width = 93;
		const session = createSession({ sessionName: "한글".repeat(30) });
		const footer = new FooterComponent(session, createFooterData(1));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("keeps stats line within width for wide model and provider names", () => {
		const width = 60;
		const session = createSession({
			sessionName: "",
			modelId: "模".repeat(30),
			provider: "공급자",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 1.234 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width);
		for (const line of lines) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("renders readable labels for path, usage, context, and model fields", () => {
		const session = createSession({
			sessionName: "work",
			modelId: "claude-sonnet-4-6",
			provider: "claude-code-adk",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 1234,
				cacheWrite: 567,
				cost: { total: 0.123 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(150).map(stripAnsi);

		expect(lines[0]).toContain("dir /tmp/project");
		expect(lines[0]).toContain("git main");
		expect(lines[0]).toContain("session work");
		expect(lines[1]).toContain("tok");
		expect(lines[1]).toContain("cache");
		expect(lines[1]).toContain("cost $0.123");
		expect(lines[1]).toContain("ctx 12.3%/200k auto");
		expect(lines[1]).toContain("model claude-code-adk/claude-sonnet-4-6");
		expect(lines[1]).toContain("think high");
	});

	it("keeps the selected model visible before lower-priority usage fields", () => {
		const width = 64;
		const session = createSession({
			sessionName: "work",
			modelId: "claude-sonnet-4-6",
			provider: "claude-code-adk",
			reasoning: true,
			thinkingLevel: "high",
			usage: {
				input: 999_999,
				output: 888_888,
				cacheRead: 777_777,
				cacheWrite: 666_666,
				cost: { total: 123.456 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(width).map(stripAnsi);

		expect(lines[1]).toContain("model claude-code-adk/claude-sonnet-4-6");
		for (const line of footer.render(width)) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});

	it("shows the last resolved routed model for router aliases", () => {
		const session = createSession({
			sessionName: "work",
			modelId: "auto:coding",
			provider: "pie-lab-router",
			assistantProvider: "google",
			assistantModel: "gemini-2.5-pro",
			usage: {
				input: 12_345,
				output: 6_789,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { total: 0.123 },
			},
		});
		const footer = new FooterComponent(session, createFooterData(2));

		const lines = footer.render(150).map(stripAnsi);

		expect(lines[1]).toContain("route auto:coding -> google/gemini-2.5-pro");
	});

	it("hides quiet extension statuses while keeping actionable statuses", () => {
		const session = createSession({
			sessionName: "work",
			modelId: "claude-sonnet-4-6",
			provider: "claude-code-adk",
		});
		const footer = new FooterComponent(
			session,
			createFooterData(
				2,
				new Map([
					["chat", "chat \x1b[38;2;108;108;108mdisconnected\x1b[39m"],
					["codegraph", "CodeGraph ready"],
					["index", "index warning: stale cache"],
				]),
			),
		);

		const lines = footer.render(150).map(stripAnsi);

		expect(lines.join("\n")).not.toContain("chat disconnected");
		expect(lines.join("\n")).not.toContain("CodeGraph ready");
		expect(lines[2]).toContain("index warning: stale cache");
	});
});
