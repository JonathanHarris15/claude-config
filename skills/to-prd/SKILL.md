---
name: to-prd
description: Turn the current conversation context into a PRD written directly onto its ticket — the ticket's own body — then hand off to to-subtasks to break it into sub-tasks. Normally invoked by plan-ticket once a ticket's fog has cleared (via research / prototype / grill-with-docs). The spec step that makes a ticket eligible to leave To Plan, on whatever tracker the project uses.
argument-hint: "Optional: the ticket key this PRD specifies (e.g. PROJ-123)"
---

Take the current conversation context and codebase understanding and produce a **PRD** (Product Requirements Document), written **onto the ticket it specifies** — the ticket's own body. A PRD is a *narrative* — the "what and why," not the "how."

Do NOT interview the user — synthesise what you already know. (If you need to interrogate an unclear ticket first, that's `grill-with-docs`; to shape a whole project, that's `create-epic`.)

## Where this sits in the workflow

Tickets wait in the **`To Plan`** column carrying, at best, a loose brief. `/plan-ticket` routes each one down whichever lane clears its fog (`research` / `prototype` / `grill-with-docs` / `diagnose`) and then **always converges here**:

```
To Plan ticket → /plan-ticket → [research | prototype | grill | diagnose] → to-prd → to-subtasks → lands on the board
```

So `to-prd` is the **sharpening** step: it takes the loose description the ticket had, plus everything the lane surfaced, and rewrites the **ticket's own body** into a full PRD. The PRD lives **on the ticket** — the ticket *is* the PRD, there is no separate page. The implementation steps that `to-subtasks` creates next are that ticket's **sub-tasks**.

**"Ticket" means the level-0 card you're speccing** — typed `ticket`, `Story`, `Task` or `Bug` depending on the project. See [BOARD.md](../tracker/BOARD.md).

You are normally invoked **by `/plan-ticket`**, not directly. Called directly, you still work — but you're skipping the routing that decides whether this ticket was ever ready to spec.

## The short form, for a trivial ticket

When `plan-ticket` routes a ticket down the **trivial lane** (see
[ROUTING.md](../plan-ticket/ROUTING.md)), everything below is too much. Write this
instead, straight onto the ticket, and stop:

```md
## Problem Statement

{One sentence. What is wrong, and where.}

## Acceptance Criteria

- [ ] {One testable condition. Pass or fail, externally observable.}
```

Both headings are present, so the board's integrity rule is satisfied. Add the
`trivial` label. **Do not call `to-subtasks`** — a trivial ticket has no sub-tasks,
because the ticket is the sub-task. Skip the module sketch and the confirmation
step too; there is nothing to confirm.

Writing those two lines is also the last honest check on the routing. If you cannot
state the problem in one sentence, or the criterion needs an "and", or you find
yourself wanting to ask the user something — **it was never trivial.** Say so and
send it back to the full process.

## Process

### 1. Explore

Explore the repo to understand the current state, if you haven't already. Read the glossary and the ADRs, wherever this project keeps them (see [the tracker skill](../tracker/SKILL.md)), and use that vocabulary throughout the PRD. Respect any ADRs in the area you're touching.

### 2. Sketch the modules

Sketch the major modules you'll build or modify. Actively look for **deep modules** — ones that hide a lot of functionality behind a simple, testable interface that rarely changes — over shallow pass-throughs.

Check with the user that these modules match their expectations, and which they want tests written for. This is the one confirmation step; everything else is synthesis.

### 3. Write the PRD onto the ticket

Fill the template below, then write it as the **ticket's body** (see `<tracker-mechanics>`). This replaces the loose high-level description `create-epic` left — but **preserve anything on the ticket that should survive** (e.g. an acceptance-criteria checklist or a problem statement worth keeping). Read the current body first, then re-set it.

**Register:** write in **plain language** for a reader who isn't steeped in the project — define any domain term the first time it appears, and lead each section with the *why*, not just the *what*. Keep every acceptance criterion **specific and measurable** (pass/fail, externally observable). This is the same accessible register `create-epic` uses for the tickets it writes, carried forward into the fuller PRD.

<prd-template>

## Problem Statement
The problem the user faces, from the user's perspective.

## Solution
The solution, from the user's perspective.

## User Stories
A LONG, numbered list, each in the form: *As an `<actor>`, I want `<feature>`, so that `<benefit>`.* Cover all aspects of the feature extensively.

## Implementation Decisions
Modules built/modified and their interfaces; technical clarifications; architectural decisions; schema changes; API contracts; specific interactions. Do NOT include file paths or code snippets — they go stale. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline just the decision-rich part and note it came from a prototype.

## Acceptance Criteria
- [ ] The checkable "done" conditions for the whole ticket (external behaviour, not implementation detail).

## Testing Decisions
What makes a good test (external behaviour, not implementation details); which modules will be tested; prior art (similar tests in the codebase).

## Out of Scope
What is deliberately not being done.

## Further Notes
Anything else.

</prd-template>

### 4. Hand off

Tell the user the ticket key and confirm its body now holds the PRD. If `plan-ticket` called you, hand back to it. Called directly, run `to-subtasks` next, then tell the user `/plan-ticket <KEY>` lands it in `To Do` — `implement` won't take it until then.

<tracker-mechanics>

See [the tracker skill](../tracker/SKILL.md) to find the tracker and its backend file, which says
how to write a body without destroying what's already there.

**Find the ticket.** If the user passed a key, use it. Otherwise ask which **ticket** this PRD
specifies, or offer to file it first with `create-ticket` (or `create-epic` for a whole project). Read it to
confirm it exists, reuse its title and vocabulary, and capture the current body so the rewrite
preserves what should survive.

**Write the PRD onto the ticket** — its body, set to the filled template. This *is* the PRD.
There is no separate page and no separate condensed spec.

**Readiness — don't move the ticket.** The PRD makes the ticket *specified*, not *ready*.
Speccing is only half of it: the ticket still needs its sub-tasks (`to-subtasks`), and something
still has to judge whether an agent can be trusted with it unattended. **That call belongs to
`plan-ticket`, not here.** Leave the ticket in `To Plan` and hand back.

The board's integrity rule (see [BOARD.md](../tracker/BOARD.md)) is that nothing sits right
of `To Plan` without a PRD — this skill is what makes a ticket *eligible* to move, not what
moves it. A PRD'd ticket with no sub-tasks that you pushed to `To Do` is exactly the half-truth
the rule exists to prevent, and nothing sweeps the board behind you, so don't create one.

</tracker-mechanics>
