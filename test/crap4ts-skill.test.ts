import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { test } from "vitest";
import {
	analyzeSource,
	buildRows,
	computeCrap,
	detectCoverageCommand,
	EXCLUDED_DIRS,
	evaluateThreshold,
	formatReport,
	functionCoverage,
	matchStatements,
	ownFunctionSpans,
	parseCoverageData,
	SOURCE_EXTENSIONS,
	shouldExcludeFile,
	sortRows,
} from "../skills/engineering/crap4ts/scripts/crap4ts.mjs";

test("computeCrap applies the crap4j formula", () => {
	// CC=1, cov=1.0 -> 1
	assert.equal(computeCrap(1, 1), 1);
	// CC=12, cov=0.45 -> 144 * 0.55^3 + 12 = 144*0.166375 + 12 = 35.958
	assert.ok(Math.abs((computeCrap(12, 0.45) ?? 0) - 35.958) < 0.001);
	// unknown coverage -> null
	assert.equal(computeCrap(3, null), null);
	assert.equal(computeCrap(3, Number.NaN), null);
});

test("analyzeSource counts decision points like the crap4* family", () => {
	const source = `
		function simple() { return 1; }
		function branches(a, b, c) {
			let x = 0;                       // CC 1
			if (a) x += 1;                   // +1
			if (b) x += 1; else x += 2;      // +1
			while (x < 10) x += 1;           // +1
			do { x -= 1; } while (a);        // +1
			for (let i = 0; i < 3; i++) x++; // +1
			for (const k in c) x++;          // +1
			for (const v of [1]) x++;        // +1
			switch (x) { case 1: case 2: break; default: break; } // +2
			try { x = risky(); } catch (e) { x = 0; } // +1
			x = a ? 1 : 2;                   // +1
			x = a && b;                      // +1
			x = a || b;                      // +1
			x = a ?? b;                      // +1
			return x;
		}
	`;
	const functions = analyzeSource(ts, "sample.ts", source);
	const byName = new Map(functions.map((fn) => [fn.name, fn]));
	assert.equal(byName.get("simple")?.cc, 1);
	// 1 + 14 decision points = 15
	assert.equal(byName.get("branches")?.cc, 15);
});

test("analyzeSource assigns contextual names and reports nested functions separately", () => {
	const source = `
		const formatAmount = (n) => {
			const helper = function inner() { if (n) return 1; return 0; };
			return helper();
		};
		class Widget {
			run(a) { if (a) return 1; return 0; }
			get value() { return 1; }
			constructor() { this.x = 0; }
		}
		const handlers = { onClick: (e) => e ? 1 : 0 };
	`;
	const functions = analyzeSource(ts, "names.ts", source);
	const names = functions.map((fn) => fn.name);
	assert.ok(names.includes("formatAmount"));
	assert.ok(names.includes("inner"));
	assert.ok(names.includes("Widget.run"));
	assert.ok(names.includes("Widget.value"));
	assert.ok(names.includes("Widget.constructor"));
	assert.ok(names.includes("onClick"));
	// nested helper's decision does not inflate the parent's CC
	const formatAmount = functions.find((fn) => fn.name === "formatAmount");
	assert.equal(formatAmount?.cc, 1);
});

test("analyzeSource unquotes string-keyed property and method names", () => {
	const source = `
		const h = { "on-click": () => {} };
		class Actions {
			"do-thing"() { return 1; }
			get "cached-value"() { return 2; }
		}
	`;
	const functions = analyzeSource(ts, "string-keys.ts", source);
	const names = functions.map((fn) => fn.name);
	assert.ok(names.includes("on-click"));
	assert.ok(names.includes("Actions.do-thing"));
	assert.ok(names.includes("Actions.cached-value"));
	// names must be unquoted, never `"on-click"`
	for (const name of names) assert.ok(!name.startsWith('"'));
});

test("analyzeSource handles unreadable code paths gracefully", () => {
	const functions = analyzeSource(ts, "empty.ts", "");
	assert.deepEqual(functions, []);
});

test("parseCoverageData and functionCoverage map statements to functions", () => {
	const statements = {
		"/proj/src/core.ts": {
			statementMap: {
				0: { start: { line: 1 }, end: { line: 1 } },
				1: { start: { line: 2 }, end: { line: 2 } },
				2: { start: { line: 3 }, end: { line: 3 } },
				3: { start: { line: 4 }, end: { line: 4 } },
			},
			s: { 0: 5, 1: 0, 2: 3, 3: 0 },
		},
	};
	const map = parseCoverageData(statements);
	const fn = {
		startLine: 1,
		endLine: 4,
		start: { line: 1, column: 0 },
		end: { line: 4, column: 20 },
	};
	const cov = functionCoverage(fn, map.get("/proj/src/core.ts")?.statements);
	assert.equal(cov, 0.5);
	// no overlap -> null (N/A), never fabricated
	assert.equal(
		functionCoverage(
			{
				startLine: 10,
				endLine: 20,
				start: { line: 10, column: 0 },
				end: { line: 20, column: 0 },
			},
			map.get("/proj/src/core.ts")?.statements,
		),
		null,
	);
	assert.equal(functionCoverage(fn, null), null);
	// missing positions -> N/A (legacy shape cannot be containment-checked)
	assert.equal(
		functionCoverage(
			// legacy shape: positions missing
			{ startLine: 1, endLine: 4 } as never,
			map.get("/proj/src/core.ts")?.statements,
		),
		null,
	);
});

