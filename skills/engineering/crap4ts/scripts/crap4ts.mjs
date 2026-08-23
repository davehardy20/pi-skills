#!/usr/bin/env node
// crap4ts — CRAP metric for JavaScript/TypeScript.
//
// CRAP began as Change Risk Analysis and Prediction and was later reframed by
// crap4j as Change Risk Anti-Patterns. This independently implements the formula
// developed by Alberto Savoia and Bob Evans:
// CRAP(fn) = CC^2 x (1 - coverage)^3 + CC.
// Modeled on Robert C. Martin's later crap4clj, crap4go, and crap4java workflows.
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

	const startPos = sourceFile.getLineAndCharacterOfPosition(
		node.getStart(sourceFile),
	);
	const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
	const startLine = startPos.line + 1;
	const endLine = endPos.line + 1;

	return {
		name,
		file: fileName,
		startLine,
		endLine,
		// Istanbul convention: 1-based line, 0-based column.
		start: { line: startLine, column: startPos.character },
		end: { line: endLine, column: endPos.character },
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
		// Bodyless declarations (overload signatures, `declare` functions,
		// abstract methods) share syntax kinds with real functions but have
		// no executable body, no Istanbul entry, and would surface as
		// phantom duplicate N/A rows — skip them.
		if (isFunctionLike(ts, node) && node.body !== undefined)
			functions.push(functionRecord(ts, node, sourceFile, fileName));
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return functions;
}

// ---- Coverage ----

export function parseCoverageData(data) {
	const map = new Map(); // absolute file path -> { statements, functions }
	for (const [file, cov] of Object.entries(data)) {
		const statements = [];
		for (const [id, range] of Object.entries(cov.statementMap ?? {})) {
			statements.push({
				startLine: range.start.line,
				endLine: range.end.line,
				startColumn: range.start.column ?? 0,
				endColumn: range.end.column ?? 0,
				hits: cov.s?.[id] ?? 0,
			});
		}
		// loc = full span incl. body (used for nested-ownership containment);
		// decl = header only. TS node.getStart() includes modifiers (export/
		// async) so TS spans can start earlier than Istanbul's function node.
		const functions = Object.entries(cov.fnMap ?? {})
			.filter(([, range]) => range?.loc ?? range?.decl)
			.map(([id, range]) => {
				const span = range.loc ?? range.decl;
				// Preserve null columns: real Istanbul fnMap data uses null for
				// "to end of line". Comparisons null-guard, and a coerced 0 here
				// would defeat the end-of-line sentinel and break own-span
				// matching for functions ending away from column 0.
				return {
					start: {
						line: span.start.line,
						column: span.start.column ?? null,
					},
					end: {
						line: span.end.line,
						column: span.end.column ?? null,
					},
					// Retain the fnMap hit count (cov.f): concise-bodied arrows
					// have no attributable statements (their only statement is the
					// excluded enclosing declaration), so execution data lives here.
					hits: cov.f?.[id] ?? null,
				};
			});
		map.set(resolve(file), { statements, functions });
	}
	return map;
}

function posCompare(a, b) {
	if (a.line !== b.line) return a.line - b.line;
	return (a.column ?? 0) - (b.column ?? 0);
}

// End positions compare with end-of-line semantics: a null end column
// (real Istanbul fnMap data) spans to the end of its line, so it must
// contain any same-line position rather than compete as column 0.
function endCompare(a, b) {
	if (a.line !== b.line) return a.line - b.line;
	if (a.column == null && b.column == null) return 0;
	const aCol = a.column == null ? Number.POSITIVE_INFINITY : a.column;
	const bCol = b.column == null ? Number.POSITIVE_INFINITY : b.column;
	return aCol - bCol;
}

function rangeContains(outer, inner) {
	return (
		posCompare(outer.start, inner.start) <= 0 &&
		endCompare(outer.end, inner.end) >= 0
	);
}

function rangesEqual(a, b) {
	return posCompare(a.start, b.start) === 0 && endCompare(a.end, b.end) === 0;
}

