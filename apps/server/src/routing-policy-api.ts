import { resolvePiModelRoutePlan, type PiModelCatalog, type PiModelReference, type PiRouterPolicy } from "@pie-lab/router";
import {
	createJsonProviderConnectionStore,
	type ProviderConnectionStore,
	type RouterPolicyCombo,
	type RouterPolicySettings,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.ts";

export interface RoutingPolicyApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
	routingPolicyCatalog?: PiModelCatalog<PiModelReference>;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createRoutingPolicyRequestHandler(options: RoutingPolicyApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleRoutingPolicyRequest(request, response, {
				providerConnectionStore,
				modelRegistry: options.routingPolicyCatalog,
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

export async function handleRoutingPolicyRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		modelRegistry?: PiModelCatalog<PiModelReference>;
	},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (isRoutingPolicyRootPath(url.pathname)) {
		await handleRootPolicyRequest(request, response, options.providerConnectionStore);
		return;
	}

	if (isRoutingPolicyPreviewPath(url.pathname)) {
		await handlePreviewRequest(request, response, options);
		return;
	}

	if (isRoutingPolicyComboListPath(url.pathname)) {
		await handleComboListRequest(request, response, options.providerConnectionStore);
		return;
	}

	if (isRoutingPolicyAliasListPath(url.pathname)) {
		await handleAliasListRequest(request, response, options.providerConnectionStore);
		return;
	}

	const aliasName = parseRoutingPolicyAliasName(url.pathname);
	if (aliasName) {
		await handleAliasDetailRequest(request, response, options.providerConnectionStore, aliasName);
		return;
	}

	if (isRoutingPolicyIntentListPath(url.pathname)) {
		await handleIntentListRequest(request, response, options.providerConnectionStore);
		return;
	}

	const intentName = parseRoutingPolicyIntentName(url.pathname);
	if (intentName) {
		await handleIntentDetailRequest(request, response, options.providerConnectionStore, intentName);
		return;
	}

	const comboName = parseRoutingPolicyComboName(url.pathname);
	if (comboName) {
		await handleComboDetailRequest(request, response, options.providerConnectionStore, comboName);
		return;
	}

	writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
}

async function handleRootPolicyRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method === "GET") {
		writeJson(response, 200, { policy: await readRouterPolicy(providerConnectionStore) });
		return;
	}

	if (request.method === "PUT") {
		const body = await readBodyOrWriteBadRequest(request, response);
		if (!body) return;
		const policy = readPolicyFromBody(body);
		const settings = await providerConnectionStore.updateSettings({ routerPolicy: policy });
		writeJson(response, 200, { policy: settings.routerPolicy });
		return;
	}

	writeMethodNotAllowed(response, "GET, PUT, OPTIONS");
}

async function handleComboListRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method !== "POST") {
		writeMethodNotAllowed(response, "POST, OPTIONS");
		return;
	}

	const body = await readBodyOrWriteBadRequest(request, response);
	if (!body) return;

	const combo = normalizeComboInput(body);
	if ("error" in combo) {
		writeJson(response, 400, { error: combo.error });
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const combos = getCombos(policy).filter((item) => item.name !== combo.name);
	combos.push(combo);
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, combos },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, combo });
}

async function handleComboDetailRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	comboName: string,
): Promise<void> {
	if (request.method !== "DELETE") {
		writeMethodNotAllowed(response, "DELETE, OPTIONS");
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const combos = getCombos(policy).filter((item) => item.name !== comboName);
	const comboStrategies = { ...(policy.comboStrategies ?? {}) };
	delete comboStrategies[comboName];
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, combos, comboStrategies },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, deleted: comboName });
}

async function handleAliasListRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method !== "POST") {
		writeMethodNotAllowed(response, "POST, OPTIONS");
		return;
	}

	const body = await readBodyOrWriteBadRequest(request, response);
	if (!body) return;

	const mapping = normalizePolicyMappingInput(body);
	if ("error" in mapping) {
		writeJson(response, 400, { error: mapping.error });
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const aliases = { ...(policy.aliases ?? {}) };
	aliases[mapping.name] = mapping.models.length === 1 ? mapping.models[0] : mapping.models;
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, aliases },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, alias: mapping });
}

async function handleAliasDetailRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	aliasName: string,
): Promise<void> {
	if (request.method !== "DELETE") {
		writeMethodNotAllowed(response, "DELETE, OPTIONS");
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const aliases = { ...(policy.aliases ?? {}) };
	delete aliases[aliasName];
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, aliases },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, deleted: aliasName });
}

async function handleIntentListRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method !== "POST") {
		writeMethodNotAllowed(response, "POST, OPTIONS");
		return;
	}

	const body = await readBodyOrWriteBadRequest(request, response);
	if (!body) return;

	const mapping = normalizePolicyMappingInput(body);
	if ("error" in mapping) {
		writeJson(response, 400, { error: mapping.error });
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const intents = { ...(policy.intents ?? {}) };
	intents[mapping.name] = mapping.models.length === 1 ? mapping.models[0] : mapping.models;
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, intents },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, intent: mapping });
}

