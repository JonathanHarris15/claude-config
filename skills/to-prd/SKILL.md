---
name: to-prd
description: Turn the current conversation context into a PRD written directly onto its JIRA ticket — the ticket's own description — then hand off to to-issues to break it into sub-tasks. Normally invoked by plan-ticket once a ticket's fog has cleared (via workshop / research / grill-with-docs). JIRA-native — the spec step that makes a ticket eligible to leave To Plan.
argument-hint: "Optional: the JIRA ticket key this PRD specifies (e.g. PROJ-123)"
---

Take the current conversation context and codebase understanding and produce a **PRD** (Product Requirements Document), written **onto the JIRA Feature it specifies** — the Feature's own description, the "Feature block." A PRD is a *narrative* — the "what and why," not the "how."

Do NOT interview the user — synthesise what you already know. (If you need to interrogate an unclear Feature first, that's `grill-with-docs`; to shape a whole project, that's `create-epic`.)

## Where this sits in the workflow

Tickets wait in the **`To Plan`** column carrying, at best, a loose brief. `/plan-ticket` routes each one down whichever lane clears its fog (`workshop` / `research` / `grill-with-docs` / `diagnose`) and then **always converges here**:

```
To Plan ticket → /plan-ticket → [workshop | research | grill | diagnose] → to-prd → to-issues → lands on the board
```

So `to-prd` is the **sharpening** step: it takes the loose description the ticket had, plus everything the lane surfaced, and rewrites the **ticket's own description** into a full PRD. The PRD lives **on the ticket** — the ticket *is* the PRD, there is no separate Confluence page. The implementation steps that `to-issues` creates next are that ticket's **sub-tasks**.

Throughout this skill, **"Feature" means the level-0 ticket you're speccing** — the card on the board. It may be typed `Feature`, `Story`, `Task` or `Bug` depending on the project; the project's `CLAUDE.md` Jira block records the real names. See [BOARD.md](../jira-doctor/BOARD.md).

You are normally invoked **by `/plan-ticket`**, not directly. Called directly, you still work — but you're skipping the routing that decides whether this ticket was ever ready to spec.

## Process

### 1. Explore

Explore the repo to understand the current state, if you haven't already. Read the domain docs — `CONTEXT.md` (glossary) and `docs/adr/` — and use that vocabulary throughout the PRD. Respect any ADRs in the area you're touching. If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts; follow it to the right `CONTEXT.md`.

### 2. Sketch the modules

Sketch the major modules you'll build or modify. Actively look for **deep modules** — ones that hide a lot of functionality behind a simple, testable interface that rarely changes — over shallow pass-throughs.

Check with the user that these modules match their expectations, and which they want tests written for. This is the one confirmation step; everything else is synthesis.

### 3. Write the PRD onto the Feature block

Fill the template below, then write it as the **Feature's `description`** via `editJiraIssue` (see `<atlassian-mechanics>`). This replaces the loose high-level description `create-epic` left — but **preserve anything on the Feature that should survive** (e.g. an acceptance-criteria checklist or a problem statement worth keeping). Read the current description first, then re-set it.

**Register:** write in **plain language** for a reader who isn't steeped in the project — define any domain term the first time it appears, and lead each section with the *why*, not just the *what*. Keep every acceptance criterion **specific and measurable** (pass/fail, externally observable). This is the same accessible register `create-epic` uses for Features, carried forward into the fuller PRD.

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
- [ ] The checkable "done" conditions for the whole Feature (external behaviour, not implementation detail).

## Testing Decisions
What makes a good test (external behaviour, not implementation details); which modules will be tested; prior art (similar tests in the codebase).

## Out of Scope
What is deliberately not being done.

## Further Notes
Anything else.

</prd-template>

### 4. Hand off

Tell the user the Feature key and confirm its description now holds the PRD. Offer to run `to-issues` next to slice the Feature into **sub-tasks**, then `implement` to build them.

<atlassian-mechanics>

The Atlassian tools are MCP tools and may be **deferred** — load them first in one call:

```
ToolSearch → jira edit issue
```

The Atlassian connector's server prefix differs per install (and changes if it's reinstalled), so never hardcode it — read the prefix off what that call returns, then load the whole set in one further `ToolSearch → select:…` using that prefix with: `getAccessibleAtlassianResources`, `getJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `searchJiraIssuesUsingJql`.

**Find the Feature.** If the user passed a key as an argument, use it. Otherwise ask which JIRA **Feature** this PRD specifies (or offer to create the epic + Features first with `create-epic`). Read it with `getJiraIssue` (include `description`) to confirm it exists, reuse its summary/vocabulary, and capture the current description so step 3's rewrite preserves what should survive.

**Write the PRD onto the Feature.** `editJiraIssue` on the Feature's `description` (`contentFormat: "markdown"`), setting it to the filled template. This *is* the PRD — there is no Confluence page and no separate condensed spec. Keep any pre-existing acceptance criteria or problem statement that should survive; don't blindly overwrite context you didn't author.

**If the description is genuinely too large** for one field, keep the narrative sections (Problem/Solution/User Stories/Out of Scope) on the Feature and move the long Implementation/Testing detail into a pinned `addCommentToJiraIssue` on the same Feature — still no Confluence.

**Readiness — don't move the ticket.** The PRD makes the ticket *specified*, not *ready*. Speccing is only half of it: the ticket still needs its sub-tasks (`to-issues`), and something still has to judge whether an agent can be trusted with it unattended. **That call belongs to `plan-ticket`, not here.** Leave the ticket in `To Plan` and hand back.

The board's integrity rule (see [BOARD.md](../jira-doctor/BOARD.md)) is that nothing sits right of `To Plan` without a PRD — this skill is what makes a ticket *eligible* to move, not what moves it. A PRD'd ticket with no sub-tasks that you pushed to `To Do` is exactly the kind of half-truth `jira-doctor` exists to sweep back.

</atlassian-mechanics>
