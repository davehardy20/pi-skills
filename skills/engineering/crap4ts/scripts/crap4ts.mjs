#!/usr/bin/env node
// crap4ts — CRAP (Change Risk Anti-Pattern) metric for JavaScript/TypeScript.
//
// Independent implementation of the CRAP formula published by Alberto Savoia and
// Robert C. Martin (crap4j): CRAP(fn) = CC^2 x (1 - coverage)^3 + CC.
// Modeled on the workflow of unclebob/crap4clj, crap4go, and crap4java.
// No code was copied from those repositories.
//
// Pipeline per run (mirrors the crap4* family): delete stale coverage, run the
// project's coverage command, analyze source files, print worst-first report.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const SOURCE_EXTENSIONS = new Set([
	".js",
	".jsx",
	".ts",
	".tsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
]);

export const EXCLUDED_DIRS = new Set([
	"node_modules",
	".git",
	".cache",
	".next",
	".turbo",
	".yarn",
	"coverage",
	"dist",
	"build",
	"out",
	"target",
	"__tests__",
	"__mocks__",
]);

const EXCLUDED_FILE_PATTERNS = [
	/\.d\.[cm]?ts$/,
	/\.test\.[cm]?[jt]sx?$/,
	/\.spec\.[cm]?[jt]sx?$/,
	/\.stories\.[cm]?[jt]sx?$/,
	/\.config\.[cm]?[jt]sx?$/,
];

export function shouldExcludeFile(fileName) {
	return EXCLUDED_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
}

export function computeCrap(cc, coverage) {
	if (typeof coverage !== "number" || Number.isNaN(coverage)) return null;
	return cc * cc * (1 - coverage) ** 3 + cc;
}

function isFunctionLike(ts, node) {
	switch (node.kind) {
		case ts.SyntaxKind.FunctionDeclaration:
		case ts.SyntaxKind.FunctionExpression:
		case ts.SyntaxKind.ArrowFunction:
		case ts.SyntaxKind.MethodDeclaration:
		case ts.SyntaxKind.GetAccessor:
		case ts.SyntaxKind.SetAccessor:
		case ts.SyntaxKind.Constructor:
			return true;
		default:
			return false;
	}
}

function complexityOf(ts, fnNode) {
	let decisions = 0;
	const bump = () => {
		decisions += 1;
	};
	function walk(node, isRoot) {
		if (!isRoot && isFunctionLike(ts, node)) return; // nested fns report separately
		switch (node.kind) {
			case ts.SyntaxKind.IfStatement:
			case ts.SyntaxKind.ForStatement:
			case ts.SyntaxKind.ForInStatement:
			case ts.SyntaxKind.ForOfStatement:
			case ts.SyntaxKind.WhileStatement:
			case ts.SyntaxKind.DoStatement:
			case ts.SyntaxKind.CaseClause:
			case ts.SyntaxKind.CatchClause:
			case ts.SyntaxKind.ConditionalExpression:
				bump();
				break;
			case ts.SyntaxKind.BinaryExpression: {
				const op = node.operatorToken.kind;
				if (
					op === ts.SyntaxKind.AmpersandAmpersandToken ||
					op === ts.SyntaxKind.BarBarToken ||
					op === ts.SyntaxKind.QuestionQuestionToken ||
					op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
					op === ts.SyntaxKind.BarBarEqualsToken ||
					op === ts.SyntaxKind.QuestionQuestionEqualsToken
				) {
					bump();
				}
				break;
			}
			default:
				break;
		}
		ts.forEachChild(node, (child) => walk(child, false));
	}
	walk(fnNode, true);
	return decisions + 1;
}

function identifierText(ts, nameNode) {
	if (!nameNode) return null;
	if (
		nameNode.kind === ts.SyntaxKind.Identifier ||
		nameNode.kind === ts.SyntaxKind.StringLiteral ||
		nameNode.kind === ts.SyntaxKind.NumericLiteral
	) {
		return nameNode.text ?? String(nameNode.text);
	}
	return nameNode.getText ? nameNode.getText() : null;
}

function ownerName(ts, node) {
	const parent = node.parent;
	if (
		parent &&
		(parent.kind === ts.SyntaxKind.ClassDeclaration ||
			parent.kind === ts.SyntaxKind.ClassExpression)
	) {
		return parent.name?.text ?? null;
	}
	return null;
}

function contextualName(ts, node) {
	const parent = node.parent;
	if (!parent) return null;
	if (
		parent.kind === ts.SyntaxKind.VariableDeclaration &&
		parent.name?.kind === ts.SyntaxKind.Identifier
	) {
		return parent.name.text;
	}
	if (parent.kind === ts.SyntaxKind.PropertyAssignment) {
		return identifierText(ts, parent.name);
	}
	if (
		parent.kind === ts.SyntaxKind.BinaryExpression &&
		parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
	) {
		if (parent.left.kind === ts.SyntaxKind.Identifier) return parent.left.text;
		if (parent.left.kind === ts.SyntaxKind.PropertyAccessExpression)
			return parent.left.name?.text ?? null;
	}
	return null;
}

