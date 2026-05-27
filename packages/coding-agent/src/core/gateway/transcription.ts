import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { UsageStore } from "@pie-lab/storage";
import { getAgentDir } from "../../config.js";
import { detectWavDurationSeconds, recordGatewayAudioUsage, type GatewayAudioUsageContext } from "./audio-usage.js";
import { resolveGatewayOpenAiAudioCredentials } from "./audio-credentials.js";

export type GatewayTranscriptionProvider = "local" | "openai" | "custom";

export interface GatewayTranscriptionResult {
	text?: string;
	error?: string;
	skipped?: boolean;
	skippedReason?: string;
	provider?: GatewayTranscriptionProvider;
	model?: string;
	endpoint?: string;
	cached?: boolean;
	cacheKey?: string;
	fileSizeBytes?: number;
	maxSizeBytes?: number;
	audioDurationSeconds?: number;
	durationMs?: number;
}

interface GatewayTranscriptionRequest {
	provider: GatewayTranscriptionProvider;
	endpoint: string;
	model: string;
	language: string;
	prompt: string;
	headers?: Record<string, string>;
}

interface GatewayTranscriptionCacheEntry {
	version: 1;
	text: string;
	provider: GatewayTranscriptionProvider;
	model: string;
	endpoint: string;
	language: string;
	promptHash: string;
	fileHash: string;
	fileSizeBytes: number;
	createdAt: string;
}

function boolDisabled(value: string | undefined): boolean {
	return value === "0" || value?.toLowerCase() === "false" || value?.toLowerCase() === "off";
}

function parseBytes(value: string | undefined, fallback: number): number {
	if (!value?.trim()) return fallback;
	const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/);
	if (!match) return fallback;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount)) return fallback;
	const unit = match[2] ?? "b";
	if (unit === "gb" || unit === "g") return Math.floor(amount * 1024 * 1024 * 1024);
	if (unit === "mb" || unit === "m") return Math.floor(amount * 1024 * 1024);
	if (unit === "kb" || unit === "k") return Math.floor(amount * 1024);
	return Math.floor(amount);
}

function cacheEnabled(env: NodeJS.ProcessEnv): boolean {
	return !boolDisabled(env.PIE_GATEWAY_STT_CACHE);
}

export function getGatewaySttCacheDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PIE_GATEWAY_STT_CACHE_DIR?.trim() || join(getAgentDir(), "gateway", "stt-cache");
}

export function getGatewaySttMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
	return parseBytes(env.PIE_GATEWAY_STT_MAX_BYTES, 25 * 1024 * 1024);
}

function audioContentType(path: string, fallback?: string): string {
	if (fallback?.startsWith("audio/")) return fallback;
	const ext = extname(path).toLowerCase();
	if (ext === ".mp3") return "audio/mpeg";
	if (ext === ".wav") return "audio/wav";
	if (ext === ".ogg" || ext === ".oga") return "audio/ogg";
	if (ext === ".opus") return "audio/opus";
	if (ext === ".m4a" || ext === ".mp4") return "audio/mp4";
	if (ext === ".webm") return "audio/webm";
	return "application/octet-stream";
}

function localTranscriptionEndpoint(env: NodeJS.ProcessEnv): string {
	const base =
		env.PIE_GATEWAY_STT_BASE_URL ||
		env.PIE_LAB_API_BASE_URL ||
		env.PIE_API_BASE_URL ||
		`http://${env.PIE_LAB_SERVER_HOST || env.PIE_ADK_SERVER_HOST || "127.0.0.1"}:${env.PIE_LAB_SERVER_PORT || env.PIE_ADK_SERVER_PORT || "4873"}`;
	return `${base.replace(/\/+$/, "")}/v1/audio/transcriptions`;
}

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function resolveTranscriptionRequest(env: NodeJS.ProcessEnv): Promise<GatewayTranscriptionRequest> {
	const language = env.PIE_GATEWAY_STT_LANGUAGE || "ko";
	const prompt = env.PIE_GATEWAY_STT_PROMPT || "Transcribe this voice message. Return only the spoken text.";
	if (env.PIE_GATEWAY_STT_ENDPOINT) {
		return {
			provider: "custom",
			endpoint: env.PIE_GATEWAY_STT_ENDPOINT,
			model: env.PIE_GATEWAY_STT_MODEL || "auto:stt",
			language,
			prompt,
			headers: env.PIE_GATEWAY_STT_API_KEY ? { authorization: `Bearer ${env.PIE_GATEWAY_STT_API_KEY}` } : undefined,
		};
	}
	const openAiAudio = await resolveGatewayOpenAiAudioCredentials(env);
	if (openAiAudio) {
		return {
			provider: "openai",
			endpoint: "https://api.openai.com/v1/audio/transcriptions",
			model: env.PIE_GATEWAY_STT_MODEL || "whisper-1",
			language,
			prompt,
			headers: { authorization: `Bearer ${openAiAudio.apiKey}` },
		};
	}
	return {
		provider: "local",
		endpoint: localTranscriptionEndpoint(env),
		model: env.PIE_GATEWAY_STT_MODEL || "auto:stt",
		language,
		prompt,
		headers: { "x-pie-client-origin": "pie-gateway:stt" },
	};
}

