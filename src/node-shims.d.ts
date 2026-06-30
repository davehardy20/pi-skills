declare module "node:assert/strict" {
	const assert: {
		equal(actual: unknown, expected: unknown, message?: string): void;
		deepEqual(actual: unknown, expected: unknown, message?: string): void;
		ok(value: unknown, message?: string): void;
		match(actual: string, expected: RegExp, message?: string): void;
	};
	export default assert;
}

declare module "node:crypto" {
	export function createHash(algorithm: string): {
		update(data: string | Uint8Array): {
			update(data: string | Uint8Array): unknown;
			digest(encoding: "hex"): string;
		};
		digest(encoding: "hex"): string;
	};
}

declare module "node:fs/promises" {
	export function access(path: string): Promise<void>;
	export function chmod(path: string, mode: number): Promise<void>;
	export function copyFile(source: string, destination: string): Promise<void>;
	export function lstat(path: string): Promise<{
		isDirectory(): boolean;
		isFile(): boolean;
		isSymbolicLink(): boolean;
	}>;
	export function mkdir(
		path: string,
		options?: { recursive?: boolean },
	): Promise<void>;
	export function mkdtemp(prefix: string): Promise<string>;
	export function readdir(
		path: string,
		options?: { withFileTypes?: false },
	): Promise<string[]>;
	export function readFile(path: string, encoding: "utf8"): Promise<string>;
	export function rm(
		path: string,
		options?: { recursive?: boolean; force?: boolean },
	): Promise<void>;
	export function symlink(target: string, path: string): Promise<void>;
	export function writeFile(
		path: string,
		data: string,
		encoding?: "utf8",
	): Promise<void>;
}

declare module "node:os" {
	export function tmpdir(): string;
}

declare module "node:path" {
	export function basename(path: string, suffix?: string): string;
	export function dirname(path: string): string;
	export function extname(path: string): string;
	export function join(...paths: string[]): string;
	export function relative(from: string, to: string): string;
	export function resolve(...paths: string[]): string;
}

declare module "node:test" {
	export interface TestContext {
		name: string;
	}

	type TestCallback = (context: TestContext) => void | Promise<void>;

	export default function test(name: string, callback: TestCallback): void;
}
