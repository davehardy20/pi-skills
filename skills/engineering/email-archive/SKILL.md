---
name: email-archive
description: >-
  Search Dave's digest archive — the Hermes email-archive HTTP API on the LAN —
  for threat intel across digests (talkback, hn-security, sec-ai-news,
  github-trending, vuln-watch, ai-sec-research, threat-intel). Use when the
  user asks to search digests or the archive for a CVE, actor, tool, or
  keyword, pull a full digest email, or check archive coverage and freshness.
metadata:
  source: "Authored for the Hermes email-archive service running on the bench."
---

# Email Archive Search

Query the digest archive Hermes serves from the bench and report only what the
API returns.

## Access contract

- Base URL: `http://192.168.0.157:8737` (bench on the LAN; reachable via the
  Tailscale exit node).
- HTTP API only — never SSH to the bench for archive reads.
- Read-only surface: search, list, fetch. There is no write path.
- Drive it with `bash` + `curl -s --max-time 15`. If unreachable, report once
  and stop; do not retry-loop.

## Endpoints

| Endpoint | Use |
| --- | --- |
| `GET /` | self-describing JSON doc — authoritative endpoint list |
| `GET /health` | liveness (`{"ok": true}`) |
| `GET /stats` | total emails + per-digest counts — the coverage/freshness check |
| `GET /search?q=<FTS5>` | ranked items; filters: `&digest=<name> &days=<N> &limit=<N>` |
| `GET /email?id=N` | full email incl. HTML + all items (ids from search; `&subject=` substring works too) |
| `GET /emails?digest=<name>&limit=N` | recent emails, newest first |

Item fields: `sent_at, digest, section, kind, title, url, source, snippet,
meta{...}, rank`.

## Workflow

1. **Freshness** — when coverage matters, `GET /stats` first: an empty or stale
   digest list changes how to read zero-result searches.
2. **Search** — build one balanced FTS5 query (rules below), send with
   `curl -G --data-urlencode` so quoting survives the shell.
3. **Extract** — pipe JSON through `python3 -c` to print compact lines; never
   paste raw JSON into the reply.
4. **Detail** — for items that matter, `GET /email?id=<id>` and pull the
   relevant items by keyword.

Completion criterion: every reported fact (dates, CVE ids, titles, URLs) comes
from an API response, and zero results are reported as zero — never invented.

## FTS5 rules

- Operators: `AND OR NOT` (uppercase), `"exact phrase"`, `prefix*`,
  `NEAR(a b, N)`, `-excluded`.
- **Malformed queries 500** with a raw FTS5 error (e.g. unterminated `"`).
  Check quote balance before sending.
- `days` must be an integer — anything else 500s with a raw Python traceback.
- An unknown `digest=` filter returns **200 with empty results**, not an error.
  If a filtered search is unexpectedly empty, cross-check the digest name
  against `/stats`.

## Extraction patterns

Validated recipes — keep output bounded, large raw dumps get context-pruned:

```bash
B=http://192.168.0.157:8737

# Compact hit list
curl -s --max-time 15 -G "$B/search" \
  --data-urlencode "q=ransomware OR wiper" \
  --data-urlencode "limit=20" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in d['results']:
    print(f\"{r['sent_at'][:10]} [{r['digest']}/{r['section']}] {r['title']}\")"

# Full items from one email, filtered by keyword
curl -s --max-time 15 "$B/email?id=411" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('Subject:', d.get('subject'), '| Sent:', d.get('sent_at'))
for it in d.get('items',[]):
    blob=(str(it.get('title',''))+str(it.get('snippet',''))).lower()
    if 'netscaler' in blob:
        print(f\"--- [{it['kind']}] {it.get('section')}\")
        print('   title:', it.get('title'))
        print('   snip :', (it.get('snippet') or '')[:200])
        print('   url  :', it.get('url'))"
```

## Digests

`talkback` (general security news) · `hn-security` (Hacker News security
threads) · `sec-ai-news` (AI-security news) · `github-trending` (trending
security repos/PoCs) · `vuln-watch` (CVEs, CISA KEV, PoC releases) ·
`ai-sec-research` (AI-security research) · `threat-intel` (actor/campaign
reporting). Current counts live in `GET /stats`.
