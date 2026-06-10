import { explainProviderConnectionSelection } from "@pie-lab/router";
import {
	createJsonProviderConnectionStore,
	type ProviderConnection,
	type ProviderConnectionStore,
} from "@pie-lab/storage";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getDefaultProviderConnectionFilePath } from "./provider-quota-api.ts";

export interface AccountSelectionApiOptions {
	providerConnectionStore?: ProviderConnectionStore;
	providerConnectionFilePath?: string;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createAccountSelectionRequestHandler(options: AccountSelectionApiOptions = {}) {
	const providerConnectionStore =
		options.providerConnectionStore ??
		createJsonProviderConnectionStore(options.providerConnectionFilePath ?? getDefaultProviderConnectionFilePath());

	return async (request: IncomingMessage, response: ServerResponse) => {
		try {
			await handleAccountSelectionRequest(request, response, providerConnectionStore);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleAccountSelectionRequest(
	request: IncomingMessage,
	response: ServerResponse,
	providerConnectionStore: ProviderConnectionStore,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	if (request.method !== "GET") {
		writeJson(response, 405, { error: { message: "Only GET and OPTIONS requests are supported." } });
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	if (url.pathname !== "/account-selection" && url.pathname !== "/v1/account-selection") {
		writeJson(response, 404, { error: { message: "Not found", path: url.pathname } });
		return;
	}

	const providerFilter = normalizeString(url.searchParams.get("provider"));
	const model = normalizeString(url.searchParams.get("model")) || null;
	const connections = await providerConnectionStore.getProviderConnections(
		providerFilter ? { provider: providerFilter } : {},
	);
	const settings = await providerConnectionStore.getSettings();
	const providers = providerFilter ? [providerFilter] : uniqueProviders(connections);
	const data = providers.map((provider) =>
		explainProviderConnectionSelection({
			provider,
			model,
			connections: connections as ProviderConnection[],
			settings,
		}),
	);

	writeJson(response, 200, {
		count: data.length,
		data,
	});
}

function uniqueProviders(connections: ProviderConnection[]): string[] {
	return [...new Set(connections.map((connection) => connection.provider))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
