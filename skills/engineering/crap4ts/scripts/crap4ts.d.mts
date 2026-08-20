// Type declarations for skills/engineering/crap4ts/scripts/crap4ts.mjs.
// The analyzer is shipped as plain ESM JavaScript so it runs on any Node
// project with zero transpilation; these declarations exist so the repo's
// `npm run typecheck` covers its exported API surface.

/** File extensions treated as analyzable source by crap4ts. */
export const SOURCE_EXTENSIONS: Set<string>;

/** Directory names excluded from source discovery. */
export const EXCLUDED_DIRS: Set<string>;

/** True when a file name matches generated/config/test patterns. */
export function shouldExcludeFile(fileName: string): boolean;

/**
 * CRAP = CC^2 x (1 - coverage)^3 + CC (crap4j formula).
 * Returns null when coverage is unknown (reported as N/A).
 */
export function computeCrap(cc: number, coverage: number | null): number | null;

/** A function extracted from a source file, with its cyclomatic complexity. */
export interface CrapFunction {
	name: string;
	file: string;
	startLine: number;
	endLine: number;
	/** Istanbul-style span (1-based line, 0-based column). */
	start: { line: number; column: number };
	end: { line: number; column: number };
	cc: number;
}

/** Extracts function records (with CC) from source text using the TS compiler API. */
export function analyzeSource(
	ts: typeof import("typescript"),
	fileName: string,
	text: string,
): CrapFunction[];

/** One Istanbul statement-range entry with hit counts and columns. */
export interface StatementRange {
	startLine: number;
	endLine: number;
	startColumn?: number;
	endColumn?: number;
	hits: number;
}

/** One Istanbul fnMap declaration range (0-based columns). */
export interface FunctionSpan {
	/** Columns may be null in real Istanbul fnMap data. */
	start: { line: number; column: number | null };
	end: { line: number; column: number | null };
	/** Istanbul fnMap hit count (cov.f); null when absent. Hand-built
	 * spans may omit it. */
	hits?: number | null;
}

/** Absolute source path -> statements plus function declaration spans. */
export type CoverageMap = Map<
	string,
	{
		statements: StatementRange[];
		functions: FunctionSpan[];
	}
>;

/** Parses Istanbul coverage-final.json data into a CoverageMap. */
export function parseCoverageData(data: Record<string, unknown>): CoverageMap;

/**
 * Fraction of statements fully contained in the function's own span that
 * were hit. Enclosing statements (marked hit by module load) and statements
 * owned by nested functions are excluded. When no statements apply, falls
 * back to the function's own fnMap hit count (1/0); returns null only when
 * that is also unknown (reported as N/A).
 */
export function functionCoverage(
	fn: Pick<CrapFunction, "startLine" | "endLine" | "start" | "end">,
	statements: StatementRange[] | null | undefined,
	fileFunctions?: FunctionSpan[],
): number | null;

/**
 * fnMap loc spans that ARE the given function: end line matches with
 * column tolerance (Istanbul ends are inclusive, columns may be null) and
 * start is no earlier than the TS span start (TS spans include modifiers/
 * decorators). With several qualifying locs (curried arrows), the
 * earliest-start one is the function's own.
 */
export function ownFunctionSpans(
	fn: Pick<CrapFunction, "start" | "end">,
	fileFunctions: FunctionSpan[],
): FunctionSpan[];

/** Matches a source path against coverage, with unique path-suffix fallback. */
export function matchStatements(
	absoluteFilePath: string,
	coverageMap: CoverageMap,
): { statements: StatementRange[]; functions: FunctionSpan[] } | null;

/** One report row: CRAP score and inputs for a function. */
export interface CrapRow {
	name: string;
	file: string;
	cc: number;
	coverage: number | null;
	crap: number | null;
}
/**
 * Picks the coverage command for a project: `test:coverage` script, else
 * `coverage` script, else local vitest, else local jest. Null when none exist.
 */
export function detectCoverageCommand(
	rootDir: string,
	pkg: { scripts?: Record<string, unknown> },
): string | null;

export function buildRows(
	functions: CrapFunction[],
	coverageMap: CoverageMap | null,
	rootDir: string,
): CrapRow[];

/** Sorts rows worst CRAP first; N/A coverage at the bottom. */
export function sortRows(rows: CrapRow[]): CrapRow[];

/** Formats rows as the fixed-width CRAP Report table. */
export function formatReport(rows: CrapRow[]): string;

/** Rows whose CRAP score exceeds the threshold (used by --fail-over). */
export function evaluateThreshold(
	rows: CrapRow[],
	threshold: number,
): CrapRow[];