// Only statements fully contained in the function's own span count. This
// excludes enclosing statements (e.g. the variable declaration wrapping an
// arrow is marked hit merely by loading the module) and statements owned by
// nested functions (via fnMap), so an uncalled high-complexity arrow
// cannot appear covered.
export function functionCoverage(fn, statements, fileFunctions = []) {
	// Only a MISSING statement array returns immediately; an empty array
	// still falls through to the fnMap-hits fallback (Codex P2: a file
	// with fnMap/f but empty statementMap — e.g. only empty functions —
	// still has definitive execution data in cov.f).
	if (!statements) return null;
	if (!fn.start || !fn.end) return null;
	// A fnMap span is THIS function when its end matches (reconciling the
	// TS-vs-Istanbul start-offset difference for modifiers); all other
	// contained spans are nested functions.
	const own = ownFunctionSpans(fn, fileFunctions);
	const nested = fileFunctions.filter(
		(g) => !own.includes(g) && rangeContains(fn, g),
	);
	let total = 0;
	let covered = 0;
	for (const s of statements) {
		const stmt = {
			start: { line: s.startLine, column: s.startColumn ?? 0 },
			end: { line: s.endLine, column: s.endColumn ?? 0 },
		};
		if (!rangeContains(fn, stmt)) continue;
		// Skip statements that wrap the function's own declaration: under
		// Istanbul, a never-called function's declaration statement is marked
		// hit merely by loading the module. Such a statement shares the
		// function's end (with tolerance) and starts at or before the own
		// loc's start (at the export/function keyword).
		if (
			own.some(
				(g) =>
					stmtEndsWithinTolerance(g, stmt) &&
					posCompare(stmt.start, g.start) <= 0,
			)
		)
			continue;
		if (nested.some((g) => rangeContains(g, stmt) && !rangesEqual(g, stmt)))
			continue;
		total += 1;
		if (s.hits > 0) covered += 1;
	}
	if (total === 0) {
		// Concise-bodied arrows have no attributable statements (their only
		// statement is the excluded enclosing declaration). Fall back to the
		// fnMap hit count so executed arrows are not reported N/A.
		const ownHits = own.map((g) => g.hits).find((h) => h != null);
		return ownHits == null ? null : ownHits > 0 ? 1 : 0;
	}
	return covered / total;
}

function sameEnd(g, fn) {
	return stmtEndsWithinTolerance(g, fn) && posCompare(g.start, fn.start) >= 0;
}

function stmtEndsWithinTolerance(g, stmt) {
	// Real Istanbul data: loc/statement end columns can be null (meaning
	// "to end of line"), and TS end positions are exclusive while
	// Istanbul's are inclusive, so ends may differ by one column or — when
	// the null sentinel lands next to a trailing newline — by one line.
	// A null column therefore matches within ±1 line, exact lines within
	// ±1 column.
	const lineDelta = Math.abs(g.end.line - stmt.end.line);
	if (g.end.column == null || stmt.end.column == null) {
		return lineDelta <= 1;
	}
	if (g.end.line !== stmt.end.line) return false;
	const endCol = g.end.column - stmt.end.column;
	return endCol >= -1 && endCol <= 1;
}

// A loc is the function's own span when it ends at the function's end
// (with inclusive/exclusive column tolerance) and starts no earlier than
// the TS span start (TS spans include modifiers/decorators; Istanbul
// locs start at the parameters or body). With several qualifying locs
// (curried arrows share an end), the earliest-start one is the function's
// own — later starts belong to nested functions.
export function ownFunctionSpans(fn, fileFunctions) {
	if (!fn.start || !fn.end) return [];
	const candidates = fileFunctions.filter((g) => sameEnd(g, fn));
	if (candidates.length <= 1) return candidates;
	const own = candidates.reduce((a, b) =>
		posCompare(a.start, b.start) <= 0 ? a : b,
	);
	return [own];
}

const warnedSuffixes = new Set();

// Exact path match first; unique path-suffix match second (like crap4go).
// Path handling is POSIX-only; see Environment Notes in SKILL.md.
export function matchStatements(
	absoluteFilePath,
	coverageMap,
	stderr = process.stderr,
) {
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
		stderr.write(
			`crap4ts: ambiguous coverage match for ${suffix} (${candidates.length} files); reporting N/A\n`,
		);
	}
	return null;
}

// ---- Report ----

export function buildRows(
	functions,
	coverageMap,
	rootDir,
	stderr = process.stderr,
) {
	const rows = [];
	for (const fn of functions) {
		const absPath = resolve(rootDir, fn.file);
		const entry = coverageMap
			? matchStatements(absPath, coverageMap, stderr)
			: null;
		const coverage = functionCoverage(
			fn,
			entry?.statements ?? null,
			entry?.functions ?? [],
		);
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

const PACKAGE_MANAGER_LOCKFILES = [
	{ name: "pnpm", file: "pnpm-lock.yaml" },
	{ name: "yarn", file: "yarn.lock" },
	{ name: "bun", file: "bun.lock" },
	{ name: "bun", file: "bun.lockb" },
	{ name: "npm", file: "package-lock.json" },
	{ name: "npm", file: "npm-shrinkwrap.json" },
];

const WORKSPACE_METADATA = [
	{ name: "pnpm", file: "pnpm-workspace.yaml" },
	{ name: "yarn", file: ".yarnrc.yml" },
	{ name: "yarn", file: ".pnp.cjs" },
	{ name: "yarn", file: ".pnp.loader.mjs" },
	{ name: "bun", file: "bunfig.toml" },
];

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

const VITEST_COVERAGE_PROVIDERS = [
	"@vitest/coverage-v8",
	"@vitest/coverage-istanbul",
];

const STRYKER_PACKAGES = [
	"@stryker-mutator/core",
	"@stryker-mutator/vitest-runner",
	"@stryker-mutator/jest-runner",
];

function declaredDependencyVersion(pkg, name) {
	for (const field of DEPENDENCY_FIELDS) {
		const group = pkg[field] ?? {};
		if (Object.hasOwn(group, name)) return group[name];
	}
	return null;
}

function localDependencyPath(rootDir, name) {
	return resolve(rootDir, "node_modules", ...name.split("/"), "package.json");
}

function readPackageJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function resolvedDependencyPath(rootDir, name) {
	try {
		const req = createRequire(resolve(rootDir, "package.json"));
		return req.resolve(`${name}/package.json`);
	} catch {
		return null;
	}
}

function majorVersion(version) {
	if (typeof version !== "string") return null;
	const match = version.match(/\d+/);
	return match ? Number(match[0]) : null;
}

function parseVersionParts(value) {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
	if (!match) return null;
	return {
		tuple: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
		partCount: match[3] != null ? 3 : match[2] != null ? 2 : 1,
	};
}

function parseVersionTuple(value) {
	return parseVersionParts(value)?.tuple ?? null;
}

function compareVersionTuples(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] > right[index]) return 1;
		if (left[index] < right[index]) return -1;
	}
	return 0;
}