test("matchStatements uses exact match then unique suffix fallback", () => {
	const map = parseCoverageData({
		"/other/build/x/src/core.ts": {
			statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
			s: { 0: 1 },
		},
	});
	// exact
	assert.equal(
		matchStatements("/other/build/x/src/core.ts", map)?.statements.length,
		1,
	);
	// unique 2-segment suffix fallback
	assert.equal(matchStatements("/proj/src/core.ts", map)?.statements.length, 1);
	// no match at all
	assert.equal(matchStatements("/proj/src/nope.ts", map), null);
});

test("buildRows joins coverage with complexity and computes CRAP", () => {
	const functions = [
		{
			name: "validate",
			file: "src/core.ts",
			startLine: 1,
			endLine: 10,
			start: { line: 1, column: 0 },
			end: { line: 10, column: 1 },
			cc: 10,
		},
		{
			name: "simple",
			file: "src/core.ts",
			startLine: 12,
			endLine: 14,
			start: { line: 12, column: 0 },
			end: { line: 14, column: 1 },
			cc: 1,
		},
	];
	const map = new Map([
		[
			resolve("/proj/src/core.ts"),
			{
				statements: [
					{
						startLine: 1,
						endLine: 10,
						startColumn: 0,
						endColumn: 1,
						hits: 0,
					},
					{
						startLine: 12,
						endLine: 14,
						startColumn: 0,
						endColumn: 1,
						hits: 4,
					},
				],
				functions: [],
			},
		],
	]);
	const rows = buildRows(functions, map, "/proj");
	assert.equal(rows[0]?.name, "validate");
	assert.equal(rows[0]?.coverage, 0);
	// CC=10, cov=0 -> 100 * 1 + 10 = 110
	assert.equal(rows[0]?.crap, 110);
	assert.equal(rows[1]?.coverage, 1);
	assert.equal(rows[1]?.crap, 1);
});

test("buildRows reports N/A without a coverage map", () => {
	const functions = [
		{
			name: "validate",
			file: "src/core.ts",
			startLine: 1,
			endLine: 10,
			start: { line: 1, column: 0 },
			end: { line: 10, column: 1 },
			cc: 10,
		},
	];
	const rows = buildRows(functions, null, "/proj");
	assert.equal(rows[0]?.coverage, null);
	assert.equal(rows[0]?.crap, null);
});

test("sortRows is worst-first with N/A at the bottom", () => {
	const rows = [
		{ name: "a", file: "a.ts", cc: 2, coverage: 1, crap: 2 },
		{ name: "b", file: "b.ts", cc: 12, coverage: 0.45, crap: 35.958 },
		{ name: "c", file: "c.ts", cc: 9, coverage: null, crap: null },
		{ name: "d", file: "d.ts", cc: 3, coverage: 1, crap: 3 },
	];
	const sorted = sortRows(rows);
	assert.equal(sorted[0]?.name, "b");
	assert.equal(sorted[1]?.name, "d");
	assert.equal(sorted[2]?.name, "a");
	assert.equal(sorted[3]?.name, "c");
});

test("formatReport renders the worst-first table with N/A rows last", () => {
	const rows = [
		{
			name: "validateTransaction",
			file: "src/payments/core.ts",
			cc: 12,
			coverage: 0.45,
			crap: 35.958,
		},
		{
			name: "formatAmount",
			file: "src/payments/core.ts",
			cc: 1,
			coverage: 1,
			crap: 1,
		},
		{
			name: "mystery",
			file: "src/other.ts",
			cc: 5,
			coverage: null,
			crap: null,
		},
	];
	const report = formatReport(rows);
	assert.match(report, /^CRAP Report$/m);
	assert.match(report, /^===========/m);
	assert.match(
		report,
		/validateTransaction\s+src\/payments\/core\.ts\s+12\s+45\.0%\s+36\.0/,
	);
	assert.match(
		report,
		/formatAmount\s+src\/payments\/core\.ts\s+1\s+100\.0%\s+1\.0/,
	);
	assert.match(report, /mystery\s+src\/other\.ts\s+5\s+N\/A\s+N\/A/);
	// N/A row comes last
	assert.ok(report.indexOf("mystery") > report.indexOf("formatAmount"));
});

test("evaluateThreshold returns only rows exceeding the gate", () => {
	const rows = [
		{ name: "ok", file: "a.ts", cc: 2, coverage: 1, crap: 2 },
		{ name: "bad", file: "b.ts", cc: 12, coverage: 0.45, crap: 35.958 },
		{ name: "na", file: "c.ts", cc: 9, coverage: null, crap: null },
	];
	assert.deepEqual(
		evaluateThreshold(rows, 30).map((r) => r.name),
		["bad"],
	);
	assert.deepEqual(
		evaluateThreshold(rows, 1).map((r) => r.name),
		["ok", "bad"],
	);
});

test("shouldExcludeFile filters generated, config, and test files", () => {
	assert.equal(shouldExcludeFile("index.d.ts"), true);
	assert.equal(shouldExcludeFile("core.test.ts"), true);
	assert.equal(shouldExcludeFile("core.spec.tsx"), true);
	assert.equal(shouldExcludeFile("Button.stories.jsx"), true);
	assert.equal(shouldExcludeFile("vite.config.mjs"), true);
	assert.equal(shouldExcludeFile("core.ts"), false);
	assert.equal(shouldExcludeFile("Button.tsx"), false);
});

