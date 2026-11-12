---
name: tracker
description: Find out where a project keeps its tickets and docs — Jira, Notion, GitHub Issues, or another tool such as Linear, Asana or Todoist — and how to read, create, move and comment on tickets there. Every ticket skill loads this before it touches a ticket, the glossary or an ADR. Use directly with /tracker to detect a project's setup and write its config block, or to see what a project is wired to.
argument-hint: "Optional: a ticket key or short name to look up. With nothing, detect the current repo's setup"
---

# Tracker

Projects keep their work in different tools. This skill finds out which one this project uses,
and points to the one file that says how to touch it. **No other skill names a tool from Jira,
Notion, GitHub or anything else** — they ask for an *action* ("move a ticket", "add sub-tasks"),
and the backend file says how it works there.

[BOARD.md](./BOARD.md) says what the columns and levels mean, whatever tool holds them.

## Two switches, set per project

| Switch | Values | What it holds |
| --- | --- | --- |
| **Tickets** | `notion`, `jira`, `github`, or the name of another tool | Epics, tickets, sub-tasks, the board |
| **Docs** | `notion`, `repo`, or the name of another tool | The glossary, ADRs and write-ups |

They move apart. A project can keep tickets in GitHub and docs in the repo, or tickets in Jira and
docs in Notion, so never read one switch from the other.

| Tickets | Backend file |
| --- | --- |
| `jira` | [backends/JIRA.md](./backends/JIRA.md) |
| `notion` | [backends/NOTION.md](./backends/NOTION.md) |
| `github` | [backends/GITHUB.md](./backends/GITHUB.md) |
| anything else | [backends/OTHER.md](./backends/OTHER.md) — map it once, write the map down |

**New projects default to Notion.** Jira is being phased out, so set up nothing new there. GitHub
Issues suits a small code-only project. Any other tool works if the user already lives in it.

**A project may have no code yet.** Planning, epics and docs all work without a repo. Skip the
steps that read code and say so. There is nothing for `implement` to build until a repo exists.

## Finding the switches

Work down this list and stop at the first step that answers.

### 1. The config block

Read the `<!-- tracker-config -->` block in the repo's `CLAUDE.md` (or `AGENTS.md`):

```md
<!-- tracker-config -->
## Tracker

- **Short name:** GRD (ticket keys look like GRD-12)
- **Tickets:** notion
- **Docs:** notion
- **Notion home:** https://app.notion.com/p/…
- **Tickets data source:** collection://…
- **Epics data source:** collection://…
- **Docs data source:** collection://…
- **Columns:** To Plan → To Do → In Progress → In Review → Done

Plan a ticket with `/plan-ticket <KEY>`. Build one with `/implement <KEY>`.
<!-- /tracker-config -->
```

Each backend file lists the lines it needs in place of the data sources: Jira its site, cloud ID,
project key and type names; GitHub its `owner/repo`; another tool the map from
[OTHER.md](./backends/OTHER.md). Leave out any line that doesn't apply.

**An older `<!-- jira-config -->` block still counts.** It means Tickets `jira`, Docs `repo`, and
the short name is the project key. If both blocks exist, `tracker-config` wins.

### 2. Clues in the repo

No block, but a repo? Look before you ask. These cost nothing and rarely mislead:

| Clue | Where to look | Points to |
| --- | --- | --- |
| Keys like `ABC-12` | Branch names, the last 50 commit subjects, PR titles | Jira or Notion. Step 3 tells them apart |
| `#12`, `Fixes #12`, `Closes #12` | Commit messages, PR bodies | GitHub Issues |
| Links to `atlassian.net` / `jira` | `README.md`, `CLAUDE.md`, `docs/`, `CONTRIBUTING.md` | Jira |
| Links to `notion.so` / `notion.site` / `app.notion.com` | Same | Notion |
| Links to `linear.app`, `app.asana.com`, `trello.com`, `todoist.com`, `app.clickup.com` and the like | Same | That tool |
| `.github/ISSUE_TEMPLATE/`, open issues on the remote | The repo and its `git remote` | GitHub Issues |
| `CONTEXT.md`, `docs/adr/` | The repo root | Docs `repo` |

One clean signal is enough to try that backend. Signals that disagree mean ask (step 4).

### 3. Ask the tools

Take the short name from the ticket key you were given, a clue above, or the user. **Never
guess one.**

- **Notion:** a teamspace named `<SHORT> - <Project>`. Find it with `notion-get-teams`, then its
  home page and databases with `notion-search`, using `teamspace_id` and the query `Home`. If
  the home page says tickets live elsewhere, follow it. Otherwise both switches are `notion`.
- **Jira:** a project with that key, via `getVisibleJiraProjects`.
- **GitHub:** the repo's `owner/repo` from `git remote`, and whether it has open issues.

This is also the only route with no repo: teamspaces and Jira keys need no code.

### 4. Ask the user

If nothing answers, or two places could both be right, ask one question: which tool holds this
project's tickets, and which holds its docs. Offer what you found as the default.

### Then write the block

