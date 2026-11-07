# Where a project keeps its work

Projects differ. This file says how to find out what this one uses. Every ticket skill and
every skill that touches the glossary or ADRs comes through here, and none of them name a
tool from Jira or Notion. Those names live in the two backend files:

- [JIRA.md](./JIRA.md) — tickets in Jira.
- [NOTION.md](./NOTION.md) — tickets, docs, or both in Notion.

[BOARD.md](./BOARD.md) says what the columns and levels mean, whichever backend holds them.

## Two switches, set per project

| Switch | Values | What it holds |
| --- | --- | --- |
| **Tickets** | `notion`, or `jira` for older projects | Epics, tickets, sub-tasks, the board |
| **Docs** | `notion`, or `repo` for older projects | The glossary, ADRs and write-ups |

They move apart. A project can keep tickets in Jira and docs in Notion, so never read one
switch from the other. **New projects go in Notion. Jira is being phased out**, so don't set up
anything new there.

**A project may have no code yet.** Planning, epics and docs all work without a repo. Skip the steps
that read code and say so. There is nothing for `implement` to build until a repo exists, so it stops.

## Finding the switches

If you're in a repo, read the `<!-- tracker-config -->` block in its `CLAUDE.md` (or `AGENTS.md`):

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

A Jira project lists its site, cloud ID, project key and type names in place of the data
sources. Leave out any line that doesn't apply.

**An older `<!-- jira-config -->` block still counts.** It means Tickets `jira`, Docs `repo`,
and the short name is the project key. Add a `tracker-config` block only when one of those
changes. If both exist, `tracker-config` wins.

**No block, or no repo?** Teamspaces hold the answer. They are named `<SHORT> - <Project>`:

1. Take the short name from the ticket key you were given, or ask. **Never guess one.**
2. Find its teamspace with `notion-get-teams`, then its home page and databases with `notion-search`,
   using `teamspace_id` and the query `Home`.
3. If the home page says tickets live in Jira, Tickets is `jira`. Otherwise both switches are `notion`.
4. If you're in a repo, offer to write the block so the next run can skip this.

A short name with no teamspace may be an older Jira project: look for a Jira project with that key.
If two places could both be right, ask which.

**A key whose prefix doesn't match the short name** means the wrong repo or a typo. Stop and
say so.

**If the backend isn't connected, stop and say so.** Do not fall back to the other one. A
decision written to the repo on a Notion project is a decision nobody will find.

## Tickets: what you can do

Skills ask for these by name. The backend file says how each one works there.

| Action | Means |
| --- | --- |
| **Read a ticket** | Title, body, type, column, labels, epic, blockers, comments, sub-tasks |
| **List a column** | Every ticket in one column, oldest first |
| **Create a ticket** | A new level-0 ticket, in `To Plan` unless told otherwise |
| **Write the body** | Replace or edit the ticket's body. Read it first and keep what you didn't write |
| **Add a label** | `trivial`, `investigation` and the like |
| **Add a blocker** | Record that one ticket must wait for another |
| **Move a ticket** | Put it in another column. Never invent a column |
| **Comment** | Add a short note to the ticket |
| **Close a ticket** | Finish a ticket that produced a decision or was replaced, with a comment saying why |
| **Create an epic** | A grouping with a vision, which its tickets point back to |
| **Read an epic** | The epic and the tickets under it |
| **Add sub-tasks** | Add steps inside a ticket, each marked `afk` or `hitl`, with any blockers |
| **Tick a sub-task** | Mark one step done |
| **Link code** | Use the key in branch, commit and PR so the ticket shows the work |

## Docs: where they go

| Thing | Docs `repo` | Docs `notion` (see [NOTION.md](./NOTION.md)) |
| --- | --- | --- |
| **The glossary** | `CONTEXT.md`, or the one `CONTEXT-MAP.md` points to | A `Spec` page named `Glossary` |
| **ADRs** | `docs/adr/0001-slug.md` | `Decision` pages |
| **Research write-ups** | Wherever the repo keeps them, often `docs/research/` | `Research` pages |
| **Plans and other specs** | `docs/` | `Plan` and `Spec` pages |

Wherever a skill says **the glossary** or **the ADRs**, it means whatever this table gives for
the project. The rules on what belongs in them are the same in both places: see
[CONTEXT-FORMAT.md](../domain-modeling/CONTEXT-FORMAT.md) and
[ADR-FORMAT.md](../domain-modeling/ADR-FORMAT.md).

**These stay in the repo either way:** `README.md`, `ERROR_LOG.md`, and working files that a
skill reads back from disk, such as design snapshots in `docs/design/`.

**On a `notion` project that still has `CONTEXT.md` or `docs/adr/` in the repo:**

- Read Notion first. Where both cover a topic, Notion wins.
- If Notion has none yet, read the repo copy, say the docs haven't moved, and offer to move them.
- Never add to the repo copy.