test("self-check: the analyzer stays clean under its own metric", async () => {
	// Analyze the analyzer with its own complexity rules (no coverage).
	const path = new URL(
		"../skills/engineering/crap4ts/scripts/crap4ts.mjs",
		import.meta.url,
	).pathname;
	const { readFile } = await import("node:fs/promises");
	const text = await readFile(path, "utf8");
	const functions = analyzeSource(ts, "crap4ts.mjs", text);
	assert.ok(functions.length > 0);
	for (const fn of functions) {
		assert.ok(
			fn.cc <= 30,
			`${fn.name} has CC ${fn.cc} — split it (Clean Code Ch 3)`,
		);
	}
});

test("skill documents the optional Seeds and mutation feedback contract", async () => {
	const { readFile } = await import("node:fs/promises");
	const skillPath = new URL(
		"../skills/engineering/crap4ts/SKILL.md",
		import.meta.url,
	);
	const skill = await readFile(skillPath.pathname, "utf8");
	const requiredGuidance = [
		"## Optional Seeds Handoff",
		"## Dependency Preflight",
		"@vitest/coverage-v8",
		"@stryker-mutator/core",
		"Ask Dave before installing",
		"target repository's package manager",
		"agent-run, consent-gated preflight",
		"does not autonomously install dependencies",
		"caller-supplied `--coverage-command`",
		"through a shell",
		"The caller is responsible",
		"Inspect the selected coverage command",
		"Do not pass installer commands",
		"Report-only use stops after triage",
		"mutation testing is required",
		"does not create Seeds issues",
		"deletes and recreates `coverage/`",
		"`--no-coverage` as the filesystem-read-only path",
		"No coverage",
		"return to characterization",
		"Covered survivor",
		"Equivalent",
		"Killed",
		"mark mutation unavailable",
		"never claim the gate passed",
		"seeds-architecture-review",
		"Use a plain issue for one function",
		"Seeds tooling is unavailable",
		"Ask Dave before initializing Seeds",
		"remain in report-only mode",
		"Detect its package manager from the lockfile",
		"`packageManager`",
		"workspace metadata",
		"only then fall back to `npm`",
		"sources disagree",
		"headline mutation score",
		"covered-only score",
		"whole-file percentage",
		"target repository",
		"Never copy",
		"preserve it",
		"never lower it",
		"invocation-specific or temporary configuration",
		"Closure still requires the shared gate",
		"Multi-function or multi-module",
	];
	for (const guidance of requiredGuidance) {
		assert.ok(
			skill.includes(guidance),
			`missing workflow guidance: ${guidance}`,
		);
	}
});

