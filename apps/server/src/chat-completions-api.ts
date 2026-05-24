import {
	completeSimple,
	getModels,
	getProviders,
	streamSimple,
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Context,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type Tool,
	type ToolCall,
} from "@pie-lab/ai";
import { AuthStorage } from "@pie-lab/coding-agent/auth-storage";
import { getAgentDir } from "@pie-lab/coding-agent/config";
import { ModelRegistry } from "@pie-lab/coding-agent/model-registry";
import {
	checkFallbackError,
	compressPayloadWithRtk,
	extractProviderResetCooldownMs,
	PIE_LAB_ROUTER_MODEL_IDS,
	resolvePiModelRoutePlan,
	type PiModelCatalog,
	type PiRouterPolicy,
	type RtkStats,
	type ResolvedPiModelRoute,
	type ResolvedPiModelRoutePlan,
} from "@pie-lab/router";
import {
	createJsonProviderConnectionStore,
	createUsageRecordId,
	type UsageCost,
	type UsageRecord,
	type UsageTraceEvent,
	type UsageTokenSaver,
	type UsageStore,
	type UsageTokens,
	type ProviderConnectionSettings,
	type ProviderConnectionStore,
} from "@pie-lab/storage";
import { createQuotaAwareProviderConnectionPreparer } from "@pie-lab/shared";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
	budgetViolationMessage,
	createBudgetLimitErrorBody,
	evaluateBudget,
	estimateModelRequestCostUsd,
	type BudgetStatus,
} from "./budget-policy.js";

export type ChatCompletionExecutor = (
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export type ChatCompletionStreamExecutor = (
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
) => AsyncIterable<AssistantMessageEvent>;

export interface ChatCompletionRequestAuth {
	apiKey?: string;
	headers?: Record<string, string>;
	connectionId?: string;
	markUnavailable?: (error: unknown) => void | Promise<void>;
	clearUnavailable?: () => void | Promise<void>;
}

export type ChatCompletionAuthResolver = (model: Model<Api>) => Promise<ChatCompletionRequestAuth>;

export type ChatCompletionRouterPolicyResolver = () => PiRouterPolicy | Promise<PiRouterPolicy>;

export interface ChatCompletionsApiOptions {
	catalog?: PiModelCatalog<Model<Api>>;
	modelRegistry?: ModelRegistry;
	routerPolicy?: PiRouterPolicy | ChatCompletionRouterPolicyResolver;
	authResolver?: ChatCompletionAuthResolver;
	executor?: ChatCompletionExecutor;
	streamExecutor?: ChatCompletionStreamExecutor;
	usageStore?: UsageStore;
	providerConnectionStore?: ProviderConnectionStore;
	now?: () => Date;
	requestIdFactory?: () => string;
}

interface OpenAIChatCompletionRequest {
	model?: unknown;
	messages?: unknown;
	stream?: unknown;
	temperature?: unknown;
	max_tokens?: unknown;
	max_completion_tokens?: unknown;
	reasoning_effort?: unknown;
	tools?: unknown;
}

interface OpenAIChatMessage {
	role: string;
	content?: unknown;
	tool_call_id?: unknown;
	name?: unknown;
	tool_calls?: unknown;
}

interface OpenAIContentPart {
	type?: unknown;
	text?: unknown;
	image_url?: unknown;
}

interface AttemptError {
	provider: string;
	model: string;
	message: string;
	status?: number;
	should_fallback?: boolean;
	cooldown_ms?: number;
}

interface AttemptFallbackDecision {
	shouldFallback: boolean;
	cooldownMs: number;
	statusCode?: number;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization, x-pie-client-origin, x-pie-origin",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_ENDPOINT = "/v1/chat/completions";
const MAX_USAGE_TRACE_EVENTS = 200;

export function createChatCompletionsRequestHandler(options: ChatCompletionsApiOptions = {}) {
	const modelRegistry = options.modelRegistry ?? (options.catalog ? undefined : createDefaultModelRegistry());
	const catalog = options.catalog ?? modelRegistry ?? createDefaultModelCatalog();
	const authResolver = options.authResolver ?? (modelRegistry ? createModelRegistryAuthResolver(modelRegistry) : undefined);
	const executor = options.executor ?? defaultChatCompletionExecutor;
	const streamExecutor = options.streamExecutor ?? defaultChatCompletionStreamExecutor;
	const now = options.now ?? (() => new Date());
	const requestIdFactory = options.requestIdFactory ?? (() => `chatcmpl_${randomUUID()}`);

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleChatCompletionsRequest(request, response, {
				catalog,
				authResolver,
				executor,
				streamExecutor,
				usageStore: options.usageStore,
				providerConnectionStore: options.providerConnectionStore,
				routerPolicy: options.routerPolicy,
				now,
				requestIdFactory,
			});
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
					type: "server_error",
				},
			});
		}
	};
}

