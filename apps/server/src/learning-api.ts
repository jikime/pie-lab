import {
	BackgroundLearningReview,
	getAgentDir,
	LearningReviewStore,
	MemoryStore,
	SettingsManager,
	SkillCurator,
	SkillManager,
	type ReviewAction,
	type ReviewActionResult,
} from "@pie-lab/coding-agent";
import type { IncomingMessage, ServerResponse } from "node:http";

export interface LearningApiOptions {
	agentDir?: string;
	cwd?: string;
}

export type PieLabLearningRequestHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

const CORS_HEADERS = {
	"access-control-allow-headers": "content-type, authorization",
	"access-control-allow-methods": "GET, POST, PUT, OPTIONS",
	"access-control-allow-origin": "*",
};

export function createLearningRequestHandler(options: LearningApiOptions = {}): PieLabLearningRequestHandler {
	return async (request, response) => {
		try {
			await handleLearningRequest(request, response, options);
		} catch (error) {
			writeJson(response, 500, {
				error: {
					message: error instanceof Error ? error.message : "Unexpected server error",
				},
			});
		}
	};
}

export async function handleLearningRequest(
	request: IncomingMessage,
	response: ServerResponse,
	options: LearningApiOptions = {},
): Promise<void> {
	if (request.method === "OPTIONS") {
		response.writeHead(204, CORS_HEADERS);
		response.end();
		return;
	}

	const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
	const agentDir = options.agentDir ?? getAgentDir();
	const cwd = options.cwd ?? process.cwd();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const settings = settingsManager.getLearningSettings();
	const memoryStore = new MemoryStore({ agentDir });
	const skillManager = new SkillManager({ agentDir, cwd });
	const curator = new SkillCurator({ skillManager, policy: settings.skills.curator });
	const reviewStore = new LearningReviewStore({ agentDir });

	if (request.method === "GET" && (url.pathname === "/learning" || url.pathname === "/v1/learning")) {
		const reviews = reviewStore.list();
		writeJson(response, 200, {
			settings,
			memory: {
				memory: memoryStore.read("memory"),
				user: memoryStore.read("user"),
			},
			curator: {
				status: curator.status(),
			},
			reviews: {
				count: reviews.length,
				proposals: reviews.filter((review) => review.status === "proposed").length,
				recent: reviews.slice(0, 20),
			},
		});
		return;
	}

	if (request.method === "GET" && isReviewsPath(url.pathname)) {
		const id = url.searchParams.get("id");
		if (id) {
			const review = reviewStore.read(id);
			if (!review) {
				writeJson(response, 404, { error: { message: `Learning review not found: ${id}` } });
				return;
			}
			writeJson(response, 200, { review });
			return;
		}
		const limit = parseLimit(url.searchParams.get("limit"));
		const reviews = reviewStore.list();
		writeJson(response, 200, {
			count: reviews.length,
			proposals: reviews.filter((review) => review.status === "proposed").length,
			reviews: reviews.slice(0, limit),
		});
		return;
	}

	if (request.method === "GET" && isCuratorPath(url.pathname)) {
		writeJson(response, 200, {
			settings: settings.skills.curator,
			status: curator.status(),
		});
		return;
	}

	if ((request.method === "POST" || request.method === "PUT") && isCuratorPath(url.pathname)) {
		const body = await readJsonBody(request);
		const action = typeof body.action === "string" ? body.action : "";
		switch (action) {
			case "run":
				writeJson(response, 200, { result: curator.run({ dryRun: body.dryRun === true }) });
				return;
			case "pin":
				writeJson(response, 200, { skill: curator.pin(requireName(body)) });
				return;
			case "unpin":
				writeJson(response, 200, { skill: curator.unpin(requireName(body)) });
				return;
			case "archive":
				writeJson(response, 200, { archivedTo: curator.archive(requireName(body)) });
				return;
			case "restore":
				writeJson(response, 200, { restoredTo: curator.restore(requireName(body)) });
				return;
			case "backup":
				writeJson(response, 200, { backupPath: curator.backup() });
				return;
			case "prune":
				writeJson(response, 200, { result: curator.prune({ dryRun: body.dryRun === true }) });
				return;
			case "rollback":
				writeJson(response, 200, { result: curator.rollback(typeof body.backupPath === "string" ? body.backupPath : undefined) });
				return;
			case "settings": {
				const next = asObject(body.settings);
				settingsManager.setLearningCuratorSettings({
					staleAfterDays: asNumber(next.staleAfterDays),
					archiveAfterDays: asNumber(next.archiveAfterDays),
					pruneAfterDays: asNumber(next.pruneAfterDays),
					autoArchive: asBoolean(next.autoArchive),
					backupBeforeRun: asBoolean(next.backupBeforeRun),
				});
				await settingsManager.flush();
				writeJson(response, 200, { settings: settingsManager.getLearningSettings().skills.curator });
				return;
			}
			default:
				writeJson(response, 400, { error: { message: `Unknown curator action: ${action}` } });
				return;
		}
	}

	if ((request.method === "POST" || request.method === "PUT") && isReviewsPath(url.pathname)) {
		const body = await readJsonBody(request);
		const action = typeof body.action === "string" ? body.action : "";
		switch (action) {
			case "approve": {
				const review = requireReview(reviewStore, body.id);
				const reviewer = new BackgroundLearningReview({
					settings: settingsManager.getLearningSettings(),
					memoryStore,
					skillManager,
					reviewStore,
				});
				const appliedResults: ReviewActionResult[] = [];
				for (const result of review.results.filter((item) => item.status === "proposed")) {
					try {
						await reviewer.applyAction(result.action as ReviewAction);
						appliedResults.push({ ...result, status: "applied" });
					} catch (error) {
						appliedResults.push({
							...result,
							status: "failed",
							reason: error instanceof Error ? error.message : String(error),
						});
					}
				}
				const queue = [...appliedResults];
				const updated = reviewStore.write({
					...review,
					status: appliedResults.some((result) => result.status === "failed") ? "failed" : "applied",
					results: review.results.map((item) => (item.status === "proposed" ? (queue.shift() ?? item) : item)),
				});
				writeJson(response, 200, { review: updated });
				return;
			}
			case "reject": {
				const review = requireReview(reviewStore, body.id);
				const updated = reviewStore.write({
					...review,
					status: "skipped",
					results: review.results.map((item) =>
						item.status === "proposed" ? { ...item, status: "skipped", reason: "rejected by dashboard" } : item,
					),
				});
				writeJson(response, 200, { review: updated });
				return;
			}
			case "mode": {
				const mode = body.mode;
				if (mode !== "auto" && mode !== "suggest" && mode !== "off") {
					writeJson(response, 400, { error: { message: "mode must be one of: auto, suggest, off" } });
					return;
				}
				settingsManager.setLearningReviewMode(mode);
				await settingsManager.flush();
				writeJson(response, 200, { settings: settingsManager.getLearningSettings().review });
				return;
			}
			default:
				writeJson(response, 400, { error: { message: `Unknown review action: ${action}` } });
				return;
		}
	}

	writeJson(response, 404, {
		error: {
			message: "Not found",
			path: url.pathname,
		},
	});
}

function isCuratorPath(pathname: string): boolean {
	return pathname === "/learning/curator" || pathname === "/v1/learning/curator";
}

function isReviewsPath(pathname: string): boolean {
	return pathname === "/learning/reviews" || pathname === "/v1/learning/reviews";
}

function requireName(body: Record<string, unknown>): string {
	if (typeof body.name !== "string" || body.name.trim().length === 0) {
		throw new Error("name is required.");
	}
	return body.name.trim();
}

function requireReview(store: LearningReviewStore, value: unknown) {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("review id is required.");
	}
	const review = store.read(value.trim());
	if (!review) throw new Error(`Learning review not found: ${value}`);
	return review;
}

function parseLimit(value: string | null): number {
	const limit = Number(value ?? 20);
	return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
}

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return value;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	if (chunks.length === 0) return {};
	const text = Buffer.concat(chunks).toString("utf-8").trim();
	return text ? asObject(JSON.parse(text)) : {};
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
	response.writeHead(statusCode, {
		...CORS_HEADERS,
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}
