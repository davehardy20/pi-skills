# Document structure

Use [the bundled template](../assets/opsec-document-template.md) unless Dave gives a different
house style.

## Required sections

1. Title and metadata.
2. Table of Contents.
3. Description.
4. Subject Matter Details.
5. OpSec Execution Checklist.
6. References.
7. Document History.
8. Notes.

## Metadata

Default fields:

```markdown
# {{TITLE}}

**Classification:** Internal Use Only
**Framework:** OpSec Procedures
**Last Updated:** {{DATE}}
**Author:** {{AUTHOR}}
```

Use a stricter classification only when Dave or the source material requires it.

## Table of Contents

Place the TOC immediately after metadata and a horizontal rule, before Description.

Required anchor style:

- lowercase;
- spaces converted to hyphens;
- punctuation removed except hyphens;
- hierarchy represented by indented Markdown bullets.

Baseline TOC:

```markdown
## Table of Contents

- [Description](#description)
- [Subject Matter Details](#subject-matter-details)
  - [Prerequisites](#prerequisites)
  - [Procedure](#procedure)
  - [Code Examples](#code-examples)
  - [Detection Avoidance / OpSec Considerations](#detection-avoidance--opsec-considerations)
- [OpSec Execution Checklist](#opsec-execution-checklist)
  - [Pre-Execution Verification](#pre-execution-verification)
  - [During Execution](#during-execution)
  - [OpSec Verification](#opsec-verification)
  - [Post-Execution Cleanup](#post-execution-cleanup)
- [References](#references)
  - [Internal Sources](#internal-sources)
  - [External Sources](#external-sources)
  - [Tools Used](#tools-used)
- [Document History](#document-history)
- [Notes](#notes)

---
```

## Subject Matter Details

Include:

- prerequisites and assumptions;
- step-by-step procedure;
- code examples or commands;
- detection avoidance and OpSec considerations;
- alternate lower-risk approaches when available;
- known limitations.

## OpSec Execution Checklist

Insert the checklist between OpSec considerations and References.

Populate it from:

- prerequisites as pre-execution verification;
- numbered procedure steps as during-execution items;
- detection vectors and countermeasures as OpSec verification;
- standard cleanup items as post-execution cleanup.

Always include post-execution cleanup items for artifact cleanup, log review, OPLOG/timeline
updates, effectiveness notes, and document history updates.

## References

Group references as:

- Internal Sources;
- External Sources;
- Tools Used;
- Script References, when code was extracted.

Each reference must either be a reachable link, a local file path, or a clearly labelled internal
source that cannot be linked.

## Document History

Use this table:

```markdown
| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | Name | Initial document creation |
```

Increment minor versions for amendments, for example `1.0` to `1.1`. Increment the major version
for substantial rewrites, for example `1.4` to `2.0`.

When an archive is created, include the archive path in the change note.
