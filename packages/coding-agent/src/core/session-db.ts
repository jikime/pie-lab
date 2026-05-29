/**
 * SessionDB — SQLite + FTS5 unified session index for pie-lab.
 *
 * Covers three JSONL sources:
 *   - TUI sessions:              ~/.pie/agent/sessions/<cwd>/*.jsonl
 *   - Gateway reasoning sessions:~/.pie/agent/gateway/sessions/<key>/*.jsonl
 *   - Gateway chat transcripts:  ~/.pie/agent/chat/accounts/ACCOUNT/channels/CHANNEL/channel.jsonl
 *
 * Uses node:sqlite (Node 22+, experimental) with FTS5 trigram tokenizer for
 * Korean / CJK substring search.
 *
 * All DB writes are synchronous (DatabaseSync); reads are async-friendly via
 * wrappers that call into the sync API.
 */

// Suppress the Node 22 experimental sqlite warning in production.
process.emitWarning = (
	(orig) =>
	(msg: string, ...rest: unknown[]) => {
		if (typeof msg === "string" && msg.includes("SQLite is an experimental")) return;
		return (orig as (...args: unknown[]) => void)(msg, ...rest);
	}
)(process.emitWarning);

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite"; // eslint-disable-line import/no-unresolved
import { getAgentDir, getSessionsDir } from "../config.js";

// ---------------------------------------------------------------------------
// Types matching the JSONL formats in pie-lab
// ---------------------------------------------------------------------------

type SessionSource = "tui" | "gateway-reasoning" | "gateway-chat";

interface SessionRow {
	rowid: number;
	id: string;
	source: SessionSource;
	path: string;
	cwd: string | null;
	session_key: string | null;
	service: string | null;
	account_id: string | null;
	channel_key: string | null;
	channel_id: string | null;
	name: string | null;
	created_at: string | null;
	modified_at: string | null;
	message_count: number;
	indexed_mtime: number;
}

export interface SessionSearchHit {
	sessionId: string;
	source: SessionSource;
	service?: string;
	channelKey?: string;
	name?: string;
	createdAt?: string;
	modifiedAt?: string;
	/** FTS5-highlighted snippet around the match. */
	snippet: string;
	/** First few messages for context (goal/kickoff). */
	bookendStart: string[];
	/** Last few messages for context (resolution). */
	bookendEnd: string[];
	/** Messages ±window around the matching entry. */
	window: Array<{ role: string; speaker: string; text: string; timestamp: string }>;
}

export interface SessionBrowseItem {
	sessionId: string;
	source: SessionSource;
	service?: string;
	channelKey?: string;
	name?: string;
	createdAt?: string;
	modifiedAt?: string;
	messageCount: number;
	preview: string;
}

// ---------------------------------------------------------------------------
// DB schema
// ---------------------------------------------------------------------------

const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  rowid       INTEGER PRIMARY KEY,
  id          TEXT    UNIQUE NOT NULL,
  source      TEXT    NOT NULL,
  path        TEXT    UNIQUE NOT NULL,
  cwd         TEXT,
  session_key TEXT,
  service     TEXT,
  account_id  TEXT,
  channel_key TEXT,
  channel_id  TEXT,
  name        TEXT,
  created_at  TEXT,
  modified_at TEXT,
  message_count INTEGER DEFAULT 0,
  indexed_mtime INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sessions_source       ON sessions(source);
