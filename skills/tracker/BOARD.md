# The board contract

The canonical description of the workflow every ticket skill in this config assumes.
`plan-ticket`, `create-epic`, `to-prd`, `to-subtasks` and `implement` all obey it.

This file says what the columns and levels **mean**, on any tracker. [the tracker skill](./SKILL.md)
says how to find out which tracker a project uses, and how to touch it.

If you are reading this because a skill pointed you here: this file is the source
of truth. Where a skill's prose and this file disagree, this file wins — say so.

## The three levels

This workflow uses three levels, each for a different job:

| Level | Role here | On the board? |
| --- | --- | --- |
| **Epic** | **Grouping.** Answers "what project is this part of." Holds the vision, goals, non-goals. Created by `create-epic`. | **No.** Epics never appear as cards. |
| **Ticket** (`Feature`, `Bug` and so on) | **The unit of work.** This is what a card *is*. Holds the PRD once planned. | **Yes.** This is the only thing on the board. |
| **Sub-task** | **The steps inside a ticket.** Created by `to-subtasks`. The backend file says what it is there: a native sub-task, or a checklist in the ticket's body. | **No.** They live inside the parent card. |

**A "ticket" in these skills always means a level-0 item** — the thing that rides
the columns. Never an Epic, never a sub-task.

Type *names* differ per project (some have `Feature`, some only `Story`).
**Never hardcode them.** Read the real names from the project's config block if it
has them, and otherwise from the tracker. See [the tracker skill](./SKILL.md).

## The five columns

```
To Plan  →  To Do  →  In Progress  →  In Review  →  Done
```