test("temporary-file smoke: analyzeSource works on real files", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-test-`);
	const file = resolve(dir, "tmp.ts");
	await writeFile(file, "export function f(a) { return a ? 1 : 2; }\n", "utf8");
	const { readFile } = await import("node:fs/promises");
	const text = await readFile(file, "utf8");
	const functions = analyzeSource(ts, file, text);
	assert.equal(functions[0]?.name, "f");
	assert.equal(functions[0]?.cc, 2);
});

test("detectCoverageCommand prefers scripts then local runners", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-detect-`);
	const { mkdir, writeFile: write, rm } = await import("node:fs/promises");
	await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
	try {
		// no scripts, no runners -> null
		assert.equal(detectCoverageCommand(dir, {}), null);

		// test:coverage script wins
		assert.equal(
			detectCoverageCommand(dir, {
				scripts: { "test:coverage": "vitest --coverage" },
			}),
			"npm run test:coverage",
		);

		// local vitest binary is picked when no scripts exist
		await write(
			join(dir, "node_modules", ".bin", "vitest"),
			"#!/bin/sh\n",
			"utf8",
		);
		const vitestCommand = detectCoverageCommand(dir, {});
		assert.ok(vitestCommand?.includes("vitest"));

		// local jest is picked when vitest is absent
		await rm(join(dir, "node_modules", ".bin", "vitest"));
		await write(
			join(dir, "node_modules", ".bin", "jest"),
			"#!/bin/sh\n",
			"utf8",
		);
		const jestCommand = detectCoverageCommand(dir, {});
		assert.ok(jestCommand?.includes("jest"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("exported constants are populated Sets", () => {
	assert.ok(SOURCE_EXTENSIONS instanceof Set);
	assert.ok(EXCLUDED_DIRS instanceof Set);
	assert.ok(SOURCE_EXTENSIONS.has(".ts"));
	assert.ok(EXCLUDED_DIRS.has("node_modules"));
});

const SCRIPT_PATH = new URL(
	"../skills/engineering/crap4ts/scripts/crap4ts.mjs",
	import.meta.url,
).pathname;

async function createTempProject(): Promise<string> {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-cli-`);
	const { mkdir } = await import("node:fs/promises");
	await mkdir(join(dir, "src"), { recursive: true });
	await writeFile(
		join(dir, "package.json"),
		JSON.stringify({ name: "fixture", private: true }),
		"utf8",
	);
	await writeFile(
		join(dir, "src", "core.ts"),
		"export function risky(a: number): number {\n" +
			"  if (a > 1) return 2;\n" +
			"  if (a < 0) return 0;\n" +
			"  return a ? 1 : 0;\n" +
			"}\n",
		"utf8",
	);
	return dir;
}

function runCli(dir: string, ...args: string[]) {
	return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
		cwd: dir,
		encoding: "utf8",
	});
}

test("CLI smoke: --no-coverage prints report and exits 0 under high threshold", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(dir, "--no-coverage", "--fail-over", "1000");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^CRAP Report$/m);
		assert.match(result.stdout, /risky\s+src\/core\.ts\s+4\s+N\/A\s+N\/A/);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: N/A coverage never breaches the --fail-over gate", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(dir, "--no-coverage");
		assert.equal(result.status, 0, result.stderr);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: --fail-over exits 2 with coverage via --coverage-command", async () => {
	const dir = await createTempProject();
	try {
		// Seed a fake coverage runner that writes coverage-final.json marking
		// risky() partially covered, then gate on a low threshold.
		await writeFile(
			join(dir, "seed-coverage.cjs"),
			'const fs = require("node:fs");\n' +
				'fs.mkdirSync("coverage", { recursive: true });\n' +
				'fs.writeFileSync("coverage/coverage-final.json", JSON.stringify({\n' +
				'  [process.cwd() + "/src/core.ts"]: {\n' +
				"    statementMap: {\n" +
				"      0: { start: { line: 1 }, end: { line: 1 } },\n" +
				"      1: { start: { line: 2 }, end: { line: 2 } },\n" +
				"      2: { start: { line: 3 }, end: { line: 3 } },\n" +
				"      3: { start: { line: 4 }, end: { line: 4 } },\n" +
				"      4: { start: { line: 5 }, end: { line: 5 } },\n" +
				"    },\n" +
				"    s: { 0: 1, 1: 0, 2: 1, 3: 0, 4: 1 },\n" +
				"  },\n" +
				"}));\n",
			"utf8",
		);
		const result = runCli(
			dir,
			"--coverage-command",
			"node seed-coverage.cjs",
			"--fail-over",
			"1",
		);
		assert.equal(result.status, 2, result.stderr);
		assert.match(result.stdout, /risky\s+src\/core\.ts\s+4\s+60\.0%\s+5\.0/);
		assert.match(result.stderr, /exceed CRAP 1/);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: unknown option exits 1", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(dir, "--bogus");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /unknown option/);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: --changed reports only files changed vs origin/main", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-changed-`);
	try {
		const git = (...args: string[]) =>
			execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8" });
		git("-c init.defaultBranch=main init");
		git('config user.email "test@example.com"');
		git('config user.name "Test"');
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "fixture", private: true }),
			"utf8",
		);
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "src"), { recursive: true });
		const body = (name: string) =>
			`export function ${name}(a: number): number {\n  if (a > 1) return 2;\n  return a;\n}\n`;
		await writeFile(
			join(dir, "src", "committed.ts"),
			body("committed"),
			"utf8",
		);
		await writeFile(join(dir, "src", "wip.ts"), body("wip"), "utf8");
		git("add .");
		git("commit -m base");
		// origin/main now points at the base commit via a local "remote" ref
		git("update-ref refs/remotes/origin/main HEAD");
		// change only wip.ts after the base
		await writeFile(join(dir, "src", "wip.ts"), body("wip2"), "utf8");

		const result = runCli(dir, "--changed", "--no-coverage");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /wip2\s+src\/wip\.ts/);
		assert.ok(
			!result.stdout.includes("committed"),
			"unchanged file must not be reported",
		);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: --changed exits 1 without origin/main or origin/master", async () => {
	const dir = await createTempProject();
	try {
		execSync("git -c init.defaultBranch=trunk init", { cwd: dir });
		const result = runCli(dir, "--changed", "--no-coverage");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /origin\/main or origin\/master/);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("matchStatements warns once and returns null on ambiguous suffix", () => {
	const map = parseCoverageData({
		"/a/build/src/core.ts": {
			statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
			s: { 0: 1 },
		},
		"/b/build/src/core.ts": {
			statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
			s: { 0: 1 },
		},
	});
	const stderrWrites: string[] = [];
	const originalWrite = process.stderr.write.bind(process.stderr);
	process.stderr.write = ((chunk: string) => {
		stderrWrites.push(chunk);
		return true;
	}) as typeof process.stderr.write;
	try {
		assert.equal(matchStatements("/proj/src/core.ts", map), null);
		assert.equal(matchStatements("/proj/src/core.ts", map), null);
		const ambiguousWarnings = stderrWrites.filter((w) =>
			w.includes("ambiguous coverage match"),
		);
		// warns exactly once despite two calls (module-level dedupe)
		assert.equal(ambiguousWarnings.length, 1);
	} finally {
		process.stderr.write = originalWrite;
	}
});

