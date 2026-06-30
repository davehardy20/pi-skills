# Document management

The document lifecycle prevents duplicate OpSec guides and protects originals before risky edits.

## Discovery

Before creating or updating a document:

1. Identify the target documentation directory.
2. Recursively scan Markdown files, excluding `archive/`, `.git/`, `node_modules/`, and generated
   script dependency directories.
3. Parse each file's title, Description/Overview/Summary preview, and headings.
4. Keep a discovery list in the final evidence summary.

The optional TypeScript helper in `../scripts/document-manager.ts` implements this behavior for
maintainers and tests. Agents may still perform the same steps manually when easier.

## Similarity scoring

Use an 80% threshold for merge prompts. Score overlap with:

- title similarity;
- description/content preview similarity;
- section heading similarity.

If a candidate is at or above threshold, do not silently create a duplicate. Present the choices:

- **Merge**: integrate new material into the existing document.
- **Amend**: append/refine sections without replacing the core structure.
- **Create new**: keep documents separate when the scope is genuinely different.
- **Skip/cancel**: leave existing documentation untouched.
- **Overwrite**: replace only after explicit confirmation and archive first.

## Archive-before-mutation rule

Archive before any merge, overwrite, or major amendment.

The ported Pi behavior is **copy, then mutate**. This resolves the source skill's mixed language
about moving versus backing up originals: originals remain in place for the edit, while timestamped
copies provide rollback.

Archive procedure:

1. Create `archive/` under the target directory.
2. Copy every original file to a timestamped path such as
   `archive/2026-06-30_1800_original.md`.
3. Resolve name conflicts with numeric suffixes.
4. Optionally record checksums.
5. Write `archive/manifest.txt` describing sources, archived copies, target document, and time.
6. Mention archive paths in Document History.

## Merge rules

When merging:

- preserve existing frontmatter and metadata where possible;
- keep the existing document's title unless Dave requests a rename;
- add missing sections from the incoming document;
- append non-duplicate incoming content to matching sections;
- preserve all code fences exactly;
- insert conflict markers for contradictory content instead of guessing.

Conflict marker format:

```markdown
<!-- OPSEC-DOC-CONFLICT: Existing and incoming guidance differ. Review manually. -->
```

## Amend rules

When amending:

- add a dated subsection for new material if it does not fit cleanly;
- update related checklist and references;
- increment Document History;
- cite archive copies when existing material changed.

## Final evidence

Report:

- target directory scanned;
- similar documents and scores;
- chosen action and who confirmed it;
- archive files created;
- merged/created document path;
- version number and history entry;
- conflicts left for manual review.