function cacheKeyFor(request: GatewayTranscriptionRequest, fileHash: string): string {
	return sha256(
		JSON.stringify({
			version: 1,
			provider: request.provider,
			endpoint: request.endpoint,
			model: request.model,
			language: request.language,
			promptHash: sha256(request.prompt),
			fileHash,
		}),
	);
}

async function readCache(cacheDir: string, cacheKey: string): Promise<GatewayTranscriptionCacheEntry | undefined> {
	try {
		const parsed = JSON.parse(await readFile(join(cacheDir, `${cacheKey}.json`), "utf8")) as GatewayTranscriptionCacheEntry;
		return parsed.version === 1 && typeof parsed.text === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

async function writeCache(cacheDir: string, cacheKey: string, entry: GatewayTranscriptionCacheEntry): Promise<void> {
	await mkdir(cacheDir, { recursive: true });
	await writeFile(join(cacheDir, `${cacheKey}.json`), `${JSON.stringify(entry, null, "\t")}\n`, "utf8");
}

function timeoutSignal(timeoutMs: number): AbortSignal {
	const controller = new AbortController();
	setTimeout(() => controller.abort(), timeoutMs).unref?.();
	return controller.signal;
}

async function postTranscriptionForm(options: {
	endpoint: string;
	model: string;
	filePath: string;
	fileData?: Uint8Array;
	mimeType?: string;
	language?: string;
	prompt?: string;
	headers?: Record<string, string>;
	timeoutMs: number;
	fetchImpl: typeof fetch;
	maxRetries?: number;
}): Promise<string> {
	const data = options.fileData ?? (await readFile(options.filePath));
	const maxRetries = options.maxRetries ?? 3;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const form = new FormData();
		form.set("model", options.model);
		form.set("file", new Blob([Buffer.from(data)], { type: audioContentType(options.filePath, options.mimeType) }), basename(options.filePath));
		if (options.language) form.set("language", options.language);
		if (options.prompt) form.set("prompt", options.prompt);
		const response = await options.fetchImpl(options.endpoint, {
			method: "POST",
			headers: options.headers,
			body: form,
			signal: timeoutSignal(options.timeoutMs),
		});

		// Exponential backoff on 429 rate-limit responses.
		if (response.status === 429 && attempt < maxRetries) {
			const retryAfterHeader = response.headers.get("retry-after");
			const retryAfterMs = retryAfterHeader
				? Number(retryAfterHeader) * 1000
				: Math.min(1000 * 2 ** attempt + Math.random() * 500, 30_000);
			await new Promise<void>((resolve) => setTimeout(resolve, retryAfterMs));
			continue;
		}

		const contentType = response.headers.get("content-type") || "";
		const raw = await response.text();
		const shouldParseJson = contentType.includes("application/json") || raw.trim().startsWith("{");
		if (shouldParseJson) {
			const body = JSON.parse(raw || "{}") as { text?: string; error?: { message?: string }; message?: string };
			if (!response.ok) throw new Error(body.error?.message || body.message || `STT failed with HTTP ${response.status}`);
			return body.text?.trim() || "";
		}
		if (!response.ok) throw new Error(raw || `STT failed with HTTP ${response.status}`);
		return raw.trim();
	}

	throw new Error(`STT failed after ${maxRetries} retries (rate limited).`);
}

export async function transcribeGatewayAudio(options: {
	filePath: string;
	mimeType?: string;
	audioDurationSeconds?: number;
	usageStore?: UsageStore;
	usageContext?: GatewayAudioUsageContext;
	env?: NodeJS.ProcessEnv;
	fetchImpl?: typeof fetch;
}): Promise<GatewayTranscriptionResult> {
	const env = options.env ?? process.env;
	if (boolDisabled(env.PIE_GATEWAY_STT)) return { skipped: true };
	const startedAt = Date.now();
	const timeoutMs = Math.max(1000, Number(env.PIE_GATEWAY_STT_TIMEOUT_MS || 20000));
	const fetchImpl = options.fetchImpl ?? fetch;
	const maxSizeBytes = getGatewaySttMaxBytes(env);
	let request: GatewayTranscriptionRequest | undefined;
	let fileSizeBytes: number | undefined;
	let audioDurationSeconds =
		typeof options.audioDurationSeconds === "number" && Number.isFinite(options.audioDurationSeconds) && options.audioDurationSeconds > 0
			? options.audioDurationSeconds
			: undefined;

	try {
		const fileStats = await stat(options.filePath);
		fileSizeBytes = fileStats.size;
		if (maxSizeBytes > 0 && fileSizeBytes > maxSizeBytes) {
			return {
				skipped: true,
				skippedReason: `audio file is too large (${fileSizeBytes} bytes > ${maxSizeBytes} bytes)`,
				fileSizeBytes,
				maxSizeBytes,
				audioDurationSeconds,
				durationMs: Date.now() - startedAt,
			};
		}

		request = await resolveTranscriptionRequest(env);
		const fileData = await readFile(options.filePath);
		audioDurationSeconds ??= detectWavDurationSeconds(fileData);
		const fileHash = sha256(fileData);
		const cacheKey = cacheKeyFor(request, fileHash);
		const cacheDir = getGatewaySttCacheDir(env);
		if (cacheEnabled(env)) {
			const cached = await readCache(cacheDir, cacheKey);
			if (cached) {
				return {
					text: cached.text,
					provider: cached.provider,
					model: cached.model,
					endpoint: cached.endpoint,
					cached: true,
					cacheKey,
					fileSizeBytes,
					maxSizeBytes,
					audioDurationSeconds,
					durationMs: Date.now() - startedAt,
				};
			}
		}

		const text = await postTranscriptionForm({
			endpoint: request.endpoint,
			model: request.model,
			filePath: options.filePath,
			fileData,
			mimeType: options.mimeType,
			language: request.language,
			prompt: request.prompt,
			headers: request.headers,
			timeoutMs,
			fetchImpl,
		});
		await recordGatewayAudioUsage({
			usageStore: options.usageStore,
			context: options.usageContext,
			kind: "stt",
			provider: request.provider,
			model: request.model,
			providerEndpoint: request.endpoint,
			status: "success",
			inputBytes: fileSizeBytes,
			audioSeconds: audioDurationSeconds,
		});
		if (cacheEnabled(env) && text) {
			await writeCache(cacheDir, cacheKey, {
				version: 1,
				text,
				provider: request.provider,
				model: request.model,
				endpoint: request.endpoint,
				language: request.language,
				promptHash: sha256(request.prompt),
				fileHash,
				fileSizeBytes,
				createdAt: new Date().toISOString(),
			}).catch(() => undefined);
		}
		return {
			text,
			provider: request.provider,
			model: request.model,
			endpoint: request.endpoint,
			cached: false,
			cacheKey,
			fileSizeBytes,
			maxSizeBytes,
			audioDurationSeconds,
			durationMs: Date.now() - startedAt,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (request) {
			await recordGatewayAudioUsage({
				usageStore: options.usageStore,
				context: options.usageContext,
				kind: "stt",
				provider: request.provider,
				model: request.model,
				providerEndpoint: request.endpoint,
				status: "error",
				errorMessage,
				inputBytes: fileSizeBytes,
				audioSeconds: audioDurationSeconds,
			});
		}
		return { error: errorMessage, fileSizeBytes, maxSizeBytes, audioDurationSeconds, durationMs: Date.now() - startedAt };
	}
}
