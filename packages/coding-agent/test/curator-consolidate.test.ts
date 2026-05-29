import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillCurator } from "../src/core/learning/skill-curator.ts";
import { SkillManager } from "../src/core/learning/skill-manager.ts";

function makeTempDir(prefix: string): string {
	const dir = join(tmpdir(), `${prefix}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeSkillManager(agentDir: string, cwd: string): SkillManager {
	return new SkillManager({ agentDir, cwd });
}

// ---------------------------------------------------------------------------
// SkillCurator.status + consolidation state tests
// ---------------------------------------------------------------------------

describe("SkillCurator.status", () => {
	it("returns empty when no agent skills exist", () => {
		const agentDir = makeTempDir("curator-test-agent");
		const cwd = makeTempDir("curator-test-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);
		const curator = new SkillCurator({ skillManager });

		const statuses = curator.status();
		expect(statuses).toEqual([]);
	});

	it("tracks consolidation state", () => {
		const agentDir = makeTempDir("curator-state-test");
		const cwd = makeTempDir("curator-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);
		const curator = new SkillCurator({ skillManager });

		const state = curator.getConsolidationState();
		expect(state.lastConsolidatedAt).toBeNull();
		expect(state.consolidationCount).toBe(0);
	});
});

describe("SkillCurator.consolidate (unit — no LLM)", () => {
	it("returns early with empty result when fewer than 2 active skills", async () => {
		const agentDir = makeTempDir("curator-consolidate-test");
		const cwd = makeTempDir("curator-consolidate-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);
		const curator = new SkillCurator({ skillManager });

		// No skills → should return empty without calling LLM
		const mockStreamFn = () => {
			throw new Error("streamFn should not be called with fewer than 2 skills");
		};
		const result = await curator.consolidate(mockStreamFn as any, { dryRun: true });

		expect(result.consolidations).toHaveLength(0);
		expect(result.prunings).toHaveLength(0);
		expect(result.rawOutput).toBe("");
		expect(result.iterations).toBe(0);
	});

	it("does not backup in dry-run mode", async () => {
		const agentDir = makeTempDir("curator-dryrun-test");
		const cwd = makeTempDir("curator-dryrun-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);

		// Create 2 agent skills so we can hit the consolidation path
		skillManager.create(
			"gateway-telegram",
			`---
name: gateway-telegram
description: Use when configuring Telegram gateway adapter
---
# Telegram Gateway
Details about telegram setup.`,
		);
		skillManager.create(
			"gateway-discord",
			`---
name: gateway-discord
description: Use when configuring Discord gateway adapter
---
# Discord Gateway
Details about discord setup.`,
		);

		const curator = new SkillCurator({ skillManager, policy: { backupBeforeRun: true } });

		// Mock LLM that returns an immediate done (no tool calls, empty text)
		const mockStreamFn = async () => {
			return (async function* () {
				yield {
					type: "done",
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "No consolidation needed.\n\n## Structured summary (required)\n```yaml\nconsolidations: []\nprunings: []\n```",
							},
						],
					},
				};
			})();
		};

		const result = await curator.consolidate(mockStreamFn as any, { dryRun: true });

		// Dry-run should NOT create a backup
		expect(result.backupPath).toBeUndefined();
		expect(result.dryRun).toBe(true);
	});

	it("creates backup when backupBeforeRun is set and not dry-run", async () => {
		const agentDir = makeTempDir("curator-backup-test");
		const cwd = makeTempDir("curator-backup-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);

		skillManager.create(
			"skill-alpha",
			`---
name: skill-alpha
description: Alpha skill
---
# Alpha`,
		);
		skillManager.create(
			"skill-beta",
			`---
name: skill-beta
description: Beta skill
---
# Beta`,
		);

		const curator = new SkillCurator({ skillManager, policy: { backupBeforeRun: true } });

		const mockStreamFn = async () => {
			return (async function* () {
				yield {
					type: "done",
					message: {
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Done.\n\n## Structured summary (required)\n```yaml\nconsolidations: []\nprunings: []\n```",
							},
						],
					},
				};
			})();
		};

		const result = await curator.consolidate(mockStreamFn as any, { dryRun: false });
		expect(result.backupPath).toBeDefined();
		expect(typeof result.backupPath).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// Structured YAML summary parsing (internal logic tested indirectly)
