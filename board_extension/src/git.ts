import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * What the line under a ticket should say. Ordered by what a person needs to
 * know, not by what git finds interesting: the only state that can lose work
 * is `uncommitted`, so it outranks everything else.
 */
export type WorktreeState =
  | 'none'
  | 'uncommitted'
  | 'ahead'
  | 'merged'
  | 'squash-merged'
  | 'level';

/** What the panel shows about a ticket's branch. */
export interface WorktreeInfo {
  ticket: string;
  exists: boolean;
  path?: string;
  branch?: string;
  dirty: boolean;
  /** How many files are uncommitted, because "3 files" beats "changes". */
  dirtyFiles: number;
  /** The one word this branch is in, for the panel. */
  state: WorktreeState;
  /** Commits on the branch that main does not have. */
  ahead: number;
  /** Commits main has that the branch does not. */
  behind: number;
  merged: boolean;
  /**
   * How we know it is merged. `ancestor` is an ordinary merge; `patch` means
   * the commits differ but the changes are already in main, which is what a
   * squash merge looks like from here.
   */
  mergedBy?: 'ancestor' | 'patch';
  mainBranch: string;
  error?: string;
}

const NEWLINE = String.fromCharCode(10);

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

/** Where worktrees live: beside the repo, never inside its working tree. */
function worktreeRoot(repo: string): string {
  const configured = vscode.workspace.getConfiguration('board').get<string>('worktreeDir');
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(repo, configured);
  }
  return path.join(path.dirname(repo), path.basename(repo) + '-worktrees');
}

/** Whatever this repo calls its trunk. */
export function mainBranch(repo: string): string {
  const head = tryGit(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (head && head.includes('/')) {
    return head.slice(head.indexOf('/') + 1);
  }
  for (const candidate of ['main', 'master']) {
    if (tryGit(repo, ['rev-parse', '--verify', candidate])) {
      return candidate;
    }
  }
  return 'main';
}

interface Worktree {
  path: string;
  branch: string;
}

/** Every worktree git knows about, with its branch. */
function listWorktrees(repo: string): Worktree[] {
  const out = tryGit(repo, ['worktree', 'list', '--porcelain']);
  if (!out) {
    return [];
  }
  const found: Worktree[] = [];
  let current: Partial<Worktree> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice(9).trim() };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '').trim();
    } else if (!line.trim() && current.path) {
      found.push({ path: current.path, branch: current.branch ?? '' });
      current = {};
    }
  }
  if (current.path) {
    found.push({ path: current.path, branch: current.branch ?? '' });
  }
  return found;
}

/**
 * A ticket owns any branch whose name starts with its key, so a branch made by
 * hand as METH-238-toolbar-sections is recognised as the same work.
 */
function ownedBy(name: string, ticket: string): boolean {
  return name === ticket || name.startsWith(ticket + '-');
}

export function findWorktree(repo: string, ticket: string): Worktree | undefined {
  return listWorktrees(repo).find((tree) => ownedBy(tree.branch, ticket));
}

