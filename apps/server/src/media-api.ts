import { selectProviderConnection } from "@pie-lab/router";
import {
	createJsonProviderConnectionStore,
	createUsageRecordId,
	type ProviderConnection,
	type ProviderConnectionStore,
	type UsageRecord,
	type UsageStore,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import {
	budgetViolationMessage,
	createBudgetLimitErrorBody,
	evaluateBudget,
	type BudgetStatus,
} from "./budget-policy.js";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.js";

export interface MediaApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	usageStore?: UsageStore;
	fetch?: typeof fetch;
	now?: () => Date;
	requestIdFactory?: () => string;
}

type MediaKind = "embedding" | "webSearch" | "webFetch" | "tts" | "stt" | "image";

interface MediaProviderConfig {
	provider: string;
	kind: MediaKind;
	baseUrl: string;
	authHeader: "bearer" | "x-api-key" | "xi-api-key" | "token" | "key" | "none";
	format?: string;
	noAuth?: boolean;
	costPerQuery?: number;
	timeoutMs?: number;
}

interface ParsedModel {
	provider: string;
	model: string;
	requested?: string;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization, x-connection-id",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_MEDIA_MODELS: Record<MediaKind, string[]> = {
	embedding: ["openai/text-embedding-3-small", "cohere/embed-v4.0", "gemini/text-embedding-004", "ollama/nomic-embed-text"],
	webSearch: ["tavily", "brave-search", "serper", "exa", "searxng"],
	webFetch: ["firecrawl", "jina-reader", "tavily", "exa"],
	tts: ["openai/tts-1", "elevenlabs/eleven_multilingual_v2", "gemini/gemini-2.5-flash-preview-tts:Kore", "minimax/speech-02-hd"],
	stt: ["openai/whisper-1", "elevenlabs/scribe_v2", "groq/whisper-large-v3", "deepgram/nova-3", "gemini/gemini-2.5-flash"],
	image: ["openai/gpt-image-1", "gemini/gemini-2.5-flash-image-preview", "xai/grok-2-image"],
};

