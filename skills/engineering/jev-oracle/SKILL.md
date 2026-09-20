---
name: jev-oracle
description: >-
  Consult Jev (TypeSafe AI's hosted System One model) for fast, typed, probabilistic
  semantic judgments over synthetic or public-shaped state: yes/no probabilities
  (noul), one-of-a-set choices, and ordered scores. Use automatically whenever a
  task needs semantic classification, routing, ranking, evidence-strength or
  modality judgments, hypothetical or counterfactual evaluation, benchmarking of
  kev / Pi-Kev against the Jev ceiling, or labelling of evaluation fixtures. Hard
  rule: never send internal repository content, session data, filesystem paths, or
  secrets to this hosted model — synthetic and public-shaped state only. Falls
  back to local heuristics or the local kev server when offline or unauthorised.
license: MIT
metadata:
  source: "Local wrapper around TypeSafe AI's hosted Jev API; upstream skill: typesafe-ai (vendored in this repo)."
---

# Jev oracle

Jev is a hosted decision model: unstructured state in, typed probabilistic
decisions out — no text generation, no JSON-parsing failures. Use it as a cheap
judgment primitive (questions cost fractions of a cent and answer in ~0.5 s),
while keeping policy, thresholds, and composition in code.

## HARD PRIVACY GATE (read before every use)

Jev is hosted. Everything sent leaves this machine.

- **Send only synthetic or public-shaped state.** Example fixtures, invented
  tickets, generic engineering prose, docs examples — fine.
- **Never send:** internal repository code or diffs, session transcripts, agent
  run data, filesystem paths, internal project names, customer or business data,
  credentials, tokens, or anything from threat-emulation work.
- **When in doubt, don't send.** Reword the question around a synthetic minimal
  example instead, or use the local kev server / heuristics.
- Use `--dry-run` (below) to inspect the exact payload before it leaves the box.
- Every real request is appended to a local egress log (hashes and token counts
  only, no content) — check it with `jev_cli.py status`.

## How to call

Client + CLI live at `~/tools/pi-kev/experiments/jev-probe/`:

```bash
# 1. ALWAYS dry-run first when the state is newly written: prints the exact payload
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "Socket cleanup may fail when a worker terminates unexpectedly." \
  --questions-file questions.json --dry-run

# 2. Real call (cached automatically; egress-logged)
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py ask \
  --state "..." --questions-file questions.json

# 3. Audit: keychain status, cache stats, egress tail
python3 ~/tools/pi-kev/experiments/jev-probe/jev_cli.py status
```

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

Python: `from jev import evaluate; evaluate(state, questions)` (same directory).

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

## Practical norms (measured 2026-09, jev-1.13.0)

- Latency ~0.5–0.6 s per multi-question request; ~250 fixed input-token overhead
  per request; pricing ~$0.042/1M input tokens (whole 46-question probe battery ≈ $0.0001).
- 429/529 are retried with backoff automatically by the client.
- `confidence` is distribution concentration, not correctness. A noul near 0.5
  means the evidence genuinely cuts both ways.
- Jev is strong at evidence semantics: possible ≠ observed ≠ certain, concern ≠
  defect, missing test ≠ failed test. Lean on that.

## Fair-comparison rule (standing)

Jev embodies 2+ years of funded expert development; kev/Pi-Kev is self-trained.
When comparing: label Jev a reference ceiling (never a verdict on kev), report
three tiers (heuristics floor / Pi-Kev / Jev ceiling), and foreground the delta
we cause (stock kev-0.5b → Pi-Kev on identical fixtures). Judge Pi-Kev on
domain-narrow competence, not generalist parity.

## Key handling

The API key lives in the macOS Keychain: service `typesafe-ai`, account `jev`
(`security find-generic-password -s typesafe-ai -a jev -w`). Never paste keys
into chat (session logs are potential training data), dotfiles, or commits. The
client also honours a `TYPESAFE_API_KEY` env var as fallback.

## Fallbacks when Jev is unavailable or the state is internal

1. Reword around a synthetic minimal example and send that.
2. Local kev server (`kev serve` in `~/tools/kev`, TypeSafe-compatible
   `/v1/systemone`) — fine for internal state, weaker accuracy.
3. Deterministic heuristics — the floor; often enough.

For API/SDK depth, prompts, and cookbooks, load the vendored `typesafe-ai` skill
or the live docs at `https://docs.typesafe.ai/` (index: `llms.txt`).
