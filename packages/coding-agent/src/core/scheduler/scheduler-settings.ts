export interface SchedulerSettings {
	enabled: boolean;
	tickIntervalSeconds: number;
	timeoutSeconds: number;
	scriptTimeoutSeconds: number;
	maxParallelJobs: number;
	scriptsEnabled: boolean;
	noAgentEnabled: boolean;
	defaultDeliver: "local";
	learning: {
		enabled: boolean;
		reviewEnabled: boolean;
	};
}

export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
	enabled: true,
	tickIntervalSeconds: 60,
	timeoutSeconds: 600,
	scriptTimeoutSeconds: 120,
	maxParallelJobs: 2,
	scriptsEnabled: true,
	noAgentEnabled: true,
	defaultDeliver: "local",
	learning: {
		enabled: true,
		reviewEnabled: false,
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

export function normalizeSchedulerSettings(input: unknown): SchedulerSettings {
	const root = asObject(input);
	const learning = asObject(root.learning);
	return {
		enabled: asBoolean(root.enabled, DEFAULT_SCHEDULER_SETTINGS.enabled),
		tickIntervalSeconds: asPositiveInteger(root.tickIntervalSeconds, DEFAULT_SCHEDULER_SETTINGS.tickIntervalSeconds),
		timeoutSeconds: asPositiveInteger(root.timeoutSeconds, DEFAULT_SCHEDULER_SETTINGS.timeoutSeconds),
		scriptTimeoutSeconds: asPositiveInteger(
			root.scriptTimeoutSeconds,
			DEFAULT_SCHEDULER_SETTINGS.scriptTimeoutSeconds,
		),
		maxParallelJobs: asPositiveInteger(root.maxParallelJobs, DEFAULT_SCHEDULER_SETTINGS.maxParallelJobs),
		scriptsEnabled: asBoolean(root.scriptsEnabled, DEFAULT_SCHEDULER_SETTINGS.scriptsEnabled),
		noAgentEnabled: asBoolean(root.noAgentEnabled, DEFAULT_SCHEDULER_SETTINGS.noAgentEnabled),
		defaultDeliver: "local",
		learning: {
			enabled: asBoolean(learning.enabled, DEFAULT_SCHEDULER_SETTINGS.learning.enabled),
			reviewEnabled: asBoolean(learning.reviewEnabled, DEFAULT_SCHEDULER_SETTINGS.learning.reviewEnabled),
		},
	};
}
