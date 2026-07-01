/**
 * Design runs API — pie agent bridge for the open-design core-loop port.
 *
 * Endpoints (see `artifacts/ports/core-loop/02-architecture.md` §4, the single
 * source of truth):
 *  - POST /v1/design/runs                       → create run + immediate SSE stream
 *  - GET  /v1/design/options                    → built-in skill/design-system options
 *  - GET  /v1/design/runs/:id                   → run status + artifacts (re-entry/fallback)
 *  - GET  /v1/design/runs/:id/artifact/:name    → raw HTML (?download=1 for attachment)
 *
 * Design notes:
 *  - One pie agent session per run. We inject the design skill + design-system
 *    guide via `DefaultResourceLoader({ appendSystemPrompt })`, expose only the
 *    `write` and `read` tools, and bind the session cwd to the run directory so
 *    the agent's `write` lands at `<runDir>/index.html`.
 *  - `tool_execution_start/end (toolName:"write")` events are synthesised into
 *    `artifact` SSE events (streaming → complete) — there is no separate file
 *    channel (single-stream decision, §4.1).
 *  - SSE transport (headers, framing, drain/close race, `[DONE]`, per-write queue)
 *    mirrors `pie-agent-chat-api.ts`; we deliberately duplicate rather than share
 *    to keep that file untouched (§3.2).
 *
 * The DesignStreamEvent / DesignRunRequest types below are a STRUCTURAL MIRROR of
 * `apps/design/src/lib/design-protocol.ts` (the web app's source of truth). The
 * server does not import the web package; if one side changes, the architect
 * notifies both (§7.1).
 */

import {
	createAgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	DefaultResourceLoader,
	getAgentDir,
	type ModelRegistry,
	SessionManager,
} from "@pie-lab/coding-agent";
import type { Api, Model } from "@pie-lab/ai";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { createDefaultModelRegistry } from "./chat-completions-api.ts";
import {
	composeDesignSystemPrompt,
	DEFAULT_SKILL_ID,
	findSkillPreset,
	listDesignSystemPresets,
	listSkillPresets,
	type ResolvedDesignPreset,
	resolvePreset,
} from "./design-presets/index.ts";

// ── Protocol types (structural mirror of design-protocol.ts) ─────────────────

export interface DesignSkillOption {
	id: string;
	title: string;
	description: string;
}

export interface DesignSystemOption {
	id: string;
	title: string;
}

export interface DesignOptionsResponse {
	skills: DesignSkillOption[];
	designSystems: DesignSystemOption[];
	defaultSkillId: string;
}

export interface DesignRunRequest {
	prompt: string;
	skillId: string;
	designSystemId: string | null;
	model?: string;
	conversationId?: string;
}

export type DesignRunStatus = "running" | "succeeded" | "failed" | "aborted";

export interface ArtifactDescriptor {
	name: string;
	kind: "html";
	status: "streaming" | "complete";
	url?: string;
	inlineHtml?: string;
	bytes?: number;
}

export interface DesignStartEvent {
	type: "start";
	runId: string;
	conversationId: string;
	model: string;
}

export interface DesignProgressEvent {
	type: "progress";
	phase: "queued" | "running" | "tool_start" | "tool_end";
	label: string;
	toolName?: string;
}

export interface DesignTextEvent {
	type: "text";
	delta: string;
}

export interface DesignArtifactEvent {
	type: "artifact";
	artifact: ArtifactDescriptor;
}

export interface DesignDoneEvent {
	type: "done";
	status: "succeeded" | "failed" | "aborted";
	artifacts: ArtifactDescriptor[];
}

export interface DesignErrorEvent {
	type: "error";
	message: string;
}

export type DesignStreamEvent =
	| DesignStartEvent
	| DesignProgressEvent
	| DesignTextEvent
	| DesignArtifactEvent
	| DesignDoneEvent
	| DesignErrorEvent;

export interface DesignRunStatusResponse {
	runId: string;
	status: DesignRunStatus;
	artifacts: ArtifactDescriptor[];
}

// ── Handler options & run registry ───────────────────────────────────────────

