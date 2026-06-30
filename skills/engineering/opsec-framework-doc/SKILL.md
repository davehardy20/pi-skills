---
name: opsec-framework-doc
description: >-
  Create structured OpSec framework documentation for authorized red-team and
  threat-emulation work. Use when Dave asks for operational security
  documentation from notes, research, web/Obsidian sources, existing markdown,
  or script-heavy procedures; includes discovery, similarity checks,
  archive/history management, humanized Markdown output, and extracted script
  references.
compatibility: >-
  Designed for Pi. Uses web/Obsidian/search tools and the humanizer skill when
  available; otherwise records missing-source gaps. Optional TypeScript
  document-management helpers live in scripts/document-manager.ts and are
  validated with Node 26+ type stripping.
metadata:
  source: "Ported from Dave's OpenCode opsec-framework-doc skill in ~/Desktop/opsec-framework-doc."
---

# OpSec Framework Documentation

Create internal OpSec procedure documents for authorized red-team and threat-emulation work.
The output is a humanized Markdown document based on the bundled
[template](assets/opsec-document-template.md), with document discovery, similarity checks,
archive/history safety, source citations, execution checklists, and script extraction guidance.

## Safety and scope

- Work only on authorized internal documentation and lab/engagement material.
- Treat bundled sample scripts as reference material, not auto-executed helpers.
- Do not run offensive examples unless Dave explicitly asks and the target/lab authorization is clear.
- Preserve technical accuracy during humanization; never soften warnings, prerequisites, or
  detection notes.

## Workflow contract

Complete these gates in order:

1. **Scope input** — identify whether the request starts from raw notes, research, existing docs,
   or a new topic.
2. **Discover first** — scan the target documentation directory before creating content. Use
   [document management](references/document-management.md), or the optional helper in
   [document-manager.ts](scripts/document-manager.ts), for deterministic discovery, similarity,
   and archive tasks.
3. **Research and cite** — gather internal sources first when available, then external sources.
   Use [workflow](references/workflow.md) for source priority and synthesis rules.
4. **Apply template** — structure the document with the bundled template and required sections in
   [document structure](references/document-structure.md).
5. **Extract scripts** — when code blocks are present, create standalone script references and
   supporting files using [script management](references/script-management.md).
6. **Generate checklist** — derive the OpSec Execution Checklist from prerequisites, procedure
   steps, OpSec considerations, and cleanup requirements.
7. **Humanize** — invoke `humanizer` if available, then verify code blocks, citations, checklist
   items, and technical terms were preserved.
8. **Archive before mutation** — before merge, overwrite, or major amendment, copy originals to
   `archive/` with timestamps and write a manifest.
9. **Update history** — increment the Document History table and mention archive paths for
   modified documents.
10. **Final evidence** — report output path, sources used, archive proof, script validation
    status, and any unavailable source/tool gaps.

Do not declare completion until the final evidence exists.

## Output standard

Every generated or updated document must include:

- title and metadata;
- clickable Table of Contents immediately after metadata;
- Description;
- Subject Matter Details with prerequisites, procedure, code examples, and detection avoidance /
  OpSec considerations;
- OpSec Execution Checklist;
- References grouped by internal sources, external sources, tools used, and extracted scripts;
- Document History;
- Notes for limitations, assumptions, and validation gaps.

## Branches

- **Raw notes**: parse notes, fill gaps through research, convert steps and snippets into the template.
- **Research-based**: define scope, search internal/external sources, synthesize, then template.
- **Existing document update**: discover, score similarity, ask before merge/amend/overwrite,
  archive first, then update history.
- **Script-heavy document**: extract each code block into `scripts/{language}/`, create
  README/dependency files, validate syntax only unless safe execution is explicitly authorized.

## References

- [Workflow](references/workflow.md)
- [Document structure](references/document-structure.md)
- [Document management](references/document-management.md)
- [Script management](references/script-management.md)
- [OpSec framework primer](references/opsec-framework.md)
- [Bundled template](assets/opsec-document-template.md)
- [Sample scripts and test data](examples/README.md)
