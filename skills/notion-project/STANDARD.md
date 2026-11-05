# The Notion project standard

What every project's teamspace should hold. This file is the one source of truth, and Wardrobe is
what it was taken from. **To change the standard, edit this file, then run
`/notion-project check ALL`.** Don't change one project by hand and leave the rest behind.

Below, `<Project>` is the project's name and `<SHORT>` its short name, both read from the teamspace
name `<SHORT> - <Project>`.

## Databases

Every property is listed in the DDL that `notion-create-database` takes.

### `<Project> Tickets`

```sql
CREATE TABLE ("Name" TITLE,
  "Status" STATUS('To Plan':gray:to_do, 'To Do':default:to_do, 'In Progress':blue:in_progress, 'In Review':purple:in_progress, 'Done':green:complete),
  "Type" SELECT('Feature':blue, 'Bug':red, 'Chore':gray, 'Research':yellow),
  "Priority" SELECT('High':red, 'Medium':yellow, 'Low':green),
  "Assignee" PEOPLE, "Due" DATE, "PR" URL,
  "ID" UNIQUE_ID PREFIX '<SHORT>')
```

Then, on the same data source, once Epics exists:

```sql
ADD COLUMN "Epic" RELATION('<epics data source id>', DUAL 'Tickets');
ADD COLUMN "Blocked by" RELATION('<tickets data source id>', DUAL 'Blocks' 'blocks')
```

### `<Project> Epics`

Description: `Groups tickets into projects. Epics stay off the ticket board.`

```sql
CREATE TABLE ("Name" TITLE,
  "Status" STATUS('Not started':gray:to_do, 'Active':blue:in_progress, 'Done':green:complete),
  "Due" DATE)
```

Then, after the Tickets relation has added `Tickets` here:

```sql
ADD COLUMN "Progress" ROLLUP('Tickets', 'Status', 'percent_per_group')
```

### `<Project> Docs`

```sql
CREATE TABLE ("Name" TITLE,
  "Kind" SELECT('Note':gray, 'Meeting':blue, 'Decision':green, 'Research':yellow, 'Spec':purple, 'Plan':orange, 'Diagram':pink),
  "From" SELECT('Claude':orange, 'Google Drive':blue, 'Upload':gray, 'Written here':default),
  "Date" DATE, "Added" CREATED_TIME, "Original link" URL)
```

## Views

Each database comes with a table view called `Default view`. The skills read rows through it, so it
must exist and must have no filter.

| Database | View | Type | Where | Setup |
| --- | --- | --- | --- | --- |
| Tickets | `Default view` | table | The database | `SHOW "Name", "ID", "Status", "Type", "Priority", "Assignee", "Epic", "Blocked by", "Due", "PR"` |
| Tickets | `Board` | board | The database | `GROUP BY "Status" BY OPTION SHOW EMPTY; SHOW "ID", "Type", "Priority", "Assignee", "PR", "Epic", "Blocked by", "Name"` |
| Tickets | `Ticket board` | board | Home page | The same, plus `SORT BY "Priority" ASC` |
| Docs | `Docs and notes` | table | Home page | `SORT BY "Added" DESC; SHOW "Name", "Added", "Kind", "Original link"` |

## Folders

One full-width page per folder, each holding one list view of Docs:
`FILTER "Kind" = "<Kind>"; SORT BY "Added" DESC; SHOW "Date", "From", "Name"`.

| Folder | Icon | `Kind` |
| --- | --- | --- |
| Notes | 📝 | Note |
| Specs | 📐 | Spec |
| Meetings | 🗓️ | Meeting |
| Plans | 🧭 | Plan |
| Decisions | ✅ | Decision |
| Diagrams | 📊 | Diagram |
| Research | 🔎 | Research |

## The home page

Full width, titled `<Project> Home`, laid out in this order:

1. The `Ticket board` view.
2. A link to `<Project> Epics`.
3. `## Folders`, then four columns: Notes and Specs; Meetings and Plans; Decisions and Diagrams;
   Research and a link to `<Project> Docs`.
4. The `Docs and notes` view.
5. A divider, the gray text `Full ticket database`, and a link to `<Project> Tickets`.

A project may add to its home page. Its own text and any heading it has added are its business.