function versionInRange(version, lower, upper) {
	return (
		compareVersionTuples(version, lower) >= 0 &&
		compareVersionTuples(version, upper) < 0
	);
}

function bareUpperBound({ tuple, partCount }) {
	if (partCount === 1) return [tuple[0] + 1, 0, 0];
	if (partCount === 2) return [tuple[0], tuple[1] + 1, 0];
	return null;
}

function caretUpperBound({ tuple, partCount }) {
	const [major, minor, patch] = tuple;
	if (major > 0) return [major + 1, 0, 0];
	if (partCount === 1) return [1, 0, 0];
	if (minor > 0) return [0, minor + 1, 0];
	if (partCount === 2) return [0, 1, 0];
	return [0, 0, patch + 1];
}

function tildeUpperBound({ tuple, partCount }) {
	const [major, minor] = tuple;
	if (partCount === 1) return [major + 1, 0, 0];
	return [major, minor + 1, 0];
}

function hyphenRangeResult(version, alternative) {
	const match = alternative.match(
		/^\s*(v?\d+(?:\.\d+){0,2})\s+-\s+(v?\d+(?:\.\d+){0,2})\s*$/,
	);
	if (!match) return null;
	const lower = parseVersionParts(match[1]);
	const upper = parseVersionParts(match[2]);
	if (!lower || !upper) return null;
	if (compareVersionTuples(version, lower.tuple) < 0) return false;
	if (upper.partCount < 3) {
		const upperBound = bareUpperBound(upper);
		return upperBound ? compareVersionTuples(version, upperBound) < 0 : null;
	}
	return compareVersionTuples(version, upper.tuple) <= 0;
}

function wildcardRangeResult(version, comparator) {
	const match = comparator.match(
		/^v?(\d+|x|\*)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i,
	);
	if (!match) return null;
	const parts = [match[1], match[2], match[3]].filter((part) => part != null);
	const wildcardIndex = parts.findIndex((part) => /^[x*]$/i.test(part));
	if (wildcardIndex === -1) return null;
	if (wildcardIndex === 0) return true;
	const lower = [0, 0, 0];
	for (let index = 0; index < wildcardIndex; index += 1) {
		lower[index] = Number(parts[index]);
	}
	const upper = [...lower];
	upper[wildcardIndex - 1] += 1;
	for (let index = wildcardIndex; index < 3; index += 1) {
		upper[index] = 0;
	}
	return versionInRange(version, lower, upper);
}

function satisfiesComparator(version, comparator) {
	const match = comparator.match(/^(>=|>|<=|<|=)?\s*(v?\d+(?:\.\d+){0,2})$/);
	if (!match) return null;
	const operator = match[1] ?? null;
	const parsed = parseVersionParts(match[2]);
	if (!parsed) return null;
	const target = parsed.tuple;
	if (operator == null || operator === "=") {
		const upper = bareUpperBound(parsed);
		return upper
			? versionInRange(version, target, upper)
			: compareVersionTuples(version, target) === 0;
	}
	const comparison = compareVersionTuples(version, target);
	if (operator === ">=") return comparison >= 0;
	if (operator === ">") return comparison > 0;
	if (operator === "<=") return comparison <= 0;
	if (operator === "<") return comparison < 0;
	return null;
}

