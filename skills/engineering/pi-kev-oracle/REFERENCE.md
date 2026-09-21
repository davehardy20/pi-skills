---
name: pi-kev-oracle-reference
description: Disclosed reference for pi-kev-oracle — service management, endpoint resolution, hosted-Jev norms, benchmark context, and the fair-comparison rule. Loaded on demand; SKILL.md carries the procedure.
license: MIT
---

# Pi-Kev oracle — reference

Material the everyday judgment run does not need. `SKILL.md` is the
procedure; this file is the shelf.

## Service management (local transport)

The launchd agent `local.pi-kev-4b` serves the model; plist at
`~/Library/LaunchAgents/local.pi-kev-4b.plist`, logs at
`~/Library/Logs/pi-kev-4b.log` (+ `.err.log`). KeepAlive restarts it after
crashes; it starts at login and binds 127.0.0.1 only.

```bash
curl -s http://127.0.0.1:8012/api/info        # what's served right now
launchctl bootout gui/501/local.pi-kev-4b     # stop
launchctl bootstrap gui/501 \
  ~/Library/LaunchAgents/local.pi-kev-4b.plist  # start
```

To serve a different run (e.g. after a re-train): stop training/serving
first, edit `--run` in the plist, bootout + bootstrap, and verify
`/api/info` reports the intended run. Old runs stay on disk for rollback.
Responses still report model id `jev-latest` regardless of the served run —
trust `/api/info`, not response metadata, for run identity.

## Endpoint resolution (client-enforced)

Precedence, highest first:

1. Explicit caller argument (`--hosted` maps to the hosted URL)
2. `SYSTEMONE_API_URL` env var (grading scripts rely on this)
3. Local service if a TCP probe to `127.0.0.1:8012` succeeds
4. Fail closed: local service down + nothing set → error, nothing sent
   (start the service, set `SYSTEMONE_API_URL`, or pass `--hosted`)

`jev_cli.py status` shows the resolved endpoint and whether the local
service is up. Responses carry `"endpoint": "local" | "hosted"`. Hosted
requests are egress-logged (hashes and token counts only, no content);
local requests never leave the machine.

## Hosted Jev norms and key handling

Measured 2026-09 (jev-1.13.0): latency ~0.5–0.6 s per multi-question
request; ~250 fixed input-token overhead per request; pricing ~$0.042/1M
input tokens. 429/529 are retried with backoff automatically. Jev is strong
at evidence semantics (possible ≠ observed ≠ certain, concern ≠ defect,
missing test ≠ failed test) and at numeric comparison, where Pi-Kev is
weak — the main reasons to keep the opt-in.

The API key lives in the macOS Keychain: service `typesafe-ai`, account
`jev` (`security find-generic-password -s typesafe-ai -a jev -w`). Never
paste keys into chat, dotfiles, or commits. A `TYPESAFE_API_KEY` env var
takes precedence if set; the Keychain is the fallback.

## Benchmark context

Single source of truth for scores:
`~/tools/pi-kev/evals/pi-kev-eval-v1/baselines.json` (frozen exam,
checksummed suites, per-variant detail). Check it for current numbers —
do not trust copies, including this one.

As of 2026-09-21: pi-kev-4b-v2 leads at 94/95 (98.9%), ahead of hosted
Jev's 91/95, winning or tying every variant head-to-head. Lineage: stock
kev-0.5b floor → v0.1 45 → v0.2 50 → v0.3 64 → v0.4 71 → 4B v1 88 → 4B v2
94, all trained locally on frozen curricula v1–v5.

## Fair-comparison rule (standing)

Jev embodies 2+ years of funded expert development; kev/Pi-Kev is
self-trained. When comparing: label Jev a reference ceiling (never a
verdict on kev), report three tiers (heuristics floor / Pi-Kev / Jev
ceiling), and foreground the delta we cause (stock kev-0.5b → Pi-Kev on
identical fixtures). Judge Pi-Kev on domain-narrow competence, not
generalist parity.

For API/SDK depth, prompts, and cookbooks, load the vendored `typesafe-ai`
skill or the live docs at `https://docs.typesafe.ai/` (index: `llms.txt`).
