export interface HashlinePatch {
    sections: HashlinePatchSection[];
}
export interface HashlinePatchSection {
    path: string;
    hash: string;
    operations: HashlineOperation[];
}
export type HashlineOperation = {
    kind: "replace";
    startLine: number;
    endLine: number;
    lines: string[];
} | {
    kind: "delete";
    startLine: number;
    endLine: number;
} | {
    kind: "insert";
    position: "before" | "after";
    line: number;
    lines: string[];
} | {
    kind: "insert";
    position: "head" | "tail";
    lines: string[];
};
export interface HashlineRecoveryResult {
    text: string;
    recovered: boolean;
}
export declare function parseHashlinePatch(input: string): HashlinePatch;
export declare function applyHashlineSectionToText(text: string, section: HashlinePatchSection): string;
export declare function applyHashlineSectionWithRecovery(baseText: string, currentText: string, section: HashlinePatchSection): HashlineRecoveryResult;
export declare function validateHashlineSnapshot(text: string, expectedHash: string, path: string): void;
//# sourceMappingURL=patch.d.ts.map