const MEDIA_CONFIGS: Record<string, MediaProviderConfig[]> = {
	openai: [
		{ provider: "openai", kind: "embedding", baseUrl: "https://api.openai.com/v1/embeddings", authHeader: "bearer" },
		{ provider: "openai", kind: "tts", baseUrl: "https://api.openai.com/v1/audio/speech", authHeader: "bearer", format: "openai" },
		{ provider: "openai", kind: "stt", baseUrl: "https://api.openai.com/v1/audio/transcriptions", authHeader: "bearer", format: "openai" },
		{ provider: "openai", kind: "image", baseUrl: "https://api.openai.com/v1/images/generations", authHeader: "bearer", format: "openai" },
	],
	openrouter: [
		{ provider: "openrouter", kind: "embedding", baseUrl: "https://openrouter.ai/api/v1/embeddings", authHeader: "bearer" },
		{ provider: "openrouter", kind: "image", baseUrl: "https://openrouter.ai/api/v1/images/generations", authHeader: "bearer", format: "openai" },
	],
	cohere: [
		{ provider: "cohere", kind: "embedding", baseUrl: "https://api.cohere.com/v2/embed", authHeader: "bearer", format: "cohere-v2" },
	],
	gemini: [
		{ provider: "gemini", kind: "embedding", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authHeader: "key", format: "gemini" },
		{ provider: "gemini", kind: "tts", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authHeader: "key", format: "gemini-tts" },
		{ provider: "gemini", kind: "stt", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authHeader: "key", format: "gemini-stt" },
		{ provider: "gemini", kind: "image", baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authHeader: "key", format: "gemini-image" },
	],
	mistral: [
		{ provider: "mistral", kind: "embedding", baseUrl: "https://api.mistral.ai/v1/embeddings", authHeader: "bearer" },
	],
	"voyage-ai": [
		{ provider: "voyage-ai", kind: "embedding", baseUrl: "https://api.voyageai.com/v1/embeddings", authHeader: "bearer" },
	],
	together: [
		{ provider: "together", kind: "embedding", baseUrl: "https://api.together.xyz/v1/embeddings", authHeader: "bearer" },
	],
	fireworks: [
		{ provider: "fireworks", kind: "embedding", baseUrl: "https://api.fireworks.ai/inference/v1/embeddings", authHeader: "bearer" },
	],
	github: [
		{ provider: "github", kind: "embedding", baseUrl: "https://models.github.ai/inference/embeddings", authHeader: "bearer" },
	],
	nvidia: [
		{ provider: "nvidia", kind: "embedding", baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authHeader: "bearer" },
	],
	"jina-ai": [
		{ provider: "jina-ai", kind: "embedding", baseUrl: "https://api.jina.ai/v1/embeddings", authHeader: "bearer" },
	],
	ollama: [
		{ provider: "ollama", kind: "embedding", baseUrl: "http://localhost:11434/api/embed", authHeader: "none", noAuth: true, format: "ollama" },
	],
	groq: [
		{ provider: "groq", kind: "stt", baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions", authHeader: "bearer", format: "openai" },
	],
	deepgram: [
		{ provider: "deepgram", kind: "stt", baseUrl: "https://api.deepgram.com/v1/listen", authHeader: "token", format: "deepgram" },
	],
	elevenlabs: [
		{ provider: "elevenlabs", kind: "tts", baseUrl: "https://api.elevenlabs.io/v1/text-to-speech", authHeader: "xi-api-key", format: "elevenlabs" },
		{ provider: "elevenlabs", kind: "stt", baseUrl: "https://api.elevenlabs.io/v1/speech-to-text", authHeader: "xi-api-key", format: "elevenlabs-stt" },
	],
	minimax: [
		{ provider: "minimax", kind: "tts", baseUrl: "https://api.minimax.io/v1/t2a_v2", authHeader: "bearer", format: "minimax" },
		{ provider: "minimax", kind: "image", baseUrl: "https://api.minimaxi.com/v1/images/generations", authHeader: "bearer", format: "openai" },
	],
	recraft: [
		{ provider: "recraft", kind: "image", baseUrl: "https://external.api.recraft.ai/v1/images/generations", authHeader: "bearer", format: "openai" },
	],
	xai: [
		{ provider: "xai", kind: "image", baseUrl: "https://api.x.ai/v1/images/generations", authHeader: "bearer", format: "xai" },
	],
	tavily: [
		{ provider: "tavily", kind: "webSearch", baseUrl: "https://api.tavily.com/search", authHeader: "bearer", costPerQuery: 0.008, timeoutMs: 10000 },
		{ provider: "tavily", kind: "webFetch", baseUrl: "https://api.tavily.com/extract", authHeader: "bearer", costPerQuery: 0.008, timeoutMs: 15000 },
	],
	"brave-search": [
		{ provider: "brave-search", kind: "webSearch", baseUrl: "https://api.search.brave.com/res/v1", authHeader: "x-api-key", costPerQuery: 0.005, timeoutMs: 10000 },
	],
	serper: [
		{ provider: "serper", kind: "webSearch", baseUrl: "https://google.serper.dev", authHeader: "x-api-key", costPerQuery: 0.001, timeoutMs: 10000 },
	],
	exa: [
		{ provider: "exa", kind: "webSearch", baseUrl: "https://api.exa.ai/search", authHeader: "x-api-key", costPerQuery: 0.007, timeoutMs: 10000 },
		{ provider: "exa", kind: "webFetch", baseUrl: "https://api.exa.ai/contents", authHeader: "x-api-key", costPerQuery: 0.001, timeoutMs: 15000 },
	],
	searxng: [
		{ provider: "searxng", kind: "webSearch", baseUrl: "http://localhost:8888/search", authHeader: "none", noAuth: true, costPerQuery: 0, timeoutMs: 10000 },
	],
	firecrawl: [
		{ provider: "firecrawl", kind: "webFetch", baseUrl: "https://api.firecrawl.dev/v1/scrape", authHeader: "bearer", costPerQuery: 0.002, timeoutMs: 30000 },
	],
	"jina-reader": [
		{ provider: "jina-reader", kind: "webFetch", baseUrl: "https://r.jina.ai", authHeader: "bearer", costPerQuery: 0, timeoutMs: 30000 },
	],
};

export function createMediaRequestHandler(options: MediaApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const now = options.now ?? (() => new Date());
	const requestIdFactory = options.requestIdFactory ?? (() => createUsageRecordId("media_request"));

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleMediaRequest(request, response, {
				providerConnectionStore,
				usageStore: options.usageStore,
				fetchImpl: options.fetch ?? fetch,
				now,
				requestIdFactory,
			});
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

async function handleMediaRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		usageStore?: UsageStore;
		fetchImpl: typeof fetch;
		now: () => Date;
		requestIdFactory: () => string;
	},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (isMediaRoutesPath(url.pathname)) {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response);
			return;
		}
		writeJson(response, 200, createMediaRoutesResponse());
		return;
	}

	const kind = mediaKindFromPath(url.pathname);
	if (!kind) {
		writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
		return;
	}
	if (request.method !== "POST") {
		writeMethodNotAllowed(response);
		return;
	}

	const requestId = options.requestIdFactory();
	const startedAt = options.now();
	let requestedModel = "";
	let provider = "";
	let model = "";

	try {
		if (kind === "stt") {
			const formData = await readFormData(request);
			const modelRef = await resolveMediaModelReference(
				kind,
				requiredString(formData.get("model"), "model"),
				options.providerConnectionStore,
			);
			requestedModel = modelRef.requested ?? `${modelRef.provider}/${modelRef.model}`;
			provider = modelRef.provider;
			model = modelRef.model;
			const config = getMediaConfig(provider, kind);
			const budgetStatus = await evaluateMediaBudget(options, provider, config);
			if (budgetStatus?.shouldBlock) {
				await recordMediaUsage(options, {
					requestId,
					timestamp: startedAt,
					requestedModel,
					provider,
					model,
					kind,
					result: {
						ok: false,
						status: 402,
						error: budgetViolationMessage(budgetStatus),
						usageStatus: "skipped",
					},
				});
				writeJson(
					response,
					402,
					createBudgetLimitErrorBody({
						requestId,
						requestedModel,
						routingMode: "fixed",
						status: budgetStatus,
					}),
				);
				return;
			}
			const credentials = await resolveMediaCredentials(options.providerConnectionStore, provider, model, config);
			const result = await runStt(formData, modelRef, config, credentials, options.fetchImpl);
			await recordMediaUsage(options, {
				requestId,
				timestamp: startedAt,
				requestedModel,
				provider,
				model,
				connectionId: credentials?.id,
				kind,
				result,
			});
			await writeWebResponse(response, result.response);
			return;
		}

		const body = await readJsonBody(request);
		const modelRef = await parseRequestModel(kind, body, options.providerConnectionStore);
		requestedModel = modelRef.requested ?? `${modelRef.provider}${modelRef.model ? `/${modelRef.model}` : ""}`;
		provider = modelRef.provider;
		model = modelRef.model;
		const config = getMediaConfig(provider, kind);
		const budgetStatus = await evaluateMediaBudget(options, provider, config);
		if (budgetStatus?.shouldBlock) {
			await recordMediaUsage(options, {
				requestId,
				timestamp: startedAt,
				requestedModel,
				provider,
				model,
				kind,
				result: {
					ok: false,
					status: 402,
					error: budgetViolationMessage(budgetStatus),
					usageStatus: "skipped",
				},
			});
			writeJson(
				response,
				402,
				createBudgetLimitErrorBody({
					requestId,
					requestedModel,
					routingMode: "fixed",
					status: budgetStatus,
				}),
			);
			return;
		}
		const credentials = await resolveMediaCredentials(options.providerConnectionStore, provider, model, config);
		const result = await runMediaJson(kind, body, modelRef, config, credentials, options.fetchImpl, url);
		await recordMediaUsage(options, {
			requestId,
			timestamp: startedAt,
			requestedModel,
			provider,
			model,
			connectionId: credentials?.id,
			kind,
			result,
		});
		await writeWebResponse(response, result.response);
	} catch (error) {
		await recordMediaUsage(options, {
			requestId,
			timestamp: startedAt,
			requestedModel: requestedModel || provider || kind,
			provider: provider || "unknown",
			model: model || kind,
			kind,
			result: { ok: false, status: 400, error: error instanceof Error ? error.message : String(error) },
		});
		writeJson(response, 400, {
			error: {
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

async function runMediaJson(
	kind: Exclude<MediaKind, "stt">,
	body: Record<string, unknown>,
	modelRef: ParsedModel,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
	url: URL,
): Promise<{ ok: boolean; status: number; response: Response; error?: string; costUsd?: number }> {
	switch (kind) {
		case "embedding":
			return runEmbedding(body, modelRef, config, credentials, fetchImpl);
		case "webSearch":
			return runSearch(body, modelRef.provider, config, credentials, fetchImpl);
		case "webFetch":
			return runWebFetch(body, modelRef.provider, config, credentials, fetchImpl);
		case "tts":
			return runTts(body, modelRef, config, credentials, fetchImpl, url.searchParams.get("response_format") || undefined);
		case "image":
			return runImage(body, modelRef, config, credentials, fetchImpl);
	}
}

async function runEmbedding(
	body: Record<string, unknown>,
	modelRef: ParsedModel,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
) {
	const input = body.input;
	if (!input || (typeof input !== "string" && !Array.isArray(input))) {
		throw new Error("input must be a string or array of strings");
	}

	if (config.format === "gemini") {
		const token = requireToken(credentials, config);
		const isBatch = Array.isArray(input);
		const operation = isBatch ? "batchEmbedContents" : "embedContent";
		const modelPath = modelRef.model.startsWith("models/") ? modelRef.model : `models/${modelRef.model}`;
		const requestBody = isBatch
			? { requests: input.map((text) => ({ model: modelPath, content: { parts: [{ text: String(text) }] } })) }
			: { model: modelPath, content: { parts: [{ text: String(input) }] } };
		const upstream = await fetchImpl(`${config.baseUrl}/${modelPath}:${operation}?key=${encodeURIComponent(token)}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(requestBody),
		});
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult(normalizeGeminiEmbedding(data, modelRef.model));
	}

	if (config.format === "cohere-v2") {
		const texts = Array.isArray(input) ? input.map(String) : [String(input)];
		const upstream = await fetchImpl(config.baseUrl, {
			method: "POST",
			headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
			body: JSON.stringify({
				model: modelRef.model,
				inputs: texts.map((text) => ({ content: [{ type: "text", text }] })),
				input_type: typeof body.input_type === "string" ? body.input_type : "search_document",
				embedding_types: Array.isArray(body.embedding_types) ? body.embedding_types : ["float"],
				...readExtraBody(body),
			}),
		});
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult(normalizeCohereEmbedding(data, modelRef.model, texts.length));
	}

	if (config.format === "ollama") {
		const upstream = await fetchImpl(config.baseUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model: modelRef.model,
				input,
				...readExtraBody(body),
			}),
		});
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult(normalizeOllamaEmbedding(data, modelRef.model));
	}

	const upstream = await fetchImpl(config.baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
		body: JSON.stringify({
			model: modelRef.model,
			input,
			...(typeof body.encoding_format === "string" ? { encoding_format: body.encoding_format } : {}),
			...(typeof body.dimensions === "number" ? { dimensions: body.dimensions } : {}),
			...readExtraBody(body),
		}),
	});
	const data = await readJson(upstream);
	if (!upstream.ok) return errorResult(upstream.status, data);
	return jsonResult(data);
}

async function runSearch(
	body: Record<string, unknown>,
	provider: string,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
) {
	const query = requiredString(body.query, "query").normalize("NFKC").trim().replace(/\s+/g, " ");
	const maxResults = Math.min(Number(body.max_results ?? 5) || 5, 100);
	const searchType = typeof body.search_type === "string" ? body.search_type : "web";
	const started = Date.now();
	const { upstreamUrl, init } = buildSearchRequest(provider, config, credentials, {
		query,
		maxResults,
		searchType,
		country: typeof body.country === "string" ? body.country : undefined,
		language: typeof body.language === "string" ? body.language : undefined,
	});
	const upstream = await fetchWithTimeout(fetchImpl, upstreamUrl, init, config.timeoutMs ?? 15000);
	const data = await readJson(upstream);
	if (!upstream.ok) return errorResult(upstream.status, data);
	const normalized = normalizeSearchResponse(provider, data, query, searchType).slice(0, maxResults);
	return jsonResult({
		provider,
		query,
		results: normalized,
		answer: null,
		usage: { queries_used: 1, search_cost_usd: config.costPerQuery ?? 0 },
		metrics: { response_time_ms: Date.now() - started, upstream_latency_ms: Date.now() - started, total_results_available: normalized.length },
		errors: [],
	}, config.costPerQuery);
}

async function runWebFetch(
	body: Record<string, unknown>,
	provider: string,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
) {
	const targetUrl = requiredString(body.url, "url");
	new URL(targetUrl);
	const format = typeof body.format === "string" ? body.format : "markdown";
	const maxCharacters = typeof body.max_characters === "number" ? body.max_characters : undefined;
	const started = Date.now();

	if (provider === "jina-reader") {
		const upstream = await fetchWithTimeout(
			fetchImpl,
			`${config.baseUrl}/${encodeURIComponent(targetUrl)}`,
			{ method: "GET", headers: authHeaders(config, credentials) },
			config.timeoutMs ?? 30000,
		);
		const text = await upstream.text();
		if (!upstream.ok) return textErrorResult(upstream.status, text);
		return jsonResult(buildFetchData(provider, targetUrl, format, truncate(text, maxCharacters), started), config.costPerQuery);
	}

	const upstream = await fetchWithTimeout(
		fetchImpl,
		config.baseUrl,
		buildFetchRequest(provider, targetUrl, config, credentials, format),
		config.timeoutMs ?? 15000,
	);
	const data = await readJson(upstream);
	if (!upstream.ok) return errorResult(upstream.status, data);
	const text = extractFetchedText(provider, data);
	return jsonResult(buildFetchData(provider, targetUrl, format, truncate(text, maxCharacters), started), config.costPerQuery);
}

async function runTts(
	body: Record<string, unknown>,
	modelRef: ParsedModel,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
	responseFormat = "mp3",
) {
	const input = requiredString(body.input, "input");

	if (config.format === "gemini-tts") {
		const token = requireToken(credentials, config);
		const { modelId, voiceId } = parseGeminiTtsModelVoice(modelRef.model);
		const language = typeof body.language === "string" ? body.language : undefined;
		const upstream = await fetchImpl(
			`${config.baseUrl}/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(token)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: buildGeminiTtsPrompt(input, language) }] }],
					generationConfig: {
						responseModalities: ["AUDIO"],
						speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceId } } },
					},
				}),
			},
		);
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		const audio = extractGeminiInlineData(data);
		if (!audio) return errorResult(502, { error: { message: "Gemini TTS returned no audio" } });
		const buffer = pcmToWav(Buffer.from(audio, "base64"));
		if (responseFormat === "json") {
			return jsonResult({ audio: buffer.toString("base64"), format: "wav" });
		}
		return responseResult(new Response(buffer, { status: 200, headers: { "content-type": "audio/wav" } }));
	}

	if (config.format === "elevenlabs") {
		const voiceId = readElevenLabsVoiceId(body, credentials);
		const outputFormat =
			typeof body.output_format === "string" ? body.output_format : responseFormat === "json" ? "mp3_44100_128" : responseFormat;
		const url = new URL(`${config.baseUrl}/${encodeURIComponent(voiceId)}`);
		if (outputFormat) url.searchParams.set("output_format", normalizeElevenLabsOutputFormat(outputFormat));
		const upstream = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
			body: JSON.stringify({
				text: input,
				model_id: modelRef.model || "eleven_multilingual_v2",
				...(typeof body.language === "string" ? { language_code: body.language } : {}),
				...readExtraBody(body),
			}),
		});
		if (!upstream.ok) return errorResult(upstream.status, await readJsonOrText(upstream));
		const buffer = Buffer.from(await upstream.arrayBuffer());
		if (responseFormat === "json") {
			return jsonResult({ audio: buffer.toString("base64"), format: normalizeElevenLabsOutputFormat(outputFormat) });
		}
		return responseResult(new Response(buffer, { status: 200, headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg" } }));
	}

	const upstream = await fetchImpl(config.baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
		body: JSON.stringify({
			model: modelRef.model,
			input,
			voice: typeof body.voice === "string" ? body.voice : "alloy",
			response_format: responseFormat === "json" ? "mp3" : responseFormat,
			...(typeof body.speed === "number" ? { speed: body.speed } : {}),
			...readExtraBody(body),
		}),
	});
	if (!upstream.ok) return errorResult(upstream.status, await readJsonOrText(upstream));
	const buffer = Buffer.from(await upstream.arrayBuffer());
	if (responseFormat === "json") {
		return jsonResult({ audio: buffer.toString("base64"), format: "mp3" });
	}
	return responseResult(new Response(buffer, { status: 200, headers: { "content-type": upstream.headers.get("content-type") ?? "audio/mpeg" } }));
}