function satisfiesDeclaredRange(installedVersion, declaredVersion) {
	const installed = parseVersionTuple(installedVersion);
	if (!installed || typeof declaredVersion !== "string") return null;
	const range = declaredVersion.trim();
	if (!range || ["*", "latest"].includes(range)) {
		return range === "*" ? true : null;
	}
	let sawAnyKnownComparator = false;
	for (const alternative of range.split("||")) {
		const hyphenResult = hyphenRangeResult(installed, alternative);
		if (hyphenResult != null) {
			sawAnyKnownComparator = true;
			if (hyphenResult) return true;
			continue;
		}
		const comparators = alternative.trim().split(/\s+/).filter(Boolean);
		if (comparators.length === 0) continue;
		let sawKnownComparator = false;
		let satisfied = true;
		for (const comparator of comparators) {
			const wildcardResult = wildcardRangeResult(installed, comparator);
			if (wildcardResult != null) {
				sawKnownComparator = true;
				sawAnyKnownComparator = true;
				if (!wildcardResult) {
					satisfied = false;
					break;
				}
				continue;
			}
			if (/^\^\s*v?\d+(?:\.\d+){0,2}$/.test(comparator)) {
				sawKnownComparator = true;
				sawAnyKnownComparator = true;
				const parsed = parseVersionParts(comparator.replace(/^\^\s*/, ""));
				const upper = parsed ? caretUpperBound(parsed) : null;
				satisfied =
					parsed != null && versionInRange(installed, parsed.tuple, upper);
				if (!satisfied) break;
				continue;
			}
			if (/^~\s*v?\d+(?:\.\d+){0,2}$/.test(comparator)) {
				sawKnownComparator = true;
				sawAnyKnownComparator = true;
				const parsed = parseVersionParts(comparator.replace(/^~\s*/, ""));
				const upper = parsed ? tildeUpperBound(parsed) : null;
				satisfied =
					parsed != null && versionInRange(installed, parsed.tuple, upper);
				if (!satisfied) break;
				continue;
			}
			const comparatorResult = satisfiesComparator(installed, comparator);
			if (comparatorResult == null) continue;
			sawKnownComparator = true;
			sawAnyKnownComparator = true;
			if (!comparatorResult) {
				satisfied = false;
				break;
			}
		}
		if (sawKnownComparator && satisfied) return true;
	}
	return sawAnyKnownComparator ? false : null;
}

function dependencyState(rootDir, pkg, name, packageManagerName) {
	const declaredVersion = declaredDependencyVersion(pkg, name);
	const declared = declaredVersion != null;
	const localPath = localDependencyPath(rootDir, name);
	// Do not require `.pnp.cjs` here: it is executable project code. The
	// dependency preflight is an inspection gate, so Yarn PnP installs fail closed
	// as declared-not-installed unless normal package.json resolution works.
	void packageManagerName;
	const resolvedPath = existsSync(localPath)
		? localPath
		: resolvedDependencyPath(rootDir, name);
	const installed = resolvedPath != null;
	const installedPackage = resolvedPath ? readPackageJson(resolvedPath) : null;
	const installedVersion = installedPackage?.version ?? null;
	let status = "missing";
	if (declared && installed) status = "ok";
	else if (declared) status = "declared-not-installed";
	else if (installed) status = "installed-not-declared";
	const satisfiesDeclared = satisfiesDeclaredRange(
		installedVersion,
		declaredVersion,
	);
	if (status === "ok" && satisfiesDeclared === false) {
		status = "version-mismatch";
	}
	return {
		name,
		declared,
		installed,
		status,
		declaredVersion,
		installedVersion,
		installedPackage,
	};
}

function markPairMismatch(dependencies, leftName, rightName) {
	const left = dependencies.get(leftName);
	const right = dependencies.get(rightName);
	if (left?.status !== "ok" || right?.status !== "ok") return;
	if (
		majorVersion(left.installedVersion) != null &&
		majorVersion(right.installedVersion) != null &&
		majorVersion(left.installedVersion) !== majorVersion(right.installedVersion)
	) {
		right.status = "version-mismatch";
	}
}

function markVitestProviderMismatch(dependencies, providerName) {
	const vitest = dependencies.get("vitest");
	const provider = dependencies.get(providerName);
	if (vitest?.status !== "ok" || provider?.status !== "ok") return;
	const peerRange = provider.installedPackage?.peerDependencies?.vitest;
	if (typeof peerRange === "string") {
		if (satisfiesDeclaredRange(vitest.installedVersion, peerRange) === false) {
			provider.status = "version-mismatch";
		}
		return;
	}
	markPairMismatch(dependencies, "vitest", providerName);
}

function applyCompatibilityChecks(dependencies) {
	for (const provider of VITEST_COVERAGE_PROVIDERS) {
		markVitestProviderMismatch(dependencies, provider);
	}
	for (const runner of [
		"@stryker-mutator/vitest-runner",
		"@stryker-mutator/jest-runner",
	]) {
		markPairMismatch(dependencies, "@stryker-mutator/core", runner);
	}
}

const COMMAND_WRAPPERS = new Set(["cross-env", "env", "dotenv", "dotenv-cli"]);

function firstExecutableAfter(words, startIndex) {
	for (let index = startIndex; index < words.length; index += 1) {
		const word = words[index];
		if (word === "--") continue;
		if (word.startsWith("-")) continue;
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
		return word.split("/").at(-1);
	}
	return null;
}

