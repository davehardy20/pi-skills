---
name: thermo-nuclear-code-quality-review
description: >
  Extremely strict maintainability review for abstraction quality, file sprawl,
  spaghetti branching, and missed structural simplification.
compatibility: Designed for Pi. No external dependencies.
disable-model-invocation: true
---

<!-- markdownlint-disable MD013 -->

# Thermo-Nuclear Code Quality Review

Use this skill for a deliberately severe review of implementation quality,
maintainability, abstraction quality, and codebase health. The reviewer should
look for **code judo**: behavior-preserving restructures that make the change
smaller, simpler, more direct, and more inevitable in hindsight.

## Review stance

Be ambitious. Do not approve merely because the code works. Search for ways to
delete complexity, collapse branches, move logic to the right owner, clarify type
boundaries, and make the implementation easier to reason about.

Prefer direct, boring, maintainable code. Treat magic, ad-hoc branching, pass-through
wrappers, cast-heavy contracts, scattered feature checks, and needless sequential
orchestration as design smells when a cleaner shape is visible.

## Process

1. Inspect the current branch diff and surrounding code, not just changed lines.
2. Identify meaningful changes: new flows, abstractions, types, orchestration,
   file growth, and ownership boundaries.
3. Ask the primary review questions for each meaningful change.
4. Compare the implementation against the approval bar.
5. Report only high-conviction findings. Prefer structural blockers over nits.
6. For each finding, name the problem, explain why it worsens maintainability,
   and suggest the simplest behavior-preserving remedy.

## Primary review questions

For every meaningful change, ask:

- Is there a code-judo move that would make this dramatically simpler?
- Can this change be reframed so fewer concepts, branches, modes, or helper
  layers are needed?
- Does this improve or worsen the local architecture?
- Did the diff add branching complexity where a better model or abstraction
  should exist?
- Did a cohesive module become more coupled, stateful, or harder to scan?
- Is this logic in the right file, package, layer, or owner?
- Did this change enlarge a file or component past a healthy size boundary,
  especially across 1000 lines?
- Are repeated conditionals signaling a missing model, dispatcher, helper, or
  state machine?
- Is the implementation direct and legible, or does it rely on special cases and
  incidental control flow?
- Is this abstraction earning its keep, or is it a pass-through wrapper?
- Did the diff introduce casts, optionality, `any`, `unknown`, or ad-hoc object
  shapes that obscure the real invariant?
- Is feature logic leaking into shared paths or implementation details leaking
  through an interface?
- Is there a canonical helper, module, or pattern that should be reused instead
  of this bespoke code?
- Is the orchestration more sequential or less atomic than it needs to be?
- Did the PR preserve incidental complexity when it could delete it?

## Approval bar

Do not approve unless all of these are true:

- no clear structural regression;
- no obvious missed opportunity for a dramatically simpler implementation;
- no unjustified file-size explosion;
- no spaghetti growth from special-case branching;
- no hacky, magical, or brittle abstraction that makes behavior harder to reason
  about;
- no unnecessary wrapper, cast, optionality, or loosely typed contract obscuring
  the real design;
- no feature logic scattered across shared code;
- no logic added to the wrong layer when there is a clear canonical home;
- no duplicate bespoke helper where an existing helper should be reused;
- no avoidable sequential orchestration or partial-update structure that makes
  state harder to reason about;
- no missed decomposition that would materially improve maintainability.

Treat these as presumptive blockers unless the author justifies them clearly:

- a file crosses 1000 lines because of the PR;
- new conditionals are bolted onto unrelated or already busy flows;
- the change solves a local problem by spreading feature checks across shared
  paths;
- an abstraction merely renames or forwards behavior without reducing caller
  complexity;
- casts, `any`, `unknown`, nullable modes, or flags paper over an unclear
  invariant;
- a refactor moves complexity around without reducing the number of concepts a
  reader must hold.

## Preferred remedies

Prefer remedies that remove concepts, not just rename them:

- delete an unnecessary layer or wrapper;
- reframe the state model so conditionals disappear;
- move logic to the module that owns the concept;
- isolate feature-specific logic behind a dedicated seam;
- replace condition chains with a typed model, dispatcher, or state machine;
- extract a focused helper or pure function;
- split a large file into cohesive modules;
- reuse the canonical helper instead of adding a near-duplicate;
- make type boundaries explicit;
- parallelize independent work when that also simplifies orchestration;
- make related updates atomic when partial state would be harder to reason about.

## Review tone

Be direct, serious, and demanding. Do not be rude, but do not soften real
maintainability problems into mild suggestions.

Useful phrases:

- `this pushes the file past 1k lines. can we decompose this first?`
- `this adds another special-case branch into an already busy flow. can we move this behind its own abstraction?`
- `this works, but it makes the surrounding code more spaghetti. let's keep the behavior and restructure the implementation.`
- `this abstraction seems unnecessary. can we just keep the direct flow?`
- `why does this need a cast / optional here? can we make the boundary more explicit instead?`
- `this looks like a bespoke helper for something we already have elsewhere. can we reuse the canonical one?`
- `i think there's a code-judo move here that makes this much simpler. can we reframe this so these branches disappear?`
- `this refactor moves complexity around, but doesn't really delete it. is there a way to make the model itself simpler?`

## Output format

Prioritize findings in this order:

1. Structural regressions.
2. Missed code-judo simplifications.
3. Spaghetti branching or special-case growth.
4. Boundary, abstraction, ownership, and type-contract problems.
5. File-size and decomposition concerns.
6. Modularity, legibility, and maintainability concerns.

For each finding include:

- severity;
- location;
- issue;
- why it matters;
- required fix or recommended structural direction.

If the approval bar is met, say so explicitly. If not, identify the blockers.
