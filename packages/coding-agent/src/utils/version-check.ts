import { compare, valid } from "semver";
import { ENV_OFFLINE, ENV_SKIP_VERSION_CHECK, isTruthyEnv, PACKAGE_NAME } from "../config.ts";
import { getPiUserAgent } from "./pi-user-agent.ts";

const LATEST_VERSION_URL = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}/latest`;
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPieRelease {
	version: string;
	packageName?: string;
	note?: string;
}

export type LatestPiRelease = LatestPieRelease;

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPieRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestPieRelease | undefined> {
	if (isTruthyEnv(ENV_SKIP_VERSION_CHECK, "PI_SKIP_VERSION_CHECK") || isTruthyEnv(ENV_OFFLINE, "PI_OFFLINE")) {
		return undefined;
	}

	const response = await fetch(LATEST_VERSION_URL, {
		headers: {
			"User-Agent": getPiUserAgent(currentVersion),
			accept: "application/vnd.npm.install-v1+json, application/json",
		},
		signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS),
	});
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		name?: unknown;
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const packageName =
		typeof data.name === "string" && data.name.trim()
			? data.name.trim()
			: typeof data.packageName === "string" && data.packageName.trim()
				? data.packageName.trim()
				: undefined;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		packageName,
		...(note ? { note } : {}),
	};
}

export async function getLatestPieVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestPieRelease(currentVersion, options))?.version;
}

export async function checkForNewPieVersion(currentVersion: string): Promise<LatestPieRelease | undefined> {
	try {
		const latestRelease = await getLatestPieRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestPieRelease | undefined> {
	return getLatestPieRelease(currentVersion, options);
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return getLatestPieVersion(currentVersion, options);
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPieRelease | undefined> {
	return checkForNewPieVersion(currentVersion);
}