function commandExecutableTokens(command) {
	const tokens = [];
	for (const line of command.split(/\n+/)) {
		for (const segment of line.split(/\s*(?:&&|\|\||;|\|)\s*/)) {
			const words = segment.trim().split(/\s+/).filter(Boolean);
			while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
			const first = words[0];
			if (!first) continue;
			if (["npm", "pnpm", "bun"].includes(first)) {
				const second = words[1];
				if (
					(first === "npm" && ["exec", "x"].includes(second)) ||
					(["pnpm", "bun"].includes(first) &&
						["exec", "x", "dlx"].includes(second))
				) {
					const executable = firstExecutableAfter(words, 2);
					if (executable) tokens.push(executable);
				} else if (["pnpm", "bun"].includes(first) && second !== "run") {
					const executable = firstExecutableAfter(words, 1);
					if (
						executable &&
						!["test", "start", "stop", "restart"].includes(executable)
					) {
						tokens.push(executable);
					}
				}
				continue;
			}
			if (["npx", "bunx"].includes(first)) {
				const executable = firstExecutableAfter(words, 1);
				if (executable) tokens.push(executable);
				continue;
			}
			if (first === "yarn") {
				const yarnExecutable = words[1] === "run" ? null : words[1];
				if (yarnExecutable) tokens.push(yarnExecutable.split("/").at(-1));
				continue;
			}
			if (COMMAND_WRAPPERS.has(first)) {
				const executable = firstExecutableAfter(words, 1);
				if (executable) tokens.push(executable);
				continue;
			}
			tokens.push(first.split("/").at(-1));
		}
	}
	return tokens;
}

function inferRunner(command) {
	if (!command) return null;
	for (const token of commandExecutableTokens(command)) {
		if (token === "vitest") return "vitest";
		if (token === "jest") return "jest";
	}
	return null;
}

function delegatedScriptNames(command) {
	if (!command) return [];
	const names = [];
	const patterns = [
		/\b(?:npm|pnpm|bun)\s+run\s+([\w:.-]+)/g,
		/\b(?:npm|pnpm|bun)\s+(test|start|stop|restart)\b/g,
		/\byarn\s+(?:run\s+)?([\w:.-]+)/g,
	];
	for (const pattern of patterns) {
		for (const match of command.matchAll(pattern)) {
			if (match[1] && match[1] !== "run") names.push(match[1]);
		}
	}
	return names;
}

function expandedScriptCommand(pkg, command, seen = new Set()) {
	const scripts = pkg.scripts ?? {};
	const parts = [command];
	for (const scriptName of delegatedScriptNames(command)) {
		if (seen.has(scriptName)) continue;
		seen.add(scriptName);
		const script = scripts[scriptName];
		if (typeof script !== "string") continue;
		parts.push(expandedScriptCommand(pkg, script, seen));
	}
	return parts.join("\n");
}

function packageManagerFromField(pkg) {
	if (typeof pkg.packageManager !== "string") return null;
	const name = pkg.packageManager.split("@")[0];
	return ["pnpm", "yarn", "bun", "npm"].includes(name) ? name : null;
}

export function detectPackageManager(rootDir, pkg) {
	const lockManagers = [
		...new Set(
			PACKAGE_MANAGER_LOCKFILES.filter(({ file }) =>
				existsSync(join(rootDir, file)),
			).map(({ name }) => name),
		),
	];
	const metadataManagers = [
		...new Set(
			WORKSPACE_METADATA.filter(({ file }) =>
				existsSync(join(rootDir, file)),
			).map(({ name }) => name),
		),
	];
	const packageManager = packageManagerFromField(pkg);
	const problems = [];
	if (lockManagers.length > 1) {
		problems.push(
			`multiple lockfile package managers: ${lockManagers.join(", ")}`,
		);
	}
	if (metadataManagers.length > 1) {
		problems.push(
			`multiple workspace metadata package managers: ${metadataManagers.join(", ")}`,
		);
	}
	if (
		packageManager &&
		lockManagers.length > 0 &&
		!lockManagers.includes(packageManager)
	) {
		problems.push(
			`packageManager (${packageManager}) disagrees with lockfile (${lockManagers.join(", ")})`,
		);
	}
	if (
		packageManager &&
		metadataManagers.length > 0 &&
		!metadataManagers.includes(packageManager)
	) {
		problems.push(
			`packageManager (${packageManager}) disagrees with workspace metadata (${metadataManagers.join(", ")})`,
		);
	}
	if (
		lockManagers.length > 0 &&
		metadataManagers.length > 0 &&
		!metadataManagers.some((manager) => lockManagers.includes(manager))
	) {
		problems.push(
			`lockfile (${lockManagers.join(", ")}) disagrees with workspace metadata (${metadataManagers.join(", ")})`,
		);
	}
	return {
		manager: lockManagers[0] ?? packageManager ?? metadataManagers[0] ?? "npm",
		lockManagers,
		packageManager,
		metadataManagers,
		problems,
	};
}

