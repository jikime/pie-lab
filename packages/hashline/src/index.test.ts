import { describe, expect, it } from "vitest";
import {
	applyHashlineEdit,
	applyHashlineEdits,
	applyHashlineSectionToText,
	applyHashlineSectionWithRecovery,
	computeEditContext,
	computeFileHash,
	computeLineHash,
	findAnchorLine,
	formatHashlineHeader,
	formatNumberedLines,
	parseHashlinePatch,
	validateHashlineSnapshot,
} from "./index.ts";

describe("hashline", () => {
	describe("hash computation", () => {
		it("should compute consistent hash for same line", () => {
			const line = "const x = 123;";
			const hash1 = computeLineHash(line);
			const hash2 = computeLineHash(line);
			expect(hash1).toBe(hash2);
		});

		it("should compute different hash for different lines", () => {
			const hash1 = computeLineHash("const x = 123;");
			const hash2 = computeLineHash("const x = 456;");
			expect(hash1).not.toBe(hash2);
		});
	});

	describe("anchor finding", () => {
		it("should find exact match", () => {
			const lines = ["line 1", "line 2", "target", "line 4"];
			const idx = findAnchorLine(lines, "target");
			expect(idx).toBe(2);
		});

		it("should find by fuzzy match when exact fails", () => {
			const lines = ["line 1", "line 2", "target something else", "line 4"];
			const idx = findAnchorLine(lines, "target");
			// Fuzzy matches first 50 chars
			expect(idx).toBe(2);
		});

		it("should return null when not found", () => {
			const lines = ["line 1", "line 2", "something", "line 4"];
			const idx = findAnchorLine(lines, "target");
			expect(idx).toBeNull();
		});
	});

	describe("edit application", () => {
		it("should apply simple string-based edit", () => {
			const content = "const x = 123;\nconst y = 456;";
			const result = applyHashlineEdit(content, {
				anchor: "const x = 123;",
				newText: "const x = 999;",
			});

			expect(result.error).toBeUndefined();
			expect(result.text).toBe("const x = 999;\nconst y = 456;");
		});

		it("should apply hash-based edit with exact match", () => {
			const content = "const x = 123;\nconst y = 456;";
			const hash = computeLineHash("const x = 123;");

			const result = applyHashlineEdit(content, {
				anchor: "const x = 123;",
				hash,
				newText: "const x = 999;",
			});

			expect(result.error).toBeUndefined();
			expect(result.hashMatched).toBe(true);
			expect(result.text).toBe("const x = 999;\nconst y = 456;");
		});

		it("should apply edit with context recovery", () => {
			// Original content has the anchor
			const content = "const a = 1;\nconst x = 123;\nconst y = 456;";

			const result = applyHashlineEdit(content, {
				anchor: "const x = 123;",
				before: ["const a = 1;"],
				after: ["const y = 456;"],
				newText: "const x = 999;",
			});

			expect(result.error).toBeUndefined();
			expect(result.text).toContain("const x = 999;");
			expect(result.text).toContain("const a = 1;");
			expect(result.text).toContain("const y = 456;");
		});

		it("should reject ambiguous anchors instead of editing the first match", () => {
			const content = "target\nmiddle\ntarget";
			const result = applyHashlineEdit(content, {
				anchor: "target",
				newText: "changed",
			});

			expect(result.error).toContain("ambiguous");
			expect(result.text).toBe(content);
		});

		it("should use context to disambiguate duplicate anchors", () => {
			const content = "before a\ntarget\nafter a\nbefore b\ntarget\nafter b";
			const result = applyHashlineEdit(content, {
				anchor: "target",
				before: ["before b"],
				after: ["after b"],
				newText: "changed",
			});

			expect(result.error).toBeUndefined();
			expect(result.text).toBe("before a\ntarget\nafter a\nbefore b\nchanged\nafter b");
		});

		it("should not fuzzy-recover from a prefix match during edit application", () => {
			const content = "target something else";
			const result = applyHashlineEdit(content, {
				anchor: "target",
				newText: "changed",
			});

			expect(result.error).toBeDefined();
			expect(result.text).toBe(content);
		});

		it("should fail with proper error when anchor not found", () => {
			const content = "const x = 123;";
			const result = applyHashlineEdit(content, {
				anchor: "nonexistent",
				newText: "something",
			});

			expect(result.error).toBeDefined();
			expect(result.text).toBe(content);
		});
	});

	describe("multiple edits", () => {
		it("should apply multiple edits in correct order", () => {
			const content = "line 1\nline 2\nline 3\nline 4";
			const result = applyHashlineEdits(content, [
				{
					anchor: "line 1",
					newText: "line 1 modified",
				},
				{
					anchor: "line 3",
					newText: "line 3 modified",
				},
			]);

			expect(result.error).toBeUndefined();
			expect(result.text).toContain("line 1 modified");
			expect(result.text).toContain("line 3 modified");
		});
	});

	describe("edit context computation", () => {
		it("should compute context for edit", () => {
			const content = "const a = 1;\nconst b = 2;\nconst c = 3;";
			const ctx = computeEditContext(content, "const b = 2;", 1);

			expect(ctx).toBeDefined();
			expect(ctx?.before).toEqual(["const a = 1;"]);
			expect(ctx?.after).toEqual(["const c = 3;"]);
			expect(ctx?.hash).toBeDefined();
		});

		it("should return null for missing anchor", () => {
			const content = "const a = 1;";
			const ctx = computeEditContext(content, "missing", 1);
			expect(ctx).toBeNull();
		});
	});

	describe("snapshot patch format", () => {
		it("should format hashline read output", () => {
			const text = "alpha\nbeta";
			const hash = computeFileHash(text);

			expect(formatHashlineHeader("src/file.ts", hash)).toBe(`¶src/file.ts#${hash}`);
			expect(formatNumberedLines(text)).toBe("1:alpha\n2:beta");
		});

		it("should parse and apply replace, delete, and insert operations", () => {
			const original = "alpha\nbeta\ngamma\ndelta";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 2..2:
+BETA
delete 3
insert tail:
+omega`);

			validateHashlineSnapshot(original, patch.sections[0].hash, patch.sections[0].path);
			const updated = applyHashlineSectionToText(original, patch.sections[0]);

			expect(updated).toBe("alpha\nBETA\ndelta\nomega");
		});

		it("should reject stale snapshot tags", () => {
			expect(() => validateHashlineSnapshot("changed", "0000", "file.txt")).toThrow(/Stale hashline snapshot/);
		});

		it("should recover a stale snapshot when the target block shifted", () => {
			const original = "alpha\nbeta\ngamma";
			const current = "intro\nalpha\nbeta\ngamma";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 2..2:
+BETA`);

			const result = applyHashlineSectionWithRecovery(original, current, patch.sections[0]);

			expect(result).toEqual({
				text: "intro\nalpha\nBETA\ngamma",
				recovered: true,
			});
		});

		it("should reject stale recovery when the target block changed", () => {
			const original = "alpha\nbeta\ngamma";
			const current = "alpha\nBETTER\ngamma";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 2..2:
+BETA`);

			expect(() => applyHashlineSectionWithRecovery(original, current, patch.sections[0])).toThrow(/Re-read/);
		});

		it("should use context to recover a duplicated target block", () => {
			const original = "before a\ntarget\nafter a\nbefore b\ntarget\nafter b";
			const current = `intro\n${original}`;
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 5..5:
+changed`);

			const result = applyHashlineSectionWithRecovery(original, current, patch.sections[0]);

			expect(result).toEqual({
				text: "intro\nbefore a\ntarget\nafter a\nbefore b\nchanged\nafter b",
				recovered: true,
			});
		});

		it("should reject overlapping concrete ranges", () => {
			const original = "a\nb\nc";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 1..2:
+x
delete 2..3`);

			expect(() => applyHashlineSectionToText(original, patch.sections[0])).toThrow(/Overlapping/);
		});

		it("should preserve final newline when inserting at tail", () => {
			const original = "alpha\n";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
insert tail:
+omega`);

			const updated = applyHashlineSectionToText(original, patch.sections[0]);

			expect(updated).toBe("alpha\nomega\n");
		});

		it("should reject inserts inside replaced ranges", () => {
			const original = "a\nb\nc";
			const hash = computeFileHash(original);
			const patch = parseHashlinePatch(`¶file.txt#${hash}
replace 1..3:
+x
insert before 2:
+y`);

			expect(() => applyHashlineSectionToText(original, patch.sections[0])).toThrow(/middle/);
		});
	});
});
