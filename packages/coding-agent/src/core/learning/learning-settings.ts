export interface LearningSettings {
	enabled: boolean;
	review: {
		mode: "auto" | "suggest" | "off";
	};
	memory: {
		enabled: boolean;
		reviewIntervalTurns: number;
		/** Minimum minutes between background reviews regardless of turn count (0 = disabled). */
		reviewIntervalMinutes: number;
	};
	skills: {
		enabled: boolean;
		autoSave: boolean;
		reviewToolIterations: number;
		curatorEnabled: boolean;
		curator: {
			staleAfterDays: number;
			archiveAfterDays: number;
			autoArchive: boolean;
			backupBeforeRun: boolean;
			pruneAfterDays: number;
			consolidateIntervalDays: number;
		};
	};
}

export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
	enabled: true,
	review: {
		mode: "auto",
	},
	memory: {
		enabled: true,
		reviewIntervalTurns: 5,
		reviewIntervalMinutes: 60,
	},
	skills: {
		enabled: true,
		autoSave: true,
		reviewToolIterations: 8,
		curatorEnabled: true,
		curator: {
			staleAfterDays: 30,
			archiveAfterDays: 90,
			autoArchive: true,
			backupBeforeRun: true,
			pruneAfterDays: 180,
			consolidateIntervalDays: 7,
		},
	},
};

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : fallback;
}

export function normalizeLearningSettings(input: unknown): LearningSettings {
	const root = asObject(input);
	const memory = asObject(root.memory);
	const review = asObject(root.review);
	const skills = asObject(root.skills);

	return {
		enabled: asBoolean(root.enabled, DEFAULT_LEARNING_SETTINGS.enabled),
		review: {
			mode: asReviewMode(review.mode, DEFAULT_LEARNING_SETTINGS.review.mode),
		},
		memory: {
			enabled: asBoolean(memory.enabled, DEFAULT_LEARNING_SETTINGS.memory.enabled),
			reviewIntervalTurns: asPositiveInteger(
				memory.reviewIntervalTurns,
				DEFAULT_LEARNING_SETTINGS.memory.reviewIntervalTurns,
			),
			reviewIntervalMinutes:
				typeof memory.reviewIntervalMinutes === "number" &&
				Number.isFinite(memory.reviewIntervalMinutes) &&
				memory.reviewIntervalMinutes >= 0
					? Math.floor(memory.reviewIntervalMinutes)
					: DEFAULT_LEARNING_SETTINGS.memory.reviewIntervalMinutes,
		},
		skills: {
			enabled: asBoolean(skills.enabled, DEFAULT_LEARNING_SETTINGS.skills.enabled),
			autoSave: asBoolean(skills.autoSave, DEFAULT_LEARNING_SETTINGS.skills.autoSave),
			reviewToolIterations: asPositiveInteger(
				skills.reviewToolIterations,
				DEFAULT_LEARNING_SETTINGS.skills.reviewToolIterations,
			),
			curatorEnabled: asBoolean(skills.curatorEnabled, DEFAULT_LEARNING_SETTINGS.skills.curatorEnabled),
			curator: normalizeCuratorSettings(skills.curator),
		},
	};
}

function asReviewMode(value: unknown, fallback: LearningSettings["review"]["mode"]) {
	return value === "auto" || value === "suggest" || value === "off" ? value : fallback;
}

function normalizeCuratorSettings(input: unknown): LearningSettings["skills"]["curator"] {
	const curator = asObject(input);
	return {
		staleAfterDays: asPositiveInteger(
			curator.staleAfterDays,
			DEFAULT_LEARNING_SETTINGS.skills.curator.staleAfterDays,
		),
		archiveAfterDays: asPositiveInteger(
			curator.archiveAfterDays,
			DEFAULT_LEARNING_SETTINGS.skills.curator.archiveAfterDays,
		),
		autoArchive: asBoolean(curator.autoArchive, DEFAULT_LEARNING_SETTINGS.skills.curator.autoArchive),
		backupBeforeRun: asBoolean(curator.backupBeforeRun, DEFAULT_LEARNING_SETTINGS.skills.curator.backupBeforeRun),
		pruneAfterDays: asPositiveInteger(
			curator.pruneAfterDays,
			DEFAULT_LEARNING_SETTINGS.skills.curator.pruneAfterDays,
		),
		consolidateIntervalDays: asPositiveInteger(
			curator.consolidateIntervalDays,
			DEFAULT_LEARNING_SETTINGS.skills.curator.consolidateIntervalDays,
		),
	};
}
