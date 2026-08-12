---
name: code-review
description: >-
  Review the current checkout's branch, pull request, or work-in-progress change
  on two independent axes: repository standards and Seeds-backed implementation
  intent. Use when reviewing changes since a fixed point or when an implementation
  workflow needs actionable findings returned to the parent agent for remediation.
license: MIT (adapted from Matt Pocock's code-review skill; see ATTRIBUTION.md)
metadata:
  source: "Adapted from Matt Pocock's MIT-licensed code-review skill."
---

# Code Review

Review a change on two independent axes:

- **Standards** — conformity with repository guidance, established architecture,
  and the smell baseline below.
- **Intent** — fidelity to the active Seeds issue and relevant submitted plan.

Run both axes as isolated, read-only sub-agents. Return their findings directly
into the parent agent's current context so that agent can implement fixes.

## Non-negotiable boundary

Seeds is evidence, not the review destination. During review:

- Seeds access is read-only: use `seeds_show`, `seeds_plan_show`, and
  `seeds_list` only;
- never create, update, close, relate, submit, review, validate, or record an
  outcome for a Seeds issue or plan;
- never persist findings to Mulch, files, comments, mailboxes, or issue trackers
  unless the user separately requests it;
- reviewers never edit files, stage changes, commit, push, or open/update a PR.

The parent agent owns remediation and validation after receiving the report.

## 1. Establish the review range

Review the current checkout only. If the user names a target branch or PR, verify
that it corresponds to the checked-out `HEAD`; stop on mismatch rather than
silently reviewing another change. Use an explicit fixed point supplied by the
user. Otherwise detect the remote's default branch and use its merge-base with
`HEAD`. Prefer `origin/HEAD`; if it is unavailable, inspect the configured
remote/default branch. Do not silently assume `main`.

Verify the fixed point resolves and capture:

- the resolved fixed point and merge-base;
- commits from the fixed point to `HEAD`;
- changed tracked files, including staged and unstaged worktree changes;
- relevant untracked files reported by status.

A committed-only comparison is insufficient for a WIP review. The effective
review set is the base-to-`HEAD` change plus staged, unstaged, and relevant
untracked files. Prefer safe Git inspection tools. If they are available but do
not express a required read-only operation, use narrow raw Git inspection for
that operation only. If safe Git tools are unavailable, use raw Git only for
read-only status, diff, ref resolution, merge-base, and commit-list inspection.
Never use raw Git to mutate state during review.

Stop with a clear diagnostic if the ref is invalid. If the effective review set
is empty, report that there is nothing to review.

## 2. Resolve Intent evidence

If `.seeds/` exists, identify the Intent source in this order:

1. a Seeds issue or plan ID supplied by the user or calling workflow;
2. a Seeds ID referenced by branch/commit context;
3. the single in-progress issue that clearly matches the change.

Use `seeds_show` for an issue ID. When that issue belongs to a submitted plan,
use `seeds_plan_show` and extract only the parent constraints relevant to the
issue. Use `seeds_plan_show` directly for a plan ID. For a non-final plan review,
resolve or ask for the active child issue; do not judge one child against the
whole plan.

If `.seeds/` exists but Seeds tools are unavailable, continue with explicit
acceptance criteria from the user's current request when available. Otherwise
mark Intent as `not reviewed — Seeds tooling unavailable` and continue the
Standards review.

Apply the correct scope:

- **Child/incremental review:** judge completion against the active child issue;
  use the parent plan only for shared constraints and acceptance criteria that
  apply to that child.
- **Final/whole-plan review:** judge the complete change against the full plan
  only when the user or calling workflow explicitly identifies this as final
  closeout.

Do not flag other planned children as missing during an incremental review.

If several issues plausibly match and the choice changes the review, ask the
user. In a non-interactive workflow, mark Intent as `not reviewed — ambiguous
Seeds source` and list the candidate IDs. If no relevant Seeds evidence exists,
use explicit acceptance criteria in the user's current request when available;
otherwise mark Intent as `not reviewed — no intent evidence`. Do not invent a
specification.

## 3. Resolve Standards evidence

Read repository guidance that governs the changed paths, including applicable
`AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, coding standards, architecture
documentation, and local conventions. Inspect surrounding code and relevant
tests, not only changed hunks.

Also apply this Fowler-inspired smell baseline. These are judgement calls, not
hard violations, and documented repository guidance overrides them. Skip
issues already enforced reliably by tooling.

- **Mysterious Name** — a name does not reveal its purpose.
- **Duplicated Code** — the same logic shape appears in multiple changed sites.
- **Feature Envy** — logic reaches into another owner's data more than its own.
- **Data Clumps** — the same fields or parameters repeatedly travel together.
- **Primitive Obsession** — a primitive stands in for a domain concept.
- **Repeated Switches** — repeated branching dispatches on the same distinction.
- **Shotgun Surgery** — one concern requires scattered edits across modules.
- **Divergent Change** — one module changes for unrelated reasons.
- **Speculative Generality** — abstraction exists for an unrequired future need.
- **Message Chains** — callers navigate a long chain of internal relationships.
- **Middle Man** — an abstraction mainly forwards calls without reducing
  complexity.
- **Refused Bequest** — an implementation rejects most inherited behaviour.

## 4. Run isolated reviews in parallel

Use `orchestrate` in parallel mode with one task per axis. Prompts must be
self-contained and include the resolved range, changed/untracked files, commits,
evidence paths or bounded evidence text, scope rule, and output contract below.
Tell both reviewers they are strictly read-only.

### Standards reviewer

Ask it to:

- inspect the effective review set and surrounding implementation/tests;
- identify documented-standard breaches, citing the source and rule;
- identify only high-confidence smell findings, labelled as judgement calls;
- ignore formatting/nits already handled by tooling;
- report actionable findings only.

### Intent reviewer

Ask it to:

- compare the effective review set with the active issue's acceptance criteria
  and applicable parent-plan constraints;
- find missing or partial requirements, incorrect implementations, regressions,
  and unrequested scope expansion that creates risk;
- quote or precisely cite the applicable Intent evidence for every finding;
- avoid treating unrelated plan children as requirements of the active child.

If Intent has no usable evidence, skip that sub-agent and record the reason.
If parallel orchestration is unavailable, run isolated read-only passes
sequentially and disclose the degraded execution mode.

## 5. Return findings to the parent context

For every finding use:

```text
[severity] Short title
Axis: Standards | Intent
Location: path:line (or the narrowest available location)
Evidence: governing rule, Seeds criterion, user acceptance criterion, or quoted changed behavior
Issue: what is wrong
Why it matters: concrete consequence
Required fix: smallest acceptable correction
```

Use severities `blocker`, `high`, `medium`, or `low`. Include low severity only
when it is genuinely actionable. Do not combine separate defects into one
finding.

Aggregate under `## Standards` and `## Intent`. Keep the axes separate; do not
merge or rerank across them. Deduplicate only within an axis. End with:

- finding count and worst severity for each axis;
- explicit pass/not-reviewed state for an axis with no findings;
- changed files the reviewers inspected;
- any uncertainty or coverage gap;
- `Remediation owner: parent agent`.

Return this report as the skill result in the current agent context. Do not
store it elsewhere. The parent agent should address accepted findings, run the
relevant validation, and rerun this review when it is acting as a quality gate.
A clean report is review evidence only; it does not close Seeds work or declare
a plan outcome.
