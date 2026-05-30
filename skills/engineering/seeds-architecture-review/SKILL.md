---
name: seeds-architecture-review
description: >
  Seeds-native architecture review for finding deepening opportunities, choosing seams,
  comparing interfaces, and turning selected candidates into governed Seeds plans. Use
  when improving codebase architecture, reducing shallow modules, or making a codebase
  more testable and agent-navigable.
compatibility: >
  Designed for Pi. Seeds is required for governed implementation work. Optional
  ask_user/ask_user_question checkpoints should fall back to normal chat when unavailable.
---

# Seeds Architecture Review

Use this skill to run architecture improvement work without letting an exploratory report
become the source of truth. The report helps Dave choose a candidate. Seeds owns the
candidate, plan, child tasks, implementation state, review, and outcome.

## Non-negotiables

- Seeds is canonical after a candidate is selected.
- The HTML report is exploratory and temporary.
- `ask_user` is a checkpoint tool, not the whole conversation.
- `CONTEXT.md` is glossary-only.
- ADRs are sparse and require a real trade-off.
- Mulch is post-outcome only.
- Use a feature branch before target-repo mutations when practical.
- Prefer PR-first closeout for repository-changing work.
- Do not depend on `grill-with-docs` or any external skill content.

## Architecture vocabulary

Use these words exactly.

- **Module**: anything with an interface and an implementation.
- **Interface**: everything a caller must know to use a module correctly.
- **Implementation**: the code inside a module.
- **Depth**: leverage at the interface.
- **Deep**: a lot of behaviour behind a small interface.
- **Shallow**: the interface is nearly as complex as the implementation.
- **Seam**: where an interface lives; a place behaviour can change without
  editing that place.
- **Adapter**: a concrete thing satisfying an interface at a seam.
- **Leverage**: what callers get from depth.
- **Locality**: what maintainers get from depth.

Avoid these substitutions:

- Use module, not component, service, or unit.
- Use interface, not API or signature.
- Use seam, not boundary.

Key principles:

- **Deletion test**: if deleting a module removes complexity, it was a pass-through.
  If complexity reappears across callers, it was earning its keep.
- **The interface is the test surface**: callers and tests should cross the same
  seam.
- **One adapter means a hypothetical seam. Two adapters mean a real seam.**
- Depth is about leverage, not line-count ratios.

## Workflow overview

Follow this lifecycle:

1. Recover project workflow state.
2. Read project language and prior decisions.
3. Explore architecture friction.
4. Produce a temporary HTML candidate report.
5. Use a checkpoint to choose a candidate.
6. Create or update a candidate-specific Seeds epic.
7. Run Seeds-backed design interrogation.
8. Compare interface alternatives when useful.
9. Submit a Seeds plan and spawn child tasks after approval.
10. Implement through child tasks with validation and review.
11. Open a PR when the target repo supports it.
12. Record Seeds outcome, then Mulch only for confirmed durable learning.

## 1. Recover workflow state

Before architecture work:

1. Check mailbox if this is an orchestrated run.
2. Inspect repository instructions such as `AGENTS.md` or `CLAUDE.md`.
3. If `.seeds/` exists, inspect relevant Seeds issues and submitted plans first.
4. If no Seeds project exists, do not initialise it silently.
5. If implementation is likely, ask whether to initialise or use Seeds.
6. If Dave declines Seeds, stop at exploratory/report-only mode and do not treat
   another tracker as canonical governed state.
7. Check git status before write-heavy work.
8. Create or switch to a feature branch before target-repo mutations when practical.

For pure exploration, do not create tasks yet. Wait until Dave selects a candidate.

## 2. Read project language and decisions

Look for these files before judging seams:

- `CONTEXT-MAP.md`
- root or scoped `CONTEXT.md`
- `docs/adr/`
- local architecture notes
- relevant tests

Rules for `CONTEXT.md`:

- It is a glossary, not a spec.
- It should contain domain terms only.
- Do not add implementation details, interface designs, task notes, or rationale.
- Create or update it lazily only after a term is resolved.
- If multiple contexts exist, use `CONTEXT-MAP.md` to choose the right glossary.
- If the context is unclear, ask Dave before editing.

