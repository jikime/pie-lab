/**
 * Built-in design presets for the open-design core-loop port.
 *
 * The web app and pie agent never read open-design `skills/` SKILL.md files at
 * runtime. Instead the design loop ships a small, self-contained set of presets
 * (skill bodies + neutral design-system guides) that the bridge composes into
 * `appendSystemPrompt` when launching the agent session.
 *
 * Gate 1 decisions (00-brief.md, 2026-06-19):
 *  - exactly one skill preset: `single-page-html`
 *  - design systems are our own neutral mini guides (no external excerpts).
 *
 * See `02-architecture.md` §5.4. This module is the single source of truth for
 * `GET /v1/design/options` and for system-prompt composition.
 */

/** A selectable design skill (primary build recipe). */
export interface DesignSkillPreset {
	id: string;
	title: string;
	description: string;
	/** SKILL.md-style body text injected into the agent system prompt. */
	body: string;
}

/** A selectable design system (visual language guide). */
export interface DesignSystemPreset {
	id: string;
	title: string;
	/** DESIGN.md-style guide text injected into the agent system prompt. */
	guide: string;
}

/** Resolved preset for a single run. */
export interface ResolvedDesignPreset {
	skill: DesignSkillPreset;
	designSystem: DesignSystemPreset | undefined;
}

/**
 * The design-loop "constitution": fixed framing injected before any skill or
 * design-system text. This is what guarantees `write` (toolName==="write") is
 * the artifact signal the bridge listens for.
 */
export const DESIGN_LOOP_CONSTITUTION = [
	"You are operating inside a single-page HTML design loop.",
	"Your job is to produce ONE self-contained HTML artifact in the current working directory.",
	"",
	"Hard rules:",
	'- Use the `write` tool to create exactly one file named `index.html`. Do not create other files unless the user explicitly asks.',
	"- The file MUST be a complete document starting with `<!doctype html>` and including `<html>`, `<head>`, and `<body>`.",
	"- Inline everything: put CSS inside a `<style>` tag and JavaScript inside a `<script>` tag. You may reference well-known CDNs by URL, but do not create separate local asset files.",
	"- Write the full, finished document in a single `write` call. Do not stream partial fragments across multiple writes.",
	"- Do not run shell commands; only `write` and `read` tools are available.",
	"- Keep any explanatory prose brief. The artifact is the deliverable, not the chat.",
].join("\n");

const SINGLE_PAGE_HTML_SKILL: DesignSkillPreset = {
	id: "single-page-html",
	title: "Single-page HTML",
	description: "Generate one self-contained, responsive HTML page with inlined CSS and JS, ready to preview in a sandbox iframe.",
	body: [
		"# Skill: Single-page HTML",
		"",
		"Build a polished, production-quality single-page website or app screen as one HTML file.",
		"",
		"## Output",
		"- A single `index.html` written with the `write` tool.",
		"- Fully responsive (mobile-first), works without any build step.",
		"- Semantic, accessible markup: landmark elements, alt text, sufficient colour contrast, focus styles.",
		"",
		"## Craft",
		"- Establish a clear visual hierarchy: hero/heading, supporting content, call-to-action.",
		"- Use a coherent type scale and spacing rhythm. Prefer system font stacks unless a CDN font is clearly warranted.",
		"- Add tasteful, lightweight interactivity (hover/focus states, simple toggles) with inline vanilla JS only.",
		"- Avoid external local dependencies. Any third-party library must be a single CDN `<script>`/`<link>`.",
		"",
		"## Process",
		"1. Briefly restate the brief's intent in one or two sentences.",
		"2. Write the complete `index.html` in a single `write` call.",
		"3. Stop. Do not ask follow-up questions; make reasonable assumptions and note them in a short closing line.",
	].join("\n"),
};

