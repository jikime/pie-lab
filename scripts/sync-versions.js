#!/usr/bin/env node

/**
 * Syncs internal workspace dependency versions to match their current versions.
 * This keeps lockstep packages installable before npm regenerates lockfiles.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function workspaceDirsFromPattern(pattern) {
	if (!pattern.includes("*")) {
		return [pattern];
	}

	const starIndex = pattern.indexOf("*");
	const baseDir = pattern.slice(0, starIndex).replace(/\/$/, "");
	const suffix = pattern.slice(starIndex + 1).replace(/^\//, "");
	if (!existsSync(baseDir)) {
		return [];
	}

	return readdirSync(baseDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(baseDir, entry.name, suffix))
		.filter((dir) => existsSync(join(dir, "package.json")));
}

function getWorkspacePackagePaths() {
	const rootPkg = readJson("package.json");
	const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : [];
	const paths = workspaces.flatMap(workspaceDirsFromPattern).map((dir) => join(dir, "package.json"));
	return [...new Set(paths)].filter((path) => existsSync(path) && statSync(path).isFile());
}

function updateDependencyGroup(pkg, groupName, versionMap) {
	const dependencies = pkg.data[groupName];
	if (!dependencies) {
		return 0;
	}

	let updates = 0;
	for (const [depName, currentVersion] of Object.entries(dependencies)) {
		const workspaceVersion = versionMap[depName];
		if (!workspaceVersion) {
			continue;
		}

		const newVersion = `^${workspaceVersion}`;
		if (currentVersion === newVersion) {
			continue;
		}

		console.log(`\n${pkg.data.name}:`);
		console.log(`  ${depName}: ${currentVersion} -> ${newVersion} (${groupName})`);
		dependencies[depName] = newVersion;
		pkg.updated = true;
		updates++;
	}
	return updates;
}

const workspacePackagePaths = getWorkspacePackagePaths();
const packages = workspacePackagePaths.map((path) => ({ path, data: readJson(path), updated: false }));
const rootPackage = { path: "package.json", data: readJson("package.json"), updated: false };
const versionMap = {};

for (const pkg of packages) {
	if (pkg.data.name && pkg.data.version) {
		versionMap[pkg.data.name] = pkg.data.version;
	}
}

console.log("Current workspace versions:");
for (const [name, version] of Object.entries(versionMap).sort()) {
	console.log(`  ${name}: ${version}`);
}

const versions = new Set(Object.values(versionMap));
if (versions.size > 1) {
	console.error("\nERROR: Not all workspaces have the same version.");
	console.error("Expected lockstep versioning. Run one of:");
	console.error("  npm run version:patch");
	console.error("  npm run version:minor");
	console.error("  npm run version:major");
	process.exit(1);
}

console.log("\nAll workspaces at same version (lockstep)");

let totalUpdates = 0;
for (const pkg of [rootPackage, ...packages]) {
	totalUpdates += updateDependencyGroup(pkg, "dependencies", versionMap);
	totalUpdates += updateDependencyGroup(pkg, "devDependencies", versionMap);
	totalUpdates += updateDependencyGroup(pkg, "optionalDependencies", versionMap);
	totalUpdates += updateDependencyGroup(pkg, "peerDependencies", versionMap);
}

for (const pkg of [rootPackage, ...packages]) {
	if (pkg.updated) {
		writeFileSync(pkg.path, `${JSON.stringify(pkg.data, null, "\t")}\n`);
	}
}

if (totalUpdates === 0) {
	console.log("\nAll internal workspace dependencies already in sync.");
} else {
	console.log(`\nUpdated ${totalUpdates} dependency version(s)`);
}
