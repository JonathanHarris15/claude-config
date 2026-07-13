---
name: implement
description: Build a planned JIRA ticket end-to-end while driving it across the board — claim it and move it In Progress, work its sub-tasks test-first at agreed seams, guard against regressions, review, grow the docs, then commit/PR with the ticket key and transition to In Review / Done. Use when you're ready to build a specific ticket from To Do / On Deck / Night Work (the executor that follows plan-ticket), or 'next' to take the oldest ready one. Refuses tickets with no PRD.
argument-hint: "The JIRA ticket key to implement (e.g. PROJ-124), or 'next' to pick from the On Deck / Night Work queue"
---

<what-to-do>

You are the **executor**. `create-epic` maps the project, `plan-ticket` takes a ticket from `To Plan` and specs it (`to-prd`) and slices it (`to-issues`) — and `implement` **builds one ticket and moves it along the board as it goes**.

Read [BOARD.md](../jira-doctor/BOARD.md) first. What binds you: you build **level-0 tickets** — the cards. Their **sub-tasks** are your checklist inside the card, not separate cards. You take work from **`On Deck`** (yours, has judgment in it), **`Night Work`** (AFK-safe, an agent can be trusted with it unattended), or **`To Do`** (ready but unscheduled), and you drive it `In Progress → In Review → Done`.

Two responsibilities, always both:
1. **Build the thing** — test-first at pre-agreed seams, small changesets, no regressions, docs grown. (This is the old `feature` discipline; `implement` absorbs it.)
2. **Drive the JIRA states** — the issue moves To Do → In Progress → In Review → Done as the work actually progresses, using the project's *real* workflow (discover transitions; never assume status names).

Do not skip the JIRA transitions and do not fake the build discipline. A merged PR with the ticket left in "To Do" is a failure of this skill.

</what-to-do>

<phases>

## Phase 0: Claim

1. **Resolve the target.** If given a ticket key, use it. If given `next` (or nothing), find the ready queue with JQL (the `On Deck` / `Night Work` / `To Do` columns, see `<jira-mechanics>`) and pick the oldest unblocked one — confirm with me before claiming. **Running unattended** (a Night Work batch), take only from `Night Work`, never from `On Deck` — `On Deck` means a human is meant to do it.
2. **Read the ticket fully** with `getJiraIssue` (include `comment`, `description`, `parent`, `issuelinks`, `status`, `labels`, `subtasks`): its PRD, acceptance criteria, sub-tasks, and its parent epic for context.
3. **Check it's actually takeable.** If it's blocked by an open issue, stop and say so. If it has **no PRD** (no `## Problem Statement` + `## Acceptance Criteria`) it should never have left `To Plan` — **stop**, say the board was lying to you, and recommend `/plan-ticket <KEY>`. Don't build on fog, and don't quietly spec it yourself; that's how an un-reviewed guess becomes a merged PR.
4. **The ticket vs its sub-tasks.** The **ticket** is the unit that rides the board. Work its **sub-tasks** one at a time (Phase 1→6 per sub-task), ticking each one Done as it lands, so the card's progress count stays true. The ticket itself moves `In Progress` once, at the start, and `In Review` once, at the end. If it has no sub-tasks, implement it directly — but say so, because `to-issues` should have made some.
5. **Transition to In Progress.** Move the issue into the project's in-progress status (`getTransitionsForJiraIssue` → `transitionJiraIssue`; match the real workflow). Assign it to me if the project expects an assignee.
6. **Branch** named with the issue key, e.g. `PROJ-124-recommendation-ranking-fn`, so JIRA↔GitHub links the work automatically.

## Phase 1: Understand where it lives

- Read `CONTEXT.md` (glossary) and `docs/adr/` for the area; if a `CONTEXT-MAP.md` exists, follow it to the right context. Use domain vocabulary throughout.
- Identify the **existing module** this issue extends. Prefer growing an existing module over adding a new one; only propose a new module if there's a genuine seam that doesn't exist yet.
- Define the **interface** the module exposes once this is done — inputs, outputs, behaviour — in precise domain language. This is what the tests will pin.

## Phase 2: Tests first (at agreed seams)

Write failing tests that specify the behaviour at the module's interface, before implementation. If a `/tdd` skill is available, use it for the red-green-refactor loop; otherwise run the loop inline. Rules:

- Use domain language from `CONTEXT.md` — never implementation terms like `y_offset`, `line`, or `index` when a precise term exists.
- Test what the module *does*, not how — tests that depend on internal state or private methods will rot.
- Cover the cases and edge cases from the issue's acceptance criteria and any grilling, not hypothetical ones.
- Run the suite to confirm the new tests fail **for the right reason** (not a syntax error or missing import).

Not everything is TDD-able. Apply test-first at the pre-agreed seams (pure logic, module interfaces); for glue/UI where a test would just mirror the implementation, say so and build directly.

## Phase 3: Build

Implement until the Phase 2 tests pass.

- Extend the identified module. Keep the interface as simple as possible; push complexity inward.
- Keep changesets **small and focused** so Phase 4 catches regressions close to their cause.
- Log errors to `ERROR_LOG.md` lazily as they arise — one entry per problem, updated iteratively, no duplicates.
- Tick the issue's acceptance-criteria checkboxes (in its description) as each is genuinely met, so progress is visible on the board.

## Phase 4: Guard

After each meaningful change, run the full test suite.

