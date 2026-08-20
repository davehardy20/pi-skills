import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
	const cov = functionCoverage(
		{ startLine: 1, endLine: 4 },
		map.get("/proj/src/core.ts"),
	);
	assert.equal(cov, 0.5);
	// no overlap -> null (N/A), never fabricated
	assert.equal(
		functionCoverage(
			{ startLine: 10, endLine: 20 },
			map.get("/proj/src/core.ts"),
		),
		null,
	);
	assert.equal(functionCoverage({ startLine: 1, endLine: 4 }, null), null);
});

test("matchStatements uses exact match then unique suffix fallback", () => {
	const map = parseCoverageData({
		"/other/build/x/src/core.ts": {
			statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
			s: { 0: 1 },
		},
	});
	// exact
	assert.equal(matchStatements("/other/build/x/src/core.ts", map)?.length, 1);
	// unique 2-segment suffix fallback
	assert.equal(matchStatements("/proj/src/core.ts", map)?.length, 1);
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
			cc: 10,
		},
		{ name: "simple", file: "src/core.ts", startLine: 12, endLine: 14, cc: 1 },
	];
	const map = new Map([
		[
			resolve("/proj/src/core.ts"),
			[
				{ startLine: 1, endLine: 10, hits: 0 },
				{ startLine: 12, endLine: 14, hits: 4 },
			],
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

test("exported constants match their declarations (d.mts drift guard)", () => {
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