export interface DesignRunsApiOptions {
	modelRegistry?: ModelRegistry;
	usageStore?: CreateAgentSessionOptions["usageStore"];
	agentDir?: string;
	/** Override the runs root directory. Default: <agentDir>/design/runs */
	runsDir?: string;
	requestIdFactory?: () => string;
}

interface RunRecord {
	runId: string;
	conversationId: string;
	dir: string;
	status: DesignRunStatus;
	/** Most recent descriptor per artifact name (always the "complete" one once written). */
	artifacts: Map<string, ArtifactDescriptor>;
	/**
	 * In-flight write tool calls keyed by toolCallId → the basename captured from
	 * `tool_execution_start` args.path. This is the authoritative file-name source
	 * for `tool_execution_end` (B-1): the result message is only a fallback.
	 */
	pendingWrites: Map<string, string>;
}

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization, x-pie-client-origin, x-pie-origin",
	"access-control-allow-methods": "GET, POST, OPTIONS",
	"access-control-allow-origin": "*",
};

const DEFAULT_MODEL = "auto:chat";
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const RUNS_PATH = "/v1/design/runs";
const OPTIONS_PATH = "/v1/design/options";
const RUN_DETAIL_PATTERN = /^\/v1\/design\/runs\/([^/]+)$/;
const RUN_ARTIFACT_PATTERN = /^\/v1\/design\/runs\/([^/]+)\/artifact\/([^/]+)$/;
const MAX_INLINE_HTML_BYTES = 2 * 1024 * 1024;

/** True when the path belongs to the design API (used by the top-level router). */
export function isDesignPath(pathname: string): boolean {
	return (
		pathname === RUNS_PATH ||
		pathname === OPTIONS_PATH ||
		RUN_ARTIFACT_PATTERN.test(pathname) ||
		RUN_DETAIL_PATTERN.test(pathname)
	);
}

export function createDesignRunsRequestHandler(options: DesignRunsApiOptions = {}) {
	const agentDir = options.agentDir ?? getAgentDir();
	const modelRegistry = options.modelRegistry ?? createDefaultModelRegistry(agentDir);
	const runsDir = options.runsDir ?? process.env.PIE_DESIGN_RUNS_DIR ?? join(agentDir, "design", "runs");
	const requestIdFactory = options.requestIdFactory ?? (() => `design_${randomUUID()}`);
	const runs = new Map<string, RunRecord>();

	const context: HandlerContext = {
		agentDir,
		modelRegistry,
		runsDir,
		usageStore: options.usageStore,
		requestIdFactory,
		runs,
	};

	return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
		try {
			await handleDesignRequest(request, response, context);
		} catch (error) {
			if (!response.headersSent) {
				writeJson(response, 500, {
					error: {
						message: error instanceof Error ? error.message : "Unexpected server error",
						type: "server_error",
					},
				});
			} else if (!response.writableEnded) {
				response.end();
			}
		}
	};
}

interface HandlerContext {
	agentDir: string;
	modelRegistry: ModelRegistry;
	runsDir: string;
	usageStore?: CreateAgentSessionOptions["usageStore"];
	requestIdFactory: () => string;
	runs: Map<string, RunRecord>;
}

async function handleDesignRequest(
	request: IncomingMessage,
	response: ServerResponse,
	context: HandlerContext,
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	const pathname = url.pathname;

	if (pathname === OPTIONS_PATH) {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response);
			return;
		}
		writeJson(response, 200, buildOptionsResponse());
		return;
	}

	if (pathname === RUNS_PATH) {
		if (request.method !== "POST") {
			writeMethodNotAllowed(response);
			return;
		}
		await handleCreateRun(request, response, context);
		return;
	}

	const artifactMatch = RUN_ARTIFACT_PATTERN.exec(pathname);
	if (artifactMatch) {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response);
			return;
		}
		handleServeArtifact(response, context, decodeURIComponent(artifactMatch[1]), decodeURIComponent(artifactMatch[2]), url);
		return;
	}

	const detailMatch = RUN_DETAIL_PATTERN.exec(pathname);
	if (detailMatch) {
		if (request.method !== "GET") {
			writeMethodNotAllowed(response);
			return;
		}
		handleRunStatus(response, context, decodeURIComponent(detailMatch[1]));
		return;
	}

	writeJson(response, 404, { error: { message: "Not found", type: "invalid_request_error" } });
}

