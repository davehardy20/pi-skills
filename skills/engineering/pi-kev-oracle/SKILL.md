---
name: pi-kev-oracle
description: >-
  Consult the local Pi-Kev decision model for fast, typed, probabilistic
  semantic judgments: noul yes/no probabilities, one-of-a-set choices,
  ordered scores. Use when a task needs semantic classification, routing,
  ranking, evidence-strength or modality judgments, or Pi-Kev-vs-Jev
  benchmarking.
license: MIT
metadata:
  source: "Local-first wrapper over the self-trained pi-kev model (~/tools/kev, ~/tools/pi-kev) with TypeSafe AI's hosted Jev as opt-in ceiling; upstream skill: typesafe-ai (vendored in this repo). Renamed from jev-oracle 2026-09-21; restructured procedure-first 2026-09-21."
---

# Pi-Kev oracle

Pi-Kev is a self-hosted decision model: state in, typed probabilistic
decisions out — no text generation, no JSON parsing. It runs on this machine
(free, ~0.2–0.4 s, nothing egresses). Keep policy, thresholds, and
composition in code; use the model only for meaning.

## Transport and privacy rules

| Rule | Applies to |
| --- | --- |
| Default to **local** (`127.0.0.1:8012`); internal state is fine there | every run |
| **Hosted Jev is opt-in**: `--hosted` flag or `SYSTEMONE_API_URL`; public-shaped state ONLY | hosted runs |
| **Secrets and credentials: never**, on any transport — responses (incl. state) are cached to disk | every run |

The client enforces this: with no env var set it resolves to local
whenever the service is up; hosted requires explicit opt-in (`--hosted`,
`SYSTEMONE_API_URL`, or a caller arg); and if the local service is down
with nothing set, it **fails closed** — refusing with a restart hint rather
than egressing. There is no silent hosted fallback. Responses are tagged
`"endpoint": "local" | "hosted"` — check that tag on internal-state runs
and before trusting comparisons. Cache keys cover state+questions+model but
NOT the endpoint: for cross-transport comparisons pass `--no-cache` or
distinct `--model` strings.

## How to call

```bash
# Local (default — no env var needed when the service is up)
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "The working tree has uncommitted changes; no PR is open." \
  --questions-file questions.json

# Hosted Jev (opt-in; public-shaped state ONLY) — ALWAYS dry-run first
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "Socket cleanup may fail when a worker terminates unexpectedly." \
  --questions-file questions.json --hosted --dry-run   # then without --dry-run

# Audit: resolved endpoint, keychain, cache, egress log
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py status
```

Python: `from jev import evaluate; evaluate(state, questions)` (same
directory). `SYSTEMONE_API_URL` still overrides the default local-first
resolution — grading scripts rely on it. (An explicit caller arg such as
`--hosted` outranks it; see REFERENCE.md.)

`questions.json` shape — `criteria` maps option names to rubric
descriptions (`choice`), `true`/`false` descriptions (`noul`), or an
ordered array of level descriptions (`score`). For `noul`, `criteria` is
optional — the rubric sharpens the judgment when a bare question is
ambiguous:

```json
{
  "should_verify": {
    "type": "noul",
    "instructions": "Does the report claim the fix was verified?",
    "criteria": {
      "true": "The report states the fix was verified",
      "false": "The report makes no verification claim"
    }
  },
  "evidence_type": {
    "type": "choice",
    "instructions": "What does the statement establish about socket cleanup?",
    "criteria": {
      "possible": "Failure is presented only as a possibility",
      "observed": "Failure has actually been observed",
      "certain": "The statement establishes that failure definitely occurs"
    }
  }
}
```

## Primitives — pick by what the answer means

| Need | Primitive | Returns |
| --- | --- | --- |
| Whether a condition holds | `noul` | probability of yes (0–1) |
| One of a defined set | `choice` | chosen option + full distribution + confidence |
| Degree along a described dimension | `score` | probability-weighted position across ordered levels |

Question ids are for code only (not sent to the model); put complete meaning
in `instructions` and `criteria`. Pack independent questions over the same
state into one request. Reference nested state with backticked paths like
`ticket.messages[0].text`.

## Reading answers

- `confidence` is distribution concentration, **not correctness**.
- A noul near 0.5 means the evidence genuinely cuts both ways — or you asked
  it math.
- **Strong** (high confidence on real internal state): agent-workflow
  semantics (is work unfinished? next step per policy?), diff semantics
  (rename/delete/touch-count), completion and readiness judgments.
- **Weak** (measured coin-flip): arithmetic and numeric comparison ("within 4
  points?", "more than 50%?"). Reword as semantic categories or compute
  numbers in code and ask only about meaning.

Calibration measurements live in the eval SSOT (`baselines.json`) — see
Benchmark context in `REFERENCE.md`.

## Wired decision rules

Decision rules that route real workflow through this oracle. All share the
dogfood discipline: blind call first, consult second, kev output is
evidence (not verdict), `kev: null` when the server is down.

- **PR-gate NIT triage (adopted 2026-09-21, `kev-no-block-skip-rule`)**:
  during gated PR rounds, batch a `blocks_merge` noul per reviewer finding.
  Skip NIT-class findings when noul < 0.35; fix when ≥ 0.5 or non-NIT
  severity; 0.35–0.5 is a judgment zone (prefer skip for NITs). Log:
  `~/tools/pi-kev/experiments/pr-triage-dogfood/log.jsonl`.
- **Provisional arms** (decision rules live in
  `~/tools/pi-kev/experiments/workflow-arms/ARMS.md`, one JSONL log each):
  comment triage (actionable + action on review comments), test-failure
  triage (`is_flake` gates the re-run policy before root-causing), and the
  mulch durable-gate (fail-closed: 0.35–0.5 zone skips recording). Consult
  them at their triggers until each graduates or is refuted. If that file
  is absent, the arms are inactive on this machine — only the adopted
  NIT-triage rule above is self-contained here.

When adding a new rule: define the trigger, questions, decision thresholds,
and log path in an ARMS-style doc first; adopt only after measured accuracy.

## Fallbacks

1. Local service down → restart it (it self-heals crashes; bootstrap alone
   fails when the job is still loaded, so boot out first):
   `launchctl bootout gui/501/local.pi-kev-4b 2>/dev/null;
   launchctl bootstrap gui/501 ~/Library/LaunchAgents/local.pi-kev-4b.plist`
   — full service management in `REFERENCE.md`.
2. Internal state + local down → heuristics, or defer. NEVER route internal
   state to hosted Jev to "get an answer anyway".
3. Public-shaped state + local down → hosted Jev (with its gate) or
   heuristics.

Service management, endpoint-resolution details, hosted-Jev norms and key
handling, benchmark context, and the fair-comparison rule live in
[`REFERENCE.md`](REFERENCE.md).
