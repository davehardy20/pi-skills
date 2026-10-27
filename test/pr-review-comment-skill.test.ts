import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

const skillPath = "skills/engineering/pr-review-comment/SKILL.md";
const policyPath = "~/.pi/agent/pr-review-policy.json";

async function loadSkill() {
	const text = await readFile(skillPath, "utf8");
	const header = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!header) throw new Error("skill must have YAML frontmatter");
	return { text, metadata: parse(header) };
}

// These are document/discovery contracts, not execution of an agent or a
// duplicate policy parser. Executable policy/evidence tests live in pi-config.
test("configured-reviewer comment skill is discoverable without a provider assumption", async () => {
	const { text, metadata } = await loadSkill();
	assert.equal(metadata.name, "pr-review-comment");
	assert.notEqual(metadata["disable-model-invocation"], true);
	assert.match(metadata.description, /configured reviewer/i);
	assert.match(metadata.description, /review comments/i);
	assert.ok(!/\b(?:Codex|Greptile)\b/i.test(text));
	assert.ok(!/@[a-z][a-z0-9-]* review/i.test(text));
});

test("requires fresh validated policy and blocks unavailable or unsupported configuration", async () => {
	const { text } = await loadSkill();
	assert.ok(text.includes(policyPath));
	assert.match(text, /before each review-status check/i);
	assert.match(text, /read and validate/i);
	assert.match(text, /version.?1/i);
	assert.match(text, /github-check/);
	assert.match(text, /missing.*invalid.*unsupported/is);
	assert.match(text, /no fallback/i);
	assert.match(text, /policy changes/i);
	assert.match(text, /discard.*evidence/is);
});

test("requires exact-HEAD configured-check evidence rather than a narrative approval", async () => {
	const { text } = await loadSkill();
	for (const field of [
		"externalReviewer.checkName",
		"headRefOid",
		"statusCheckRollup",
		"COMPLETED/SUCCESS",
	]) {
		assert.ok(text.includes(field), `missing ${field}`);
	}
	assert.match(
		text,
		/missing,\s+pending,\s+failed,\s+skipped,\s+neutral,\s+stale/i,
	);
	assert.match(text, /narrative.*not.*evidence/is);
	assert.match(text, /bracketed/i);
	assert.match(text, /required CI/);
	assert.match(text, /sensitive.path/i);
});

test("does not equate policy labels with authenticated comment authors", async () => {
	const { text } = await loadSkill();
	assert.match(text, /id.*displayName.*labels/is);
	assert.match(text, /not.*verified.*author/is);
	assert.match(text, /provenance/i);
	assert.match(text, /ambiguous.*ask Dave/is);
	assert.match(text, /do not guess/i);
	assert.match(text, /Required fix/);
	assert.match(text, /Optional suggestion/);
	assert.match(text, /No action/);
	assert.match(text, /kev: null/);
});

test("reads all unresolved threads and uses compatible JSON-only inspection examples", async () => {
	const { text } = await loadSkill();
	const threads = text.match(
		/3\. \*\*Read unresolved review threads\*\*([\s\S]*?)(?=4\. \*\*)/,
	)?.[1];
	if (!threads) throw new Error("missing unresolved-thread step");
	assert.match(threads, /unresolved=true/);
	assert.match(threads, /outdated/i);
	assert.ok(!/notOutdated=true|--not_outdated/.test(threads));
	assert.ok(!/gh pr view[^\n]*--comments[^\n]*--json/.test(text));
	assert.match(text, /gh pr view[^\n]*--json/);
});

test("keeps publication authorization, review-before-push and exact fixed-thread resolution", async () => {
	const { text } = await loadSkill();
	assert.match(text, /publication.*authoriz|authoriz.*publication/is);
	assert.match(text, /commit → `pr_review` → PASS → push/);
	assert.match(text, /remote PR HEAD/);
	assert.match(text, /pr_thread_resolve/);
	assert.match(text, /outdated.*not.*substitute.*resolution/is);
	assert.match(text, /unfixed.*deferred.*disputed/is);
	assert.match(text, /closed or merged PRs/);
	assert.match(text, /only when safe wrappers are unavailable/);
});

test("package guidance and examples discover only the generalized skill", async () => {
	const [readme, instructions, pr, manifest] = await Promise.all([
		readFile("README.md", "utf8"),
		readFile("AGENTS.md", "utf8"),
		readFile("skills/engineering/pr/SKILL.md", "utf8"),
		readFile("package.json", "utf8"),
	]);
	assert.match(readme, /\/skill:pr-review-comment/);
	assert.ok(instructions.includes(skillPath));
	for (const text of [readme, instructions, pr]) {
		assert.ok(!/codex-pr-comment|Codex connector|CI, Codex/i.test(text));
	}
	assert.ok(pr.includes(policyPath));
	assert.match(pr, /configured.*review/is);
	assert.match(pr, /writing aid, not a PR workflow/);
	assert.ok(JSON.parse(manifest).pi.skills.includes("./skills"));
	const legacyPath = "skills/engineering/codex-pr-comment/SKILL.md";
	await expect(access(legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
});