A glossary entry should stay tight:

```markdown
**Order**:
A customer request for goods or services that the business has agreed to fulfil.
_Avoid_: Purchase, transaction
```

## 3. Explore architecture friction

Explore organically. Use available subagents or delegation when helpful. If no
subagent tool is available, inspect directly.

Look for:

- shallow modules;
- pass-through modules;
- seams with only one adapter;
- seams that leak data, ordering, errors, config, or invariants;
- pure functions extracted only for testability while bugs live in orchestration;
- scattered tests that cannot exercise behaviour through one interface;
- concepts that require bouncing through many files;
- decisions that contradict or stress an ADR.

Apply the deletion test to every suspected shallow module.

Do not propose concrete new interfaces during the first exploration pass.

## 4. Produce the temporary HTML report

Write a self-contained HTML report to the OS temp directory, not the repo.

Use:

- `$TMPDIR` when present;
- `/tmp` on Unix-like systems as fallback;
- `%TEMP%` on Windows when relevant;
- filename pattern `architecture-review-<timestamp>.html`.

Open it when the environment supports this:

- macOS: `open <path>`;
- Linux: `xdg-open <path>`;
- Windows: `start <path>`.

Tell Dave the absolute path.

The report may use Tailwind and Mermaid from CDNs. It must remain static except
for Mermaid rendering.

Each candidate card should include:

- title;
- recommendation strength: `Strong`, `Worth exploring`, or `Speculative`;
- dependency category when useful;
- files and modules involved;
- problem in one sentence;
- proposed deepening in one sentence;
- benefits in terms of locality, leverage, and test surface;
- before and after visualisation;
- ADR conflict callout when the friction justifies revisiting the ADR.

End with a top recommendation.

After the report, ask which candidate to explore. Do not submit a Seeds plan yet.

## 5. Use decision checkpoints carefully

Use `ask_user` or `ask_user_question` only when the decision has clear options.
If the tool is unavailable, ask the same question in normal chat.

Good checkpoint moments:

- candidate selection after the report;
- seam placement when several seams are plausible;
- interface selection after showing alternatives;
- first-iteration scope selection;
- ADR confirmation with a draft preview;
- Seeds plan approval before child tasks are executed.

Avoid checkpoints for fuzzy thinking:

- defining a domain concept;
- discovering why a seam exists;
- surfacing hidden constraints;
- resolving contradictions between code and language;
- questions where Dave needs a free-form answer.

Every checkpoint should include:

- recommended option first;
- 2 to 4 options;
- short trade-offs;
- what artifact will change;
- normal-chat fallback;
- no back-to-back checkpoint spam.

Example candidate checkpoint:

```text
Question: Which candidate should become the Seeds epic?
Options:
1. Collapse order intake (recommended) — highest locality gain.
2. Deepen pricing seam — useful, but depends on billing decisions.
3. Skip for now — keep report only, no Seeds work.
```

## 6. Create or update a candidate-specific Seeds epic

Once Dave chooses a candidate, Seeds becomes the source of truth.

Create a new epic unless an existing relevant epic already exists. The epic title
should name the candidate, not a generic review.

Good title:

```text
Deepen the Order intake module
```

Weak title:

```text
Architecture review
```

The epic should capture:

- selected candidate;
- affected files and modules;
- current shallow interface or leaky seam;
- target depth, locality, and leverage outcome;
- likely seam placement;
- report path, if useful;
- explicit out-of-scope items;
- validation and PR closeout expectations.

Do not create implementation child tasks until design interrogation has finished.

## 7. Run Seeds-backed design interrogation

Walk the design tree one question at a time.

Preferred order:

1. If code can answer the question, inspect code instead of asking.
2. If terminology is fuzzy, ask conversationally.
3. If the decision has 2 to 4 clear options, use a checkpoint.
4. Persist crystallised decisions immediately.

Persist decisions here:

