import { describe, expect, it } from "vitest";
import { compressMessages, compressPayloadWithRtk, formatRtkLog, type RtkHit, type RtkStats } from "../src/rtk.ts";

// Inputs must clear the 500-byte minimum and actually shrink to register a hit.

function gitDiffText(): string {
	const lines = [
		"diff --git a/src/alpha.ts b/src/alpha.ts",
		"index 1111111..2222222 100644",
		"--- a/src/alpha.ts",
		"+++ b/src/alpha.ts",
		"@@ -1,40 +1,41 @@",
	];
	for (let i = 0; i < 40; i++) {
		lines.push(` const unchanged_${i} = "context line that the compact filter drops entirely ${i}";`);
	}
	lines.push('+const added = "one new line";');
	lines.push('-const removed = "one old line";');
	return lines.join("\n");
}

function searchListText(): string {
	const lines: string[] = [];
	for (let i = 0; i < 60; i++) {
		lines.push(`src/services/router.ts:${i + 1}:12: const route = resolveRoute(model, policy, catalog);`);
	}
	return lines.join("\n");
}

function fileListingText(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `./packages/router/src/deep/nested/dir-${i}/file-${i}.ts`).join("\n");
}

function gitStatusText(): string {
	const lines = ["On branch main", "Changes not staged for commit:"];
	for (let i = 0; i < 30; i++) {
		lines.push(` M packages/router/src/some/long/path/to/file-${i}.ts`);
	}
	for (let i = 0; i < 10; i++) {
		lines.push(`?? packages/router/untracked/new-file-${i}.ts`);
	}
	return lines.join("\n");
}

function toolMessageBody(text: string): { messages: Array<Record<string, unknown>> } {
	return { messages: [{ role: "tool", content: text }] };
}

function singleHit(stats: RtkStats | null): RtkHit {
	expect(stats).not.toBeNull();
	expect(stats!.hits).toHaveLength(1);
	return stats!.hits[0];
}

describe("rtk payload cloning", () => {
	it("compresses a clone and leaves the original payload untouched", () => {
		const original = toolMessageBody(gitDiffText());
		const before = JSON.stringify(original);

		const result = compressPayloadWithRtk(original);

		expect(JSON.stringify(original)).toBe(before);
		const compressed = (result.payload as typeof original).messages[0].content as string;
		expect(compressed).toContain("[rtk git diff]");
		expect(result.stats?.hits.length).toBe(1);
		expect(result.logLine).toMatch(/^\[RTK\] saved \d+B/);
	});

	it("returns stats null and the payload as-is when disabled", () => {
		const original = toolMessageBody(gitDiffText());
		const result = compressPayloadWithRtk(original, false);
		expect(result.stats).toBeNull();
		expect(result.logLine).toBeNull();
		expect((result.payload as typeof original).messages[0].content).toBe(original.messages[0].content);
	});

	it("passes non-object and class-instance payloads through by reference", () => {
		expect(compressPayloadWithRtk("plain string").payload).toBe("plain string");
		const date = new Date();
		expect((compressPayloadWithRtk({ messages: [], when: date }).payload as { when: Date }).when).toBe(date);
	});
});

describe("rtk compression gates", () => {
	it("leaves text under the 500-byte minimum unchanged", () => {
		const small = "diff --git a/a b/a\n+x\n-y";
		const body = toolMessageBody(small);
		const stats = compressMessages(body);
		expect(body.messages[0].content).toBe(small);
		expect(stats?.hits).toEqual([]);
		expect(stats?.bytesBefore).toBe(small.length);
		expect(stats?.bytesAfter).toBe(small.length);
	});

	it("leaves text with no detectable shape unchanged", () => {
		const prose = `${"This is ordinary prose without any tool-output structure. ".repeat(20)}`;
		const body = toolMessageBody(prose);
		compressMessages(body);
		expect(body.messages[0].content).toBe(prose);
	});

	it("keeps the original when the filter output would not be smaller", () => {
		// Listing-shaped but short enough that smartTruncate returns it unchanged.
		const listing = fileListingText(20);
		expect(listing.length).toBeGreaterThan(500);
		const body = toolMessageBody(listing);
		const stats = compressMessages(body);
		expect(body.messages[0].content).toBe(listing);
		expect(stats?.hits).toEqual([]);
	});

	it("returns null for bodies without messages or input arrays", () => {
		expect(compressMessages({ foo: "bar" })).toBeNull();
		expect(compressMessages(null)).toBeNull();
		expect(compressMessages("text")).toBeNull();
	});
});

