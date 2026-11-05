---
name: to-issues
description: Slice a specced ticket (one whose body to-prd has turned into a PRD) into sub-tasks inside it, each classified AFK or HITL. Sub-tasks don't get board columns — they live inside the card. Normally invoked by plan-ticket straight after to-prd. The breakdown step below a ticket, on Jira or Notion.
argument-hint: "Optional: the ticket key to slice into sub-tasks"
---

# To Issues

Break **one specced Feature** into independently-grabbable **sub-tasks** inside it. This is the step *below* a Feature: `create-epic` makes the Epic and its high-level **Features**; `to-prd` writes a PRD onto the chosen Feature's description; **`to-issues` slices that Feature into sub-tasks**; `implement` builds each one.

Hierarchy: **Epic → ticket → sub-task**. `to-issues` operates at the bottom edge — it takes a level-0 ticket and adds its breakdown steps as **sub-tasks**. On Notion they are a checklist in the ticket's body; on Jira they are Jira sub-tasks. It does **not** create level-0 tickets (that's `create-epic`, or you scratching an idea into `To Plan`).

**Sub-tasks don't get board columns** — they live *inside* the parent card. That is the point: it's what lets you open a ticket and see 4 of 7 are done and which one it stopped on. See [BOARD.md](../plan-ticket/BOARD.md).

You are normally invoked **by `/plan-ticket`**, straight after `to-prd`.

## Process

### 1. Gather context

Resolve the source Feature:
- **Argument is a Feature key** → read it; its PRD (from `to-prd`) is your input — mine the **User Stories** and **Implementation Decisions** for the breakdown. The new sub-tasks go inside that Feature.
- **No argument** → work from context; ask which **Feature** to slice. If the Feature hasn't been specified yet, run `grill-with-docs` then `to-prd` first; if there's no epic/Feature at all, offer `create-epic`.
- **The ticket carries the `trivial` label** → **stop, and don't slice it.** A trivial ticket is the sub-task: it went down the fast lane precisely because there is nothing to break down. Say so and hand back. If it genuinely needs slicing, the routing was wrong — send it back to `/plan-ticket`, don't quietly fix it here.

### 2. Explore the codebase (optional)

If you haven't already, explore to understand the current state. Sub-task titles and text must use the vocabulary in the project's glossary and respect ADRs in the area (see [TRACKER.md](../plan-ticket/TRACKER.md)).

### 3. Draft the sub-tasks

The Feature is already a vertical slice (a thin path through the layers). Break it into the **concrete implementation steps** to build that slice end-to-end.

<breakdown-rules>
- Each sub-task is an independently-grabbable, verifiable piece of the Feature.
- Cover the whole Feature: schema/data, API/logic, UI, and tests — whatever layers the slice touches.
- Prefer a handful of meaningful sub-tasks over many trivial ones. Don't over-decompose; a sub-task's own micro-steps go in its text. There is no level below sub-task.
- Sequence them by dependency where it matters.
</breakdown-rules>

Classify each sub-task **AFK** (an agent can implement it end to end without a human) or **HITL** (needs human interaction — an architectural decision, a design review). Prefer AFK where possible, but never at the cost of honesty.

This classification is **load-bearing**. It is not a note on the ticket — it is the fence `implement` steers by, sub-task by sub-task. A ticket that mixes AFK and HITL sub-tasks works fine: `implement` builds every AFK sub-task it can reach and stops to ask at the first HITL one. So **the dependency order matters as much as the label** — an AFK sub-task sitting *behind* a HITL one can't be built either, and a ticket where the first sub-task is HITL gives a builder nothing to start on at all.

### 4. Quiz the user

Present the breakdown as a numbered list. For each sub-task show: **Title**, **AFK/HITL**, **Blocked by** (which sub-tasks must finish first), **User stories covered** (from the Feature's PRD). Ask:
- Is the granularity right (too coarse / too fine)?
- Are the dependency relationships correct?
- Should any sub-tasks merge or split?
- Are AFK/HITL classifications right?

Iterate until the user approves.

### 5. Publish to the tracker

Add each approved sub-task to the **Feature**, in dependency order (blockers first). See `<tracker-mechanics>`.

Write each sub-task in the **same plain-language register as its Feature**: say what it builds and why in terms a newcomer can follow (define any jargon), and keep the acceptance criteria **specific and measurable** (pass/fail). Each one holds this, in whatever shape the backend file gives:

<subtask-template>
## What to build
Concise description of this implementation step — the behaviour it adds to the Feature. No file paths or code snippets (they go stale). Exception: a decision-encoding snippet from a prototype (state machine, reducer, schema, type shape) — inline just the decision-rich part and note it came from a prototype.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Parent Feature
`PROJ-123` (the Feature this sub-task breaks down; the PRD lives there)
</subtask-template>

Do NOT change the Feature's PRD sections. Report the sub-tasks as a tree (Feature → sub-tasks).

<tracker-mechanics>

See [TRACKER.md](../plan-ticket/TRACKER.md) to find the tracker. Its backend file says how sub-tasks
work there: a checklist section on Notion, Jira sub-tasks on Jira.

**Blockers stay inside this Feature.** A dependency that crosses tickets belongs at ticket level,
and that is `create-epic`'s job, not yours.

**Don't move the parent ticket.** Landing it is `plan-ticket`'s Phase 6 call, and your AFK/HITL
classifications (plus the blockers) are the **evidence it uses**: they're what tells it whether
there's anything an agent can start on. So classify honestly: if a step needs taste, a design call,
or a product judgment, it is **HITL**, however small it looks. Mislabelling one `afk` costs a
confident guess made on the user's behalf.

</tracker-mechanics>
