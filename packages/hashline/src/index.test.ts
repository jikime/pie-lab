import { describe, it, expect } from "bun:test";
import {
	applyHashlineEdit,
	applyHashlineEdits,
	computeEditContext,
	computeLineHash,
	findAnchorLine,
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
});