export async function handleChatCompletionsRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: Required<Pick<ChatCompletionsApiOptions, "catalog" | "executor" | "streamExecutor" | "now" | "requestIdFactory">> &
		Pick<ChatCompletionsApiOptions, "authResolver"> &
		Pick<ChatCompletionsApiOptions, "usageStore" | "providerConnectionStore" | "routerPolicy">,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

	if (url.pathname === "/v1/models" || url.pathname === "/models") {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response);
			return;
		}

		writeJson(response, 200, createModelsResponse(options.catalog));
		return;
	}

	if (url.pathname !== DEFAULT_ENDPOINT) {
		writeJson(response, 404, {
			error: {
				message: "Not found",
				path: url.pathname,
			},
		});
		return;
	}

	if (request.method !== "POST") {
		writeMethodNotAllowed(response);
		return;
	}

	const requestId = options.requestIdFactory();
	const clientOrigin = normalizeClientOriginHeader(
		request.headers["x-pie-client-origin"] ?? request.headers["x-pie-origin"],
	);
	const body = await readJsonBody<OpenAIChatCompletionRequest>(request);
	const validationError = validateChatCompletionRequest(body);
	if (validationError) {
		writeJson(response, 400, {
			error: {
				message: validationError,
				type: "invalid_request_error",
			},
		});
		return;
	}

	const requestedModel = body.model as string;
	const context = openAiMessagesToContext(body.messages as OpenAIChatMessage[]);
	const tools = openAiToolsToPiTools(body.tools);
	if (tools.length > 0) {
		context.tools = tools;
	}

	let plan;
	try {
		plan = await resolvePiModelRoutePlan({
			requestedModel,
			catalog: options.catalog,
			policy: await resolveRouterPolicy(options.routerPolicy),
		});
	} catch (error) {
		writeJson(response, 400, {
			error: {
				message: error instanceof Error ? error.message : "Model routing failed",
				type: "invalid_request_error",
			},
		});
		return;
	}

	const budgetSettings = options.providerConnectionStore ? await options.providerConnectionStore.getSettings() : undefined;

	if (body.stream === true) {
		await handleStreamingChatCompletion({
			response,
			body,
			context,
			plan,
			requestId,
			streamExecutor: options.streamExecutor,
			authResolver: options.authResolver,
			usageStore: options.usageStore,
			budgetSettings,
			clientOrigin,
			now: options.now,
		});
		return;
	}

	const attemptErrors: AttemptError[] = [];

	for (let attemptIndex = 0; attemptIndex < plan.routes.length; attemptIndex++) {
		const route = plan.routes[attemptIndex];
		const timestamp = options.now().toISOString();
		const canFallback = attemptIndex < plan.routes.length - 1;
		let auth: ChatCompletionRequestAuth | undefined;
		const tokenSaverStats: RtkStats[] = [];
		const trace = createAttemptTrace(timestamp, plan, route, attemptIndex);
		const budgetStatus = await evaluateChatRouteBudget({
			settings: budgetSettings,
			usageStore: options.usageStore,
			route,
			body,
			now: options.now(),
		});
		appendAttemptTrace(trace, options.now().toISOString(), "budget.check", route, attemptIndex, {
			status: budgetStatus?.mode ?? "off",
			metadata: {
				shouldBlock: budgetStatus?.shouldBlock ?? false,
				estimatedRequestUsd: budgetStatus?.estimatedRequestUsd ?? null,
			},
		});
		if (budgetStatus?.shouldBlock) {
			appendAttemptTrace(trace, options.now().toISOString(), "budget.block", route, attemptIndex, {
				status: "skipped",
				message: budgetViolationMessage(budgetStatus),
			});
			attemptErrors.push(toBudgetAttemptError(route, budgetStatus, canFallback));
			await recordBudgetSkippedUsage(options.usageStore, {
				requestId,
				timestamp,
				plan,
				route,
				attemptIndex,
				budgetStatus,
				trace,
				clientOrigin,
			});
			if (canFallback) continue;
			writeJson(
				response,
				402,
				createBudgetLimitErrorBody({
					requestId,
					requestedModel: plan.requestedModel,
					routingMode: plan.routingMode,
					status: budgetStatus,
					attempts: attemptErrors,
				}),
			);
			return;
		}

		try {
			const result = await executeChatCompletion(
				options.executor,
				options.authResolver,
				route.model,
				context,
				withRtkTokenSaver(createSimpleStreamOptions(body), tokenSaverStats),
			);
			auth = result.auth;
			const assistant = result.assistant;
			const status = assistant.stopReason === "error" ? "error" : assistant.stopReason === "aborted" ? "aborted" : "success";
			appendAttemptTrace(trace, options.now().toISOString(), "auth.resolved", route, attemptIndex, {
				connectionId: getAttemptConnectionId(route, auth),
			});
			appendAttemptTrace(trace, options.now().toISOString(), "upstream.complete", route, attemptIndex, {
				status,
				message: assistant.errorMessage,
				metadata: { stopReason: assistant.stopReason },
				connectionId: getAttemptConnectionId(route, auth),
			});
			await updateAttemptConnectionState(auth, status, assistant.errorMessage ?? assistant);

			const fallback =
				status === "success"
					? undefined
					: getAttemptFallbackDecision({
							canFallback,
							error: assistant.errorMessage ?? `Model stopped with ${assistant.stopReason}`,
							aborted: status === "aborted",
						});
			if (fallback) {
				appendAttemptTrace(trace, options.now().toISOString(), "fallback.decision", route, attemptIndex, {
					status: fallback.shouldFallback ? "fallback" : "stop",
					metadata: {
						shouldFallback: fallback.shouldFallback,
						cooldownMs: fallback.cooldownMs,
						statusCode: fallback.statusCode,
					},
					connectionId: getAttemptConnectionId(route, auth),
				});
			}

			await recordUsage(options.usageStore, {
				id: createUsageRecordId(),
				requestId,
				timestamp,
				requestedModel: plan.requestedModel,
				routingMode: plan.routingMode,
				routeSource: route.route.source,
				resolvedProvider: route.route.resolvedProvider,
				resolvedModel: route.route.resolvedModel,
				connectionId: getAttemptConnectionId(route, auth),
				attemptIndex,
				attemptCount: plan.routes.length,
				endpoint: DEFAULT_ENDPOINT,
				clientOrigin,
				usage: toUsageTokens(assistant),
				cost: toUsageCost(assistant),
				tokenSaver: toUsageTokenSaver(tokenSaverStats),
				inputTokens: assistant.usage?.input,
				outputTokens: assistant.usage?.output,
				costUsd: assistant.usage?.cost.total,
				status,
				errorMessage: assistant.errorMessage,
				trace,
			});

			if (status === "success") {
				writeJson(response, 200, createChatCompletionResponse({ requestId, assistant, route, requestedModel: plan.requestedModel }));
				return;
			}

			const message = assistant.errorMessage ?? `Model stopped with ${assistant.stopReason}`;
			const fallbackDecision =
				fallback ??
				getAttemptFallbackDecision({
					canFallback,
					error: message,
					aborted: status === "aborted",
				});
			attemptErrors.push(toAttemptError(route, message, fallbackDecision));
			if (fallbackDecision.shouldFallback) continue;
			break;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const fallback = getAttemptFallbackDecision({ canFallback, error });
			appendAttemptTrace(trace, options.now().toISOString(), "upstream.error", route, attemptIndex, {
				status: "error",
				message,
				metadata: { statusCode: fallback.statusCode },
				connectionId: getAttemptConnectionId(route, auth),
			});
			appendAttemptTrace(trace, options.now().toISOString(), "fallback.decision", route, attemptIndex, {
				status: fallback.shouldFallback ? "fallback" : "stop",
				metadata: {
					shouldFallback: fallback.shouldFallback,
					cooldownMs: fallback.cooldownMs,
					statusCode: fallback.statusCode,
				},
				connectionId: getAttemptConnectionId(route, auth),
			});
			attemptErrors.push(toAttemptError(route, message, fallback));
			await auth?.markUnavailable?.(error);

			await recordUsage(options.usageStore, {
				id: createUsageRecordId(),
				requestId,
				timestamp,
				requestedModel: plan.requestedModel,
				routingMode: plan.routingMode,
				routeSource: route.route.source,
				resolvedProvider: route.route.resolvedProvider,
				resolvedModel: route.route.resolvedModel,
				connectionId: getAttemptConnectionId(route, auth),
				attemptIndex,
				attemptCount: plan.routes.length,
				endpoint: DEFAULT_ENDPOINT,
				clientOrigin,
				tokenSaver: toUsageTokenSaver(tokenSaverStats),
				status: "error",
				errorCode: fallback.statusCode,
				errorMessage: message,
				trace,
			});

			if (fallback.shouldFallback) continue;
			break;
		}
	}

	writeJson(response, 502, {
		error: {
			message: "All routed model attempts failed.",
			type: "upstream_error",
		},
		pi_adk: {
			request_id: requestId,
			requested_model: plan.requestedModel,
			routing_mode: plan.routingMode,
			attempts: attemptErrors,
		},
	});
}