/** An existing branch for this ticket, local or on the remote. */
function existingBranch(repo: string, ticket: string): string | undefined {
  const out = tryGit(repo, ['branch', '--all', '--format=%(refname:short)']);
  if (!out) {
    return undefined;
  }
  const names = out
    .split('\n')
    .map((name) => name.trim().replace(/^origin\//, ''))
    .filter(Boolean);
  return names.find((name) => ownedBy(name, ticket));
}

/**
 * Give the ticket a worktree, reusing whatever already exists. Called when a
 * conversation opens, so an agent never works in the shared checkout.
 */
export function ensureWorktree(repo: string, ticket: string): Worktree {
  const found = findWorktree(repo, ticket);
  if (found) {
    return found;
  }

  const dir = path.join(worktreeRoot(repo), ticket);
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  const branch = existingBranch(repo, ticket);
  if (branch) {
    // The branch exists already; check it out here rather than making a second.
    git(repo, ['worktree', 'add', dir, branch]);
  } else {
    git(repo, ['worktree', 'add', dir, '-b', ticket, mainBranch(repo)]);
  }

  // Report the path git itself uses, so a later lookup compares equal. Git
  // normalises separators and case; our constructed path does not.
  return findWorktree(repo, ticket) ?? { path: dir, branch: branch ?? ticket };
}

/**
 * Whether the branch's work is in main. Ancestry catches an ordinary merge;
 * patch-equivalence catches a squash or rebase merge, where the commits differ
 * but every change has landed. Without the second check a squash-merged ticket
 * looks unmerged forever, and its worktree never gets cleaned up.
 */
function mergedInto(repo: string, branch: string, main: string): WorktreeInfo['mergedBy'] | undefined {
  try {
    git(repo, ['merge-base', '--is-ancestor', branch, main]);
    return 'ancestor';
  } catch {
    // not an ancestor; fall through
  }

  const cherry = tryGit(repo, ['cherry', main, branch]);
  if (cherry !== undefined) {
    const unmerged = cherry
      .split('\n')
      .filter((line) => line.trim().startsWith('+'));
    // No '+' lines means every commit has an equivalent already in main.
    if (cherry.trim() && !unmerged.length) {
      return 'patch';
    }
  }
  return undefined;
}

export function worktreeStatus(repo: string, ticket: string): WorktreeInfo {
  const main = mainBranch(repo);
  const base: WorktreeInfo = {
    ticket,
    exists: false,
    dirty: false,
    dirtyFiles: 0,
    state: 'none',
    ahead: 0,
    behind: 0,
    merged: false,
    mainBranch: main
  };

  let tree: Worktree | undefined;
  try {
    tree = findWorktree(repo, ticket);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  if (!tree) {
    return base;
  }

  const porcelain = tryGit(tree.path, ['status', '--porcelain']) ?? '';
  const dirtyFiles = porcelain.split(NEWLINE).filter((line) => line.trim()).length;
  const ahead = count(tryGit(repo, ['rev-list', '--count', `${main}..${tree.branch}`]));
  const behind = count(tryGit(repo, ['rev-list', '--count', `${tree.branch}..${main}`]));
  const mergedBy = mergedInto(repo, tree.branch, main);

  return {
    ticket,
    exists: true,
    path: tree.path,
    branch: tree.branch,
    dirty: dirtyFiles > 0,
    dirtyFiles,
    state: describeState(dirtyFiles, ahead, behind, mergedBy),
    ahead,
    behind,
    merged: Boolean(mergedBy) && ahead === 0 ? true : mergedBy === 'patch',
    mergedBy,
    mainBranch: main
  };
}

export interface CullResult {
  removed: boolean;
  reason?: string;
}

/**
 * Remove a ticket's worktree once its work has landed. Refuses while anything
 * is uncommitted or unmerged: deleting a worktree with work in it destroys
 * that work, and a board should never do that quietly.
 */
export function cullWorktree(repo: string, ticket: string, force = false): CullResult {
  const status = worktreeStatus(repo, ticket);
  if (!status.exists || !status.path) {
    return { removed: false, reason: 'no worktree' };
  }

  if (!force) {
    if (status.dirty) {
      return { removed: false, reason: `${status.branch} has uncommitted changes` };
    }
    if (!status.merged) {
      return {
        removed: false,
        reason: `${status.branch} is ${status.ahead} commit${status.ahead === 1 ? '' : 's'} ahead of ${status.mainBranch} and not merged`
      };
    }
  }

  try {
    git(repo, force ? ['worktree', 'remove', '--force', status.path] : ['worktree', 'remove', status.path]);
    // The branch is left alone; only the checkout goes.
    return { removed: true };
  } catch (err) {
    return { removed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function count(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A fresh worktree is an ancestor of main by definition, so ancestry alone
 * would report every untouched branch as "merged" — which reads as "the work
 * is done" when nothing has happened yet. Merged is only claimed when there is
 * evidence work actually landed.
 */
function describeState(
  dirtyFiles: number,
  ahead: number,
  behind: number,
  mergedBy: WorktreeInfo['mergedBy']
): WorktreeState {
  if (dirtyFiles > 0) {
    return 'uncommitted';
  }
  if (mergedBy === 'patch') {
    return 'squash-merged';
  }
  if (ahead > 0) {
    return 'ahead';
  }
  // Nothing of its own, and main has moved on: its commits are behind us.
  if (mergedBy === 'ancestor' && behind > 0) {
    return 'merged';
  }
  return 'level';
}
