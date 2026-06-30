import assert from "node:assert/strict";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	addHistoryEntry,
	archiveDocuments,
	calculateSimilarity,
	detectConflicts,
	discoverDocuments,
	ensureArchiveDir,
	findSimilarDocuments,
	flagConflictsInDocument,
	generateArchiveManifest,
	generateExecutionChecklist,
	getNextVersion,
	mergeDocuments,
	parseDocumentMetadata,
	parseHistoryTable,
	parseMarkdownSections,
} from "../skills/engineering/opsec-framework-doc/scripts/document-manager.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "opsec-doc-test-"));
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("discovers markdown recursively while excluding archive directories", async () => {
	await withTempDir(async (dir) => {
		await mkdir(join(dir, "nested"), { recursive: true });
		await mkdir(join(dir, "archive"), { recursive: true });
		await writeFile(
			join(dir, "guide.md"),
			"# DNS OpSec Guide\n\n## Description\nDNS enumeration guidance.\n\n## Procedure\nDo the work.\n",
			"utf8",
		);
		await writeFile(
			join(dir, "nested", "notes.md"),
			"# Nested Notes\n\n## Summary\nInternal note.\n",
			"utf8",
		);
		await writeFile(join(dir, "archive", "old.md"), "# Archived\n", "utf8");

		const docs = await discoverDocuments(dir);

		assert.deepEqual(
			docs.map((doc) => doc.filename),
			["guide.md", "notes.md"],
		);
		assert.equal(docs[0]?.title, "DNS OpSec Guide");
		assert.equal(docs[0]?.descriptionPreview, "DNS enumeration guidance.");
	});
});

test("reports discovery failures instead of silently ignoring them", async () => {
	await withTempDir(async (dir) => {
		let rootFailed = false;
		try {
			await discoverDocuments(join(dir, "missing"));
		} catch {
			rootFailed = true;
		}
		assert.equal(rootFailed, true);

		const locked = join(dir, "locked");
		await mkdir(locked);
		await chmod(locked, 0);
		try {
			const docs = await discoverDocuments(dir);
			assert.equal(
				docs.some((doc) => doc.filename === "locked" && doc.error),
				true,
			);
		} finally {
			await chmod(locked, 0o700);
		}
	});
});

test("skips symlinked directories during recursive discovery", async () => {
	await withTempDir(async (dir) => {
		await mkdir(join(dir, "nested"));
		await writeFile(join(dir, "guide.md"), "# Guide\n", "utf8");
		await writeFile(join(dir, "nested", "nested.md"), "# Nested\n", "utf8");
		await symlink(dir, join(dir, "nested", "loop"));

		const docs = await discoverDocuments(dir);

		assert.deepEqual(
			docs.map((doc) => doc.filename),
			["guide.md", "nested.md"],
		);
	});
});

test("scores similar documents above threshold", async () => {
	await withTempDir(async (dir) => {
		const existingPath = join(dir, "spn-guide.md");
		const incomingPath = join(dir, "spn-notes.md");
		await writeFile(
			existingPath,
			"# SPN Enumeration Guide\n\n## Description\nGuide for enumerating service principal names safely.\n\n## Procedure\nQuery LDAP.\n",
			"utf8",
		);
		await writeFile(
			incomingPath,
			"# SPN Enumeration Notes\n\n## Description\nNotes for enumerating service principal names with OpSec.\n\n## Procedure\nQuery LDAP carefully.\n",
			"utf8",
		);

		const existing = await parseDocumentMetadata(existingPath);
		const incoming = await parseDocumentMetadata(incomingPath);
		const score = calculateSimilarity(incoming, existing);
		const matches = findSimilarDocuments(incoming, [existing], 0.55);

		assert.ok(score.score > 0.55);
		assert.equal(matches.length, 1);
		assert.equal(matches[0]?.doc2.filename, "spn-guide.md");
	});
});

test("archives by copying originals and writing a manifest", async () => {
	await withTempDir(async (dir) => {
		const source = join(dir, "guide.md");
		await writeFile(source, "# Guide\n", "utf8");

		const archiveDir = await ensureArchiveDir(dir);
		const archived = await archiveDocuments([source], archiveDir, {
			now: new Date("2026-06-30T18:00:00Z"),
			calculateChecksums: true,
		});
		const manifest = await generateArchiveManifest(
			archived,
			source,
			archiveDir,
			new Date("2026-06-30T18:01:00Z"),
		);

		assert.equal(await readFile(source, "utf8"), "# Guide\n");
		assert.match(
			archived[0]?.archivedPath ?? "",
			/2026-06-30_18-00_guide\.md$/,
		);
		assert.ok(archived[0]?.checksum);
		assert.match(await readFile(manifest, "utf8"), /guide\.md/);
	});
});