Once you know, write the `tracker-config` block into the repo's `CLAUDE.md` and say so in a line,
so the next run skips all of this. With no repo there is nowhere to write it; say so.

### Things that stop you

- **A key whose prefix doesn't match the short name** — the wrong repo or a typo. Stop and say so.
- **The backend isn't connected** — stop and say which connector is missing. **Never fall back to
  another tool.** A ticket filed in the wrong place is a ticket nobody will find.

## Tickets: what you can do

Skills ask for these by name. Each backend file says how each one works there, and every backend
must cover every row — where a tool has no native home for one, it goes in the ticket's body in
the shared text form below.

| Action | Means |
| --- | --- |
| **Load the tools** | Find the connector's tools and load them |
| **Read a ticket** | Title, body, type, column, labels, epic, blockers, comments, sub-tasks |
| **List a column** | Every ticket in one column, oldest first |
| **Create a ticket** | A new level-0 ticket, in `To Plan` unless told otherwise |
| **Write the body** | Replace or edit the ticket's body. Read it first and keep what you didn't write |
| **Add a label** | `trivial`, `investigation` and the like |
| **Mark as investigation** | Flag a ticket as decision work, not a deliverable |
| **Add a blocker** | Record that one ticket must wait for another |
| **Move a ticket** | Put it in another column. Never invent a column |
| **Comment** | Add a short note to the ticket |
| **Close a ticket** | Finish a ticket that produced a decision or was replaced, with a comment saying why |
| **Create an epic** | A grouping with a vision, which its tickets point back to |
| **Read an epic** | The epic and the tickets under it |
| **Add sub-tasks** | Add steps inside a ticket, each marked `afk` or `hitl`, with any blockers |
| **Tick a sub-task** | Mark one step done |
| **Link code** | Use the key in branch, commit and PR so the ticket shows the work |

### The shared text form

When a tool can't hold something natively, write it into the ticket body like this. Every backend
that needs it uses the same shape, so a skill reading a body never has to care which tool it's on.

```md
Labels: trivial, hold
Blocked by: GRD-9, GRD-11
Due: 2026-09-01

## Problem Statement
…

## Sub-tasks

- [ ] **1. Add the token store** · afk
	- What it builds, in a sentence or two.
	- Done when: a stored token survives a restart.
- [ ] **2. Pick how the error reads** · hitl · blocked by 1
	- What it builds.
	- Done when: …
```

- The header lines sit at the very top, and only the ones that apply.
- Sub-tasks are numbered and never renumbered: `blocked by` points at those numbers, within the
  ticket only. Tick one by changing its `- [ ]` to `- [x]`.
- Write a sub-task to the user as `GRD-12(2)`, so they can tell it from a card. Branches, commits
  and PR titles keep the plain key.

## Docs: where they go

| Thing | Docs `repo` | Docs `notion` (see [NOTION.md](./backends/NOTION.md)) |
| --- | --- | --- |
| **The glossary** | `CONTEXT.md`, or the one `CONTEXT-MAP.md` points to | A `Spec` page named `Glossary` |
| **ADRs** | `docs/adr/0001-slug.md` | `Decision` pages |
| **Research write-ups** | Wherever the repo keeps them, often `docs/research/` | `Research` pages |
| **Plans and other specs** | `docs/` | `Plan` and `Spec` pages |

Docs in another tool (Confluence, Google Docs and so on) are mapped the same way as tickets:
see [OTHER.md](./backends/OTHER.md).

Wherever a skill says **the glossary** or **the ADRs**, it means whatever this table gives for
the project. The rules on what belongs in them are the same everywhere: see
[CONTEXT-FORMAT.md](../domain-modeling/CONTEXT-FORMAT.md) and
[ADR-FORMAT.md](../domain-modeling/ADR-FORMAT.md).

**These stay in the repo either way:** `README.md`, `ERROR_LOG.md`, and working files that a
skill reads back from disk, such as design snapshots in `docs/design/`.

**Docs that live outside the repo, but a repo copy still exists** (`CONTEXT.md`, `docs/adr/`):

- Read the outside copy first. Where both cover a topic, it wins.
- If it has none yet, read the repo copy, say the docs haven't moved, and offer to move them.
- Never add to the repo copy.

## Working notes

`~/.claude/board/<SHORT>.md` holds the user's notes for one project, in four sections. Read it if
it exists, and do what it says — it overrides the defaults in any skill:

| Section | Who reads it |
| --- | --- |
| **Before a ticket leaves To Plan** | `plan-ticket`, `to-prd`, `to-subtasks` |
| **Working a ticket** | `implement` — what to run, what not to run, where the code lives |
| **Review and merge** | `implement` and `review` — how a PR gets reviewed and what happens after merge |
| **Things that have bitten us** | Everyone |

Don't write to it unless asked. It's the user's file.

## `/tracker` on its own

Run the finding steps above for the current repo (or the short name given), then report in a
few lines: where tickets live, where docs live, the short name, whether the connector is
connected, and whether working notes exist. Write the config block if it's missing.
