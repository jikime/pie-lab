import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Inbound request guards for the local pie-lab server.
 *
 * The server proxies stored provider API keys, so even on a loopback bind it
 * must not be reachable from arbitrary web pages. Two checks close that off:
 *
 * - Host validation defeats DNS rebinding: a rebound request still carries the
 *   attacker's domain in the Host header.
 * - Origin validation rejects cross-origin browser requests from non-local
 *   pages before any handler runs. Requests without an Origin header (curl,
 *   SDKs, same-origin navigation) pass through.
 */

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export interface RequestSecurityOptions {
	/** Bind host configured for the server; accepted in the Host header when not loopback. */
	host?: string;
	/** Extra Host header hostnames to accept (besides localhost/127.0.0.1/::1). */
	allowedHosts?: string[];
	/** Extra browser origins to accept (besides local-hostname origins). */
	allowedOrigins?: string[];
}

interface ResolvedRequestSecurity {
	allowedHostnames: Set<string>;
	allowedOrigins: Set<string>;
}

function parseListEnv(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function normalizeHostname(hostname: string): string {
	const lowered = hostname.toLowerCase();
	return lowered.startsWith("[") && lowered.endsWith("]") ? lowered.slice(1, -1) : lowered;
}

function hostnameFromHostHeader(hostHeader: string): string | undefined {
	try {
		return normalizeHostname(new URL(`http://${hostHeader}`).hostname);
	} catch {
		return undefined;
	}
}

export function resolveRequestSecurity(options: RequestSecurityOptions = {}): ResolvedRequestSecurity {
	const allowedHostnames = new Set(LOCAL_HOSTNAMES);
	if (options.host) {
		allowedHostnames.add(normalizeHostname(options.host));
	}
	for (const host of [...(options.allowedHosts ?? []), ...parseListEnv(process.env.PIE_LAB_SERVER_ALLOWED_HOSTS)]) {
		allowedHostnames.add(normalizeHostname(host));
	}

	const allowedOrigins = new Set<string>();
	for (const origin of [
		...(options.allowedOrigins ?? []),
		...parseListEnv(process.env.PIE_LAB_SERVER_ALLOWED_ORIGINS),
	]) {
		allowedOrigins.add(origin.replace(/\/$/, "").toLowerCase());
	}

	return { allowedHostnames, allowedOrigins };
}

function isAllowedOrigin(origin: string, security: ResolvedRequestSecurity): boolean {
	const normalized = origin.replace(/\/$/, "").toLowerCase();
	if (security.allowedOrigins.has(normalized)) {
		return true;
	}
	try {
		const hostname = normalizeHostname(new URL(normalized).hostname);
		return LOCAL_HOSTNAMES.has(hostname) || security.allowedHostnames.has(hostname);
	} catch {
		return false;
	}
}

function writeForbidden(response: ServerResponse, message: string): void {
	response.writeHead(403, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: message }));
}

/**
 * Returns true when the request may proceed to route handlers.
 * Writes a 403 response (without CORS allow headers) and returns false otherwise.
 */
export function enforceRequestSecurity(
	request: IncomingMessage,
	response: ServerResponse,
	security: ResolvedRequestSecurity,
): boolean {
	const hostHeader = request.headers.host;
	const hostname = hostHeader ? hostnameFromHostHeader(hostHeader) : undefined;
	if (!hostname || !security.allowedHostnames.has(hostname)) {
		writeForbidden(response, `Forbidden Host header: ${hostHeader ?? "(missing)"}`);
		return false;
	}

	const origin = request.headers.origin;
	if (origin !== undefined && !isAllowedOrigin(origin, security)) {
		writeForbidden(response, `Forbidden Origin: ${origin}`);
		return false;
	}

	return true;
}
