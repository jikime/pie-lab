import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageStore } from "@pie-lab/storage";
import { getAgentDir } from "../../config.ts";
import { resolveGatewayOpenAiAudioCredentials } from "./audio-credentials.ts";
import {
	detectWavDurationSeconds,
	type GatewayAudioUsageContext,
	recordGatewayAudioUsage,
	textLengthForAudioUsage,
} from "./audio-usage.ts";

export type GatewaySpeechProvider = "local" | "openai" | "custom";

export interface GatewaySpeechResult {
	path?: string;
	error?: string;
	skipped?: boolean;
	skippedReason?: string;
	provider?: GatewaySpeechProvider;
	model?: string;
	voice?: string;
	endpoint?: string;
	format?: string;
	fileSizeBytes?: number;
	maxChars?: number;
	audioDurationSeconds?: number;
	durationMs?: number;
}

interface GatewaySpeechRequest {
	provider: GatewaySpeechProvider;
	endpoint: string;
	model: string;
	voice: string;
	format: string;
	headers?: Record<string, string>;
	useJsonResponse: boolean;
}

function boolDisabled(value: string | undefined): boolean {
	return value === "0" || value?.toLowerCase() === "false" || value?.toLowerCase() === "off";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export function getGatewayTtsOutputDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PIE_GATEWAY_TTS_DIR?.trim() || join(getAgentDir(), "gateway", "tts");
}

export function getGatewayTtsMaxChars(env: NodeJS.ProcessEnv = process.env): number {
	return parsePositiveInt(env.PIE_GATEWAY_TTS_MAX_CHARS, 2000);
}

function localSpeechEndpoint(env: NodeJS.ProcessEnv): string {
	const base =
		env.PIE_GATEWAY_TTS_BASE_URL ||
		env.PIE_LAB_API_BASE_URL ||
		env.PIE_API_BASE_URL ||
		`http://${env.PIE_LAB_SERVER_HOST || env.PIE_ADK_SERVER_HOST || "127.0.0.1"}:${env.PIE_LAB_SERVER_PORT || env.PIE_ADK_SERVER_PORT || "4873"}`;
	return `${base.replace(/\/+$/, "")}/v1/audio/speech?response_format=json`;
}

async function resolveSpeechRequest(
	env: NodeJS.ProcessEnv,
	overrides: { model?: string; voice?: string; format?: string } = {},
): Promise<GatewaySpeechRequest> {
	const model = overrides.model || env.PIE_GATEWAY_TTS_MODEL || "auto:tts";
	const voice = overrides.voice || env.PIE_GATEWAY_TTS_VOICE || "alloy";
	const format = overrides.format || env.PIE_GATEWAY_TTS_FORMAT || "mp3";
	if (env.PIE_GATEWAY_TTS_ENDPOINT) {
		return {
			provider: "custom",
			endpoint: env.PIE_GATEWAY_TTS_ENDPOINT,
			model,
			voice,
			format,
			headers: {
				"content-type": "application/json",
				...(env.PIE_GATEWAY_TTS_API_KEY ? { authorization: `Bearer ${env.PIE_GATEWAY_TTS_API_KEY}` } : {}),
			},
			useJsonResponse: false,
		};
	}
	const openAiAudio = await resolveGatewayOpenAiAudioCredentials(env);
	if (openAiAudio) {
		return {
			provider: "openai",
			endpoint: "https://api.openai.com/v1/audio/speech",
			model: overrides.model || env.PIE_GATEWAY_TTS_MODEL || "tts-1",
			voice,
			format,
			headers: { "content-type": "application/json", authorization: `Bearer ${openAiAudio.apiKey}` },
			useJsonResponse: false,
		};
	}
	return {
		provider: "local",
		endpoint: localSpeechEndpoint(env),
		model,
		voice,
		format,
		headers: { "content-type": "application/json", "x-pie-client-origin": "pie-gateway:tts" },
		useJsonResponse: true,
	};
}

function timeoutSignal(timeoutMs: number): AbortSignal {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), timeoutMs).unref?.();
	return controller.signal;
}

function extensionForFormat(format: string | undefined, contentType: string | undefined): string {
	const normalized = `${format || ""} ${contentType || ""}`.toLowerCase();
	if (normalized.includes("wav")) return "wav";
	if (normalized.includes("ogg")) return "ogg";
	if (normalized.includes("opus")) return "opus";
	if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
	if (normalized.includes("aac")) return "aac";
	return "mp3";
}

