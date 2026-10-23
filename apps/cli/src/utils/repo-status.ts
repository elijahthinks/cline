import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitDiffStats = {
	files: number;
	additions: number;
	deletions: number;
};

export interface RepoStatus {
	branch: string | null;
	diffStats: GitDiffStats | null;
}

export function isSameRepoStatus(a: RepoStatus, b: RepoStatus): boolean {
	if (a.branch !== b.branch) return false;
	if (a.diffStats === null || b.diffStats === null) {
		return a.diffStats === b.diffStats;
	}
	return (
		a.diffStats.files === b.diffStats.files &&
		a.diffStats.additions === b.diffStats.additions &&
		a.diffStats.deletions === b.diffStats.deletions
	);
}

function git(cwd: string, args: string[]) {
	return execFileAsync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		// Prevent a console window from flashing on Windows.
		windowsHide: true,
	});
}

// Diff the working tree against HEAD so staged and unstaged changes are both
// counted. Before the first commit HEAD doesn't exist, so diff against the
// empty tree instead.
async function readShortStat(cwd: string) {
	try {
		return await git(cwd, ["diff", "--shortstat", "HEAD", "--"]);
	} catch (error) {
		const hashEmptyTree = git(cwd, ["hash-object", "-t", "tree", "--stdin"]);
		hashEmptyTree.child.stdin?.end();
		const emptyTree = await hashEmptyTree.catch(() => {
			throw error;
		});
		return git(cwd, ["diff", "--shortstat", emptyTree.stdout.trim(), "--"]);
	}
}

export async function readRepoStatus(cwd: string): Promise<RepoStatus> {
	const [branchResult, diffResult] = await Promise.allSettled([
		git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
		readShortStat(cwd),
	]);

	const branch =
		branchResult.status === "fulfilled"
			? branchResult.value.stdout.trim() || null
			: null;

	let diffStats: GitDiffStats | null = null;
	if (diffResult.status === "fulfilled") {
		const output = diffResult.value.stdout.trim();
		if (output) {
			const filesMatch = output.match(/(\d+)\s+file/);
			const additionsMatch = output.match(/(\d+)\s+insertion/);
			const deletionsMatch = output.match(/(\d+)\s+deletion/);
			diffStats = {
				files: filesMatch ? Number.parseInt(filesMatch[1] ?? "0", 10) : 0,
				additions: additionsMatch
					? Number.parseInt(additionsMatch[1] ?? "0", 10)
					: 0,
				deletions: deletionsMatch
					? Number.parseInt(deletionsMatch[1] ?? "0", 10)
					: 0,
			};
		}
	}

	return { branch, diffStats };
}
