import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSameRepoStatus, readRepoStatus } from "./repo-status";

describe("isSameRepoStatus", () => {
	it("treats identical statuses as equal", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
			),
		).toBe(true);
		expect(
			isSameRepoStatus(
				{ branch: null, diffStats: null },
				{ branch: null, diffStats: null },
			),
		).toBe(true);
	});

	it("detects branch and diff changes", () => {
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "feature", diffStats: null },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: null },
				{ branch: "main", diffStats: { files: 1, additions: 0, deletions: 0 } },
			),
		).toBe(false);
		expect(
			isSameRepoStatus(
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 3 } },
				{ branch: "main", diffStats: { files: 1, additions: 2, deletions: 4 } },
			),
		).toBe(false);
	});
});

describe("readRepoStatus", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function git(cwd: string, ...args: string[]) {
		execFileSync("git", args, { cwd, stdio: "ignore" });
	}

	function createRepo({ commit = true } = {}) {
		const dir = mkdtempSync(join(tmpdir(), "cline-repo-status-"));
		dirs.push(dir);
		git(dir, "init", "-q", "-b", "main");
		git(dir, "config", "user.email", "test@example.com");
		git(dir, "config", "user.name", "Test");
		git(dir, "config", "commit.gpgsign", "false");
		if (commit) {
			writeFileSync(join(dir, "a.txt"), "one\n");
			git(dir, "add", "a.txt");
			git(dir, "commit", "-q", "-m", "init");
		}
		return dir;
	}

	it("returns null diff stats for a clean tree", async () => {
		const dir = createRepo();
		expect(await readRepoStatus(dir)).toEqual({
			branch: "main",
			diffStats: null,
		});
	});

	it("counts unstaged changes", async () => {
		const dir = createRepo();
		writeFileSync(join(dir, "a.txt"), "two\n");
		expect((await readRepoStatus(dir)).diffStats).toEqual({
			files: 1,
			additions: 1,
			deletions: 1,
		});
	});

	it("counts staged changes", async () => {
		const dir = createRepo();
		writeFileSync(join(dir, "a.txt"), "two\n");
		git(dir, "add", "a.txt");
		expect((await readRepoStatus(dir)).diffStats).toEqual({
			files: 1,
			additions: 1,
			deletions: 1,
		});
	});

	it("combines staged new files with unstaged edits", async () => {
		const dir = createRepo();
		writeFileSync(join(dir, "b.txt"), "new\n");
		git(dir, "add", "b.txt");
		writeFileSync(join(dir, "a.txt"), "two\n");
		expect((await readRepoStatus(dir)).diffStats).toEqual({
			files: 2,
			additions: 2,
			deletions: 1,
		});
	});

	it("does not count a staged edit that was reverted in the working tree", async () => {
		const dir = createRepo();
		writeFileSync(join(dir, "a.txt"), "two\n");
		git(dir, "add", "a.txt");
		writeFileSync(join(dir, "a.txt"), "one\n");
		expect((await readRepoStatus(dir)).diffStats).toBeNull();
	});

	it("counts tracked changes before the first commit", async () => {
		const dir = createRepo({ commit: false });
		writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
		git(dir, "add", "a.txt");
		expect((await readRepoStatus(dir)).diffStats).toEqual({
			files: 1,
			additions: 2,
			deletions: 0,
		});
	});

	it("returns nulls outside a git repository", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cline-repo-status-"));
		dirs.push(dir);
		expect(await readRepoStatus(dir)).toEqual({
			branch: null,
			diffStats: null,
		});
	});
});
