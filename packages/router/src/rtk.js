const MIN_COMPRESS_SIZE = 500;
const RAW_CAP = 2_000_000;
export function compressPayloadWithRtk(payload, enabled = true) {
    const cloned = clonePayload(payload);
    const stats = compressMessages(cloned, enabled);
    return {
        payload: cloned,
        stats,
        logLine: formatRtkLog(stats),
    };
}
export function compressMessages(body, enabled = true) {
    if (!enabled || !body || typeof body !== "object")
        return null;
    const record = body;
    if (record.conversationState && typeof record.conversationState === "object") {
        return compressKiroFormat(record);
    }
    const items = Array.isArray(record.messages) ? record.messages : Array.isArray(record.input) ? record.input : null;
    if (!items)
        return null;
    const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
    for (const item of items) {
        if (!item || typeof item !== "object")
            continue;
        const message = item;
        if (message.type === "function_call_output") {
            if (typeof message.output === "string") {
                message.output = compressText(message.output, stats, "openai-responses-string");
            }
            else if (Array.isArray(message.output)) {
                for (const part of message.output) {
                    if (isTextPart(part, "input_text")) {
                        part.text = compressText(part.text, stats, "openai-responses-array");
                    }
                }
            }
            continue;
        }
        if (message.role === "tool" && typeof message.content === "string") {
            message.content = compressText(message.content, stats, "openai-tool");
            continue;
        }
        if (!Array.isArray(message.content))
            continue;
        if (message.role === "tool") {
            for (const part of message.content) {
                if (isTextPart(part, "text")) {
                    part.text = compressText(part.text, stats, "openai-tool-array");
                }
            }
            continue;
        }
        for (const block of message.content) {
            if (!block || typeof block !== "object")
                continue;
            const blockRecord = block;
            if (blockRecord.type !== "tool_result" || blockRecord.is_error === true)
                continue;
            if (typeof blockRecord.content === "string") {
                blockRecord.content = compressText(blockRecord.content, stats, "claude-string");
            }
            else if (Array.isArray(blockRecord.content)) {
                for (const part of blockRecord.content) {
                    if (isTextPart(part, "text")) {
                        part.text = compressText(part.text, stats, "claude-array");
                    }
                }
            }
        }
    }
    return stats;
}
export function formatRtkLog(stats) {
    if (!stats || stats.hits.length === 0)
        return null;
    const saved = stats.bytesBefore - stats.bytesAfter;
    const pct = stats.bytesBefore > 0 ? ((saved / stats.bytesBefore) * 100).toFixed(1) : "0";
    const filters = [...new Set(stats.hits.map((hit) => hit.filter))].join(",");
    return `[RTK] saved ${saved}B / ${stats.bytesBefore}B (${pct}%) via [${filters}] hits=${stats.hits.length}`;
}
function compressKiroFormat(body) {
    const stats = { bytesBefore: 0, bytesAfter: 0, hits: [] };
    const state = body.conversationState;
    const messages = [...(Array.isArray(state.history) ? state.history : [])];
    if (state.currentMessage)
        messages.push(state.currentMessage);
    for (const message of messages) {
        const toolResults = getNestedArray(message, ["userInputMessage", "userInputMessageContext", "toolResults"]);
        for (const toolResult of toolResults) {
            if (!toolResult || typeof toolResult !== "object")
                continue;
            const resultRecord = toolResult;
            if (resultRecord.status === "error" || !Array.isArray(resultRecord.content))
                continue;
            for (const part of resultRecord.content) {
                if (part && typeof part === "object" && typeof part.text === "string") {
                    part.text = compressText(part.text, stats, "kiro-tool-result");
                }
            }
        }
    }
    return stats;
}
function compressText(text, stats, shape) {
    const bytesIn = text.length;
    stats.bytesBefore += bytesIn;
    if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) {
        stats.bytesAfter += bytesIn;
        return text;
    }
    const filter = autoDetectFilter(text);
    if (!filter) {
        stats.bytesAfter += bytesIn;
        return text;
    }
    const output = safeApply(filter, text);
    if (!output || output.length >= bytesIn) {
        stats.bytesAfter += bytesIn;
        return text;
    }
    stats.bytesAfter += output.length;
    stats.hits.push({ shape, filter: filter.filterName ?? filter.name, saved: bytesIn - output.length });
    return output;
}
function autoDetectFilter(text) {
    const sample = text.slice(0, 1024);
    if (/^diff --git /m.test(sample))
        return withName(compactGitDiff, "gitDiff");
    if (/^(On branch|Changes not staged|Untracked files:|[ MADRCU?!]{2}\s+\S+)/m.test(sample)) {
        return withName(compactGitStatus, "gitStatus");
    }
    if (/^.+:\d+(:\d+)?:/m.test(sample))
        return withName(compactSearchList, "searchList");
    if (/^\s*(\.\/|\/|\w).*$/m.test(sample) && sample.includes("\n"))
        return withName(smartTruncate, "smartTruncate");
    return null;
}
function compactGitDiff(input) {
    const files = [...input.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map((match) => match[2]);
    const additions = countMatches(input, /^\+/gm) - countMatches(input, /^\+\+\+/gm);
    const deletions = countMatches(input, /^-/gm) - countMatches(input, /^---/gm);
    const hunks = countMatches(input, /^@@/gm);
    const preview = input
        .split(/\r?\n/)
        .filter((line) => /^diff --git |^@@|^[+-](?![+-]{2})/.test(line))
        .slice(0, 120)
        .join("\n");
    return [
        `[rtk git diff] files=${files.length} hunks=${hunks} +${additions} -${deletions}`,
        files.length ? `files:\n${files.map((file) => `- ${file}`).join("\n")}` : "",
        preview,
        "[full diff: rtk git diff --no-compact]",
    ]
        .filter(Boolean)
        .join("\n");
}
function compactGitStatus(input) {
    const lines = input.split(/\r?\n/).filter((line) => line.trim());
    const porcelain = lines.filter((line) => /^[ MADRCU?!]{2}\s+\S+/.test(line));
    if (porcelain.length === 0)
        return smartTruncate(input);
    const groups = new Map();
    for (const line of porcelain) {
        const status = line.slice(0, 2).trim() || "changed";
        const file = line.slice(3).trim();
        const group = groups.get(status) ?? [];
        group.push(file);
        groups.set(status, group);
    }
    return [...groups.entries()]
        .map(([status, files]) => `${status}: ${files.slice(0, 80).join(", ")}${files.length > 80 ? ` ... +${files.length - 80}` : ""}`)
        .join("\n");
}
function compactSearchList(input) {
    const lines = input.split(/\r?\n/).filter(Boolean);
    const grouped = new Map();
    for (const line of lines) {
        const file = line.split(":")[0];
        grouped.set(file, (grouped.get(file) ?? 0) + 1);
    }
    const summary = [...grouped.entries()]
        .slice(0, 80)
        .map(([file, count]) => `${file} (${count})`)
        .join("\n");
    return `[rtk search results] matches=${lines.length} files=${grouped.size}\n${summary}`;
}
function smartTruncate(input) {
    const lines = input.split(/\r?\n/);
    if (lines.length <= 160 && input.length <= 12_000)
        return input;
    const head = lines.slice(0, 80).join("\n");
    const tail = lines.slice(-40).join("\n");
    return `${head}\n\n[rtk truncated ${Math.max(0, lines.length - 120)} middle lines]\n\n${tail}`;
}
function safeApply(filter, input) {
    try {
        return filter(input);
    }
    catch {
        return input;
    }
}
function withName(filter, name) {
    const named = filter;
    named.filterName = name;
    return named;
}
function countMatches(input, regex) {
    return [...input.matchAll(regex)].length;
}
function clonePayload(payload) {
    if (!payload || typeof payload !== "object")
        return payload;
    if (Array.isArray(payload)) {
        return payload.map((item) => clonePayload(item));
    }
    const prototype = Object.getPrototypeOf(payload);
    if (prototype !== Object.prototype && prototype !== null) {
        return payload;
    }
    const cloned = {};
    for (const [key, value] of Object.entries(payload)) {
        cloned[key] = clonePayload(value);
    }
    return cloned;
}
function isTextPart(value, type) {
    return (!!value &&
        typeof value === "object" &&
        value.type === type &&
        typeof value.text === "string");
}
function getNestedArray(value, path) {
    let current = value;
    for (const key of path) {
        if (!current || typeof current !== "object")
            return [];
        current = current[key];
    }
    return Array.isArray(current) ? current : [];
}
//# sourceMappingURL=rtk.js.map