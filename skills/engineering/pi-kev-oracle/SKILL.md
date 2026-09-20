---
name: pi-kev-oracle
description: >-
  Consult the local Pi-Kev decision model (pi-kev-4b, served on this machine) for
  fast, typed, probabilistic semantic judgments: yes/no probabilities (noul),
  one-of-a-set choices, and ordered scores. Internal state is allowed on this
  transport — repo diffs, session data, agent-run state all stay on the box.
  Hosted Jev remains available as an opt-in reference ceiling for public-shaped
  state only (hard privacy gate applies there). Strong at agent-workflow and
  diff semantics; weak at arithmetic comparisons — reword those semantically.
license: MIT
metadata:
  source: "Local-first wrapper over the self-trained pi-kev-4b model (~/tools/kev, ~/tools/pi-kev) with TypeSafe AI's hosted Jev as opt-in ceiling; upstream skill: typesafe-ai (vendored in this repo). Renamed from jev-oracle 2026-09-21."
---

# Pi-Kev oracle

Pi-Kev is a self-hosted decision model: unstructured state in, typed
probabilistic decisions out — no text generation, no JSON-parsing failures.
It runs as an always-on launchd service on this machine, so judgments are
free, fast (~0.2–0.4 s), and **nothing leaves the box**. Keep policy,
thresholds, and composition in code.

## Two transports, two privacy rules

- **Local pi-kev** (default) — `http://127.0.0.1:8012/v1/systemone`
  - Allowed: anything internal — repo code, diffs, session transcripts,
    agent-run data, internal project names.
  - Never: credentials, tokens, secrets.
- **Hosted Jev** (opt-in) — `https://api.typesafe.ai/v1/systemone`
  - Allowed: synthetic/public-shaped state ONLY.
  - Never: internal repo content, session data, filesystem paths, secrets,
    threat-emulation material — the classic jev-oracle gate, unchanged.

Secrets stay forbidden even on the local transport as defense-in-depth:
transports can change, and the client persists responses to disk under
`~/tools/pi-kev/experiments/jev-probe/cache/`.

**Default to local.** Reach for hosted Jev only for (a) ceiling benchmarking
against pi-kev on identical public-shaped fixtures, or (b) a second opinion
where Jev's funded-2-years edge matters and the state can be reworded into
synthetic/public shape.

## How to call

Client + CLI live at `~/tools/pi-kev/experiments/jev-probe/`:

```bash
# 1. Local pi-kev (default transport) — internal state is fine here
SYSTEMONE_API_URL=http://127.0.0.1:8012/v1/systemone \
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "The working tree has uncommitted changes; no PR is open." \
  --questions-file questions.json

# 2. Hosted Jev (opt-in) — public-shaped state ONLY; ALWAYS dry-run first
#    when the state is newly written
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "Socket cleanup may fail when a worker terminates unexpectedly." \
  --questions-file questions.json --dry-run   # then without --dry-run

# 3. Audit: keychain status, cache stats, egress tail
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py status
```

The client auto-detects local URLs (no Authorization header, responses tagged
`"endpoint": "local"`), caches both transports, and logs only hashes/token
counts for hosted egress. The local service reports model id `jev-latest`
regardless of the underlying run — check `/api/info` for the served run.

Cache keys cover state + questions + model but NOT the endpoint — identical
fixtures asked of both transports collide. For local-vs-hosted ceiling
comparisons pass `--no-cache` (or distinct `--model` strings per transport),
and check `cache_hit` / `endpoint` in the output before trusting a comparison.

`questions.json` shape (`criteria` maps options to rubric descriptions; for
`score` it is an ordered array of level descriptions):