// ── GET /v1/design/options ───────────────────────────────────────────────────

function buildOptionsResponse(): DesignOptionsResponse {
	return {
		skills: listSkillPresets().map((skill) => ({
			id: skill.id,
			title: skill.title,
			description: skill.description,
		})),
		designSystems: listDesignSystemPresets().map((system) => ({
			id: system.id,
			title: system.title,
		})),
		defaultSkillId: DEFAULT_SKILL_ID,
	};
}

// ── POST /v1/design/runs ─────────────────────────────────────────────────────

async function handleCreateRun(
	request: IncomingMessage,
	response: ServerResponse,
	context: HandlerContext,
): Promise<void> {
	const body = await readJsonBody<Partial<DesignRunRequest>>(request);
	const validationError = validateRunRequest(body);
	if (validationError) {
		writeJson(response, 400, { error: { message: validationError, type: "invalid_request_error" } });
		return;
	}

	const prompt = (body.prompt as string).trim();
	const skillId = body.skillId as string;
	const designSystemId = body.designSystemId ?? null;
	const preset = resolvePreset(skillId, designSystemId);
	if (!preset) {
		writeJson(response, 400, {
			error: { message: `Unknown skillId: ${skillId}`, type: "invalid_request_error" },
		});
		return;
	}

	const requestedModel =
		typeof body.model === "string" && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
	const model = resolveModelReference(context.modelRegistry, requestedModel);
	if (!model) {
		writeJson(response, 400, {
			error: { message: `Model not found: ${requestedModel}`, type: "invalid_request_error" },
		});
		return;
	}

	const conversationId =
		typeof body.conversationId === "string" && body.conversationId.trim()
			? body.conversationId.trim().slice(0, 160)
			: `design_${randomUUID()}`;
	const runId = context.requestIdFactory();
	const runDir = join(context.runsDir, runId);
	mkdirSync(runDir, { recursive: true });

	const record: RunRecord = {
		runId,
		conversationId,
		dir: runDir,
		status: "running",
		artifacts: new Map(),
		pendingWrites: new Map(),
	};
	context.runs.set(runId, record);

	const resolvedModelName = model.provider && model.id ? `${model.provider}/${model.id}` : requestedModel;

	await streamRun({
		request,
		response,
		context,
		record,
		prompt,
		preset,
		model,
		resolvedModelName,
	});
}

interface StreamRunOptions {
	request: IncomingMessage;
	response: ServerResponse;
	context: HandlerContext;
	record: RunRecord;
	prompt: string;
	preset: ResolvedDesignPreset;
	model: Model<Api>;
	resolvedModelName: string;
}

