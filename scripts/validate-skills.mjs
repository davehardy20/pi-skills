#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

JSON.parse(readFileSync("package.json", "utf8"));

const skillFiles = [];
const markdownFiles = [];

function walk(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			walk(path);
			continue;
		}
		if (entry.name === "SKILL.md") skillFiles.push(path);
		if (entry.name.endsWith(".md")) markdownFiles.push(path);
	}
}

function frontmatterValue(frontmatter, key) {
	const line = frontmatter
		.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]
		?.trim();
	if (line && line !== ">-") return line.replace(/^['"]|['"]$/g, "");

	const block = frontmatter.match(
		new RegExp(`^${key}:\\s*>-\\s*\\n([\\s\\S]*?)(?:\\n[a-zA-Z-]+:|$)`, "m"),
	)?.[1];
	return block?.replace(/\n\s*/g, " ").trim();
}

walk("skills");

const names = new Map();
for (const file of skillFiles) {
	const text = readFileSync(file, "utf8");
	const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!frontmatter) throw new Error(`${file}: missing frontmatter`);

	const name = frontmatterValue(frontmatter, "name");
	const description = frontmatterValue(frontmatter, "description");

	if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
		throw new Error(`${file}: invalid skill name '${name ?? ""}'`);
	}
	if (!description) throw new Error(`${file}: missing description`);
	if (names.has(name))
		throw new Error(`duplicate skill name '${name}' in ${file}`);
	names.set(name, file);
}

const markdownLink = /\[[^\]]+]\(([^)]+)\)/g;
for (const file of markdownFiles) {
	const directory = dirname(file);
	const text = readFileSync(file, "utf8");
	for (const match of text.matchAll(markdownLink)) {
		const target = match[1];
		if (/^(https?:|mailto:|#)/.test(target)) continue;

		const [targetPath] = target.split("#");
		if (!targetPath) continue;

		const resolved = resolve(directory, decodeURI(targetPath));
		if (!existsSync(resolved)) {
			throw new Error(`${file}: broken local link '${target}'`);
		}
	}
}

console.log(
	`skills validation ok: ${skillFiles.length} skills, ${markdownFiles.length} markdown files`,
);
