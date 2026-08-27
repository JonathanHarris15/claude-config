# Board

A VS Code window that shows the JIRA board described in
[`skills/plan-ticket/BOARD.md`](../skills/plan-ticket/BOARD.md), and hands
tickets to Claude Code.

Lives in `claude-config` so every machine that clones the config gets it. The
skills it drives (`plan-ticket`, `implement`) are the ones already in
`~/.claude/skills`, so there is nothing to keep in sync.

## What it does today (slice one)

- A **Board** icon in the Activity Bar, next to Explorer and Claude. The
  sidebar it opens lists your JIRA spaces — click one and its board opens as
  an editor tab. One tab per space, reused if you pick the same one again.
  VS Code only ever opens side panels from that strip, so the list is the
  door and the board itself lives in the main editor where it has room.
- Six columns — To Plan, To Do, On Deck, In Progress, In Review, Done — read
  live from JIRA through the `twg` CLI, refreshed every 30 seconds.
- **Epics are swimlanes.** One row per epic running across all six columns,
  biggest epic first and unparented last, under a single shared header row. An
  epic's whole progress reads in one glance. Epics stay grouping and never
  become cards.
- **Dragging a card into another lane reparents it** to that epic, or out of
  one entirely in the No epic lane. Where you dropped it is what you meant.
- **Drag a card to any column.** This is the human overruling the board: no PRD
  check, no agent opinion, no confirmation. JIRA is the only thing that gets a
  veto, and if it refuses, the card snaps back and says why.
- **A `+ ticket` button at the foot of every column.** Pick a type and an
  optional epic, type a summary, press Enter. The card appears
  instantly and is replaced by the real one when JIRA answers. Where a new
  ticket lands is read from JIRA rather than assumed, then moved if needed. Issue types are read from the space, never hardcoded.
- **A top bar over the board.** The space and its count on the left, a filter
  box, then the **agent rail**: one pill per live agent, its state as a dot and
  a running clock, "needs you" first, loudest, and pulsing amber. Click a pill
  and you are in that ticket's conversation. This is the board-wide answer to
  "what is waiting on me" — no hunting through six columns.
- **Filter as you type.** Every word must land somewhere in the key, summary,
  type, labels, epic or status. Lanes the filter empties disappear; counts
  show what is left. `/` focuses the filter, Escape clears it or closes the
  detail panel.
- Cards carry their priority (only when it is not Medium), up to two labels,
  and how long since they moved — "3d" answers "is this stale?" without a
  date to parse.
- Errors get a close button and leave on their own after fifteen seconds. They
  used to be wiped by the next board refresh, which arrived right after the
  very action that failed.
- A loading skeleton instead of a blank page, motion only where it means
  liveness, and none of it for anyone whose OS asks for reduced motion.
- Only level-0 items are cards. Epics are grouping and sub-tasks render inside
  their parent, so the JQL excludes both. Column counts would otherwise lie.
- Click a card for a detail panel with four tabs. **Description** is the spec,
  with sub-task progress above it so a 16,000-character PRD never buries "how
  far along is it". **Agent** is the conversation. **Log** is the raw record:
  every transition and comment from JIRA. **History** is the story — Claude
  reads the log, the spec and the conversation and tells what happened, what
  was decided and why, in the plain voice of the `/wait-what` skill using the
  repo's `CONTEXT.md` words. Written only when you ask (one turn, no tools,
  `board.storyModel`), kept in the repo as `.board/history/<TICKET>.md`, and
  flagged when the log has moved on since.
- A **no PRD** badge on any ticket sitting right of `To Plan` without one —
  the integrity rule, checked rather than trusted.
- **The header carries only what you cannot say to an agent**: Open in JIRA,
  Stop agent while one is running, and — when a ticket reaches In Review — a
  **Mark complete** button that transitions it to Done. That last one is
  deliberately a human action: agents are told to stop at In Review.
- **Delete** sits at the far end of the header, quiet until hovered. It asks
  through VS Code's own modal first, takes the sub-tasks with the ticket, stops
  any agent on it, and leaves the worktree on disk — deleting a ticket must
  never delete work.
- **Plan** and **Implement** are just things you say to an open conversation.
  Each ticket has one, behaving like a Claude Code session: your skills from
  `~/.claude/skills` are loaded, you talk to it freely, and `/plan-ticket` or
  `/implement` are messages rather than the whole prompt.
- **Every ticket gets its own worktree**, made when its conversation opens, in a
  sibling folder next to the repo. Two agents never share a checkout. A branch
  you made by hand as `METH-238-toolbar-sections` is recognised as belonging to
  METH-238 rather than a second one being created.
- **The header shows where the work lives**: branch, uncommitted changes,
  commits ahead and behind, and whether it has landed. Merge is checked twice —
  by ancestry, and by patch equivalence — so a **squash-merged** branch reads as
  merged instead of sitting there claiming otherwise forever.
- **Mark complete culls the worktree.** It refuses while anything is
  uncommitted or unmerged, names what is holding it, and deletes nothing.
- **Conversations are written to the repo**, not held in memory. Each space repo
  gets `.board/conversations/<TICKET>.json` (the state the panel reloads,
  including the session id so Claude resumes rather than restarts) and a
  readable `<TICKET>.md`. Close the window, reopen it, the conversation is there.
- **Permission levels**, per conversation, the same four Claude Code offers: ask
  every time, edits without asking, plan only, never ask.
