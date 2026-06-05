export declare const HL_FILE_PREFIX = "\u00B6";
export declare const HL_FILE_HASH_SEP = "#";
export declare const HL_LINE_BODY_SEP = ":";
export declare const HL_FILE_HASH_LENGTH = 4;
export declare function normalizeSnapshotText(text: string): string;
export declare function computeFileHash(text: string): string;
export declare function formatHashlineHeader(filePath: string, fileHash: string): string;
export declare function formatNumberedLine(lineNumber: number, line: string): string;
export declare function formatNumberedLines(text: string, startLine?: number): string;
export declare function stripHashlinePrefixes(text: string): {
    text: string;
    stripped: boolean;
};
//# sourceMappingURL=format.d.ts.map