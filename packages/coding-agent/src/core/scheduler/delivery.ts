import { access } from "node:fs/promises";
import { deliverGatewayMessage, type GatewayDeliveryResult, parseGatewayDeliverTargets } from "../gateway/delivery.ts";

export type CronDeliverTarget = string;
export type CronDeliveryResult = GatewayDeliveryResult;

const MEDIA_LINE_RE = /^MEDIA:\s*(.+)$/;

/**
 * Extract `MEDIA: /path/to/file` lines from a scheduled job response.
 * Matching lines are removed from the text and returned as attachment paths.
 */
export function extractMediaPaths(content: string): { text: string; mediaPaths: string[] } {
	const mediaPaths: string[] = [];
	const lines: string[] = [];
	for (const line of content.split("\n")) {
		const match = MEDIA_LINE_RE.exec(line.trim());
		if (match) {
			mediaPaths.push(match[1].trim());
		} else {
			lines.push(line);
		}
	}
	return { text: lines.join("\n").trim(), mediaPaths };
}

export async function deliverCronResult(options: {
	agentDir: string;
	deliver?: string;
	origin?: string;
	content: string;
}): Promise<CronDeliveryResult> {
	const targets = parseGatewayDeliverTargets(options.deliver);
	if (targets.length === 0 || (targets.length === 1 && targets[0] === "local")) {
		return deliverGatewayMessage(options);
	}

	const { text, mediaPaths } = extractMediaPaths(options.content);
	const attachmentPaths: string[] = [];
	const missing: string[] = [];
	for (const mediaPath of mediaPaths) {
		try {
			await access(mediaPath);
			attachmentPaths.push(mediaPath);
		} catch {
			missing.push(mediaPath);
		}
	}
	const content = text || (attachmentPaths.length > 0 ? "(media attachment)" : options.content);
	const result = await deliverGatewayMessage({
		...options,
		content,
		attachmentPaths: attachmentPaths.length > 0 ? attachmentPaths : undefined,
	});
	if (missing.length === 0) return result;
	return {
		...result,
		errors: [...result.errors, ...missing.map((mediaPath) => `media file not found: ${mediaPath}`)],
	};
}
