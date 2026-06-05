import { isAbsolute, relative, resolve, sep } from "node:path";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { type Component, getCapabilities, truncateToWidth } from "@pie-lab/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { detectTerminalBackground, theme } from "../theme/theme.ts";

type FooterColor = {
	rgb: [number, number, number];
	color256: number;
};

type FooterPalette = {
	label: FooterColor;
	value: FooterColor;
	primary: FooterColor;
	secondary: FooterColor;
	path: FooterColor;
	model: FooterColor;
	status: FooterColor;
	warning: FooterColor;
	error: FooterColor;
	muted: FooterColor;
};

type FooterColorName = keyof FooterPalette;

const FOOTER_PALETTES: Record<"dark" | "light" | "universal", FooterPalette> = {
	dark: {
		label: { rgb: [106, 120, 138], color256: 66 },
		value: { rgb: [170, 178, 190], color256: 248 },
		primary: { rgb: [106, 150, 184], color256: 73 },
		secondary: { rgb: [96, 154, 150], color256: 73 },
		path: { rgb: [98, 152, 126], color256: 72 },
		model: { rgb: [178, 132, 92], color256: 137 },
		status: { rgb: [112, 154, 120], color256: 108 },
		warning: { rgb: [184, 154, 84], color256: 137 },
		error: { rgb: [184, 104, 104], color256: 131 },
		muted: { rgb: [88, 100, 116], color256: 243 },
	},
	light: {
		label: { rgb: [82, 94, 110], color256: 240 },
		value: { rgb: [36, 46, 62], color256: 236 },
		primary: { rgb: [52, 98, 144], color256: 25 },
		secondary: { rgb: [48, 110, 122], color256: 30 },
		path: { rgb: [52, 114, 86], color256: 29 },
		model: { rgb: [138, 86, 52], color256: 130 },
		status: { rgb: [64, 118, 82], color256: 29 },
		warning: { rgb: [130, 98, 36], color256: 94 },
		error: { rgb: [136, 60, 60], color256: 124 },
		muted: { rgb: [106, 116, 130], color256: 243 },
	},
	universal: {
		label: { rgb: [86, 98, 114], color256: 240 },
		value: { rgb: [62, 74, 90], color256: 240 },
		primary: { rgb: [62, 108, 146], color256: 25 },
		secondary: { rgb: [58, 118, 126], color256: 30 },
		path: { rgb: [62, 122, 92], color256: 29 },
		model: { rgb: [146, 96, 58], color256: 130 },
		status: { rgb: [72, 126, 88], color256: 29 },
		warning: { rgb: [140, 108, 44], color256: 94 },
		error: { rgb: [146, 68, 68], color256: 124 },
		muted: { rgb: [106, 116, 130], color256: 243 },
	},
};

function getFooterPalette(): FooterPalette {
	const detection = detectTerminalBackground();
	if (detection.confidence === "high") {
		return FOOTER_PALETTES[detection.theme];
	}
	if (theme.name === "light" || theme.name === "dark") {
		return FOOTER_PALETTES[theme.name];
	}
	return FOOTER_PALETTES.universal;
}

function footerFg(text: string, colorName: FooterColorName, bold = false): string {
	const color = getFooterPalette()[colorName];
	const ansi = getCapabilities().trueColor
		? `\x1b[38;2;${color.rgb[0]};${color.rgb[1]};${color.rgb[2]}m`
		: `\x1b[38;5;${color.color256}m`;
	const styled = `${bold ? "\x1b[1m" : ""}${ansi}${text}\x1b[39m${bold ? "\x1b[22m" : ""}`;
	return styled;
}

/**
 * Sanitize text for display in a single-line status.
 * Removes newlines, tabs, carriage returns, and other control characters.
 */