async function resolveRouterPolicy(
	routerPolicy: ChatCompletionsApiOptions["routerPolicy"] | undefined,
): Promise<PiRouterPolicy | undefined> {
	if (!routerPolicy) return undefined;
	if (typeof routerPolicy === "function") return routerPolicy();
	return routerPolicy;
}

async function handleStreamingChatCompletion(options: {
	response: ServerResponse;
	body: OpenAIChatCompletionRequest;
	context: Context;
	plan: ResolvedPiModelRoutePlan<Model<Api>>;
	requestId: string;
	streamExecutor: ChatCompletionStreamExecutor;
	authResolver?: ChatCompletionAuthResolver;
	usageStore?: UsageStore;
	budgetSettings?: ProviderConnectionSettings;
	clientOrigin?: string;
	now: () => Date;
}): Promise<void> {
	const attemptErrors: AttemptError[] = [];
	const streamOptions = createSimpleStreamOptions(options.body);

	for (let attemptIndex = 0; attemptIndex < options.plan.routes.length; attemptIndex++) {
		const route = options.plan.routes[attemptIndex];
		const timestamp = options.now().toISOString();
		const canFallback = attemptIndex < options.plan.routes.length - 1;
		let sseStarted = false;
		let visibleChunkSent = false;
		let continueToNextAttempt = false;
		let terminalFailureBeforeStream: string | undefined;
		let auth: ChatCompletionRequestAuth | undefined;
		const tokenSaverStats: RtkStats[] = [];
		const trace = createAttemptTrace(timestamp, options.plan, route, attemptIndex);
		const budgetStatus = await evaluateChatRouteBudget({
			settings: options.budgetSettings,
			usageStore: options.usageStore,
			route,
			body: options.body,
			now: options.now(),
		});
		appendAttemptTrace(trace, options.now().toISOString(), "budget.check", route, attemptIndex, {
			status: budgetStatus?.mode ?? "off",
			metadata: {
				shouldBlock: budgetStatus?.shouldBlock ?? false,
				estimatedRequestUsd: budgetStatus?.estimatedRequestUsd ?? null,
			},
		});
		if (budgetStatus?.shouldBlock) {
			appendAttemptTrace(trace, options.now().toISOString(), "budget.block", route, attemptIndex, {
				status: "skipped",
				message: budgetViolationMessage(budgetStatus),
			});
			attemptErrors.push(toBudgetAttemptError(route, budgetStatus, canFallback));
			await recordBudgetSkippedUsage(options.usageStore, {
				requestId: options.requestId,
				timestamp,
				plan: options.plan,
				route,
				attemptIndex,
				budgetStatus,
				trace,
				clientOrigin: options.clientOrigin,
			});
			if (canFallback) continue;
			writeJson(
				options.response,
				402,
				createBudgetLimitErrorBody({
					requestId: options.requestId,
					requestedModel: options.plan.requestedModel,
					routingMode: options.plan.routingMode,
					status: budgetStatus,
					attempts: attemptErrors,
				}),
			);
			return;
		}

		const startSse = () => {
			if (sseStarted) {
				return;
			}
			writeSseHeaders(options.response);
			sseStarted = true;
		};

		const writeRoleChunk = async () => {
			if (visibleChunkSent) {
				return;
			}
			startSse();
			await writeSse(
				options.response,
				createChatCompletionChunk({
					requestId: options.requestId,
					route,
					requestedModel: options.plan.requestedModel,
					delta: { role: "assistant" },
					finishReason: null,
				}),
			);
			visibleChunkSent = true;
		};

		try {
			auth = options.authResolver ? await options.authResolver(route.model) : undefined;
			appendAttemptTrace(trace, options.now().toISOString(), "auth.resolved", route, attemptIndex, {
				connectionId: getAttemptConnectionId(route, auth),
			});
			const stream = options.streamExecutor(
				route.model,
				options.context,
				mergeRequestAuth(withRtkTokenSaver(streamOptions, tokenSaverStats), auth),
			);
			appendAttemptTrace(trace, options.now().toISOString(), "stream.open", route, attemptIndex, {
				connectionId: getAttemptConnectionId(route, auth),
			});

			for await (const event of stream) {
				appendAttemptTrace(trace, options.now().toISOString(), "stream.event", route, attemptIndex, {
					metadata: streamEventTraceMetadata(event),
					connectionId: getAttemptConnectionId(route, auth),
				});
				if (event.type === "text_delta") {
					await writeRoleChunk();
					await writeSse(
						options.response,
						createChatCompletionChunk({
							requestId: options.requestId,
							route,
							requestedModel: options.plan.requestedModel,
							delta: { content: event.delta },
							finishReason: null,
						}),
					);
					continue;
				}

				if (event.type === "toolcall_end") {
					await writeRoleChunk();
					await writeSse(
						options.response,
						createChatCompletionChunk({
							requestId: options.requestId,
							route,
							requestedModel: options.plan.requestedModel,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: event.toolCall.id,
										type: "function",
										function: {
											name: event.toolCall.name,
											arguments: JSON.stringify(event.toolCall.arguments),
										},
									},
								],
							},
							finishReason: null,
						}),
					);
					continue;
				}

				if (event.type === "done") {
					await auth?.clearUnavailable?.();
					appendAttemptTrace(trace, options.now().toISOString(), "attempt.success", route, attemptIndex, {
						status: "success",
						metadata: { stopReason: event.reason },
						connectionId: getAttemptConnectionId(route, auth),
					});
					await recordUsage(options.usageStore, {
						id: createUsageRecordId(),
						requestId: options.requestId,
						timestamp,
						requestedModel: options.plan.requestedModel,
						routingMode: options.plan.routingMode,
						routeSource: route.route.source,
						resolvedProvider: route.route.resolvedProvider,
						resolvedModel: route.route.resolvedModel,
						connectionId: getAttemptConnectionId(route, auth),
						attemptIndex,
						attemptCount: options.plan.routes.length,
						endpoint: DEFAULT_ENDPOINT,
						clientOrigin: options.clientOrigin,
						usage: toUsageTokens(event.message),
						cost: toUsageCost(event.message),
						tokenSaver: toUsageTokenSaver(tokenSaverStats),
						inputTokens: event.message.usage?.input,
						outputTokens: event.message.usage?.output,
						costUsd: event.message.usage?.cost.total,
						status: "success",
						trace,
					});

					await writeRoleChunk();
					await writeSse(
						options.response,
						createChatCompletionChunk({
							requestId: options.requestId,
							route,
							requestedModel: options.plan.requestedModel,
							delta: {},
							finishReason: toOpenAIFinishReason(event.message),
						}),
					);
					await writeSseDone(options.response);
					options.response.end();
					return;
				}

				if (event.type === "error") {
					const status = event.reason === "aborted" ? "aborted" : "error";
					const message = event.error.errorMessage ?? `Model stopped with ${event.reason}`;
					const fallback = getAttemptFallbackDecision({
						canFallback,
						error: message,
						aborted: event.reason === "aborted",
					});
					appendAttemptTrace(trace, options.now().toISOString(), "attempt.error", route, attemptIndex, {
						status,
						message,
						metadata: { reason: event.reason, statusCode: fallback.statusCode },
						connectionId: getAttemptConnectionId(route, auth),
					});
					appendAttemptTrace(trace, options.now().toISOString(), "fallback.decision", route, attemptIndex, {
						status: fallback.shouldFallback ? "fallback" : "stop",
						metadata: {
							shouldFallback: fallback.shouldFallback,
							cooldownMs: fallback.cooldownMs,
							statusCode: fallback.statusCode,
						},
						connectionId: getAttemptConnectionId(route, auth),
					});
					await updateAttemptConnectionState(auth, status, event.error);

					await recordUsage(options.usageStore, {
						id: createUsageRecordId(),
						requestId: options.requestId,
						timestamp,
						requestedModel: options.plan.requestedModel,
						routingMode: options.plan.routingMode,
						routeSource: route.route.source,
						resolvedProvider: route.route.resolvedProvider,
						resolvedModel: route.route.resolvedModel,
						connectionId: getAttemptConnectionId(route, auth),
						attemptIndex,
						attemptCount: options.plan.routes.length,
						endpoint: DEFAULT_ENDPOINT,
						clientOrigin: options.clientOrigin,
						usage: toUsageTokens(event.error),
						cost: toUsageCost(event.error),
						tokenSaver: toUsageTokenSaver(tokenSaverStats),
						inputTokens: event.error.usage?.input,
						outputTokens: event.error.usage?.output,
						costUsd: event.error.usage?.cost.total,
						status,
						errorCode: fallback.statusCode,
						errorMessage: message,
						trace,
					});

					if (!visibleChunkSent) {
						attemptErrors.push(toAttemptError(route, message, fallback));
						if (fallback.shouldFallback) {
							continueToNextAttempt = true;
						} else {
							terminalFailureBeforeStream = message;
						}
						break;
					}

					await writeSseError(options.response, message);
					await writeSseDone(options.response);
					options.response.end();
					return;
				}
			}

			if (continueToNextAttempt) {
				continue;
			}

			if (terminalFailureBeforeStream) {
				writeRoutedFailureJson(options.response, {
					message: terminalFailureBeforeStream,
					requestId: options.requestId,
					plan: options.plan,
					attemptErrors,
				});
				return;
			}

			const message = "Stream ended without a terminal event.";
			const fallback = getAttemptFallbackDecision({ canFallback, error: message });
			appendAttemptTrace(trace, options.now().toISOString(), "stream.error", route, attemptIndex, {
				status: "error",
				message,
				connectionId: getAttemptConnectionId(route, auth),
			});
			appendAttemptTrace(trace, options.now().toISOString(), "fallback.decision", route, attemptIndex, {
				status: fallback.shouldFallback ? "fallback" : "stop",
				metadata: {
					shouldFallback: fallback.shouldFallback,
					cooldownMs: fallback.cooldownMs,
					statusCode: fallback.statusCode,
				},
				connectionId: getAttemptConnectionId(route, auth),
			});
			attemptErrors.push(toAttemptError(route, message, fallback));
			await auth?.markUnavailable?.(message);

			await recordUsage(options.usageStore, {
				id: createUsageRecordId(),
				requestId: options.requestId,
				timestamp,
				requestedModel: options.plan.requestedModel,
				routingMode: options.plan.routingMode,
				routeSource: route.route.source,
				resolvedProvider: route.route.resolvedProvider,
				resolvedModel: route.route.resolvedModel,
				connectionId: getAttemptConnectionId(route, auth),
				attemptIndex,
				attemptCount: options.plan.routes.length,
				endpoint: DEFAULT_ENDPOINT,
				clientOrigin: options.clientOrigin,
				tokenSaver: toUsageTokenSaver(tokenSaverStats),
				status: "error",
				errorCode: fallback.statusCode,
				errorMessage: message,
				trace,
			});

			if (!visibleChunkSent && fallback.shouldFallback) {
				continue;
			}

			if (visibleChunkSent) {
				await writeSseError(options.response, message);
				await writeSseDone(options.response);
				options.response.end();
				return;
			}

			writeRoutedFailureJson(options.response, {
				message,
				requestId: options.requestId,
				plan: options.plan,
				attemptErrors,
			});
			return;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const fallback = getAttemptFallbackDecision({ canFallback, error });
			appendAttemptTrace(trace, options.now().toISOString(), "upstream.error", route, attemptIndex, {
				status: "error",
				message,
				metadata: { statusCode: fallback.statusCode },
				connectionId: getAttemptConnectionId(route, auth),
			});
			appendAttemptTrace(trace, options.now().toISOString(), "fallback.decision", route, attemptIndex, {
				status: fallback.shouldFallback ? "fallback" : "stop",
				metadata: {
					shouldFallback: fallback.shouldFallback,
					cooldownMs: fallback.cooldownMs,
					statusCode: fallback.statusCode,
				},
				connectionId: getAttemptConnectionId(route, auth),
			});
			attemptErrors.push(toAttemptError(route, message, fallback));
			await auth?.markUnavailable?.(error);

			await recordUsage(options.usageStore, {
				id: createUsageRecordId(),
				requestId: options.requestId,
				timestamp,
				requestedModel: options.plan.requestedModel,
				routingMode: options.plan.routingMode,
				routeSource: route.route.source,
				resolvedProvider: route.route.resolvedProvider,
				resolvedModel: route.route.resolvedModel,
				connectionId: getAttemptConnectionId(route, auth),
				attemptIndex,
				attemptCount: options.plan.routes.length,
				endpoint: DEFAULT_ENDPOINT,
				clientOrigin: options.clientOrigin,
				tokenSaver: toUsageTokenSaver(tokenSaverStats),
				status: "error",
				errorCode: fallback.statusCode,
				errorMessage: message,
				trace,
			});

			if (visibleChunkSent) {
				await writeSseError(options.response, message);
				await writeSseDone(options.response);
				options.response.end();
				return;
			}

			if (fallback.shouldFallback) continue;

			writeRoutedFailureJson(options.response, {
				message,
				requestId: options.requestId,
				plan: options.plan,
				attemptErrors,
			});
			return;
		}
	}

	writeJson(options.response, 502, {
		error: {
			message: "All routed model attempts failed before streaming began.",
			type: "upstream_error",
		},
		pi_adk: {
			request_id: options.requestId,
			requested_model: options.plan.requestedModel,
			routing_mode: options.plan.routingMode,
			attempts: attemptErrors,
		},
	});
}

