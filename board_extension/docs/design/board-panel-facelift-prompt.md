# Board panel facelift — Claude Design prompt

No ticket. Written 2026-08-26 for `board_extension` in `JonathanHarris15/claude-config`.

There is no design system project for this extension and no `.claude/design.json`,
so `design-sync` was not run — there are no tokens of our own to sync. Its design
system is VS Code's, and that is a harder constraint than usual: the page is
painted into somebody else's theme and must survive all of them.

---

## What to read

**This is a VS Code webview, not a web page.** Before anything else, read
VS Code's own webview and colour-token guidance — the page inherits the editor's
theme and must work in light, dark and high-contrast without knowing which.

**The repo:** `JonathanHarris15/claude-config`, branch `main`, folder
`board_extension/`. ⚠ That folder is **not committed yet**, so *Choose a
repository* will not find it — use **Link local code** and point at
`C:\Users\jono1\.claude\board_extension`.

Which file settles which question:

| Question | File |
| --- | --- |
| What the board and panel render today, and every interaction | `media/board.js` |
| Current styling, and every theme token already in use | `media/board.css` |
| The page skeleton, and the CSP the design must live inside | `src/extension.ts` — the `render()` function only |
| What a ticket *is*: the six columns, what may sit where, the PRD rule | `../skills/plan-ticket/BOARD.md` |
| Ticket, detail, sub-task and timeline data shapes | `src/board.ts` |
| Agent states, chat entry roles, what the agent can do | `src/agent.ts` |

`BOARD.md` is the domain language for this project — there is no `CONTEXT.md`.
Read all of it; it is short and it is the contract the whole extension obeys.

Out of scope: everything under `src/twg.ts`, `test/`, and the **Spaces sidebar**.
That sidebar is a native VS Code tree — the editor draws it and CSS cannot reach
it. The screen being redesigned is the **board tab** only: its columns, its cards
and its detail panel.

---

## 1. The job

One person runs four software projects alone, with Claude agents doing much of
the building. The board tab is where he watches all of it: every ticket in a
space laid out by stage, and the agents working them. He opens it to answer two
questions — what is happening, and what is waiting on me — and then to act on
whichever ticket answers the second.

Today the panel fails him in two ways. Everything about a selected ticket is
stacked in one long column — labels, buttons, the live agent conversation,
sub-task progress, then JIRA history — so the agent's question, the one thing
that actually needs him, is usually below the fold while the history he rarely
reads sits above it. And the ticket's description, which is the specification
the agent is building from, is not shown at all. To read the spec he leaves for
JIRA in a browser, and to correct it he stays there.

---

## 2. What is real — use these, do not invent

These are the real values from the product. Use them exactly. If you need
something not listed, look for it in the code first; if it is not there either,
mark what you used as a suggestion.

**This section is a digest of the code, not a replacement for it. Where the two
disagree, the code wins — and tell me where you found a difference.**

### The six columns, in this order

`To Plan` → `To Do` → `On Deck` → `In Progress` → `In Review` → `Done`

Real counts on the METH board right now, and they are lopsided on purpose —
three columns are empty and one holds most of the tickets:

| To Plan | To Do | On Deck | In Progress | In Review | Done |
| --- | --- | --- | --- | --- | --- |
| 9 | 0 | 0 | 1 | 0 | 15 |

An empty column currently renders the word *empty* in italics. Three empty
columns in a row is the normal case, not an edge case.

### Spaces

`HAS` Harris Appraisals Software · `LAB` Lab · `METH` Method · `MS` Mosaic Services

### What appears on a card

Issue types, and only these three: `Task`, `Bug`, `Feature`. Epics and sub-tasks
are never cards — epics are grouping, sub-tasks render inside their parent.

Every ticket on the board today has priority `Medium`. Others exist in JIRA but
do not currently appear.

Labels seen in use: `afk`, `alpha`, `frontend`. The board contract also defines
`trivial`, `investigation` and `hitl`. `afk` means an agent can build it without
asking; `hitl` means it needs a human decision. Those two carry the most meaning
and currently get a green and an amber pill.

### Real tickets — use these, not invented ones

