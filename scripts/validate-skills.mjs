#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const configuredSkillRoots = manifest.pi?.skills;
if (!Array.isArray(configuredSkillRoots) || configuredSkillRoots.length === 0) {
	throw new Error(
		"package.json: pi.skills must contain at least one skill root",
	);
}

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

for (const configuredRoot of configuredSkillRoots) {
	if (typeof configuredRoot !== "string") {
		throw new Error("package.json: every pi.skills entry must be a string");
	}
	const root = resolve(configuredRoot);
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(
			`package.json: pi.skills entry '${configuredRoot}' is not a directory`,
		);
	}
	walk(root);
}

const names = new Map();
for (const file of skillFiles) {
	const text = readFileSync(file, "utf8");
	const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (!frontmatter) throw new Error(`${file}: missing frontmatter`);

	const document = parseDocument(frontmatter);
	if (document.errors.length > 0) {
		throw new Error(`${file}: invalid YAML frontmatter: ${document.errors[0]}`);
	}
	const metadata = document.toJS();
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
		throw new Error(`${file}: frontmatter must be a YAML mapping`);
	}
	const { name, description } = metadata;

	if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
		throw new Error(`${file}: invalid skill name '${name ?? ""}'`);
	}
	if (typeof description !== "string" || !description.trim()) {
		throw new Error(`${file}: missing description`);
	}
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
