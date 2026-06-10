/**
 * session_search agent tool — FTS5-backed cross-session recall.
 *
 * Three calling shapes (auto-detected):
 *   1. Discovery   — { query }           → search all sessions, return top hits with snippet + bookends
 *   2. Browse      — { }                 → list recent sessions chronologically
 *   3. Source filter — { query, sources } → limit to tui / gateway-reasoning / gateway-chat
 */

import { getAgentDir } from "../config.ts";
import type { ToolDefinition } from "./extensions/types.ts";
import { ensureSessionDBIndexed, getSessionDB } from "./session-db.ts";

const TOOL_NAME = "session_search";

function formatHits(hits: ReturnType<ReturnType<typeof getSessionDB>["search"]>): string {
	if (hits.length === 0) return "No matching sessions found.";
	return hits
		.map((h, i) => {
			const label = h.name ?? h.channelKey ?? h.sessionId.slice(0, 16);
			const sourceBadge =
				h.source === "gateway-chat"
					? `[${h.service ?? "chat"}]`
					: h.source === "gateway-reasoning"
						? "[reasoning]"
						: "[tui]";
			const lines: string[] = [
				`### ${i + 1}. ${sourceBadge} ${label}  (${h.modifiedAt?.slice(0, 10) ?? "?"})`,
				`> …${h.snippet}…`,
			];
			if (h.bookendStart.length > 0) lines.push(`**Start:**\n${h.bookendStart.map((s) => `  ${s}`).join("\n")}`);
			if (h.window.length > 0) {
				lines.push("**Context window:**");
				for (const m of h.window) lines.push(`  [${m.role}] ${m.speaker}: ${m.text.slice(0, 200)}`);
			}
			if (h.bookendEnd.length > 0) lines.push(`**End:**\n${h.bookendEnd.map((s) => `  ${s}`).join("\n")}`);
			lines.push(`sessionId: \`${h.sessionId}\``);
			return lines.join("\n");
		})
		.join("\n\n---\n\n");
}

function formatBrowse(items: ReturnType<ReturnType<typeof getSessionDB>["browse"]>): string {
	if (items.length === 0) return "No sessions found.";
	return items
		.map((item) => {
			const label = item.name ?? item.channelKey ?? item.sessionId.slice(0, 16);
			const badge =
				item.source === "gateway-chat"
					? `[${item.service ?? "chat"}]`
					: item.source === "gateway-reasoning"
						? "[reasoning]"
						: "[tui]";
			return `${badge} **${label}** (${item.modifiedAt?.slice(0, 10) ?? "?"}, ${item.messageCount} msgs)\n  ${item.preview}`;
		})
		.join("\n\n");
}

export function createSessionSearchToolDefinition(agentDir?: string): ToolDefinition {
	const dir = agentDir ?? getAgentDir();
	// Kick off background indexing when the tool is created.
	void ensureSessionDBIndexed(dir);

	return {
		name: TOOL_NAME,
		label: "Session Search",
		description: `Search past conversations across all sessions — TUI (CLI), Discord, and Telegram — using full-text search with Korean/CJK trigram support.

Three calling modes:
1. **Discovery** (with query): Full-text search. Returns top matching sessions with a highlighted snippet, goal/resolution bookends, and a ±3-message context window.
2. **Browse** (no query): Lists recent sessions chronologically with previews.
3. **Source filter**: Limit results to specific session types via the \`sources\` field.

Use this to answer: "What did we discuss about X last month?", "Find where we solved the auth issue", "What's been happening in the Discord channel?".

The index covers three sources:
- \`tui\` — CLI interactive sessions (~/.pie/agent/sessions/)
- \`gateway-reasoning\` — agent reasoning for Discord/Telegram turns (~/.pie/agent/gateway/sessions/)
- \`gateway-chat\` — raw Discord/Telegram chat transcripts (~/.pie/agent/chat/)`,
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description:
						'Full-text query. Supports boolean operators (AND, OR, NOT), quoted phrases ("exact phrase"), and prefix wildcards (deploy*). Leave empty to browse recent sessions.',
				},
				sources: {
					type: "array",
					items: { type: "string", enum: ["tui", "gateway-reasoning", "gateway-chat"] },
					description: "Limit search to specific session types. Omit for all sources.",
				},
				limit: {
					type: "number",
					description: "Maximum number of sessions to return (default: 10, max: 50).",
				},
			},
			additionalProperties: false,
		},
		execute: async (_toolCallId: string, params: { query?: string; sources?: string[]; limit?: number }) => {
			const db = getSessionDB(dir);

			// Always run a quick incremental ingest before searching.
			try {
				db.ingest();
			} catch {
				// Non-fatal
			}

			const limit = Math.min(params.limit ?? 10, 50);
			const sources = params.sources as Array<"tui" | "gateway-reasoning" | "gateway-chat"> | undefined;

			let text: string;
			if (params.query?.trim()) {
				const hits = db.search(params.query, { limit, sources });
				text = formatHits(hits);
			} else {
				const items = db.browse({ limit, sources });
				text = formatBrowse(items);
			}

			return { content: [{ type: "text" as const, text }], details: undefined };
		},
	};
}