async function streamRun(options: StreamRunOptions): Promise<void> {
	const { response, record, context } = options;

	writeSseHeaders(response);

	// Serialise SSE writes so event ordering is preserved under backpressure
	// (mirror of pie-agent-chat-api.ts enqueueWrite/writeQueue).
	let writeQueue = Promise.resolve();
	const enqueue = (event: DesignStreamEvent): void => {
		writeQueue = writeQueue.then(
			() => writeSse(response, event),
			() => writeSse(response, event),
		);
	};

	enqueue({
		type: "start",
		runId: record.runId,
		conversationId: record.conversationId,
		model: options.resolvedModelName,
	});
	enqueue({ type: "progress", phase: "queued", label: "queued" });

	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let completed = false;
	let sawError = false;

	const abort = (): void => {
		if (!completed && session) {
			void session.abort().catch(() => undefined);
		}
	};
	response.on("close", abort);

	try {
		const appendSystemPrompt = composeDesignSystemPrompt(options.preset);
		const resourceLoader = new DefaultResourceLoader({
			cwd: record.dir,
			agentDir: context.agentDir,
			appendSystemPrompt,
			noSkills: true,
			noPromptTemplates: true,
			noContextFiles: true,
			noExtensions: true,
		});
		await resourceLoader.reload();

		const created = await createAgentSession({
			cwd: record.dir,
			agentDir: context.agentDir,
			model: options.model,
			modelRegistry: context.modelRegistry,
			usageStore: context.usageStore,
			resourceLoader,
			tools: ["write", "read"],
			sessionManager: SessionManager.inMemory(record.dir),
		});
		session = created.session;

		const unsubscribe = session.subscribe((event) =>
			handleSessionEvent(event, { record, enqueue, onError: () => (sawError = true) }),
		);

		try {
			await session.prompt(options.prompt, { source: "rpc" });
		} finally {
			unsubscribe();
		}

		await writeQueue;
		record.status = sawError ? "failed" : "succeeded";
		enqueue({ type: "done", status: record.status, artifacts: snapshotArtifacts(record) });
		await writeQueue;
		await writeSseDone(response);
		completed = true;
		response.end();
	} catch (error) {
		const aborted = isAbortError(error);
		record.status = aborted ? "aborted" : "failed";
		enqueue({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		});
		enqueue({ type: "done", status: record.status, artifacts: snapshotArtifacts(record) });
		await writeQueue.catch(() => undefined);
		await writeSseDone(response).catch(() => undefined);
		completed = true;
		if (!response.writableEnded) {
			response.end();
		}
	} finally {
		session?.dispose();
		response.off("close", abort);
	}
}

interface SessionEventSink {
	record: RunRecord;
	enqueue: (event: DesignStreamEvent) => void;
	onError: () => void;
}

/** Map a pie agent AgentSessionEvent to DesignStreamEvent(s) (§5.3). */
function handleSessionEvent(event: AgentSessionEvent, sink: SessionEventSink): void {
	const { record, enqueue } = sink;

	if (event.type === "agent_start") {
		enqueue({ type: "progress", phase: "running", label: "running" });
		return;
	}

	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		const delta = event.assistantMessageEvent.delta;
		if (delta) {
			enqueue({ type: "text", delta });
		}
		return;
	}

	if (event.type === "tool_execution_start") {
		if (event.toolName === "write") {
			const name = artifactNameFromArgs(event.args);
			// B-1: remember the start-time path as the authoritative file name for
			// this write, keyed by toolCallId, so tool_execution_end never has to
			// rely on parsing the (note-augmented) result message.
			if (name) {
				record.pendingWrites.set(event.toolCallId, name);
			}
			enqueue({
				type: "progress",
				phase: "tool_start",
				toolName: "write",
				label: name ? `writing ${name}` : "writing",
			});
			if (name) {
				enqueue({ type: "artifact", artifact: { name, kind: "html", status: "streaming" } });
			}
		} else {
			enqueue({
				type: "progress",
				phase: "tool_start",
				toolName: event.toolName,
				label: event.toolName,
			});
		}
		return;
	}

	if (event.type === "tool_execution_end") {
		if (event.toolName !== "write") {
			enqueue({ type: "progress", phase: "tool_end", toolName: event.toolName, label: event.toolName });
			return;
		}
		// B-1: prefer the path captured at tool_execution_start (keyed by
		// toolCallId); the result-message parse is a fallback for the rare case
		// where the start args lacked a usable path.
		const pendingName = record.pendingWrites.get(event.toolCallId);
		record.pendingWrites.delete(event.toolCallId);
		if (event.isError) {
			sink.onError();
			enqueue({ type: "error", message: toolErrorText(event.result) ?? "write failed" });
			enqueue({ type: "progress", phase: "tool_end", toolName: "write", label: "write failed" });
			return;
		}
		const name = pendingName ?? artifactNameFromResult(event.result);
		if (name) {
			const descriptor = buildCompleteArtifact(record, name);
			if (descriptor) {
				record.artifacts.set(name, descriptor);
				writeSidecar(record, descriptor);
				enqueue({ type: "artifact", artifact: descriptor });
			}
		}
		enqueue({ type: "progress", phase: "tool_end", toolName: "write", label: name ? `wrote ${name}` : "wrote" });
		return;
	}
}