function functionRecord(ts, node, sourceFile, fileName) {
	let name;
	if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
		name = node.name?.text ?? "<anonymous>";
	} else if (node.kind === ts.SyntaxKind.Constructor) {
		name = `${ownerName(ts, node) ?? "<class>"}.constructor`;
	} else if (
		node.kind === ts.SyntaxKind.MethodDeclaration ||
		node.kind === ts.SyntaxKind.GetAccessor ||
		node.kind === ts.SyntaxKind.SetAccessor
	) {
		const method = identifierText(ts, node.name) ?? "<method>";
		const owner = ownerName(ts, node);
		name = owner ? `${owner}.${method}` : method;
	} else if (node.kind === ts.SyntaxKind.FunctionExpression) {
		name = node.name?.text ?? contextualName(ts, node) ?? "<anonymous>";
	} else {
		name = contextualName(ts, node) ?? "<anonymous>";
	}

	const startLine =
		sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
		1;
	const endLine =
		sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

	return {
		name,
		file: fileName,
		startLine,
		endLine,
		cc: complexityOf(ts, node),
	};
}

export function analyzeSource(ts, fileName, text) {
	const sourceFile = ts.createSourceFile(
		fileName,
		text,
		ts.ScriptTarget.Latest,
		true,
	);
	const functions = [];
	function visit(node) {
		if (isFunctionLike(ts, node))
			functions.push(functionRecord(ts, node, sourceFile, fileName));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return functions;
}

// ---- Coverage ----

export function parseCoverageData(data) {
	const map = new Map(); // absolute file path -> statements[]
	for (const [file, cov] of Object.entries(data)) {
		const statements = [];
		for (const [id, range] of Object.entries(cov.statementMap ?? {})) {
			statements.push({
				startLine: range.start.line,
				endLine: range.end.line,
				hits: cov.s?.[id] ?? 0,
			});
		}
		map.set(resolve(file), statements);
	}
	return map;
}

export function functionCoverage(fn, statements) {
	if (!statements || statements.length === 0) return null;
	let total = 0;
	let covered = 0;
	for (const s of statements) {
		if (s.startLine <= fn.endLine && s.endLine >= fn.startLine) {
			total += 1;
			if (s.hits > 0) covered += 1;
		}
	}
	if (total === 0) return null;
	return covered / total;
}

const warnedSuffixes = new Set();

// Exact path match first; unique path-suffix match second (like crap4go).
// Path handling is POSIX-only; see Environment Notes in SKILL.md.
export function matchStatements(absoluteFilePath, coverageMap) {
	if (coverageMap.has(absoluteFilePath))
		return coverageMap.get(absoluteFilePath);
	const suffix = absoluteFilePath.split("/").slice(-2).join("/");
	const candidates = [];
	for (const key of coverageMap.keys()) {
		if (key.endsWith(`/${suffix}`)) candidates.push(key);
	}
	if (candidates.length === 1) return coverageMap.get(candidates[0]);
	if (candidates.length > 1 && !warnedSuffixes.has(suffix)) {
		warnedSuffixes.add(suffix);
		process.stderr.write(
			`crap4ts: ambiguous coverage match for ${suffix} (${candidates.length} files); reporting N/A\n`,
		);
	}
	return null;
}

// ---- Report ----

export function buildRows(functions, coverageMap, rootDir) {
	const rows = [];
	for (const fn of functions) {
		const absPath = resolve(rootDir, fn.file);
		const statements = coverageMap
			? matchStatements(absPath, coverageMap)
			: null;
		const coverage = functionCoverage(fn, statements);
		rows.push({
			name: fn.name,
			file: relative(rootDir, absPath).split("\\").join("/"),
			cc: fn.cc,
			coverage,
			crap: computeCrap(fn.cc, coverage),
		});
	}
	return rows;
}

export function sortRows(rows) {
	return [...rows].sort((a, b) => {
		if (a.crap == null && b.crap == null) return b.cc - a.cc;
		if (a.crap == null) return 1;
		if (b.crap == null) return -1;
		return b.crap - a.crap || b.cc - a.cc;
	});
}

export function formatReport(rows) {
	const header =
		"Function                          File                              CC   Cov%     CRAP";
	const separator = "-".repeat(header.length);
	const lines = ["CRAP Report", "===========", header, separator];
	for (const row of rows) {
		const cov =
			row.coverage == null ? "N/A" : `${(row.coverage * 100).toFixed(1)}%`;
		const crap = row.crap == null ? "N/A" : row.crap.toFixed(1);
		lines.push(
			`${row.name.padEnd(34)}${row.file.padEnd(34)}${String(row.cc).padStart(4)}${cov.padStart(8)}${crap.padStart(8)}`,
		);
	}
	return lines.join("\n");
}

export function evaluateThreshold(rows, threshold) {
	return rows.filter((row) => row.crap != null && row.crap > threshold);
}

// ---- Project pipeline ----

function loadTypeScript(rootDir) {
	const candidates = [
		resolve(rootDir, "node_modules", "typescript"),
		resolve(SCRIPT_DIR, "..", "..", "..", "..", "node_modules", "typescript"),
	];
	for (const dir of candidates) {
		const entry = resolve(dir, "lib", "typescript.js");
		if (existsSync(entry)) {
			const req = createRequire(entry);
			return req(entry);
		}
	}
	throw new Error(
		"typescript not found — install it as a devDependency in the target project",
	);
}

export function detectCoverageCommand(rootDir, pkg) {
	const scripts = pkg.scripts ?? {};
	if (typeof scripts["test:coverage"] === "string")
		return "npm run test:coverage";
	if (typeof scripts.coverage === "string") return "npm run coverage";
	if (existsSync(join(rootDir, "node_modules", ".bin", "vitest"))) {
		return "./node_modules/.bin/vitest run --coverage --coverage.reporter=json --coverage.reporter=text-summary";
	}
	if (existsSync(join(rootDir, "node_modules", ".bin", "jest"))) {
		return "./node_modules/.bin/jest --coverage --coverageReporters=json --passWithNoTests";
	}
	return null;
}

function runCoverage(rootDir, pkg, overrideCommand) {
	const command = overrideCommand ?? detectCoverageCommand(rootDir, pkg);
	if (!command) {
		process.stderr.write(
			"crap4ts: no coverage runner found (test:coverage script, vitest, or jest); reporting coverage as N/A\n",
		);
		return null;
	}
	const coverageDir = join(rootDir, "coverage");
	rmSync(coverageDir, { recursive: true, force: true });
	const result = spawnSync(command, {
		shell: true,
		cwd: rootDir,
		stdio: ["ignore", "inherit", "inherit"],
		timeout: 600_000,
	});
	if (result.error) {
		process.stderr.write(
			`crap4ts: coverage command failed to start: ${result.error.message}\n`,
		);
		return null;
	}
	if (result.status !== 0) {
		process.stderr.write(
			`crap4ts: coverage command exited ${result.status}; using artifacts anyway\n`,
		);
	}
	const finalPath = join(coverageDir, "coverage-final.json");
	if (!existsSync(finalPath)) {
		process.stderr.write(
			`crap4ts: ${finalPath} not found; reporting coverage as N/A (the command must produce coverage/coverage-final.json)\n`,
		);
		return null;
	}
	try {
		return parseCoverageData(JSON.parse(readFileSync(finalPath, "utf8")));
	} catch (error) {
		process.stderr.write(
			`crap4ts: failed to parse coverage-final.json: ${error.message}\n`,
		);
		return null;
	}
}

function collectSourceFiles(rootDir) {
	const files = [];
	(function walk(dir) {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				if (EXCLUDED_DIRS.has(dirent.name)) continue;
				walk(path);
			} else if (
				SOURCE_EXTENSIONS.has(extname(dirent.name)) &&
				!shouldExcludeFile(dirent.name)
			) {
				files.push(path);
			}
		}
	})(rootDir);
	return files;
}

