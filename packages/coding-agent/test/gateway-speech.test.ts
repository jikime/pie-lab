import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { synthesizeGatewaySpeech } from "../src/core/gateway/speech.ts";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pie-gateway-tts-"));
}

describe("gateway speech synthesis", () => {
	it("can be disabled explicitly", async () => {
		const result = await synthesizeGatewaySpeech({
			text: "안녕하세요",
			env: { PIE_GATEWAY_TTS: "0" } as NodeJS.ProcessEnv,
			fetchImpl: vi.fn() as unknown as typeof fetch,
		});

		expect(result.skipped).toBe(true);
	});

	it("skips synthesis when text exceeds the configured size limit", async () => {
		const fetchMock = vi.fn();
		const result = await synthesizeGatewaySpeech({
			text: "too long",
			env: {
				PIE_GATEWAY_TTS_ENDPOINT: "http://127.0.0.1:4873/v1/audio/speech",
				PIE_GATEWAY_TTS_MAX_CHARS: "4",
				PIE_GATEWAY_TTS_DIR: tempDir(),
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.skipped).toBe(true);
		expect(result.skippedReason).toMatch(/too long/i);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("posts text to a custom TTS endpoint and stores returned base64 audio", async () => {
		const audio = Buffer.from("audio-bytes");
		const outputDir = tempDir();
		const fetchMock = vi.fn(async (_url, init) => {
			const body = JSON.parse(String(init?.body));
			expect(body).toMatchObject({
				model: "auto:tts",
				input: "읽어줘",
				voice: "Kore",
				response_format: "mp3",
			});
			return new Response(JSON.stringify({ audio: audio.toString("base64"), format: "mp3" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const result = await synthesizeGatewaySpeech({
			text: "읽어줘",
			env: {
				PIE_GATEWAY_TTS_ENDPOINT: "http://127.0.0.1:4873/v1/audio/speech",
				PIE_GATEWAY_TTS_MODEL: "auto:tts",
				PIE_GATEWAY_TTS_VOICE: "Kore",
				PIE_GATEWAY_TTS_DIR: outputDir,
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.path).toBeTruthy();
		expect(result.provider).toBe("custom");
		expect(basename(result.path || "")).toMatch(/\.mp3$/);
		expect(readFileSync(result.path || "")).toEqual(audio);
		expect(fetchMock).toHaveBeenCalledWith(
			"http://127.0.0.1:4873/v1/audio/speech",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("prefers VOICE_TOOLS_OPENAI_KEY over OPENAI_API_KEY for OpenAI TTS", async () => {
		const audio = Buffer.from("openai-audio");
		const outputDir = tempDir();
		const fetchMock = vi.fn(async (_url, init) => {
			expect(init?.headers).toMatchObject({
				"content-type": "application/json",
				authorization: "Bearer voice-tools-key",
			});
			const body = JSON.parse(String(init?.body));
			expect(body).toMatchObject({
				model: "tts-1",
				input: "음성으로 답해줘",
				voice: "alloy",
				response_format: "mp3",
			});
			return new Response(audio, { status: 200, headers: { "content-type": "audio/mpeg" } });
		});

		const result = await synthesizeGatewaySpeech({
			text: "음성으로 답해줘",
			env: {
				VOICE_TOOLS_OPENAI_KEY: "voice-tools-key",
				OPENAI_API_KEY: "general-openai-key",
				PIE_GATEWAY_TTS_DIR: outputDir,
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.path).toBeTruthy();
		expect(result.provider).toBe("openai");
		expect(readFileSync(result.path || "")).toEqual(audio);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.openai.com/v1/audio/speech",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("stores raw audio bytes returned by a TTS endpoint", async () => {
		const audio = Buffer.from("raw-audio");
		const outputDir = tempDir();
		const fetchMock = vi.fn(async () => new Response(audio, { status: 200, headers: { "content-type": "audio/wav" } }));

		const result = await synthesizeGatewaySpeech({
			text: "hello",
			env: {
				PIE_GATEWAY_TTS_ENDPOINT: "http://127.0.0.1:4873/v1/audio/speech",
				PIE_GATEWAY_TTS_FORMAT: "wav",
				PIE_GATEWAY_TTS_DIR: outputDir,
			} as NodeJS.ProcessEnv,
			fetchImpl: fetchMock as unknown as typeof fetch,
		});

		expect(result.path).toBeTruthy();
		expect(result.format).toBe("wav");
		expect(result.path).toMatch(/\.wav$/);
		expect(existsSync(result.path || "")).toBe(true);
		expect(readFileSync(result.path || "")).toEqual(audio);
	});
});
