import { computeFileHash, HL_FILE_HASH_SEP, HL_FILE_PREFIX, normalizeSnapshotText } from "./format.js";
const MAX_RECOVERY_CONTEXT_LINES = 3;
function isAnchoredInsert(operation) {
    return operation.position === "before" || operation.position === "after";
}
function splitEditableLines(text) {
    const normalized = normalizeSnapshotText(text);
    const trailingNewline = normalized.endsWith("\n");
    const body = trailingNewline ? normalized.slice(0, -1) : normalized;
    return {
        lines: body === "" ? [] : body.split("\n"),
        trailingNewline,
    };
}
function joinEditableLines(lines, trailingNewline) {
    const body = lines.join("\n");
    return trailingNewline && body !== "" ? `${body}\n` : body;
}
function parsePositiveInt(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return parsed;
}
function parseRange(value) {
    const match = value.match(/^(\d+)(?:\.\.(\d+))?$/);
    if (!match) {
        throw new Error(`Invalid hashline range: ${value}`);
    }
    const startLine = parsePositiveInt(match[1], "start line");
    const endLine = match[2] ? parsePositiveInt(match[2], "end line") : startLine;
    if (endLine < startLine) {
        throw new Error(`Invalid hashline range: ${value}`);
    }
    return { startLine, endLine };
}
function parseOperationHeader(line) {
    const replaceMatch = line.match(/^replace\s+(\d+(?:\.\.\d+)?):$/);
    if (replaceMatch) {
        return { kind: "replace", ...parseRange(replaceMatch[1]) };
    }
    const deleteMatch = line.match(/^delete\s+(\d+(?:\.\.\d+)?)$/);
    if (deleteMatch) {
        return { kind: "delete", ...parseRange(deleteMatch[1]) };
    }
    const insertAnchorMatch = line.match(/^insert\s+(before|after)\s+(\d+):$/);
    if (insertAnchorMatch) {
        return {
            kind: "insert",
            position: insertAnchorMatch[1],
            startLine: parsePositiveInt(insertAnchorMatch[2], "insert anchor line"),
        };
    }
    const insertBoundaryMatch = line.match(/^insert\s+(head|tail):$/);
    if (insertBoundaryMatch) {
        return { kind: "insert", position: insertBoundaryMatch[1] };
    }
    return null;
}
function parseBody(lines, startIndex) {
    const body = [];
    let index = startIndex;
    while (index < lines.length) {
        const line = lines[index];
        if (line.startsWith(HL_FILE_PREFIX) || parseOperationHeader(line)) {
            break;
        }
        if (!line.startsWith("+")) {
            throw new Error(`Hashline body rows must start with '+': ${line}`);
        }
        body.push(line.slice(1));
        index++;
    }
    return { body, nextIndex: index };
}
function parseSectionHeader(line) {
    if (!line.startsWith(HL_FILE_PREFIX))
        return null;
    const withoutPrefix = line.slice(HL_FILE_PREFIX.length);
    const hashSep = withoutPrefix.lastIndexOf(HL_FILE_HASH_SEP);
    if (hashSep <= 0 || hashSep === withoutPrefix.length - 1) {
        throw new Error(`Invalid hashline section header: ${line}`);
    }
    const path = withoutPrefix.slice(0, hashSep);
    const hash = withoutPrefix.slice(hashSep + 1).toUpperCase();
    if (!/^[0-9A-F]{4}$/.test(hash)) {
        throw new Error(`Invalid hashline snapshot tag for ${path}: ${hash}`);
    }
    return { path, hash };
}
export function parseHashlinePatch(input) {
    const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const sections = [];
    let current;
    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === "") {
            index++;
            continue;
        }
        const sectionHeader = parseSectionHeader(line);
        if (sectionHeader) {
            current = { ...sectionHeader, operations: [] };
            sections.push(current);
            index++;
            continue;
        }
        if (!current) {
            throw new Error(`Hashline patch must start with a ${HL_FILE_PREFIX}PATH#TAG section header.`);
        }
        const operationHeader = parseOperationHeader(line);
        if (!operationHeader) {
            throw new Error(`Invalid hashline operation: ${line}`);
        }
        if (operationHeader.kind === "delete") {
            current.operations.push({
                kind: "delete",
                startLine: operationHeader.startLine ?? 0,
                endLine: operationHeader.endLine ?? 0,
            });
            index++;
            continue;
        }
        const { body, nextIndex } = parseBody(lines, index + 1);
        if (operationHeader.kind === "replace") {
            current.operations.push({
                kind: "replace",
                startLine: operationHeader.startLine ?? 0,
                endLine: operationHeader.endLine ?? 0,
                lines: body,
            });
        }
        else if (operationHeader.position === "before" || operationHeader.position === "after") {
            current.operations.push({
                kind: "insert",
                position: operationHeader.position,
                line: operationHeader.startLine ?? 0,
                lines: body,
            });
        }
        else {
            current.operations.push({
                kind: "insert",
                position: operationHeader.position ?? "tail",
                lines: body,
            });
        }
        index = nextIndex;
    }
    if (sections.length === 0) {
        throw new Error("No hashline sections found.");
    }
    for (const section of sections) {
        if (section.operations.length === 0) {
            throw new Error(`No hashline operations found for ${section.path}.`);
        }
    }
    return { sections };
}
function operationToMutation(operation, lineCount, sourceOrder) {
    switch (operation.kind) {
        case "replace": {
            if (operation.endLine > lineCount) {
                throw new Error(`replace ${operation.startLine}..${operation.endLine} exceeds file length ${lineCount}.`);
            }
            return {
                index: operation.startLine - 1,
                deleteCount: operation.endLine - operation.startLine + 1,
                insertLines: operation.lines,
                sourceOrder,
                operation,
            };
        }
        case "delete": {
            if (operation.endLine > lineCount) {
                throw new Error(`delete ${operation.startLine}..${operation.endLine} exceeds file length ${lineCount}.`);
            }
            return {
                index: operation.startLine - 1,
                deleteCount: operation.endLine - operation.startLine + 1,
                insertLines: [],
                sourceOrder,
                operation,
            };
        }
        case "insert": {
            if (!isAnchoredInsert(operation)) {
                if (operation.position === "head") {
                    return { index: 0, deleteCount: 0, insertLines: operation.lines, sourceOrder, operation };
                }
                return { index: lineCount, deleteCount: 0, insertLines: operation.lines, sourceOrder, operation };
            }
            if (operation.line > lineCount) {
                throw new Error(`insert ${operation.position} ${operation.line} exceeds file length ${lineCount}.`);
            }
            return {
                index: operation.position === "before" ? operation.line - 1 : operation.line,
                deleteCount: 0,
                insertLines: operation.lines,
                sourceOrder,
                operation,
            };
        }
    }
}
function validateNonOverlapping(mutations) {
    const ranges = mutations
        .filter((mutation) => mutation.deleteCount > 0)
        .map((mutation) => ({
        start: mutation.index,
        end: mutation.index + mutation.deleteCount - 1,
        operation: mutation.operation,
    }))
        .sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) {
        if (ranges[i].start <= ranges[i - 1].end) {
            throw new Error("Overlapping hashline replace/delete ranges are not allowed.");
        }
    }
    for (const mutation of mutations) {
        if (mutation.deleteCount > 0)
            continue;
        for (const range of ranges) {
            if (mutation.index > range.start && mutation.index <= range.end) {
                throw new Error("Hashline inserts cannot target the middle of a replace/delete range.");
            }
        }
    }
}
function describeOperation(operation) {
    switch (operation.kind) {
        case "replace":
            return `replace ${operation.startLine}..${operation.endLine}`;
        case "delete":
            return `delete ${operation.startLine}..${operation.endLine}`;
        case "insert":
            if (isAnchoredInsert(operation)) {
                return `insert ${operation.position} ${operation.line}`;
            }
            return `insert ${operation.position}`;
    }
}
function findSequenceMatches(lines, pattern) {
    if (pattern.length === 0 || pattern.length > lines.length) {
        return [];
    }
    const matches = [];
    for (let index = 0; index <= lines.length - pattern.length; index++) {
        let matched = true;
        for (let offset = 0; offset < pattern.length; offset++) {
            if (lines[index + offset] !== pattern[offset]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            matches.push(index);
        }
    }
    return matches;
}
function resolveCurrentIndexWithContext(baseLines, currentLines, baseIndex, targetLength, path, operation) {
    let sawAmbiguousMatch = false;
    for (let radius = 0; radius <= MAX_RECOVERY_CONTEXT_LINES; radius++) {
        const beforeCount = Math.min(radius, baseIndex);
        const afterCount = Math.min(radius, baseLines.length - (baseIndex + targetLength));
        const contextStart = baseIndex - beforeCount;
        const contextEnd = baseIndex + targetLength + afterCount;
        const pattern = baseLines.slice(contextStart, contextEnd);
        const matches = findSequenceMatches(currentLines, pattern);
        if (matches.length === 1) {
            return matches[0] + beforeCount;
        }
        if (matches.length > 1) {
            sawAmbiguousMatch = true;
        }
    }
    const reason = sawAmbiguousMatch ? "ambiguous" : "missing or changed";
    throw new Error(`Stale hashline snapshot for ${path}: recovery target for ${describeOperation(operation)} is ${reason}. Re-read the file and retry.`);
}
function recoverMutationAgainstCurrent(mutation, baseLines, currentLines, path) {
    if (mutation.operation.kind === "replace" || mutation.operation.kind === "delete") {
        return {
            ...mutation,
            index: resolveCurrentIndexWithContext(baseLines, currentLines, mutation.index, mutation.deleteCount, path, mutation.operation),
        };
    }
    if (!isAnchoredInsert(mutation.operation)) {
        return {
            ...mutation,
            index: mutation.operation.position === "head" ? 0 : currentLines.length,
        };
    }
    const anchorIndex = resolveCurrentIndexWithContext(baseLines, currentLines, mutation.operation.line - 1, 1, path, mutation.operation);
    return {
        ...mutation,
        index: mutation.operation.position === "before" ? anchorIndex : anchorIndex + 1,
    };
}
function applyMutations(lines, trailingNewline, mutations) {
    const result = [...lines];
    for (const mutation of mutations.sort((a, b) => b.index - a.index || b.sourceOrder - a.sourceOrder)) {
        result.splice(mutation.index, mutation.deleteCount, ...mutation.insertLines);
    }
    return joinEditableLines(result, trailingNewline);
}
export function applyHashlineSectionToText(text, section) {
    const { lines, trailingNewline } = splitEditableLines(text);
    const mutations = section.operations.map((operation, index) => operationToMutation(operation, lines.length, index));
    validateNonOverlapping(mutations);
    return applyMutations(lines, trailingNewline, mutations);
}
export function applyHashlineSectionWithRecovery(baseText, currentText, section) {
    const normalizedBaseText = normalizeSnapshotText(baseText);
    const normalizedCurrentText = normalizeSnapshotText(currentText);
    validateHashlineSnapshot(normalizedBaseText, section.hash, section.path);
    if (computeFileHash(normalizedCurrentText) === section.hash.toUpperCase()) {
        return {
            text: applyHashlineSectionToText(normalizedCurrentText, section),
            recovered: false,
        };
    }
    const { lines: baseLines } = splitEditableLines(normalizedBaseText);
    const { lines: currentLines, trailingNewline } = splitEditableLines(normalizedCurrentText);
    const baseMutations = section.operations.map((operation, index) => operationToMutation(operation, baseLines.length, index));
    validateNonOverlapping(baseMutations);
    const recoveredMutations = baseMutations.map((mutation) => recoverMutationAgainstCurrent(mutation, baseLines, currentLines, section.path));
    validateNonOverlapping(recoveredMutations);
    return {
        text: applyMutations(currentLines, trailingNewline, recoveredMutations),
        recovered: true,
    };
}
export function validateHashlineSnapshot(text, expectedHash, path) {
    const actualHash = computeFileHash(text);
    if (actualHash !== expectedHash.toUpperCase()) {
        throw new Error(`Stale hashline snapshot for ${path}: expected #${expectedHash}, current #${actualHash}. Re-read the file and retry.`);
    }
}
//# sourceMappingURL=patch.js.map