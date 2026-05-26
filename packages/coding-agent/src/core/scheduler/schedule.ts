export type ScheduleKind = "once" | "interval" | "cron";

export interface ParsedSchedule {
	kind: ScheduleKind;
	schedule: string;
	scheduleDisplay: string;
	repeat: boolean;
	nextRunAt: string;
	intervalMs?: number;
	cronExpression?: string;
}

const DURATION_RE =
	/^(?:in\s+)?(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;
const EVERY_DURATION_RE =
	/^every\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/i;

function unitToMs(unit: string): number {
	const normalized = unit.toLowerCase();
	if (["s", "sec", "secs", "second", "seconds"].includes(normalized)) return 1000;
	if (["m", "min", "mins", "minute", "minutes"].includes(normalized)) return 60_000;
	if (["h", "hr", "hrs", "hour", "hours"].includes(normalized)) return 60 * 60_000;
	if (["d", "day", "days"].includes(normalized)) return 24 * 60 * 60_000;
	if (["w", "week", "weeks"].includes(normalized)) return 7 * 24 * 60 * 60_000;
	throw new Error(`Unsupported duration unit: ${unit}`);
}

function durationToMs(value: string, unit: string): number {
	const amount = Number(value);
	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error("Schedule duration must be a positive number.");
	}
	return amount * unitToMs(unit);
}