If a test that was passing before this work began is now failing: **stop** and fix the regression before continuing. Do not reach Phase 6 with a regression open. Run a typecheck regularly too, and the full suite once more before shipping.

## Phase 5: Review

Run `/code-review` on the change (if available; otherwise self-review against the acceptance criteria and the domain model). Address what it surfaces before shipping.

## Phase 6: Grow

Once tests pass and no regressions remain:

1. Add any new terms coined during development to `CONTEXT.md`. Keep entries precise — glossary only, no implementation detail, no spec language.
2. Create an ADR **only** if all three hold: hard to reverse, surprising without context, a genuine trade-off with real alternatives.
3. Clear `ERROR_LOG.md` contents.

## Phase 7: Ship & transition

1. **Commit** with the project's commit style, referencing the issue key so JIRA↔GitHub links it. A Smart Commit can also move the ticket, e.g. `PROJ-124 add recommendation ranking fn` or `PROJ-124 #comment ready for review`.
2. **Open a PR** with the issue key in the title (e.g. `PROJ-124: recommendation ranking function`). The linked PR then shows in the issue's Development panel.
3. **Transition to In Review** (or the project's review status). If the project has no review step, transition per its workflow.
4. **On merge → Done.** If Smart Commits / the workflow auto-transition on merge, let them and verify. Otherwise transition the issue to Done yourself once merged. Never leave a merged issue un-transitioned.
5. **Loop.** If the ticket has more unfinished sub-tasks, pick the next unblocked one and go again from Phase 1 (you don't re-claim — the ticket is already `In Progress`). When every sub-task is Done, transition the **ticket** to `In Review`, and to `Done` on merge. When every ticket under an epic is Done, the epic is done — tell me.

Report at the end: the issue key(s) moved, their new statuses, the branch/PR, and what's next in the tree.

</phases>

<supporting-info>

<jira-track-discipline>

The whole point is that the board reflects reality without me nudging it. But **every project's workflow is different** — statuses may be named `To Do / In Progress / In Review / Done`, or `Selected / Building / Review / Shipped`, or anything else.

- **Never hardcode a status name.** Always `getTransitionsForJiraIssue` to see the available transitions from the issue's *current* status, then pick the one that matches the phase you're entering, then `transitionJiraIssue`.
- If no transition matches a phase (e.g. the project has no "In Review"), skip it — don't invent statuses.
- The seven columns in `BOARD.md` are the *intended* names. A project that `jira-setup` has linked will have them — but read the project's `CLAUDE.md` Jira block for what it actually calls them, and if a transition doesn't exist, say so rather than inventing one.
- **Leave `On Deck` alone when running unattended.** `On Deck` exists precisely because a human is supposed to make a call inside that ticket. An agent taking one is the failure mode the whole column was built to prevent.

</jira-track-discipline>

<scope>

`implement` builds **one level-0 ticket** — a `Feature`, `Task`, or `Bug` that has been through `/plan-ticket` and carries a PRD. It does not plan, decompose, or spec: if the ticket isn't ready, hand it back to **`/plan-ticket`**. It does not resolve **investigation tickets** — those are decision work, closed with a decision comment by `create-epic`'s Investigation lane (via `research` / `prototype` / `grill-with-docs`), not built.

</scope>

<jira-mechanics>

Load the Atlassian tools first (deferred) in one call:

```
ToolSearch → jira transition issue
```

The Atlassian connector's server prefix differs per install (and changes if it's reinstalled), so never hardcode it — read the prefix off what that call returns, then load the whole set in one further `ToolSearch → select:…` using that prefix with: `getAccessibleAtlassianResources`, `searchJiraIssuesUsingJql`, `getJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `getTransitionsForJiraIssue`, `transitionJiraIssue`.

**Discovery.** `getAccessibleAtlassianResources` → `cloudId`. Read the issue with `getJiraIssue` (fields: `summary, description, status, labels, parent, issuelinks, comment, assignee`).

**Finding the ready queue** (`implement next`): `project = PROJ AND status IN ("On Deck", "Night Work", "To Do") ORDER BY created ASC`. Filter out anything with an open blocker in `issuelinks`.

**Running unattended** (draining the night queue): `project = PROJ AND status = "Night Work" ORDER BY created ASC` — **that column only**. If a ticket there turns out to have a decision in it after all, don't guess: stop, move it to `On Deck`, comment why, and take the next one. Waking up to one honest blocker beats waking up to six confident guesses.

**Transitions.** `getTransitionsForJiraIssue` → the list of transitions valid from the current status (each has an `id` and a target status name). Pick the one matching the phase; `transitionJiraIssue` with that `id`. For a transition that requires fields (e.g. a resolution on Done), pass them in the transition `fields`. Re-fetch or re-list transitions after moving, since the valid set changes with status.

**Editing the issue.** `editJiraIssue` for description edits (ticking acceptance criteria, updating a spec) and label changes — read current labels first, then re-set the whole array (JIRA replaces it). Keep exactly one state label if the project uses them.

**Comments.** `addCommentToJiraIssue` with `contentFormat: "markdown"` for a review-ready note or a blocker explanation.

**GitHub linkage.** Put the issue key in the branch name (`PROJ-124-…`), commit messages, and PR title so the JIRA↔GitHub app links code and PRs to the issue automatically. Smart Commit syntax can transition and comment: `PROJ-124 #comment done #time 2h`.

</jira-mechanics>

</supporting-info>
