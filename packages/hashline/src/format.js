import { createHash } from "crypto";
export const HL_FILE_PREFIX = "¶";
export const HL_FILE_HASH_SEP = "#";
export const HL_LINE_BODY_SEP = ":";
export const HL_FILE_HASH_LENGTH = 4;
function normalizeFileHashText(text) {
    return text.replace(/[ \t\r]+(?=\n|$)/g, "");
}
export function normalizeSnapshotText(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
export function computeFileHash(text) {
    const normalized = normalizeFileHashText(normalizeSnapshotText(text));
    return createHash("sha256").update(normalized).digest("hex").slice(0, HL_FILE_HASH_LENGTH).toUpperCase();
}
export function formatHashlineHeader(filePath, fileHash) {
    return `${HL_FILE_PREFIX}${filePath}${HL_FILE_HASH_SEP}${fileHash}`;
}
export function formatNumberedLine(lineNumber, line) {
    return `${lineNumber}${HL_LINE_BODY_SEP}${line}`;
}
export function formatNumberedLines(text, startLine = 1) {
    return text
        .split("\n")
        .map((line, index) => formatNumberedLine(startLine + index, line))
        .join("\n");
}
export function stripHashlinePrefixes(text) {
    const lines = text.split("\n");
    const withoutHeaders = lines.filter((line) => !line.startsWith(HL_FILE_PREFIX));
    const contentLines = withoutHeaders.filter((line) => line.length > 0);
    if (contentLines.length === 0 || !contentLines.every((line) => /^\d+:/.test(line))) {
        return { text, stripped: false };
    }
    return {
        text: withoutHeaders.map((line) => line.replace(/^\d+:/, "")).join("\n"),
        stripped: true,
    };
}
//# sourceMappingURL=format.js.map