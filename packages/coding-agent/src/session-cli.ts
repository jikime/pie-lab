/**
 * session-cli.ts — `pie session` subcommand
 *
 * Commands:
 *   pie session list                  List recent sessions (all sources)
 *   pie session list --source tui     Filter by source
 *   pie session list --limit 20       Limit results
 *   pie session list --json           JSON output
 *
 *   pie session search <query>        FTS5 full-text search
 *   pie session search <query> --source gateway-chat
 *   pie session search <query> --limit 5
 *   pie session search <query> --json
 */

import chalk from "chalk";
import { getAgentDir } from "./config.ts";
import { getSessionDB, ensureSessionDBIndexed } from "./core/session-db.ts";

// ─── Entry point ────────────────────────────────────────────────────────────

export async function handleSessionCommand(args: string[]): Promise<boolean> {
	if (args[0] !== "session") return false;

	const command = args[1] ?? "list";
	const isHelp = command === "--help" || command === "-h" || args.includes("--help") || args.includes("-h");

	if (isHelp) {
		printHelp();
		return true;
	}

	const agentDir = getAgentDir();

	// Kick off background indexing
	void ensureSessionDBIndexed(agentDir);

	const db = getSessionDB(agentDir);

	// Incremental ingest before any query
	try {
		db.ingest();
	} catch {
		// non-fatal
	}

	const json = args.includes("--json");
	const limit = parseLimit(args) ?? 20;
	const sources = parseSources(args);

	switch (command) {
		case "list": {
			const items = db.browse({ limit, sources });
			if (json) {
				console.log(JSON.stringify(items, null, 2));
			} else {
				printList(items);
			}
			return true;
		}

		case "search": {
			const query = args.slice(2).find((a) => !a.startsWith("-"));
			if (!query) {
				console.error(chalk.red("Usage: pie session search <query> [--source tui|gateway-reasoning|gateway-chat] [--limit N]"));
				process.exit(1);
			}
			const hits = db.search(query, { limit, sources });
			if (json) {
				console.log(JSON.stringify(hits, null, 2));
			} else {
				printSearch(hits, query);
			}
			return true;
		}

		default:
			console.error(chalk.red(`Unknown session command: ${command}`));
			printHelp();
			process.exit(1);
	}
}

// ─── Formatters ─────────────────────────────────────────────────────────────

type BrowseItem = ReturnType<ReturnType<typeof getSessionDB>["browse"]>[number];
type SearchHit  = ReturnType<ReturnType<typeof getSessionDB>["search"]>[number];

function sourceBadge(item: { source: string; service?: string }): string {
	if (item.source === "gateway-chat") {
		const svc = item.service ?? "chat";
		const color = svc === "discord" ? chalk.blue : svc === "telegram" ? chalk.cyan : chalk.green;
		return color(`[${svc}]`);
	}
	if (item.source === "gateway-reasoning") return chalk.magenta("[reasoning]");
	return chalk.yellow("[tui]");
}

function fmtDate(iso?: string): string {
	if (!iso) return "?";
	return iso.slice(0, 10);
}

