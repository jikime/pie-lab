// Formatting adapted from Vercel Chat SDK service converters (MIT).
// Source inspiration:
// - packages/adapter-telegram/src/markdown.ts
// - packages/adapter-discord/src/markdown.ts

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { ChatService } from "../core/config-types.ts";

export interface RenderedChunkPayload {
	text: string;
	parseMode?: "HTML";
	fallbackText: string;
}

type MarkdownNode = {
	type: string;
	value?: string;
	children?: MarkdownNode[];
	url?: string;
	alt?: string;
	lang?: string;
	checked?: boolean | null;
	ordered?: boolean | null;
	start?: number | null;
};

const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value).replace(/"/g, "&quot;");
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, "&");
}

function sanitizeInlineLink(url: string | undefined): string | undefined {
	const trimmed = url?.trim();
	if (!trimmed) return undefined;
	const scheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
	if (!scheme) return undefined;
	if (!["http", "https", "tg", "mailto"].includes(scheme)) return undefined;
	return trimmed;
}

function sanitizeCodeLanguage(language: string | undefined): string | undefined {
	const normalized = language?.trim();
	if (!normalized || !/^[A-Za-z0-9_+-]+$/.test(normalized)) return undefined;
	return normalized;
}

function parseMarkdown(markdown: string): MarkdownNode {
	return markdownProcessor.parse(markdown.replace(/\r\n/g, "\n")) as MarkdownNode;
}

function renderInlineChildren(node: MarkdownNode): string {
	return (node.children ?? []).map(renderTelegramInlineNode).join("");
}

function renderBlockChildren(children: MarkdownNode[] | undefined): string {
	return (children ?? [])
		.map(renderTelegramBlockNode)
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
}

function renderTelegramInlineNode(node: MarkdownNode): string {
	switch (node.type) {
		case "text":
			return escapeHtml(node.value ?? "");
		case "emphasis":
			return `<i>${renderInlineChildren(node)}</i>`;
		case "strong":
			return `<b>${renderInlineChildren(node)}</b>`;
		case "delete":
			return `<s>${renderInlineChildren(node)}</s>`;
		case "inlineCode":
			return `<code>${escapeHtml(node.value ?? "")}</code>`;
		case "break":
			return "\n";
		case "link": {
			const body = renderInlineChildren(node) || escapeHtml(node.url ?? "");
			const url = sanitizeInlineLink(node.url);
			return url ? `<a href="${escapeHtmlAttribute(url)}">${body}</a>` : body;
		}
		case "image": {
			const label = node.alt?.trim() || node.url || "image";
			const url = sanitizeInlineLink(node.url);
			return url ? `<a href="${escapeHtmlAttribute(url)}">${escapeHtml(label)}</a>` : escapeHtml(label);
		}
		case "html":
			return escapeHtml(node.value ?? "");
		default:
			return node.children ? renderInlineChildren(node) : escapeHtml(node.value ?? "");
	}
}

function indentContinuation(text: string): string {
	return text
		.split("\n")
		.map((line, index) => (index === 0 ? line : `  ${line}`))
		.join("\n");
}

function renderTelegramListItem(node: MarkdownNode, marker: string): string {
	const checkbox = typeof node.checked === "boolean" ? (node.checked ? "[x] " : "[ ] ") : "";
	const parts = (node.children ?? [])
		.map((child) => (child.type === "paragraph" ? renderInlineChildren(child) : renderTelegramBlockNode(child)))
		.filter((text) => text.trim().length > 0);
	const [first = "", ...rest] = parts;
	const lines = [`${marker} ${checkbox}${indentContinuation(first)}`];
	for (const part of rest) lines.push(indentContinuation(part).replace(/^/gm, "  "));
	return lines.join("\n");
}

function toPlainTableCell(node: MarkdownNode): string {
	return telegramHtmlToPlainText(renderInlineChildren(node)).replace(/\s+/g, " ").trim();
}

function renderTelegramTable(node: MarkdownNode): string {
	const rows = (node.children ?? [])
		.filter((row) => row.type === "tableRow")
		.map((row) => (row.children ?? []).map(toPlainTableCell));
	if (rows.length === 0) return "";
	const columnCount = Math.max(...rows.map((row) => row.length));
	const widths = Array.from({ length: columnCount }, (_, index) =>
		Math.max(...rows.map((row) => row[index]?.length ?? 0), index === 0 ? 1 : 0),
	);
	const formatRow = (row: string[]) => row.map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0)).join(" | ");
	const [head, ...body] = rows;
	const separator = widths.map((width) => "-".repeat(Math.max(width, 1))).join("-|-");
	return `<pre>${escapeHtml([formatRow(head ?? []), separator, ...body.map(formatRow)].join("\n"))}</pre>`;
}

function renderTelegramBlockNode(node: MarkdownNode): string {
	switch (node.type) {
		case "root":
			return renderBlockChildren(node.children);
		case "paragraph":
			return renderInlineChildren(node);
		case "heading":
			return `<b>${renderInlineChildren(node)}</b>`;
		case "code": {
			const code = escapeHtml(node.value ?? "");
			const language = sanitizeCodeLanguage(node.lang ?? undefined);
			return language
				? `<pre><code class="language-${escapeHtmlAttribute(language)}">${code}</code></pre>`
				: `<pre>${code}</pre>`;
		}
		case "blockquote": {
			const body = renderBlockChildren(node.children).replace(/\n{3,}/g, "\n\n");
			return body ? `<blockquote>${body}</blockquote>` : "";
		}
		case "list": {
			const start = node.start ?? 1;
			return (node.children ?? [])
				.map((child, index) => renderTelegramListItem(child, node.ordered ? `${start + index}.` : "-"))
				.join("\n");
		}
		case "table":
			return renderTelegramTable(node);
		case "thematicBreak":
			return "---";
		case "html":
			return escapeHtml(node.value ?? "");
		default:
			if (node.children) return renderBlockChildren(node.children);
			return escapeHtml(node.value ?? "");
	}
}

function markdownToTelegramHtml(markdown: string): string {
	return renderTelegramBlockNode(parseMarkdown(markdown)).trim();
}

export function telegramHtmlToPlainText(html: string): string {
	return decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?(?:[^>]+)>/g, "")).trim();
}

function normalizeTelegram(markdown: string): RenderedChunkPayload {
	const text = markdownToTelegramHtml(markdown);
	return {
		text,
		parseMode: text ? "HTML" : undefined,
		fallbackText: telegramHtmlToPlainText(text) || markdown.replace(/\r\n/g, "\n").trim(),
	};
}

function normalizeDiscord(markdown: string): string {
	return markdown.replace(/(?<!<)@(\w+)/g, "<@$1>").trim();
}

export function formatMarkdownForService(service: ChatService, markdown: string): RenderedChunkPayload {
	if (service === "telegram") return normalizeTelegram(markdown);
	const text = normalizeDiscord(markdown);
	return { text, fallbackText: text };
}

export function maxMessageLength(service: ChatService): number {
	if (service === "telegram") return 4096;
	return 2000;
}
