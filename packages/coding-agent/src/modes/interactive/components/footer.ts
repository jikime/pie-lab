import { isAbsolute, relative, resolve, sep } from "node:path";
import { PIE_LAB_ROUTER_PROVIDER } from "@pie-lab/router";
import { type Component, truncateToWidth } from "@pie-lab/tui";
import type { AgentSession } from "../../../core/agent-session.ts";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.ts";
import { type ThemeColor, theme } from "../theme/theme.ts";

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
	return theme.fg("border", text);
}

function footerValue(text: string, color: ThemeColor = "text"): string {
	return theme.fg(color, text);
}

function footerMetric(label: string, value: string, color: ThemeColor = "text"): string {
	return `${footerLabel(label)} ${footerValue(value, color)}`;
}

function joinFooterParts(parts: string[]): string {
	return parts.filter(Boolean).join(theme.fg("muted", " | "));
}

function formatCost(totalCost: number, usingSubscription: boolean): string {
	return `$${totalCost.toFixed(3)}${usingSubscription ? " sub" : ""}`;
}

function contextColor(percent: number, unknown: boolean): ThemeColor {
	if (unknown) return "warning";
	if (percent > 90) return "error";
	if (percent > 70) return "warning";
	return "success";
}

function thinkingColor(thinkingLevel: string): ThemeColor {
	switch (thinkingLevel) {
		case "minimal":
			return "thinkingMinimal";
		case "low":
			return "thinkingLow";
		case "medium":
			return "thinkingMedium";
		case "high":
			return "thinkingHigh";
		case "xhigh":
			return "thinkingXhigh";
		default:
			return "dim";
	}
}

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

		const pathParts = [footerMetric("dir", pwd)];
		if (branch) pathParts.push(footerMetric("git", branch, "success"));
		if (sessionName) pathParts.push(footerMetric("session", sessionName, "warning"));
		const pathLine = joinFooterParts(pathParts);

		// Build stats line
		const usageParts = [];
		const tokenParts = [];
		if (totalInput) tokenParts.push(footerValue(`↑${formatTokens(totalInput)}`, "borderAccent"));
		if (totalOutput) tokenParts.push(footerValue(`↓${formatTokens(totalOutput)}`, "success"));
		if (tokenParts.length > 0) usageParts.push(`${footerLabel("tok")} ${tokenParts.join(" ")}`);

		// Show cost with "(sub)" indicator if using OAuth subscription
		const usingSubscription = state.model ? this.session.modelRegistry.isUsingOAuth(state.model) : false;
		if (totalCost || usingSubscription) {
			usageParts.push(
				footerMetric("cost", formatCost(totalCost, usingSubscription), usingSubscription ? "success" : "warning"),
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
						? `${footerValue(lastAssistantProvider, "borderAccent")}${theme.fg("muted", "/")}${footerValue(lastAssistantModel)}`
						: undefined;
				identityParts.push(
					routedModel
						? `${footerMetric("route", modelName, "warning")} ${theme.fg("muted", "->")} ${routedModel}`
						: footerMetric("route", modelName, "warning"),
				);
			} else if (this.footerData.getAvailableProviderCount() > 1 && providerName) {
				identityParts.push(
					`${footerLabel("model")} ${footerValue(providerName, "borderAccent")}${theme.fg("muted", "/")}${footerValue(modelName)}`,
				);
			} else {
				identityParts.push(footerMetric("model", modelName));
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
			theme.fg("muted", "..."),
		);
		const lines = [truncateToWidth(pathLine, width, theme.fg("dim", "...")), statsLine];

		// Add extension statuses on a single line, sorted by key alphabetically
		const extensionStatuses = this.footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const sortedStatuses = Array.from(extensionStatuses.entries())
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => sanitizeStatusText(text));
			const statusLine = sortedStatuses.join(" ");
			// Truncate to terminal width with dim ellipsis for consistency with footer style
			lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
		}

		return lines;
	}
}