| Key | Type | Column | Summary |
| --- | --- | --- | --- |
| METH-390 | Task | To Plan | Default Bible translation: ESV instead of ASV |
| METH-342 | Feature | To Plan | Cloud save: a tester's study work survives losing the machine |
| METH-335 | Feature | To Plan | Export my library: one file a tester can put anywhere |
| METH-28 | Task | To Plan | Bible arcing. |
| METH-27 | Task | To Plan | Sentence Diagramming |
| METH-26 | Task | To Plan | Greek and Hebrew for searching |
| METH-48 | Task | To Plan | Symbol editor (graphical custom-symbol creator) |
| METH-22 | Task | In Progress | Multiple version support |
| METH-336 | Task | Done | Chiasm Tools |

**The one that breaks the layout.** A real bug title, 197 characters, and it must
be drawn as it actually is:

> METH-391 · Bug · To Plan
> `Method stopped unexpectedly: TypeError: 'PySide6.QtCore.QObject.eventFilter' called with wrong argument types:  PySide6.QtCore.QObject.eventFilter(QWidgetItem, QDynamicPropertyChangeEvent)Supported`

Today that single card is taller than four others combined and shoves the rest of
the column below the fold. The shortest is `Chiasm Tools` — twelve characters.
Both are normal. Whatever you do has to hold both.

### Live agent state

Ephemeral, owned by the extension, never written to JIRA. Six states, with the
exact words currently shown on the badge:

| State | Badge reads | Means |
| --- | --- | --- |
| `idle` | *(no badge)* | no session |
| `thinking` | thinking | model is generating |
| `working` | working | running a tool |
| `asking` | **needs you** | holding a tool, blocked on a human answer |
| `done` | done | turn finished |
| `error` | failed | the run broke |

`asking` is the one the whole board exists for. It should be findable without
reading — the user described wanting to see it from across the room. Everything
else can be quiet.

### The ticket's conversation

Chat entries have exactly four roles: `you`, `agent`, `tool`, `system`. A `tool`
entry is one line, already summarised, and looks like real examples:

- `Read: c:/Users/jono1/Profesional Projects/Method/src/reader/view.py`
- `Bash: git status --short`
- `move_ticket: In Progress`

When the agent wants to run something it stops and asks, and the panel shows the
tool with **Allow** and **Deny**. That prompt is the reason the ticket is in the
`asking` state, and both need to be obvious at once — the card on the board and
the prompt in the panel.

### The description — the new tab

Structured content from JIRA: headings, paragraphs, bullet lists and links. A
planned ticket carries a PRD, which always has a `Problem Statement` heading and
an `Acceptance Criteria` heading. Real opening of METH-334's description, which
runs to about 16,000 characters:

> Specced 2026-08-15. Grilled against the domain model; decisions recorded in
> ADR-0045 — Usage is counted against named keys, never recorded as events. Six
> new glossary terms in CONTEXT.md: Session, Usage Analytics, Attended Time,
> Usage Counter, Usage Run, Install Id.
>
> **Problem Statement**
>
> The alpha gives two sources of feedback, and both share a blind spot. A Report
> (METH-58) tells you what a tester noticed. A conversation (METH-37) tells you
> what a tester can recall and articulate. Neither can tell you about the part of
> Method nobody ever opened.

A ticket in `To Plan` usually has a short unstructured description or none at
all. A ticket with no PRD sitting right of `To Plan` is a contract violation and
currently gets a red **no PRD** pill. Both cases need to look right.

Sub-task progress is real too: METH-334 has **11 sub-tasks, all 11 done**. Most
tickets have none.

### JIRA history

Transitions and comments, oldest first. Real entries:

- `2026-08-25 14:36 · Jonathan Harris — IssueParentAssociation: empty → METH-66`
- `2026-08-26 08:54 · Jonathan Harris — Rank: empty → Ranked higher`
- `2026-08-26 08:54 · Jonathan Harris — To Do → To Plan`

Most tickets have between one and five. Many have no comments at all.

### The states this screen has

Empty column · whole board empty · loading a ticket's detail · a ticket with no
sub-tasks and no history · a ticket mid-conversation with an agent · an agent
blocked on a permission · a failed run · and the bad day: the `twg` CLI login has
expired, and every query fails at once with a message telling the user to run
`twg doctor`.

