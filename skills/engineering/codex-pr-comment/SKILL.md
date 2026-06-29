---
name: codex-pr-comment
description: >
  Read and action Codex connector PR review comments. Use when Dave says a PR
  has a Codex review comment, asks to inspect Codex feedback, or requests that
  required automated review comments be implemented.
compatibility: >
  Designed for Pi. Prefer gh_safe for GitHub inspection and review-thread reads;
  fall back to gh CLI commands only when safe wrappers are unavailable.
---

# Codex PR Comment

Use this skill when Dave says something like:

> there is a comment from the codex review, read it and implement if required

Goal: inspect the PR, find current Codex connector comments, decide whether they
require code changes, implement only required fixes, validate, and report the
outcome.

## Workflow

1. **Recover the target PR**
   - Use the PR number and repo from Dave's prompt when supplied.
   - If missing, infer from the current branch with GitHub PR inspection.
   - If multiple PRs match or the repo is unclear, ask Dave before changing files.
   - Check the working tree first and avoid mixing unrelated local changes.

2. **Read PR review metadata and comments**
   - Prefer `gh_safe pr_view` when available.
   - Request at least these fields:
     - `comments`
     - `reviews`
     - `reviewDecision`
     - `statusCheckRollup`
     - `url`
     - `state`
     - `mergeStateStatus`
   - Equivalent GitHub CLI fallback:

     ```bash
     gh pr view <PR> --comments --json comments,reviews,reviewDecision,statusCheckRollup,url,state,mergeStateStatus
     ```

     Add `-R <owner/repo>` when not already in the target repository.

3. **Read unresolved review threads**
   - Prefer `gh_safe pr_review_view` when available:
     - `repository=<owner/repo>`
     - `name=<PR>`
     - `unresolved=true`
     - `notOutdated=true`
   - Equivalent `gh-pr-review` fallback:

     ```bash
     gh pr-review review view -R <owner/repo> --pr <PR> --unresolved --not_outdated
     ```

   - Dave commonly uses this shape for `pi-config`:

     ```bash
     gh pr-review review view -R davehardy20/pi-config --pr <PR> --unresolved --not_outdated
     ```

4. **Identify Codex feedback**
   - Treat comments as Codex-originated when the author/reviewer clearly matches
     Codex connector naming such as `codex`, `codex[bot]`, `openai-codex`, or
     `Codex Connector`.
   - Prioritize unresolved, non-outdated review-thread comments over older PR
     timeline comments.
   - Classify each Codex item:
     - **Required fix**: correctness, security, test, regression, or clear bug.
     - **Optional suggestion**: style, naming, readability, or low-risk polish.
     - **No action**: stale, already fixed, informational, or not applicable.

5. **Implement only required changes**
   - Stay on the PR head branch and do not mutate closed or merged PRs.
   - Follow the target repo's local guidance, Seeds state, and test conventions.
   - Keep fixes minimal and directly traceable to Codex comments.
   - If Codex asks for a broad redesign, risky behavior change, dependency swap,
     or anything outside the PR scope, ask Dave before implementing.

6. **Validate**
   - Run the narrowest relevant tests first.
   - Run typecheck, lint, build, or broader tests when the touched files warrant it.
   - If validation cannot run, report the exact reason and the command Dave should
     run.

7. **Close out**
   - Summarize:
     - PR URL and state;
     - Codex comments found;
     - classification for each comment;
     - files changed;
     - validation results;
     - unresolved or intentionally deferred comments.
   - Do not resolve threads, post PR comments, merge, or push unless the current
     task or repo workflow explicitly authorizes it.

## Safety rules

- Prefer `gh_safe`, `git_safe`, and safe validation runners over shell commands.
- Do not treat every automated comment as mandatory; apply judgement and explain
  when no code change is required.
- Do not address unrelated reviewer comments unless Dave asked for all review
  feedback, not only Codex.
- Never bypass branch protection, force-push, or rewrite PR history for a Codex
  comment fix.