const MINIMAL_DESIGN_SYSTEM: DesignSystemPreset = {
	id: "minimal",
	title: "Minimal",
	guide: [
		"# Design system: Minimal",
		"",
		"A calm, content-first aesthetic.",
		"",
		"- Palette: near-white background (#fafafa), near-black text (#171717), one restrained accent (#2563eb). Use grey scales for structure.",
		"- Typography: a single sans-serif family (system stack). Large, confident headings; generous line-height (1.6) for body.",
		"- Layout: a single centred column, max-width ~720px for text, ample whitespace, 8px spacing scale.",
		"- Components: flat surfaces, 1px hairline borders (#e5e5e5), 8px radius, no heavy shadows.",
		"- Motion: subtle only (150ms ease transitions on interactive elements).",
	].join("\n"),
};

const VIBRANT_DESIGN_SYSTEM: DesignSystemPreset = {
	id: "vibrant",
	title: "Vibrant",
	guide: [
		"# Design system: Vibrant",
		"",
		"A bold, energetic aesthetic for landing pages and marketing.",
		"",
		"- Palette: deep background (#0f172a), bright text (#f8fafc), saturated gradient accents (indigo #6366f1 → fuchsia #d946ef).",
		"- Typography: a strong geometric sans-serif (system stack with heavy weights). Oversized hero headings with tight tracking.",
		"- Layout: full-bleed sections, generous vertical rhythm, occasional asymmetry for interest.",
		"- Components: gradient buttons, soft glows, 16px radius cards with layered shadows, glassmorphism on overlays.",
		"- Motion: confident entrance transitions and hover lifts (200–300ms ease-out); respect prefers-reduced-motion.",
	].join("\n"),
};

const SKILL_PRESETS: readonly DesignSkillPreset[] = [SINGLE_PAGE_HTML_SKILL];
const DESIGN_SYSTEM_PRESETS: readonly DesignSystemPreset[] = [MINIMAL_DESIGN_SYSTEM, VIBRANT_DESIGN_SYSTEM];

/** Default skill id surfaced by `GET /v1/design/options`. */
export const DEFAULT_SKILL_ID = SINGLE_PAGE_HTML_SKILL.id;

/** Returns the full list of skill presets (for the options endpoint). */
export function listSkillPresets(): readonly DesignSkillPreset[] {
	return SKILL_PRESETS;
}

/** Returns the full list of design-system presets (for the options endpoint). */
export function listDesignSystemPresets(): readonly DesignSystemPreset[] {
	return DESIGN_SYSTEM_PRESETS;
}

/** Look up a skill preset by id. */
export function findSkillPreset(skillId: string): DesignSkillPreset | undefined {
	return SKILL_PRESETS.find((preset) => preset.id === skillId);
}

/** Look up a design-system preset by id. */
export function findDesignSystemPreset(designSystemId: string): DesignSystemPreset | undefined {
	return DESIGN_SYSTEM_PRESETS.find((preset) => preset.id === designSystemId);
}

/**
 * Resolve a run request into the concrete skill + optional design system.
 *
 * Returns `undefined` when the skill id is unknown (caller responds 400).
 * An unknown but non-null `designSystemId` is treated as "no design system"
 * rather than an error so the run can still proceed.
 */
export function resolvePreset(skillId: string, designSystemId: string | null): ResolvedDesignPreset | undefined {
	const skill = findSkillPreset(skillId);
	if (!skill) {
		return undefined;
	}
	const designSystem = designSystemId ? findDesignSystemPreset(designSystemId) : undefined;
	return { skill, designSystem };
}

/**
 * Compose the ordered `appendSystemPrompt` blocks for a run.
 * Direct analogue of open-design `composeDaemonSystemPrompt()`.
 */
export function composeDesignSystemPrompt(preset: ResolvedDesignPreset): string[] {
	const blocks: string[] = [DESIGN_LOOP_CONSTITUTION, preset.skill.body];
	if (preset.designSystem) {
		blocks.push(preset.designSystem.guide);
	}
	return blocks;
}