function printList(items: BrowseItem[]): void {
	if (items.length === 0) {
		console.log(chalk.dim("No sessions found. Chat on any platform to populate the index."));
		return;
	}

	// Column widths
	const badgeW = 14;
	const dateW  = 10;
	const msgsW  = 6;

	const header = [
		chalk.bold("Source".padEnd(badgeW)),
		chalk.bold("Name / Channel".padEnd(36)),
		chalk.bold("Date".padEnd(dateW)),
		chalk.bold("Msgs".padStart(msgsW)),
	].join("  ");

	console.log(header);
	console.log(chalk.dim("─".repeat(header.replace(/\[[0-9;]*m/g, "").length)));

	for (const item of items) {
		const badge = sourceBadge(item).padEnd(badgeW + 10); // +10 for ANSI codes
		const label = (item.name ?? item.channelKey ?? item.sessionId.slice(0, 16)).slice(0, 36).padEnd(36);
		const date  = fmtDate(item.modifiedAt).padEnd(dateW);
		const msgs  = String(item.messageCount).padStart(msgsW);
		const preview = item.preview ? chalk.dim(`  ${item.preview.slice(0, 60)}`) : "";
		console.log(`${badge}  ${label}  ${date}  ${msgs}${preview}`);
	}

	console.log(chalk.dim(`\n${items.length} session(s). Use ${chalk.cyan("pie session search <query>")} to search.`));
}

function printSearch(hits: SearchHit[], query: string): void {
	if (hits.length === 0) {
		console.log(chalk.dim(`No sessions match "${query}".`));
		return;
	}

	console.log(chalk.bold(`\n${hits.length} result(s) for "${query}":\n`));

	for (let i = 0; i < hits.length; i++) {
		const hit = hits[i];
		const label = hit.name ?? hit.channelKey ?? hit.sessionId.slice(0, 16);
		const badge = sourceBadge(hit);

		console.log(`${chalk.bold(`${i + 1}.`)} ${badge} ${chalk.white(label)}  ${chalk.dim(fmtDate(hit.modifiedAt))}`);
		console.log(`   ${chalk.dim("…")} ${hit.snippet} ${chalk.dim("…")}`);

		if (hit.window.length > 0) {
			console.log(chalk.dim("   Context:"));
			for (const msg of hit.window.slice(0, 3)) {
				const role = msg.role === "user" ? chalk.cyan("You") : chalk.green("AI ");
				console.log(`   ${role}  ${chalk.dim(msg.text.slice(0, 100))}`);
			}
		}

		console.log(chalk.dim(`   sessionId: ${hit.sessionId}`));
		if (i < hits.length - 1) console.log();
	}
}

// ─── Arg parsers ────────────────────────────────────────────────────────────

function parseLimit(args: string[]): number | undefined {
	const idx = args.findIndex((a) => a === "--limit" || a === "-n");
	if (idx === -1) return undefined;
	const val = parseInt(args[idx + 1] ?? "", 10);
	return isNaN(val) ? undefined : val;
}

function parseSources(args: string[]): Array<"tui" | "gateway-reasoning" | "gateway-chat"> | undefined {
	const idx = args.findIndex((a) => a === "--source" || a === "-s");
	if (idx === -1) return undefined;
	const raw = args[idx + 1] ?? "";
	const valid = ["tui", "gateway-reasoning", "gateway-chat"] as const;
	const parts = raw.split(",").map((s) => s.trim()) as Array<(typeof valid)[number]>;
	const filtered = parts.filter((p) => (valid as readonly string[]).includes(p));
	return filtered.length > 0 ? filtered : undefined;
}

// ─── Help ────────────────────────────────────────────────────────────────────

function printHelp(): void {
	console.log(`
${chalk.bold("pie session")} — Browse and search past conversations

${chalk.bold("COMMANDS")}
  ${chalk.cyan("pie session list")}                List recent sessions from all platforms
  ${chalk.cyan("pie session search <query>")}      Full-text search across all sessions

${chalk.bold("OPTIONS")}
  ${chalk.cyan("--source <type>")}    Filter by source: ${chalk.dim("tui, gateway-reasoning, gateway-chat")}
  ${chalk.cyan("--limit <n>")}        Max results (default: 20)
  ${chalk.cyan("--json")}             Output raw JSON

${chalk.bold("EXAMPLES")}
  ${chalk.dim("pie session list")}
  ${chalk.dim("pie session list --source gateway-chat")}
  ${chalk.dim("pie session list --limit 50")}
  ${chalk.dim('pie session search "배포 이슈"')}
  ${chalk.dim('pie session search "auth bug" --source tui')}
  ${chalk.dim('pie session search "코드 리뷰" --limit 5 --json')}

${chalk.bold("SOURCES")}
  ${chalk.yellow("tui")}                CLI interactive sessions (${chalk.dim("~/.pie/agent/sessions/")})
  ${chalk.cyan("gateway-chat")}       Telegram / Discord / Web chat transcripts
  ${chalk.magenta("gateway-reasoning")}  Agent reasoning for gateway turns
`);
}
