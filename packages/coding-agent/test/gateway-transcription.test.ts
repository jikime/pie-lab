import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { transcribeGatewayAudio } from "../src/core/gateway/transcription.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pie-gateway-stt-"));
}

function tempAudio(data = "audio"): string {
	const dir = mkdtempSync(join(tmpdir(), "pie-gateway-stt-"));
	const path = join(dir, "voice.ogg");
	writeFileSync(path, Buffer.from(data));
	return path;
}

describe("gateway transcription", () => {
	it("can be disabled explicitly", async () => {
		const result = await transcribeGatewayAudio({
			filePath: tempAudio(),
			env: { PIE_GATEWAY_STT: "0" } as NodeJS.ProcessEnv,
			fetchImpl: vi.fn() as unknown as typeof fetch,
		});

		expect(result.skipped).toBe(true);
	});

	it("posts audio to a custom STT endpoint", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "안녕하세요" }), { status: 200 }));

		const result = await transcribeGatewayAudio({
			filePath: tempAudio(),
			env: {
				PIE_GATEWAY_STT_ENDPOINT: "http://127.0.0.1:4873/v1/audio/transcriptions",
				PIE_GATEWAY_STT_MODEL: "auto:stt",
				PIE_GATEWAY_STT_CACHE_DIR: tempDir(),
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.text).toBe("안녕하세요");
		expect(result.provider).toBe("custom");
		expect(result.cached).toBe(false);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:4873/v1/audio/transcriptions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("prefers VOICE_TOOLS_OPENAI_KEY over OPENAI_API_KEY for OpenAI STT", async () => {
		const fetchMock = vi.fn(async (_url, init) => {
			expect(init?.headers).toMatchObject({ authorization: "Bearer voice-tools-key" });
			return new Response(JSON.stringify({ text: "음성 전용 키" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const result = await transcribeGatewayAudio({
			filePath: tempAudio(),
			env: {
				VOICE_TOOLS_OPENAI_KEY: "voice-tools-key",
				OPENAI_API_KEY: "general-openai-key",
				PIE_GATEWAY_STT_CACHE_DIR: tempDir(),
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.text).toBe("음성 전용 키");
		expect(result.provider).toBe("openai");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.openai.com/v1/audio/transcriptions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("reuses cached transcripts for the same audio and STT settings", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "캐시된 전사" }), { status: 200 }));
		const env = {
			PIE_GATEWAY_STT_ENDPOINT: "http://127.0.0.1:4873/v1/audio/transcriptions",
			PIE_GATEWAY_STT_MODEL: "auto:stt",
			PIE_GATEWAY_STT_CACHE_DIR: tempDir(),
		} as NodeJS.ProcessEnv;
		const filePath = tempAudio("same-audio");

		const first = await transcribeGatewayAudio({ filePath, env, fetchImpl: fetchMock as unknown as typeof fetch });
		const second = await transcribeGatewayAudio({ filePath, env, fetchImpl: fetchMock as unknown as typeof fetch });

		expect(first.text).toBe("캐시된 전사");
		expect(first.cached).toBe(false);
		expect(second.text).toBe("캐시된 전사");
		expect(second.cached).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("skips transcription when audio exceeds the configured size limit", async () => {
		const fetchMock = vi.fn();
		const result = await transcribeGatewayAudio({
			filePath: tempAudio("too-large"),
			env: {
				PIE_GATEWAY_STT_ENDPOINT: "http://127.0.0.1:4873/v1/audio/transcriptions",
				PIE_GATEWAY_STT_MAX_BYTES: "4",
				PIE_GATEWAY_STT_CACHE_DIR: tempDir(),
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toMatch(/too large/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