```json
{
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

Python: `from jev import evaluate; evaluate(state, questions)` (same
directory; honours `SYSTEMONE_API_URL`).

## Primitives — pick by what the answer means

| Need | Primitive | Returns |
| --- | --- | --- |
| Whether a condition holds | `noul` | probability of yes (0–1) |
| One of a defined set | `choice` | chosen option + full distribution + confidence |
| Degree along a described dimension | `score` | probability-weighted position across ordered levels |

Question ids are for code only (not sent to the model); put complete meaning in
`instructions` and `criteria`. Pack independent questions over the same state
into one request — they run in parallel and cannot see each other. Reference
nested state with backticked paths like `ticket.messages[0].text`.

## Practical norms — LOCAL (measured 2026-09-21, pi-kev-4b-v1)

- Latency ~0.16–0.4 s per multi-question request; free; no auth.
- **Strong (0.99–1.0 confidence, verified on real internal state):** agent
  workflow semantics (is work unfinished? what's the next step per policy?),
  diff semantics (does this rename/delete/touch-N-files?), completion and
  readiness judgments. This is its training distribution — it was built from
  Pi's own history.
- **Weak (measured coin-flip, 0.47):** arithmetic and numeric comparison
  ("within 4 points of X?", "more than 50%?"). It reads semantics, not math.
  Reword numerically-flavored questions as semantic categories, or compute
  numbers in code and ask the model only about meaning.
- `confidence` is distribution concentration, not correctness. A noul near
  0.5 means the evidence genuinely cuts both ways — or you asked it math.
- Exam reference: 88/95 on the frozen pi-kev-eval-v1 vs Jev's 91 — Jev's
  edge is concentrated in the clean variant (56/58 vs 52/58); pi-kev wins
  control-bug 3/3 vs 2/3; debt, control-verified, and permutation tie.

## Practical norms — HOSTED Jev (measured 2026-09, jev-1.13.0)

- Latency ~0.5–0.6 s per multi-question request; ~250 fixed input-token
  overhead; pricing ~$0.042/1M input tokens (whole 46-question probe battery
  ≈ $0.0001). 429/529 retried with backoff automatically.
- Jev is strong at evidence semantics: possible ≠ observed ≠ certain, concern
  ≠ defect, missing test ≠ failed test — and at numeric comparison, where
  pi-kev is weak. That's the main reason to keep the opt-in.
- Egress log (`jev_cli.py status`) covers hosted calls only.

## Fair-comparison rule (standing)

Jev embodies 2+ years of funded expert development; kev/Pi-Kev is self-trained.
When comparing: label Jev a reference ceiling (never a verdict on kev), report
three tiers (heuristics floor / Pi-Kev / Jev ceiling), and foreground the delta
we cause (stock kev-0.5b → Pi-Kev on identical fixtures). Judge Pi-Kev on
domain-narrow competence, not generalist parity.

## Service management (local transport)

The launchd agent `local.pi-kev-4b` serves the model; plist at
`~/Library/LaunchAgents/local.pi-kev-4b.plist`, logs at
`~/Library/Logs/pi-kev-4b.log`:

```bash
curl -s http://127.0.0.1:8012/api/info                      # what's served
launchctl bootout gui/501/local.pi-kev-4b                   # stop
launchctl bootstrap gui/501 \
  ~/Library/LaunchAgents/local.pi-kev-4b.plist              # start/swap model
```

To serve a different run: edit `--run` in the plist, bootout + bootstrap.
KeepAlive restarts it after crashes; it starts at login.

## Key handling (hosted transport only)

The API key lives in the macOS Keychain: service `typesafe-ai`, account `jev`
(`security find-generic-password -s typesafe-ai -a jev -w`). Never paste keys
into chat (session logs are potential training data), dotfiles, or commits.
The client also honours a `TYPESAFE_API_KEY` env var as fallback.

## Fallbacks

1. Local service down → restart via launchctl (above); it self-heals crashes.
2. Internal state + local down → deterministic heuristics, or defer; NEVER
   route internal state to hosted Jev to "get an answer anyway".
3. Public-shaped state + local down → hosted Jev (with its gate) or heuristics.

For API/SDK depth, prompts, and cookbooks, load the vendored `typesafe-ai`
skill or the live docs at `https://docs.typesafe.ai/` (index: `llms.txt`).
