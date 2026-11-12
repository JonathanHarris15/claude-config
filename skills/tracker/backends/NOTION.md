# Working with Notion

How to do the actions in [the tracker skill](../SKILL.md) on a Notion project.
[BOARD.md](../BOARD.md) says what the columns and levels mean.

## Loading the tools

The Notion tools may be deferred, and their prefix differs per install, so **never hardcode
it**. Start with `ToolSearch → notion search`, read the prefix off the result, then load what
you need with `ToolSearch → select:…`. Nearly everything needs `notion-fetch`,
`notion-query-data-sources`, `notion-update-page`, `notion-create-pages`,
`notion-create-comment` and `notion-get-comments`.

Before writing page content the first time in a session, read
`notion://docs/notion-flavored-markdown-spec` with `notion-fetch`.

## How each project is laid out

Each project has a home page, and on it:

- **`<Project> Docs`** — one database that holds every document. Its `Kind` property decides
  where a page shows up.
- **The folders** — `Notes`, `Specs`, `Meetings`, `Plans`, `Decisions`, `Diagrams`, `Research`.
  Each is a filtered view of that one database, not a real folder.
- **`<Project> Tickets`** — the board. Some projects don't have one because their tickets live
  in Jira. Their home page says so.
- **`<Project> Epics`** — the groupings. A separate database, which keeps epics off the board.

**Never create a page under a folder page.** It won't appear in the folder. Create a row in the
Docs database and set `Kind`.

Fetch each data source once per session and trust what it says over this file:
**use the real property and option names, and never invent one.**

**A project with no Epics database, or no `Epic` and `Blocked by` on its tickets, hasn't been brought
up to the standard.** Stop and offer `/notion-project check <SHORT>`. The layout itself is defined in
[STANDARD.md](../../notion-project/STANDARD.md).

## Reading rows: use views, not SQL

**SQL and rows mode share a small allowance across the workspace, and running out blocks them for up
to an hour.** View mode doesn't count against it, so make it the default:

```json
{"data": {"mode": "view", "view_url": "view://…"}}
```

Fetch the database to find its `Default view`. It has no filter and returns every property, so filter
the rows yourself. If `has_more` is true, pass `next_cursor` as `start_cursor`.

Use SQL only when a view can't answer, and only for one query at a time. If you hit the limit, say so
and carry on with views. Don't retry.

## Docs

Every page you write goes in the Docs data source with `From` set to `Claude`. Put the title in
`Name`, not in the content.

| Thing | `Kind` | `Name` |
| --- | --- | --- |
| ADR | `Decision` | `0007 — Short title`. Also set `Date` to today |
| Glossary | `Spec` | `Glossary`, or `Glossary — Desktop` when the project has several contexts |
| Research write-up | `Research` | What it answers |
| Other spec or plan | `Spec` / `Plan` | What it is |

**Finding them.** Read the Docs `Default view` and pick rows by `Kind` and `Name`, then fetch the pages
you need.

- **Glossary:** `Kind` is `Spec` and `Name` starts with `Glossary`. Create it when the first term
  is settled, not before. With several contexts, work out which one the topic belongs to, and
  ask if it's unclear.
- **ADRs:** `Kind` is `Decision`. Read the titles, then fetch the ones in your area.
- **Next ADR number:** the highest number on a `Decision` page, plus one. Pages without a number
  are decisions someone recorded by hand: read them, but don't number them or count them.

**Meetings and Notes hold context a ticket often leaves out**, such as who asked for what and
why. When planning, search them for the ticket's subject. Read them, but don't edit them.

**Editing a glossary term:** use `notion-update-page` with `update_content` and change only that
term. To add a term, use `insert_content`.

## Tickets

A ticket is a row in the Tickets data source, and its page content is the body.

| Property | Use |
| --- | --- |
| `Name` | The title |
| `Status` | The column |
| `Type` | `Feature`, `Bug`, `Chore` or `Research` |
| `Epic` | The epic it belongs to |
| `Blocked by` | Tickets that must finish first. `Blocks` is the same link seen from the other side |
| `Priority`, `Due` | As set. Write a due date as `date:Due:start` |
| `Assignee` | Who holds it |
| `PR` | The pull request's URL |
| `ID` | The key. A view returns `12`, and a fetched page returns `GRD-12` |

Set `Epic` and `Blocked by` to an array of page URLs.

### Reading a ticket

Read the Tickets `Default view` and find the row whose `ID` is the number in the key. Then
`notion-fetch` its `url` for the body, and `notion-get-comments` for the comments.

### Listing a column

Read the Tickets `Default view` and keep the rows with that `Status`. Rows come back without a created
time you can sort by, so to take the oldest, use the lowest `ID`.

A blocker is open unless that ticket's `Status` is `Done`. `Blocked by` holds page URLs, so match them
against the `url` of the other rows.

### Creating a ticket

`notion-create-pages` with the Tickets data source as `data_source_id`, `allow_async: false`, and
`Name`, `Status`, `Type`, plus `Epic` if it has one. Leave the title out of the content. Fetch the new page to get its key.

### Writing the body

Fetch first. For a small change, use `notion-update-page` with `update_content`. To write a whole
PRD, use `replace_content`, folding in anything worth keeping. Never pass
`allow_deleting_content` without asking.

### Labels and investigations

The database has no labels, so they are the `Labels:` line at the top of the body, in the shared
text form (see [the tracker skill](../SKILL.md#the-shared-text-form)). Read it from the fetched
body, because SQL can't see inside a page.

**Mark as investigation** by setting `Type` to `Research`. That replaces the `investigation` label:
any `Research` ticket is an investigation ticket, and its `Name` still carries the `[research]`,
`[prototype]`, `[grill]` or `[task]` prefix.

### Moving a ticket

Notion has no workflow rules, so set `Status` with `update_properties`. That makes the board's
rules yours to uphold: nothing else will stop a bad move. Use only options the schema lists.

### Comments and closing

`notion-create-comment` with `page_id` and `markdown`. Comments hold inline text only, with no
lists or headings, so a long note belongs in the body.

To close a ticket, comment why, then set `Status` to `Done`. Notion has no separate "won't do".

### Epics

An epic is a row in the Epics data source, and its page content holds the sections `create-epic`
asks for. Set `Due` for its end date, and move `Status` to `Active` when its first ticket starts
and to `Done` when its last one finishes.

To read an epic, fetch the row, then match the URLs in its `Tickets` property against the Tickets
`Default view`. Refer to an epic
by name: epics have no key.

### Sub-tasks

Steps are a checklist in the ticket's body, not rows, so they never get a card. Write them in the
shared text form (see [the tracker skill](../SKILL.md#the-shared-text-form)).

To tick one, use `update_content` to change its `- [ ]` to `- [x]`. Copy the line from the fetched
page, because bold comes back as `<b>…</b>`: the match is `- [ ] <b>1. Add the token store</b>`.

### Linking code

Use the key the same way everywhere:

- **Branch:** `GRD-12-add-oauth`
- **Commit:** `GRD-12 add token refresh`
- **PR title:** `GRD-12: add OAuth`

Notion links a PR by the key in its title once GitHub is connected. There are no commands in
commit messages here, so nothing moves on its own. After opening the PR, set the `PR` property and
move the ticket yourself.
