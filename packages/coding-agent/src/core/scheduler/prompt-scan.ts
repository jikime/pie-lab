/**
 * Injection scanning for scheduled jobs.
 *
 * Two tiers:
 * - Create-time (`assertSafeCronPrompt`): strict patterns applied to the short,
 *   user-authored job prompt when a job is created or updated.
 * - Fire-time (`assertSafeCronContent`): injection-focused patterns applied to
 *   content assembled into the prompt at execution time — loaded skill files,
 *   pre-run script output, and context pulled from other jobs. These inputs can
 *   carry text the user never reviewed (e.g. fetched web content), so they are
 *   scanned on every run.
 */

interface ScanPattern {
	label: string;
	pattern: RegExp;
}

// Injection-focused patterns safe to run against arbitrary assembled content.
// Deliberately excludes broad matches like "api key" that legitimate skill
// docs or monitoring output would trip.
const INJECTION_PATTERNS: ScanPattern[] = [
	{ label: "prompt-injection", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
	{ label: "prompt-injection", pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i },
	{ label: "system-prompt-probe", pattern: /reveal\s+(the\s+)?system\s+prompt/i },
	{ label: "deception", pattern: /\b(do\s+not|don'?t)\s+(tell|inform|notify|alert)\s+the\s+user\b/i },
	{ label: "deception", pattern: /\bhide\s+(this|it)\s+from\s+the\s+user\b/i },
	{ label: "destructive", pattern: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)[a-z]*\s+[~/]/i },
	{ label: "credential-theft", pattern: /(steal|leak|exfiltrat\w*)\s+(secrets?|tokens?|credentials?|keys?)/i },
	{ label: "credential-theft", pattern: /authorized_keys|\/etc\/sudoers/i },
	{ label: "exfiltration", pattern: /\b(curl|wget)\b[^\n]{0,200}\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)/ },
	// Bidi/zero-width controls used to smuggle hidden instructions.
	// U+200D (ZWJ) is excluded — it appears in legitimate emoji sequences.
	{ label: "invisible-unicode", pattern: /[\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069]/ },
];

// Stricter additions for the user-authored prompt at create/update time.
const STRICT_PROMPT_PATTERNS: ScanPattern[] = [
	...INJECTION_PATTERNS,
	{ label: "credential-theft", pattern: /exfiltrat(e|ion)/i },
	{ label: "credential-theft", pattern: /(api|access|secret)\s*key/i },
	{ label: "credential-theft", pattern: /read\s+.*\.env/i },
];

function findMatch(text: string, patterns: ScanPattern[]): string | undefined {
	for (const { label, pattern } of patterns) {
		if (pattern.test(text)) return label;
	}
	return undefined;
}

/** Throws if a user-authored job prompt contains unsafe instruction-like text. */
export function assertSafeCronPrompt(prompt: string): void {
	if (findMatch(prompt, STRICT_PROMPT_PATTERNS)) {
		throw new Error("Scheduled job prompt contains unsafe instruction-like text.");
	}
}

/**
 * Throws if content assembled into a scheduled job prompt at fire time
 * (skill files, script output, context from other jobs) looks like an
 * injection attempt. `source` names the offending input for the job log.
 */
export function assertSafeCronContent(text: string, source: string): void {
	const label = findMatch(text, INJECTION_PATTERNS);
	if (label) {
		throw new Error(`Scheduled job blocked: ${source} contains unsafe instruction-like text (${label}).`);
	}
}