function changedFiles(rootDir) {
	let base = null;
	for (const candidate of ["origin/main", "origin/master"]) {
		const check = spawnSync(
			"git",
			["rev-parse", "--verify", "--quiet", candidate],
			{
				cwd: rootDir,
			},
		);
		if (check.status === 0) {
			base = candidate;
			break;
		}
	}
	if (!base) {
		process.stderr.write(
			"crap4ts: --changed requires origin/main or origin/master\n",
		);
		process.exit(1);
	}
	const mergeBase = spawnSync("git", ["merge-base", base, "HEAD"], {
		cwd: rootDir,
	});
	if (mergeBase.status !== 0 || !mergeBase.stdout?.toString().trim()) {
		process.stderr.write(`crap4ts: git merge-base ${base} HEAD failed\n`);
		process.exit(1);
	}
	const diff = spawnSync(
		"git",
		["diff", "--name-only", mergeBase.stdout.toString().trim()],
		{
			cwd: rootDir,
		},
	);
	if (diff.status !== 0) {
		process.stderr.write("crap4ts: git diff --name-only failed\n");
		process.exit(1);
	}
	const filterSourceLines = (lines) =>
		lines.filter(
			(line) =>
				line.length > 0 &&
				SOURCE_EXTENSIONS.has(extname(line)) &&
				!shouldExcludeFile(line.split("/").pop() ?? "") &&
				existsSync(resolve(rootDir, line)),
		);

	const tracked = filterSourceLines(
		diff.stdout
			.toString()
			.split("\n")
			.map((line) => line.trim()),
	);

	// Untracked (never-staged) files never appear in git diff; union them in
	// so WIP code — often the riskiest — is not silently omitted.
	const untracked = spawnSync(
		"git",
		["ls-files", "--others", "--exclude-standard"],
		{ cwd: rootDir },
	);
	if (untracked.status !== 0) {
		process.stderr.write("crap4ts: git ls-files --others failed\n");
		process.exit(1);
	}
	return [
		...tracked,
		...filterSourceLines(
			untracked.stdout
				.toString()
				.split("\n")
				.map((line) => line.trim()),
		),
	];
}

