# Board panel — Claude Design export

Pulled 2026-08-26 from Claude Design project `35b84d5f-5a81-4ee4-8868-eb56b4fd9f2a`.

Asked for by [board-panel-facelift-prompt.md](./board-panel-facelift-prompt.md).

## What was imported

- `templates/board-panel/BoardPanel.dc.html` — the design to implement
- `preview/theme-dark.css` — preview shim, marked NEVER SHIP by its own header
- `templates/board-panel/ds-base.js`, `support.js` — Claude Design canvas runtime

## What the project contains

A complete design system, not just a panel:

- `tokens/` — `theme-bridge.css`, `color-roles.css`, `base.css`, `spacing.css`,
  `radius.css`, `typography.css`, `layout.css`, `motion.css`
- `components/core/` — Button, Chip, SectionHead, EmptyState, QuoteBlock
- `components/board/` — Card, Column, StatusBar, ErrorBanner
- `components/agent/` — ChatLog, ChatEntry, ChatBox, PermissionRequest
- `components/detail/` — SubtaskList, Timeline
- `ui_kits/board-webview/` — BoardView, DetailPanel, EditorChrome, sidebar
- `guidelines/` — 18 cards covering colour roles in three themes, type, spacing,
  radius, density, layout metrics, brand mark and motion
- `sources/board.css`, `sources/board.js` — the files that were attached

## The headline

**The design does not contain the tabbed panel that was asked for.** No History /
Agent / Description tabs, and no description reader or editor anywhere in the
system — there is no tab component and no description component in
`components/`. What came back is a faithful restyle of the panel as it exists
today, in a new token system.

That is a reasonable thing for it to have produced: the design system was seeded
by attaching `media/`, so it extracted and formalised what was already there.
The facelift was never commissioned against it.

## The token bridge — the constraint held

`tokens/theme-bridge.css` is the only file naming a `--vscode-*` variable, and
its header says so. Raw hex appears in exactly four last-resort fallbacks
(`charts-blue`, `editorWarning-foreground`, `testing-iconPassed`,
`testing-iconFailed`), each marked, each matching a fallback the current
`board.css` already uses.

---

## What landed (2026-08-26)

User approved the whole inventory: "just approve everything."

**Ported faithfully** — all eight token files concatenated into `media/board.css`
inside `@generated` markers, plus the full `bd-*` component layer. The webview
now emits design-system classes throughout. Raw colour audited: only the four
LAST RESORT fallbacks, plus `#000` from the role layer.

**Scaffolding swapped** — every BRD-* ticket, "Story" type, invented summary and
the Prisma permission example is gone; the panel renders live JIRA data.

**Built on top, not in the design** — the tabbed panel. Description / Agent /
History, with the Agent tab carrying a dot when its agent is asking. Built from
the system's own tokens, marked as an addition at the foot of `board.css`, and
**it should be pushed back to Claude Design as a Tabs component** rather than
left living only in the repo.

**New capability** — the Description tab reads and writes the JIRA description.
`src/adf.ts` converts Atlassian Document Format to Markdown and back.

## The one thing worth arguing with

Editing is refused when the description holds anything Markdown cannot carry —
tables, checklists, panels. That is not caution for its own sake: of three real
tickets sampled, **two would have lost data**. METH-334 has checklists,
METH-388 has tables. Only METH-390 round-trips cleanly. The panel says which
node type blocked it and sends you to JIRA.

If that turns out to be most tickets, the fix is a richer converter, not
removing the guard.

## Not done

- `design-sync` was not run: there is still no `.claude/design.json`, so nothing
  can compare the local tokens against the project. That file is the next step
  if the system is going to stay honest.
- The Tabs component exists only here, not in Claude Design.
- Nobody has watched a real agent run through this UI.

## Markdown rendering (added after first look)

The description tab was showing raw Markdown. It now renders: headings, bold,
italic, inline code, links, bullet and numbered lists, task checkboxes, block
quotes, fenced code and rules.

`media/markdown.js` is hand-rolled, ~170 lines, because the strict CSP rules out
any library. It **builds DOM nodes rather than assigning innerHTML** — a JIRA
description is other people's text and the webview must never be somewhere that
text can become markup.

Every style is a system token, so a description reads like the rest of the tool.
`.md-*` should be pushed to Claude Design as a Prose component; it is not in the
system yet.

`test/markdown.test.js` runs the parser over a real description under a DOM
shim and asserts no raw syntax survives. It caught a genuine bug on the first
run — the inline regex had lost its escapes — so it is wired into
`npm run preflight`.

## Divergence from the design system (2026-08-27)

The board moved to **swimlanes**: epics run across all columns instead of
grouping inside each one. The design system's `Column` component and its
`.bd-column` / `.bd-column-head` / `.bd-column-body` classes no longer describe
what the app draws. The code now uses `.bd-headrow`, `.bd-lane`,
`.bd-lane-cols` and `.bd-lane-col`.

`design-sync` treats components as "whoever changed last", with the code as the
check. The code changed last, so the system should be updated to match — a Lane
component, and Column reduced to a header cell.

Still not in the system either: Tabs, the slash Menu, the Meter, the prose
(`.md-*`) styles, the Question box, and the drag affordances.

## Makeover layer (2026-08-27)

A second appended layer, marked in `board.css`, that the system should absorb:

- **Motion exists now.** The system said "none, deliberately"; the makeover
  overrides that with two strict rules — state changes may ease (120ms), only
  liveness may loop (pulse, spinner, typing dots, provisional cards) — and a
  `prefers-reduced-motion` kill switch. Preflight counts the loops.
- **New components:** TopBar, Search, AgentPill (the rail), IconButton,
  Skeleton, Steps (folded tool runs), Typing, Progress, the error banner's
  close affordance, and the card's Priority / Age / footer row.
- **New bridge keys** parked at the top of the layer:
  `--vscode-list-hoverBackground`, `--vscode-scrollbarSlider-background`,
  `--vscode-scrollbarSlider-hoverBackground`, `--vscode-descriptionForeground`.
- The design brief's open question 5 — "somewhere board-wide that answers
  what is waiting on me" — is answered by the agent rail in the top bar.