---

## 3. Compose from these

There is no component library and no design system project. There is one rule
that stands in for both: **every colour, font and border comes from a VS Code
theme token, and the page must look deliberate in a light theme, a dark theme
and a high-contrast theme it has never seen.** A raw hex value is a bug.

The tokens already in use, which is the vocabulary to build from:

`--vscode-foreground` · `--vscode-font-family` · `--vscode-font-size` ·
`--vscode-editor-background` · `--vscode-editor-font-family` ·
`--vscode-editorWidget-background` · `--vscode-panel-border` ·
`--vscode-focusBorder` · `--vscode-list-activeSelectionBackground` ·
`--vscode-badge-background` · `--vscode-badge-foreground` ·
`--vscode-button-background` · `--vscode-button-foreground` ·
`--vscode-button-hoverBackground` · `--vscode-button-secondaryBackground` ·
`--vscode-button-secondaryForeground` · `--vscode-input-background` ·
`--vscode-input-foreground` · `--vscode-input-border` ·
`--vscode-inputValidation-errorBackground` ·
`--vscode-inputValidation-errorBorder` · `--vscode-editorWarning-foreground` ·
`--vscode-testing-iconPassed` · `--vscode-testing-iconFailed` ·
`--vscode-charts-blue` · `--vscode-textBlockQuote-background` ·
`--vscode-textCodeBlock-background`

Reach for other `--vscode-*` tokens where they fit better — there are many more
— but name each one you introduce so it can be checked against a real theme.

The existing class names are `column`, `card`, `badge`, `tag`, `chat-log`,
`chat-entry`, `permission`, `timeline`, `subtask`. Treat them as the current
shape, not a constraint. **If none of it fits what the panel needs to become,
say so and design the new thing** — a genuinely new primitive is a good outcome.
A card bent into a tab strip is not.

Icons: VS Code ships a built-in codicon set and the extension already names
`$(refresh)` in its toolbar. Prefer codicons; if you use something else, say so.

---

## 4. What is open

Have opinions here — this is what is being commissioned.

1. **The panel becomes tabbed: History, Agent, Description.** The arrangement is
   yours. Which tab opens first, whether that depends on the ticket's state,
   whether a tab can signal it has something new — an agent asking while you are
   reading the description is the case to solve.
2. **The Description tab must read *and* edit**, and it is the same description
   JIRA shows. How reading turns into editing, how saving and discarding are
   offered, and what a 16,000-character PRD looks like in a panel roughly 380
   pixels wide.
3. **How a card carries agent state.** Colour, badge, motion, position — the
   brief is only that `needs you` must be findable without reading the board.
4. **Card density and column layout**, given one card can be twelve characters
   and another two hundred, and three columns are usually empty.
5. **Whether the board needs somewhere board-wide** that answers "what is waiting
   on me" without hunting through six columns.
6. **The whole visual character.** It currently looks like default VS Code with
   boxes. It should look like a considered tool that belongs inside the editor.

---

## 5. Constraints

- **Strict CSP.** No CDN, no external stylesheet, no remote image, no fetch, no
  web font. Everything inline or a data URI. A design that needs a downloaded
  font cannot be built.
- **Theme tokens only**, per section 3. Light, dark and high contrast.
- **Two widths.** Wide: about 1400px, the normal full-editor case. Narrow: about
  500px, which is a split editor — the columns currently stack there. Not a
  phone; this never runs on one.
- The **six columns and their order are fixed** by the board contract. Their
  presentation is not.
- The panel is currently about 380px and sits to the right of the columns.
  Whether it stays there is open; that it must not hide the board is not.
- Keyboard reachable throughout — this is an editor, and its users live there.

---

## 6. What to send back

Three things:

1. The export prompt.
2. **Anything you placeholdered or invented**, called out plainly — especially
   any ticket, label, state or field name that is not in section 2.
3. **Anywhere the code and section 2 disagreed**, and which one you followed.
   Section 2 was written by reading the code on 2026-08-26; if it has already
   drifted, that is a bug in one of them and I need to know which.
