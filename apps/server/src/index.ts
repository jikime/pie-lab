import { createJsonProviderConnectionStore, createJsonlUsageStore } from "@pie-lab/storage";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createChatCompletionsRequestHandler,
	createDefaultModelRegistry,
	type ChatCompletionsApiOptions,
} from "./chat-completions-api.ts";
import { createBudgetRequestHandler, type BudgetApiOptions } from "./budget-api.ts";
import { createOAuthRequestHandler, type OAuthApiOptions } from "./oauth-api.ts";
import {
	createAccountSelectionRequestHandler,
	type AccountSelectionApiOptions,
} from "./account-selection-api.ts";
import {
	createProviderConnectionsRequestHandler,
	type ProviderConnectionsApiOptions,
} from "./provider-connections-api.ts";
import {
	createProviderSettingsRequestHandler,
	type ProviderSettingsApiOptions,
} from "./provider-settings-api.ts";
import {
	createProviderQuotaRequestHandler,
	getDefaultProviderConnectionFilePath,
	type ProviderQuotaApiOptions,
} from "./provider-quota-api.ts";
import {
	createModelAvailabilityRequestHandler,
	type ModelAvailabilityApiOptions,
} from "./model-availability-api.ts";
import { createMediaRequestHandler, type MediaApiOptions } from "./media-api.ts";
import { createLearningRequestHandler, type LearningApiOptions } from "./learning-api.ts";
import { createPieAgentChatRequestHandler, type PieAgentChatApiOptions } from "./pie-agent-chat-api.ts";
import { createProviderStatusRequestHandler } from "./provider-status-api.ts";
import { createProxyPoolRequestHandler, type ProxyPoolApiOptions } from "./proxy-pools-api.ts";
import {
	createRoutingPolicyRequestHandler,
	type RoutingPolicyApiOptions,
} from "./routing-policy-api.ts";
import { createSiteRequestHandler, isSitePath, type SiteApiOptions } from "./site-api.ts";
import { enforceRequestSecurity, resolveRequestSecurity } from "./request-security.ts";
import { createUsageRequestHandler, getDefaultUsageFilePath, type UsageApiOptions } from "./usage-api.ts";

export * from "./chat-completions-api.ts";
export * from "./account-selection-api.ts";
export * from "./budget-api.ts";
export * from "./budget-policy.ts";
export * from "./oauth-api.ts";
export * from "./media-api.ts";
export * from "./learning-api.ts";
export * from "./pie-agent-chat-api.ts";
export * from "./model-availability-api.ts";
export * from "./provider-connections-api.ts";
export * from "./provider-settings-api.ts";
export * from "./provider-quota-api.ts";
export * from "./provider-status-api.ts";
export * from "./proxy-pools-api.ts";
export * from "./routing-policy-api.ts";
export * from "./site-api.ts";
export * from "./request-security.ts";
export * from "./usage-api.ts";

export interface PieLabServerOptions
	extends UsageApiOptions,
		ChatCompletionsApiOptions,
		BudgetApiOptions,
		OAuthApiOptions,
		AccountSelectionApiOptions,
		ProviderConnectionsApiOptions,
		ProviderSettingsApiOptions,
		ProviderQuotaApiOptions,
		ModelAvailabilityApiOptions,
		MediaApiOptions,
		LearningApiOptions,
		PieAgentChatApiOptions,
		ProxyPoolApiOptions,
		RoutingPolicyApiOptions,
		SiteApiOptions {
	host?: string;
	port?: number;
	/** Extra Host header hostnames to accept (besides localhost/127.0.0.1/::1 and `host`). */
	allowedHosts?: string[];
	/** Extra browser origins to accept (besides local-hostname origins). */
	allowedOrigins?: string[];
}

