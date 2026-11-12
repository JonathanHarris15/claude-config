# Working with any other tool

How to run the workflow on a tool that has no backend file of its own — Linear, Asana, Todoist,
Trello, ClickUp, Confluence or anything else with a connector. You map it **once**, write the map
into the project's config block, and every later run reads the map instead of working it out.

If a tool gets used across several projects, turn its map into a backend file of its own next to
[JIRA.md](./JIRA.md), and add it to the table in [the tracker skill](../SKILL.md).

## 1. Find the connector

`ToolSearch` with the tool's name and what you're about to do, such as `linear create issue`. Read
the prefix off the result and load what you need with `ToolSearch → select:…`.

**No connector, or it failed to connect?** Stop. Say which connector the project needs, and that
the user can add or reconnect it in their connector settings. Never fall back to another tool.

## 2. Map the three levels and five columns

Read the tool's own words for things, from its metadata tools or one real project. Then fill this
map. **Where the tool has no native home for something, use the shared text form** in the
ticket's body (see [the tracker skill](../SKILL.md#the-shared-text-form)). That always works.

| Workflow needs | Look for | Fallback |
| --- | --- | --- |
| **Ticket** (level 0) | An issue, task or card | — every tool has one |
| **Epic** | A project, milestone, initiative, parent issue or list | A ticket marked `epic` and kept off the board |
| **Sub-task** | — | Always the checklist in the body. Native sub-tasks become cards in most tools |
| **Columns** | A status or workflow field, sections, or board lists | Labels named after the columns |
| **Done** | The tool's completed state | Closing or completing the item |
| **Labels** | Labels or tags | The `Labels:` line |
| **Investigation** | A type such as `Research` or `Spike`, or a label | The `investigation` label |
| **Blocker** | A "blocked by" relation | The `Blocked by:` line |
| **Due date** | A due date field | The `Due:` line |
| **Key** | The tool's ID, like `ENG-12` | — |

**Map columns to the five names, never the reverse.** If the tool lacks one (often `In Review`),
skip it, as [BOARD.md](../BOARD.md) says. Never create a status in the user's tool without asking.

## 3. Check every action has a way

Walk the action table in [the tracker skill](../SKILL.md) and name the call for each one. An
action with no way at all — no tool and no body fallback — is a gap: tell the user which, and
what it costs, before planning anything.

## 4. Write the map down

Add it to the config block, so the next run starts here:

```md
- **Tickets:** linear
- **Team:** ENG
- **Epic:** Linear project
- **Columns:** Backlog → Todo → In Progress → In Review → Done (as To Plan → To Do → …)
- **Labels / blockers / due / sub-tasks:** native / native / native / body checklist
```

## Docs in another tool

Same idea, smaller map: where the glossary lives, where ADRs live, and how to find the next ADR
number. If the tool can't hold numbered pages, number them in the title.

## Things every tool needs

- **Read before you write.** Most tools replace a whole field on update. Fetch the body and the
  label list first, fold your change in, then write.
- **Never invent a status, type or label option.** Use what the tool lists.
- **Link code with the key** in the branch, commit and PR title, so the work is findable from the
  ticket even if the tool doesn't link it on its own. If it doesn't, comment the PR link on the
  ticket when the PR opens.