// ── GET /v1/design/runs/:id ──────────────────────────────────────────────────

function handleRunStatus(response: ServerResponse, context: HandlerContext, runId: string): void {
	const record = context.runs.get(runId);
	if (!record) {
		writeJson(response, 404, { error: { message: "Run not found", type: "invalid_request_error" } });
		return;
	}
	const payload: DesignRunStatusResponse = {
		runId: record.runId,
		status: record.status,
		artifacts: snapshotArtifacts(record),
	};
	writeJson(response, 200, payload);
}

// ── GET /v1/design/runs/:id/artifact/:name ───────────────────────────────────

function handleServeArtifact(
	response: ServerResponse,
	context: HandlerContext,
	runId: string,
	name: string,
	url: URL,
): void {
	if (!ARTIFACT_NAME_PATTERN.test(name)) {
		writeJson(response, 400, { error: { message: "Invalid artifact name", type: "invalid_request_error" } });
		return;
	}
	const record = context.runs.get(runId);
	const runDir = record?.dir ?? join(context.runsDir, sanitizeRunId(runId));
	if (!record && !sanitizeRunId(runId)) {
		writeJson(response, 404, { error: { message: "Run not found", type: "invalid_request_error" } });
		return;
	}

	const filePath = join(runDir, name);
	let html: string;
	try {
		html = readFileSync(filePath, "utf-8");
	} catch {
		writeJson(response, 404, { error: { message: "Artifact not found", type: "invalid_request_error" } });
		return;
	}

	const download = url.searchParams.get("download") === "1";
	const headers: Record<string, string> = {
		...CORS_HEADERS,
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
	};
	if (download) {
		headers["content-disposition"] = `attachment; filename="${name}"`;
	}
	response.writeHead(200, headers);
	response.end(html);
}

// ── Artifact helpers ─────────────────────────────────────────────────────────

function snapshotArtifacts(record: RunRecord): ArtifactDescriptor[] {
	return [...record.artifacts.values()];
}

function buildCompleteArtifact(record: RunRecord, name: string): ArtifactDescriptor | undefined {
	const filePath = join(record.dir, name);
	let bytes: number;
	try {
		bytes = statSync(filePath).size;
	} catch {
		return undefined;
	}
	const descriptor: ArtifactDescriptor = {
		name,
		kind: "html",
		status: "complete",
		url: `${RUNS_PATH}/${encodeURIComponent(record.runId)}/artifact/${encodeURIComponent(name)}`,
		bytes,
	};
	if (bytes <= MAX_INLINE_HTML_BYTES) {
		try {
			descriptor.inlineHtml = readFileSync(filePath, "utf-8");
		} catch {
			// inlineHtml is optional; fall back to url-only.
		}
	}
	return descriptor;
}

/** Persist an optional sidecar JSON so status survives a process restart (best effort). */
function writeSidecar(record: RunRecord, descriptor: ArtifactDescriptor): void {
	try {
		const sidecar = { ...descriptor, inlineHtml: undefined };
		writeFileSync(join(record.dir, `${descriptor.name}.artifact.json`), JSON.stringify(sidecar, null, 2), "utf-8");
	} catch {
		// Sidecar is best-effort; ignore failures.
	}
}

/**
 * Resolve a validated artifact file name from write tool args (the authoritative
 * source, B-1). Returns undefined unless the basename passes the name whitelist
 * and is an .html file.
 */
function artifactNameFromArgs(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const path = (args as { path?: unknown }).path;
	if (typeof path !== "string") return undefined;
	return validatedArtifactName(basenameOf(path));
}

/**
 * Fallback only (B-1): resolve the file name from a write tool result. The write
 * tool's success message is "Successfully wrote N bytes to <path>.<note>" where
 * <note> may be appended when hashline prefixes are stripped. We capture the
 * path token greedily but then re-validate the basename, so a trailing note can
 * never produce an invalid name (it simply fails validation and yields undefined).
 */
