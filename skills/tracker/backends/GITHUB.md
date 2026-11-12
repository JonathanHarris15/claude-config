# Working with GitHub Issues

How to do the actions in [the tracker skill](../SKILL.md) on a project whose tickets are GitHub
issues. [BOARD.md](../BOARD.md) says what the columns and levels mean. Docs are a separate switch:
GitHub has no docs store here, so Docs is `repo` or another tool.

GitHub Projects boards aren't reachable through the issue tools, so **the board is labels**: one
column label on each open ticket, and closed means `Done`. A Projects board can still show those
labels as its columns if the user wants a picture.

| Action | How |
| --- | --- |
| Load the tools | See [Loading the tools](#loading-the-tools) |
| Read a ticket | `issue_read` with `get`, then `get_comments`. Labels, blockers and sub-tasks come from the body and labels |
| List a column | `list_issues` with `state: OPEN`, `labels: ["<column>"]`, `orderBy: CREATED_AT`, `direction: ASC` |
| Create a ticket | `issue_write` `create`, with the `To Plan` label |
| Write the body | `issue_read` first, then `issue_write` `update` with the whole new `body` |
| Add a label | `issue_write` `update` with the full label list: it replaces, so fold your change in |
| Mark as investigation | The `investigation` label |
| Add a blocker | The `Blocked by:` line at the top of the body |
| Move a ticket | Swap the column label. To `Done`: close it |
| Comment | `add_issue_comment` |
| Close a ticket | Comment why, then `issue_write` `update` with `state: closed` and `state_reason` (`completed`, or `not_planned` for a ticket that was replaced) |
| Create an epic | An issue labelled `epic` and **no** column label. See [Epics](#epics) |
| Read an epic | `issue_read` `get`, then `get_sub_issues` |
| Add sub-tasks | A checklist in the body, in the shared text form |
| Tick a sub-task | Edit the body: `- [ ]` to `- [x]` |
| Link code | See [Linking code](#linking-code) |

## Loading the tools

The GitHub tools may be deferred, and their prefix can differ per install, so **never hardcode
it**. Start with `ToolSearch → github issue`, read the prefix off the result, then load
`issue_read`, `issue_write`, `list_issues`, `add_issue_comment` and `sub_issue_write` in one
`ToolSearch → select:…`.

## Knowing where you are

- **`owner/repo`** — from the config block, or `git remote get-url origin`.
- **Key** — the issue number, written `#12`. Use the config block's short name only for the
  working notes file; tickets don't carry it.
- **Types** — if `list_issue_types` returns types for the owner, set `type` (`Feature`, `Bug`,
  `Task` or whatever it lists). Otherwise use the labels `feature`, `bug`, `chore`.

The config block on GitHub:

```md
- **Short name:** WARD
- **Tickets:** github
- **Repo:** owner/repo
- **Docs:** repo
- **Columns:** To Plan → To Do → In Progress → In Review → Done (closed)
```

## Labels

Columns, the investigation flag and the `trivial` mark are all labels. Use the column names
exactly as the config block gives them. A label that doesn't exist yet is made the first time
you apply it; if the call refuses, tell the user which labels to create and stop.

**Exactly one column label on an open ticket.** Two is the board lying; fix it and say so. An open
ticket with none is in `To Plan`.

## Blockers and due dates

GitHub's own issue links aren't reachable here, so blockers and due dates are the header lines at
the top of the body, in the shared text form: `Blocked by: #9, #11` and `Due: 2026-09-01`. A blocker
is open unless that issue is closed.

## Epics

An epic is an issue labelled `epic`, with no column label so it stays off the board. Its body
holds the sections `create-epic` asks for, and its `Due:` line holds the end date.

Create each ticket under it with `issue_write` `create` and `parent_issue_number` set to the
epic's number. That makes it a sub-issue in one call. To attach an existing ticket, use
`sub_issue_write` `add` with the ticket's **id** (not its number — read it from `issue_read`).

Close the epic when its last ticket closes.

## Linking code

- **Branch:** `12-add-oauth`
- **Commit:** `#12 add token refresh`
- **PR title:** `#12: add OAuth`, and **`Closes #12`** in the PR body

`Closes #12` closes the ticket when the PR merges, which moves it to `Done` on its own. Swap the
`In Progress` label for `In Review` yourself when the PR opens.