function getAttemptFallbackDecision(options: {
	canFallback: boolean;
	error: unknown;
	aborted?: boolean;
}): AttemptFallbackDecision {
	const statusCode = extractStatusCode(options.error);
	if (!options.canFallback || options.aborted === true) {
		return { shouldFallback: false, cooldownMs: 0, statusCode };
	}

	const resetCooldownMs = extractProviderResetCooldownMs(options.error);
	if (resetCooldownMs !== null) {
		return { shouldFallback: true, cooldownMs: resetCooldownMs, statusCode };
	}

	const decision = checkFallbackError(statusCode, errorText(options.error));
	return {
		shouldFallback: decision.shouldFallback,
		cooldownMs: decision.cooldownMs,
		statusCode,
	};
}

function toAttemptError(route: ResolvedPiModelRoute<Model<Api>>, message: string, fallback: AttemptFallbackDecision): AttemptError {
	return {
		provider: route.route.resolvedProvider,
		model: route.route.resolvedModel,
		message,
		...(fallback.statusCode !== undefined ? { status: fallback.statusCode } : {}),
		should_fallback: fallback.shouldFallback,
		cooldown_ms: fallback.cooldownMs,
	};
}

async function evaluateChatRouteBudget(options: {
	settings?: ProviderConnectionSettings;
	usageStore?: UsageStore;
	route: ResolvedPiModelRoute<Model<Api>>;
	body: OpenAIChatCompletionRequest;
	now: Date;
}): Promise<BudgetStatus | null> {
	if (!options.settings) return null;
	return evaluateBudget({
		settings: options.settings,
		usageStore: options.usageStore,
		provider: options.route.route.resolvedProvider,
		estimatedRequestUsd: estimateChatRequestCostUsd(options.route.model, options.body),
		now: options.now,
	});
}

