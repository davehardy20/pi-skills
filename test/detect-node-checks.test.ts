import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve("scripts/detect-node-checks.mjs");

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
	dirs.length = 0;
});

async function makeRepo(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(resolve(tmpdir(), "detect-"));
	dirs.push(dir);
	await Promise.all(
		Object.entries(files).map(([name, content]) =>
			writeFile(resolve(dir, name), content),
		),
	);
	return dir;
}

function runIn(dir: string) {
	const res = spawnSync(process.execPath, [scriptPath], {
		cwd: dir,
		encoding: "utf8",
	});
	return { code: res.status, out: res.stdout.trim(), err: res.stderr };
}

function asMap(out: string): Record<string, string> {
	return Object.fromEntries(out.split("\n").map((l) => l.split("=")));
}

describe("detect-node-checks", () => {
	it("reports everything absent in an empty repo", async () => {
		const dir = await makeRepo({});
		expect(asMap(runIn(dir).out)).toEqual({
			has_package_json: "false",
			has_lockfile: "false",
			has_lint: "false",
			has_typecheck: "false",
			has_typecheck_script: "false",
			has_test: "false",
			has_test_script: "false",
			has_validate_skills: "false",
			has_build: "false",
			has_audit: "false",
		});
	});

	it("detects scripts for a package.json-only repo", async () => {
		const dir = await makeRepo({
			"package.json": JSON.stringify({
				scripts: {
					typecheck: "tsc",
					test: "vitest run",
					"validate:skills": "node x.mjs",
				},
			}),
		});
		const caps = asMap(runIn(dir).out);
		expect(caps.has_package_json).toBe("true");
		expect(caps.has_typecheck).toBe("true");
		expect(caps.has_typecheck_script).toBe("true");
		expect(caps.has_test).toBe("true");
		expect(caps.has_test_script).toBe("true");
		expect(caps.has_validate_skills).toBe("true");
		expect(caps.has_lint).toBe("false");
		expect(caps.has_build).toBe("false");
	});

	it("falls back to config files when scripts are absent", async () => {
		const dir = await makeRepo({
			"package.json": JSON.stringify({ scripts: {} }),
			"tsconfig.json": "{}",
			"vitest.config.ts": "export default {}",
		});
		const caps = asMap(runIn(dir).out);
		expect(caps.has_typecheck).toBe("true");
		expect(caps.has_typecheck_script).toBe("false");
		expect(caps.has_test).toBe("true");
		expect(caps.has_test_script).toBe("false");
	});

	it("ignores jest configs — the fallback only runs vitest", async () => {
		const dir = await makeRepo({
			"package.json": JSON.stringify({ scripts: {} }),
			"jest.config.js": "export default {}",
		});
		expect(asMap(runIn(dir).out).has_test).toBe("false");
	});

	it("detects lockfile and audit together", async () => {
		const dir = await makeRepo({
			"package.json": JSON.stringify({ scripts: {} }),
			"package-lock.json": "{}",
		});
		const caps = asMap(runIn(dir).out);
		expect(caps.has_lockfile).toBe("true");
		expect(caps.has_audit).toBe("true");
	});

	it("fails with an actionable message on malformed package.json", async () => {
		const dir = await makeRepo({ "package.json": "{not json" });
		const { code, err } = runIn(dir);
		expect(code).toBe(1);
		expect(err).toContain("package.json is not valid JSON");
	});
});