test("CLI smoke: --changed includes untracked never-staged files", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-untracked-`);
	try {
		const git = (...args: string[]) =>
			execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8" });
		git("-c init.defaultBranch=main init");
		git('config user.email "test@example.com"');
		git('config user.name "Test"');
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "fixture", private: true }),
			"utf8",
		);
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(dir, "src"), { recursive: true });
		const body = (name: string) =>
			`export function ${name}(a: number): number {\n  if (a > 1) return 2;\n  return a;\n}\n`;
		await writeFile(
			join(dir, "src", "committed.ts"),
			body("committed"),
			"utf8",
		);
		git("add .");
		git("commit -m base");
		git("update-ref refs/remotes/origin/main HEAD");
		// never-staged new file: invisible to git diff, must still be reported
		await writeFile(join(dir, "src", "brand-new.ts"), body("brandNew"), "utf8");

		const result = runCli(dir, "--changed", "--no-coverage");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /brandNew\s+src\/brand-new\.ts/);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("functionCoverage excludes enclosing and nested statements (Codex P1)", () => {
	// Module-level code (line 1) is hit on import; the arrow on lines 2-6 is
	// never called. Old line-overlap logic let the enclosing/wrapper hits
	// contaminate the arrow's coverage.
	const source = [
		'import { x } from "dep"; // enclosing statement, hit on module load',
		"export const risky = (a: number) => {",
		"  if (a > 1) return 2;",
		"  if (a < 0) return 0;",
		"  return a ? 1 : 0;",
		"};",
		"const helper = () => { if (x) return 1; return 0; };",
		"export const w = x + 1;",
	].join("\n");
	const functions = analyzeSource(ts, "risky.ts", source);
	const risky = functions.find((fn) => fn.name === "risky");
	if (!risky) throw new Error("risky not found");

	// Istanbul-style coverage: line 1 and line 8 statements hit (module load),
	// arrow body statements (lines 3-5) never executed.
	const statements = [
		{ startLine: 1, endLine: 1, startColumn: 0, endColumn: 30, hits: 1 },
		{ startLine: 3, endLine: 3, startColumn: 2, endColumn: 18, hits: 0 },
		{ startLine: 4, endLine: 4, startColumn: 2, endColumn: 18, hits: 0 },
		{ startLine: 5, endLine: 5, startColumn: 2, endColumn: 18, hits: 0 },
		{ startLine: 8, endLine: 8, startColumn: 0, endColumn: 22, hits: 1 },
	];
	const fileFunctions = functions.map((fn) => ({
		start: fn.start,
		end: fn.end,
	}));

	// Uncalled arrow must NOT inherit the enclosing statement's hits: all
	// contained statements are unhit -> coverage 0, not 2/5 or 3/5.
	assert.equal(functionCoverage(risky, statements, fileFunctions), 0);

	// helper is also uncalled; its single if-statement is unhit.
	const helper = functions.find((fn) => fn.name === "helper");
	if (!helper) throw new Error("helper not found");
	const helperStatements = [
		{
			startLine: 7,
			endLine: 7,
			startColumn: 17,
			endColumn: 47,
			hits: 0,
		},
	];
	assert.equal(functionCoverage(helper, helperStatements, fileFunctions), 0);
});

test("functionCoverage still credits a fully called sibling function", () => {
	const source = [
		"export function called(a: number) {",
		"  return a ? 1 : 2;",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "called.ts", source);
	const called = functions.find((fn) => fn.name === "called");
	if (!called) throw new Error("called not found");
	const statements = [
		{ startLine: 1, endLine: 3, startColumn: 0, endColumn: 1, hits: 5 },
		{ startLine: 2, endLine: 2, startColumn: 2, endColumn: 18, hits: 5 },
	];
	const fileFunctions = functions.map((fn) => ({
		start: fn.start,
		end: fn.end,
	}));
	// Both statements are contained in the function span and hit.
	assert.equal(functionCoverage(called, statements, fileFunctions), 1);
});

test("functionCoverage excludes nested arrow using real-shaped fnMap loc/decl", () => {
	// Real Istanbul fnMap: decl = header only, loc = full span incl. body.
	// The outer function TS span includes the `export` modifier, so its TS
	// start (col 0) precedes the loc start (col 7), but ends must match.
	const source = [
		"export function outer(a: number) {",
		"  const cb = (b: number) => {",
		"    if (b > 1) return 2;",
		"    return 0;",
		"  };",
		"  return cb(a) + (a ? 1 : 0);",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "outer.ts", source);
	const outer = functions.find((fn) => fn.name === "outer");
	if (!outer) throw new Error("outer not found");

	const fileFunctions = [
		// outer: loc spans `function outer...` through final `}` (end matches
		// TS span end; start on same line, after `export `).
		{
			start: { line: 1, column: 7 },
			end: { line: 7, column: 1 },
		},
		// nested cb arrow: loc spans the full arrow incl. body.
		{
			start: { line: 2, column: 13 },
			end: { line: 5, column: 4 },
		},
	];
	// cb's body statement is unhit (arrow never called); outer's own
	// statements are hit.
	const statements = [
		{ startLine: 2, endLine: 5, startColumn: 13, endColumn: 4, hits: 1 },
		{ startLine: 3, endLine: 3, startColumn: 4, endColumn: 22, hits: 0 },
		{ startLine: 4, endLine: 4, startColumn: 4, endColumn: 14, hits: 0 },
		{ startLine: 6, endLine: 6, startColumn: 2, endColumn: 28, hits: 3 },
	];
	// Statement on lines 2-5 is the enclosing const wrapping cb: it overlaps
	// outer but belongs to cb's declaration, hit by outer's execution.
	const cov = functionCoverage(outer, statements, fileFunctions);
	// outer's own applicable statements: the wrapping const (hit) and line 6
	// (hit); cb's body statements (lines 3-4) are excluded as nested.
	assert.equal(cov, 1);

	const cb = functions.find((fn) => fn.name === "cb");
	if (!cb) throw new Error("cb not found");
	// cb's coverage: only its body statements count (lines 3-4, unhit); the
	// enclosing const statement (hit) is NOT contained in cb's span start.
	const cbStatements = [
		{ startLine: 2, endLine: 5, startColumn: 13, endColumn: 4, hits: 1 },
		{ startLine: 3, endLine: 3, startColumn: 4, endColumn: 22, hits: 0 },
		{ startLine: 4, endLine: 4, startColumn: 4, endColumn: 14, hits: 0 },
	];
	assert.equal(functionCoverage(cb, cbStatements, fileFunctions), 0);
});

test("own-span detection tolerates cross-line modifier offsets", () => {
	// `export` on its own line: TS span starts at line 1 col 0, the Istanbul
	// loc starts at line 2. Same-line conjunct would misclassify own -> nested.
	const source = [
		"export",
		"function split(a: number) {",
		"  if (a > 1) return 2;",
		"  return a;",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "split.ts", source);
	const split = functions.find((fn) => fn.name === "split");
	if (!split) throw new Error("split not found");

	const fileFunctions = [
		{ start: { line: 2, column: 0 }, end: { line: 5, column: 1 } },
	];
	const statements = [
		{ startLine: 3, endLine: 3, startColumn: 2, endColumn: 19, hits: 1 },
		{ startLine: 4, endLine: 4, startColumn: 2, endColumn: 11, hits: 1 },
	];
	// Not N/A despite the two-line offset between TS start and loc start.
	assert.equal(functionCoverage(split, statements, fileFunctions), 1);
});

test("own-span detection handles decorated methods", () => {
	const source = [
		"class Service {",
		"  @logged",
		"  run(a: number) {",
		"    return a ? 1 : 0;",
		"  }",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "service.ts", source);
	const run = functions.find((fn) => fn.name === "Service.run");
	if (!run) throw new Error("Service.run not found");

	// Decorator pushes the method's loc start beyond the TS span start
	// (TS includes the decorator), end positions still match.
	const fileFunctions = [
		{ start: { line: 3, column: 2 }, end: { line: 5, column: 3 } },
	];
	const statements = [
		{ startLine: 4, endLine: 4, startColumn: 4, endColumn: 20, hits: 2 },
	];
	assert.equal(functionCoverage(run, statements, fileFunctions), 1);
});

test("parseCoverageData skips fnMap entries lacking loc and decl", () => {
	const map = parseCoverageData({
		"/proj/src/core.ts": {
			statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
			s: { 0: 1 },
			fnMap: {
				0: { name: "ok", decl: { start: { line: 1 }, end: { line: 1 } } },
				1: { name: "broken" },
				2: null,
			},
		},
	});
	const entry = map.get("/proj/src/core.ts");
	assert.equal(entry?.functions.length, 1);
	assert.equal(entry?.statements.length, 1);
});

test("ownFunctionSpans picks the innermost same-end loc for curried arrows", () => {
	const source = [
		"export const curried = (a: number) => (b: number) => {",
		"  return a > b ? a : b;",
		"};",
	].join("\n");
	const functions = analyzeSource(ts, "curried.ts", source);
	// The inner arrow is <anonymous> (its parent is a return expression),
	// so find it as the later-start function.
	const inner = functions
		.filter((fn) => fn.start.line === 1)
		.reduce((a, b) => (a.start.column >= b.start.column ? a : b));
	if (!inner) throw new Error("inner arrow not found");
	const outer = functions.find((fn) => fn.name === "curried");
	if (!outer) throw new Error("outer arrow not found");

	// Real Istanbul fnMap for this source (verified against vitest+coverage-v8):
	//   (anonymous_0) loc: start {1,24} end {3,null}   <- outer arrow's own
	//   (anonymous_1) loc: start {1,53} end {3,null}   <- inner arrow's own
	// TS spans: outer {1,23}-{3,1}, inner {1,38}-{3,1} (exclusive ends).
	const fileFunctions = [
		{ start: { line: 1, column: 24 }, end: { line: 3, column: null } },
		{ start: { line: 1, column: 53 }, end: { line: 3, column: null } },
	];
	const innerOwn = ownFunctionSpans(inner, fileFunctions);
	assert.equal(innerOwn.length, 1);
	assert.equal(innerOwn[0]?.start.column, 53);

	// The outer arrow's own loc is the earliest-start qualifier (24); the
	// later-start loc belongs to the nested inner arrow.
	const outerOwn = ownFunctionSpans(outer, fileFunctions);
	assert.equal(outerOwn.length, 1);
	assert.equal(outerOwn[0]?.start.column, 24);
});

test("uncalled named function declaration reports coverage 0", () => {
	// Under Istanbul, a never-called function's DECLARATION statement is
	// marked hit merely by loading the module. The declaration statement
	// wraps the whole function (same end, earlier start) and must not count.
	const source = [
		"export function neverCalled(a: number) {",
		"  if (a > 1) return 2;",
		"  return a;",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "never.ts", source);
	const fn = functions.find((f) => f.name === "neverCalled");
	if (!fn) throw new Error("neverCalled not found");

	// Real-shaped Istanbul: statement 0 = the whole declaration (hit on
	// module load); statement 1 = the if (never executed).
	const statements = [
		{
			startLine: 1,
			endLine: 4,
			startColumn: 0,
			endColumn: 1,
			hits: 1,
		},
		{ startLine: 2, endLine: 2, startColumn: 2, endColumn: 19, hits: 0 },
	];
	const fileFunctions = [
		{ start: { line: 1, column: 0 }, end: { line: 4, column: 1 } },
	];
	assert.equal(functionCoverage(fn, statements, fileFunctions), 0);
});

test("called named function keeps its coverage credit", () => {
	const source = [
		"export function called(a: number) {",
		"  return a > 1 ? 2 : a;",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "called2.ts", source);
	const fn = functions.find((f) => f.name === "called");
	if (!fn) throw new Error("called not found");
	const statements = [
		{
			startLine: 1,
			endLine: 3,
			startColumn: 0,
			endColumn: 1,
			hits: 7,
		},
		{ startLine: 2, endLine: 2, startColumn: 2, endColumn: 21, hits: 7 },
	];
	const fileFunctions = [
		{ start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
	];
	assert.equal(functionCoverage(fn, statements, fileFunctions), 1);
});

test("parseCoverageData preserves null fnMap columns (own-span matching)", () => {
	// Real Istanbul fnMap data: null end column = "to end of line". A
	// coerced 0 would defeat the line-only sentinel in
	// stmtEndsWithinTolerance and break own-span matching for functions
	// ending away from column 0 (Codex P1 round 2).
	const data = {
		"/abs/fn.ts": {
			statementMap: {
				"0": { start: { line: 1, column: 0 }, end: { line: 3, column: null } },
				"1": { start: { line: 2, column: 1 }, end: { line: 2, column: null } },
			},
			s: { "0": 1, "1": 0 },
			fnMap: {
				"0": {
					name: "unusedFn",
					decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 30 } },
					loc: {
						start: { line: 1, column: 0 },
						end: { line: 3, column: null },
					},
					// no cov.f entry -> hits null
				},
			},
		},
	};
	const map = parseCoverageData(data);
	const fn = map.get("/abs/fn.ts");
	if (!fn) throw new Error("fn entry missing");
	const span = fn.functions[0];
	if (span.end.column !== null) {
		throw new Error(`expected null preserved, got ${span.end.column}`);
	}
	// Statement 0 (declaration wrapper, hit via module load) is excluded;
	// statement 1 (uncalled body statement) counts -> coverage 0.
	const functions = analyzeSource(
		ts,
		"fn.ts",
		"export function unusedFn(a: number) {\n\tif (a) return 1;\n\treturn 0;\n}",
	);
	const target = functions.find((f) => f.name === "unusedFn");
	if (!target) throw new Error("unusedFn not found");
	assert.equal(functionCoverage(target, fn.statements, fn.functions), 0);
});

test("changed mode applies directory exclusions", async () => {
	// Tracked files under excluded dirs (dist/) must not be admitted by the
	// changed-file filter, matching collectSourceFiles behavior (Codex P2).
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-changed-excl-`);
	try {
		const git = (...args: string[]) =>
			execSync(`git ${args.join(" ")}`, { cwd: dir, encoding: "utf8" });
		git("-c init.defaultBranch=main init");
		git('config user.email "test@example.com"');
		git('config user.name "Test"');
		const { mkdir, writeFile } = await import("node:fs/promises");
		await mkdir(join(dir, "dist"));
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({ name: "f", private: true }),
		);
		await writeFile(
			join(dir, "src.ts"),
			"export function ok(a: number) {\n  return a > 1 ? 2 : a;\n}\n",
		);
		await writeFile(
			join(dir, "dist", "gen.ts"),
			"export function bad(x: number) {\n  return x;\n}\n",
		);
		git("add .");
		git("commit -m base");
		git("update-ref refs/remotes/origin/main HEAD");
		// Change both src.ts (should be reported) and the tracked dist/gen.ts
		// (must stay excluded).
		await writeFile(
			join(dir, "src.ts"),
			"export function ok2(a: number) {\n  return a;\n}\n",
		);
		await writeFile(
			join(dir, "dist", "gen.ts"),
			"export function bad2(x: number) {\n  return x;\n}\n",
		);
		git("add .");
		git("commit -m wip");
		const result = runCli(dir, "--changed", "--no-coverage");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /ok2\s+src\.ts/);
		assert.ok(
			!result.stdout.includes("bad2"),
			"excluded dist/ file leaked into changed report",
		);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("null end column has end-of-line semantics in containment", () => {
	// Codex P1 round 3: a nested fnMap span ending in column:null must
	// still contain its same-line statements (end-of-line, not column 0),
	// so nested callback statements cannot leak into the parent.
	const source = [
		"export function parent(items: number[]) {",
		"  return items.map((x) => {",
		"    if (x > 1) return 2;",
		"    return x;",
		"  });",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "parent.ts", source);
	const parent = functions.find((f) => f.name === "parent");
	if (!parent) throw new Error("parent not found");
	// Real Istanbul shape: callback loc ends { line: 5, column: null } (the
	// "});" line) while its body statements sit on lines 3-4 and the arrow
	// expression statement on line 2 ends at a positive column.
	const fileFunctions = [
		{
			// parent span
			start: { line: 1, column: 0 },
			end: { line: 6, column: 1 },
		},
		{
			// nested callback span, null end column
			start: { line: 2, column: 26 },
			end: { line: 5, column: null },
		},
	];
	const statements = [
		// parent declaration wrapper (module-load hit) — excluded as wrapper
		{ startLine: 1, endLine: 6, startColumn: 0, endColumn: 1, hits: 1 },
		// callback-owned body statement (inside (2,26)-(5,null)); its null
		// end must behave as end-of-line so this stays contained in the
		// callback span and does NOT count for parent (would otherwise make
		// an uncalled parent appear covered).
		{
			startLine: 3,
			endLine: 3,
			startColumn: 4,
			endColumn: 20,
			hits: 1,
		},
		// parent return statement wrapper — same span as the map call; the
		// declaration-wrapper rule excludes the whole-function one only.
	];
	// The callback-owned statement must stay attributed to the nested
	// span; the parent has no other own statements -> null (N/A).
	const cov = functionCoverage(parent, statements, fileFunctions);
	if (cov !== null) {
		throw new Error(`expected null (no own statements), got ${cov}`);
	}
});

