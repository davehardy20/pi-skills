import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { test } from "vitest";
import {
	analyzeSource,
	buildRows,
	computeCrap,
	detectCoverageCommand,
	detectPackageManager,
	EXCLUDED_DIRS,
	evaluateThreshold,
	formatDependencyPreflight,
	formatReport,
	functionCoverage,
	inspectDependencyPreflight,
	main,
	matchStatements,
	ownFunctionSpans,
	parseCliArgs,
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
	// Stryker instrumentation intentionally inflates this source-level metric.
	if (process.env.STRYKER_MUTATOR_WORKER !== undefined) return;
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

test("dependency preflight reports missing coverage and mutation modules", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		await mkdir(join(dir, "node_modules", "vitest"), { recursive: true });
		await mkdir(join(dir, "node_modules", "typescript"), {
			recursive: true,
		});
		await write(join(dir, "node_modules", "vitest", "package.json"), "{}\n");
		await write(
			join(dir, "node_modules", "typescript", "package.json"),
			"{}\n",
		);
		const pkg = {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: { typescript: "^5", vitest: "^4" },
		};
		const preflight = inspectDependencyPreflight(dir, pkg);
		assert.deepEqual(preflight.packageManager.problems, []);
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/core",
			"stryker config",
			"@stryker-mutator/vitest-runner",
		]);
		const report = formatDependencyPreflight(preflight);
		for (const missing of [
			"@vitest/coverage-v8: missing",
			"@vitest/coverage-istanbul: missing",
			"@stryker-mutator/core: missing",
			"@stryker-mutator/vitest-runner: missing",
			"@stryker-mutator/jest-runner: missing",
		]) {
			assert.ok(report.includes(missing), `missing preflight row: ${missing}`);
		}
		assert.ok(
			report.includes(
				"mutation gate: missing @stryker-mutator/core, stryker config, @stryker-mutator/vitest-runner",
			),
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight requires the Stryker runner matching coverage", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-runner-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const name of [
			"typescript",
			"vitest",
			"@vitest/coverage-v8",
			"@stryker-mutator/core",
			"@stryker-mutator/jest-runner",
		]) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				"{}\n",
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/jest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/vitest-runner",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight follows delegated coverage scripts", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-delegated-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: {
				test: "vitest run",
				"test:coverage": "npm test -- --coverage",
			},
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.equal(preflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight follows workspace delegated coverage scripts", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-workspace-delegated-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await mkdir(join(dir, "packages", "a"), { recursive: true });
		await write(
			join(dir, "package.json"),
			JSON.stringify({ workspaces: ["packages/*"] }),
		);
		await write(
			join(dir, "packages", "a", "package.json"),
			JSON.stringify({
				name: "@scope/a",
				scripts: {
					coverage: "vitest run --coverage",
					test: "vitest run --coverage",
				},
			}),
		);

		for (const command of [
			"npm --workspace packages/a run coverage",
			"npm --workspace @scope/a run coverage",
			"npm run coverage --workspace packages/a",
			"npm run coverage --workspace=@scope/a",
			"npm test --workspace=@scope/a",
			"pnpm --filter @scope/a run coverage",
			"pnpm -F @scope/a run coverage",
			"yarn workspace @scope/a run coverage",
		]) {
			const preflight = inspectDependencyPreflight(dir, {
				packageManager: "npm@10.0.0",
				scripts: { "test:coverage": command },
				devDependencies: { typescript: "^5", vitest: "^4" },
			});

			assert.equal(preflight.coverage.plan?.runner, "vitest", command);
			assert.deepEqual(
				preflight.coverage.missing,
				["@vitest/coverage-v8"],
				command,
			);
		}

		await write(join(dir, "package.json"), "{}\n");
		await write(
			join(dir, "pnpm-workspace.yaml"),
			"packages:\n  - packages/*\n",
		);
		const pnpmPreflight = inspectDependencyPreflight(dir, {
			packageManager: "pnpm@10.0.0",
			scripts: { "test:coverage": "pnpm --filter @scope/a run coverage" },
			devDependencies: { typescript: "^5", vitest: "^4" },
		});

		assert.equal(pnpmPreflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(pnpmPreflight.coverage.missing, ["@vitest/coverage-v8"]);

		await write(join(dir, "pnpm-workspace.yaml"), 'packages: ["packages/*"]\n');
		const flowPnpmPreflight = inspectDependencyPreflight(dir, {
			packageManager: "pnpm@10.0.0",
			scripts: { "test:coverage": "pnpm --filter @scope/a run coverage" },
			devDependencies: { typescript: "^5", vitest: "^4" },
		});

		assert.equal(flowPnpmPreflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(flowPnpmPreflight.coverage.missing, [
			"@vitest/coverage-v8",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight follows nested workspace glob packages", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-nested-workspace-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		await mkdir(join(dir, "node_modules", "vitest"), { recursive: true });
		await write(
			join(dir, "node_modules", "vitest", "package.json"),
			JSON.stringify({ version: "4.0.0" }),
		);
		await mkdir(join(dir, "packages", "team", "a"), { recursive: true });
		await write(
			join(dir, "package.json"),
			JSON.stringify({ workspaces: ["packages\\*\\*"] }),
		);
		await write(
			join(dir, "packages", "team", "a", "package.json"),
			JSON.stringify({
				name: "@scope/a",
				scripts: { coverage: "vitest run --coverage" },
			}),
		);

		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "pnpm@10.0.0",
			scripts: { "test:coverage": "pnpm --filter @scope/a run coverage" },
			devDependencies: { vitest: "^4" },
		});

		assert.equal(preflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight validates delegated workspace dependencies locally", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-workspace-local-deps-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		await mkdir(join(dir, "packages", "a"), { recursive: true });
		await write(
			join(dir, "package.json"),
			JSON.stringify({ workspaces: ["packages/*"] }),
		);
		await write(
			join(dir, "packages", "a", "package.json"),
			JSON.stringify({
				name: "@scope/a",
				scripts: { coverage: "vitest run --coverage" },
				devDependencies: {
					typescript: "^5",
					vitest: "^4",
					"@vitest/coverage-v8": "^4",
				},
			}),
		);
		for (const [name, pkg] of [
			["typescript", { version: "5.0.0" }],
			["vitest", { version: "4.0.0" }],
			[
				"@vitest/coverage-v8",
				{ version: "4.0.0", peerDependencies: { vitest: "^4" } },
			],
		] as const) {
			await mkdir(
				join(dir, "packages", "a", "node_modules", ...name.split("/")),
				{
					recursive: true,
				},
			);
			await write(
				join(
					dir,
					"packages",
					"a",
					"node_modules",
					...name.split("/"),
					"package.json",
				),
				JSON.stringify(pkg),
			);
		}

		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "npm --workspace @scope/a run coverage" },
		});

		assert.equal(preflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(preflight.coverage.missing, []);
		assert.equal(preflight.dependencies.get("vitest")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"ok",
		);
		const directPreflight = inspectDependencyPreflight(
			dir,
			{ packageManager: "npm@10.0.0" },
			{
				coverageCommand: "npm --workspace @scope/a exec vitest -- --coverage",
			},
		);
		assert.equal(directPreflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(directPreflight.coverage.missing, []);
		const yarnWorkspacePreflight = inspectDependencyPreflight(
			dir,
			{ packageManager: "yarn@4.0.0" },
			{
				coverageCommand: "yarn workspace @scope/a exec vitest --coverage",
			},
		);
		assert.equal(yarnWorkspacePreflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(yarnWorkspacePreflight.coverage.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight validates every delegated workspace context", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-multi-workspace-deps-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	const writePackage = async (
		packageDir: string,
		name: string,
		pkg: object,
	) => {
		const dependencyDir = join(packageDir, "node_modules", ...name.split("/"));
		await mkdir(dependencyDir, { recursive: true });
		await write(join(dependencyDir, "package.json"), JSON.stringify(pkg));
	};
	try {
		await mkdir(join(dir, "packages", "a"), { recursive: true });
		await mkdir(join(dir, "packages", "b"), { recursive: true });
		await write(
			join(dir, "package.json"),
			JSON.stringify({
				workspaces: ["packages/*"],
				scripts: {
					"test:coverage":
						"npm --workspace @scope/a run coverage && npm --workspace @scope/b run coverage",
				},
			}),
		);
		await write(
			join(dir, "packages", "a", "package.json"),
			JSON.stringify({
				name: "@scope/a",
				scripts: { coverage: "vitest run --coverage" },
				devDependencies: { vitest: "^4", "@vitest/coverage-v8": "^4" },
			}),
		);
		await write(
			join(dir, "packages", "b", "package.json"),
			JSON.stringify({
				name: "@scope/b",
				scripts: { coverage: "vitest run --coverage" },
				devDependencies: { vitest: "^4" },
			}),
		);
		await writePackage(join(dir, "packages", "a"), "vitest", {
			version: "4.0.0",
		});
		await writePackage(join(dir, "packages", "a"), "@vitest/coverage-v8", {
			version: "4.0.0",
			peerDependencies: { vitest: "^4" },
		});
		await writePackage(join(dir, "packages", "b"), "vitest", {
			version: "4.0.0",
		});

		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: {
				"test:coverage":
					"npm --workspace @scope/a run coverage && npm --workspace @scope/b run coverage",
			},
		});

		assert.equal(preflight.coverage.plan?.runner, "vitest");
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
		const report = formatDependencyPreflight(preflight);
		assert.ok(report.includes("  - @vitest/coverage-v8: missing"));

		await write(
			join(dir, "packages", "b", "package.json"),
			JSON.stringify({
				name: "@scope/b",
				scripts: { coverage: "vitest run --coverage.provider=istanbul" },
				devDependencies: {
					vitest: "^4",
					"@vitest/coverage-istanbul": "^4",
				},
			}),
		);
		await writePackage(
			join(dir, "packages", "b"),
			"@vitest/coverage-istanbul",
			{
				version: "4.0.0",
				peerDependencies: { vitest: "^4" },
			},
		);
		const mixedProviderPreflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: {
				"test:coverage":
					"npm --workspace @scope/a run coverage && npm --workspace @scope/b run coverage",
			},
		});
		assert.deepEqual(mixedProviderPreflight.coverage.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight validates mutation dependencies from root", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-root-mutation-deps-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	const writePackage = async (
		packageDir: string,
		name: string,
		pkg: object,
	) => {
		const dependencyDir = join(packageDir, "node_modules", ...name.split("/"));
		await mkdir(dependencyDir, { recursive: true });
		await write(join(dependencyDir, "package.json"), JSON.stringify(pkg));
	};
	try {
		await mkdir(join(dir, "packages", "a"), { recursive: true });
		await write(
			join(dir, "package.json"),
			JSON.stringify({
				workspaces: ["packages/*"],
				scripts: { "test:coverage": "npm --workspace @scope/a run coverage" },
			}),
		);
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		await write(
			join(dir, "packages", "a", "package.json"),
			JSON.stringify({
				name: "@scope/a",
				scripts: { coverage: "vitest run --coverage" },
				devDependencies: {
					vitest: "^4",
					"@vitest/coverage-v8": "^4",
					"@stryker-mutator/core": "^10",
					"@stryker-mutator/vitest-runner": "^10",
				},
			}),
		);
		for (const [name, pkg] of [
			["vitest", { version: "4.0.0" }],
			[
				"@vitest/coverage-v8",
				{ version: "4.0.0", peerDependencies: { vitest: "^4" } },
			],
			["@stryker-mutator/core", { version: "10.0.0" }],
			["@stryker-mutator/vitest-runner", { version: "10.0.0" }],
		] as const) {
			await writePackage(join(dir, "packages", "a"), name, pkg);
		}

		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
		});

		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/core",
			"@stryker-mutator/vitest-runner",
		]);
		const report = formatDependencyPreflight(preflight);
		assert.ok(report.includes("  - @stryker-mutator/core: missing"));
		assert.ok(report.includes("  - @stryker-mutator/vitest-runner: missing"));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight expands delegated override coverage commands", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-override-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		for (const coverageCommand of [
			"npm test -- --coverage",
			"npm run-script cov -- --coverage",
			"npm rum cov -- --coverage",
			"npm urn cov -- --coverage",
		]) {
			const preflight = inspectDependencyPreflight(
				dir,
				{
					packageManager: "npm@10.0.0",
					scripts: { cov: "vitest run", test: "vitest run" },
					devDependencies: { typescript: "^5", vitest: "^4" },
				},
				{ coverageCommand },
			);
			assert.equal(preflight.coverage.plan?.runner, "vitest", coverageCommand);
			assert.deepEqual(
				preflight.coverage.missing,
				["@vitest/coverage-v8"],
				coverageCommand,
			);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight detects package-manager direct vitest commands", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-direct-pm-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}

		for (const coverageCommand of [
			"pnpm vitest run --coverage",
			"bun vitest --coverage",
			"npm exec vitest -- --coverage",
			"npx vitest run --coverage",
			"npm --workspace packages/a exec vitest -- --coverage",
			"npm exec --workspace packages/a vitest -- --coverage",
			"pnpm --filter packages/a exec vitest run --coverage",
			"pnpm exec --filter packages/a vitest run --coverage",
			"yarn exec vitest run --coverage",
			"yarn dlx vitest run --coverage",
		]) {
			const preflight = inspectDependencyPreflight(
				dir,
				{
					packageManager: "pnpm@9.0.0",
					devDependencies: { typescript: "^5", vitest: "^4" },
				},
				{ coverageCommand },
			);
			assert.equal(preflight.coverage.plan?.runner, "vitest", coverageCommand);
			assert.deepEqual(
				preflight.coverage.missing,
				["@vitest/coverage-v8"],
				coverageCommand,
			);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight does not execute Yarn Plug'n'Play loader code", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-pnp-preflight-`);
	const { rm, writeFile: write } = await import("node:fs/promises");
	try {
		await write(
			join(dir, ".pnp.cjs"),
			`const fs = require("node:fs");
			fs.writeFileSync("pnp-sentinel.txt", "executed");
			module.exports = {
			  resolveToUnqualified(request) {
			    return request;
			  },
			};
			`,
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "yarn@4.0.0",
			scripts: { "test:coverage": "yarn vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.equal(preflight.packageManager.manager, "yarn");
		assert.equal(
			preflight.dependencies.get("vitest")?.status,
			"declared-not-installed",
		);
		let sentinelExists = true;
		try {
			await access(join(dir, "pnp-sentinel.txt"));
		} catch {
			sentinelExists = false;
		}
		assert.equal(sentinelExists, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight flags version-mismatched companions", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-version-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "3.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "9.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^3",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^9",
			},
		});
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"version-mismatch",
		);
		assert.equal(
			preflight.dependencies.get("@stryker-mutator/vitest-runner")?.status,
			"version-mismatch",
		);
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/vitest-runner",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight accepts installed versions satisfying declared ranges", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-semver-preflight-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.9.0"],
			["vitest", "4.1.9"],
			["@vitest/coverage-v8", "4.1.9"],
			["@stryker-mutator/core", "10.2.0"],
			["@stryker-mutator/vitest-runner", "10.2.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5",
				vitest: "4",
				"@vitest/coverage-v8": "4",
				"@stryker-mutator/core": ">=10 <11",
				"@stryker-mutator/vitest-runner": ">=10 <11",
			},
		});
		assert.equal(preflight.dependencies.get("typescript")?.status, "ok");
		assert.equal(preflight.dependencies.get("vitest")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"ok",
		);
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight applies npm bounds to partial comparators", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-partial-comparator-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "4.9.9"],
			["vitest", "4.1.0"],
			["jest", "4.1.9"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		const preflight = inspectDependencyPreflight(
			dir,
			{
				packageManager: "npm@10.0.0",
				devDependencies: {
					typescript: "<=4",
					vitest: ">4",
					jest: "<=4.1",
				},
			},
			{ noCoverage: true },
		);
		assert.equal(preflight.dependencies.get("typescript")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("vitest")?.status,
			"version-mismatch",
		);
		assert.equal(preflight.dependencies.get("jest")?.status, "ok");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight handles npm caret and tilde boundaries", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-semver-boundaries-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "1.9.9"],
			["vitest", "0.2.5"],
			["@vitest/coverage-v8", "0.2.5"],
			["@stryker-mutator/core", "0.0.3"],
			["@stryker-mutator/vitest-runner", "0.0.3"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "~1",
				vitest: "^0.2.3",
				"@vitest/coverage-v8": "^0.2.3",
				"@stryker-mutator/core": "^0.0.3",
				"@stryker-mutator/vitest-runner": "^0.0.3",
			},
		});
		assert.equal(preflight.dependencies.get("typescript")?.status, "ok");
		assert.equal(preflight.dependencies.get("vitest")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("@stryker-mutator/core")?.status,
			"ok",
		);
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight handles hyphenated semver ranges", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-hyphen-ranges-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.9.0"],
			["vitest", "4.1.0"],
			["@vitest/coverage-v8", "4.1.0"],
			["@stryker-mutator/core", "10.2.0"],
			["@stryker-mutator/vitest-runner", "10.2.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify(
					name === "@vitest/coverage-v8"
						? { version, peerDependencies: { vitest: "4.0.0 - 4.2.0" } }
						: { version },
				),
			);
		}
		await write(
			join(dir, "stryker.conf.json"),
			JSON.stringify({ testRunner: "vitest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5.0.0 - 5.9.9",
				vitest: "4.0.0 - 4.2.0",
				"@vitest/coverage-v8": "4.0.0 - 4.2.0",
				"@stryker-mutator/core": "10.0.0 - 10.9.9",
				"@stryker-mutator/vitest-runner": "10.0.0 - 10.9.9",
			},
		});
		assert.equal(preflight.dependencies.get("vitest")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"ok",
		);
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight validates Vitest coverage provider peer range", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-peer-range-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, pkg] of [
			["typescript", { version: "5.9.0" }],
			["vitest", { version: "4.1.9" }],
			[
				"@vitest/coverage-v8",
				{ version: "4.0.0", peerDependencies: { vitest: "4.0.0" } },
			],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify(pkg),
			);
		}
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5",
				vitest: ">=4 <5",
				"@vitest/coverage-v8": ">=4 <5",
			},
		});
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"version-mismatch",
		);
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight requires selected Vitest coverage provider", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-selected-provider-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.9.0"],
			["vitest", "4.1.9"],
			["@vitest/coverage-v8", "4.1.9"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: {
				"test:coverage": "vitest run --coverage --coverage.provider=istanbul",
			},
			devDependencies: {
				typescript: "5",
				vitest: ">=4 <5",
				"@vitest/coverage-v8": ">=4 <5",
			},
		});
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-istanbul"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight requires Vitest default v8 coverage provider", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-default-provider-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.9.0"],
			["vitest", "4.1.9"],
			["@vitest/coverage-istanbul", "4.1.9"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5",
				vitest: ">=4 <5",
				"@vitest/coverage-istanbul": ">=4 <5",
			},
		});
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight validates wildcard ranges", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-wildcard-range-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, pkg] of [
			["typescript", { version: "5.9.0" }],
			["vitest", { version: "5.0.0" }],
			[
				"@vitest/coverage-v8",
				{ version: "4.1.0", peerDependencies: { vitest: "4.x" } },
			],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify(pkg),
			);
		}
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5.x",
				vitest: "5.x",
				"@vitest/coverage-v8": "4.x",
			},
		});
		assert.equal(preflight.dependencies.get("vitest")?.status, "ok");
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"version-mismatch",
		);
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight fails closed on unsupported semver comparators", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-unsupported-semver-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, pkg] of [
			["typescript", { version: "5.9.0" }],
			["vitest", { version: "5.0.0" }],
			[
				"@vitest/coverage-v8",
				{ version: "4.1.0", peerDependencies: { vitest: ">=4.0.0 <5.0.0-0" } },
			],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify(pkg),
			);
		}
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "5",
				vitest: "5",
				"@vitest/coverage-v8": "^4",
			},
		});
		assert.equal(
			preflight.dependencies.get("@vitest/coverage-v8")?.status,
			"version-mismatch",
		);
		assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight follows command wrappers when inferring runner", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-wrapper-runner-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		for (const coverageCommand of [
			"cross-env NODE_ENV=test vitest run --coverage",
			"dotenv -e .env -- vitest run --coverage",
			"env -u CI vitest run --coverage",
			"cross-env NODE_ENV=test dotenv -e .env -- vitest run --coverage",
		]) {
			const preflight = inspectDependencyPreflight(dir, {
				packageManager: "npm@10.0.0",
				scripts: { "test:coverage": coverageCommand },
				devDependencies: { typescript: "^5", vitest: "^4" },
			});
			assert.equal(preflight.coverage.plan?.runner, "vitest");
			assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight expands package-manager run commands with options", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-run-options-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		for (const coverageCommand of [
			"yarn run --inspect cov",
			"yarn --cwd packages/app run cov",
			"yarn workspace packages/app run cov",
			"npm --workspace packages/app run cov",
			"npm run --workspace packages/app cov",
			"npm -w packages/app run cov",
			"pnpm --dir packages/app run cov",
			"pnpm run --filter packages/app cov",
		]) {
			const preflight = inspectDependencyPreflight(
				dir,
				{
					packageManager: "npm@10.0.0",
					scripts: { cov: "vitest run --coverage" },
					devDependencies: { typescript: "^5", vitest: "^4" },
				},
				{ coverageCommand },
			);
			assert.equal(preflight.coverage.plan?.runner, "vitest");
			assert.deepEqual(preflight.coverage.missing, ["@vitest/coverage-v8"]);
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight reads Stryker config runner", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-config-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, ".stryker.conf.json"),
			JSON.stringify({ testRunner: "jest" }),
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/jest-runner",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight reads quoted JavaScript Stryker runner", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-quoted-config-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.js"),
			'module.exports = { "testRunner": "jest" };\n',
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, [
			"@stryker-mutator/jest-runner",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight marks unsupported Stryker runner unavailable", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-unsupported-config-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.js"),
			"module.exports = { testRunner: 'mocha' };\n",
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, [
			"unsupported Stryker runner: mocha",
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight rejects malformed JavaScript Stryker config", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-invalid-config-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, ".stryker.config.js"),
			"module.exports = { testRunner: 'vitest', } }\n",
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, ["stryker config"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight rejects non-object JSON Stryker config", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-json-array-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(join(dir, "stryker.conf.json"), "[]\n");
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, ["stryker config"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight rejects non-static JavaScript Stryker config", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-stryker-dynamic-config-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
			["@vitest/coverage-v8", "4.0.0"],
			["@stryker-mutator/core", "10.0.0"],
			["@stryker-mutator/vitest-runner", "10.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		await write(
			join(dir, "stryker.conf.cjs"),
			"const plugin = require('missing-plugin');\nmodule.exports = { testRunner: 'vitest', plugin };\n",
		);
		const preflight = inspectDependencyPreflight(dir, {
			packageManager: "npm@10.0.0",
			scripts: { "test:coverage": "vitest run --coverage" },
			devDependencies: {
				typescript: "^5",
				vitest: "^4",
				"@vitest/coverage-v8": "^4",
				"@stryker-mutator/core": "^10",
				"@stryker-mutator/vitest-runner": "^10",
			},
		});
		assert.deepEqual(preflight.coverage.missing, []);
		assert.deepEqual(preflight.mutation.missing, ["stryker config"]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight infers runner from executable commands only", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-runner-executable-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		for (const [name, version] of [
			["typescript", "5.9.0"],
			["jest", "30.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		const preflight = inspectDependencyPreflight(
			dir,
			{
				packageManager: "npm@10.0.0",
				scripts: { "test:vitest": "jest --coverage --env=vitest" },
				devDependencies: { typescript: "5", jest: "30" },
			},
			{ coverageCommand: "npm run test:vitest" },
		);
		assert.equal(preflight.coverage.plan?.runner, "jest");
		assert.deepEqual(preflight.coverage.missing, []);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("dependency preflight catches package-manager disagreement", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-pm-`);
	const { rm, writeFile: write } = await import("node:fs/promises");
	try {
		await write(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
		const detected = detectPackageManager(dir, {
			packageManager: "npm@10.0.0",
		});
		assert.equal(detected.manager, "pnpm");
		assert.match(detected.problems.join("\n"), /packageManager \(npm\)/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("package manager detection uses workspace metadata before npm fallback", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-workspace-pm-`);
	const { rm, writeFile: write } = await import("node:fs/promises");
	try {
		await write(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
		const detected = detectPackageManager(dir, {});
		assert.equal(detected.manager, "pnpm");
		assert.deepEqual(detected.metadataManagers, ["pnpm"]);
		const conflicting = detectPackageManager(dir, {
			packageManager: "npm@10.0.0",
		});
		assert.match(
			conflicting.problems.join("\n"),
			/packageManager \(npm\) disagrees with workspace metadata \(pnpm\)/,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("package manager detection flags multiple workspace metadata managers", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-workspace-conflict-`);
	const { rm, writeFile: write } = await import("node:fs/promises");
	try {
		await write(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
		await write(join(dir, ".yarnrc.yml"), "nodeLinker: pnp\n");
		const detected = detectPackageManager(dir, {});
		assert.deepEqual(detected.metadataManagers, ["pnpm", "yarn"]);
		assert.match(
			detected.problems.join("\n"),
			/multiple workspace metadata package managers: pnpm, yarn/,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("package-manager preflight blocks coverage command execution", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-pm-enforce-`);
	const { mkdir, rm, writeFile: write } = await import("node:fs/promises");
	try {
		await mkdir(join(dir, "src"), { recursive: true });
		await write(join(dir, "pnpm-workspace.yaml"), "packages: []\n");
		await write(
			join(dir, "package.json"),
			JSON.stringify({
				name: "fixture",
				private: true,
				packageManager: "npm@10.0.0",
			}),
			"utf8",
		);
		await write(
			join(dir, "src", "core.ts"),
			"export function f(a: number) { return a ? 1 : 0; }\n",
			"utf8",
		);
		await write(
			join(dir, "write-sentinel.cjs"),
			'const fs = require("node:fs"); fs.writeFileSync("sentinel.txt", "ran");\n',
			"utf8",
		);

		const result = runMainInProcess(
			dir,
			"--coverage-command",
			"node write-sentinel.cjs",
		);

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /package-manager preflight failed/);
		let sentinelExists = true;
		try {
			await access(join(dir, "sentinel.txt"));
		} catch {
			sentinelExists = false;
		}
		assert.equal(sentinelExists, false);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("coverage preflight blocks under-provisioned coverage command execution", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-coverage-enforce-`);
	const {
		chmod,
		mkdir,
		rm,
		writeFile: write,
	} = await import("node:fs/promises");
	try {
		await mkdir(join(dir, "src"), { recursive: true });
		await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
		for (const [name, version] of [
			["typescript", "5.0.0"],
			["vitest", "4.0.0"],
		] as const) {
			await mkdir(join(dir, "node_modules", ...name.split("/")), {
				recursive: true,
			});
			await write(
				join(dir, "node_modules", ...name.split("/"), "package.json"),
				JSON.stringify({ version }),
			);
		}
		const vitestBin = join(dir, "node_modules", ".bin", "vitest");
		await write(vitestBin, "#!/bin/sh\nexit 0\n", "utf8");
		await chmod(vitestBin, 0o755);
		await write(
			join(dir, "package.json"),
			JSON.stringify({
				name: "fixture",
				private: true,
				packageManager: "npm@10.0.0",
				scripts: {
					"test:coverage": "vitest run --coverage && node write-sentinel.cjs",
				},
				devDependencies: {
					typescript: "^5",
					vitest: "^4",
				},
			}),
			"utf8",
		);
		await write(
			join(dir, "src", "core.ts"),
			"export function f(a: number) { return a ? 1 : 0; }\n",
			"utf8",
		);
		await write(
			join(dir, "write-sentinel.cjs"),
			'const fs = require("node:fs"); fs.writeFileSync("sentinel.txt", "ran");\n',
			"utf8",
		);

		const result = runMainInProcess(dir);

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /coverage preflight failed/);
		let sentinelExists = true;
		try {
			await access(join(dir, "sentinel.txt"));
		} catch {
			sentinelExists = false;
		}
		assert.equal(sentinelExists, false);
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

function runCliAt(scriptPath: string, dir: string, ...args: string[]) {
	const activeMutant = (
		globalThis as typeof globalThis & {
			__stryker__?: { activeMutant?: string };
		}
	).__stryker__?.activeMutant;
	const env =
		activeMutant === undefined
			? process.env
			: { ...process.env, __STRYKER_ACTIVE_MUTANT__: activeMutant };
	return spawnSync(process.execPath, [scriptPath, ...args], {
		cwd: dir,
		encoding: "utf8",
		env,
	});
}

function runCli(dir: string, ...args: string[]) {
	return runCliAt(SCRIPT_PATH, dir, ...args);
}

async function writePartialCoverageCommand(dir: string): Promise<void> {
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
}

async function writeAmbiguousCoverageCommand(dir: string): Promise<void> {
	await writeFile(
		join(dir, "seed-ambiguous-coverage.cjs"),
		'const fs = require("node:fs");\n' +
			'fs.mkdirSync("coverage", { recursive: true });\n' +
			"const entry = {\n" +
			"  statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },\n" +
			"  s: { 0: 1 },\n" +
			"};\n" +
			'fs.writeFileSync("coverage/coverage-final.json", JSON.stringify({\n' +
			'  "/fixture-a/src/ambiguous-main.ts": entry,\n' +
			'  "/fixture-b/src/ambiguous-main.ts": entry,\n' +
			"}));\n",
		"utf8",
	);
}

function captureMain(dir: string, args: string[] | undefined) {
	let stdout = "";
	let stderr = "";
	const status = main(args, {
		rootDir: dir,
		stdout: {
			write(chunk: string) {
				stdout += chunk;
				return true;
			},
		},
		stderr: {
			write(chunk: string) {
				stderr += chunk;
				return true;
			},
		},
	});
	return { status, stdout, stderr };
}

function runMainInProcess(dir: string, ...args: string[]) {
	return captureMain(dir, args);
}

test("parseCliArgs returns explicit help, error, and run results", () => {
	for (const flag of ["--help", "-h"]) {
		assert.deepEqual(parseCliArgs([flag]), { kind: "help" });
	}
	assert.deepEqual(parseCliArgs([]), {
		kind: "run",
		failOver: null,
		useChanged: false,
		noCoverage: false,
		coverageCommand: null,
		preflightOnly: false,
		fragments: [],
	});
	assert.deepEqual(parseCliArgs(["--fail-over"]), {
		kind: "error",
		message: "crap4ts: --fail-over requires a numeric argument\n",
	});
	assert.deepEqual(parseCliArgs(["--coverage-command"]), {
		kind: "error",
		message: "crap4ts: --coverage-command requires an argument\n",
	});
	assert.deepEqual(parseCliArgs(["--bogus"]), {
		kind: "error",
		message: "crap4ts: unknown option '--bogus'\n",
	});
	assert.deepEqual(
		parseCliArgs([
			"--changed",
			"--no-coverage",
			"--fail-over",
			"12",
			"--coverage-command",
			"node coverage.cjs",
			"--preflight",
			"src",
			"lib",
		]),
		{
			kind: "run",
			failOver: 12,
			useChanged: true,
			noCoverage: true,
			coverageCommand: "node coverage.cjs",
			preflightOnly: true,
			fragments: ["src", "lib"],
		},
	);
});

test("main returns exit codes through injected I/O", async () => {
	const emptyDir = await mkdtemp(`${tmpdir()}/crap4ts-main-empty-`);
	try {
		const help = runMainInProcess(emptyDir, "--help");
		assert.equal(help.status, 0);
		assert.match(help.stdout, /^usage: crap4ts\.mjs/);
		assert.equal(help.stderr, "");

		const unknown = runMainInProcess(emptyDir, "--bogus");
		assert.equal(unknown.status, 1);
		assert.equal(unknown.stdout, "");
		assert.equal(unknown.stderr, "crap4ts: unknown option '--bogus'\n");

		const missingProject = runMainInProcess(emptyDir, "--no-coverage");
		assert.equal(missingProject.status, 1);
		assert.equal(missingProject.stdout, "");
		assert.equal(
			missingProject.stderr,
			"crap4ts: run from a project root containing package.json\n",
		);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(emptyDir, { recursive: true, force: true });
	}
});

test("main --preflight prints dependency readiness without requiring TypeScript", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-main-preflight-`);
	try {
		await writeFile(
			join(dir, "package.json"),
			JSON.stringify({
				name: "fixture",
				private: true,
				scripts: { "test:coverage": "vitest run --coverage" },
			}),
			"utf8",
		);
		const result = runMainInProcess(dir, "--preflight");
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stderr, "");
		assert.match(result.stdout, /^Dependency Preflight$/m);
		for (const missing of [
			"@vitest/coverage-v8: missing",
			"@vitest/coverage-istanbul: missing",
			"@stryker-mutator/core: missing",
			"@stryker-mutator/vitest-runner: missing",
			"@stryker-mutator/jest-runner: missing",
		]) {
			assert.ok(result.stdout.includes(missing));
		}
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("main runs analysis and threshold paths in process", async () => {
	const dir = await createTempProject();
	try {
		const report = runMainInProcess(dir, "--no-coverage");
		assert.equal(report.status, 0, report.stderr);
		assert.match(report.stdout, /^CRAP Report$/m);
		assert.match(report.stdout, /risky\s+src\/core\.ts\s+4\s+N\/A\s+N\/A/);
		assert.equal(report.stderr, "");

		const highThreshold = runMainInProcess(
			dir,
			"--no-coverage",
			"--fail-over",
			"1000",
		);
		assert.equal(highThreshold.status, 0, highThreshold.stderr);
		assert.equal(highThreshold.stderr, "");

		const noMatches = runMainInProcess(
			dir,
			"missing-fragment",
			"--no-coverage",
		);
		assert.equal(noMatches.status, 0, noMatches.stderr);
		assert.equal(noMatches.stdout, "crap4ts: no matching source files\n");

		await writeFile(
			join(dir, "src", "other.ts"),
			"export function other(): number { return 1; }\n",
			"utf8",
		);
		const filtered = runMainInProcess(
			dir,
			"--no-coverage",
			"missing-fragment",
			"src/core",
		);
		assert.equal(filtered.status, 0, filtered.stderr);
		assert.match(filtered.stdout, /risky\s+src\/core\.ts/);
		assert.ok(!filtered.stdout.includes("other"));

		if (process.platform !== "win32") {
			await writeFile(
				join(dir, "src", "slash\\name.ts"),
				"export function slashed(): number { return 1; }\n",
				"utf8",
			);
			const normalized = runMainInProcess(
				dir,
				"--no-coverage",
				"src/slash/name",
			);
			assert.equal(normalized.status, 0, normalized.stderr);
			assert.match(normalized.stdout, /slashed/);
		}

		await writePartialCoverageCommand(dir);
		const coverageOnly = runMainInProcess(
			dir,
			"--coverage-command",
			"node seed-coverage.cjs",
		);
		assert.equal(coverageOnly.status, 0, coverageOnly.stderr);
		assert.match(
			coverageOnly.stdout,
			/risky\s+src\/core\.ts\s+4\s+60\.0%\s+5\.0/,
		);
		assert.equal(coverageOnly.stderr, "");

		await writeFile(
			join(dir, "src", "ambiguous-main.ts"),
			"export function ambiguousMain(): number { return 1; }\n",
			"utf8",
		);
		await writeAmbiguousCoverageCommand(dir);
		const ambiguous = runMainInProcess(
			dir,
			"--coverage-command",
			"node seed-ambiguous-coverage.cjs",
			"ambiguous-main",
		);
		assert.equal(ambiguous.status, 0);
		assert.match(ambiguous.stdout, /ambiguousMain/);
		assert.equal(
			ambiguous.stderr,
			"crap4ts: ambiguous coverage match for src/ambiguous-main.ts (2 files); reporting N/A\n",
		);
		const threshold = runMainInProcess(
			dir,
			"--coverage-command",
			"node seed-coverage.cjs",
			"--fail-over",
			"1",
		);
		assert.equal(threshold.status, 2);
		assert.match(threshold.stdout, /risky\s+src\/core\.ts\s+4\s+60\.0%\s+5\.0/);
		assert.match(threshold.stderr, /exceed CRAP 1/);

		const originalArgv = process.argv;
		try {
			process.argv = [
				process.execPath,
				SCRIPT_PATH,
				"--coverage-command",
				"node seed-coverage.cjs",
				"--fail-over",
				"1",
			];
			const defaults = captureMain(dir, undefined);
			assert.equal(defaults.status, 2);
			assert.match(defaults.stderr, /exceed CRAP 1/);
		} finally {
			process.argv = originalArgv;
		}
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("main reports changed-mode failures without exiting Vitest", async () => {
	const dir = await createTempProject();
	try {
		const result = runMainInProcess(dir, "--changed", "--no-coverage");
		assert.equal(result.status, 1);
		assert.equal(result.stdout, "");
		assert.equal(
			result.stderr,
			"crap4ts: --changed requires origin/main or origin/master\n",
		);
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI characterization: help exits before project preflight", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-help-`);
	try {
		for (const flag of ["--help", "-h"]) {
			const result = runCli(dir, flag);
			assert.equal(result.status, 0, result.stderr);
			assert.match(
				result.stdout,
				/^usage: crap4ts\.mjs \[options\] \[path-fragment \.\.\.\]/,
			);
			assert.match(
				result.stdout,
				/exit codes: 0 ok, 1 usage error, 2 threshold exceeded/,
			);
			assert.equal(result.stderr, "");
		}
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI characterization: value options fail closed", async () => {
	const dir = await mkdtemp(`${tmpdir()}/crap4ts-options-`);
	try {
		for (const args of [["--fail-over"], ["--fail-over", "not-a-number"]]) {
			const result = runCli(dir, ...args);
			assert.equal(result.status, 1);
			assert.equal(
				result.stderr,
				"crap4ts: --fail-over requires a numeric argument\n",
			);
			assert.equal(result.stdout, "");
		}

		const missingCoverageCommand = runCli(dir, "--coverage-command");
		assert.equal(missingCoverageCommand.status, 1);
		assert.equal(
			missingCoverageCommand.stderr,
			"crap4ts: --coverage-command requires an argument\n",
		);
		assert.equal(missingCoverageCommand.stdout, "");
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI characterization: no matches exit before coverage", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(
			dir,
			"missing-fragment",
			"--coverage-command",
			"node definitely-should-not-run.cjs",
		);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "crap4ts: no matching source files\n");
		assert.equal(result.stderr, "");
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI characterization: missing project and TypeScript fail closed", async () => {
	const emptyDir = await mkdtemp(`${tmpdir()}/crap4ts-no-project-`);
	const isolatedDir = await mkdtemp(`${tmpdir()}/crap4ts-no-typescript-`);
	const { copyFile, mkdir, realpath, rm } = await import("node:fs/promises");
	try {
		const missingProject = runCli(emptyDir, "--no-coverage");
		assert.equal(missingProject.status, 1);
		assert.equal(missingProject.stdout, "");
		assert.equal(
			missingProject.stderr,
			"crap4ts: run from a project root containing package.json\n",
		);

		await mkdir(join(isolatedDir, "src"), { recursive: true });
		await writeFile(
			join(isolatedDir, "package.json"),
			JSON.stringify({ name: "fixture", private: true }),
			"utf8",
		);
		const isolatedScript = join(isolatedDir, "crap4ts.mjs");
		await copyFile(SCRIPT_PATH, isolatedScript);
		const missingTypeScript = runCliAt(
			await realpath(isolatedScript),
			isolatedDir,
			"--no-coverage",
		);
		assert.equal(missingTypeScript.status, 1);
		assert.equal(missingTypeScript.stdout, "");
		assert.equal(
			missingTypeScript.stderr,
			"crap4ts: typescript not found — install it as a devDependency in the target project\n",
		);
	} finally {
		await rm(emptyDir, { recursive: true, force: true });
		await rm(isolatedDir, { recursive: true, force: true });
	}
});

test("CLI characterization: path fragments use any-match filtering", async () => {
	const dir = await createTempProject();
	try {
		await writeFile(
			join(dir, "src", "other.ts"),
			"export function other(): number { return 1; }\n",
			"utf8",
		);
		const result = runCli(dir, "--no-coverage", "missing-fragment", "src/core");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /risky\s+src\/core\.ts/);
		assert.ok(!result.stdout.includes("other"));
		assert.equal(result.stderr, "");

		if (process.platform !== "win32") {
			await writeFile(
				join(dir, "src", "slash\\name.ts"),
				"export function slashed(): number { return 1; }\n",
				"utf8",
			);
			const normalized = runCli(dir, "--no-coverage", "src/slash/name");
			assert.equal(normalized.status, 0, normalized.stderr);
			assert.match(normalized.stdout, /slashed/);
		}
	} finally {
		const { rm } = await import("node:fs/promises");
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI characterization: unreadable files warn and do not abort", async () => {
	const dir = await createTempProject();
	const unreadable = join(dir, "src", "unreadable.ts");
	const { chmod, rm } = await import("node:fs/promises");
	try {
		if (process.platform === "win32" || process.getuid?.() === 0) return;
		await writeFile(unreadable, "export const hidden = 1;\n", "utf8");
		await chmod(unreadable, 0o000);
		const result = runCli(dir, "--no-coverage");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /risky\s+src\/core\.ts/);
		assert.match(result.stderr, /crap4ts: skipping src\/unreadable\.ts:/);

		const inProcess = runMainInProcess(dir, "--no-coverage");
		assert.equal(inProcess.status, 0, inProcess.stderr);
		assert.match(inProcess.stdout, /risky\s+src\/core\.ts/);
		assert.match(inProcess.stderr, /crap4ts: skipping src\/unreadable\.ts:/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("CLI smoke: --no-coverage prints report and exits 0 under high threshold", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(dir, "--no-coverage", "--fail-over", "1000");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /^CRAP Report$/m);
		assert.match(result.stdout, /risky\s+src\/core\.ts\s+4\s+N\/A\s+N\/A/);
		assert.equal(result.stderr, "");
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

test("CLI characterization: coverage runs unless explicitly disabled", async () => {
	const dir = await createTempProject();
	try {
		const result = runCli(dir);
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /risky\s+src\/core\.ts\s+4\s+N\/A\s+N\/A/);
		assert.equal(
			result.stderr,
			"crap4ts: no coverage runner found (test:coverage script, vitest, or jest); reporting coverage as N/A\n",
		);
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
		await writePartialCoverageCommand(dir);
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

test("CLI characterization: coverage without a threshold exits 0", async () => {
	const dir = await createTempProject();
	try {
		await writePartialCoverageCommand(dir);
		const result = runCli(dir, "--coverage-command", "node seed-coverage.cjs");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /risky\s+src\/core\.ts\s+4\s+60\.0%\s+5\.0/);
		assert.equal(result.stderr, "");
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
