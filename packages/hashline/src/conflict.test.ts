import { describe, it, expect } from "bun:test";
import {
	detectMergeConflicts,
	resolveConflicts,
	detectSemanticConflicts,
	wouldConflict,
} from "./conflict.ts";

describe("conflict detection", () => {
	describe("merge conflicts", () => {
		it("should detect standard git merge markers", () => {
			const content = `line 1
<<<<<<< HEAD
our version
=======
their version
>>>>>>> branch
line 2`;

			const result = detectMergeConflicts(content);
			expect(result.hasConflicts).toBe(true);
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0].ours).toEqual(["our version"]);
			expect(result.conflicts[0].theirs).toEqual(["their version"]);
		});

		it("should detect multiple conflicts", () => {
			const content = `<<<<<<< HEAD
conflict 1 ours
=======
conflict 1 theirs
>>>>>>> branch
middle content
<<<<<<< HEAD
conflict 2 ours
=======
conflict 2 theirs
>>>>>>> branch`;

			const result = detectMergeConflicts(content);
			expect(result.hasConflicts).toBe(true);
			expect(result.conflicts).toHaveLength(2);
		});

		it("should return empty for non-conflicted content", () => {
			const content = "line 1\nline 2\nline 3";
			const result = detectMergeConflicts(content);
			expect(result.hasConflicts).toBe(false);
			expect(result.conflicts).toHaveLength(0);
		});
	});

	describe("conflict resolution", () => {
		it("should resolve with 'ours' strategy", () => {
			const content = `line 1
<<<<<<< HEAD
our version
=======
their version
>>>>>>> branch
line 2`;

			const resolved = resolveConflicts(content, "ours");
			expect(resolved).toContain("our version");
			expect(resolved).not.toContain("their version");
			expect(resolved).not.toContain("<<<<<<<");
		});

		it("should resolve with 'theirs' strategy", () => {
			const content = `line 1
<<<<<<< HEAD
our version
=======
their version
>>>>>>> branch
line 2`;

			const resolved = resolveConflicts(content, "theirs");
			expect(resolved).not.toContain("our version");
			expect(resolved).toContain("their version");
			expect(resolved).not.toContain("=======");
		});
	});

	describe("semantic conflicts", () => {
		it("should detect close edits", () => {
			const edits = [
				{ startLine: 1, endLine: 3, newContent: ["changed 1"] },
				{ startLine: 5, endLine: 6, newContent: ["changed 2"] },
			];

			const conflicts = detectSemanticConflicts(edits, 2);
			expect(conflicts).toHaveLength(1);
			expect(conflicts[0]).toContain(edits[0]);
			expect(conflicts[0]).toContain(edits[1]);
		});

		it("should not detect distant edits", () => {
			const edits = [
				{ startLine: 1, endLine: 3, newContent: ["changed 1"] },
				{ startLine: 10, endLine: 12, newContent: ["changed 2"] },
			];

			const conflicts = detectSemanticConflicts(edits, 2);
			expect(conflicts).toHaveLength(0);
		});
	});

	describe("range overlap", () => {
		it("should detect overlapping ranges", () => {
			const overlaps = wouldConflict(5, 10, 8, 12, 9, 15);
			expect(overlaps).toBe(true);
		});

		it("should not detect non-overlapping ranges", () => {
			const overlaps = wouldConflict(5, 10, 1, 4, 11, 15);
			expect(overlaps).toBe(false);
		});

		it("should handle adjacent ranges", () => {
			const overlaps = wouldConflict(5, 10, 1, 5, 10, 15);
			expect(overlaps).toBe(false);
		});
	});
});