| Column | Meaning | Who puts things here |
| --- | --- | --- |
| **To Plan** | **The inbox.** Anything, at any stage of formulation — a title you scratched down mid-feature, a Feature `create-epic` emitted, a long ticket you wrote by hand, an untriaged bug. Nothing here is specced. | You, `create-ticket`, `create-epic`, `improve-codebase-architecture` |
| **To Do** | Specced and ready. Has a PRD and sub-tasks. Not yet claimed by anyone or anything. The sub-tasks say who can start it: see [who can start a ticket](#who-can-start-a-ticket). | `plan-ticket` |
| **In Progress** | Being built right now. | `implement` |
| **In Review** | PR open. | `implement` |
| **Done** | Merged. | The tracker, `implement`, or you |

The board order you see in the tracker is cosmetic. What matters is the contract below.

**A board may still have a column this contract doesn't name**, such as `On Deck` on an older
board. Never move a ticket into one. If a ticket is sitting in one, treat it as `To Do`.

## The integrity rule

> **A ticket may not sit right of `To Plan` without a PRD on it.**

This is the load-bearing rule of the whole system, and it is what makes the board
trustworthy. `To Do` is a promise that the thinking is finished. A ticket in
`To Do` that is really still an idea is a lie the board is telling you.

Nothing sweeps the board for you, so the rule is upheld at the two doors:
`plan-ticket` will not land a ticket right of `To Plan` until `to-prd` has run,
and `implement` refuses to build a ticket that has no PRD. If you find one that
slipped through anyway, move it back to `To Plan` yourself and say why.

**A ticket "has a PRD"** when its PRD carries the `to-prd` template — in
practice, look for a `## Problem Statement` heading *and* an `## Acceptance Criteria`
heading. A wall of prose, however long and however lovingly written, is **not** a PRD.
Most trackers keep the PRD in the ticket body. Notion keeps it on its own spec page that the
card links to, and a ticket under an epic whose PRD covers it counts as having one. The backend
file says where to look.

### Trivial tickets keep the rule, cheaply

A **trivial** ticket (see [ROUTING.md](../plan-ticket/ROUTING.md)) is smaller than a ticket: an
obvious fix with nothing left to decide, landing in one commit. It still gets a PRD,
because the rule holds — but a **two-line** one. One sentence of problem, one testable
acceptance criterion. Both headings present, so the rule is satisfied by inspection
and `implement` will take it.

It gets **no sub-tasks**. The ticket is the sub-task. It carries the `trivial` label,
which is what lets a batch run find them, and it goes to `To Do` — a trivial ticket
with a decision left in it was never trivial.

This is not a hole in the integrity rule, it is the rule costing what it should. The
promise `To Do` makes is that the thinking is finished; on a typo fix the thinking
really is finished. What gets skipped is the paperwork, never the thought.


## <a name="who-can-start-a-ticket"></a>Who can start a ticket

> **No column decides this. The ticket's sub-tasks do.** Every specced ticket goes to
> `To Do`, and its sub-tasks say whether an agent can start or you have to go first.

`to-subtasks` classifies every sub-task **AFK** (decision-free — an agent can just build
it) or **HITL** (needs your judgment: a design call, a taste call, a product call).

**Walk them in dependency order.** A sub-task is *reachable* if it is AFK **and**
every sub-task blocking it is Done or itself reachable. A HITL sub-task is never
reachable, and neither is anything sitting behind one. So a ticket whose sub-tasks
run AFK, AFK, HITL, AFK has two reachable — and the third is where it stops.

- **Something reachable** → an agent can start, and it stops at the first thing it can't reach.
- **Nothing reachable** — every sub-task is HITL, or the only AFK ones sit behind a
  HITL one → **it needs you first.** Unattended runs skip it, and `plan-ticket` says so
  when it lands the ticket.

Classify honestly. If a sub-task says "pick a sensible layout" or "decide how errors
surface," it is **HITL**, however small it looks. Mislabelling one `afk` costs a confident
guess built on your behalf. When in doubt, HITL.

**A trivial ticket has no sub-tasks to classify**, so read the rule against the ticket
itself: it qualified as trivial precisely because nothing in it needs you. It is AFK by
definition and goes to `To Do`. If you find yourself wanting to mark one HITL, it was
misrouted — send it back to `To Plan` and grill it properly.

A ticket in `To Do` may stop part-way through: `implement` builds what it can reach and
stops at the first HITL sub-task. The ticket goes back to `To Do` with a comment saying
what it needs. A decision nobody marked is different: if an AFK sub-task turns out to hold
one, `implement` makes its best call, keeps going, and lists the call at the top of the PR.

## The lifecycle

```
   /create-ticket · /create-epic · improve-codebase-architecture · by hand
                              │
                              ▼
                          [To Plan]
                              │
                        /plan-ticket
                              │
                              ▼
                           [To Do]
                              │
                         /implement
                              │
                   [In Progress] → [In Review] → [Done]
```

## Merging

`implement` ends at **In Review**: branch pushed, PR open. It does not merge. Once the
PR is merged, the ticket moves to **Done**: the tracker does it if it can, and otherwise
`implement` or you.

## Bugs

Bugs are level-0 tickets like any other. They land in **`To Plan`** and are routed
by `plan-ticket` to `/diagnose` — reproduce *first*, then spec, then onto the board.
There is no separate triage lane; the board **is** the triage.

**Parent a bug to an epic when it must be fixed before that epic can ship** — a
defect in the thing being built is part of shipping it, and an epic whose known
bugs are invisible from the epic is lying about how close it is. Otherwise leave
it standalone: a drive-by defect in unrelated code belongs to no objective.

Bugs still get **no due date**. Even a release-blocking one is reactive work —
it's dated by the epic it blocks, not on its own.

## Investigation tickets

`create-epic` produces **investigation tickets** that resolve a *decision*, not
a deliverable — labelled `investigation`, summary prefixed `[research]` /
`[prototype]` / `[grill]` / `[task]`.

These are level-0 tickets and **do** sit on the board, in `To Plan`.
But they are the one exception to the integrity rule: **an investigation ticket
never gets a PRD**, because its output is a decision comment, not code. They are
closed by `/plan-ticket`, which routes each one by its prefix and posts the
decision as a comment — never by `implement`. They never enter
`To Do` — deciding is not decision-free work, so it is always yours.

So don't judge one against the integrity rule — a missing PRD is correct here.
An investigation ticket sitting in `To Do` is the thing to flag.