// ---------------------------------------------------------------------------

describe("SkillCurator.consolidate — YAML summary parsing", () => {
	it("parses consolidations and prunings from LLM response", async () => {
		const agentDir = makeTempDir("curator-yaml-test");
		const cwd = makeTempDir("curator-yaml-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);

		skillManager.create(
			"discord-setup",
			`---
name: discord-setup
description: Discord setup
---
# Discord Setup`,
		);
		skillManager.create(
			"discord-voice",
			`---
name: discord-voice
description: Discord voice
---
# Discord Voice`,
		);

		const curator = new SkillCurator({ skillManager, policy: { backupBeforeRun: false } });

		const fakeResponse = `
I merged discord-setup and discord-voice into a single umbrella skill.

## Structured summary (required)
\`\`\`yaml
consolidations:
  - from: discord-voice
    into: discord-setup
    reason: Both cover Discord configuration; merged voice details as subsection
prunings: []
\`\`\`
`;

		const mockStreamFn = async () => {
			return (async function* () {
				yield {
					type: "done",
					message: {
						role: "assistant",
						content: [{ type: "text", text: fakeResponse }],
					},
				};
			})();
		};

		const result = await curator.consolidate(mockStreamFn as any, { dryRun: true });

		expect(result.consolidations).toHaveLength(1);
		expect(result.consolidations[0]).toMatchObject({
			from: "discord-voice",
			into: "discord-setup",
		});
		expect(result.prunings).toHaveLength(0);
		expect(result.iterations).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// maybeConsolidate interval check
// ---------------------------------------------------------------------------

describe("SkillCurator.maybeConsolidate", () => {
	it("returns null when never ran but fewer than 5 active skills", async () => {
		const agentDir = makeTempDir("curator-maybe-test");
		const cwd = makeTempDir("curator-maybe-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);

		// Create only 2 skills — below the 5-skill auto-trigger threshold
		skillManager.create("test-a", "---\nname: test-a\ndescription: A\n---\n# A");
		skillManager.create("test-b", "---\nname: test-b\ndescription: B\n---\n# B");

		const curator = new SkillCurator({ skillManager });
		const mockStreamFn = async () => {
			throw new Error("Should not call LLM");
		};

		const result = await curator.maybeConsolidate(mockStreamFn as any);
		expect(result).toBeNull();
	});

	it("returns null when last consolidation was recent", async () => {
		const agentDir = makeTempDir("curator-recent-test");
		const cwd = makeTempDir("curator-recent-cwd");
		const skillManager = makeSkillManager(agentDir, cwd);

		for (let i = 0; i < 6; i++) {
			skillManager.create(`skill-${i}`, `---\nname: skill-${i}\ndescription: Skill ${i}\n---\n# Skill ${i}`);
		}

		const curator = new SkillCurator({
			skillManager,
			policy: { consolidateIntervalDays: 7, backupBeforeRun: false },
		});

		// Manually set state with recent consolidation (just now)
		const stateFile = join(agentDir, "skills", ".curator_state");
		mkdirSync(join(agentDir, "skills"), { recursive: true });
		writeFileSync(
			stateFile,
			JSON.stringify({
				lastConsolidatedAt: new Date().toISOString(),
				consolidationCount: 1,
				lastConsolidationSummary: "",
			}),
			"utf-8",
		);

		const mockStreamFn = async () => {
			throw new Error("Should not call LLM when interval not elapsed");
		};

		const result = await curator.maybeConsolidate(mockStreamFn as any);
		expect(result).toBeNull();
	});
});
