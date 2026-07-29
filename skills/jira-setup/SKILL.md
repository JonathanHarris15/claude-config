---
name: jira-setup
description: Link the current project to a JIRA project and make it the spine of the work — verify the Atlassian connection, discover the project's real issue types and statuses, write a Jira block into the project's CLAUDE.md, then run jira-doctor to check the board is healthy. Run this once per project, before any other JIRA skill. Use when a project isn't linked to JIRA yet, when /plan-ticket says setup is missing, or when the JIRA link needs re-pointing.
argument-hint: "Optional: the JIRA project key to link (e.g. METH). Omit to be shown the options."
---

# Jira Setup

**Run once per project.** This is the bootstrap for the whole JIRA-native workflow —
`plan-ticket`, `jira-doctor`, `create-epic`, `to-prd`, `to-issues` and `implement` all
depend on the block this writes into the project's `CLAUDE.md`. Without it they stop
and send the user here.

Read the board contract in [BOARD.md](../jira-doctor/BOARD.md) before you start. It
describes the workflow you are about to install; you will be writing a summary of it
into the project.

## Phase 1: Check the connection

The Atlassian tools are MCP tools and are likely **deferred** — load them first:

```
ToolSearch → jira search issues
```

**If nothing comes back, the connector isn't installed.** Stop and tell the user, in
plain terms: Claude has no Atlassian connection in this session. They need to add the
Atlassian connector (in Claude Desktop/Web: Settings → Connectors → Atlassian; in the
CLI: `claude mcp add`). Then re-run `/jira-setup`. Do not attempt any of the phases
below — everything depends on it.

**The connector's server prefix differs per install** (and changes if it's reinstalled),
so **never hardcode it**. Read the prefix off what that first call returns, then load the
rest in one `ToolSearch → select:…` using that prefix: `getAccessibleAtlassianResources`,
`getVisibleJiraProjects`, `getJiraProjectIssueTypesMetadata`, `searchJiraIssuesUsingJql`,
`atlassianUserInfo`.

## Phase 2: Find the site and project

1. `getAccessibleAtlassianResources` → the **cloudId**. If the user has more than one
   site, show them and ask which. If exactly one, take it and say which you took.
2. `getVisibleJiraProjects` (action `create`) → the projects they can file into.
   - If the user passed a key as an argument, confirm it exists and use it.
   - Otherwise **show the list and ask**. Don't guess from the repo name — a repo and a
     JIRA project rarely share a name, and picking wrong here poisons everything downstream.

## Phase 3: Discover what things are actually called

This is the phase that makes the config **portable**. Someone else cloning this setup has
a differently-configured JIRA. Nothing may be assumed.

**Issue types.** `getJiraProjectIssueTypesMetadata` for the project → the real type names
and their `hierarchyLevel`. Map them onto the three roles in `BOARD.md`:

- **level 1** → the Epic type (grouping, off-board).
- **level 0** → the *ticket* types — the cards. Look for `Feature`; a project may only have
  `Story` or `Task`. Also note the `Bug` type.
- **level −1** → the sub-task type (JIRA's `Subtask`, often renamed to `Task` — which is
  confusing, since `Task` is frequently *also* a level-0 name. Record both explicitly.)

If there is **no level-0 type suitable for Features**, say so and offer two options: use the
closest level-0 type (`Story`), or add a `Feature` type in the JIRA UI. Their call.

**Statuses.** There is no API here that lists a project's statuses, so **probe them with JQL**.
For each of the seven columns, run:

```
project = <KEY> AND status = "To Plan"
```

A status that exists returns results (possibly zero — that's fine, zero results means the
status exists but is empty). A status that **does not exist** makes JQL **error** with
something like *"The value 'To Plan' does not exist for the field 'status'"*. That error is
your signal. Probe all six: `To Plan`, `To Do`, `On Deck`, `In Progress`,
`In Review`, `Done`.

**Be honest about what this proves.** It proves the *status* exists in the project's workflow.
It does not prove a *board column* is mapped to it — there is no board API in this connector.
Say that plainly rather than claiming the board is verified.

**If statuses are missing:** Claude cannot create them. Hand the user an exact, do-this-in-the-UI
list — Project settings → Workflows (add the status) and Board settings → Columns (map it) —
naming precisely which of the seven are absent. Then offer to continue setup anyway; a partial
board still works, `jira-doctor` will just keep flagging it.

## Phase 4: Write the block into the project's CLAUDE.md

Write to the **project's** `./CLAUDE.md` — the one at the repo root, not the user's global
`~/.claude/CLAUDE.md`. Create it if it doesn't exist.

The fences matter: `jira-doctor` and `plan-ticket` **find and re-read this block by its
fences**, so reproduce them exactly. If a `<!-- jira-config -->` block already exists,
**replace it in place** rather than appending a second one.

```md
<!-- jira-config -->
## Jira

This project's work is tracked in Jira, and the board is the spine of it. Read this
before any planning or ticket work.

- **Site:** `example.atlassian.net`
- **Cloud ID:** `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- **Project:** `METH` — Methodology
- **Epic type:** `Epic` · **Ticket types:** `Feature`, `Task`, `Bug` · **Sub-task type:** `Subtask`
- **Board:** To Plan → To Do → On Deck → In Progress → In Review → Done

**The board carries level-0 tickets only.** Epics group them (never on the board);
sub-tasks live inside a card (never their own card).

**A ticket may not sit right of `To Plan` without a PRD on it.** `To Do` and `On Deck`
are a promise the thinking is finished. `To Do` additionally promises the next step is
buildable without you; `On Deck` means the next step needs your judgment.

- New idea, however rough → file it in **To Plan**.
- Plan it → `/plan-ticket <KEY>`, or `/plan-ticket ALL` for the whole To Plan column.
- Build it → `/implement <KEY>`.
- Board looking wrong → `/jira-doctor`.
<!-- /jira-config -->
```

Fill in the **real discovered names**, not the placeholders. If the project has no `Feature`
type, the `Ticket types` line must say what it really has.

## Phase 5: Hand off to the doctor

Run `/jira-doctor` immediately. Setup proves the *connection* is good; the doctor proves the
*board* is good, and it will almost always find something on a project that predates this
workflow — tickets in no column, tickets sitting in `To Do` that were never specced, a missing
status.

Report at the end, briefly: the site and project you linked, what the issue types are really
called, which of the seven statuses exist, and what the doctor found.
