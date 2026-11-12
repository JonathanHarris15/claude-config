---
name: sync-config
description: Sync the global claude-config repo (~/.claude) with its GitHub remote from any directory — commit local changes, figure out which side is ahead, replay local work on top of the remote without ever discarding it, then push to main or open a pull request. Use when the user says "sync config", "sync my claude config", "/sync-config", or wants their ~/.claude skills/settings brought in line with the remote.
argument-hint: "'pr' to open a pull request instead of pushing straight to main; nothing for the default push"
---

# Sync config

Bring `~/.claude` and its GitHub remote (`origin/main`) into the same state, no
matter what folder the user is in. **All git commands run in `~/.claude`** — pass
`-C ~/.claude` to every git call so the user's current project is never touched.

The repo's `.gitignore` is an **allowlist** (`*` then explicit un-ignores). That
means `git add -A` is safe: it can only ever stage the handful of allowlisted
paths (skills, agents, workflows, hooks, mods, dashboard, usage, board,
settings.json, CLAUDE.md, README, .gitignore). Credentials, transcripts and machine-local state fail closed.
Do **not** flip `.gitignore` to a denylist to "fix" anything.

## Two rules that outrank everything else

1. **Local work is never thrown away.** The user's edits to their own skills are
   the point of the repo. Commit them before touching the remote, replay them on
   top of whatever the remote has, and resolve conflicts by reading both sides.
   Never run `reset --hard`, `checkout --force`, `clean -fd`, `stash drop`, or
   `git pull` without `--rebase` on the way down.
2. **Never force-push `main`.** A `--force-with-lease` on a sync branch you
   created yourself is fine; `main` is not.

## Which way up: push or PR?

Default is a direct push to `main` — this is the user's own config repo and most
syncs are one-line tweaks.

Open a **pull request** instead when any of these is true:

- the user asked for one (`/sync-config pr`, "open a PR", "don't push to main");
- the direct push is rejected because `main` is protected;
- the change is large or risky enough that the user will want to read it back —
  a rewritten skill, a settings change that affects every session, anything that
  deletes files. Say in one line why you chose the PR and carry on; don't stop
  to ask.

## The loop

### 1. Commit local work first
Nothing should be lost to a rebase. Stage and commit any local changes before
looking at the remote:

```sh
git -C ~/.claude add -A
git -C ~/.claude diff --cached --quiet || git -C ~/.claude commit -m "<summary of what changed>"
```

Write a real one-line summary of what actually changed (glance at the staged
diff), not a generic message. If there's nothing staged, skip the commit.

`settings.local.json` is untracked by design — leave it alone.

### 2. Fetch and compare
```sh
git -C ~/.claude fetch origin --prune
git -C ~/.claude rev-list --left-right --count main...origin/main   # -> "<ahead>	<behind>"
```

- `0  0` — already in sync. Report it and stop.
- `0  N` — remote ahead. **Bring it down** (step 3).
- `N  0` — local ahead. **Send it up** (step 4).
- `N  M` — both. **Bring it down first** (step 3), then send it up (step 4).

Before sending anything up, check whether the local commits are already sitting
in an open PR:

```sh
git -C ~/.claude branch -r --list 'origin/config/*'
gh pr list --repo <origin repo> --state open --head <branch>
```

If they are, don't push again — say which PR is waiting and stop.

### 3. Coming down — rebase, don't overwrite
Replay local commits on top of the remote so history stays linear and local work
survives:

```sh
git -C ~/.claude pull --rebase origin main
```

(With nothing local to replay this is just a fast-forward, which is what you
want.) If a sync branch of yours is still open, rebase it on the new `main` too
and `push --force-with-lease` it, so the PR shows only your changes.

If the rebase stops on a conflict:

1. `git -C ~/.claude status` to see the conflicted files, then read each one.
2. Resolve by **understanding both sides**, not by blindly taking one:
   - These are config files. For additive changes (a new skill on each side, new
     entries in a list, separate settings keys) the answer is almost always the
     **union** — keep both.
   - For the *same* setting or the *same* line changed two different ways, that's
     a genuine semantic conflict. Pick the side that's clearly newer/intended if
     it's obvious; if it isn't, **stop and ask the user** rather than guess. Their
     local edit is never the automatic loser just because the remote is "main".
3. `git -C ~/.claude add <resolved files>` then `git -C ~/.claude rebase --continue`.
4. Repeat until the rebase finishes.

If the rebase gets into a state you can't safely untangle:
`git -C ~/.claude rebase --abort` and hand it back to the user with what you
found. The abort puts their commits back exactly as they were.

### 4a. Going up — direct push (default)
```sh
git -C ~/.claude push origin main
```

If that's rejected because the remote moved, go back to step 3 and come down
again first. If it's rejected because `main` is protected, switch to 4b.

### 4b. Going up — pull request
Put the local commits on a branch, push the branch, open the PR. `main` stays
where it is locally, so the user keeps their config working while the PR sits.

```sh
git -C ~/.claude branch config/<short-topic> main
git -C ~/.claude push -u origin config/<short-topic>
gh pr create --repo <origin repo> --base main --head config/<short-topic> \
  --title "<what changed>" --body "<what changed and why>"
```

- Name the branch for the change: `config/sync-skill-rebase`, `config/new-tdd-skill`.
- **Don't** check the branch out and **don't** move `main` back. The user's
  `~/.claude` must keep running from the code they just wrote.
- No `gh` on the machine? Push the branch anyway and give the user the compare
  URL (`https://github.com/<owner>/<repo>/compare/main...<branch>`).
- Once the PR merges, the next sync fast-forwards `main` and git drops the
  duplicated commits on its own — nothing special to do.

### 5. Confirm
End by reporting the outcome in one or two lines: what moved, which direction,
and the final `git -C ~/.claude status`. For a direct push that should be clean
and "up to date with origin/main"; for a PR, say the branch is pushed, link the
PR, and note `main` is still ahead locally until it merges. Remind the user that
running Claude Code sessions must restart to pick up changed config.
