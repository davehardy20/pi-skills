---
name: seeds-issue-audit
description: >
  Audit and triage open Seeds issues with evidence: identify stale-completed work,
  report uncertain cases, and close only explicitly authorized high-confidence cases.
compatibility: >
  Designed for Pi. Requires Seeds wrappers; uses safe Git/GitHub tools for completion
  evidence and follows the repository's PR-first closeout rules.
license: MIT (adapted from Jaymin West's seeds-issue-audit skill; see ATTRIBUTION.md)
metadata:
  source: "Adapted from Jaymin West's MIT-licensed seeds-issue-audit skill."
---

# Seeds Issue Audit

Use this skill when Dave asks to audit, triage, or clean up open Seeds issues.

The **audit** is evidence-first. Staleness is a review signal, never closure
proof. Default to **report-only**. Change issue state only when Dave explicitly
asks to close high-confidence findings.

## Guardrails

- Inspect the project instructions, current Seeds state, and working tree before
  mutation.
- Never close an `in_progress` issue without Dave's explicit confirmation.
- Never close an issue with a live open blocker.
- Never infer completion from age, title, labels, plan membership, or text such
  as "done" alone.
- A `#123` reference is ambiguous until GitHub confirms it is a merged PR.
- Use `seeds_*`, `git_safe` / `git_inspect_safe`, and `gh_safe`. Do not replace
  those controls with raw `sd`, `git`, or `gh` commands.
- The audit coordinator is the sole mutator. Delegated auditors are read-only.

## 1. Recover state

1. Check `orch_mailbox` when it is available.
2. Inspect repository guidance and working-tree status with `git_inspect_safe`, or
   `git_safe` status if the inspection tool is unavailable. Do not mix an audit
   with unrelated local changes.
3. Get an inexpensive tracker view:
   - `seeds_list` with `mode="stats"`;
   - `seeds_list` with `mode="list"`, `status="open"`;
   - `seeds_list` with `mode="ready"`;
   - `seeds_list` with `mode="blocked"`.
4. Do not treat ready/blocked membership as authoritative. A blocked edge may
   point to an already closed issue.
5. For every candidate, inspect its full record with `seeds_show`. If it is
   associated with a plan, inspect that plan with `seeds_plan_show`.

For 15 or fewer open issues, audit inline. Above that, split the issue IDs into
batches of about 10 and use read-only `orchestrate` workers. Each worker must
return one structured verdict per issue; only the coordinator aggregates results
or calls a mutation tool.

```text
- id: <issue-id>
  title: <title>
  evidence: [<verified-merged-pr|successful-plan-outcome|open-blocker|stale|...>]
  recommendation: <close | borderline | leave-open>
  reason: <concise, evidence-based reason or empty>
```

## 2. Establish evidence

For each issue, record:

- status, description, close reason, timestamps, labels, plan metadata, and
  dependency edges from `seeds_show`;
- live dependency state via `seeds_relation` with `action="list_dep"`, then
  `seeds_show` for each blocker when necessary;
- plan steps, children, and recorded outcome from `seeds_plan_show`;
- PR references in issue text, verified with `gh_safe pr_view` using at least
  `state`, `mergedAt`, `mergeCommit`, `baseRefName`, and `url`.

A verified merged PR is strong evidence. A documented, successful Seeds plan
outcome is strong evidence only when the issue clearly maps to completed plan
work. A bare commit SHA is not sufficient in a Pi-compatible audit because the
safe Git interface does not expose repository-history search; corroborate it
with a merged PR or verified plan outcome.

Resolve every blocker live. A closed dependency does not block closure. Any open
dependency does.

## 3. Decide

Classify each issue without guessing:

| Conditions | Verdict |
| --- | --- |
| Strong completion evidence, blockers clear, no contradiction | High confidence: eligible with Dave's authorization |
| In-progress status, open blocker, WIP/reopened/unfinished evidence | Leave open |
| Unverified PR, completion wording only, stale-only, or incomplete plan evidence | Borderline: report for review |
| No completion evidence | Leave open |

Use a default staleness threshold of 90 days unless Dave specifies another one.
Mark it as a weak signal only. Do not turn a plan's apparent child completion
into `success`; plan outcomes require validated plan completion.

## 4. Report or apply

### Report-only (default)

Return counts followed by two compact tables:

#### Eligible with authorization

| id | title | verified evidence | proposed close reason |
| --- | --- | --- | --- |

#### Borderline

| id | title | signals | missing evidence | suggested action |
| --- | --- | --- | --- | --- |

Also state important open items left unchanged, especially those blocked or
in progress.

### Apply (only after explicit authorization)

1. Re-check each eligible issue immediately before mutation.
2. Close issues individually with `seeds_close`, using a specific evidence-based
   reason. Batch only when the same reason exactly applies to every issue.
3. Re-audit downstream issues that were blocked only by issues just closed. Add
   newly eligible issues to the report. Close them only with fresh Dave approval,
   unless his authorization explicitly included cascading high-confidence closures.
4. Record `seeds_plan_outcome` only when the plan's successful completion is
   independently validated; closed child issues alone are not enough.
5. Treat `.seeds/` changes as repository changes. Use `seeds_project` sync only
   after the audit settles, then follow the repository PR-first workflow:
   review the diff, commit/sync on a feature branch, request `pr_review`, wait
   for its pass message, push, create a PR, and arm the required PR watch.
6. If publishing is unavailable or not authorized, stop after local validation
   and state exactly what remains. Never push a tracker update directly to the
   default branch.

## Final report

State the mode, counts, evidence for every closure, validations performed, and
any PR/merge/defer status. List borderline and intentionally open issues with
the next evidence needed. A successful audit is a defensible tracker state, not
a low count of open issues.