| Decision | Artifact |
| --- | --- |
| Domain term | `CONTEXT.md` |
| Hard-to-reverse surprising trade-off | ADR |
| Scope, constraints, tests, risks | Seeds plan |
| Implementation steps | Seeds child issues |
| Validated reusable learning | Mulch after success |

Interrogate at least:

- what concept the deepened module represents;
- where the seam should live;
- what sits behind the interface;
- which callers cross the seam;
- which current modules become internal implementation details;
- which adapters are real and which are hypothetical;
- what tests should survive;
- what behaviour needs characterization tests first;
- what is explicitly out of scope;
- what must be true before PR closeout.

## 8. Compare interface alternatives

When interface choice matters, design it more than once.

Produce 3 or more alternatives when useful:

1. Minimal interface: 1 to 3 entry points, maximum leverage.
2. Flexible interface: extension-friendly, handles varied callers.
3. Caller-first interface: common path is trivial.
4. Ports-and-adapters interface when cross-seam dependencies justify it.

Each option should include:

- interface shape, including invariants and error modes;
- usage example;
- what the implementation hides;
- dependency and adapter strategy;
- trade-offs in depth, locality, seam placement, and tests.

Use a checkpoint for selection when there are 2 to 4 strong options. Previews may
include short code sketches.

## 9. Submit the Seeds plan only after approval

Before plan submission, show Dave the planned outcome and ask for approval.
Use a checkpoint if possible.

The plan should include:

- context and selected candidate;
- chosen seam;
- interface choice and rejected alternatives;
- scope and out-of-scope work;
- characterization test strategy;
- implementation steps;
- validation commands;
- review pass;
- feature branch and PR-first closeout;
- Seeds outcome criteria;
- Mulch criteria after success.

Child tasks should be vertical and reviewable. Typical tasks:

1. Add characterization tests.
2. Define or adjust the deep module interface.
3. Implement behaviour behind the seam.
4. Migrate first caller.
5. Migrate remaining callers.
6. Delete shallow pass-through modules.
7. Update glossary or ADRs only if approved.
8. Run validation and review.
9. Open PR and record Seeds outcome.

## 10. ADR rules

Offer an ADR only when all are true:

1. The decision is hard to reverse.
2. A future reader would find it surprising without context.
3. There was a real trade-off with plausible alternatives.

Do not offer ADRs for:

- obvious decisions;
- temporary scope cuts;
- easy-to-reverse implementation details;
- preferences without architectural consequence.

Use a checkpoint with a draft preview before writing an ADR when possible.

Minimal ADR format:

```markdown
# Use event replay for Order projections

We will rebuild Order projections by replaying domain events rather than querying
write-model tables directly. This keeps projection bugs local to the projection
module and avoids coupling read models to write-model storage details.
```

## 11. Mulch rules

Do not record Mulch during brainstorming, report generation, or speculative design.

Record Mulch only after:

- implementation is validated;
- review is complete;
- the outcome is successful or clearly partial;
- the lesson is reusable beyond this one task.

Good Mulch material:

- a confirmed repo convention;
- a repeated failure mode;
- a validated architectural decision;
- a specific workflow rule that prevented mistakes.

## 12. Implementation and closeout

Once child tasks exist, implement normally for the target repo.

Required closeout for repository-changing work:

- feature branch created or reason not possible;
- relevant tests or validation run;
- review pass completed;
- intended changes committed;
- PR opened when a remote is configured and publication is approved;
- Seeds child issues closed only after their work is verified;
- Seeds plan outcome recorded after completion;
- Mulch recorded only for confirmed durable learning.

A PR opened means ready for review. It does not mean reviewed, merged, deployed,
or complete.

## 13. Failure modes to avoid

- Creating Seeds child tasks before Dave selects a candidate.
- Treating the HTML report as the durable artifact.
- Mutating `CONTEXT.md` with implementation notes.
- Writing ADRs for ordinary or temporary choices.
- Calling `ask_user` for every question.
- Introducing seams with only one real adapter.
- Proposing interfaces before understanding callers and tests.
- Recording Mulch before validation.
- Reporting work as complete before review and PR-first closeout are addressed.