function coveragePlan(
	rootDir,
	pkg,
	overrideCommand,
	packageManagerName = null,
) {
	const scripts = pkg.scripts ?? {};
	const runCommand = (scriptName) =>
		`${packageManagerName ?? detectPackageManager(rootDir, pkg).manager} run ${scriptName}`;
	if (overrideCommand) {
		return {
			command: overrideCommand,
			source: "override",
			script: null,
			runner: inferRunner(expandedScriptCommand(pkg, overrideCommand)),
		};
	}
	if (typeof scripts["test:coverage"] === "string") {
		const script = scripts["test:coverage"];
		return {
			command: runCommand("test:coverage"),
			source: "script:test:coverage",
			script,
			runner: inferRunner(expandedScriptCommand(pkg, script)),
		};
	}
	if (typeof scripts.coverage === "string") {
		const script = scripts.coverage;
		return {
			command: runCommand("coverage"),
			source: "script:coverage",
			script,
			runner: inferRunner(expandedScriptCommand(pkg, script)),
		};
	}
	if (existsSync(join(rootDir, "node_modules", ".bin", "vitest"))) {
		return {
			command: [
				"./node_modules/.bin/vitest run --coverage",
				"--coverage.reporter=json --coverage.reporter=text-summary",
			].join(" "),
			source: "local-bin:vitest",
			script: null,
			runner: "vitest",
		};
	}
	if (existsSync(join(rootDir, "node_modules", ".bin", "jest"))) {
		return {
			command: [
				"./node_modules/.bin/jest --coverage",
				"--coverageReporters=json --passWithNoTests",
			].join(" "),
			source: "local-bin:jest",
			script: null,
			runner: "jest",
		};
	}
	return null;
}

function missingVitestCoverageProviders(dependencies) {
	const hasProvider = VITEST_COVERAGE_PROVIDERS.some(
		(name) => dependencies.get(name)?.status === "ok",
	);
	return hasProvider ? [] : VITEST_COVERAGE_PROVIDERS;
}

const STRYKER_CONFIG_FILES = [
	"stryker.conf.json",
	"stryker.conf.js",
	"stryker.conf.cjs",
	"stryker.conf.mjs",
	"stryker.config.json",
	"stryker.config.js",
	"stryker.config.cjs",
	"stryker.config.mjs",
];