CREATE INDEX IF NOT EXISTS sessions_modified_at  ON sessions(modified_at);
CREATE INDEX IF NOT EXISTS sessions_service      ON sessions(service, channel_key);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_rowid UNINDEXED,
  entry_id      UNINDEXED,
  role,
  speaker,
  text,
  timestamp     UNINDEXED,
  tokenize = 'trigram'
);
`;

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

export class SessionDB {
	private readonly db: DatabaseSync;
	private readonly agentDir: string;

	constructor(dbPath?: string, agentDir?: string) {
		this.agentDir = agentDir ?? getAgentDir();
		const path = dbPath ?? join(this.agentDir, "sessions.db");
		this.db = new DatabaseSync(path);
		this.db.exec(DDL);
	}

	close(): void {
		this.db.close();
	}

	// -------------------------------------------------------------------------
	// Ingestion
	// -------------------------------------------------------------------------

	/** Incrementally re-index all three JSONL sources. Returns stats. */
	ingest(): { indexed: number; skipped: number; errors: number } {
		let indexed = 0;
		let skipped = 0;
		let errors = 0;

		const process = (files: Array<{ path: string; source: SessionSource; meta: Record<string, string | null> }>) => {
			for (const f of files) {
				try {
					const mtime = statSync(f.path).mtimeMs;
					const existing = this.db.prepare("SELECT indexed_mtime FROM sessions WHERE path = ?").get(f.path) as
						| { indexed_mtime: number }
						| undefined;
					if (existing && existing.indexed_mtime >= Math.floor(mtime)) {
						skipped++;
						continue;
					}
					this.indexFile(f.path, f.source, f.meta, Math.floor(mtime));
					indexed++;
				} catch {
					errors++;
				}
			}
		};

		process(this.discoverTuiFiles());
		process(this.discoverGatewayReasoningFiles());
		process(this.discoverGatewayChatFiles());

		return { indexed, skipped, errors };
	}

	private discoverTuiFiles(): Array<{ path: string; source: SessionSource; meta: Record<string, string | null> }> {
		const sessionsRoot = getSessionsDir();
		if (!existsSync(sessionsRoot)) return [];
		const files: Array<{ path: string; source: SessionSource; meta: Record<string, string | null> }> = [];
		// Walk all subdirectories — covers CLI sessions (<encoded-cwd>/) and
		// web-chat sessions (web-chat/) in the same root.
		for (const sub of safeReaddir(sessionsRoot)) {
			const subPath = join(sessionsRoot, sub);
			if (!statSync(subPath).isDirectory()) continue;
			for (const f of safeReaddir(subPath)) {
				if (!f.endsWith(".jsonl")) continue;
				files.push({ path: join(subPath, f), source: "tui", meta: {} });
			}
		}
		return files;
	}

	private discoverGatewayReasoningFiles(): Array<{
		path: string;
		source: SessionSource;
		meta: Record<string, string | null>;
	}> {
		const root = join(this.agentDir, "gateway", "sessions");
		if (!existsSync(root)) return [];
		const files: Array<{ path: string; source: SessionSource; meta: Record<string, string | null> }> = [];
		for (const sessionKey of safeReaddir(root)) {
			const keyPath = join(root, sessionKey);
			if (!statSync(keyPath).isDirectory()) continue;
			for (const f of safeReaddir(keyPath)) {
				if (!f.endsWith(".jsonl")) continue;
				files.push({ path: join(keyPath, f), source: "gateway-reasoning", meta: { session_key: sessionKey } });
			}
		}
		return files;
	}

	private discoverGatewayChatFiles(): Array<{
		path: string;
		source: SessionSource;
		meta: Record<string, string | null>;
	}> {
		const root = join(this.agentDir, "chat", "accounts");
		if (!existsSync(root)) return [];
		const files: Array<{ path: string; source: SessionSource; meta: Record<string, string | null> }> = [];
		for (const accountId of safeReaddir(root)) {
			const accountPath = join(root, accountId);
			if (!statSync(accountPath).isDirectory()) continue;
			// Read account config to get service name
			let service: string | null = null;
			try {
				const cfg = JSON.parse(readFileSync(join(this.agentDir, "chat", "config.json"), "utf-8")) as {
					accounts?: Record<string, { service?: string }>;
				};
				service = cfg.accounts?.[accountId]?.service ?? null;
			} catch {
				// config might not exist yet
			}
			const channelsPath = join(accountPath, "channels");
			if (!existsSync(channelsPath)) continue;
			for (const channelKey of safeReaddir(channelsPath)) {
				const channelPath = join(channelsPath, channelKey);
				if (!statSync(channelPath).isDirectory()) continue;
				const logPath = join(channelPath, "channel.jsonl");
				if (!existsSync(logPath)) continue;
				files.push({
					path: logPath,
					source: "gateway-chat",
					meta: { account_id: accountId, channel_key: channelKey, service },
				});
			}
		}
		return files;
	}

	private indexFile(path: string, source: SessionSource, meta: Record<string, string | null>, mtime: number): void {
		const content = readFileSync(path, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		if (source === "tui" || source === "gateway-reasoning") {
			this.indexAgentSessionFile(path, source, meta, mtime, lines);
		} else {
			this.indexChatTranscriptFile(path, meta, mtime, lines);
		}
	}

	private indexAgentSessionFile(
		path: string,
		source: SessionSource,
		meta: Record<string, string | null>,
		mtime: number,
		lines: string[],
	): void {
		if (lines.length === 0) return;
		const header = tryParse(lines[0]) as { type?: string; id?: string; timestamp?: string; cwd?: string } | null;
		if (!header || header.type !== "session" || !header.id) return;

		const sessionId = header.id;
		let name: string | null = null;
		const createdAt: string | null = header.timestamp ?? null;
		let messageCount = 0;
		const messages: Array<{ entryId: string; role: string; speaker: string; text: string; timestamp: string }> = [];

		for (const line of lines.slice(1)) {
			const entry = tryParse(line) as {
				type?: string;
				id?: string;
				name?: string;
				timestamp?: string;
				message?: { role?: string; content?: unknown; timestamp?: number };
			} | null;
			if (!entry) continue;
			if (entry.type === "session_info" && entry.name) {
				name = entry.name;
			}
			if (entry.type === "message" && entry.message?.role) {
				const role = entry.message.role;
				if (role !== "user" && role !== "assistant") continue;
				const text = extractAgentMessageText(entry.message);
				if (!text) continue;
				messageCount++;
				const ts =
					typeof entry.message.timestamp === "number"
						? new Date(entry.message.timestamp).toISOString()
						: (entry.timestamp ?? createdAt ?? "");
				messages.push({ entryId: entry.id ?? String(messageCount), role, speaker: role, text, timestamp: ts });
			}
		}

		if (messageCount === 0) return; // empty session

		const modifiedAt = messages.at(-1)?.timestamp ?? createdAt;
		const cwd = source === "tui" ? (meta.cwd ?? header.cwd ?? decodeCwdFromPath(path)) : null;
		const sessionKey = source === "gateway-reasoning" ? (meta.session_key ?? null) : null;

		this.upsertSession({
			id: sessionId,
			source,
			path,
			cwd,
			session_key: sessionKey,
			service: null,
			account_id: null,
			channel_key: null,
			channel_id: null,
			name,
			created_at: createdAt,
			modified_at: modifiedAt ?? null,
			message_count: messageCount,
			indexed_mtime: mtime,
		});

		const rowid = this.getSessionRowid(sessionId);
		if (rowid === undefined) return;

		// Clear old FTS rows for this session.
		this.db.prepare("DELETE FROM messages_fts WHERE session_rowid = ?").run(rowid);
		for (const msg of messages) {
			this.db
				.prepare("INSERT INTO messages_fts(session_rowid,entry_id,role,speaker,text,timestamp) VALUES(?,?,?,?,?,?)")
				.run(rowid, msg.entryId, msg.role, msg.speaker, msg.text, msg.timestamp);
		}
	}

	private indexChatTranscriptFile(
		path: string,
		meta: Record<string, string | null>,
		mtime: number,
		lines: string[],
	): void {
		const accountId = meta.account_id ?? "";
		const channelKey = meta.channel_key ?? "";
		const service = meta.service ?? null;
		// Use "<accountId>/<channelKey>" as a stable session ID for chat transcripts.
		const sessionId = `chat:${accountId}/${channelKey}`;

		let messageCount = 0;
		let createdAt: string | null = null;
		let modifiedAt: string | null = null;
		let channelId: string | null = null;
		const messages: Array<{ entryId: string; role: string; speaker: string; text: string; timestamp: string }> = [];

		for (const line of lines) {
			const record = tryParse(line) as {
				recordId?: number;
				type?: string;
				timestamp?: string;
				text?: string;
				userName?: string;
				channelId?: string;
			} | null;
			if (!record) continue;
			if (record.channelId) channelId ??= record.channelId;
			if (record.type !== "inbound" && record.type !== "outbound") continue;
			const text = record.text?.trim();
			if (!text) continue;
			const ts = record.timestamp ?? "";
			if (!createdAt || ts < createdAt) createdAt = ts;
			if (!modifiedAt || ts > modifiedAt) modifiedAt = ts;
			const role = record.type === "inbound" ? "user" : "assistant";
			const speaker = record.type === "inbound" ? (record.userName ?? "user") : "assistant";
			messages.push({ entryId: String(record.recordId ?? messageCount), role, speaker, text, timestamp: ts });
			messageCount++;
		}

		if (messageCount === 0) return;

		this.upsertSession({
			id: sessionId,
			source: "gateway-chat",
			path,
			cwd: null,
			session_key: null,
			service,
			account_id: accountId,
			channel_key: channelKey,
			channel_id: channelId,
			name: `${service ?? accountId} / ${channelKey}`,
			created_at: createdAt,
			modified_at: modifiedAt,
			message_count: messageCount,
			indexed_mtime: mtime,
		});

		const rowid = this.getSessionRowid(sessionId);
		if (rowid === undefined) return;

		this.db.prepare("DELETE FROM messages_fts WHERE session_rowid = ?").run(rowid);
		for (const msg of messages) {
			this.db
				.prepare("INSERT INTO messages_fts(session_rowid,entry_id,role,speaker,text,timestamp) VALUES(?,?,?,?,?,?)")
				.run(rowid, msg.entryId, msg.role, msg.speaker, msg.text, msg.timestamp);
		}
	}

	// -------------------------------------------------------------------------
	// Search
	// -------------------------------------------------------------------------

	/** Full-text search across all indexed sessions. */
	search(query: string, options?: { limit?: number; sources?: SessionSource[] }): SessionSearchHit[] {
		const limit = options?.limit ?? 10;
		const sources = options?.sources;

		let ftsQuery = query.trim();
		if (!ftsQuery) return [];

		// Escape FTS5 special chars that aren't intentional operators.
		if (!ftsQuery.includes('"') && !ftsQuery.includes("OR") && !ftsQuery.includes("AND")) {
			// Wrap in phrase for exact match first; fall back to terms.
			ftsQuery = `"${ftsQuery.replace(/"/g, '""')}"`;
		}

		// Node.js built-in SQLite does not support FTS5 auxiliary functions (snippet,
		// highlight, bm25) in subqueries or JOINs — only when the FTS table is the
		// sole FROM clause. We therefore use a two-query approach:
		//   Step 1: Run plain FTS5 MATCH to get (session_rowid, text) ordered by rank.
		//           Fetch limit*5 rows so we have enough to deduplicate across sources.
		//   Step 2: Fetch session metadata from the sessions table by rowid.
		//   Step 3: Build snippet manually in JS from the matching text.
		//
		// FTS5 trigram tokenizer requires ≥3 characters per search term. For shorter
		// queries (e.g. 2-char Korean words like "안녕") we fall back to a LIKE scan
		// on the FTS shadow table — slower but correct.

		type FtsRow = { session_rowid: number; text: string };

		const termLen = query.trim().replace(/^"|"$/g, "").length;
		const useLikeFallback = termLen < 3;

		let ftsRows: FtsRow[];

		if (useLikeFallback) {
			// LIKE-based full scan — no ranking, but works for short terms.
			const likeSQL = `
				SELECT session_rowid, text
				FROM messages_fts
				WHERE text LIKE ?
				LIMIT ?
			`;
			const likeTerm = `%${query.trim().replace(/^"|"$/g, "")}%`;
			try {
				ftsRows = (this.db.prepare(likeSQL) as StatementSync).all(likeTerm, limit * 5) as FtsRow[];
			} catch {
				return [];
			}
		} else {
			const ftsSQL = `
				SELECT session_rowid, text
				FROM messages_fts
				WHERE messages_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`;

			const fetchFts = (q: string): FtsRow[] =>
				(this.db.prepare(ftsSQL) as StatementSync).all(q, limit * 5) as FtsRow[];

			try {
				ftsRows = fetchFts(ftsQuery);
			} catch {
				try {
					const plain = `"${query.trim().replace(/"/g, '""')}"`;
					ftsRows = fetchFts(plain);
				} catch {
					return [];
				}
			}
		}

		if (ftsRows.length === 0) return [];

		// Deduplicate by session_rowid — keep first (best-ranked) match per session.
		const seenRowids = new Set<number>();
		const bestMatchText = new Map<number, string>();
		for (const row of ftsRows) {
			if (!seenRowids.has(row.session_rowid)) {
				seenRowids.add(row.session_rowid);
				bestMatchText.set(row.session_rowid, row.text);
				if (seenRowids.size >= limit * 3) break; // over-fetch for source filtering
			}
		}

		const rowids = [...seenRowids];
		const placeholders = rowids.map(() => "?").join(",");
		const sourceFilter = sources && sources.length > 0 ? `AND source IN (${sources.map(() => "?").join(",")})` : "";

		const sessionSQL = `
			SELECT id, source, service, channel_key, name, created_at, modified_at, rowid
			FROM sessions
			WHERE rowid IN (${placeholders}) ${sourceFilter}
			LIMIT ?
		`;

		type SessionRow2 = {
			id: string;
			source: SessionSource;
			service: string | null;
			channel_key: string | null;
			name: string | null;
			created_at: string | null;
			modified_at: string | null;
			rowid: number;
		};

		const sessionRows = (this.db.prepare(sessionSQL) as StatementSync).all(
			...rowids,
			...(sources ?? []),
			limit,
		) as SessionRow2[];

		// Restore rank order from FTS step.
		const rowidOrder = new Map<number, number>();
		rowids.forEach((rid, i) => {
			rowidOrder.set(rid, i);
		});
		sessionRows.sort((a, b) => (rowidOrder.get(a.rowid) ?? 999) - (rowidOrder.get(b.rowid) ?? 999));

		return sessionRows.map((session) => {
			const matchText = bestMatchText.get(session.rowid) ?? "";
			const snippet = makeTextSnippet(matchText, query.trim().replace(/^"|"$/g, ""), 120);
			const window = this.getWindowAroundMatch(session.rowid, query, 3);
			const all = this.getSessionMessages(session.rowid);
			return {
				sessionId: session.id,
				source: session.source,
				service: session.service ?? undefined,
				channelKey: session.channel_key ?? undefined,
				name: session.name ?? undefined,
				createdAt: session.created_at ?? undefined,
				modifiedAt: session.modified_at ?? undefined,
				snippet,
				bookendStart: all.slice(0, 2).map((m) => `${m.speaker}: ${m.text}`),
				bookendEnd: all.slice(-2).map((m) => `${m.speaker}: ${m.text}`),
				window,
			};
		});
	}

	/** Browse recent sessions without a query. */
	browse(options?: { limit?: number; sources?: SessionSource[] }): SessionBrowseItem[] {
		const limit = options?.limit ?? 20;
		const sources = options?.sources;
		const sourceFilter = sources && sources.length > 0 ? `WHERE source IN (${sources.map(() => "?").join(",")})` : "";

		const sql = `
			SELECT id, source, service, channel_key, name, created_at, modified_at, message_count, rowid
			FROM sessions
			${sourceFilter}
			ORDER BY COALESCE(modified_at, created_at) DESC
			LIMIT ?
		`;
		const rows = this.db.prepare(sql).all(...(sources ?? []), limit) as Array<{
			id: string;
			source: SessionSource;
			service: string | null;
			channel_key: string | null;
			name: string | null;
			created_at: string | null;
			modified_at: string | null;
			message_count: number;
			rowid: number;
		}>;

		return rows.map((row) => {
			const first = this.getSessionMessages(row.rowid).slice(0, 1)[0];
			return {
				sessionId: row.id,
				source: row.source,
				service: row.service ?? undefined,
				channelKey: row.channel_key ?? undefined,
				name: row.name ?? undefined,
				createdAt: row.created_at ?? undefined,
				modifiedAt: row.modified_at ?? undefined,
				messageCount: row.message_count,
				preview: first ? `${first.speaker}: ${first.text.slice(0, 120)}` : "",
			};
		});
	}

	/** Get a ±window slice of messages around the first FTS hit in a session. */
	private getWindowAroundMatch(
		sessionRowid: number,
		query: string,
		windowSize: number,
	): Array<{ role: string; speaker: string; text: string; timestamp: string }> {
		const all = this.getSessionMessages(sessionRowid);
		if (all.length === 0) return [];
		// Find first message whose text contains any query token.
		const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
		let hitIdx = all.findIndex((m) => tokens.some((t) => m.text.toLowerCase().includes(t)));
		if (hitIdx < 0) hitIdx = 0;
		const start = Math.max(0, hitIdx - windowSize);
		const end = Math.min(all.length, hitIdx + windowSize + 1);
		return all.slice(start, end);
	}

	private getSessionMessages(
		sessionRowid: number,
	): Array<{ role: string; speaker: string; text: string; timestamp: string }> {
		return (
			this.db
				.prepare("SELECT role, speaker, text, timestamp FROM messages_fts WHERE session_rowid = ? ORDER BY rowid")
				.all(sessionRowid) as Array<{ role: string; speaker: string; text: string; timestamp: string }>
		).map((r) => ({ ...r, text: r.text.slice(0, 500) }));
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private upsertSession(row: Omit<SessionRow, "rowid">): void {
		this.db
			.prepare(
				`INSERT INTO sessions(id,source,path,cwd,session_key,service,account_id,channel_key,channel_id,name,created_at,modified_at,message_count,indexed_mtime)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           path=excluded.path, name=excluded.name, modified_at=excluded.modified_at,
           message_count=excluded.message_count, indexed_mtime=excluded.indexed_mtime`,
			)
			.run(
				row.id,
				row.source,
				row.path,
				row.cwd,
				row.session_key,
				row.service,
				row.account_id,
				row.channel_key,
				row.channel_id,
				row.name,
				row.created_at,
				row.modified_at,
				row.message_count,
				row.indexed_mtime,
			);
	}

	private getSessionRowid(sessionId: string): number | undefined {
		const row = this.db.prepare("SELECT rowid FROM sessions WHERE id = ?").get(sessionId) as
			| { rowid: number }
			| undefined;
		return row?.rowid;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a plain-text snippet from `text` that highlights the first occurrence
 * of `term`. Returns up to `maxLen` characters with leading/trailing "…".
 * Since Node.js built-in SQLite does not support FTS5 snippet() in subqueries
 * or JOINs, we generate snippets in JavaScript instead.
 */
function makeTextSnippet(text: string, term: string, maxLen: number): string {
	if (!text) return "";
	const lower = text.toLowerCase();
	const termLower = term.toLowerCase();
	const idx = termLower ? lower.indexOf(termLower) : -1;

	if (idx === -1) {
		// Term not found in this text — return start of text
		return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
	}

	// Center snippet around the match
	const pad = Math.floor((maxLen - termLower.length) / 2);
	const start = Math.max(0, idx - pad);
	const end = Math.min(text.length, idx + termLower.length + pad);

	let snippet = text.slice(start, end);
	// Highlight the matched portion with brackets (matches FTS5 snippet convention)
	const relIdx = idx - start;
	snippet =
		snippet.slice(0, relIdx) +
		"[" +
		snippet.slice(relIdx, relIdx + termLower.length) +
		"]" +
		snippet.slice(relIdx + termLower.length);

	if (start > 0) snippet = `…${snippet}`;
	if (end < text.length) snippet = `${snippet}…`;
	return snippet;
}

function tryParse(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}

function extractAgentMessageText(message: { role?: string; content?: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (Array.isArray(content)) {
		return content
			.filter((b): b is { type: string; text: string } => b && typeof b === "object" && b.type === "text")
			.map((b) => b.text)
			.join(" ")
			.trim();
	}
	return "";
}

/** Attempt to decode the project path from the encoded session subdirectory name. */
function decodeCwdFromPath(filePath: string): string | null {
	const parts = filePath.split("/");
	const sessionsIdx = parts.lastIndexOf("sessions");
	if (sessionsIdx < 0 || sessionsIdx + 1 >= parts.length) return null;
	const encoded = parts[sessionsIdx + 1];
	// Reverse the "--path--" encoding from getDefaultSessionDir()
	return encoded ? `/${encoded.replace(/^--/, "").replace(/--$/, "").replace(/--/g, "/")}` : null;
}

function safeReaddir(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Singleton + async ingest helper
// ---------------------------------------------------------------------------

let _instance: SessionDB | undefined;

export function getSessionDB(agentDir?: string): SessionDB {
	if (!_instance) {
		_instance = new SessionDB(undefined, agentDir);
	}
	return _instance;
}

/** Ensure the DB directory exists and run incremental ingest in the background. */
export async function ensureSessionDBIndexed(agentDir?: string): Promise<void> {
	const dir = agentDir ?? getAgentDir();
	await mkdir(dir, { recursive: true });
	// Run in background — don't block startup.
	setImmediate(() => {
		try {
			getSessionDB(dir).ingest();
		} catch {
			// Non-fatal — search may be stale until next run.
		}
	});
}