describe("rtk filters", () => {
	it("compacts git diffs with file list, counts, and change preview", () => {
		const body = toolMessageBody(gitDiffText());
		const stats = compressMessages(body);
		const output = body.messages[0].content as string;

		expect(singleHit(stats).filter).toBe("gitDiff");
		expect(output).toContain("[rtk git diff] files=1 hunks=1 +1 -1");
		expect(output).toContain("- src/alpha.ts");
		expect(output).toContain('+const added = "one new line";');
		expect(output).not.toContain("context line that the compact filter drops");
		expect(stats!.bytesAfter).toBeLessThan(stats!.bytesBefore);
	});

	it("compacts porcelain git status grouped by status code", () => {
		const body = toolMessageBody(gitStatusText());
		const stats = compressMessages(body);
		const output = body.messages[0].content as string;

		expect(singleHit(stats).filter).toBe("gitStatus");
		expect(output).toMatch(/^M: /m);
		expect(output).toMatch(/^\?\?: /m);
		expect(output).toContain("file-0.ts");
	});

	it("compacts search results grouped by file with match counts", () => {
		const body = toolMessageBody(searchListText());
		const stats = compressMessages(body);
		const output = body.messages[0].content as string;

		expect(singleHit(stats).filter).toBe("searchList");
		expect(output).toContain("[rtk search results] matches=60 files=1");
		expect(output).toContain("src/services/router.ts (60)");
	});

	it("smart-truncates long listings keeping head and tail", () => {
		const body = toolMessageBody(fileListingText(300));
		const stats = compressMessages(body);
		const output = body.messages[0].content as string;

		expect(singleHit(stats).filter).toBe("smartTruncate");
		expect(output).toContain("file-0.ts");
		expect(output).toContain("file-299.ts");
		expect(output).toContain("[rtk truncated 180 middle lines]");
		expect(output).not.toContain("file-150.ts");
	});
});

describe("rtk message shapes", () => {
	const diff = gitDiffText();

	it("compresses openai tool messages with text-part arrays", () => {
		const body = { messages: [{ role: "tool", content: [{ type: "text", text: diff }] }] };
		const stats = compressMessages(body);
		expect(singleHit(stats).shape).toBe("openai-tool-array");
		expect((body.messages[0].content[0] as { text: string }).text).toContain("[rtk git diff]");
	});

	it("compresses openai-responses function_call_output in string and array form", () => {
		const body = {
			input: [
				{ type: "function_call_output", output: diff },
				{ type: "function_call_output", output: [{ type: "input_text", text: diff }] },
			],
		};
		const stats = compressMessages(body);
		expect(stats?.hits.map((hit) => hit.shape)).toEqual(["openai-responses-string", "openai-responses-array"]);
	});

	it("compresses claude tool_result blocks but skips is_error results", () => {
		const body = {
			messages: [
				{
					role: "user",
					content: [
						{ type: "tool_result", content: diff },
						{ type: "tool_result", content: [{ type: "text", text: diff }] },
						{ type: "tool_result", is_error: true, content: diff },
					],
				},
			],
		};
		const stats = compressMessages(body);
		expect(stats?.hits.map((hit) => hit.shape)).toEqual(["claude-string", "claude-array"]);
		const blocks = body.messages[0].content as Array<Record<string, unknown>>;
		expect(blocks[2].content).toBe(diff);
	});

	it("compresses kiro conversationState tool results but skips error results", () => {
		const toolResult = (text: string, status?: string) => ({
			...(status ? { status } : {}),
			content: [{ text }],
		});
		const wrap = (results: unknown[]) => ({
			userInputMessage: { userInputMessageContext: { toolResults: results } },
		});
		const body = {
			conversationState: {
				history: [wrap([toolResult(diff)])],
				currentMessage: wrap([toolResult(diff, "error"), toolResult(diff)]),
			},
		};
		const stats = compressMessages(body);
		expect(stats?.hits).toHaveLength(2);
		expect(stats?.hits.every((hit) => hit.shape === "kiro-tool-result")).toBe(true);
		const current = body.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults;
		expect((current[0] as { content: Array<{ text: string }> }).content[0].text).toBe(diff);
		expect((current[1] as { content: Array<{ text: string }> }).content[0].text).toContain("[rtk git diff]");
	});
});

describe("rtk log formatting", () => {
	it("returns null when nothing was compressed", () => {
		expect(formatRtkLog(null)).toBeNull();
		expect(formatRtkLog({ bytesBefore: 100, bytesAfter: 100, hits: [] })).toBeNull();
	});

	it("summarizes saved bytes, percentage, and distinct filters", () => {
		const log = formatRtkLog({
			bytesBefore: 1000,
			bytesAfter: 400,
			hits: [
				{ shape: "openai-tool", filter: "gitDiff", saved: 500 },
				{ shape: "claude-string", filter: "gitDiff", saved: 100 },
			],
		});
		expect(log).toBe("[RTK] saved 600B / 1000B (60.0%) via [gitDiff] hits=2");
	});
});