- **A slash menu.** Type `/` for every skill and command, with descriptions and
  argument hints; arrows or Tab to move, Enter to take one. It is seeded by
  reading `SKILL.md` files directly so it works before a session exists, then
  replaced by the session's own list once there is one to ask.
- **Model switching** per conversation. The list comes from the running session,
  so it is whatever the account actually has rather than a hardcoded guess.
- **A context meter** under the composer, amber past 80%.
- **Conversation text size** is yours: A− / A+ beside the pickers, or Ctrl+=,
  Ctrl+- and Ctrl+0 in the chat box. The editor's size is tuned for code; a
  transcript is prose read for minutes at a time. Remembered across reloads.
- **The panel is resizable.** Drag the edge between the board and the panel;
  double-click it to go back to the default. The width survives a reload.
- **Agent replies render as Markdown** — headings, lists, code and links, the
  same renderer the Description tab uses.
- **The agent can ask you a real question.** It has an `ask` tool that puts two
  to five options in front of you, single or multiple choice, with a "You
  decide" way out. It is told plainly that `AskUserQuestion` does not work here
  and to use `ask` instead — that call used to be silently wasted.
- **The agent is told what this panel is**: a narrow chat column, not a
  terminal. No spinners, no ANSI, nothing that waits on stdin.
- **Live output.** Text streams in as it is generated, so a long turn never
  looks frozen. Under the composer: a dot, a running clock, and the name of the
  tool executing right now.
- **Permission requests queue.** Claude asks for several tools at once; every
  one is shown with its own Allow and Deny, plus Allow all. They used to share
  a single slot, so all but the newest were dropped and their turn hung forever.
- **Interrupt** while it is working — a button, or Escape in the composer. It
  stops the turn without ending the conversation.
- **Images** paste or drop into the chat box and ride along as content blocks.
- Cards colour by what their agent is doing — thinking, working, failed, and
  **needs you** in amber when it is holding a tool waiting on your answer.
- The agent is told what the board is — the six columns, that a ticket may not
  sit right of To Plan without a PRD, and that Done is the human's call. The
  board also watches for JIRA transitions the skills make directly, so a card
  moves mid-turn rather than at the end of one.
- The agent gets `move_ticket` and `say`. Because they run inside the extension,
  the JIRA transition and the card moving are one action. The MCP instructions
  tell a skill it was opened from a board rather than a terminal.
- A session starts on the first thing you say, not when the panel opens — Claude
  Code startup costs real money and an unopened ticket should cost nothing.

## What it does not do yet

- The description editor writes Markdown; anything JIRA holds that Markdown
  cannot carry (tables, checklists) makes the tab read-only rather than risking
  the content.
- Nobody has watched a real agent run through this UI end to end. (It would
  have crashed if they had: the agent tab called `stateWord()` before that
  function existed. Fixed, and preflight now checks every call in `board.js`
  resolves to a definition.)
- The SDK offers more than the panel surfaces: subagent selection, MCP server
  toggles, thinking-token budget, file rewind and background tasks. All are
  reachable through the same `Query` handle when they are wanted.

## Setup

Needs the Teamwork Graph CLI, logged in:

```
powershell -ExecutionPolicy ByPass -c "irm https://teamwork-graph.atlassian.com/cli/install.ps1 | iex"
twg setup
twg doctor
```

Then build:

```
npm install
npm run compile
```

To install it, link the folder into your extensions directory and restart
VS Code. The Board icon then appears in the Activity Bar of every window:

```
New-Item -ItemType Junction -Path "$env:USERPROFILE\.vscode\extensions\board-extension" -Target "$env:USERPROFILE\.claude\board_extension"
```

On macOS, `ln -s ~/.claude/board_extension ~/.vscode/extensions/board-extension`.
A junction or symlink means a `git pull` plus `npm run compile` updates it.

To work on the extension itself, open this folder and press F5 instead — that
launches a separate window running the code as it stands, so you can break
things without touching the copy you use day to day.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `board.project` | `METH` | JIRA project key |
| `board.site` | blank | Atlassian site prefix; blank uses the twg default |
| `board.twgPath` | blank | Path to `twg`; blank auto-resolves per platform |
| `board.doneWindowDays` | `14` | How far back the Done column reaches |
| `board.refreshSeconds` | `30` | Poll interval; `0` disables |
| `board.repos` | three spaces | Where an agent runs per space; unmapped spaces are read-only |
| `board.conversationDir` | `.board/conversations` | Where conversations are written inside each repo |
| `board.worktreeDir` | blank | Where per-ticket worktrees go; blank means a sibling folder |
| `board.storyModel` | `claude-sonnet-5` | Model that writes the History tab's story; blank uses the session default |

## Checking it without the editor

A broken extension shows up in VS Code as a blank window with no explanation,
so check first:

```
npm run preflight
```

That compiles, loads the extension under plain node with a stubbed editor API,
activates it, opens the panel, and drives one real board fetch and one ticket
detail fetch. Every failure names itself — stale build, unregistered command,
broken CSP, expired twg login.

`npm run smoke` is the smaller version: board logic against the real site only.

## Notes on the twg CLI

Two things worth knowing, both learned the hard way:

- Above roughly 10KB, `-o json` stops printing JSON and instead writes the
  payload to a temp file, printing a YAML envelope naming it. The inline form
  is the bare payload; the spilled form nests it under `data`. `src/twg.ts`
  normalises both — do not assume stdout is JSON.
- The board query's field set omits `labels` and `description`. Full detail
  needs `jira workitem get`, which is why selecting a card makes a second call.
