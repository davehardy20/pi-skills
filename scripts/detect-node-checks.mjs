#!/usr/bin/env node
// Capability detection for .github/workflows/pr-checks-node.yml.
// Appends `key=value` lines to $GITHUB_OUTPUT (GitHub Actions) or stdout.
// Extracted from the workflow for testability; keep outputs in sync with
// the workflow's step conditions.

import fs, { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LOCKFILES = ["package-lock.json", "npm-shrinkwrap.json"];

export function capabilities(pkg, exists) {
	const scripts = pkg?.scripts ?? {};
	const hasAny = (paths) => paths.some((path) => exists(path));
	return {
		has_package_json: pkg !== undefined,
		has_lockfile: hasAny(LOCKFILES),
		has_lint: Boolean(scripts.lint),
		has_typecheck: Boolean(scripts.typecheck || hasAny(["tsconfig.json"])),
		has_typecheck_script: Boolean(scripts.typecheck),
		// Only test configs the generic fallback can run (vitest);
		// jest would need its own runner branch.
		has_test: Boolean(
			scripts.test || hasAny(["vitest.config.ts", "vitest.config.js"]),
		),
		has_test_script: Boolean(scripts.test),
		has_validate_skills: Boolean(scripts["validate:skills"]),
		has_build: Boolean(scripts.build),
		has_audit: hasAny(LOCKFILES),
	};
}

export function main() {
	let pkg;
	if (fs.existsSync("package.json")) {
		try {
			pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
		} catch (e) {
			console.error(`package.json is not valid JSON: ${e.message}`);
			process.exit(1);
		}
	}
	const caps = capabilities(pkg, (path) => fs.existsSync(path));
	const lines = Object.entries(caps).map(([k, v]) => `${k}=${v}`);
	const out = process.env.GITHUB_OUTPUT;
	if (out) {
		fs.appendFileSync(out, `${lines.join("\n")}\n`);
	} else {
		console.log(lines.join("\n"));
	}
}

// Node realpaths import.meta.url, so argv[1] must be realpathed too —
// otherwise a symlinked tmpdir (macOS /var -> /private/var) defeats the
// comparison, as does percent-encoded spacing without fileURLToPath.
function realpathGuard(p) {
	try {
		return realpathSync(p);
	} catch {
		return resolve(p);
	}
}

if (
	process.argv[1] &&
	realpathGuard(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
