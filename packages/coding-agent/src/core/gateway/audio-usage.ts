import {
	createUsageRecordId,
	type UsageCost,
	type UsageMedia,
	type UsageRecord,
	type UsageRecordStatus,
	type UsageStore,
	type UsageTokens,
} from "@pie-lab/storage";

export interface GatewayAudioUsageContext {
	requestId?: string;
	clientOrigin?: string;
	endpoint?: string;
	agentRunId?: string;
	now?: () => Date;
}

export interface GatewayAudioUsageInput {
	usageStore?: UsageStore;
	context?: GatewayAudioUsageContext;
	kind: "stt" | "tts";
	provider: string;
	model: string;
	providerEndpoint: string;
	status: UsageRecordStatus;
	errorMessage?: string;
	errorCode?: string | number;
	inputBytes?: number;
	outputBytes?: number;
	inputChars?: number;
	audioSeconds?: number;
}

const OPENAI_AUDIO_PRICING_VERSION = "openai-pricing-2026-05-27";

const OPENAI_STT_USD_PER_MINUTE: Record<string, number> = {
	"whisper-1": 0.006,
	"gpt-4o-transcribe": 0.006,
	"gpt-4o-transcribe-diarize": 0.006,
	"gpt-4o-mini-transcribe": 0.003,
};

const OPENAI_TTS_USD_PER_MILLION_INPUT_TOKENS: Record<string, number> = {
	"tts-1": 15,
	"tts-1-hd": 30,
	"gpt-4o-mini-tts": 0.6,
};

const OPENAI_TTS_USD_PER_MINUTE: Record<string, number> = {
	"gpt-4o-mini-tts": 0.015,
};

function positiveNumber(value: number | undefined): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function countTextChars(value: string): number {
	return Array.from(value).length;
}

function estimateTextTokens(inputChars: number | undefined): number | undefined {
	const chars = positiveNumber(inputChars);
	return chars === undefined ? undefined : Math.max(1, Math.ceil(chars / 4));
}

function roundCost(value: number): number {
	return Number(value.toFixed(12));
}

function mediaEndpoint(kind: GatewayAudioUsageInput["kind"]): string {
	return kind === "stt" ? "/v1/audio/transcriptions" : "/v1/audio/speech";
}

function cost(total: number, pricingSource: UsageCost["pricingSource"] = "estimated"): UsageCost {
	return {
		input: total,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total,
		currency: "USD",
		pricingSource,
	};
}

function estimateOpenAiAudioUsage(input: GatewayAudioUsageInput): {
	usage?: UsageTokens;
	cost?: UsageCost;
	media: UsageMedia;
} {
	const model = input.model;
	const media: UsageMedia = {
		kind: input.kind,
		inputBytes: positiveNumber(input.inputBytes),
		outputBytes: positiveNumber(input.outputBytes),
		inputChars: positiveNumber(input.inputChars),
		audioSeconds: positiveNumber(input.audioSeconds),
		cached: false,
		estimated: true,
		pricingVersion: OPENAI_AUDIO_PRICING_VERSION,
	};

	if (input.kind === "stt") {
		const seconds = positiveNumber(input.audioSeconds);
		const rate = OPENAI_STT_USD_PER_MINUTE[model];
		media.billingUnit = "audio-minute";
		media.billableSeconds = seconds;
		if (seconds !== undefined && rate !== undefined) {
			return {
				media,
				cost: cost(roundCost((seconds / 60) * rate)),
			};
		}
		return { media };
	}

	const perMinuteRate = OPENAI_TTS_USD_PER_MINUTE[model];
	const seconds = positiveNumber(input.audioSeconds);
	if (seconds !== undefined && perMinuteRate !== undefined) {
		media.billingUnit = "audio-minute";
		media.billableSeconds = seconds;
		return {
			media,
			cost: cost(roundCost((seconds / 60) * perMinuteRate)),
		};
	}

	const tokens = estimateTextTokens(input.inputChars);
	const perMillionTokenRate = OPENAI_TTS_USD_PER_MILLION_INPUT_TOKENS[model];
	media.billingUnit = "input-token";
	media.billableTokens = tokens;
	if (tokens !== undefined) {
		const usage: UsageTokens = {
			input: tokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: tokens,
			estimated: true,
		};
		return {
			media,
			usage,
			cost: perMillionTokenRate === undefined ? undefined : cost(roundCost((tokens / 1_000_000) * perMillionTokenRate)),
		};
	}

	return { media };
}

export function createGatewayAudioUsageRecord(input: GatewayAudioUsageInput): UsageRecord | undefined {
	if (input.provider !== "openai") return undefined;
	const now = input.context?.now?.() ?? new Date();
	const estimated = estimateOpenAiAudioUsage(input);
	const requestId = input.context?.requestId ?? createUsageRecordId("audio_request");
	return {
		id: createUsageRecordId(),
		requestId,
		timestamp: now.toISOString(),
		requestedModel: input.model,
		routingMode: "fixed",
		routeSource: "fixed",
		resolvedProvider: "openai",
		resolvedModel: input.model,
		attemptIndex: 0,
		attemptCount: 1,
		endpoint: input.context?.endpoint ?? mediaEndpoint(input.kind),
		clientOrigin: input.context?.clientOrigin,
		agentRunId: input.context?.agentRunId,
		usage: estimated.usage,
		cost: estimated.cost,
		media: estimated.media,
		inputTokens: estimated.usage?.input,
		outputTokens: estimated.usage?.output,
		costUsd: estimated.cost?.total,
		status: input.status,
		errorCode: input.errorCode,
		errorMessage: input.errorMessage,
		trace: [
			{
				timestamp: now.toISOString(),
				phase: "gateway-audio",
				provider: "openai",
				model: input.model,
				status: input.status,
				metadata: {
					kind: input.kind,
					providerEndpoint: input.providerEndpoint,
					pricingVersion: OPENAI_AUDIO_PRICING_VERSION,
					inputBytes: positiveNumber(input.inputBytes),
					outputBytes: positiveNumber(input.outputBytes),
					inputChars: positiveNumber(input.inputChars),
					audioSeconds: positiveNumber(input.audioSeconds),
					estimated: true,
				},
			},
		],
	} satisfies UsageRecord;
}

export async function recordGatewayAudioUsage(input: GatewayAudioUsageInput): Promise<UsageRecord | undefined> {
	const record = createGatewayAudioUsageRecord(input);
	if (!record || !input.usageStore) return record;
	try {
		await input.usageStore.recordUsage(record);
	} catch {
		return record;
	}
	return record;
}

export function textLengthForAudioUsage(text: string): number {
	return countTextChars(text);
}

export function detectWavDurationSeconds(data: Uint8Array): number | undefined {
	const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	if (buffer.length < 44) return undefined;
	if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return undefined;

	let offset = 12;
	let byteRate: number | undefined;
	let dataBytes: number | undefined;
	while (offset + 8 <= buffer.length) {
		const chunkId = buffer.toString("ascii", offset, offset + 4);
		const chunkSize = buffer.readUInt32LE(offset + 4);
		const chunkStart = offset + 8;
		if (chunkStart + chunkSize > buffer.length) break;
		if (chunkId === "fmt " && chunkSize >= 16) {
			byteRate = buffer.readUInt32LE(chunkStart + 8);
		} else if (chunkId === "data") {
			dataBytes = chunkSize;
		}
		if (byteRate && dataBytes !== undefined) {
			return byteRate > 0 ? dataBytes / byteRate : undefined;
		}
		offset = chunkStart + chunkSize + (chunkSize % 2);
	}
	return undefined;
}