function printUsage() {
	process.stdout.write(`usage: crap4ts.mjs [options] [path-fragment ...]

Analyzes JavaScript/TypeScript source and reports CRAP scores
(CRAP = CC^2 x (1 - coverage)^3 + CC), worst first.

options:
  --help                 print this usage
  --changed              analyze only files changed vs merge-base of origin/main (or origin/master)
  --no-coverage          skip the coverage run; report N/A for coverage and CRAP
  --coverage-command CMD run CMD instead of the detected coverage command
                         (must produce coverage/coverage-final.json)
  --fail-over N          exit 2 when any CRAP score exceeds N
  path fragments         analyze only files whose relative path contains any fragment

exit codes: 0 ok, 1 usage error, 2 threshold exceeded
`);
}

function main() {
	const args = process.argv.slice(2);
	let failOver = null;
	let useChanged = false;
	let noCoverage = false;
	let coverageCommand = null;
	const fragments = [];

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			printUsage();
			process.exit(0);
		} else if (arg === "--fail-over") {
			failOver = Number(args[i + 1]);
			if (!Number.isFinite(failOver)) {
				process.stderr.write(
					"crap4ts: --fail-over requires a numeric argument\n",
				);
				process.exit(1);
			}
			i += 1;
		} else if (arg === "--changed") {
			useChanged = true;
		} else if (arg === "--no-coverage") {
			noCoverage = true;
		} else if (arg === "--coverage-command") {
			coverageCommand = args[i + 1];
			if (!coverageCommand) {
				process.stderr.write(
					"crap4ts: --coverage-command requires an argument\n",
				);
				process.exit(1);
			}
			i += 1;
		} else if (arg.startsWith("--")) {
			process.stderr.write(`crap4ts: unknown option '${arg}'\n`);
			process.exit(1);
		} else {
			fragments.push(arg);
		}
	}

	const rootDir = process.cwd();
	let pkg = null;
	try {
		pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
	} catch {
		process.stderr.write(
			"crap4ts: run from a project root containing package.json\n",
		);
		process.exit(1);
	}

	let ts;
	try {
		ts = loadTypeScript(rootDir);
	} catch (error) {
		process.stderr.write(`crap4ts: ${error.message}\n`);
		process.exit(1);
	}

	const files = useChanged
		? changedFiles(rootDir)
		: collectSourceFiles(rootDir);
	const filtered = fragments.length
		? files.filter((file) => {
				const rel = relative(rootDir, file).split("\\").join("/");
				return fragments.some((fragment) => rel.includes(fragment));
			})
		: files;
	if (filtered.length === 0) {
		process.stdout.write("crap4ts: no matching source files\n");
		process.exit(0);
	}

	const coverageMap = noCoverage
		? null
		: runCoverage(rootDir, pkg, coverageCommand);

	const functions = [];
	for (const file of filtered) {
		const rel = relative(rootDir, file);
		try {
			const text = readFileSync(file, "utf8");
			functions.push(...analyzeSource(ts, rel, text));
		} catch (error) {
			process.stderr.write(`crap4ts: skipping ${rel}: ${error.message}\n`);
		}
	}

	const rows = sortRows(buildRows(functions, coverageMap, rootDir));
	process.stdout.write(`${formatReport(rows)}\n`);

	if (failOver != null) {
		const exceeded = evaluateThreshold(rows, failOver);
		if (exceeded.length > 0) {
			process.stderr.write(
				`crap4ts: ${exceeded.length} function(s) exceed CRAP ${failOver}\n`,
			);
			process.exit(2);
		}
	}
}

const invokedDirectly =
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === new URL(import.meta.url).href;
if (invokedDirectly) {
	main();
}