async function runStt(
	formData: FormData,
	modelRef: ParsedModel,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
) {
	const file = formData.get("file");
	if (!file || typeof file === "string") throw new Error("file is required");

	if (config.format === "gemini-stt") {
		const token = requireToken(credentials, config);
		const buffer = Buffer.from(await file.arrayBuffer());
		const language = formData.get("language");
		const userPrompt = formData.get("prompt");
		const prompt = buildGeminiSttPrompt(
			typeof userPrompt === "string" ? userPrompt : undefined,
			typeof language === "string" ? language : undefined,
		);
		const upstream = await fetchImpl(
			`${config.baseUrl}/${encodeURIComponent(modelRef.model)}:generateContent?key=${encodeURIComponent(token)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					contents: [
						{
							parts: [
								{ text: prompt },
								{
									inline_data: {
										mime_type: resolveAudioContentType(file),
										data: buffer.toString("base64"),
									},
								},
							],
						},
					],
				}),
			},
		);
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult({ text: extractGeminiText(data) });
	}

	if (config.format === "deepgram") {
		const url = new URL(config.baseUrl);
		url.searchParams.set("model", modelRef.model);
		url.searchParams.set("smart_format", "true");
		const upstream = await fetchImpl(url, {
			method: "POST",
			headers: { ...authHeaders(config, credentials), "content-type": file.type || "application/octet-stream" },
			body: await file.arrayBuffer(),
		});
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult({ text: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "" });
	}

	if (config.format === "elevenlabs-stt") {
		const upstreamForm = new FormData();
		upstreamForm.set("file", file, file.name || "audio.wav");
		upstreamForm.set("model_id", modelRef.model || "scribe_v2");
		for (const [from, to] of [
			["language", "language_code"],
			["language_code", "language_code"],
			["diarize", "diarize"],
			["timestamps_granularity", "timestamps_granularity"],
			["num_speakers", "num_speakers"],
			["tag_audio_events", "tag_audio_events"],
		] as const) {
			const value = formData.get(from);
			if (typeof value === "string" && value) upstreamForm.set(to, value);
		}
		const upstream = await fetchImpl(config.baseUrl, {
			method: "POST",
			headers: authHeaders(config, credentials),
			body: upstreamForm,
		});
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult({
			text: readString(data.text),
			language: readString(data.language_code) || null,
			words: Array.isArray(data.words) ? data.words : undefined,
			provider_raw: data,
		});
	}

	const upstreamForm = new FormData();
	upstreamForm.set("file", file, file.name || "audio.wav");
	upstreamForm.set("model", modelRef.model);
	for (const key of ["language", "prompt", "response_format", "temperature"]) {
		const value = formData.get(key);
		if (typeof value === "string" && value) upstreamForm.set(key, value);
	}
	const upstream = await fetchImpl(config.baseUrl, {
		method: "POST",
		headers: authHeaders(config, credentials),
		body: upstreamForm,
	});
	if (!upstream.ok) return errorResult(upstream.status, await readJsonOrText(upstream));
	return responseResult(new Response(await upstream.arrayBuffer(), { status: 200, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" } }));
}

async function runImage(
	body: Record<string, unknown>,
	modelRef: ParsedModel,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	fetchImpl: typeof fetch,
) {
	const prompt = requiredString(body.prompt, "prompt");
	if (config.format === "gemini-image") {
		const token = requireToken(credentials, config);
		const upstream = await fetchImpl(
			`${config.baseUrl}/${encodeURIComponent(modelRef.model)}:generateContent?key=${encodeURIComponent(token)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
				}),
			},
		);
		const data = await readJson(upstream);
		if (!upstream.ok) return errorResult(upstream.status, data);
		return jsonResult(normalizeGeminiImage(data, prompt));
	}

	const requestBody =
		config.format === "xai"
			? {
					model: modelRef.model,
					prompt,
					n: typeof body.n === "number" ? body.n : 1,
					...(typeof body.response_format === "string" ? { response_format: body.response_format } : {}),
					...readExtraBody(body),
				}
			: {
					model: modelRef.model,
					prompt,
					n: typeof body.n === "number" ? body.n : 1,
					size: typeof body.size === "string" ? body.size : "1024x1024",
					...(typeof body.quality === "string" ? { quality: body.quality } : {}),
					...(typeof body.style === "string" ? { style: body.style } : {}),
					...(typeof body.response_format === "string" ? { response_format: body.response_format } : {}),
					...readExtraBody(body),
				};
	const upstream = await fetchImpl(config.baseUrl, {
		method: "POST",
		headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
		body: JSON.stringify(requestBody),
	});
	const data = await readJson(upstream);
	if (!upstream.ok) return errorResult(upstream.status, data);
	return jsonResult(data);
}