function estimateChatRequestCostUsd(model: Model<Api>, body: OpenAIChatCompletionRequest): number | null {
	return estimateModelRequestCostUsd({
		model,
		inputTokens: estimateOpenAiInputTokens(body.messages),
		outputTokens: requestedOutputTokens(body),
	});
}

function estimateOpenAiInputTokens(messages: unknown): number | null {
	if (!Array.isArray(messages)) return null;
	const text = JSON.stringify(messages);
	return Math.max(1, Math.ceil(text.length / 4));
}

function requestedOutputTokens(body: OpenAIChatCompletionRequest): number | null {
	const value = typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : body.max_tokens;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function toBudgetAttemptError(
	route: ResolvedPiModelRoute<Model<Api>>,
	status: BudgetStatus,
	canFallback: boolean,
): AttemptError {
	return {
		provider: route.route.resolvedProvider,
		model: route.route.resolvedModel,
		message: budgetViolationMessage(status),
		status: 402,
		should_fallback: canFallback,
		cooldown_ms: 0,
	};
}

function createAttemptTrace(
	timestamp: string,
	plan: ResolvedPiModelRoutePlan<Model<Api>>,
	route: ResolvedPiModelRoute<Model<Api>>,
	attemptIndex: number,
): UsageTraceEvent[] {
	return [
		{
			timestamp,
			phase: "attempt.start",
			message: "Routed attempt started.",
			provider: route.route.resolvedProvider,
			model: route.route.resolvedModel,
			connectionId: route.route.connectionId,
			attemptIndex,
			status: "started",
			metadata: {
				requestedModel: plan.requestedModel,
				routingMode: plan.routingMode,
				routeSource: route.route.source,
				attemptCount: plan.routes.length,
			},
		},
	];
}

function appendAttemptTrace(
	trace: UsageTraceEvent[],
	timestamp: string,
	phase: string,
	route: ResolvedPiModelRoute<Model<Api>>,
	attemptIndex: number,
	options: {
		message?: string;
		status?: string;
		connectionId?: string;
		metadata?: Record<string, unknown>;
	} = {},
): void {
	if (trace.length >= MAX_USAGE_TRACE_EVENTS) {
		const last = trace.at(-1);
		if (last?.phase !== "trace.truncated") {
			trace.push({
				timestamp,
				phase: "trace.truncated",
				message: `Trace exceeded ${MAX_USAGE_TRACE_EVENTS} events.`,
				provider: route.route.resolvedProvider,
				model: route.route.resolvedModel,
				connectionId: options.connectionId ?? route.route.connectionId,
				attemptIndex,
				status: "truncated",
			});
		}
		return;
	}

	trace.push({
		timestamp,
		phase,
		provider: route.route.resolvedProvider,
		model: route.route.resolvedModel,
		connectionId: options.connectionId ?? route.route.connectionId,
		attemptIndex,
		...(options.message ? { message: options.message } : {}),
		...(options.status ? { status: options.status } : {}),
		...(options.metadata ? { metadata: compactTraceMetadata(options.metadata) } : {}),
	});
}

function compactTraceMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined));
}

