# OpSec documentation workflow

## Input triage

Classify the request before writing:

- **Raw notes**: pasted text, note files, OPLOG fragments, command notes, or draft sections.
- **Research**: a topic, technique, actor TTP, tool, or procedure requiring source gathering.
- **Existing document update**: a target `.md` file or directory with overlapping documentation.
- **Script-heavy procedure**: content where code blocks should become standalone script references.

Ask only for missing information that blocks safe output, such as target directory, intended audience,
classification label, or whether a similar existing document should be merged or left untouched.

## Source priority

Use sources in this order:

1. Internal notes and previous exercise material, including Obsidian when available.
2. Dave-provided sample data and engagement-specific notes.
3. Public documentation and vendor/MITRE references.
4. General web sources for examples, edge cases, and current behavior.

Record unavailable sources explicitly. Do not invent citations.

## Research synthesis

For each source, capture:

- what it supports;
- any operational constraints;
- relevant detection or telemetry notes;
- tool/version assumptions;
- whether the source is internal, external, or user-provided.

Prefer internal sources for team-specific process. Prefer external references for vendor behavior,
protocol details, MITRE mapping, event IDs, and tool documentation.

## Generation sequence

1. Discover existing docs and calculate overlap before drafting.
2. Build a source map grouped by internal, external, tools, and user-provided notes.
3. Fill the template with concise operator-focused prose.
4. Add code blocks only where they help execution or validation.
5. Convert prerequisites, procedure steps, OpSec notes, and cleanup into checklist items.
6. Extract scripts from code blocks into standalone files when creating a deliverable repo.
7. Humanize prose while preserving technical content exactly.
8. Verify links, anchors, code fences, scripts, and document history.

## Humanizer handoff

When using the `humanizer` skill, preserve:

- code blocks and command syntax;
- tool names, registry paths, LDAP attributes, event IDs, CVEs, and MITRE technique IDs;
- section headings and Table of Contents anchors;
- references and citation labels;
- OpSec checklist checkbox syntax;
- warning text and authorization boundaries.

After humanization, compare the final document against the pre-humanized draft for technical drift.