function sanitizeStatusText(text: string): string {
	// Replace newlines, tabs, carriage returns with space, then collapse multiple spaces
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/**
 * Format token counts for compact footer display.
 */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;

	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const isInsideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!isInsideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function footerLabel(text: string): string {
	return footerFg(text, "label");
}

function footerValue(text: string, color: FooterColorName = "value", bold = false): string {
	return footerFg(text, color, bold);
}

function footerMetric(label: string, value: string, color: FooterColorName = "value", bold = false): string {
	return `${footerLabel(label)} ${footerValue(value, color, bold)}`;
}

function joinFooterParts(parts: string[]): string {
	return parts.filter(Boolean).join(footerFg(" | ", "muted"));
}

function formatCost(totalCost: number, usingSubscription: boolean): string {
	return `$${totalCost.toFixed(3)}${usingSubscription ? " sub" : ""}`;
}

function contextColor(percent: number, unknown: boolean): FooterColorName {
	if (unknown) return "warning";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "status";
}

function thinkingColor(thinkingLevel: string): FooterColorName {
	switch (thinkingLevel) {
		case "high":
		case "xhigh":
			return "warning";
		case "minimal":
		case "low":
		case "medium":
			return "status";
		default:
			return "muted";
	}
}

const ACTIONABLE_EXTENSION_STATUS_PATTERN =
	/\b(error|failed|failure|warn|warning|unavailable|offline|denied|missing|invalid|timeout|crash|blocked)\b/i;
const QUIET_EXTENSION_STATUS_PATTERN = /\b(ready|connected|disconnected)\b/i;
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Footer component that shows pwd, token stats, and context usage.
 * Computes token/context stats from session, gets git branch and extension statuses from provider.
 */
export class FooterComponent implements Component {
	private autoCompactEnabled = true;
	private session: AgentSession;
	private footerData: ReadonlyFooterDataProvider;

	constructor(session: AgentSession, footerData: ReadonlyFooterDataProvider) {
		this.session = session;
		this.footerData = footerData;
	}

	setSession(session: AgentSession): void {
		this.session = session;
	}

	setAutoCompactEnabled(enabled: boolean): void {
		this.autoCompactEnabled = enabled;
	}

	/**
	 * No-op: git branch caching now handled by provider.
	 * Kept for compatibility with existing call sites in interactive-mode.
	 */
	invalidate(): void {
		// No-op: git branch is cached/invalidated by provider
	}

	/**
	 * Clean up resources.
	 * Git watcher cleanup now handled by provider.
	 */
	dispose(): void {
		// Git watcher cleanup handled by provider
	}

	render(width: number): string[] {
		const state = this.session.state;

		// Calculate cumulative usage from ALL session entries (not just post-compaction messages)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;
		let lastAssistantProvider: string | undefined;
		let lastAssistantModel: string | undefined;

		for (const entry of this.session.sessionManager.getEntries()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				totalInput += entry.message.usage.input;
				totalOutput += entry.message.usage.output;
				totalCacheRead += entry.message.usage.cacheRead;
				totalCacheWrite += entry.message.usage.cacheWrite;
				totalCost += entry.message.usage.cost.total;
				lastAssistantProvider = entry.message.provider;
				lastAssistantModel = entry.message.model;
			}
		}

		// Calculate context usage from session (handles compaction correctly).
		// After compaction, tokens are unknown until the next LLM response.
		const contextUsage = this.session.getContextUsage();
		const contextWindow = contextUsage?.contextWindow ?? state.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent = contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

		// Replace home directory with ~
		const pwd = formatCwdForFooter(this.session.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);

		const branch = this.footerData.getGitBranch();

		const sessionName = this.session.sessionManager.getSessionName();

		const pathParts = [footerMetric("dir", pwd, "path", true)];
		if (branch) pathParts.push(footerMetric("git", branch));
		if (sessionName) pathParts.push(footerMetric("session", sessionName));
		const pathLine = joinFooterParts(pathParts);

		// Build stats line
		const usageParts = [];
		const tokenParts = [];
		if (totalInput) tokenParts.push(footerValue(`↑${formatTokens(totalInput)}`));
		if (totalOutput) tokenParts.push(footerValue(`↓${formatTokens(totalOutput)}`));
		if (tokenParts.length > 0) usageParts.push(`${footerLabel("tok")} ${tokenParts.join(" ")}`);

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			usageParts.push(
				footerMetric("cost", formatCost(totalCost, usingSubscription), usingSubscription ? "status" : "warning"),
			);
		}

		const cacheParts = [];
		if (totalCacheRead) cacheParts.push(footerValue(`R${formatTokens(totalCacheRead)}`, "muted"));
		if (totalCacheWrite) cacheParts.push(footerValue(`W${formatTokens(totalCacheWrite)}`, "muted"));
		if (cacheParts.length > 0) usageParts.push(`${footerLabel("cache")} ${cacheParts.join(" ")}`);

		const autoIndicator = this.autoCompactEnabled ? " auto" : "";
		const contextPercentDisplay =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}${autoIndicator}`
				: `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;
		const contextPart = footerMetric(
			"ctx",
			contextPercentDisplay,
			contextColor(contextPercentValue, contextPercent === "?"),
		);

		// Add model or router alias on the right side, plus thinking level if model supports it.
		const modelName = state.model?.id || "no-model";
		const providerName = state.model?.provider;
		const isRouterModel = providerName === PIE_LAB_ROUTER_PROVIDER;

		// Add thinking level indicator if model supports reasoning
		const identityParts: string[] = [];
		if (state.model) {
			if (isRouterModel) {
				const routedModel =
					lastAssistantProvider && lastAssistantModel
						? `${footerValue(lastAssistantProvider, "primary", true)}${footerFg("/", "muted")}${footerValue(lastAssistantModel, "model", true)}`
						: undefined;
				identityParts.push(
					routedModel
						? `${footerMetric("route", modelName, "model", true)} ${footerFg("->", "muted")} ${routedModel}`
						: footerMetric("route", modelName, "model", true),
				);
			} else if (this.footerData.getAvailableProviderCount() > 1 && providerName) {
				identityParts.push(
					`${footerLabel("model")} ${footerValue(providerName, "primary", true)}${footerFg("/", "muted")}${footerValue(modelName, "model", true)}`,
				);
			} else {
				identityParts.push(footerMetric("model", modelName, "model", true));
			}
		} else {
			identityParts.push(footerMetric("model", "none", "warning"));
		}

		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			identityParts.push(footerMetric("think", thinkingLevel, thinkingColor(thinkingLevel)));
		}

		const statsLine = truncateToWidth(
			joinFooterParts([...identityParts, contextPart, ...usageParts]),
			width,
			footerFg("...", "muted"),
		);
		const lines = [truncateToWidth(pathLine, width, footerFg("...", "muted")), statsLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => ({
					displayText: sanitizeStatusText(text),
					plainText: sanitizeStatusText(text.replace(ANSI_ESCAPE_PATTERN, "")),
				}))
				.filter(({ displayText, plainText }) => {
					if (!displayText) return false;
					if (ACTIONABLE_EXTENSION_STATUS_PATTERN.test(plainText)) return true;
					return !QUIET_EXTENSION_STATUS_PATTERN.test(plainText);
				})
				.map(({ displayText }) => displayText);
			if (sortedStatuses.length > 0) {
				const statusLine = sortedStatuses.join(" ");
				// Truncate to terminal width with dim ellipsis for consistency with footer style
				lines.push(truncateToWidth(statusLine, width, footerFg("...", "muted")));
			}
		}

		return lines;
	}
}
