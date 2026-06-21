---
name: post-merge
description: >
  Run PR post-merge closeout for Pi/Seeds repos. Use when Dave says a PR was
  merged, remote branch was deleted, asks for post-merge tasks, or invokes
  /skill:post-merge to update local main, close Seeds work, capture follow-ups, and
  report cleanup status.
compatibility: Designed for Pi. Uses Seeds, safe git/GitHub wrappers, and optional Mulch.
---

# Post-Merge Closeout

Use this skill after Dave confirms a PR has merged, especially when the remote
feature branch was deleted. Keep closeout boring, auditable, and fail-safe.

## Goals

- Verify the PR really merged.
- Update local default branch by fast-forward only.
- Close or update the relevant Seeds issue(s).
- Preserve follow-up work as Seeds issues.
- Record durable Mulch learning only for confirmed outcomes.
- Report exactly what was done and what remains.

## Workflow

1. **Recover state**
   - Check `orch_mailbox` if available.
   - Check working tree status with `git_inspect_safe` or `git_safe status`.
   - Inspect the relevant Seeds issue/plan first when `.seeds/` exists.
   - Inspect the PR with `gh_safe pr_view` when a PR number or branch is known.

2. **Verify merge**
   - Confirm PR state is `MERGED` and capture:
     - PR URL;
     - merge commit;
     - base branch;
     - head branch.
   - If the PR is not merged, stop and report that post-merge closeout cannot proceed.

3. **Update local default branch**
   - Ensure the working tree is clean before switching branches.
   - Run `git_safe fetch` with `prune=true` for the remote.
   - Switch to the base/default branch with `git_safe switch`.
   - Run `git_safe pull_ff_only` for the base/default branch.
   - Do not rebase or merge manually.
   - If local feature branch deletion is desired and no safe wrapper exposes it,
     tell Dave the exact command to run instead of bypassing the wrapper.

4. **Close Seeds work**
   - Close the parent issue only after merge is confirmed and validation evidence exists.
   - Include the PR number, merge commit, and one-line outcome in the close reason.
   - Create follow-up Seeds issues for known regressions, gate failures, flaky tests,
     or deferred cleanup that should not block the merged work.
   - If closing Seeds changes `.seeds/`, do not silently push to the default branch.
     Check project sync status and either open a metadata PR or ask Dave before any
     direct default-branch push.

5. **Mulch learning**
   - Record Mulch only for confirmed, durable guidance from the merged outcome.
   - Prefer `pattern` or `convention` unless the domain schema supports decisions.
   - Run `mulch_sync` after recording. Use `noValidate` only for pre-existing schema drift,
     and mention that in the closeout.

6. **Final report**
   - Keep it concise.
   - Include:
     - PR URL and merge commit;
     - local branch/base update status;
     - Seeds issues closed/created;
     - Mulch records written or skipped;
     - validation/CI status if relevant;
     - unresolved cleanup requiring Dave action.

## Safety rules

- Prefer `git_safe`, `git_inspect_safe`, and `gh_safe` over shell git/GitHub commands.
- Never force-push, reset, rebase, or delete branches through unsafe workarounds.
- Direct pushes to the default/protected branch require explicit Dave approval.
- Treat compacted summaries as historical; verify current PR and issue state before closing.