test("merges sections and flags contradictory guidance", () => {
	const base = [
		"# Guide",
		"",
		"## Procedure",
		"Operators must enable logging.",
		"",
		"## References",
		"- Internal note",
		"",
	].join("\n");
	const incoming = [
		"# Guide",
		"",
		"## Procedure",
		"Operators must not enable logging.",
		"",
		"## Notes",
		"Review with blue team.",
		"",
	].join("\n");

	const conflicts = detectConflicts(base, incoming);
	const merged = mergeDocuments(base, incoming, "new notes");
	const flagged = flagConflictsInDocument(merged, conflicts);

	assert.equal(conflicts.length, 1);
	assert.match(merged, /Update from new notes/);
	assert.match(merged, /## Notes/);
	assert.match(flagged, /OPSEC-DOC-CONFLICT/);
	assert.ok(flagged.trimStart().startsWith("# Guide"));
	assert.match(flagged, /## Conflict Review/);
});

test("skips incoming top-level titles during merge", () => {
	const base = "# Existing Guide\n\n## Procedure\nBase procedure.\n";
	const incoming = "# Incoming Guide\n\n## Notes\nIncoming notes.\n";
	const merged = mergeDocuments(base, incoming, "incoming");

	assert.match(merged, /^# Existing Guide$/m);
	assert.match(merged, /^## Notes$/m);
	assert.equal(/^# Incoming Guide$/m.test(merged), false);
});

test("ignores markdown headings inside fenced code blocks", () => {
	const codeBlock = [
		"```bash",
		"#!/bin/bash",
		"# OpSec: comment inside script",
		"## not a markdown section",
		"echo done",
		"```",
	].join("\n");
	const base = ["# Guide", "", "## Code Examples", codeBlock, ""].join("\n");
	const incoming = ["# Guide", "", "## Notes", "Keep code intact.", ""].join(
		"\n",
	);

	const parsed = parseMarkdownSections(base);
	const merged = mergeDocuments(base, incoming, "notes");

	assert.deepEqual(
		parsed.sections.map((section) => section.title),
		["Guide", "Code Examples"],
	);
	assert.match(
		merged,
		new RegExp(codeBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	);
	assert.equal(
		parsed.sections.some(
			(section) => section.title === "not a markdown section",
		),
		false,
	);
});

test("does not flag identical negated guidance as a conflict", () => {
	const base = "# Guide\n\n## Procedure\nOperators must not enable logging.\n";
	const incoming =
		"# Guide\n\n## Procedure\nOperators must not enable logging.\n";

	assert.deepEqual(detectConflicts(base, incoming), []);
});

test("parses and appends document history entries", () => {
	const content = [
		"# Guide",
		"",
		"**Last Updated:** 2026-06-01  ",
		"",
		"## Document History",
		"",
		"| Version | Date | Author | Changes |",
		"|---------|------|--------|---------|",
		"| 1.9 | 2026-06-01 | Dave | Initial document creation |",
		"",
	].join("\n");

	const entries = parseHistoryTable(content);
	const next = getNextVersion(entries);
	const updated = addHistoryEntry(content, {
		version: next,
		date: "2026-06-30",
		author: "Nyx",
		changes: "Merged source notes and archived original.",
	});

	const nextAgain = getNextVersion(parseHistoryTable(updated));
	const updatedAgain = addHistoryEntry(updated, {
		version: nextAgain,
		date: "2026-07-01",
		author: "Nyx",
		changes: "Second update.",
	});

	assert.equal(next, "2.0");
	assert.equal(nextAgain, "2.1");
	assert.equal(parseHistoryTable(updatedAgain).length, 3);
	assert.match(updatedAgain, /\*\*Last Updated:\*\* 2026-07-01/);
	assert.match(updatedAgain, /Merged source notes/);
	assert.match(updatedAgain, /Second update/);
});

test("generates execution checklist from procedure inputs", () => {
	const checklist = generateExecutionChecklist({
		prerequisites: ["Lab approved", "OPLOG ready"],
		procedureSteps: ["Run syntax validation", "Review telemetry"],
		opsecMeasures: ["Throttle noisy queries"],
	});

	assert.match(checklist, /Pre-Execution Verification/);
	assert.match(checklist, /Step 1 completed/);
	assert.match(checklist, /Throttle noisy queries/);
	assert.match(checklist, /Document history updated/);
});
