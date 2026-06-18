# pi-skills

Local Pi skills package for Dave's workflow.

## Skills

- `seeds-architecture-review` — adapts architecture deepening reviews into a Seeds-native workflow with:
  - local supplemental guides for language, deepening, HTML reports, and interface design;
  - optional `ask_user` checkpoints;
  - candidate-specific Seeds plans;
  - validation, review, and PR-first closeout;
  - post-outcome Mulch only when justified.
- `humanizer` — removes common AI-writing patterns while preserving meaning,
  tone, and voice.
- `thermo-nuclear-code-quality-review` — runs an intentionally strict
  maintainability review for abstraction quality, file sprawl, spaghetti
  branching, and missed simplification opportunities.

## Attribution

`seeds-architecture-review` is inspired by
[Matt Pocock's Skills For Real Engineers](https://github.com/mattpocock/skills),
especially his `improve-codebase-architecture` and `grill-with-docs` skills.
This package adapts those ideas into Dave's Seeds-first Pi workflow and does not
vendor or depend on the original skills.

`humanizer` is based on
[Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing),
maintained by WikiProject AI Cleanup.

`humanizer` and `thermo-nuclear-code-quality-review` were ported from Dave's
local `~/.pi/agent/skills/` directory into this package so `pi install
/Users/dave/tools/pi-skills` can manage them together.

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

Or ask naturally for a Seeds-backed architecture review. The skill is intended for repository work
where an agent should:

1. inspect Seeds first,
2. produce a temporary visual candidate report,
3. use structured decision checkpoints only at durable branch points,
4. create or update a candidate-specific Seeds epic and plan,
5. implement only after the plan is approved,
6. validate, review, and open a PR before treating the work as complete.

## Expected target-repo mutations

The skill is conservative about writes:

- no implementation changes during exploration/reporting;
- `CONTEXT.md` is glossary-only and updated only after a domain term is resolved;
- ADRs are offered only for hard-to-reverse, surprising, real trade-offs;
- Seeds issues/plans are the canonical execution state after a candidate is selected;
- Mulch is recorded only after a validated successful outcome;
- implementation work should happen on a feature branch with PR-first closeout when the repository supports it.

## Validation

This package has no runtime dependencies. Basic local checks:

```bash
node -e 'JSON.parse(require("fs").readFileSync("package.json", "utf8")); console.log("package.json ok")'
find skills -name SKILL.md -print
```