test("bodyless declarations are skipped", () => {
	// Overload signatures and declare functions share function syntax kinds
	// but have no executable body; they must not become phantom N/A rows
	// (Codex P2).
	const source = [
		"export declare function overload(x: number): string;",
		"export function overload(x: string): string;",
		"export function overload(x: number | string): string {",
		"  return String(x);",
		"}",
	].join("\n");
	const functions = analyzeSource(ts, "overloads.ts", source);
	const rows = functions.filter((f) => f.name === "overload");
	assert.equal(rows.length, 1, JSON.stringify(rows.map((f) => f.startLine)));
	assert.equal(rows[0].startLine, 3);
});

test("concise arrow uses fnMap hits when no attributable statements", () => {
	// Codex P2: expression-bodied arrows' only statement is the excluded
	// enclosing declaration, so execution data lives in cov.f. Called arrow
	// -> 1, uncalled -> 0, absent hits -> null.
	const source = [
		"const choose = (x: boolean) => (x ? 1 : 2);",
		"const dead = (x: boolean) => (x ? 3 : 4);",
		"const fresh = (x: boolean) => (x ? 5 : 6);",
	].join("\n");
	const functions = analyzeSource(ts, "arrows.ts", source);
	const choose = functions.find((f) => f.name === "choose");
	const dead = functions.find((f) => f.name === "dead");
	const fresh = functions.find((f) => f.name === "fresh");
	if (!choose || !dead || !fresh) throw new Error("arrows not found");
	const fileFunctions = [
		{
			start: { line: 1, column: 16 },
			end: { line: 1, column: null },
			hits: 5,
		},
		{
			start: { line: 2, column: 13 },
			end: { line: 2, column: null },
			hits: 0,
		},
		// fresh has no cov.f entry (parseCoverageData sets hits: null)
		{
			start: { line: 3, column: 13 },
			end: { line: 3, column: null },
			hits: null,
		},
	];
	const statements = [
		{ startLine: 1, endLine: 1, startColumn: 0, endColumn: 37, hits: 5 },
		{ startLine: 2, endLine: 2, startColumn: 0, endColumn: 37, hits: 0 },
		{ startLine: 3, endLine: 3, startColumn: 0, endColumn: 37, hits: 0 },
	];
	assert.equal(functionCoverage(choose, statements, fileFunctions), 1);
	assert.equal(functionCoverage(dead, statements, fileFunctions), 0);
	assert.equal(functionCoverage(fresh, statements, fileFunctions), null);
});

