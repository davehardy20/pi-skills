import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const skillPath = "skills/engineering/code-review/SKILL.md";

async function readSkill(): Promise<string> {
	return readFile(skillPath, "utf8");
}

test("defines independent Standards and Seeds-backed Intent review axes", async () => {
	const skill = await readSkill();

	assert.match(skill, /\*\*Standards\*\*/);
	assert.match(skill, /\*\*Intent\*\*/);
	assert.match(skill, /Run both axes as isolated, read-only sub-agents/);
	assert.match(skill, /Use `orchestrate` in parallel mode/);
});

test("keeps Seeds and reviewers read-only", async () => {
	const skill = await readSkill();

	assert.match(skill, /Seeds is evidence, not the review destination/);
	assert.match(
		skill,
		/never create, update, close, relate, submit, review, validate, or record an/,
	);
	assert.match(
		skill,
		/reviewers never edit files, stage changes, commit, push, or open\/update a PR/,
	);
});

test("returns findings to the parent agent for remediation", async () => {
	const skill = await readSkill();

	assert.match(
		skill,
		/Return this report as the skill result in the current agent context/,
	);
	assert.match(skill, /Remediation owner: parent agent/);
	assert.match(skill, /does not close Seeds work or declare/);
});

test("reviews incremental child scope and worktree changes", async () => {
	const skill = await readSkill();

	assert.match(
		skill,
		/Do not flag other planned children as missing during an incremental review/,
	);
	assert.match(skill, /staged, unstaged, and relevant\s+untracked files/);
	assert.match(skill, /Do not silently\s+assume `main`/);
});

test("falls back to narrow read-only Git inspection", async () => {
	const skill = await readSkill();

	assert.match(skill, /If safe Git tools are unavailable/);
	assert.match(
		skill,
		/read-only status, diff, ref resolution, merge-base, and commit-list inspection/,
	);
	assert.match(skill, /Never use raw Git to mutate state during review/);
});
