import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";

const skillPath = "skills/engineering/email-archive/SKILL.md";
const temporaryDirectories: string[] = [];

async function runRecipes(failureCode = 0) {
	const skill = await readFile(skillPath, "utf8");
	const example = skill.match(/```bash\n([\s\S]*?)\n```/)?.[1];
	if (!example) throw new Error("Skill must include executable bash recipes");
	const directory = await mkdtemp(join(tmpdir(), "email-archive-recipes-"));
	temporaryDirectories.push(directory);
	await writeFile(
		join(directory, "curl"),
		`#!/bin/sh
if [ "${failureCode}" != "0" ]; then
  echo 'curl: simulated request failure' >&2
  exit ${failureCode}
fi
printf '%s' '{"results":[{"sent_at":"2026-09-30","digest":"vuln-watch","section":"KEV","title":"NetScaler test hit"}],"subject":"Fixture email","sent_at":"2026-09-30","items":[{"kind":"cve","section":"KEV","title":"NetScaler test hit","snippet":"fixture","url":"https://example.invalid/"}]}'
`,
		"utf8",
	);
	await chmod(join(directory, "curl"), 0o700);
	return spawnSync("bash", ["-c", example], {
		cwd: directory,
		encoding: "utf8",
		env: { ...process.env, PATH: `${directory}:${process.env.PATH ?? ""}` },
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("both recipes parse successful responses", async () => {
	const result = await runRecipes();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stderr, "");
	assert.match(result.stdout, /\[vuln-watch\/KEV\] NetScaler test hit/);
	assert.match(result.stdout, /Subject: Fixture email/);
});

for (const [kind, code] of [
	["HTTP", 22],
	["network", 7],
] as const) {
	test(`both recipes report ${kind} failure without JSON parsing`, async () => {
		const result = await runRecipes(code);
		assert.equal(result.stdout, "");
		assert.equal(/Traceback|JSONDecodeError/.test(result.stderr), false);
		assert.equal(
			result.stderr.match(/Archive request failed/g)?.length,
			2,
			result.stderr,
		);
	});
}

test("FTS5 guidance quotes CVEs and uses binary NOT", async () => {
	const skill = await readFile(skillPath, "utf8");
	assert.match(skill, /`"CVE-2026-19490"`/);
	assert.match(skill, /`ransomware NOT wiper`/);
	assert.equal(/`-excluded`/.test(skill), false);
});
