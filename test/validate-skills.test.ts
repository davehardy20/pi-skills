import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, test } from "vitest";

const validatorPath = resolve("scripts/validate-skills.mjs");
const temporaryDirectories: string[] = [];

async function createWorkspace(
	manifest: unknown = { pi: { skills: ["./skills"] } },
): Promise<string> {
	const directory = await mkdtemp(joinTempPath());
	temporaryDirectories.push(directory);
	await writeFile(
		`${directory}/package.json`,
		JSON.stringify(manifest),
		"utf8",
	);
	return directory;
}

function joinTempPath(): string {
	return `${tmpdir()}/pi-skills-validator-`;
}

async function writeSkill(
	workspace: string,
	directory: string,
	frontmatter: string,
): Promise<void> {
	const skillDirectory = `${workspace}/skills/${directory}`;
	await mkdir(skillDirectory, { recursive: true });
	await writeFile(
		`${skillDirectory}/SKILL.md`,
		`---\n${frontmatter}\n---\n\n# Test skill\n`,
		"utf8",
	);
}

function runValidator(workspace: string) {
	return spawnSync(process.execPath, [validatorPath], {
		cwd: workspace,
		encoding: "utf8",
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("accepts valid YAML frontmatter", async () => {
	const workspace = await createWorkspace();
	await writeSkill(
		workspace,
		"valid",
		'name: valid-skill\ndescription: "A valid skill"',
	);

	const result = runValidator(workspace);

	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /skills validation ok: 1 skills/);
});

test("accepts block-scalar descriptions", async () => {
	const workspace = await createWorkspace();
	await writeSkill(
		workspace,
		"block-description",
		"name: block-description\ndescription: >-\n  Reviews a change while preserving\n  the complete description.",
	);

	const result = runValidator(workspace);

	assert.equal(result.status, 0, result.stderr);
});

test("rejects malformed YAML frontmatter", async () => {
	const workspace = await createWorkspace();
	await writeSkill(
		workspace,
		"malformed",
		"name: malformed\ndescription: [unterminated",
	);

	const result = runValidator(workspace);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /invalid YAML frontmatter/);
});

test("rejects a missing configured skill root", async () => {
	const workspace = await createWorkspace({
		pi: { skills: ["./missing-skills"] },
	});

	const result = runValidator(workspace);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /is not a directory/);
});

test("rejects a configured skill root that is a file", async () => {
	const workspace = await createWorkspace({ pi: { skills: ["./skills"] } });
	await writeFile(`${workspace}/skills`, "not a directory", "utf8");

	const result = runValidator(workspace);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /is not a directory/);
});

test("rejects non-string configured skill roots", async () => {
	const workspace = await createWorkspace({ pi: { skills: [42] } });

	const result = runValidator(workspace);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /every pi\.skills entry must be a string/);
});

test("rejects duplicate skill names across configured roots", async () => {
	const workspace = await createWorkspace({
		pi: { skills: ["./skills", "./more-skills"] },
	});
	await writeSkill(
		workspace,
		"first",
		"name: duplicate-name\ndescription: First skill",
	);
	const secondDirectory = `${workspace}/more-skills/second`;
	await mkdir(secondDirectory, { recursive: true });
	await writeFile(
		`${secondDirectory}/SKILL.md`,
		"---\nname: duplicate-name\ndescription: Second skill\n---\n",
		"utf8",
	);

	const result = runValidator(workspace);

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /duplicate skill name 'duplicate-name'/);
});
