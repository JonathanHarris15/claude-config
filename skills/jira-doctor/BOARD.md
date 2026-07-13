# The board contract

The canonical description of the workflow every JIRA skill in this config assumes.
`jira-setup` writes it into a project's `CLAUDE.md`; `jira-doctor` enforces it;
`plan-ticket`, `create-epic`, `to-prd`, `to-issues` and `implement` all obey it.

If you are reading this because a skill pointed you here: this file is the source
of truth. Where a skill's prose and this file disagree, this file wins — say so.

## The three levels

JIRA nests exactly three levels, and this workflow uses all of them for different jobs:

| Level | JIRA hierarchy | Role here | On the board? |
| --- | --- | --- | --- |
| **Epic** | 1 | **Grouping.** Answers "what project is this part of." Holds the vision, goals, non-goals. Created by `create-epic`. | **No.** Epics never appear as cards. |
| **Ticket** | 0 (`Feature` / `Task` / `Bug`) | **The unit of work.** This is what a card *is*. Holds the PRD once planned. | **Yes.** This is the only thing on the board. |
| **Sub-task** | −1 | **The steps inside a ticket.** Created by `to-issues`. Gives you a live progress count on the card. | **No.** They render inside the parent card. |

**A "ticket" in these skills always means a level-0 item** — the thing that rides
the columns. Never an Epic, never a sub-task.

Issue-type *names* differ per project (some have `Feature`, some only `Story`).
**Never hardcode them.** Read the real names from `getJiraProjectIssueTypesMetadata`,
or from the `Issue types` line of the project's `CLAUDE.md` Jira block, which
`jira-setup` recorded after discovering them.

## The seven columns

```
To Plan  →  To Do  →  On Deck  →  Night Work  →  In Progress  →  In Review  →  Done
```

| Column | Meaning | Who puts things here |
| --- | --- | --- |
| **To Plan** | **The inbox.** Anything, at any stage of formulation — a title you scratched down mid-feature, a Feature `create-epic` emitted, a long ticket you wrote by hand, an untriaged bug. Nothing here is specced. | You, `create-epic`, `jira-doctor`, `improve-codebase-architecture` |
| **To Do** | Specced and ready. Has a PRD and sub-tasks. Not yet claimed by anyone or anything. | `plan-ticket` |
| **On Deck** | Ready, **and there is judgment left in it.** A design call, a taste call, something needing your eyes. **Yours to do.** | `plan-ticket` |
| **Night Work** | Ready, **and AFK-safe.** Zero open decisions. An agent can grind it unattended while you sleep — this is the queue `night-work` drains. | `plan-ticket` |
| **In Progress** | Being built right now. | `implement` |
| **In Review** | PR open. | `implement` |
| **Done** | Merged. | `implement` |

The board order you see in JIRA is cosmetic. What matters is the contract below.

## The integrity rule

> **A ticket may not sit right of `To Plan` without a PRD on it.**

This is the load-bearing rule of the whole system, and it is what makes the board
trustworthy. `To Do` / `On Deck` / `Night Work` are a promise that the thinking is
finished. A ticket in `To Do` that is really still an idea is a lie the board is
telling you, and it is exactly the lie that wastes a night of agent time.

`jira-doctor` enforces it: anything right of `To Plan` without a PRD gets swept
**back to `To Plan`**.

**A ticket "has a PRD"** when its description carries the `to-prd` template — in
practice, look for a `## Problem Statement` heading *and* an `## Acceptance Criteria`
heading. A wall of prose, however long and however lovingly written, is **not** a PRD.

## The AFK-safety rule

> **A ticket may not sit in `Night Work` if any decision in it is still open.**

Night Work is unattended. An agent will not stop to ask you. So a ticket qualifies
only when **all** of these hold:

- It has a PRD (the integrity rule) **and** its acceptance criteria are specific,
  measurable, and externally observable — pass/fail, not "works well."
- Its sub-tasks exist and each one names what it builds.
- **Nothing in it requires taste, design judgment, or a product call.** If a
  sub-task says "pick a sensible layout" or "decide how errors surface," it is
  not AFK-safe.
- No open blockers, and no unanswered questions in the comments.
- It is *reversible* — an agent's bad night should cost you a branch, not a database.

Anything that is ready but fails AFK-safety goes to **`On Deck`**, not `Night Work`.
When in doubt, `On Deck`. The cost of a wrong `On Deck` is that you did it yourself.
The cost of a wrong `Night Work` is waking up to confident nonsense built on a guess.

`night-work` re-checks all of this before it touches a ticket, and pushes anything that has
gone stale back to `On Deck` rather than building it. That is a backstop, not a substitute —
the judgment belongs to `plan-ticket`, at the moment it lands the ticket.

## The lifecycle

```
   scratch idea / create-epic Feature / hand-written ticket / bug
                              │
                              ▼
                          [To Plan]
                              │
                        /plan-ticket
                              │
              ┌───────────────┴───────────────┐
              │                               │
        AFK-safe?                       judgment left?
              │                               │
              ▼                               ▼
       [Night Work]                       [On Deck]         [To Do]
              │                               │                │
              └───────────────┬───────────────┴────────────────┘
                              │
                         /implement
                              │
                   [In Progress] → [In Review] → [Done]
```

## Bugs

Bugs are level-0 tickets like any other. They land in **`To Plan`** and are routed
by `plan-ticket` to `/diagnose` — reproduce *first*, then spec, then onto the board.
There is no separate triage lane; the board **is** the triage.

Bugs get **no epic parent and no due date**. They are reactive work — they don't
belong to a dated objective.

## Investigation tickets

`create-epic`'s Investigation lane produces tickets that resolve a *decision*, not
a deliverable — labelled `investigation`, summary prefixed `[research]` /
`[prototype]` / `[grill]` / `[task]`.

These are level-0 tickets and **do** sit on the board, in `To Plan` or `On Deck`.
But they are the one exception to the integrity rule: **an investigation ticket
never gets a PRD**, because its output is a decision comment, not code. They are
closed by `create-epic`'s Phase 6I, not by `implement`, and they never enter
`Night Work` — deciding is not AFK work.

`jira-doctor` skips them when enforcing the integrity rule, and flags any that has
somehow reached `Night Work`.