function streamEventTraceMetadata(event: AssistantMessageEvent): Record<string, unknown> {
	const eventType = event.type;
	if (event.type === "text_delta") {
		return { eventType, deltaLength: event.delta.length };
	}
	if (event.type === "toolcall_end") {
		return { eventType, toolName: event.toolCall.name, toolCallId: event.toolCall.id };
	}
	if (event.type === "done") {
		return { eventType, reason: event.reason, stopReason: event.message.stopReason };
	}
	if (event.type === "error") {
		return { eventType, reason: event.reason, errorMessage: event.error.errorMessage };
	}
	return { eventType };
}

async function recordBudgetSkippedUsage(
	usageStore: UsageStore | undefined,
	options: {
		requestId: string;
		timestamp: string;
		plan: ResolvedPiModelRoutePlan<Model<Api>>;
		route: ResolvedPiModelRoute<Model<Api>>;
		attemptIndex: number;
		budgetStatus: BudgetStatus;
		trace: UsageTraceEvent[];
		clientOrigin?: string;
	},
): Promise<void> {
	await recordUsage(usageStore, {
		id: createUsageRecordId(),
		requestId: options.requestId,
		timestamp: options.timestamp,
		requestedModel: options.plan.requestedModel,
		routingMode: options.plan.routingMode,
		routeSource: options.route.route.source,
		resolvedProvider: options.route.route.resolvedProvider,
		resolvedModel: options.route.route.resolvedModel,
		connectionId: options.route.route.connectionId,
		attemptIndex: options.attemptIndex,
		attemptCount: options.plan.routes.length,
		endpoint: DEFAULT_ENDPOINT,
		clientOrigin: options.clientOrigin,
		status: "skipped",
		errorCode: "budget_limit_exceeded",
		errorMessage: budgetViolationMessage(options.budgetStatus),
		trace: options.trace,
	});
}

function writeRoutedFailureJson(
	response: ServerResponse,
	options: {
		message: string;
		requestId: string;
		plan: ResolvedPiModelRoutePlan<Model<Api>>;
		attemptErrors: AttemptError[];
	},
): void {
	writeJson(response, 502, {
		error: {
			message: options.message,
			type: "upstream_error",
		},
		pi_adk: {
			request_id: options.requestId,
			requested_model: options.plan.requestedModel,
			routing_mode: options.plan.routingMode,
			attempts: options.attemptErrors,
		},
	});
}

export function createDefaultModelCatalog(): PiModelCatalog<Model<Api>> {
	const models = getProviders().flatMap((provider) => getModels(provider) as Model<Api>[]);

	return {
		find(provider, modelId) {
			return models.find((model) => model.provider === provider && model.id === modelId);
		},
		getAvailable() {
			return models;
		},
		getAll() {
			return models;
		},
	};
}

export function createDefaultModelRegistry(agentDir = getAgentDir()): ModelRegistry {
	const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
	const providerConnectionStore = createJsonProviderConnectionStore(join(agentDir, "provider-connections.json"));
	return ModelRegistry.create(authStorage, join(agentDir, "models.json"), {
		providerConnectionStore,
		prepareProviderConnections: createQuotaAwareProviderConnectionPreparer({
			providerConnectionStore,
		}),
	});
}

export function createModelRegistryAuthResolver(modelRegistry: ModelRegistry): ChatCompletionAuthResolver {
	return async (model) => {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			throw new Error(auth.error);
		}

		return {
			apiKey: auth.apiKey,
			headers: auth.headers,
			connectionId: auth.connectionId,
			markUnavailable: (error) => modelRegistry.markProviderConnectionUnavailable(auth.connectionId, model, error),
			clearUnavailable: () => modelRegistry.clearProviderConnectionError(auth.connectionId, model),
		};
	};
}

async function defaultChatCompletionExecutor(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
): Promise<AssistantMessage> {
	return completeSimple(model, context, options);
}

function defaultChatCompletionStreamExecutor(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
): AsyncIterable<AssistantMessageEvent> {
	return streamSimple(model, context, options);
}

async function executeChatCompletion(
	executor: ChatCompletionExecutor,
	authResolver: ChatCompletionAuthResolver | undefined,
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions,
): Promise<{ assistant: AssistantMessage; auth?: ChatCompletionRequestAuth }> {
	const auth = authResolver ? await authResolver(model) : undefined;
	return {
		assistant: await executor(model, context, mergeRequestAuth(options, auth)),
		auth,
	};
}

function mergeRequestAuth(options: SimpleStreamOptions, auth: ChatCompletionRequestAuth | undefined): SimpleStreamOptions {
	if (!auth) {
		return options;
	}

	return {
		...options,
		apiKey: auth.apiKey ?? options.apiKey,
		headers: auth.headers || options.headers ? { ...options.headers, ...auth.headers } : undefined,
	};
}

function getAttemptConnectionId(
	route: ResolvedPiModelRoute<Model<Api>>,
	auth: ChatCompletionRequestAuth | undefined,
): string | undefined {
	return auth?.connectionId ?? route.route.connectionId;
}

async function updateAttemptConnectionState(
	auth: ChatCompletionRequestAuth | undefined,
	status: UsageRecord["status"],
	error: unknown,
): Promise<void> {
	if (status === "success") {
		await auth?.clearUnavailable?.();
		return;
	}

	if (status === "error") {
		await auth?.markUnavailable?.(error);
	}
}

function extractStatusCode(error: unknown): number | undefined {
	if (!error || typeof error !== "object") return undefined;
	const record = error as Record<string, unknown>;

	for (const key of ["status", "statusCode", "code"]) {
		if (typeof record[key] === "number") return record[key];
	}

	const response = record.response;
	if (response && typeof response === "object" && typeof (response as Record<string, unknown>).status === "number") {
		return (response as Record<string, number>).status;
	}

	return undefined;
}