async function resolveMediaCredentials(
	store: ProviderConnectionStore,
	provider: string,
	model: string | null,
	config: MediaProviderConfig,
): Promise<ProviderConnection | null> {
	if (config.noAuth || config.authHeader === "none") return null;
	const connections = await store.getProviderConnections({ provider, isActive: true });
	const settings = await store.getSettings();
	const selection = selectProviderConnection({ provider, model, connections, settings });
	if (selection.status !== "selected") {
		throw new Error(selection.status === "unavailable" ? `All provider connections are unavailable (${selection.retryAfterHuman})` : `No credentials for provider: ${provider}`);
	}
	return selection.connection;
}

async function evaluateMediaBudget(
	options: {
		providerConnectionStore: ProviderConnectionStore;
		usageStore?: UsageStore;
		now: () => Date;
	},
	provider: string,
	config: MediaProviderConfig,
): Promise<BudgetStatus | null> {
	const settings = await options.providerConnectionStore.getSettings();
	return evaluateBudget({
		settings,
		usageStore: options.usageStore,
		provider,
		estimatedRequestUsd: config.costPerQuery ?? null,
		now: options.now(),
	});
}

async function parseRequestModel(
	kind: Exclude<MediaKind, "stt">,
	body: Record<string, unknown>,
	store: ProviderConnectionStore,
): Promise<ParsedModel> {
	if (kind === "webSearch" || kind === "webFetch") {
		const provider = requiredString(body.provider ?? body.model ?? `auto:${kind}`, "provider");
		return resolveMediaModelReference(kind, provider, store);
	}
	return resolveMediaModelReference(kind, requiredString(body.model, "model"), store);
}

