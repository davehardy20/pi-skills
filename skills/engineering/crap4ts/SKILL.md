---
name: crap4ts
description: >-
  Use when Dave asks for a CRAP report, cyclomatic complexity + coverage risk
  analysis, "what's the riskiest code to change", or before refactoring a
  JavaScript or TypeScript module. Combines cyclomatic complexity with test
  coverage to find functions that are both complex and under-tested.
metadata:
  source: >-
    Independent implementation of the CRAP formula from crap4j (Alberto Savoia
    and Robert C. Martin), modeled on the workflow of unclebob/crap4clj,
    crap4go, and crap4java. See ATTRIBUTION.md.
---

# crap4ts — CRAP Metric for JavaScript/TypeScript

## Lineage

CRAP (Change Risk Anti-Pattern) is `CC² × (1 − coverage)³ + CC`, published by
Alberto Savoia and Robert C. Martin in the crap4j project. It is not from
*Clean Code* itself; the book teaches the discipline the metric enforces:

- **McCabe (1976)** — cyclomatic complexity, the CC term.
- **Feathers, *Working Effectively with Legacy Code*** — characterization
  tests, the safety net the workflow below depends on.
- **Savoia & Martin (crap4j)** — the formula: coverage as the counterweight
  that makes untested complexity compound.
- **Martin, *Clean Code* (Ch 3, 9, 14, 17)** — small functions, the
  negative-indicator view of coverage ("low coverage proves you cannot change
  the code safely"), successive refinement, and smells.

The port lineage is crap4j → crap4clj → crap4go → crap4java; crap4ts follows
the same pipeline: delete stale coverage, run coverage, analyze, report
worst-first.

The core stance: the metric is triage for courage, not punishment. A function
with CC 12 and 45% coverage is code you do not own — CRAP finds your rental
portfolio, sorted by rent.

## Setup

Run from the target project's root (script path relative to this skill
directory):

```bash
node <skill-dir>/scripts/crap4ts.mjs
```

Zero config: it detects the package.json, wipes stale `coverage/`, runs the
project's coverage command (`test:coverage` script, else `coverage` script,
else the local vitest or jest binary with JSON coverage), then analyzes.
Requires `typescript` in the target project; the script falls back to this
skill repo's own `node_modules`. If TypeScript cannot be found the tool
exits 1 with instructions; when no coverage runner exists, coverage and CRAP
are reported as `N/A` with a stderr warning — never fabricated numbers.

## Usage

```bash
crap4ts.mjs                              # analyze all source files
crap4ts.mjs src/auth payments            # filter to path fragments
crap4ts.mjs --changed                    # only files changed vs merge-base
crap4ts.mjs --no-coverage                # skip coverage; N/A for coverage/CRAP
crap4ts.mjs --coverage-command "npm test -- --coverage"   # override runner
crap4ts.mjs --fail-over 30               # exit 2 when any CRAP exceeds 30
```

### Output

```text
CRAP Report
===========
Function                          File                              CC   Cov%     CRAP
-------------------------------------------------------------------------------------
validateTransaction               src/payments/core.ts              12   45.0%    36.0
formatAmount                      src/payments/core.ts               1  100.0%     1.0
```

## Interpreting Scores

| CRAP   | Meaning                                            |
|--------|----------------------------------------------------|
| 1–5    | Clean — low complexity, well tested                |
| 5–30   | Moderate — refactor or add tests before changing   |
| 30+    | Crappy — complex AND under-tested; highest risk    |
| N/A    | No coverage data — treat as unknown risk, not zero risk |

The N/A row carries *Clean Code* Ch 9's stance: coverage is a negative
indicator. High coverage proves little; missing coverage proves you cannot
change the code safely. When coverage is unknown, act as if it were absent.

## How It Works

1. Deletes stale `coverage/` and runs the coverage command (must produce
   `coverage/coverage-final.json`, the Istanbul JSON format).
2. Finds source files (`.js/.jsx/.ts/.tsx/.mjs/.cjs/.mts/.cts`), excluding
   `node_modules`, `dist`, `build`, `out`, `coverage`, `__tests__`,
   `*.test.*`, `*.spec.*`, `*.d.ts`, config and stories files.
3. Extracts functions, methods, accessors, constructors, and arrow functions
   with line ranges via the TypeScript compiler API. Nested functions report
   separately.
4. Computes CC = decision points + 1, counting `if`, `for`/`for-in`/`for-of`,
   `while`, `do`, `case`, `catch`, ternaries, `&&`, `||`, `??`, and their
   logical-assignment forms (`&&=`, `||=`, `??=`).
5. Maps coverage per function from `coverage-final.json` (exact path match,
   then unique path-suffix fallback like crap4go); coverage is the fraction
   of statements fully contained in the function's own span with hits > 0.
   Enclosing statements (e.g. a wrapper hit merely by module load) and
   nested-function statements (via fnMap `loc` spans) are excluded. When
   no statements apply but the function's own fnMap entry has a hit count
   (`cov.f` — concise-bodied arrows), coverage falls back to that hit
   count (1 or 0), not N/A.
6. Applies `CRAP = CC² × (1 − coverage)³ + CC`, sorts worst-first.

## Recommended Workflow

From crap4clj, grounded in *Clean Code* Ch 14 (successive refinement):

1. Run `crap4ts.mjs path/fragment`.
2. Pick the highest scoring function in the module you are changing.
3. Add characterization tests until coverage is clear enough to change the
   code safely (Feathers).
4. Refactor complex branches or split large functions (Ch 3).
5. Rerun CRAP and tests before moving to the next risky function.

One function per pass — Ch 12's simple-design discipline, not batch refactors.

## Environment Notes

- Prefer trusted runners (`run_vitest`) for the coverage step when available;
   fall back to the script's detected command only when a coverage script
   already exists.
- Ask Dave before running a full coverage suite in large repos; suggest the
   `--changed` scope instead.
- Path handling (coverage fallback, `--changed` filtering) is POSIX-only;
  Windows paths are unsupported.
- Use `--fail-over N` as a CI or quality-gate closeout check (exit 2 on
   breach, mirroring crap4java's exit-code gate). N/A-coverage rows never
   breach the gate; pair the gate with a coverage-required check when that
   matters.
