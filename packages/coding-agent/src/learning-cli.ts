import chalk from "chalk";
import { APP_NAME, getAgentDir } from "./config.ts";
import {
	BackgroundLearningReview,
	LearningReviewStore,
	MemoryStore,
	type ReviewAction,
	type ReviewActionResult,
	SkillManager,
} from "./core/learning/index.ts";
import { SettingsManager } from "./core/settings-manager.ts";

export async function handleLearningCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "learning") return false;
	const command = args[1] ?? "status";
	const json = args.includes("--json");
	if (command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h")) {
		printLearningHelp();
		return true;
	}

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(cwd, agentDir);
	const reviewStore = new LearningReviewStore({ agentDir });
	const memoryStore = new MemoryStore({ agentDir });
	const skillManager = new SkillManager({ agentDir, cwd });

	try {
		switch (command) {
			case "status": {
				const settings = settingsManager.getLearningSettings();
				const reviews = reviewStore.list();
				printResult(
					{
						settings,
						reviews: reviews.length,
						proposals: reviews.filter((review) => review.status === "proposed").length,
						latest: reviews[0],
					},
					json,
					(value) =>
						[
							`Learning: ${value.settings.enabled ? "enabled" : "disabled"}`,
							`Review mode: ${value.settings.review.mode}`,
							`Reviews: ${value.reviews}`,
							`Pending proposals: ${value.proposals}`,
							value.latest ? `Latest: ${value.latest.id} (${value.latest.status})` : "Latest: none",
						].join("\n"),
				);
				return true;
			}
			case "history": {
				const reviews = reviewStore.list().slice(0, parseLimit(args));
				printResult(reviews, json, formatReviewList);
				return true;
			}
			case "show": {
				const review = requireReview(reviewStore, args[2]);
				printResult(review, json, (value) => JSON.stringify(value, null, 2));
				return true;
			}
			case "proposals": {
				const reviews = reviewStore.list().filter((review) => review.status === "proposed");
				printResult(reviews, json, formatReviewList);
				return true;
			}
			case "approve": {
				const review = requireReview(reviewStore, args[2]);
				const reviewer = new BackgroundLearningReview({
					settings: settingsManager.getLearningSettings(),
					memoryStore,
					skillManager,
					reviewStore,
				});
				const results: ReviewActionResult[] = [];
				for (const result of review.results.filter((item) => item.status === "proposed")) {
					try {
						await reviewer.applyAction(result.action as ReviewAction);
						results.push({ ...result, status: "applied" as const });
					} catch (error) {
						results.push({
							...result,
							status: "failed" as const,
							reason: error instanceof Error ? error.message : String(error),
						});
					}
				}
				const updated = reviewStore.write({
					...review,
					status: results.some((result) => result.status === "failed") ? "failed" : "applied",
					results: review.results.map((item) => (item.status === "proposed" ? (results.shift() ?? item) : item)),
				});
				printResult(updated, json, () => `Approved ${review.id}`);
				return true;
			}
			case "reject": {
				const review = requireReview(reviewStore, args[2]);
				const updated = reviewStore.write({
					...review,
					status: "skipped",
					results: review.results.map((item) =>
						item.status === "proposed" ? { ...item, status: "skipped", reason: "rejected by user" } : item,
					),
				});
				printResult(updated, json, () => `Rejected ${review.id}`);
				return true;
			}
			case "mode": {
				const mode = args[2];
				if (mode !== "auto" && mode !== "suggest" && mode !== "off") {
					throw new Error("mode must be one of: auto, suggest, off");
				}
				settingsManager.setLearningReviewMode(mode);
				await settingsManager.flush();
				printResult(settingsManager.getLearningSettings().review, json, (value) => `Review mode: ${value.mode}`);
				return true;
			}
			default:
				throw new Error(`Unknown learning command: ${command}`);
		}
	} catch (error) {
		console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
		process.exitCode = 1;
		return true;
	}
}

function printLearningHelp(): void {
	console.log(`${chalk.bold(`${APP_NAME} learning`)} - inspect and approve background learning reviews

${chalk.bold("Usage:")}
  ${APP_NAME} learning status [--json]
  ${APP_NAME} learning history [--limit N] [--json]
  ${APP_NAME} learning show <review-id> [--json]
  ${APP_NAME} learning proposals [--json]
  ${APP_NAME} learning approve <review-id>
  ${APP_NAME} learning reject <review-id>
  ${APP_NAME} learning mode auto|suggest|off`);
}

function printResult<T>(value: T, json: boolean, format: (value: T) => string): void {
	console.log(json ? JSON.stringify(value, null, 2) : format(value));
}

function formatReviewList(reviews: ReturnType<LearningReviewStore["list"]>): string {
	if (reviews.length === 0) return "No learning reviews found.";
	return reviews
		.map(
			(review) =>
				`${review.createdAt} ${review.status.padEnd(8)} ${review.mode.padEnd(7)} ${review.id} actions:${review.actions.length}`,
		)
		.join("\n");
}

function requireReview(store: LearningReviewStore, id: string | undefined) {
	if (!id) throw new Error("review id is required.");
	const review = store.read(id);
	if (!review) throw new Error(`Learning review not found: ${id}`);
	return review;
}

function parseLimit(args: string[]): number {
	const index = args.indexOf("--limit");
	const value = index >= 0 ? Number(args[index + 1]) : 20;
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}
