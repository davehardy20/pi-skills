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
	cc: number;
}

/** Extracts function records (with CC) from source text using the TS compiler API. */
export function analyzeSource(
	ts: typeof import("typescript"),
	fileName: string,
	text: string,
): CrapFunction[];

/** One Istanbul statement-range entry with hit counts. */
export interface StatementRange {
	startLine: number;
	endLine: number;
	hits: number;
}

/** Absolute source path -> statement ranges (from coverage-final.json). */
export type CoverageMap = Map<string, StatementRange[]>;

/** Parses Istanbul coverage-final.json data into a CoverageMap. */
export function parseCoverageData(data: Record<string, unknown>): CoverageMap;

/**
 * Fraction of statements overlapping the function's line range that were hit.
 * Returns null when no statements overlap (reported as N/A).
 */
export function functionCoverage(
	fn: Pick<CrapFunction, "startLine" | "endLine">,
	statements: StatementRange[] | null | undefined,
): number | null;

/** Matches a source path against coverage, with unique path-suffix fallback. */
export function matchStatements(
	absoluteFilePath: string,
	coverageMap: CoverageMap,
): StatementRange[] | null;

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