export function createPieLabRequestHandler(options: PieLabServerOptions = {}) {
	const requestSecurity = resolveRequestSecurity({
		host: options.host ?? resolveServerHost(),
		allowedHosts: options.allowedHosts,
		allowedOrigins: options.allowedOrigins,
	});
	const usageStore =
		options.usageStore ?? createJsonlUsageStore(options.usageFilePath ?? getDefaultUsageFilePath());
	const modelRegistry = options.modelRegistry ?? createDefaultModelRegistry();
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());
	const chatHandler = createChatCompletionsRequestHandler({
		...options,
		modelRegistry: options.catalog ? options.modelRegistry : modelRegistry,
		usageStore,
		providerConnectionStore,
		routerPolicy:
			options.routerPolicy ??
			(async () => {
				const settings = await providerConnectionStore.getSettings();
				return settings.routerPolicy ?? {};
			}),
	});
	const providerHandler = createProviderStatusRequestHandler({ ...options, modelRegistry, providerConnectionStore });
	const accountSelectionHandler = createAccountSelectionRequestHandler({ ...options, providerConnectionStore });
	const budgetHandler = createBudgetRequestHandler({ ...options, providerConnectionStore, usageStore });
	const oauthHandler = createOAuthRequestHandler({ ...options, providerConnectionStore });
	const providerConnectionsHandler = createProviderConnectionsRequestHandler({ ...options, providerConnectionStore });
	const providerSettingsHandler = createProviderSettingsRequestHandler({ ...options, providerConnectionStore });
	const quotaHandler = createProviderQuotaRequestHandler({ ...options, providerConnectionStore });
	const modelAvailabilityHandler = createModelAvailabilityRequestHandler({ ...options, providerConnectionStore });
	const mediaHandler = createMediaRequestHandler({ ...options, providerConnectionStore, usageStore });
	const learningHandler = createLearningRequestHandler(options);
	const pieAgentChatHandler = createPieAgentChatRequestHandler({
		...options,
		modelRegistry,
		usageStore,
	});
	const proxyPoolHandler = createProxyPoolRequestHandler({ ...options, providerConnectionStore });
	const siteHandler = createSiteRequestHandler(options);
	const routingPolicyHandler = createRoutingPolicyRequestHandler({
		...options,
		providerConnectionStore,
		routingPolicyCatalog: options.catalog ?? modelRegistry,
	});
	const usageHandler = createUsageRequestHandler({ ...options, usageStore });

	return async (request: Parameters<typeof chatHandler>[0], response: Parameters<typeof chatHandler>[1]) => {
		if (!enforceRequestSecurity(request, response, requestSecurity)) {
			return;
		}
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
		if (isChatOrModelPath(url.pathname)) {
			await chatHandler(request, response);
			return;
		}
		if (isPieAgentChatPath(url.pathname)) {
			await pieAgentChatHandler(request, response);
			return;
		}
		if (isProviderPath(url.pathname)) {
			await providerHandler(request, response);
			return;
		}
		if (isAccountSelectionPath(url.pathname)) {
			await accountSelectionHandler(request, response);
			return;
		}
		if (isBudgetPath(url.pathname)) {
			await budgetHandler(request, response);
			return;
		}
		if (isOAuthPath(url.pathname)) {
			await oauthHandler(request, response);
			return;
		}
		if (isProviderConnectionPath(url.pathname)) {
			await providerConnectionsHandler(request, response);
			return;
		}
		if (isProviderSettingsPath(url.pathname)) {
			await providerSettingsHandler(request, response);
			return;
		}
		if (isModelAvailabilityPath(url.pathname)) {
			await modelAvailabilityHandler(request, response);
			return;
		}
		if (isMediaPath(url.pathname)) {
			await mediaHandler(request, response);
			return;
		}
		if (isLearningPath(url.pathname)) {
			await learningHandler(request, response);
			return;
		}
		if (isQuotaPath(url.pathname)) {
			await quotaHandler(request, response);
			return;
		}
		if (isProxyPoolPath(url.pathname)) {
			await proxyPoolHandler(request, response);
			return;
		}
		if (isRoutingPolicyPath(url.pathname)) {
			await routingPolicyHandler(request, response);
			return;
		}
		if (isSitePath(url.pathname)) {
			await siteHandler(request, response);
			return;
		}

		await usageHandler(request, response);
	};
}

export function startServer(options: PieLabServerOptions = {}): Server {
	const host = options.host ?? resolveServerHost();
	const port = options.port ?? resolveServerPort();
	const server = createServer(createPieLabRequestHandler(options));

	server.listen(port, host);
	return server;
}

if (isCliEntrypoint()) {
	const host = resolveServerHost();
	const port = resolveServerPort();
	const server = startServer({ host, port });

	server.on("listening", () => {
		console.log(`pie-lab server listening on http://${host}:${port}`);
		console.log(`usage file: ${getDefaultUsageFilePath()}`);
	});

	server.on("error", (error) => {
		console.error(error);
		process.exitCode = 1;
	});
}

function resolveServerHost(): string {
	return process.env.PIE_LAB_SERVER_HOST ?? process.env.PIE_ADK_SERVER_HOST ?? "127.0.0.1";
}