function detectStrykerConfig(rootDir) {
	for (const file of STRYKER_CONFIG_FILES) {
		const path = join(rootDir, file);
		if (!existsSync(path)) continue;
		const text = readFileSync(path, "utf8");
		if (file.endsWith(".json")) {
			try {
				const config = JSON.parse(text);
				return {
					present: true,
					valid: true,
					runner: config.testRunner ?? null,
				};
			} catch {
				return { present: true, valid: false, runner: null };
			}
		}
		const match = text.match(/testRunner\s*:\s*["'](vitest|jest)["']/);
		return { present: true, valid: true, runner: match?.[1] ?? null };
	}
	return { present: false, valid: false, runner: null };
}

function missingMutationPackages(rootDir, dependencies, runner) {
	const missing = [];
	if (dependencies.get("@stryker-mutator/core")?.status !== "ok") {
		missing.push("@stryker-mutator/core");
	}
	const config = detectStrykerConfig(rootDir);
	if (!config.present || !config.valid) missing.push("stryker config");
	const mutationRunner = ["vitest", "jest"].includes(config.runner)
		? config.runner
		: runner;
	const requiredRunners = [];
	if (mutationRunner === "vitest") {
		requiredRunners.push("@stryker-mutator/vitest-runner");
	} else if (mutationRunner === "jest") {
		requiredRunners.push("@stryker-mutator/jest-runner");
	} else {
		const hasAnyRunner = [
			"@stryker-mutator/vitest-runner",
			"@stryker-mutator/jest-runner",
		].some((name) => dependencies.get(name)?.status === "ok");
		if (!hasAnyRunner) {
			requiredRunners.push(
				"@stryker-mutator/vitest-runner",
				"@stryker-mutator/jest-runner",
			);
		}
	}
	for (const name of requiredRunners) {
		if (dependencies.get(name)?.status !== "ok") missing.push(name);
	}
	return missing;
}

export function inspectDependencyPreflight(
	rootDir,
	pkg,
	{ coverageCommand = null, noCoverage = false } = {},
) {
	const packageManager = detectPackageManager(rootDir, pkg);
	const plan = noCoverage
		? null
		: coveragePlan(rootDir, pkg, coverageCommand, packageManager.manager);
	const dependencyNames = new Set([
		"typescript",
		"vitest",
		"jest",
		...VITEST_COVERAGE_PROVIDERS,
		...STRYKER_PACKAGES,
	]);
	const dependencies = new Map(
		[...dependencyNames].map((name) => [
			name,
			dependencyState(rootDir, pkg, name, packageManager.manager),
		]),
	);
	applyCompatibilityChecks(dependencies);
	const missingCoverage = [];
	if (plan?.runner === "vitest") {
		if (dependencies.get("vitest")?.status !== "ok") {
			missingCoverage.push("vitest");
		}
		missingCoverage.push(...missingVitestCoverageProviders(dependencies));
	} else if (plan?.runner === "jest") {
		if (dependencies.get("jest")?.status !== "ok") missingCoverage.push("jest");
	}
	return {
		packageManager,
		coverage: {
			plan,
			missing: missingCoverage,
		},
		mutation: {
			missing: missingMutationPackages(
				rootDir,
				dependencies,
				plan?.runner ?? null,
			),
		},
		dependencies,
	};
}

export function formatDependencyPreflight(preflight) {
	const lines = ["Dependency Preflight", "===================="];
	const pm = preflight.packageManager;
	lines.push(`package manager: ${pm.manager}`);
	for (const problem of pm.problems) {
		lines.push(`package manager warning: ${problem}`);
	}
	lines.push("coverage:");
	if (!preflight.coverage.plan) {
		lines.push("  command: none detected");
	} else {
		const { command, source, script, runner } = preflight.coverage.plan;
		lines.push(`  command: ${command} (${source})`);
		if (script) lines.push(`  script: ${script}`);
		lines.push(`  runner: ${runner ?? "unknown"}`);
	}
	for (const name of [
		"typescript",
		"vitest",
		"jest",
		...VITEST_COVERAGE_PROVIDERS,
	]) {
		const dep = preflight.dependencies.get(name);
		if (dep) lines.push(`  - ${name}: ${dep.status}`);
	}
	if (preflight.coverage.missing.length > 0) {
		lines.push(
			`  coverage gate: missing ${preflight.coverage.missing.join(", ")}; coverage will be N/A`,
		);
	}
	lines.push("mutation:");
	for (const name of STRYKER_PACKAGES) {
		const dep = preflight.dependencies.get(name);
		if (dep) lines.push(`  - ${name}: ${dep.status}`);
	}
	if (preflight.mutation.missing.length > 0) {
		lines.push(
			"  mutation gate: unavailable; do not claim mutation testing passed",
		);
	}
	return `${lines.join("\n")}\n`;
}

export function detectCoverageCommand(rootDir, pkg) {
	const packageManager = detectPackageManager(rootDir, pkg);
	return (
		coveragePlan(rootDir, pkg, null, packageManager.manager)?.command ?? null
	);
}

function runCoverage(
	rootDir,
	pkg,
	overrideCommand,
	stderr = process.stderr,
	preflight = inspectDependencyPreflight(rootDir, pkg, {
		coverageCommand: overrideCommand,
	}),
) {
	const command = preflight.coverage.plan?.command ?? null;
	if (preflight.packageManager.problems.length > 0) {
		stderr.write(formatDependencyPreflight(preflight));
		stderr.write(
			"crap4ts: package-manager preflight failed; ask before changing lockfiles or package metadata\n",
		);
		return null;
	}
	if (!command) {
		stderr.write(
			"crap4ts: no coverage runner found (test:coverage script, vitest, or jest); reporting coverage as N/A\n",
		);
		return null;
	}
	if (preflight.coverage.missing.length > 0) {
		stderr.write(formatDependencyPreflight(preflight));
		stderr.write(
			"crap4ts: coverage preflight failed; reporting coverage as N/A instead of running an under-provisioned runner\n",
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
		stderr.write(
			`crap4ts: coverage command failed to start: ${result.error.message}\n`,
		);
		return null;
	}
	if (result.status !== 0) {
		stderr.write(
			`crap4ts: coverage command exited ${result.status}; using artifacts anyway\n`,
		);
	}
	const finalPath = join(coverageDir, "coverage-final.json");
	if (!existsSync(finalPath)) {
		stderr.write(
			`crap4ts: ${finalPath} not found; reporting coverage as N/A (the command must produce coverage/coverage-final.json)\n`,
		);
		return null;
	}
	try {
		return parseCoverageData(JSON.parse(readFileSync(finalPath, "utf8")));
	} catch (error) {
		stderr.write(
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

function changedFiles(rootDir, stderr = process.stderr) {
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
		stderr.write("crap4ts: --changed requires origin/main or origin/master\n");
		return null;
	}
	const mergeBase = spawnSync("git", ["merge-base", base, "HEAD"], {
		cwd: rootDir,
	});
	if (mergeBase.status !== 0 || !mergeBase.stdout?.toString().trim()) {
		stderr.write(`crap4ts: git merge-base ${base} HEAD failed\n`);
		return null;
	}
	const diff = spawnSync(
		"git",
		["diff", "--name-only", mergeBase.stdout.toString().trim()],
		{
			cwd: rootDir,
		},
	);
	if (diff.status !== 0) {
		stderr.write("crap4ts: git diff --name-only failed\n");
		return null;
	}
	const filterSourceLines = (lines) =>
		lines.filter(
			(line) =>
				line.length > 0 &&
				SOURCE_EXTENSIONS.has(extname(line)) &&
				// Apply the same directory exclusions as collectSourceFiles so
				// generated code (dist/, build/) under excluded dirs cannot trip
				// the changed-only report or --fail-over.
				!line.split("/").some((seg) => EXCLUDED_DIRS.has(seg)) &&
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
		stderr.write("crap4ts: git ls-files --others failed\n");
		return null;
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

function selectSourceFiles(rootDir, useChanged, stderr) {
	return useChanged
		? changedFiles(rootDir, stderr)
		: collectSourceFiles(rootDir);
}

function printUsage(stdout = process.stdout) {
	stdout.write(`usage: crap4ts.mjs [options] [path-fragment ...]

Analyzes JavaScript/TypeScript source and reports CRAP scores
(CRAP = CC^2 x (1 - coverage)^3 + CC), worst first.

options:
  --help                 print this usage
  --changed              analyze only files changed vs merge-base of origin/main (or origin/master)
  --no-coverage          skip the coverage run; report N/A for coverage and CRAP
  --coverage-command CMD run CMD instead of the detected coverage command
                         (must produce coverage/coverage-final.json)
  --preflight            print dependency preflight (coverage + mutation tooling) and exit
  --fail-over N          exit 2 when any CRAP score exceeds N
  path fragments         analyze only files whose relative path contains any fragment

exit codes: 0 ok, 1 usage error, 2 threshold exceeded
`);
}

export function parseCliArgs(args) {
	let failOver = null;
	let useChanged = false;
	let noCoverage = false;
	let coverageCommand = null;
	let preflightOnly = false;
	const fragments = [];

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			return { kind: "help" };
		}
		if (arg === "--fail-over") {
			failOver = Number(args[i + 1]);
			if (!Number.isFinite(failOver)) {
				return {
					kind: "error",
					message: "crap4ts: --fail-over requires a numeric argument\n",
				};
			}
			i += 1;
		} else if (arg === "--changed") {
			useChanged = true;
		} else if (arg === "--no-coverage") {
			noCoverage = true;
		} else if (arg === "--preflight") {
			preflightOnly = true;
		} else if (arg === "--coverage-command") {
			coverageCommand = args[i + 1];
			if (!coverageCommand) {
				return {
					kind: "error",
					message: "crap4ts: --coverage-command requires an argument\n",
				};
			}
			i += 1;
		} else if (arg.startsWith("--")) {
			return {
				kind: "error",
				message: `crap4ts: unknown option '${arg}'\n`,
			};
		} else {
			fragments.push(arg);
		}
	}

	return {
		kind: "run",
		failOver,
		useChanged,
		noCoverage,
		coverageCommand,
		preflightOnly,
		fragments,
	};
}

export function main(
	args = process.argv.slice(2),
	{
		rootDir = process.cwd(),
		stdout = process.stdout,
		stderr = process.stderr,
	} = {},
) {
	const cli = parseCliArgs(args);
	if (cli.kind === "help") {
		printUsage(stdout);
		return 0;
	}
	if (cli.kind === "error") {
		stderr.write(cli.message);
		return 1;
	}
	const {
		failOver,
		useChanged,
		noCoverage,
		coverageCommand,
		preflightOnly,
		fragments,
	} = cli;

	let pkg = null;
	try {
		pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
	} catch {
		stderr.write("crap4ts: run from a project root containing package.json\n");
		return 1;
	}

	const preflight = inspectDependencyPreflight(rootDir, pkg, {
		coverageCommand,
		noCoverage,
	});
	if (preflightOnly) {
		stdout.write(formatDependencyPreflight(preflight));
		return preflight.packageManager.problems.length > 0 ? 1 : 0;
	}

	let ts;
	try {
		ts = loadTypeScript(rootDir);
	} catch (error) {
		stderr.write(`crap4ts: ${error.message}\n`);
		return 1;
	}

	const files = selectSourceFiles(rootDir, useChanged, stderr);
	if (files === null) return 1;
	const filtered = fragments.length
		? files.filter((file) => {
				const rel = relative(rootDir, file).split("\\").join("/");
				return fragments.some((fragment) => rel.includes(fragment));
			})
		: files;
	if (filtered.length === 0) {
		stdout.write("crap4ts: no matching source files\n");
		return 0;
	}

	const coverageMap = noCoverage
		? null
		: runCoverage(rootDir, pkg, coverageCommand, stderr, preflight);

	const functions = [];
	for (const file of filtered) {
		const rel = relative(rootDir, file);
		try {
			const text = readFileSync(file, "utf8");
			functions.push(...analyzeSource(ts, rel, text));
		} catch (error) {
			stderr.write(`crap4ts: skipping ${rel}: ${error.message}\n`);
		}
	}

	const rows = sortRows(buildRows(functions, coverageMap, rootDir, stderr));
	stdout.write(`${formatReport(rows)}\n`);

	if (failOver != null) {
		const exceeded = evaluateThreshold(rows, failOver);
		if (exceeded.length > 0) {
			stderr.write(
				`crap4ts: ${exceeded.length} function(s) exceed CRAP ${failOver}\n`,
			);
			return 2;
		}
	}
	return 0;
}

const invokedDirectly =
	process.argv[1] &&
	pathToFileURL(process.argv[1]).href === new URL(import.meta.url).href;
if (invokedDirectly) {
	process.exitCode = main();
}