async function readSpeechResponse(
	response: Response,
	fallbackFormat: string,
): Promise<{ data: Uint8Array; format: string }> {
	const contentType = response.headers.get("content-type") || "";
	const raw = new Uint8Array(await response.arrayBuffer());
	const maybeText = Buffer.from(raw).toString("utf8");
	const shouldParseJson = contentType.includes("application/json") || maybeText.trim().startsWith("{");
	if (shouldParseJson) {
		const body = JSON.parse(maybeText || "{}") as {
			audio?: string;
			data?: string;
			b64_json?: string;
			format?: string;
			error?: { message?: string };
			message?: string;
		};
		if (!response.ok)
			throw new Error(body.error?.message || body.message || `TTS failed with HTTP ${response.status}`);
		const audio = body.audio || body.data || body.b64_json;
		if (!audio) throw new Error("TTS response did not include base64 audio.");
		return { data: new Uint8Array(Buffer.from(audio, "base64")), format: body.format || fallbackFormat };
	}
	if (!response.ok) throw new Error(maybeText || `TTS failed with HTTP ${response.status}`);
	return { data: raw, format: extensionForFormat(fallbackFormat, contentType) };
}

export async function synthesizeGatewaySpeech(options: {
	text: string;
	model?: string;
	voice?: string;
	format?: string;
	usageStore?: UsageStore;
	usageContext?: GatewayAudioUsageContext;
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
}): Promise<GatewaySpeechResult> {
	const env = options.env ?? process.env;
	if (boolDisabled(env.PIE_GATEWAY_TTS)) return { skipped: true };
	const startedAt = Date.now();
	const timeoutMs = Math.max(1000, Number(env.PIE_GATEWAY_TTS_TIMEOUT_MS || 30000));
	const fetchImpl = options.fetchImpl ?? fetch;
	const maxChars = getGatewayTtsMaxChars(env);
	const text = options.text.trim();
	if (!text) return { skipped: true, skippedReason: "text is empty", maxChars, durationMs: Date.now() - startedAt };
	if (maxChars > 0 && text.length > maxChars) {
		return {
			skipped: true,
			skippedReason: `text is too long (${text.length} chars > ${maxChars} chars)`,
			maxChars,
			durationMs: Date.now() - startedAt,
		};
	}
	let request: GatewaySpeechRequest | undefined;

	try {
		request = await resolveSpeechRequest(env, { model: options.model, voice: options.voice, format: options.format });
		const response = await fetchImpl(request.endpoint, {
			method: "POST",
			headers: request.headers,
			body: JSON.stringify({
				model: request.model,
				input: text,
				voice: request.voice,
				response_format: request.useJsonResponse ? undefined : request.format,
			}),
			signal: timeoutSignal(timeoutMs),
		});
		const audio = await readSpeechResponse(response, request.format);
		const audioDurationSeconds = detectWavDurationSeconds(audio.data);
		const outputDir = getGatewayTtsOutputDir(env);
		const extension = extensionForFormat(audio.format, response.headers.get("content-type") || undefined);
		await mkdir(outputDir, { recursive: true });
		const path = join(outputDir, `speech-${Date.now()}-${randomUUID()}.${extension}`);
		await writeFile(path, audio.data);
		await recordGatewayAudioUsage({
			usageStore: options.usageStore,
			context: options.usageContext,
			kind: "tts",
			provider: request.provider,
			model: request.model,
			providerEndpoint: request.endpoint,
			status: "success",
			inputChars: textLengthForAudioUsage(text),
			outputBytes: audio.data.byteLength,
			audioSeconds: audioDurationSeconds,
		});
		return {
			path,
			provider: request.provider,
			model: request.model,
			voice: request.voice,
			endpoint: request.endpoint,
			format: audio.format,
			fileSizeBytes: audio.data.byteLength,
			maxChars,
			audioDurationSeconds,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (request) {
			await recordGatewayAudioUsage({
				usageStore: options.usageStore,
				context: options.usageContext,
				kind: "tts",
				provider: request.provider,
				model: request.model,
				providerEndpoint: request.endpoint,
				status: "error",
				errorMessage,
				inputChars: textLengthForAudioUsage(text),
			});
		}
		return { error: errorMessage, maxChars, durationMs: Date.now() - startedAt };
	}
}