function parseModelReference(value: string): ParsedModel {
	const index = value.indexOf("/");
	if (index <= 0 || index === value.length - 1) {
		throw new Error("model must be formatted as provider/model");
	}
	return {
		provider: value.slice(0, index),
		model: value.slice(index + 1),
	};
}

async function resolveMediaModelReference(
	kind: MediaKind,
	value: string,
	store: ProviderConnectionStore,
): Promise<ParsedModel> {
	const requested = value.trim();
	if (!requested) throw new Error("model is required");

	const direct = parseMediaCandidate(kind, requested);
	if (direct) return { ...direct, requested };

	const selectionNames = mediaPolicyLookupNames(kind, requested);
	const settings = await store.getSettings();
	const policy = settings.routerPolicy ?? {};
	const candidates = [
		...selectionNames.flatMap((name) => toStringList(policy.aliases?.[name])),
		...selectionNames.flatMap((name) => toStringList(policy.intents?.[name.replace(/^[^:]+:/, "")])),
		...DEFAULT_MEDIA_MODELS[kind],
	];

	for (const candidate of candidates) {
		const parsed = parseMediaCandidate(kind, candidate);
		if (!parsed) continue;
		try {
			getMediaConfig(parsed.provider, kind);
			return { ...parsed, requested };
		} catch {
			// Keep trying the next policy/default candidate.
		}
	}

	throw new Error(`No media route found for ${requested}`);
}

function parseMediaCandidate(kind: MediaKind, value: string): ParsedModel | null {
	const normalized = value.trim();
	if (!normalized || isRouterAlias(normalized)) return null;
	if ((kind === "webSearch" || kind === "webFetch") && !normalized.includes("/")) {
		return { provider: normalized, model: "" };
	}
	if (!normalized.includes("/")) return null;
	return parseModelReference(normalized);
}

function isRouterAlias(value: string): boolean {
	return /^(auto|cheap|fast|combo):/.test(value);
}

function mediaPolicyLookupNames(kind: MediaKind, requested: string): string[] {
	const names = [requested, `auto:${kind}`];
	const intent = requested.includes(":") ? requested.slice(requested.indexOf(":") + 1) : requested;
	if (intent) names.push(intent);
	return [...new Set(names.filter(Boolean))];
}

