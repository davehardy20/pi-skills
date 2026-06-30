import { createHash } from "node:crypto";
import {
	access,
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

export interface DocumentInfo {
	filename: string;
	filepath: string;
	title?: string;
	descriptionPreview?: string;
	sectionHeaders: string[];
	error?: string;
}

export interface SimilarityScore {
	doc1: DocumentInfo;
	doc2: DocumentInfo;
	score: number;
	titleSimilarity: number;
	descriptionSimilarity: number;
	sectionSimilarity: number;
}

export interface DiscoverOptions {
	recursive?: boolean;
	excludeDirs?: string[];
	maxLinesToRead?: number;
}

export interface ArchiveOptions {
	now?: Date;
	calculateChecksums?: boolean;
	copy?: boolean;
}

export interface ArchivedFile {
	originalPath: string;
	archivedPath: string;
	checksum?: string;
}

export interface HistoryEntry {
	version: string;
	date: string;
	author: string;
	changes: string;
}

export interface Section {
	level: number;
	title: string;
	normalizedTitle: string;
	parentPath: string[];
	body: string;
}

export interface ParsedDocument {
	preface: string;
	sections: Section[];
}

export interface Conflict {
	section: string;
	severity: "low" | "medium" | "high";
	reason: string;
	existingSnippet: string;
	incomingSnippet: string;
}

export interface ChecklistInput {
	prerequisites?: string[];
	procedureSteps?: string[];
	opsecMeasures?: string[];
}

const DEFAULT_EXCLUDED_DIRS = new Set([
	".git",
	".mulch",
	".seeds",
	"archive",
	"node_modules",
	"__pycache__",
]);

const MIN_TOKEN_LENGTH = 2;
const TITLE_WEIGHT = 0.3;
const DESCRIPTION_WEIGHT = 0.4;
const SECTIONS_WEIGHT = 0.3;

export function normalizeHeading(title: string): string {
	return title
		.trim()
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
}

export function tokenize(text: string): string[] {
	const matches = text.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
	return matches.filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

export function jaccardSimilarity(
	left: Set<string>,
	right: Set<string>,
): number {
	if (left.size === 0 && right.size === 0) return 1;
	const intersection = [...left].filter((item) => right.has(item)).length;
	const union = new Set([...left, ...right]).size;
	return union === 0 ? 0 : intersection / union;
}

function editDistanceRatio(left: string, right: string): number {
	if (left === right) return 1;
	if (left.length === 0 || right.length === 0) return 0;

	const previous = Array.from(
		{ length: right.length + 1 },
		(_, index) => index,
	);
	const current = Array.from({ length: right.length + 1 }, () => 0);

	for (let i = 1; i <= left.length; i += 1) {
		current[0] = i;
		for (let j = 1; j <= right.length; j += 1) {
			const cost = left[i - 1] === right[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);
		}
		previous.splice(0, previous.length, ...current);
	}

	const distance = previous[right.length] ?? 0;
	return 1 - distance / Math.max(left.length, right.length);
}

export function calculateTitleSimilarity(
	title1?: string,
	title2?: string,
): number {
	if (!title1 && !title2) return 1;
	if (!title1 || !title2) return 0;

	const left = title1.trim().toLowerCase();
	const right = title2.trim().toLowerCase();
	if (left === right) return 1;

	const leftTokens = new Set(tokenize(title1));
	const rightTokens = new Set(tokenize(title2));
	const jaccard = jaccardSimilarity(leftTokens, rightTokens);
	const fuzzy = editDistanceRatio(left, right);
	let semanticBonus = 0;

	for (const leftToken of leftTokens) {
		for (const rightToken of rightTokens) {
			if (
				leftToken.length >= 4 &&
				rightToken.length >= 4 &&
				leftToken.slice(0, 4) === rightToken.slice(0, 4)
			) {
				semanticBonus += 0.2;
			} else if (
				leftToken.includes(rightToken) ||
				rightToken.includes(leftToken)
			) {
				semanticBonus += 0.08;
			}
		}
	}

	return Math.min(
		0.35 * jaccard + 0.45 * fuzzy + Math.min(semanticBonus, 0.4),
		1,
	);
}

export function calculateDescriptionSimilarity(
	desc1?: string,
	desc2?: string,
): number {
	if (!desc1 && !desc2) return 1;
	if (!desc1 || !desc2) return 0;

	const tokens1 = tokenize(desc1);
	const tokens2 = tokenize(desc2);
	if (tokens1.length === 0 && tokens2.length === 0) return 1;
	if (tokens1.length === 0 || tokens2.length === 0) return 0;

	const vocabulary = [...new Set([...tokens1, ...tokens2])].sort();
	const documentFrequency = new Map<string, number>();

	for (const term of vocabulary) {
		documentFrequency.set(
			term,
			Number(tokens1.includes(term)) + Number(tokens2.includes(term)),
		);
	}

	const vectorFor = (tokens: string[]): number[] => {
		const counts = new Map<string, number>();
		for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

		return vocabulary.map((term) => {
			const termFrequency = (counts.get(term) ?? 0) / tokens.length;
			const inverseDocumentFrequency =
				Math.log(3 / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
			return termFrequency * inverseDocumentFrequency;
		});
	};

	const vector1 = vectorFor(tokens1);
	const vector2 = vectorFor(tokens2);
	const dot = vector1.reduce(
		(sum, value, index) => sum + value * (vector2[index] ?? 0),
		0,
	);
	const magnitude1 = Math.sqrt(
		vector1.reduce((sum, value) => sum + value * value, 0),
	);
	const magnitude2 = Math.sqrt(
		vector2.reduce((sum, value) => sum + value * value, 0),
	);

	if (magnitude1 === 0 || magnitude2 === 0) return 0;
	return dot / (magnitude1 * magnitude2);
}

export function calculateSectionSimilarity(
	sections1: string[],
	sections2: string[],
): number {
	const left = new Set(sections1.map(normalizeHeading).filter(Boolean));
	const right = new Set(sections2.map(normalizeHeading).filter(Boolean));
	if (left.size === 0 && right.size === 0) return 1;

	const exact = jaccardSimilarity(left, right);
	let fuzzyMatches = 0;

	for (const leftSection of left) {
		if (
			[...right].some(
				(rightSection) => editDistanceRatio(leftSection, rightSection) >= 0.82,
			)
		) {
			fuzzyMatches += 1;
		}
	}

	const fuzzy = fuzzyMatches / Math.max(left.size, right.size, 1);
	return Math.max(exact, fuzzy);
}

export function calculateSimilarity(
	doc1: DocumentInfo,
	doc2: DocumentInfo,
): SimilarityScore {
	const titleSimilarity = calculateTitleSimilarity(doc1.title, doc2.title);
	const descriptionSimilarity = calculateDescriptionSimilarity(
		doc1.descriptionPreview,
		doc2.descriptionPreview,
	);
	const sectionSimilarity = calculateSectionSimilarity(
		doc1.sectionHeaders,
		doc2.sectionHeaders,
	);
	const score =
		TITLE_WEIGHT * titleSimilarity +
		DESCRIPTION_WEIGHT * descriptionSimilarity +
		SECTIONS_WEIGHT * sectionSimilarity;

	return {
		doc1,
		doc2,
		score,
		titleSimilarity,
		descriptionSimilarity,
		sectionSimilarity,
	};
}

export function findSimilarDocuments(
	target: DocumentInfo,
	candidates: DocumentInfo[],
	threshold = 0.8,
): SimilarityScore[] {
	return candidates
		.filter((candidate) => candidate.filepath !== target.filepath)
		.map((candidate) => calculateSimilarity(target, candidate))
		.filter((pair) => pair.score >= threshold)
		.sort((left, right) => right.score - left.score);
}

function cleanDescription(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]+`/g, "")
		.replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

interface HeadingCandidate {
	index: number;
	bodyStart: number;
	level: number;
	title: string;
}

function extractMarkdownHeadings(content: string): HeadingCandidate[] {
	const headings: HeadingCandidate[] = [];
	const lines = content.match(/[^\n]*(?:\n|$)/g) ?? [];
	let offset = 0;
	let inFence = false;
	let fenceMarker = "";

	for (const rawLine of lines) {
		if (rawLine.length === 0) break;

		const lineText = rawLine.replace(/\r?\n$/, "");
		const fence = lineText.match(/^\s*(```+|~~~+)/);

		if (fence?.[1]) {
			const marker = fence[1].slice(0, 3);
			if (!inFence) {
				inFence = true;
				fenceMarker = marker;
			} else if (marker === fenceMarker) {
				inFence = false;
				fenceMarker = "";
			}
			offset += rawLine.length;
			continue;
		}

		if (!inFence) {
			const heading = lineText.match(/^(#{1,6})\s+(.+)$/);
			if (heading?.[1] && heading[2]) {
				headings.push({
					index: offset,
					bodyStart: offset + rawLine.length,
					level: heading[1].length,
					title: heading[2].trim(),
				});
			}
		}

		offset += rawLine.length;
	}

	return headings;
}

function extractDescriptionPreview(
	content: string,
	maxLength: number,
): string | undefined {
	const headings = extractMarkdownHeadings(content);
	const wanted = new Set(["description", "overview", "summary"]);

	for (const [index, heading] of headings.entries()) {
		if (!wanted.has(normalizeHeading(heading.title))) continue;

		const end = headings[index + 1]?.index ?? content.length;
		const description = cleanDescription(content.slice(heading.bodyStart, end));
		if (description.length === 0) continue;
		return description.length > maxLength
			? `${description.slice(0, maxLength - 3)}...`
			: description;
	}

	return undefined;
}

export async function parseDocumentMetadata(
	filepath: string,
	options: DiscoverOptions = {},
): Promise<DocumentInfo> {
	const maxLinesToRead = options.maxLinesToRead ?? 120;
	const filename = basename(filepath);

	try {
		const content = (await readFile(filepath, "utf8"))
			.split(/\r?\n/)
			.slice(0, maxLinesToRead)
			.join("\n");
		const headings = extractMarkdownHeadings(content);
		const title = headings.find((heading) => heading.level === 1)?.title;
		const sectionHeaders = headings.map((heading) => heading.title);
		const descriptionPreview = extractDescriptionPreview(content, 500);

		return { filename, filepath, title, descriptionPreview, sectionHeaders };
	} catch (error) {
		return {
			filename,
			filepath,
			sectionHeaders: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function discoverDocuments(
	targetDir: string,
	options: DiscoverOptions = {},
): Promise<DocumentInfo[]> {
	const recursive = options.recursive ?? true;
	const excluded = new Set([
		...DEFAULT_EXCLUDED_DIRS,
		...(options.excludeDirs ?? []),
	]);
	const root = resolve(targetDir);
	const documents: DocumentInfo[] = [];

	const recordPathError = (path: string, message: string): void => {
		documents.push({
			filename: basename(path),
			filepath: path,
			sectionHeaders: [],
			error: message,
		});
	};

	const walk = async (directory: string, isRoot = false): Promise<void> => {
		let entries: string[];
		try {
			entries = await readdir(directory);
		} catch (error) {
			const message = `Failed to read directory: ${formatError(error)}`;
			if (isRoot) {
				throw new Error(
					`Failed to read target directory ${directory}: ${formatError(error)}`,
				);
			}
			recordPathError(directory, message);
			return;
		}

		for (const entry of entries) {
			const path = join(directory, entry);
			let stats: Awaited<ReturnType<typeof lstat>>;
			try {
				stats = await lstat(path);
			} catch (error) {
				recordPathError(path, `Failed to inspect path: ${formatError(error)}`);
				continue;
			}

			if (stats.isSymbolicLink()) continue;

			if (stats.isDirectory()) {
				if (recursive && !excluded.has(entry)) await walk(path);
				continue;
			}

			if (stats.isFile() && extname(entry).toLowerCase() === ".md") {
				documents.push(await parseDocumentMetadata(path, options));
			}
		}
	};

	await walk(root, true);
	return documents.sort((left, right) =>
		relative(root, left.filepath).localeCompare(relative(root, right.filepath)),
	);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function formatTimestamp(date: Date): string {
	const pad = (value: number): string => value.toString().padStart(2, "0");
	return [
		date.getUTCFullYear(),
		"-",
		pad(date.getUTCMonth() + 1),
		"-",
		pad(date.getUTCDate()),
		"_",
		pad(date.getUTCHours()),
		"-",
		pad(date.getUTCMinutes()),
	].join("");
}

async function uniqueDestination(path: string): Promise<string> {
	if (!(await pathExists(path))) return path;

	const directory = dirname(path);
	const extension = extname(path);
	const stem = basename(path, extension);

	for (let counter = 1; counter <= 10_000; counter += 1) {
		const candidate = join(directory, `${stem}_${counter}${extension}`);
		if (!(await pathExists(candidate))) return candidate;
	}

	throw new Error(`Unable to resolve archive name conflict for ${path}`);
}

export async function ensureArchiveDir(targetDir: string): Promise<string> {
	const archiveDir = join(targetDir, "archive");
	await mkdir(archiveDir, { recursive: true });
	return archiveDir;
}

export async function archiveDocuments(
	filepaths: string[],
	archiveDir: string,
	options: ArchiveOptions = {},
): Promise<ArchivedFile[]> {
	await mkdir(archiveDir, { recursive: true });
	const timestamp = formatTimestamp(options.now ?? new Date());
	const archived: ArchivedFile[] = [];

	for (const filepath of filepaths) {
		const stats = await lstat(filepath);
		if (stats.isSymbolicLink()) {
			throw new Error(`Refusing to archive symbolic link: ${filepath}`);
		}

		const destination = await uniqueDestination(
			join(archiveDir, `${timestamp}_${basename(filepath)}`),
		);
		const content = await readFile(filepath, "utf8");
		const checksum = options.calculateChecksums
			? createHash("sha256").update(content).digest("hex")
			: undefined;

		await copyFile(filepath, destination);
		archived.push({
			originalPath: filepath,
			archivedPath: destination,
			checksum,
		});
	}

	return archived;
}

export async function generateArchiveManifest(
	archivedFiles: ArchivedFile[],
	mergedDoc: string,
	archiveDir: string,
	now = new Date(),
): Promise<string> {
	await mkdir(archiveDir, { recursive: true });
	const manifestPath = join(archiveDir, "manifest.txt");
	const lines = [
		"Archive Manifest",
		"================",
		`Generated: ${now.toISOString()}`,
		"",
		"Archived Files:",
		"---------------",
	];

	const targetRoot = dirname(resolve(archiveDir));
	const manifestPathFor = (path: string): string => {
		const absolute = resolve(path);
		const relativePath = relative(targetRoot, absolute);
		if (
			relativePath &&
			!relativePath.startsWith("..") &&
			relativePath !== "."
		) {
			return relativePath;
		}
		return absolute;
	};

	for (const [index, file] of archivedFiles.entries()) {
		lines.push(
			`${index + 1}. originalPath: ${manifestPathFor(file.originalPath)}`,
		);
		lines.push(`   archivedPath: ${manifestPathFor(file.archivedPath)}`);
		if (file.checksum) lines.push(`   checksumSha256: ${file.checksum}`);
	}

	lines.push(
		"",
		"Merge Operation:",
		"----------------",
		`- mergedDocumentPath: ${manifestPathFor(mergedDoc)}`,
	);
	await writeFile(manifestPath, `${lines.join("\n")}\n`, "utf8");
	return manifestPath;
}

export function parseMarkdownSections(content: string): ParsedDocument {
	const headings = extractMarkdownHeadings(content);
	if (headings.length === 0) return { preface: content, sections: [] };

	const preface = content.slice(0, headings[0]?.index ?? 0);
	const sections: Section[] = [];
	const hierarchy: Array<{ level: number; normalizedTitle: string }> = [];

	for (let index = 0; index < headings.length; index += 1) {
		const heading = headings[index];
		const next = headings[index + 1];
		const end = next?.index ?? content.length;
		const normalizedTitle = normalizeHeading(heading.title);

		while (hierarchy.length > 0) {
			const parent = hierarchy[hierarchy.length - 1];
			if (parent && parent.level < heading.level) break;
			hierarchy.pop();
		}

		sections.push({
			level: heading.level,
			title: heading.title,
			normalizedTitle,
			parentPath: hierarchy
				.filter((parent) => parent.level > 1)
				.map((parent) => parent.normalizedTitle),
			body: trimSectionBody(content.slice(heading.bodyStart, end)),
		});
		hierarchy.push({ level: heading.level, normalizedTitle });
	}

	return { preface, sections };
}

function trimSectionBody(body: string): string {
	return body.replace(/^(?:[^\S\n]*\n)+/, "").replace(/\s+$/, "");
}

export function sectionsToMarkdown(parsed: ParsedDocument): string {
	const renderedSections = parsed.sections.map((section) => {
		const heading = `${"#".repeat(section.level)} ${section.title}`;
		return section.body
			? `${heading}\n\n${trimSectionBody(section.body)}\n`
			: `${heading}\n`;
	});

	return `${`${parsed.preface}${renderedSections.join("\n")}`.trimEnd()}\n`;
}

function compactText(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function sectionKey(section: Section): string {
	return [section.level, ...section.parentPath, section.normalizedTitle].join(
		"\0",
	);
}

function groupSectionsByKey(sections: Section[]): Map<string, Section[]> {
	const groups = new Map<string, Section[]>();
	for (const section of sections) {
		const key = sectionKey(section);
		const existing = groups.get(key);
		if (existing) existing.push(section);
		else groups.set(key, [section]);
	}
	return groups;
}

function describeSectionPath(section: Section): string {
	return [...section.parentPath, section.normalizedTitle].join(" > ");
}

function ambiguityConflict(section: Section, reason: string): Conflict {
	return {
		section: section.title,
		severity: "medium",
		reason,
		existingSnippet: `Section path: ${describeSectionPath(section)}`,
		incomingSnippet: snippet(section.body),
	};
}

function pathsMatch(left: string[], right: string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function insertionIndexForMissingSection(
	sections: Section[],
	incomingSection: Section,
): { index: number; conflict?: Conflict } {
	if (incomingSection.parentPath.length === 0)
		return { index: sections.length };

	const parentTitle =
		incomingSection.parentPath[incomingSection.parentPath.length - 1];
	const parentPath = incomingSection.parentPath.slice(0, -1);
	const parents = sections
		.map((section, index) => ({ section, index }))
		.filter(
			({ section }) =>
				section.normalizedTitle === parentTitle &&
				section.level < incomingSection.level &&
				pathsMatch(section.parentPath, parentPath),
		);

	if (parents.length === 0) return { index: sections.length };
	if (parents.length > 1) {
		return {
			index: sections.length,
			conflict: ambiguityConflict(
				incomingSection,
				"Manual merge required: parent section path is ambiguous.",
			),
		};
	}

	const parent = parents[0];
	if (!parent) return { index: sections.length };

	let insertAt = parent.index + 1;
	while (
		insertAt < sections.length &&
		(sections[insertAt]?.level ?? 0) > parent.section.level
	) {
		insertAt += 1;
	}
	return { index: insertAt };
}

export function mergeDocuments(
	baseContent: string,
	incomingContent: string,
	sourceLabel = "incoming document",
): string {
	const base = parseMarkdownSections(baseContent);
	const incoming = parseMarkdownSections(incomingContent);
	const baseHasTitle = base.sections.some((section) => section.level === 1);
	const baseByKey = groupSectionsByKey(base.sections);
	const incomingByKey = groupSectionsByKey(incoming.sections);
	const manualConflicts: Conflict[] = [];
	const reportedAmbiguities = new Set<string>();

	for (const incomingSection of incoming.sections) {
		if (incomingSection.level === 1 && baseHasTitle) continue;

		const key = sectionKey(incomingSection);
		const incomingMatches = incomingByKey.get(key) ?? [];
		if (incomingMatches.length > 1) {
			if (!reportedAmbiguities.has(key)) {
				manualConflicts.push(
					ambiguityConflict(
						incomingSection,
						`Manual merge required: incoming document has ${incomingMatches.length} sections with this heading path.`,
					),
				);
				reportedAmbiguities.add(key);
			}
			continue;
		}

		const baseMatches = baseByKey.get(key) ?? [];
		if (baseMatches.length > 1) {
			if (!reportedAmbiguities.has(key)) {
				manualConflicts.push(
					ambiguityConflict(
						incomingSection,
						`Manual merge required: base document has ${baseMatches.length} sections with this heading path.`,
					),
				);
				reportedAmbiguities.add(key);
			}
			continue;
		}

		const existing = baseMatches[0];

		if (!existing) {
			const placement = insertionIndexForMissingSection(
				base.sections,
				incomingSection,
			);
			if (placement.conflict) {
				manualConflicts.push(placement.conflict);
				continue;
			}
			base.sections.splice(placement.index, 0, incomingSection);
			baseByKey.set(key, [incomingSection]);
			continue;
		}

		const existingBody = compactText(existing.body);
		const incomingBody = incomingSection.body.trim();
		if (
			incomingBody.length > 0 &&
			!existingBody.includes(compactText(incomingBody))
		) {
			const reason = hasContradiction(existing.body, incomingBody);
			if (reason) {
				manualConflicts.push({
					section: existing.title,
					severity: "high",
					reason,
					existingSnippet: snippet(existing.body),
					incomingSnippet: snippet(incomingBody),
				});
			}
			existing.body = [
				existing.body.trim(),
				`### Update from ${sourceLabel}`,
				incomingBody,
			]
				.filter(Boolean)
				.join("\n\n");
		}
	}

	return flagConflictsInDocument(sectionsToMarkdown(base), manualConflicts);
}

function snippet(text: string): string {
	return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function hasContradiction(
	existing: string,
	incoming: string,
): string | undefined {
	const left = compactText(existing);
	const right = compactText(incoming);
	if (left === right) return undefined;

	const pairs: Array<[RegExp, RegExp, string]> = [
		[/\bmust\b(?!\s+not\b)/, /\bmust\s+not\b/, "must vs must not"],
		[/\bshould\b(?!\s+not\b)/, /\bshould\s+not\b/, "should vs should not"],
		[/\benable\b/, /\bdisable\b/, "enable vs disable"],
		[/\benabled\b/, /\bdisabled\b/, "enabled vs disabled"],
		[/\ballow\b/, /\bblock\b/, "allow vs block"],
		[/\ballowed\b/, /\bprohibited\b/, "allowed vs prohibited"],
		[/\brequired\b/, /\bforbidden\b/, "required vs forbidden"],
	];

	for (const [positive, negative, label] of pairs) {
		if (
			(positive.test(left) && negative.test(right)) ||
			(negative.test(left) && positive.test(right))
		) {
			return `Potential contradiction: ${label}.`;
		}
	}

	return undefined;
}

export function detectConflicts(
	baseContent: string,
	incomingContent: string,
): Conflict[] {
	const base = parseMarkdownSections(baseContent);
	const incoming = parseMarkdownSections(incomingContent);
	const baseByKey = groupSectionsByKey(base.sections);
	const incomingByKey = groupSectionsByKey(incoming.sections);
	const conflicts: Conflict[] = [];
	const reportedAmbiguities = new Set<string>();

	for (const incomingSection of incoming.sections) {
		const key = sectionKey(incomingSection);
		const baseMatches = baseByKey.get(key) ?? [];
		if (baseMatches.length === 0) continue;

		const incomingMatches = incomingByKey.get(key) ?? [];
		if (incomingMatches.length > 1 || baseMatches.length > 1) {
			if (!reportedAmbiguities.has(key)) {
				conflicts.push(
					ambiguityConflict(
						incomingSection,
						"Manual conflict review required: duplicate section paths are ambiguous.",
					),
				);
				reportedAmbiguities.add(key);
			}
			continue;
		}

		const existing = baseMatches[0];
		if (!existing) continue;

		const reason = hasContradiction(existing.body, incomingSection.body);
		if (reason) {
			conflicts.push({
				section: existing.title,
				severity: "high",
				reason,
				existingSnippet: snippet(existing.body),
				incomingSnippet: snippet(incomingSection.body),
			});
		}
	}

	return conflicts;
}

export function flagConflictsInDocument(
	content: string,
	conflicts: Conflict[],
): string {
	if (conflicts.length === 0) return content;

	const lines = [
		"## Conflict Review",
		"",
		"<!-- OPSEC-DOC-CONFLICT: Review required before finalizing this merged document. -->",
		"",
		"Resolve these items manually before treating the document as authoritative.",
		"",
	];

	for (const conflict of conflicts) {
		lines.push(
			`- **${conflict.section}** (${conflict.severity}): ${conflict.reason}`,
			`  - Existing: ${conflict.existingSnippet}`,
			`  - Incoming: ${conflict.incomingSnippet}`,
		);
	}

	return `${content.trimEnd()}\n\n${lines.join("\n")}\n`;
}

export function parseHistoryTable(content: string): HistoryEntry[] {
	const section = content.match(
		/(^|\n)##[ \t]+Document[ \t]+History[ \t]*\n([\s\S]*?)(?=\n##[ \t]+|\s*$)/i,
	)?.[2];
	if (!section) return [];

	const entries: HistoryEntry[] = [];
	for (const line of section.split(/\r?\n/)) {
		const cells = line
			.trim()
			.replace(/^\||\|$/g, "")
			.split("|")
			.map((cell) => cell.trim());

		if (
			cells.length < 4 ||
			cells[0] === "Version" ||
			/^-+$/.test(cells[0] ?? "")
		)
			continue;
		entries.push({
			version: cells[0] ?? "",
			date: cells[1] ?? "",
			author: cells[2] ?? "",
			changes: cells.slice(3).join(" | "),
		});
	}

	return entries;
}

function parseVersion(
	version: string,
): { major: number; minor: number } | null {
	const [majorPart, minorPart] = version
		.split(".")
		.map((part) => Number.parseInt(part, 10));
	if (!Number.isFinite(majorPart) || !Number.isFinite(minorPart)) return null;
	return { major: majorPart, minor: minorPart };
}

export function getNextVersion(entries: HistoryEntry[], major = false): string {
	const latest = entries.reduce<{ major: number; minor: number } | null>(
		(current, entry) => {
			const parsed = parseVersion(entry.version);
			if (!parsed) return current;
			if (!current) return parsed;
			if (parsed.major > current.major) return parsed;
			if (parsed.major === current.major && parsed.minor > current.minor) {
				return parsed;
			}
			return current;
		},
		null,
	);

	if (!latest) return "1.0";
	if (major) return `${latest.major + 1}.0`;
	return `${latest.major}.${latest.minor + 1}`;
}

function updateLastUpdated(content: string, date: string): string {
	return content.replace(
		/(\*\*Last Updated:\*\*\s*)[^\n]+/i,
		(_, prefix: string) => `${prefix}${date}  `,
	);
}

export function addHistoryEntry(content: string, entry: HistoryEntry): string {
	const row = `| ${entry.version} | ${entry.date} | ${entry.author} | ${entry.changes} |`;
	const historyHeading = content.match(
		/(^|\n)##[ \t]+Document[ \t]+History[ \t]*\n/i,
	);
	let updated: string;

	if (!historyHeading) {
		updated = `${content.trimEnd()}\n\n## Document History\n\n| Version | Date | Author | Changes |\n|---------|------|--------|---------|\n${row}\n`;
		return updateLastUpdated(updated, entry.date);
	}

	const sectionStart = (historyHeading.index ?? 0) + historyHeading[0].length;
	const nextSectionOffset = content.slice(sectionStart).search(/\n##[ \t]+/);
	const sectionEnd =
		nextSectionOffset === -1
			? content.length
			: sectionStart + nextSectionOffset;
	const historySection = content.slice(sectionStart, sectionEnd);
	const separator = /^\|[| \t:-]+\|[ \t]*$/m.exec(historySection);

	if (!separator) {
		const remainder = content.slice(sectionStart).replace(/^\n+/, "");
		const suffix = remainder.length > 0 ? `\n${remainder}` : "";
		updated = `${content.slice(0, sectionStart)}\n| Version | Date | Author | Changes |\n|---------|------|--------|---------|\n${row}\n${suffix}`;
		return updateLastUpdated(updated, entry.date);
	}

	const separatorStart = sectionStart + separator.index;
	const lineEnd = content.indexOf("\n", separatorStart);
	const insertAt =
		lineEnd === -1 || lineEnd > sectionEnd ? sectionEnd : lineEnd + 1;
	updated = `${content.slice(0, insertAt)}${row}\n${content.slice(insertAt)}`;
	return updateLastUpdated(updated, entry.date);
}

function checklistLine(prefix: string, value: string): string {
	return `- [ ] **${prefix}**: ${value.trim()}`;
}

export function generateExecutionChecklist(input: ChecklistInput): string {
	const prerequisites = input.prerequisites ?? [];
	const procedureSteps = input.procedureSteps ?? [];
	const opsecMeasures = input.opsecMeasures ?? [];

	const lines = [
		"## OpSec Execution Checklist",
		"",
		"Use this checklist to confirm procedure steps and OpSec countermeasures are complete.",
		"",
		"### Pre-Execution Verification",
		...prerequisites.map((item) =>
			checklistLine("Prerequisites confirmed", item),
		),
		"- [ ] **Testing environment prepared**: Isolated lab environment ready",
		"- [ ] **OpSec posture assessed**: Detection vectors reviewed and mitigations planned",
		"",
		"### During Execution",
		...procedureSteps.map(
			(item, index) => `- [ ] **Step ${index + 1} completed**: ${item.trim()}`,
		),
		"",
		"### OpSec Verification",
		...opsecMeasures.map((item) =>
			checklistLine("OpSec measure verified", item),
		),
		"",
		"### Post-Execution Cleanup",
		"- [ ] **Artifacts cleaned**: Temporary files, scripts, and tools removed where required",
		"- [ ] **Logs reviewed**: Detection indicators and suspicious activity checked",
		"- [ ] **Timeline documented**: Execution times and sequence recorded in OPLOG",
		"- [ ] **Effectiveness assessed**: Success, failure, and lessons learned noted",
		"- [ ] **OPLOG updated**: Operator log completed with relevant details",
		"- [ ] **Document history updated**: Revision history maintained",
	];

	return `${lines.join("\n")}\n`;
}