function errorText(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String(error);
}

function validateChatCompletionRequest(body: OpenAIChatCompletionRequest): string | undefined {
	if (typeof body.model !== "string" || body.model.trim().length === 0) {
		return "model is required.";
	}
	if (!Array.isArray(body.messages)) {
		return "messages must be an array.";
	}
	if (body.messages.length === 0) {
		return "messages must contain at least one message.";
	}
	for (const message of body.messages) {
		if (!isOpenAIChatMessage(message)) {
			return "Each message must include a string role.";
		}
	}
	return undefined;
}

function createSimpleStreamOptions(body: OpenAIChatCompletionRequest): SimpleStreamOptions {
	const options: SimpleStreamOptions = {};
	if (typeof body.temperature === "number") {
		options.temperature = body.temperature;
	}

	const maxTokens = typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : body.max_tokens;
	if (typeof maxTokens === "number") {
		options.maxTokens = maxTokens;
	}

	if (isReasoningEffort(body.reasoning_effort)) {
		options.reasoning = body.reasoning_effort;
	}

	return options;
}

function withRtkTokenSaver(options: SimpleStreamOptions, statsSink: RtkStats[]): SimpleStreamOptions {
	if (process.env.PIE_LAB_RTK_ENABLED === "false" || process.env.PIE_ADK_RTK_ENABLED === "false") {
		return options;
	}

	const previousOnPayload = options.onPayload;
	return {
		...options,
		onPayload: async (payload, model) => {
			const inputPayload = previousOnPayload ? ((await previousOnPayload(payload, model)) ?? payload) : payload;
			const result = compressPayloadWithRtk(inputPayload, true);
			if (result.stats && result.stats.hits.length > 0) {
				statsSink.push(result.stats);
				if (result.logLine) console.log(result.logLine);
			}
			return result.payload;
		},
	};
}

function toUsageTokenSaver(statsList: RtkStats[]): UsageTokenSaver | undefined {
	if (statsList.length === 0) return undefined;
	const bytesBefore = statsList.reduce((sum, stats) => sum + stats.bytesBefore, 0);
	const bytesAfter = statsList.reduce((sum, stats) => sum + stats.bytesAfter, 0);
	const hits = statsList.flatMap((stats) => stats.hits);
	return {
		provider: "rtk",
		bytesBefore,
		bytesAfter,
		bytesSaved: Math.max(0, bytesBefore - bytesAfter),
		hits: hits.length,
		filters: [...new Set(hits.map((hit) => hit.filter))],
	};
}

function openAiMessagesToContext(messages: OpenAIChatMessage[]): Context {
	const systemPrompts: string[] = [];
	const contextMessages: Message[] = [];

	for (const message of messages) {
		if (message.role === "system" || message.role === "developer") {
			const text = openAiContentToText(message.content);
			if (text.length > 0) {
				systemPrompts.push(text);
			}
			continue;
		}

		if (message.role === "assistant") {
			contextMessages.push({
				role: "assistant",
				content: [
					{
						type: "text",
						text: openAiContentToText(message.content),
					},
				],
				api: "openai-completions",
				provider: "external",
				model: "external",
				usage: emptyUsage(),
				stopReason: "stop",
				timestamp: Date.now(),
			});
			continue;
		}

		if (message.role === "tool") {
			contextMessages.push({
				role: "toolResult",
				toolCallId: typeof message.tool_call_id === "string" ? message.tool_call_id : "tool",
				toolName: typeof message.name === "string" ? message.name : "tool",
				content: [{ type: "text", text: openAiContentToText(message.content) }],
				isError: false,
				timestamp: Date.now(),
			});
			continue;
		}

		contextMessages.push({
			role: "user",
			content: openAiContentToPiUserContent(message.content),
			timestamp: Date.now(),
		});
	}

	return {
		systemPrompt: systemPrompts.length > 0 ? systemPrompts.join("\n\n") : undefined,
		messages: contextMessages,
	};
}

function openAiContentToPiUserContent(content: unknown): string | Array<TextContent | ImageContent> {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}

	const blocks = content
		.map((part): TextContent | ImageContent | undefined => {
			if (!isOpenAIContentPart(part)) return undefined;
			if (part.type === "text" && typeof part.text === "string") {
				return { type: "text", text: part.text };
			}
			if (part.type === "image_url") {
				const imageUrl = getImageUrl(part.image_url);
				const image = imageUrl ? dataUrlToImageContent(imageUrl) : undefined;
				return image ?? (imageUrl ? { type: "text", text: `[image:${imageUrl}]` } : undefined);
			}
			return undefined;
		})
		.filter((block): block is TextContent | ImageContent => block !== undefined);

	return blocks.length > 0 ? blocks : "";
}

function openAiContentToText(content: unknown): string {
	const piContent = openAiContentToPiUserContent(content);
	if (typeof piContent === "string") {
		return piContent;
	}
	return piContent
		.map((block) => {
			if (block.type === "text") {
				return block.text;
			}
			return `[image:${block.mimeType}]`;
		})
		.join("\n");
}

function openAiToolsToPiTools(tools: unknown): Tool[] {
	if (!Array.isArray(tools)) {
		return [];
	}

	return tools
		.map((tool): Tool | undefined => {
			if (!tool || typeof tool !== "object" || !("type" in tool) || tool.type !== "function" || !("function" in tool)) {
				return undefined;
			}
			const fn = tool.function;
			if (!fn || typeof fn !== "object" || !("name" in fn) || typeof fn.name !== "string") {
				return undefined;
			}

			return {
				name: fn.name,
				description: "description" in fn && typeof fn.description === "string" ? fn.description : "",
				parameters: ("parameters" in fn && fn.parameters && typeof fn.parameters === "object" ? fn.parameters : { type: "object" }) as Tool["parameters"],
			};
		})
		.filter((tool): tool is Tool => tool !== undefined);
}

