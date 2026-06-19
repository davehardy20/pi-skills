# Learning Record Format

Learning records live in `learning-records/` and use sequential filenames:

```text
0001-<slug>.md
0002-<slug>.md
```

Create `learning-records/` lazily, only when the first record is justified.

Learning records are the teaching equivalent of ADRs: they capture non-obvious
lessons, prior knowledge, corrected misconceptions, and mission shifts that
should steer future teaching.

## Template

```md
# {Short title}

{1-3 sentences: what was learned or established, and why it matters for future
sessions.}
```

That is usually enough. The value is recording that this is now known and why it
changes what to teach next.

## Optional sections

Use these only when they add real value.

```md
---
status: active
---

## Evidence

{How Dave demonstrated understanding: an answer, exercise, prior experience, or
correction.}

## Implications

{What this unlocks or rules out for future sessions.}
```

For superseded records, prefer:

```yaml
status: superseded by LR-0007
```

## Numbering

Scan `learning-records/` for the highest existing number and increment by one.
Do not reuse numbers.

## Write a record when

- Dave demonstrates genuine understanding of a non-trivial concept.
- Dave discloses prior knowledge and its depth matters.
- A misconception is corrected.
- The mission changes because of learning.

## Do not write a record for

- material merely covered;
- a normal session log;
- a term already captured tightly in `GLOSSARY.md`;
- a vague impression without evidence.
