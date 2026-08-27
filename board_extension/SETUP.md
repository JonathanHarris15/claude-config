# SETUP.md — get the Board extension running on this machine

You are an agent setting up the Board VS Code extension on a machine that has
just cloned `claude-config` (this repo) to `~/.claude`. Work through the steps
in order. Each has a **check** — run it, and do not move on until it passes.
Stop and report only where a step says *ask the human*; everything else you
can do yourself. Finish by running the final check and reporting its output.

Platform notes are marked **Windows** / **macOS**. The shell on Windows is
PowerShell; on macOS it is zsh.

## 0. Where you are

```
cd ~/.claude/board_extension
```

**Check:** `package.json` here has `"name": "board-extension"`.

## 1. Requirements

| Need | Why | Check |
| --- | --- | --- |
| Node 20+ and npm | builds the extension, runs the Claude Agent SDK | `node --version` prints v20 or higher |
| git 2.38+ | the merge queue's conflict check uses `git merge-tree --write-tree` | `git --version` |
| VS Code | the extension host | `code --version` |
| Claude Code, logged in | the SDK spawns it to run every agent | `claude --version`, then `claude auth status` (or run `claude` once and confirm it does not prompt for login) |
| `twg` CLI, logged in | every JIRA read and write goes through it | `twg doctor` reports healthy |
| `gh` CLI, logged in | the merge queue reads PRs with it | `gh auth status` |

Install anything missing:

- Node: https://nodejs.org (LTS).
- Claude Code: `npm install -g @anthropic-ai/claude-code`, then `claude` and follow the login.
- `twg`, **Windows:** `powershell -ExecutionPolicy ByPass -c "irm https://teamwork-graph.atlassian.com/cli/install.ps1 | iex"` then `twg setup`.
  **macOS:** `curl -fsSL https://teamwork-graph.atlassian.com/cli/install.sh | sh` then `twg setup`. If the macOS URL 404s, *ask the human* for the installer; do not guess one.
- `gh`: **Windows** `winget install GitHub.cli`, **macOS** `brew install gh`, then `gh auth login`.

Logins need a browser and the human's account — if a login step blocks on
that, *ask the human* to complete it, then continue.

## 2. Build and link

```
node setup.js
```

One script, both platforms, safe to run again: it installs dependencies,
compiles, and links this folder into VS Code. The extension is not packaged —
VS Code reads the folder through the link, so a later `git pull` plus another
`node setup.js` is the whole upgrade.

It stops rather than guess if `~/.vscode/extensions/board-extension` already
exists and points somewhere else. If it says that, *ask the human*.

It finishes by naming what it cannot do itself — a missing CLI, or the repo
mapping in step 3. Work through that list.

If it reports `twg` missing but you know it is installed, set `board.twgPath`
to its full path in step 4 rather than moving the install.

**Check:** `node setup.js --check` prints `Board is already set up on this
machine`.

## 3. Tell the board where the repos are

Agents run inside a checkout of each project. The setting `board.repos` maps a
JIRA space key to a repo path, and its defaults are Windows paths for one
specific machine, so on any other machine it must be set explicitly.

1. Find the checkouts. The spaces are `METH` (Method), `HAS` (Harris
   Appraisals), `MS` (Mosaic website). Search the usual places
   (`~/Profesional Projects`, `~/Projects`, `~/code`, `~/src`) for folders
   with those names that contain a `.git`. If any is missing, *ask the human*
   where it is or whether to clone it — do not clone on your own.
2. Write the mapping into VS Code's **user** settings (`settings.json` opened
   by *Preferences: Open User Settings (JSON)*), using forward slashes on every
   platform:
   ```json
   "board.repos": {
     "METH": "/Users/<you>/Projects/Method",
     "HAS":  "/Users/<you>/Projects/harris-appraisals",
     "MS":   "/Users/<you>/Projects/mosaic-website"
   }
   ```
   A space left out is read-only on the board: tickets show, no agent runs.

**Check:** each path in the mapping exists and `git -C <path> rev-parse --is-inside-work-tree` prints `true`.

## 4. Optional settings

Only set these if the human asks or the defaults are wrong for this machine:

| Setting | Default | When to change |
| --- | --- | --- |
| `board.twgPath` | blank (auto) | `twg` is installed somewhere the extension cannot find |
| `board.worktreeDir` | blank (sibling folder `<repo>-worktrees`) | worktrees must live elsewhere, e.g. a faster disk |
| `board.storyModel` | `claude-sonnet-5` | a different model should write the History tab |
| `board.sharedCommands` | tests and build patterns | a project has a test runner the defaults do not name |

## 5. Prove it works without opening the editor

```
npm run preflight
```

This compiles, activates the extension under a stubbed editor, fetches the
real board and one real ticket from JIRA, and runs every unit check. Every
failure names its own cause (expired `twg` login, a missing repo path, a stale
build). Fix what it names and run it again.

**Check:** the output ends with `All checks passed — the board is ready.` and
`worktree checks passed`.

## 6. Hand over

Restart VS Code. The **Board** icon is in the activity bar; clicking a space
opens its board as an editor tab.

Report to the human, in this order: which requirements you installed, the
`board.repos` mapping you wrote, anything you had to ask about, and the last
two lines of the preflight output. Do not start an agent on a ticket — that
costs money and is the human's call.

## 7. Afterwards

`/sync-config` runs `node setup.js` whenever a sync brings down a change to this
folder, so an ordinary pull keeps the board built. This file is only needed for
a machine that has never had it running.
