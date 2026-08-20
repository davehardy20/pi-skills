# pi-skills

Local Pi skills package for Dave's workflow.

## Skills

- `code-review` — reviews changes on independent Standards and Seeds-backed
  Intent axes, then returns actionable findings directly to the parent agent
  without writing review outcomes back to Seeds.
- `codex-pr-comment` — reads Codex connector PR review comments,
  checks unresolved non-outdated review threads, implements required fixes, and
  reports validation.
- `seeds-architecture-review` — adapts architecture deepening reviews into a Seeds-native workflow with:
  - local supplemental guides for language, deepening, HTML reports, and interface design;
  - optional `ask_user` checkpoints;
  - candidate-specific Seeds plans;
  - validation, review, and PR-first closeout;
  - post-outcome Mulch only when justified.
- `seeds-issue-audit` — audits open Seeds issues using verified completion
  evidence, reports uncertainty by default, and requires explicit authorization
  before closing high-confidence findings.
- `humanizer` — removes common AI-writing patterns while preserving meaning,
  tone, and voice.
- `teach` — builds stateful learning workspaces with missions, trusted
  resources, short HTML lessons, references, and learning records.
- `writing-great-skills` — explains the vocabulary and principles for writing
  predictable, maintainable Pi skills.
- `opsec-framework-doc` — creates structured OpSec procedure documents from
  notes, research, existing Markdown, and script-heavy procedures, with
  archive/history safety and TypeScript document-management helpers.
- `post-merge` — runs PR post-merge closeout for Pi/Seeds repos, including
  merge verification, local branch updates, Seeds follow-up handling, and
  cleanup reporting.
- `thermo-nuclear-code-quality-review` — runs an intentionally strict
  maintainability review for abstraction quality, file sprawl, spaghetti
  branching, and missed simplification opportunities.
- `crap4ts` — CRAP metric (Change Risk Anti-Pattern,
  `CC² × (1 − coverage)³ + CC`) for JavaScript/TypeScript: runs the target
  project's Istanbul coverage, extracts cyclomatic complexity via the
  TypeScript compiler API, and reports the worst functions first with a
  `--fail-over` quality-gate exit code. Lineage: crap4j → crap4clj →
  crap4go → crap4java → crap4ts.

## Attribution

`seeds-architecture-review` is inspired by
[Matt Pocock's Skills For Real Engineers](https://github.com/mattpocock/skills),
especially his `improve-codebase-architecture` and `grill-with-docs` skills.
This package adapts those ideas into Dave's Seeds-first Pi workflow and does not
vendor or depend on the original skills.

`teach` is adapted from Matt Pocock's MIT-licensed `teach` skill in
[Skills For Real Engineers](https://github.com/mattpocock/skills). This package
preserves the stateful teaching workspace model and adapts it for Pi workflows.

`writing-great-skills` is adapted from Matt Pocock's MIT-licensed
`writing-great-skills` skill in
[Skills For Real Engineers](https://github.com/mattpocock/skills). This package
keeps the skill name and its disclosed glossary reference. See
`skills/productivity/writing-great-skills/ATTRIBUTION.md` for the bundled MIT
notice.

`code-review` is adapted from Matt Pocock's MIT-licensed `code-review` skill
in [Skills For Real Engineers](https://github.com/mattpocock/skills). It replaces
the generic spec axis with read-only Seeds-backed Intent review and preserves
the upstream MIT notice in `skills/engineering/code-review/ATTRIBUTION.md`.

`seeds-issue-audit` is adapted from Jaymin West's MIT-licensed
`seeds-issue-audit` skill. It replaces raw tracker/Git commands with Pi safe
wrappers and preserves the upstream MIT notice in
`skills/engineering/seeds-issue-audit/ATTRIBUTION.md`.

`humanizer` is based on
[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
maintained by WikiProject AI Cleanup.

`humanizer` and `thermo-nuclear-code-quality-review` were ported from Dave's
local `~/.pi/agent/skills/` directory into this package so `pi install
/Users/dave/tools/pi-skills` can manage them together.

`crap4ts` independently implements the unclebob CRAP metric formula for
JavaScript/TypeScript, modeled on the CRAP metric family (`crap4j` by
Alberto Savoia and Robert C. Martin, plus `crap4clj`, `crap4go`, and
`crap4java`). See
`skills/engineering/crap4ts/ATTRIBUTION.md` for the full lineage and
formula source.

`opsec-framework-doc` was ported from Dave's OpenCode skill in
`~/Desktop/opsec-framework-doc`. The Pi port preserves the template, sample
script references, and workflow behavior while splitting long guidance into
progressive-disclosure references.

## Install locally

From any Pi session:

```bash
pi install /Users/dave/tools/pi-skills
```

Or load temporarily for one run:

```bash
pi -e /Users/dave/tools/pi-skills
```

Pi discovers skills through the package manifest:

```json
{
  "pi": {
    "skills": ["./skills"]
  }
}
```

## Use

Invoke directly:

```text
/skill:seeds-architecture-review review the checkout flow architecture
```

```text
/skill:code-review review this branch against its active Seeds issue
```

```text
/skill:teach help me learn Rust for building internal CLIs
```

```text
/skill:writing-great-skills help me review this skill's information hierarchy
```

```text
/skill:post-merge PR 123 was merged; close out the Seeds work
```

```text
/skill:codex-pr-comment PR 120 has a Codex review comment; read it and implement if required
```

```text
/skill:opsec-framework-doc create an OpSec guide from these engagement notes
```

```text
/skill:crap4ts run a CRAP report on src/ and pick the riskiest function
```

Or ask naturally for skill-covered work. `seeds-architecture-review` is intended for repository work
where an agent should inspect Seeds, produce candidate reports, use decision checkpoints, create a
candidate-specific Seeds plan, and open a PR before treating implementation as complete.

## Expected target-repo mutations

The package skills are conservative about writes:

- `code-review` reads Seeds and repository evidence but never mutates them; its
  findings return to the parent agent, which owns remediation and validation.

- `seeds-architecture-review` does not edit implementation code during exploration/reporting;
  `CONTEXT.md` is glossary-only, ADRs are offered only for durable trade-offs, Seeds becomes the
  execution state after candidate selection, and PR-first closeout applies.
- `opsec-framework-doc` may create or update Markdown documentation, copy originals into
  timestamped `archive/` paths before merge/overwrite/amend operations, extract code blocks into
  documented script files, and update Document History. It treats bundled sample scripts as
  reference assets and defaults to syntax/static validation rather than execution.
- Mulch is recorded only after a validated successful outcome.
- Repository implementation work should happen on a feature branch with PR-first closeout when the
  repository supports it.

## Validation

This package has no runtime dependencies. Basic local checks:

```bash
npm run validate:skills
npm test
npm run typecheck
```

`validate:skills` parses `package.json`, checks skill frontmatter names/descriptions, enforces
unique skill names, and verifies local Markdown links. The TypeScript helper tests use Vitest.

Pi safe-runner equivalents:

- `run_vitest test/opsec-document-manager.test.ts`;
- `run_typecheck` with `tsconfig.json`;
- `run_biome src test skills/engineering/opsec-framework-doc/scripts/document-manager.ts`.

Mutation gate (Stryker, scoped via `stryker.config.json`):

```bash
npm run mutation
```

Reports land in `reports/mutation/` (gitignored); the run exits non-zero if the
mutation score drops below the `thresholds.break` floor (currently 49,
just under the present 49.56 baseline) in `stryker.config.json`.