function toStringList(value: string | string[] | undefined): string[] {
	if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
	return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function readExtraBody(body: Record<string, unknown>): Record<string, unknown> {
	const extra = body.extra_body;
	return extra && typeof extra === "object" && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
}

function getMediaConfig(provider: string, kind: MediaKind): MediaProviderConfig {
	const config = MEDIA_CONFIGS[provider]?.find((item) => item.kind === kind);
	if (!config) throw new Error(`Provider ${provider} does not support ${kind}`);
	return config;
}

function mediaKindFromPath(pathname: string): MediaKind | null {
	if (pathname === "/v1/embeddings") return "embedding";
	if (pathname === "/v1/search" || pathname === "/search") return "webSearch";
	if (pathname === "/v1/web/fetch" || pathname === "/web/fetch") return "webFetch";
	if (pathname === "/v1/audio/speech") return "tts";
	if (pathname === "/v1/audio/transcriptions") return "stt";
	if (pathname === "/v1/images/generations") return "image";
	return null;
}

function isMediaRoutesPath(pathname: string): boolean {
	return pathname === "/media/routes" || pathname === "/v1/media/routes";
}

function createMediaRoutesResponse() {
	const routes = Object.entries(MEDIA_CONFIGS)
		.flatMap(([provider, configs]) =>
			configs.map((config) => ({
				provider,
				kind: config.kind,
				authHeader: config.authHeader,
				format: config.format ?? null,
				noAuth: config.noAuth === true,
				costPerQuery: config.costPerQuery ?? null,
				timeoutMs: config.timeoutMs ?? null,
				defaultCandidates: DEFAULT_MEDIA_MODELS[config.kind],
			})),
		)
		.sort((left, right) => left.kind.localeCompare(right.kind) || left.provider.localeCompare(right.provider));

	return {
		count: routes.length,
		routes,
		aliases: {
			"auto:embedding": DEFAULT_MEDIA_MODELS.embedding,
			"auto:webSearch": DEFAULT_MEDIA_MODELS.webSearch,
			"auto:webFetch": DEFAULT_MEDIA_MODELS.webFetch,
			"auto:tts": DEFAULT_MEDIA_MODELS.tts,
			"auto:stt": DEFAULT_MEDIA_MODELS.stt,
			"auto:image": DEFAULT_MEDIA_MODELS.image,
		},
	};
}

function buildSearchRequest(
	provider: string,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	options: { query: string; maxResults: number; searchType: string; country?: string; language?: string },
): { upstreamUrl: string | URL; init: RequestInit } {
	const token = config.authHeader === "none" ? "" : requireToken(credentials, config);
	if (provider === "serper") {
		return {
			upstreamUrl: `${config.baseUrl}${options.searchType === "news" ? "/news" : "/search"}`,
			init: {
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": token },
				body: JSON.stringify({ q: options.query, num: options.maxResults, gl: options.country, hl: options.language }),
			},
		};
	}
	if (provider === "brave-search") {
		const url = new URL(`${config.baseUrl}${options.searchType === "news" ? "/news/search" : "/web/search"}`);
		url.searchParams.set("q", options.query);
		url.searchParams.set("count", String(options.maxResults));
		if (options.country) url.searchParams.set("country", options.country);
		if (options.language) url.searchParams.set("search_lang", options.language);
		return { upstreamUrl: url, init: { method: "GET", headers: { accept: "application/json", "x-subscription-token": token } } };
	}
	if (provider === "searxng") {
		const url = new URL(config.baseUrl);
		url.searchParams.set("q", options.query);
		url.searchParams.set("format", "json");
		url.searchParams.set("categories", options.searchType === "news" ? "news" : "general");
		return { upstreamUrl: url, init: { method: "GET", headers: { accept: "application/json" } } };
	}
	if (provider === "exa") {
		return {
			upstreamUrl: config.baseUrl,
			init: {
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": token },
				body: JSON.stringify({ query: options.query, numResults: options.maxResults, type: "auto", text: true, highlights: true }),
			},
		};
	}
	if (provider === "tavily") {
		return {
			upstreamUrl: config.baseUrl,
			init: {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
				body: JSON.stringify({ query: options.query, max_results: options.maxResults, topic: options.searchType === "news" ? "news" : "general" }),
			},
		};
	}
	throw new Error(`Search provider ${provider} is not implemented yet`);
}

function normalizeSearchResponse(provider: string, data: unknown, _query: string, _searchType: string) {
	const now = new Date().toISOString();
	const items = extractSearchItems(provider, data);
	return items.map((item, index) => ({
		title: readString(item.title) || readString(item.name) || "",
		url: readString(item.url) || readString(item.link) || "",
		display_url: (readString(item.url) || readString(item.link) || "").replace(/^https?:\/\/(www\.)?/, "").split("?")[0],
		snippet: readString(item.snippet) || readString(item.description) || readString(item.content) || "",
		position: index + 1,
		score: typeof item.score === "number" ? Math.max(0, Math.min(1, item.score)) : null,
		published_at: readString(item.published_date) || readString(item.publishedDate) || readString(item.date) || null,
		favicon_url: readString(item.favicon) || null,
		content: readString(item.text) ? { format: "text", text: readString(item.text), length: readString(item.text).length } : null,
		metadata: { author: readString(item.author) || null, language: null, source_type: null, image_url: readString(item.image) || null },
		citation: { provider, retrieved_at: now, rank: index + 1 },
		provider_raw: null,
	}));
}

function extractSearchItems(provider: string, data: unknown): Array<Record<string, unknown>> {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	if (provider === "serper") return arrayOfRecords(record.organic ?? record.news);
	if (provider === "brave-search") {
		const web = record.web && typeof record.web === "object" ? (record.web as Record<string, unknown>).results : undefined;
		const news = record.news && typeof record.news === "object" ? (record.news as Record<string, unknown>).results : undefined;
		return arrayOfRecords(web ?? news);
	}
	return arrayOfRecords(record.results);
}

function buildFetchRequest(
	provider: string,
	targetUrl: string,
	config: MediaProviderConfig,
	credentials: ProviderConnection | null,
	format: string,
): RequestInit {
	if (provider === "firecrawl") {
		return {
			method: "POST",
			headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
			body: JSON.stringify({ url: targetUrl, formats: [format] }),
		};
	}
	if (provider === "tavily") {
		return {
			method: "POST",
			headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
			body: JSON.stringify({ urls: [targetUrl], extract_depth: "basic" }),
		};
	}
	if (provider === "exa") {
		return {
			method: "POST",
			headers: { "content-type": "application/json", ...authHeaders(config, credentials) },
			body: JSON.stringify({ ids: [targetUrl], text: true }),
		};
	}
	throw new Error(`Fetch provider ${provider} is not implemented yet`);
}

function extractFetchedText(provider: string, data: unknown): string {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	if (provider === "firecrawl") {
		const nested = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
		return readString(nested.markdown) || readString(nested.html) || readString(nested.text);
	}
	if (provider === "tavily") {
		const first = arrayOfRecords(record.results)[0] ?? {};
		return readString(first.raw_content) || readString(first.content);
	}
	if (provider === "exa") {
		const first = arrayOfRecords(record.results)[0] ?? {};
		return readString(first.text);
	}
	return "";
}

function buildFetchData(provider: string, url: string, format: string, text: string, startedAt: number) {
	return {
		provider,
		url,
		title: text.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ?? null,
		content: { format, text, length: text.length },
		metadata: { author: null, published_at: null, language: null },
		usage: { fetch_cost_usd: MEDIA_CONFIGS[provider]?.find((item) => item.kind === "webFetch")?.costPerQuery ?? null },
		metrics: { response_time_ms: Date.now() - startedAt, upstream_latency_ms: Date.now() - startedAt },
	};
}

function normalizeGeminiEmbedding(data: unknown, model: string) {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	let embeddings: Array<{ object: "embedding"; index: number; embedding: unknown[] }> = [];
	if (Array.isArray(record.embeddings)) {
		embeddings = record.embeddings.map((item, index) => ({
			object: "embedding",
			index,
			embedding: Array.isArray((item as { values?: unknown }).values) ? ((item as { values: unknown[] }).values) : [],
		}));
	} else if (record.embedding && typeof record.embedding === "object") {
		const values = (record.embedding as { values?: unknown }).values;
		embeddings = [{ object: "embedding", index: 0, embedding: Array.isArray(values) ? values : [] }];
	}
	return { object: "list", data: embeddings, model, usage: { prompt_tokens: 0, total_tokens: 0 } };
}

function normalizeCohereEmbedding(data: unknown, model: string, inputCount: number) {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	const embeddingsRecord = record.embeddings && typeof record.embeddings === "object" ? (record.embeddings as Record<string, unknown>) : {};
	const vectors = Array.isArray(embeddingsRecord.float)
		? embeddingsRecord.float
		: Array.isArray(record.embeddings)
			? record.embeddings
			: [];
	return {
		object: "list",
		data: vectors.map((embedding, index) => ({
			object: "embedding",
			index,
			embedding: Array.isArray(embedding) ? embedding : [],
		})),
		model,
		usage: { prompt_tokens: 0, total_tokens: 0, input_count: inputCount },
		provider_raw_id: readString(record.id) || null,
	};
}

function normalizeOllamaEmbedding(data: unknown, model: string) {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	const vectors = Array.isArray(record.embeddings)
		? record.embeddings
		: Array.isArray(record.embedding)
			? [record.embedding]
			: [];
	return {
		object: "list",
		data: vectors.map((embedding, index) => ({
			object: "embedding",
			index,
			embedding: Array.isArray(embedding) ? embedding : [],
		})),
		model,
		usage: {
			prompt_tokens: typeof record.prompt_eval_count === "number" ? record.prompt_eval_count : 0,
			total_tokens: typeof record.prompt_eval_count === "number" ? record.prompt_eval_count : 0,
		},
	};
}

function normalizeGeminiImage(data: unknown, prompt: string) {
	const inlineImages = extractGeminiInlineImages(data);
	return {
		created: Math.floor(Date.now() / 1000),
		data:
			inlineImages.length > 0
				? inlineImages.map((image) => ({ b64_json: image }))
				: [{ b64_json: "", revised_prompt: prompt }],
	};
}

const GEMINI_TTS_MODELS = new Set(["gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]);

function parseGeminiTtsModelVoice(model: string): { modelId: string; voiceId: string } {
	for (const modelId of GEMINI_TTS_MODELS) {
		if (model === modelId) return { modelId, voiceId: "Kore" };
		if (model.startsWith(`${modelId}/`)) return { modelId, voiceId: model.slice(modelId.length + 1) };
	}

	return { modelId: "gemini-2.5-flash-preview-tts", voiceId: model || "Kore" };
}

function buildGeminiTtsPrompt(input: string, language: string | undefined): string {
	if (/:\s/.test(input)) return input;
	return language ? `Say in ${language}: ${input}` : `Say: ${input}`;
}

function buildGeminiSttPrompt(prompt: string | undefined, language: string | undefined): string {
	const base = prompt?.trim() || "Generate a transcript of the speech. Return only the transcribed text, no commentary.";
	return language?.trim() ? `${base} Language: ${language.trim()}.` : base;
}

function readElevenLabsVoiceId(body: Record<string, unknown>, credentials: ProviderConnection | null): string {
	const fromBody = readString(body.voice) || readString(body.voice_id);
	if (fromBody) return fromBody;
	const providerData = credentials?.providerSpecificData;
	const fromConnection =
		providerData && typeof providerData === "object"
			? readString((providerData as Record<string, unknown>).voiceId) || readString((providerData as Record<string, unknown>).voice_id)
			: "";
	return fromConnection || "JBFqnCBsd6RMkjVDRZzb";
}

function normalizeElevenLabsOutputFormat(value: string): string {
	if (value === "mp3") return "mp3_44100_128";
	if (value === "wav") return "wav_44100";
	return value;
}

function extractGeminiText(data: unknown): string {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	const candidates = arrayOfRecords(record.candidates);
	const parts = arrayOfRecords(
		candidates[0]?.content && typeof candidates[0].content === "object"
			? (candidates[0].content as Record<string, unknown>).parts
			: undefined,
	);
	return parts.map((part) => readString(part.text)).filter(Boolean).join("");
}

function extractGeminiInlineData(data: unknown): string {
	return extractGeminiInlineImages(data)[0] ?? "";
}

function extractGeminiInlineImages(data: unknown): string[] {
	const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
	const candidates = arrayOfRecords(record.candidates);
	const parts = arrayOfRecords(
		candidates[0]?.content && typeof candidates[0].content === "object"
			? (candidates[0].content as Record<string, unknown>).parts
			: undefined,
	);
	return parts
		.map((part) => {
			const inlineData =
				part.inlineData && typeof part.inlineData === "object"
					? (part.inlineData as Record<string, unknown>)
					: part.inline_data && typeof part.inline_data === "object"
						? (part.inline_data as Record<string, unknown>)
						: undefined;
			return readString(inlineData?.data);
		})
		.filter(Boolean);
}

function resolveAudioContentType(file: File): string {
	const type = file.type.toLowerCase();
	if (type.startsWith("audio/")) return type;
	const name = file.name.toLowerCase();
	const extension = name.includes(".") ? name.split(".").pop() : "";
	const byExtension: Record<string, string> = {
		aac: "audio/aac",
		flac: "audio/flac",
		m4a: "audio/mp4",
		mp3: "audio/mpeg",
		mp4: "audio/mp4",
		ogg: "audio/ogg",
		opus: "audio/opus",
		wav: "audio/wav",
		webm: "audio/webm",
	};
	return byExtension[extension ?? ""] ?? "application/octet-stream";
}

function pcmToWav(pcmBuffer: Buffer): Buffer {
	const sampleRate = 24000;
	const channels = 1;
	const bitsPerSample = 16;
	const dataSize = pcmBuffer.length;
	const byteRate = (sampleRate * channels * bitsPerSample) / 8;
	const blockAlign = (channels * bitsPerSample) / 8;
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write("WAVE", 8);
	header.write("fmt ", 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(channels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write("data", 36);
	header.writeUInt32LE(dataSize, 40);
	return Buffer.concat([header, pcmBuffer]);
}

function authHeaders(config: MediaProviderConfig, credentials: ProviderConnection | null): Record<string, string> {
	if (config.authHeader === "none") return {};
	const token = requireToken(credentials, config);
	switch (config.authHeader) {
		case "bearer":
			return { authorization: `Bearer ${token}` };
		case "x-api-key":
			return { "x-api-key": token };
		case "xi-api-key":
			return { "xi-api-key": token };
		case "token":
			return { authorization: `Token ${token}` };
		case "key":
			return { authorization: `Key ${token}` };
	}
}

function requireToken(credentials: ProviderConnection | null, config: MediaProviderConfig): string {
	const token = credentials?.apiKey || credentials?.accessToken;
	if (!token && !config.noAuth) throw new Error(`No credentials for provider: ${config.provider}`);
	return token ?? "";
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function recordMediaUsage(
	options: { usageStore?: UsageStore; now: () => Date },
	input: {
		requestId: string;
		timestamp: Date;
		requestedModel: string;
		provider: string;
		model: string;
		connectionId?: string;
		kind: MediaKind;
		result: { ok: boolean; status: number; error?: string; costUsd?: number; usageStatus?: UsageRecord["status"] };
	},
): Promise<void> {
	const status = input.result.usageStatus ?? (input.result.ok ? "success" : "error");
	await options.usageStore?.recordUsage({
		id: createUsageRecordId(),
		requestId: input.requestId,
		timestamp: input.timestamp.toISOString(),
		requestedModel: input.requestedModel,
		routingMode: "fixed",
		routeSource: "fixed",
		resolvedProvider: input.provider,
		resolvedModel: input.model || input.provider,
		connectionId: input.connectionId,
		attemptIndex: 0,
		attemptCount: 1,
		endpoint: endpointForKind(input.kind),
		costUsd: input.result.costUsd,
		cost:
			typeof input.result.costUsd === "number"
				? {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: input.result.costUsd,
						currency: "USD",
						pricingSource: "provider",
					}
				: undefined,
		status,
		errorCode: input.result.ok ? undefined : input.result.status,
		errorMessage: input.result.error,
	} satisfies UsageRecord);
}

function endpointForKind(kind: MediaKind): string {
	switch (kind) {
		case "embedding":
			return "/v1/embeddings";
		case "webSearch":
			return "/v1/search";
		case "webFetch":
			return "/v1/web/fetch";
		case "tts":
			return "/v1/audio/speech";
		case "stt":
			return "/v1/audio/transcriptions";
		case "image":
			return "/v1/images/generations";
	}
}

function jsonResult(data: unknown, costUsd?: number) {
	return responseResult(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }), costUsd);
}

function responseResult(response: Response, costUsd?: number) {
	return { ok: response.ok, status: response.status, response, costUsd };
}

function errorResult(status: number, data: unknown) {
	const message = formatErrorData(data);
	return {
		ok: false,
		status,
		error: message,
		response: new Response(JSON.stringify({ error: { message } }), { status, headers: { "content-type": "application/json" } }),
	};
}

function textErrorResult(status: number, text: string) {
	return {
		ok: false,
		status,
		error: text,
		response: new Response(JSON.stringify({ error: { message: text } }), { status, headers: { "content-type": "application/json" } }),
	};
}

async function writeWebResponse(response: ServerResponse, webResponse: Response): Promise<void> {
	const headers: Record<string, string> = { ...CORS_HEADERS };
	webResponse.headers.forEach((value, key) => {
		headers[key] = value;
	});
	response.writeHead(webResponse.status, headers);
	response.end(Buffer.from(await webResponse.arrayBuffer()));
}

async function readFormData(request: IncomingMessage): Promise<FormData> {
	const webRequest = new Request(`http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`, {
		method: request.method,
		headers: request.headers as ConstructorParameters<typeof Headers>[0],
		body: Readable.toWeb(request) as RequestInit["body"],
		duplex: "half",
	} as RequestInit);
	return webRequest.formData();
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function readJson(response: Response): Promise<any> {
	try {
		return await response.json();
	} catch {
		return {};
	}
}

async function readJsonOrText(response: Response): Promise<unknown> {
	const text = await response.text();
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return text;
	}
}

function requiredString(value: unknown, name: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${name} is required`);
	}
	return value.trim();
}

function readString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

function truncate(text: string, maxCharacters: number | undefined): string {
	return maxCharacters && maxCharacters > 0 && text.length > maxCharacters ? text.slice(0, maxCharacters) : text;
}

function formatErrorData(data: unknown): string {
	if (typeof data === "string") return data;
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		if (typeof record.error === "string") return record.error;
		if (record.error && typeof record.error === "object" && typeof (record.error as Record<string, unknown>).message === "string") {
			return (record.error as Record<string, string>).message;
		}
		if (typeof record.message === "string") return record.message;
	}
	return "Upstream request failed";
}

function writeMethodNotAllowed(response: ServerResponse): void {
	response.writeHead(405, {
		...CORS_HEADERS,
		allow: "POST, OPTIONS",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify({ error: { message: "Method not allowed." } })}\n`);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