async function handleIntentDetailRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
	intentName: string,
): Promise<void> {
	if (request.method !== "DELETE") {
		writeMethodNotAllowed(response, "DELETE, OPTIONS");
		return;
	}

	const policy = await readRouterPolicy(providerConnectionStore);
	const intents = { ...(policy.intents ?? {}) };
	delete intents[intentName];
	const settings = await providerConnectionStore.updateSettings({
		routerPolicy: { ...policy, intents },
	});
	writeJson(response, 200, { policy: settings.routerPolicy, deleted: intentName });
}

async function handlePreviewRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: {
		providerConnectionStore: ProviderConnectionStore;
		modelRegistry?: PiModelCatalog<PiModelReference>;
	},
): Promise<void> {
	if (request.method !== "POST") {
		writeMethodNotAllowed(response, "POST, OPTIONS");
		return;
	}

	if (!options.modelRegistry) {
		writeJson(response, 503, { error: { message: "Model registry is not available." } });
		return;
	}

	const body = await readBodyOrWriteBadRequest(request, response);
	if (!body) return;
	const requestedModel = normalizeString(body.model ?? body.requestedModel);
	if (!requestedModel) {
		writeJson(response, 400, { error: { message: "model is required" } });
		return;
	}

	const policy = (body.policy && typeof body.policy === "object"
		? (body.policy as RouterPolicySettings)
		: await readRouterPolicy(options.providerConnectionStore)) as PiRouterPolicy;
	const plan = await resolvePiModelRoutePlan({
		requestedModel,
		catalog: options.modelRegistry,
		policy,
	});

	writeJson(response, 200, {
		requestedModel: plan.requestedModel,
		routingMode: plan.routingMode,
		routes: plan.routes.map((route, index) => ({
			index,
			source: route.route.source,
			provider: route.route.resolvedProvider,
			model: route.route.resolvedModel,
			id: `${route.route.resolvedProvider}/${route.route.resolvedModel}`,
		})),
	});
}

async function readRouterPolicy(providerConnectionStore: ProviderConnectionStore): Promise<RouterPolicySettings> {
	const settings = await providerConnectionStore.getSettings();
	return settings.routerPolicy ?? {};
}

function readPolicyFromBody(body: Record<string, unknown>): RouterPolicySettings {
	const policy = body.policy && typeof body.policy === "object" ? body.policy : body;
	return policy as RouterPolicySettings;
}

function normalizeComboInput(body: Record<string, unknown>): RouterPolicyCombo | { error: string } {
	const name = normalizeString(body.name);
	if (!name) return { error: "name is required" };
	const models = normalizeModelList(body.models);
	if (models.length === 0) return { error: "models must include at least one provider/model" };

	return {
		name,
		models,
		kind: normalizeString(body.kind) || null,
		strategy: body.strategy === "round-robin" ? "round-robin" : "fallback",
		stickyLimit: normalizeStickyLimit(body.stickyLimit),
	};
}

function normalizePolicyMappingInput(body: Record<string, unknown>): { name: string; models: string[] } | { error: string } {
	const name = normalizeString(body.name) || normalizeString(body.intent) || normalizeString(body.alias);
	if (!name) return { error: "name is required" };
	const models = normalizeModelList(body.models ?? body.model);
	if (models.length === 0) return { error: "models must include at least one provider/model" };

	return { name, models };
}

function getCombos(policy: RouterPolicySettings): RouterPolicyCombo[] {
	return Array.isArray(policy.combos) ? policy.combos : (policy.combos?.combos ?? []);
}

function isRoutingPolicyRootPath(pathname: string): boolean {
	return pathname === "/routing-policy" || pathname === "/v1/routing-policy";
}

function isRoutingPolicyPreviewPath(pathname: string): boolean {
	return pathname === "/routing-policy/preview" || pathname === "/v1/routing-policy/preview";
}

function isRoutingPolicyComboListPath(pathname: string): boolean {
	return pathname === "/routing-policy/combos" || pathname === "/v1/routing-policy/combos";
}

function isRoutingPolicyAliasListPath(pathname: string): boolean {
	return pathname === "/routing-policy/aliases" || pathname === "/v1/routing-policy/aliases";
}

function isRoutingPolicyIntentListPath(pathname: string): boolean {
	return pathname === "/routing-policy/intents" || pathname === "/v1/routing-policy/intents";
}

function parseRoutingPolicyComboName(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?routing-policy\/combos\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

function parseRoutingPolicyAliasName(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?routing-policy\/aliases\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

function parseRoutingPolicyIntentName(pathname: string): string | undefined {
	const match = pathname.match(/^\/(?:v1\/)?routing-policy\/intents\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : undefined;
}

async function readBodyOrWriteBadRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<Record<string, unknown> | null> {
	try {
		return await readJsonBody(request);
	} catch {
		writeJson(response, 400, { error: "Invalid JSON body" });
		return null;
	}
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function normalizeModelList(value: unknown): string[] {
	const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\n]/) : [];
	return values.map(normalizeString).filter(Boolean);
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStickyLimit(value: unknown): number {
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(1, Math.floor(value));
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
	}
	return 1;
}

function writeMethodNotAllowed(response: ServerResponse, allow: string): void {
	response.writeHead(405, {
		...CORS_HEADERS,
		allow,
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
