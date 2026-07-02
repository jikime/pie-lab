import { beforeEach, describe, expect, it, vi } from "vitest";
import { stream as streamClaudeAgentSdk } from "../src/api/claude-agent-sdk.ts";
import type { Context, Model } from "../src/types.ts";

type InterruptMode = "throw" | "reject";

const sdkMock = vi.hoisted(() => ({
	interruptMode: "throw" as InterruptMode,
	queryCalled: Promise.resolve(),
	resolveQueryCalled: () => {},
}));

function resetQueryCalled(): void {
	sdkMock.queryCalled = new Promise<void>((resolve) => {
		sdkMock.resolveQueryCalled = resolve;
	});
}

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(({ options }: { options: { abortController: AbortController } }) => {
		sdkMock.resolveQueryCalled();
		return {
			close: vi.fn(),
			interrupt: vi.fn(() => {
				if (sdkMock.interruptMode === "reject") {
					return Promise.reject(new Error("Operation aborted"));
				}
				throw new Error("Operation aborted");
			}),
			async *[Symbol.asyncIterator]() {
				if (!options.abortController.signal.aborted) {
					await new Promise<void>((resolve) => {
						options.abortController.signal.addEventListener("abort", () => resolve(), { once: true });
					});
				}
				throw new Error("Operation aborted");
			},
		};
	}),
}));

const model: Model<"claude-agent-sdk"> = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	api: "claude-agent-sdk",
	provider: "claude-code-adk",
	baseUrl: "claude-code://local",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 32_000,
};

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
};

describe("Claude Agent SDK abort handling", () => {
	beforeEach(() => {
		resetQueryCalled();
		sdkMock.interruptMode = "throw";
	});

	it("treats synchronous interrupt failures as normal abort cleanup", async () => {
		const controller = new AbortController();
		const response = streamClaudeAgentSdk(model, context, {
			signal: controller.signal,
			pathToClaudeCodeExecutable: "/bin/echo",
		});

		await sdkMock.queryCalled;
		expect(() => controller.abort()).not.toThrow();

		const result = await response.result();
		expect(result.stopReason).toBe("aborted");
		expect(result.errorMessage).toBe("Operation aborted");
	});

	it("handles rejected interrupt promises without an unhandled rejection", async () => {
		sdkMock.interruptMode = "reject";
		const unhandledRejections: unknown[] = [];
		const recordUnhandledRejection = (error: unknown) => unhandledRejections.push(error);
		process.on("unhandledRejection", recordUnhandledRejection);
		const controller = new AbortController();
		try {
			const response = streamClaudeAgentSdk(model, context, {
				signal: controller.signal,
				pathToClaudeCodeExecutable: "/bin/echo",
			});

			await sdkMock.queryCalled;
			expect(() => controller.abort()).not.toThrow();

			const result = await response.result();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(result.stopReason).toBe("aborted");
			expect(result.errorMessage).toBe("Operation aborted");
			expect(unhandledRejections).toEqual([]);
		} finally {
			process.off("unhandledRejection", recordUnhandledRejection);
		}
	});
});
