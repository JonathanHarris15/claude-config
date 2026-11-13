---
name: to-subtasks
description: Slice a specced ticket (one to-prd has given a PRD) into sub-tasks inside it, each classified AFK or HITL. Sub-tasks don't get board columns — they live inside the card. Normally invoked by plan-ticket straight after to-prd. The breakdown step below a ticket, on whatever tracker the project uses.
argument-hint: "Optional: the ticket key to slice into sub-tasks"
---

# To Subtasks

Break **one specced ticket** into independently-grabbable **sub-tasks** inside it. This is the step *below* a ticket: `create-epic` or `create-ticket` files it; `to-prd` writes its PRD; **`to-subtasks` slices it into sub-tasks**; `implement` builds each one.

Hierarchy: **Epic → ticket → sub-task**. `to-subtasks` operates at the bottom edge — it takes a level-0 ticket and adds its breakdown steps as **sub-tasks**. The backend file says what a sub-task is on this project's tool. It does **not** create level-0 tickets (that's `create-ticket` or `create-epic`).

**Sub-tasks don't get board columns** — they live *inside* the parent card. That is the point: it's what lets you open a ticket and see 4 of 7 are done and which one it stopped on. See [BOARD.md](../tracker/BOARD.md).

You are normally invoked **by `/plan-ticket`**, straight after `to-prd`.

## Process

### 1. Gather context

Resolve the source ticket:
- **Argument is a ticket key** → read it; its PRD (from `to-prd`) is your input — mine the **User Stories** and **Implementation Decisions** for the breakdown. The new sub-tasks go inside that ticket.
- **No argument** → work from context; ask which **ticket** to slice. If the ticket hasn't been specified yet, run `grill-with-docs` then `to-prd` first; if there's no ticket at all, offer `create-ticket`.
- **The ticket carries the `trivial` label** → **stop, and don't slice it.** A trivial ticket is the sub-task: it went down the fast lane precisely because there is nothing to break down. Say so and hand back. If it genuinely needs slicing, the routing was wrong — send it back to `/plan-ticket`, don't quietly fix it here.

### 2. Explore the codebase (optional)

If you haven't already, explore to understand the current state. Sub-task titles and text must use the vocabulary in the project's glossary and respect ADRs in the area (see [the tracker skill](../tracker/SKILL.md)).

### 3. Draft the sub-tasks

The ticket is already a vertical slice (a thin path through the layers). Break it into the **concrete implementation steps** to build that slice end-to-end.

<breakdown-rules>
- Each sub-task is an independently-grabbable, verifiable piece of the ticket.
- Cover the whole ticket: schema/data, API/logic, UI, and tests — whatever layers the slice touches.
- Prefer a handful of meaningful sub-tasks over many trivial ones. Don't over-decompose; a sub-task's own micro-steps go in its text. There is no level below sub-task.
- Sequence them by dependency where it matters.
</breakdown-rules>

Classify each sub-task **AFK** (an agent can implement it end to end without a human) or **HITL** (needs human interaction — an architectural decision, a design review). Prefer AFK where possible, but never at the cost of honesty.

This classification is **load-bearing**. It is not a note on the ticket — it is the fence `implement` steers by, sub-task by sub-task. A ticket that mixes AFK and HITL sub-tasks works fine: `implement` builds every AFK sub-task it can reach and stops to ask at the first HITL one. So **the dependency order matters as much as the label** — an AFK sub-task sitting *behind* a HITL one can't be built either, and a ticket where the first sub-task is HITL gives a builder nothing to start on at all.

### 4. Quiz the user

Present the breakdown as a numbered list. For each sub-task show: **Title**, **AFK/HITL**, **Blocked by** (which sub-tasks must finish first), **User stories covered** (from the ticket's PRD). Ask:
- Is the granularity right (too coarse / too fine)?
- Are the dependency relationships correct?
- Should any sub-tasks merge or split?
- Are AFK/HITL classifications right?

Iterate until the user approves.

### 5. Publish to the tracker

Add each approved sub-task to the **ticket**, in dependency order (blockers first). See `<tracker-mechanics>`.

Write each sub-task in the **same plain-language register as its ticket**: say what it builds and why in terms a newcomer can follow (define any jargon), and keep the acceptance criteria **specific and measurable** (pass/fail). Each one holds this, in whatever shape the backend file gives:

<subtask-template>
## What to build
Concise description of this implementation step — the behaviour it adds to the ticket. No file paths or code snippets (they go stale). Exception: a decision-encoding snippet from a prototype (state machine, reducer, schema, type shape) — inline just the decision-rich part and note it came from a prototype.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Parent ticket
`PROJ-123` (the ticket this sub-task breaks down; the PRD lives there)
</subtask-template>

Do NOT change the ticket's PRD sections. Report the sub-tasks as a tree (ticket → sub-tasks).

<tracker-mechanics>

See [the tracker skill](../tracker/SKILL.md) to find the tracker. Its backend file says how sub-tasks
work there: native sub-tasks, or a checklist in the body.

**Blockers stay inside this ticket.** A dependency that crosses tickets belongs at ticket level,
and that is `create-epic`'s job, not yours.

**Don't move the parent ticket.** Landing it is `plan-ticket`'s Phase 6 call, and your AFK/HITL
classifications (plus the blockers) are the **evidence it uses**: they're what tells it whether
there's anything an agent can start on. So classify honestly: if a step needs taste, a design call,
or a product judgment, it is **HITL**, however small it looks. Mislabelling one `afk` costs a
confident guess made on the user's behalf.

</tracker-mechanics>