function resolveServerPort(): number {
	return parsePort(process.env.PIE_LAB_SERVER_PORT ?? process.env.PIE_ADK_SERVER_PORT, 4873);
}

function parsePort(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}

	const port = Number.parseInt(value, 10);
	return Number.isFinite(port) ? port : fallback;
}

function isCliEntrypoint(): boolean {
	return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

function isChatOrModelPath(pathname: string): boolean {
	return pathname === "/v1/chat/completions" || pathname === "/v1/models" || pathname === "/models";
}

function isPieAgentChatPath(pathname: string): boolean {
	return (
		pathname === "/v1/pie/chat/completions" ||
		pathname === "/v1/pie/chat/sessions" ||
		pathname === "/v1/pie/chat/conversations" ||
		pathname.startsWith("/v1/pie/chat/conversations/")
	);
}

function isProviderPath(pathname: string): boolean {
	return pathname === "/providers" || pathname === "/v1/providers" || pathname === "/providers/probe" || pathname === "/v1/providers/probe";
}

function isAccountSelectionPath(pathname: string): boolean {
	return pathname === "/account-selection" || pathname === "/v1/account-selection";
}

function isBudgetPath(pathname: string): boolean {
	return pathname === "/budget" || pathname === "/v1/budget";
}

function isOAuthPath(pathname: string): boolean {
	return (
		pathname === "/oauth/providers" ||
		pathname === "/v1/oauth/providers" ||
		pathname === "/oauth/start" ||
		pathname === "/v1/oauth/start" ||
		pathname === "/oauth/callback" ||
		pathname === "/v1/oauth/callback"
	);
}

function isModelAvailabilityPath(pathname: string): boolean {
	return pathname === "/models/availability" || pathname === "/v1/models/availability";
}

function isQuotaPath(pathname: string): boolean {
	return pathname === "/quota" || pathname === "/v1/quota" || /^\/(?:v1\/)?quota\/[^/]+$/.test(pathname);
}

function isProxyPoolPath(pathname: string): boolean {
	return (
		pathname === "/proxy-pools" ||
		pathname === "/v1/proxy-pools" ||
		/^\/(?:v1\/)?proxy-pools\/[^/]+(?:\/test)?$/.test(pathname)
	);
}

function isProviderConnectionPath(pathname: string): boolean {
	return pathname === "/provider-connections" || pathname === "/v1/provider-connections" || /^\/(?:v1\/)?provider-connections\/[^/]+$/.test(pathname);
}

function isProviderSettingsPath(pathname: string): boolean {
	return pathname === "/provider-settings" || pathname === "/v1/provider-settings";
}

function isRoutingPolicyPath(pathname: string): boolean {
	return (
		pathname === "/routing-policy" ||
		pathname === "/v1/routing-policy" ||
		pathname === "/routing-policy/preview" ||
		pathname === "/v1/routing-policy/preview" ||
		pathname === "/routing-policy/combos" ||
		pathname === "/v1/routing-policy/combos" ||
		/^\/(?:v1\/)?routing-policy\/combos\/[^/]+$/.test(pathname) ||
		pathname === "/routing-policy/aliases" ||
		pathname === "/v1/routing-policy/aliases" ||
		/^\/(?:v1\/)?routing-policy\/aliases\/[^/]+$/.test(pathname) ||
		pathname === "/routing-policy/intents" ||
		pathname === "/v1/routing-policy/intents" ||
		/^\/(?:v1\/)?routing-policy\/intents\/[^/]+$/.test(pathname)
	);
}

function isMediaPath(pathname: string): boolean {
	return (
		pathname === "/v1/embeddings" ||
		pathname === "/search" ||
		pathname === "/v1/search" ||
		pathname === "/web/fetch" ||
		pathname === "/v1/web/fetch" ||
		pathname === "/v1/audio/speech" ||
		pathname === "/v1/audio/transcriptions" ||
		pathname === "/v1/images/generations" ||
		pathname === "/media/routes" ||
		pathname === "/v1/media/routes"
	);
}

function isLearningPath(pathname: string): boolean {
	return (
		pathname === "/learning" ||
		pathname === "/v1/learning" ||
		pathname === "/learning/curator" ||
		pathname === "/v1/learning/curator" ||
		pathname === "/learning/reviews" ||
		pathname === "/v1/learning/reviews"
	);
}
