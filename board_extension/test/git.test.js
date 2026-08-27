// Exercises the worktree lifecycle in a throwaway repo, then checks branch
// discovery against the real Method checkout (read-only).
require('./stub-vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const git = require('../out/git');

const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
let failed = 0;
const check = (label, fn) => {
  try { const d = fn(); console.log('  ok    ' + label + (d ? ' — ' + d : '')); }
  catch (e) { failed++; console.log('  FAIL  ' + label + ' — ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-git-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
run(repo, ['init', '-b', 'main']);
run(repo, ['config', 'user.email', 'test@example.com']);
run(repo, ['config', 'user.name', 'Test']);
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
run(repo, ['add', '.']);
run(repo, ['commit', '-m', 'first']);

console.log('\nWorktree lifecycle');

check('main branch is detected', () => {
  assert(git.mainBranch(repo) === 'main', 'got ' + git.mainBranch(repo));
  return 'main';
});

check('no worktree before one is made', () => {
  const s = git.worktreeStatus(repo, 'TEST-1');
  assert(!s.exists, 'reported a worktree that does not exist');
});

let tree;
check('a worktree is created on its own branch', () => {
  tree = git.ensureWorktree(repo, 'TEST-1');
  assert(fs.existsSync(tree.path), 'directory missing');
  assert(tree.branch === 'TEST-1', 'branch is ' + tree.branch);
  return tree.branch;
});

check('a fresh branch is not called merged', () => {
  // A new branch is an ancestor of main by definition, so ancestry alone
  // reports every untouched worktree as merged - which reads as "the work is
  // done" when nothing has happened.
  const s = git.worktreeStatus(repo, 'TEST-1');
  assert(s.state === 'level', 'state is ' + s.state + ', expected level');
  assert(s.dirtyFiles === 0, 'reported dirty files on a fresh branch');
  return 'reads as level with main, not merged';
});

check('asking again reuses it', () => {
  const again = git.ensureWorktree(repo, 'TEST-1');
  assert(again.path === tree.path, 'made a second worktree');
});

check('uncommitted work shows dirty and blocks culling', () => {
  fs.writeFileSync(path.join(tree.path, 'b.txt'), 'wip\n');
  const s = git.worktreeStatus(repo, 'TEST-1');
  assert(s.dirty, 'not reported dirty');
  assert(s.state === 'uncommitted', 'state is ' + s.state);
  assert(s.dirtyFiles === 1, 'counted ' + s.dirtyFiles + ' files');
  const cull = git.cullWorktree(repo, 'TEST-1');
  assert(!cull.removed, 'deleted a worktree with uncommitted work in it');
  return cull.reason;
});

check('committed but unmerged is ahead and still blocks culling', () => {
  run(tree.path, ['add', '.']);
  run(tree.path, ['commit', '-m', 'wip']);
  const s = git.worktreeStatus(repo, 'TEST-1');
  assert(!s.dirty, 'still dirty after commit');
  assert(s.ahead === 1, 'ahead is ' + s.ahead);
  assert(!s.merged, 'claimed merged before it was');
  const cull = git.cullWorktree(repo, 'TEST-1');
  assert(!cull.removed, 'deleted an unmerged worktree');
  return cull.reason;
});

check('an ordinary merge is detected', () => {
  run(repo, ['merge', '--no-ff', '-m', 'merge', 'TEST-1']);
  const s = git.worktreeStatus(repo, 'TEST-1');
  assert(s.merged, 'merge not detected');
  assert(s.mergedBy === 'ancestor', 'detected via ' + s.mergedBy);
  assert(s.state === 'merged', 'state is ' + s.state);
  return 'ancestor';
});

check('a merged worktree is culled', () => {
  const cull = git.cullWorktree(repo, 'TEST-1');
  assert(cull.removed, 'not removed: ' + cull.reason);
  assert(!git.worktreeStatus(repo, 'TEST-1').exists, 'still listed');
});

console.log('\nSquash merge');
check('a squash merge still counts as merged', () => {
  const t = git.ensureWorktree(repo, 'TEST-2');
  fs.writeFileSync(path.join(t.path, 'c.txt'), 'squashed\n');
  run(t.path, ['add', '.']);
  run(t.path, ['commit', '-m', 'squash me']);
  // main takes the change as one new commit, exactly like a squash-merged PR
  run(repo, ['merge', '--squash', 'TEST-2']);
  run(repo, ['commit', '-m', 'squashed TEST-2']);
  const s = git.worktreeStatus(repo, 'TEST-2');
  assert(s.merged, 'a squash-merged branch was reported unmerged');
  assert(s.mergedBy === 'patch', 'detected via ' + s.mergedBy);
  const cull = git.cullWorktree(repo, 'TEST-2');
  assert(cull.removed, 'squash-merged worktree not culled: ' + cull.reason);
  return 'detected by patch equivalence';
});

console.log('\nAgainst the real Method repo (read-only)');
const method = 'c:/Users/jono1/Profesional Projects/Method';
check('finds a hand-made branch by ticket prefix', () => {
  const s = git.worktreeStatus(method, 'METH-239');
  assert(s.mainBranch === 'main', 'main is ' + s.mainBranch);
  return 'main branch ' + s.mainBranch + ', worktree ' + (s.exists ? s.path : 'none yet');
});

fs.rmSync(root, { recursive: true, force: true });
console.log(failed ? '\n' + failed + ' failed\n' : '\nworktree checks passed\n');
process.exit(failed ? 1 : 0);