function createChatCompletionResponse(options: {
	requestId: string;
	assistant: AssistantMessage;
	route: ResolvedPiModelRoute<Model<Api>>;
	requestedModel: string;
}) {
	const text = assistantText(options.assistant);
	const toolCalls = assistantToolCalls(options.assistant);

	return {
		id: options.requestId,
		object: "chat.completion",
		created: Math.floor(options.assistant.timestamp / 1000),
		model: `${options.route.route.resolvedProvider}/${options.route.route.resolvedModel}`,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: toolCalls.length > 0 && text.length === 0 ? null : text,
					...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
				},
				finish_reason: toOpenAIFinishReason(options.assistant),
			},
		],
		usage: toOpenAIUsage(options.assistant),
		pi_adk: {
			requested_model: options.requestedModel,
			routing_mode: options.route.route.routingMode,
			resolved_provider: options.route.route.resolvedProvider,
			resolved_model: options.route.route.resolvedModel,
		},
	};
}

function createChatCompletionChunk(options: {
	requestId: string;
	route: ResolvedPiModelRoute<Model<Api>>;
	requestedModel: string;
	delta: Record<string, unknown>;
	finishReason: string | null;
}) {
	return {
		id: options.requestId,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: `${options.route.route.resolvedProvider}/${options.route.route.resolvedModel}`,
		choices: [
			{
				index: 0,
				delta: options.delta,
				finish_reason: options.finishReason,
			},
		],
		pi_adk: {
			requested_model: options.requestedModel,
			routing_mode: options.route.route.routingMode,
			resolved_provider: options.route.route.resolvedProvider,
			resolved_model: options.route.route.resolvedModel,
		},
	};
}

function createModelsResponse(catalog: PiModelCatalog<Model<Api>>) {
	const modelIds = new Map<string, { id: string; owned_by: string }>();

	for (const model of catalog.getAll?.() ?? catalog.getAvailable()) {
		modelIds.set(`${model.provider}/${model.id}`, {
			id: `${model.provider}/${model.id}`,
			owned_by: model.provider,
		});
	}

	for (const id of PIE_LAB_ROUTER_MODEL_IDS) {
		modelIds.set(id, { id, owned_by: "pie-lab-router" });
	}

	return {
		object: "list",
		data: [...modelIds.values()]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((model) => ({
				id: model.id,
				object: "model",
				created: 0,
				owned_by: model.owned_by,
			})),
	};
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
}

function assistantToolCalls(message: AssistantMessage) {
	return message.content
		.filter((block): block is ToolCall => block.type === "toolCall")
		.map((toolCall) => ({
			id: toolCall.id,
			type: "function",
			function: {
				name: toolCall.name,
				arguments: JSON.stringify(toolCall.arguments),
			},
		}));
}

function toOpenAIFinishReason(message: AssistantMessage): string {
	if (message.stopReason === "length") return "length";
	if (message.stopReason === "toolUse") return "tool_calls";
	if (message.stopReason === "error" || message.stopReason === "aborted") return "stop";
	return "stop";
}

function toOpenAIUsage(message: AssistantMessage) {
	const usage = message.usage;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	return {
		prompt_tokens: promptTokens,
		completion_tokens: usage.output,
		total_tokens: promptTokens + usage.output,
		prompt_tokens_details: {
			cached_tokens: usage.cacheRead,
		},
	};
}

function toUsageTokens(message: AssistantMessage): UsageTokens {
	return {
		input: message.usage.input,
		output: message.usage.output,
		cacheRead: message.usage.cacheRead,
		cacheWrite: message.usage.cacheWrite,
		totalTokens: message.usage.totalTokens,
	};
}

function toUsageCost(message: AssistantMessage): UsageCost {
	return {
		input: message.usage.cost.input,
		output: message.usage.cost.output,
		cacheRead: message.usage.cost.cacheRead,
		cacheWrite: message.usage.cost.cacheWrite,
		total: message.usage.cost.total,
		currency: "USD",
		pricingSource: "pie-metadata",
	};
}

async function recordUsage(usageStore: UsageStore | undefined, record: UsageRecord): Promise<void> {
	await usageStore?.recordUsage(record);
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

async function readJsonBody<Body>(request: IncomingMessage): Promise<Body> {
	const chunks: Buffer[] = [];
	let size = 0;

	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.byteLength;
		if (size > 2 * 1024 * 1024) {
			throw new Error("Request body is too large.");
		}
		chunks.push(buffer);
	}

	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) {
		return {} as Body;
	}

	return JSON.parse(raw) as Body;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function writeSseHeaders(response: ServerResponse): void {
	response.writeHead(200, {
		...CORS_HEADERS,
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
		"content-type": "text/event-stream; charset=utf-8",
		"x-accel-buffering": "no",
	});
	response.flushHeaders?.();
}

async function writeSse(response: ServerResponse, data: unknown): Promise<void> {
	await writeRawSse(response, `data: ${JSON.stringify(data)}\n\n`);
}

async function writeSseError(response: ServerResponse, message: string): Promise<void> {
	await writeSse(response, {
		error: {
			message,
			type: "upstream_error",
		},
	});
}

async function writeSseDone(response: ServerResponse): Promise<void> {
	await writeRawSse(response, "data: [DONE]\n\n");
}

async function writeRawSse(response: ServerResponse, chunk: string): Promise<void> {
	if (response.write(chunk)) {
		return;
	}

	await new Promise<void>((resolve) => response.once("drain", resolve));
}

function writeMethodNotAllowed(response: ServerResponse): void {
	writeJson(response, 405, {
		error: {
			message: "Method not allowed.",
			type: "invalid_request_error",
		},
	});
}

function normalizeClientOriginHeader(value: string | string[] | undefined): string | undefined {
	const raw = Array.isArray(value) ? value[0] : value;
	const normalized = raw?.trim();
	if (!normalized) return undefined;
	return normalized.slice(0, 120);
}

function isOpenAIChatMessage(value: unknown): value is OpenAIChatMessage {
	return !!value && typeof value === "object" && "role" in value && typeof value.role === "string";
}

function isOpenAIContentPart(value: unknown): value is OpenAIContentPart {
	return !!value && typeof value === "object";
}

function isReasoningEffort(value: unknown): value is SimpleStreamOptions["reasoning"] {
	return value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function getImageUrl(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
		return value.url;
	}
	return undefined;
}

function dataUrlToImageContent(value: string): ImageContent | undefined {
	const match = /^data:([^;,]+);base64,(.+)$/u.exec(value);
	if (!match) {
		return undefined;
	}

	return {
		type: "image",
		mimeType: match[1],
		data: match[2],
	};
}