function artifactNameFromResult(result: unknown): string | undefined {
	const text = toolResultText(result);
	if (!text) return undefined;
	const match = text.match(/wrote\s+\d+\s+bytes\s+to\s+(\S+)/i);
	if (!match) return undefined;
	// Strip a trailing sentence-ending period (the message ends "...to <path>.").
	const token = match[1].replace(/\.$/, "");
	return validatedArtifactName(basenameOf(token));
}

/** Validate a basename against the artifact whitelist and require an .html file. */
function validatedArtifactName(name: string | undefined): string | undefined {
	if (!name) return undefined;
	if (!ARTIFACT_NAME_PATTERN.test(name)) return undefined;
	if (!name.toLowerCase().endsWith(".html")) return undefined;
	return name;
}

function basenameOf(path: string): string | undefined {
	const cleaned = path.replace(/\\/g, "/").replace(/\/+$/, "");
	const segment = cleaned.slice(cleaned.lastIndexOf("/") + 1);
	return segment || undefined;
}

function toolResultText(result: unknown): string | undefined {
	if (!result || typeof result !== "object") return undefined;
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	return content
		.map((block) => (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : ""))
		.join("");
}

function toolErrorText(result: unknown): string | undefined {
	const text = toolResultText(result);
	return text && text.trim() ? text.trim() : undefined;
}

function sanitizeRunId(runId: string): string {
	return ARTIFACT_NAME_PATTERN.test(runId) ? runId : "";
}

// ── Model resolution (mirror of pie-agent-chat-api.ts) ───────────────────────

function resolveModelReference(modelRegistry: ModelRegistry, requestedModel: string): Model<Api> | undefined {
	const routerModel = modelRegistry.find(PIE_LAB_ROUTER_PROVIDER, requestedModel);
	if (routerModel) return routerModel;

	const slashIndex = requestedModel.indexOf("/");
	if (slashIndex > 0) {
		const provider = requestedModel.slice(0, slashIndex);
		const modelId = requestedModel.slice(slashIndex + 1);
		const model = modelRegistry.find(provider, modelId);
		if (model) return model;
	}

	const matches = modelRegistry.getAll().filter((model) => model.id === requestedModel);
	return matches.length === 1 ? matches[0] : undefined;
}

// ── Validation ───────────────────────────────────────────────────────────────

function validateRunRequest(body: Partial<DesignRunRequest>): string | undefined {
	if (typeof body.prompt !== "string" || !body.prompt.trim()) {
		return "prompt must be a non-empty string.";
	}
	if (typeof body.skillId !== "string" || !body.skillId.trim()) {
		return "skillId must be a non-empty string.";
	}
	if (!findSkillPreset(body.skillId)) {
		return `Unknown skillId: ${body.skillId}`;
	}
	if (body.designSystemId !== undefined && body.designSystemId !== null && typeof body.designSystemId !== "string") {
		return "designSystemId must be a string or null.";
	}
	if (body.model !== undefined && typeof body.model !== "string") {
		return "model must be a string.";
	}
	if (body.conversationId !== undefined && typeof body.conversationId !== "string") {
		return "conversationId must be a string.";
	}
	return undefined;
}

function isAbortError(error: unknown): boolean {
	if (error instanceof Error) {
		return /abort/i.test(error.message) || error.name === "AbortError";
	}
	return false;
}

// ── HTTP / SSE helpers (mirror of pie-agent-chat-api.ts) ─────────────────────

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

function writeMethodNotAllowed(response: ServerResponse): void {
	writeJson(response, 405, { error: { message: "Method not allowed.", type: "invalid_request_error" } });
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

async function writeSseDone(response: ServerResponse): Promise<void> {
	await writeRawSse(response, "data: [DONE]\n\n");
}

async function writeRawSse(response: ServerResponse, chunk: string): Promise<void> {
	if (response.writableEnded) return;
	if (response.write(chunk)) {
		return;
	}
	// Race 'drain' against 'close'/'error' so a client disconnect never hangs.
	await new Promise<void>((resolve) => {
		const done = (): void => {
			response.removeListener("drain", done);
			response.removeListener("close", done);
			response.removeListener("error", done);
			resolve();
		};
		response.once("drain", done);
		response.once("close", done);
		response.once("error", done);
	});
}
