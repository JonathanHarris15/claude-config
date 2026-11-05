---
name: notion-project
description: Set up a Notion teamspace to the project standard, or bring existing projects up to date with it. Notion copies don't follow their template, so this is what keeps every project alike. Use when the user starts a new project, says "/notion-project", or changes how projects should be laid out in Notion.
argument-hint: "new <SHORT> to set up a new project, or check <SHORT> / check ALL to compare projects with the standard"
---

# Notion Project

[STANDARD.md](./STANDARD.md) says what a project holds. This skill makes it true. Load the Notion
tools the way [NOTION.md](../plan-ticket/NOTION.md) says, and add `notion-get-teams`,
`notion-create-database`, `notion-update-data-source`, `notion-create-view` and `notion-update-view`.

Teamspaces are named `<SHORT> - <Project>`, which is where short names live. Find one with
`notion-get-teams`.

## `new <SHORT>`

**Notion's tools can't create a teamspace.** If `notion-get-teams` doesn't list one for this short
name, tell the user to create it in Notion, named `<SHORT> - <Project>`, and stop.

If it holds a home page or databases already, stop: this is `check`, not `new`.

Build in this order, because each step needs IDs from the one before:

1. **Home page.** `notion-create-pages` with the teamspace as `parent`, `full_width: true`, and
   `allow_async: false`.
2. **Databases.** Create Tickets, Epics and Docs under the home page, with the short name as the
   prefix on Tickets. Check the spelling first: every ticket key is built from it.
3. **Links.** Add `Epic` and `Blocked by` to Tickets, then `Progress` to Epics.
4. **Views.** Fetch each database to find its `Default view`, and configure the views in the standard.
   Create the two home page views with `parent_page_id` and `show_data_source_title: false`.
5. **Folders.** Create each page under the home page, then its list view with `parent_page_id`.
6. **Layout.** Fetch the home page, then use one `replace_content` to put it in the standard's order.
   **Fetch it again and check.** Notion can put a new `<columns>` block in the wrong place. If it did,
   fix it with one `update_content` holding two changes: cut the whole block, and paste it back after
   `## Folders`.

**Moving things on a page.** Tags with a URL point at blocks that already exist. Each new page and
database lands at the end of the home page, so move it by taking its exact tag from the fetch and
putting it where it belongs, all in one update. A tag for something not on that page is refused.

Report the home page link, and that tickets will read `<SHORT>-1` onwards.

## `check <SHORT>` or `check ALL`

`ALL` means every teamspace in `notion-get-teams` that isn't in the trash. For each one:

1. Find the home page and databases with `notion-search`, using `teamspace_id` and the query `Home`.
2. Fetch each database, its views and the home page. Don't query rows: this compares structure.
3. Compare them with the standard, and sort each difference:

| Difference | What to do |
| --- | --- |
| **Something is missing:** a database, property, option, view, folder, or a property a view should show | Add it |
| **Something is different:** a wrong type, name or filter | List it and ask. Changing it could break what's there |
| **Something extra:** a property or heading the standard doesn't name | Leave it. Mention it only if it looks like a mistake |
| **The home page is in a different order** | Mention it. Move things only if the user says so |

**Never touch tickets, docs or the text on a page.** Never remove or rename anything without asking.

**A project whose home page says its tickets live in Jira** skips Tickets and Epics. Its docs are
still checked. When it moves to Notion, a `check` builds what's missing.

**The ticket prefix can't be read until a ticket exists.** Once one does, `notion-fetch` shows it as
`SHORT-1`. If it doesn't match the teamspace name, list it and ask.

Report one line per project: already matching, or what you added and what needs a decision.

## Changing the standard

1. Edit [STANDARD.md](./STANDARD.md).
2. If the skills depend on the change, update [NOTION.md](../plan-ticket/NOTION.md) too.
3. Run `/notion-project check ALL`.

A change that only `check` can add is safe to roll out at once. One that renames or removes something
needs a plan first, because tickets and skills may rely on the old name.