test("parseCoverageData joins fnMap spans with cov.f hit counts", () => {
	// Direct parse-side assertion for the cov.f -> hits join (pr_review NIT):
	// present ids carry counts; absent ids -> null.
	const data = {
		"/abs/join.ts": {
			statementMap: {
				"0": { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
			},
			s: { "0": 3 },
			fnMap: {
				"0": {
					name: "calledFn",
					loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } },
				},
				"1": {
					name: "silentFn",
					loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 20 } },
				},
			},
			f: { "0": 4 }, // no entry for id 1
		},
	};
	const map = parseCoverageData(data);
	const entry = map.get("/abs/join.ts");
	if (!entry) throw new Error("join entry missing");
	assert.equal(entry.functions[0].hits, 4);
	assert.equal(entry.functions[1].hits, null);
});

test("empty statementMap still uses fnMap hits fallback", () => {
	// Codex P2: a file with fnMap/f but EMPTY statementMap (e.g. only empty
	// functions) must not early-return N/A; cov.f is definitive.
	const source = [
		"export function noop() {}",
		"export function deadNoop() {}",
	].join("\n");
	const functions = analyzeSource(ts, "noop.ts", source);
	const noop = functions.find((f) => f.name === "noop");
	const dead = functions.find((f) => f.name === "deadNoop");
	if (!noop || !dead) throw new Error("noops not found");
	const fileFunctions = [
		// Istanbul locs start at the function keyword (col 7) and end at the
		// closing brace inclusive; TS ends are exclusive one past it.
		{
			start: { line: 1, column: 7 },
			end: { line: 1, column: 24 },
			hits: 9,
		},
		{
			start: { line: 2, column: 7 },
			end: { line: 2, column: 28 },
			hits: 0,
		},
	];
	assert.equal(functionCoverage(noop, [], fileFunctions), 1);
	assert.equal(functionCoverage(dead, [], fileFunctions), 0);
	assert.equal(functionCoverage(noop, null, fileFunctions), null);
});
