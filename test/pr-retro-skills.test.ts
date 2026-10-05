import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { parse } from "yaml";

const paths = {
	pr: "skills/engineering/pr",
	retro: "skills/engineering/retro",
	writing: "skills/productivity/writing-for-agents",
};

async function load(directory: string) {
	const text = await readFile(`${directory}/SKILL.md`, "utf8");
	const header = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!header) throw new Error("skill must have YAML frontmatter");
	return { text, metadata: parse(header) };
}

test("pr is discoverable and limited to PR descriptions", async () => {
	const { text, metadata } = await load(paths.pr);
	assert.equal(metadata.name, "pr");
	assert.notEqual(metadata["disable-model-invocation"], true);
	assert.match(metadata.description, /PR description/);
	assert.match(metadata.description, /does not create, review, or merge PRs/i);
	for (const heading of ["Summary", "Evidence", "Merge Danger"]) {
		assert.ok(text.includes(`## ${heading}`));
	}
	assert.match(text, /existing.*review.*publication.*gates/i);
	assert.match(text, /not measured/);
	assert.match(text, /Never invent/);
	assert.match(text, /GLOSSARY\.md.*when.*exists/);
	assert.match(text, /Plain prose\s+is\s+sufficient/);
});

test("retro is manual, read-only and loads its bundled writing dependency", async () => {
	const { text, metadata } = await load(paths.retro);
	assert.equal(metadata.name, "retro");
	assert.equal(metadata["disable-model-invocation"], true);
	assert.ok(text.includes("../../productivity/writing-for-agents/SKILL.md"));
	assert.match(text, /`read`/);
	assert.ok(!/Call the Skill tool/.test(text));
	assert.match(text, /read-only/);
	assert.match(text, /unrelated session logs/);
	assert.match(text, /Redact secrets/);
	assert.match(text, /missing evidence/);
	assert.match(text, /approved improvements.*Seeds/);
	assert.match(text, /Mulch.*validated.*outcome/);
	assert.match(text, /implementation\s+must\s+follow\s+those standards/i);
});

test("writing-for-agents is discoverable with Pi-native mechanics", async () => {
	const { text, metadata } = await load(paths.writing);
	assert.equal(metadata.name, "writing-for-agents");
	assert.notEqual(metadata["disable-model-invocation"], true);
	assert.ok(text.includes("[`SKILL-MECHANICS.md`](SKILL-MECHANICS.md)"));
	const mechanics = await readFile(
		`${paths.writing}/SKILL-MECHANICS.md`,
		"utf8",
	);
	assert.match(mechanics, /\/skill:name/);
	assert.match(mechanics, /explicit.*`read`/);
	assert.ok(!/no other skill can/.test(mechanics));
	assert.ok(!/or another skill must/.test(mechanics));
});

test("imports preserve upstream attribution, licence and PR credits", async () => {
	for (const directory of Object.values(paths)) {
		const attribution = await readFile(`${directory}/ATTRIBUTION.md`, "utf8");
		assert.match(attribution, /Matt Pocock/);
		assert.match(attribution, /4588b32ecab9ecc9fc8cc6b6c5e7d675b6004b0d/);
		assert.match(attribution, /MIT License/);
		assert.match(attribution, /Copyright \(c\) 2026 Matt Pocock/);
		assert.match(attribution, /THE SOFTWARE IS PROVIDED "AS IS"/);
	}
	const { metadata } = await load(paths.pr);
	assert.equal(metadata.metadata.credits.author, "Dex Horthy");
	const credits = await readFile(`${paths.pr}/CREDITS.md`, "utf8");
	assert.match(credits, /Dex Horthy/);
});

test("package discovers imports and validates their local links", () => {
	const result = spawnSync(process.execPath, ["scripts/validate-skills.mjs"], {
		cwd: ".",
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /skills validation ok/);
});