function parseCronField(field: string, min: number, max: number, names?: Record<string, number>): Set<number> {
	const values = new Set<number>();
	const addRange = (start: number, end: number, step = 1) => {
		if (step <= 0) throw new Error(`Invalid cron step: ${field}`);
		if (start < min || end > max || start > end) throw new Error(`Cron field out of range: ${field}`);
		for (let value = start; value <= end; value += step) {
			values.add(value);
		}
	};
	const parseValue = (raw: string): number => {
		const lowered = raw.toLowerCase();
		const named = names?.[lowered];
		if (named !== undefined) return named;
		const value = Number(raw);
		if (!Number.isInteger(value)) throw new Error(`Invalid cron value: ${raw}`);
		return value;
	};

	for (const part of field.split(",")) {
		const [rangePart, stepPart] = part.split("/");
		const step = stepPart === undefined ? 1 : Number(stepPart);
		if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step: ${part}`);

		if (rangePart === "*") {
			addRange(min, max, step);
			continue;
		}

		const rangeMatch = rangePart.match(/^([A-Za-z0-9]+)-([A-Za-z0-9]+)$/);
		if (rangeMatch) {
			addRange(parseValue(rangeMatch[1]), parseValue(rangeMatch[2]), step);
			continue;
		}

		const value = parseValue(rangePart);
		if (value < min || value > max) throw new Error(`Cron field out of range: ${part}`);
		values.add(value);
	}
	return values;
}

function normalizeDayOfWeek(values: Set<number>): Set<number> {
	const normalized = new Set<number>();
	for (const value of values) {
		normalized.add(value === 7 ? 0 : value);
	}
	return normalized;
}

function isWildcard(field: string): boolean {
	return field === "*" || field === "*/1";
}

function parseCronExpression(expression: string) {
	const parts = expression.trim().split(/\s+/);
	if (parts.length !== 5) {
		throw new Error("Cron schedule must use five fields: minute hour day-of-month month day-of-week.");
	}
	const monthNames: Record<string, number> = {
		jan: 1,
		feb: 2,
		mar: 3,
		apr: 4,
		may: 5,
		jun: 6,
		jul: 7,
		aug: 8,
		sep: 9,
		oct: 10,
		nov: 11,
		dec: 12,
	};
	const dowNames: Record<string, number> = {
		sun: 0,
		mon: 1,
		tue: 2,
		wed: 3,
		thu: 4,
		fri: 5,
		sat: 6,
	};
	return {
		minutes: parseCronField(parts[0], 0, 59),
		hours: parseCronField(parts[1], 0, 23),
		daysOfMonth: parseCronField(parts[2], 1, 31),
		months: parseCronField(parts[3], 1, 12, monthNames),
		daysOfWeek: normalizeDayOfWeek(parseCronField(parts[4], 0, 7, dowNames)),
		dayOfMonthWildcard: isWildcard(parts[2]),
		dayOfWeekWildcard: isWildcard(parts[4]),
	};
}

function cronMatches(date: Date, parsed: ReturnType<typeof parseCronExpression>): boolean {
	if (!parsed.minutes.has(date.getMinutes())) return false;
	if (!parsed.hours.has(date.getHours())) return false;
	if (!parsed.months.has(date.getMonth() + 1)) return false;

	const domMatches = parsed.daysOfMonth.has(date.getDate());
	const dowMatches = parsed.daysOfWeek.has(date.getDay());
	if (parsed.dayOfMonthWildcard && parsed.dayOfWeekWildcard) return true;
	if (parsed.dayOfMonthWildcard) return dowMatches;
	if (parsed.dayOfWeekWildcard) return domMatches;
	return domMatches || dowMatches;
}

export function nextCronRun(expression: string, after: Date = new Date()): Date {
	const parsed = parseCronExpression(expression);
	const candidate = new Date(after.getTime());
	candidate.setSeconds(0, 0);
	candidate.setMinutes(candidate.getMinutes() + 1);
	const maxMinutes = 5 * 366 * 24 * 60;
	for (let i = 0; i < maxMinutes; i++) {
		if (cronMatches(candidate, parsed)) {
			return candidate;
		}
		candidate.setMinutes(candidate.getMinutes() + 1);
	}
	throw new Error(`Could not find the next run for cron schedule: ${expression}`);
}

export function parseSchedule(input: string, options: { now?: Date; forceRepeat?: boolean } = {}): ParsedSchedule {
	const raw = input.trim();
	if (!raw) throw new Error("schedule is required.");
	const now = options.now ?? new Date();

	const everyMatch = raw.match(EVERY_DURATION_RE);
	if (everyMatch) {
		const intervalMs = durationToMs(everyMatch[1], everyMatch[2]);
		return {
			kind: "interval",
			schedule: raw,
			scheduleDisplay: raw,
			repeat: true,
			intervalMs,
			nextRunAt: new Date(now.getTime() + intervalMs).toISOString(),
		};
	}

	const durationMatch = raw.match(DURATION_RE);
	if (durationMatch) {
		const intervalMs = durationToMs(durationMatch[1], durationMatch[2]);
		const repeat = options.forceRepeat === true;
		return {
			kind: repeat ? "interval" : "once",
			schedule: raw,
			scheduleDisplay: repeat ? `every ${durationMatch[1]}${durationMatch[2]}` : raw,
			repeat,
			intervalMs: repeat ? intervalMs : undefined,
			nextRunAt: new Date(now.getTime() + intervalMs).toISOString(),
		};
	}

	if (raw.split(/\s+/).length === 5) {
		return {
			kind: "cron",
			schedule: raw,
			scheduleDisplay: raw,
			repeat: true,
			cronExpression: raw,
			nextRunAt: nextCronRun(raw, now).toISOString(),
		};
	}

	const timestamp = new Date(raw);
	if (!Number.isNaN(timestamp.getTime())) {
		return {
			kind: "once",
			schedule: raw,
			scheduleDisplay: timestamp.toISOString(),
			repeat: false,
			nextRunAt: timestamp.toISOString(),
		};
	}

	throw new Error(`Unsupported schedule: ${input}`);
}

export function computeNextRun(
	job: {
		kind: ScheduleKind;
		repeat: boolean;
		intervalMs?: number;
		cronExpression?: string;
		schedule: string;
	},
	after: Date = new Date(),
): string | undefined {
	if (!job.repeat) return undefined;
	if (job.kind === "interval") {
		if (!job.intervalMs || job.intervalMs <= 0) {
			throw new Error(`Interval job is missing intervalMs: ${job.schedule}`);
		}
		return new Date(after.getTime() + job.intervalMs).toISOString();
	}
	if (job.kind === "cron") {
		if (!job.cronExpression) throw new Error(`Cron job is missing cronExpression: ${job.schedule}`);
		return nextCronRun(job.cronExpression, after).toISOString();
	}
	return undefined;
}
