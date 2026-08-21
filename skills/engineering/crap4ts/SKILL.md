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
    and Bob Evans), modeled on the later workflow ports by Robert C. Martin:
    unclebob/crap4clj, crap4go, and crap4java. See ATTRIBUTION.md.
---

# crap4ts — CRAP Metric for JavaScript/TypeScript

## Lineage

CRAP was introduced as **Change Risk Analysis and Prediction** and later
reframed by crap4j as **Change Risk Anti-Patterns**. Its formula,
`CC² × (1 − coverage)³ + CC`, was developed by Alberto Savoia with his
AgitarLabs colleague Bob Evans. Robert C. Martin later implemented and
popularized the workflow through his language-specific ports. CRAP is not from
*Clean Code* itself; the book teaches the discipline the metric supports:

- **McCabe (1976)** — cyclomatic complexity, the CC term.
- **Feathers, *Working Effectively with Legacy Code*** — characterization
  tests, the safety net the workflow below depends on.
- **Savoia & Evans (crap4j)** — the formula: coverage as the counterweight
  that makes untested complexity compound.
- **Martin (crap4clj, crap4go, crap4java)** — the modern language-port workflow.
- **Martin, *Clean Code* (Ch 3, 9, 14, 17)** — small functions, the
  negative-indicator view of coverage ("low coverage proves you cannot change
  the code safely"), successive refinement, and smells.

The implementation lineage is crap4j → crap4clj → crap4go → crap4java;
crap4ts follows the same pipeline: delete stale coverage, run coverage,
analyze, report worst-first.

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

## Dependency Preflight

This is an agent-run, consent-gated preflight. `crap4ts.mjs` remains
analysis-only and must never install dependencies. Before running coverage or
mutation testing, inspect the target repository rather than assuming packages
are available:

1. Detect its package manager from the lockfile (`pnpm`, `yarn`, `bun`, else
   `npm`).
2. Check both the manifest and local module resolution for:
   - `typescript` plus an existing coverage runner;
   - the coverage provider required by that runner (for Vitest, commonly
     `@vitest/coverage-v8` or `@vitest/coverage-istanbul`, compatible with the
     installed Vitest version);
   - `@stryker-mutator/core` plus the matching local test-runner plugin and a
     usable Stryker configuration for a function-improvement pass.
3. Report the exact missing or incompatible dev dependencies before mutation.

**Ask Dave before installing** or changing `package.json`, a lockfile, scripts, or
configuration. After approval, install compatible dev dependencies with the
target repository's package manager, inspect the manifest/lockfile diff, then
rerun the preflight. Never satisfy the check with a global Stryker install.

For report-only CRAP use, installation may be declined and `--no-coverage` may
still produce a useful N/A report. Once Dave opts into a function-improvement
pass, mutation testing is required before refactoring. If its local tooling is
not authorized, mark mutation unavailable, never claim the gate passed, and
defer the refactor.

## Recommended Workflow

CRAP and mutation testing answer different questions: CRAP finds structurally
risky change surfaces; mutation testing checks whether tests observe behavioral
changes. Their rankings may disagree. That disagreement identifies the lever:
reduce complexity in high-CRAP functions, or strengthen observations where
covered mutants survive.

Report-only use stops after triage. Steps 2–6 apply only after Dave opts into a
function-improvement pass; mutation testing is required within that pass.

1. **Triage** — run `crap4ts.mjs path/fragment`, then pick one function using
   its score plus engineering judgment.
2. **Optional handoff** — when Dave chooses to improve that function, create one
   plain Seeds issue with its baseline and acceptance criteria.
3. **Characterize** — add tests that capture current observable behavior
   (Feathers).
4. **Mutation-check** — run the required, file-scoped Stryker check and follow
   the feedback loop below until the safety net is credible.
5. **Refactor** — reduce the selected function's complexity (Ch 3), one function
   per pass.
6. **Verify and close** — rerun CRAP, mutation testing, and the normal suite.
   Close only when CRAP fell for the intended reason, the mutation floor held,
   no meaningful survivor regressed, and the suite is green.

One function per pass — Ch 12's simple-design discipline, not batch refactors.

## Optional Seeds Handoff

CRAP reporting remains read-only by default. Do not create issues merely because
a report contains high scores. When Dave selects a function for improvement,
create one plain Seeds issue and record before/after values for:

- function, file, CC, statement coverage, and CRAP;
- headline mutation score and covered-only score;
- no-coverage count and selected-function survivor count;
- important survivor dispositions, new timeouts, and equivalent-mutant
  rationales;
- acceptance criteria for CRAP, mutation behavior, and the normal suite.

Use a plain issue for one function. Escalate **Multi-function or multi-module**
campaigns, including `--fail-over` breaches spanning functions, to a Seeds
plan. When structure is the problem and CRAP is only the symptom, use
`seeds-architecture-review`.

## Mutation Feedback Loop

Use a target-repository Stryker installation and scope mutation to the chosen
file. Inspect the selected function's mutants rather than relying only on the
file-level score:

- **No coverage** — return to characterization; tests never reached that code.
- **Covered survivor** — strengthen observations or assertions, then rerun
  mutation.
- **Equivalent** — demonstrate identical observable behavior for the relevant
  input domain and record the rationale.
- **Killed** — the tested behavior is mutation-protected.

Do not refactor until this loop produces a credible safety net, and do not chase
100%. Equivalent mutants require judgment; never dismiss regex, string, or
boundary mutants as cosmetic without evidence.

Record two measurements:

- the **headline mutation score**, which includes no-coverage mutants and is what
  Stryker's `thresholds.break` gates;
- the **covered-only score**, which helps assess assertion strength.

A whole-file percentage can remain stable while an important mutant in changed
behavior begins surviving. Closure therefore requires the target function's
meaningful survivor set to hold, not merely the aggregate percentage.

Treat `thresholds.break` as a repository-specific regression floor, not a
universal target. Run a baseline in the **target repository**, set the floor just
below its headline score, and ratchet upward only after verified improvement.
**Never copy** another repository's numeric threshold.

If Stryker is unavailable and adding it is not authorized, record mutation as
unavailable and do not claim the mutation gate passed. Characterization may
continue, but the function-improvement pass cannot advance to refactoring or
closure.

## Environment Notes

- Prefer trusted runners (`run_vitest`) for the coverage step when available;
  fall back to the script's detected command only when a coverage script already
  exists.
- Ask Dave before running a full coverage or mutation suite in large repos;
  suggest `--changed` for CRAP and a single-file mutation scope.
- Use per-repository dev dependencies (`@stryker-mutator/core` plus the matching
  test-runner plugin), never a global Stryker install. Ask before adding
  dependencies or configuration to a target repository.
- Document the portable config shape (`stryker.config.json` plus the local
  mutation script), not this repository's numeric threshold.
- Path handling (coverage fallback, `--changed` filtering) is POSIX-only;
  Windows paths are unsupported.
- Use `--fail-over N` as a CI or quality-gate closeout check (exit 2 on
  breach, mirroring crap4java's exit-code gate). N/A-coverage rows never breach
  the gate; pair it with a coverage-required check when that matters.
