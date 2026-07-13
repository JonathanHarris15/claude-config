---
name: implement
description: Implement a ready JIRA issue end-to-end while driving it through its JIRA states — claim the ticket and move it In Progress, build test-first at agreed seams, guard against regressions, review, grow the docs, then commit/PR with the issue key and transition to In Review / Done. Use when you're ready to build a specific JIRA Task or Feature (the micro executor that follows to-issues). Respects the project's real JIRA workflow.
argument-hint: "The JIRA issue key to implement (e.g. PROJ-124), or 'next' to pick from the ready-for-agent queue"
---

<what-to-do>

You are the **executor**. `create-epic` maps the project, `to-prd` specifies a Feature, `to-issues` slices it into Tasks — and `implement` builds one issue and **moves it along the JIRA track as it goes**. This is the micro counterpart to `create-epic`'s macro: the epic and its tree guide the whole; the single issue guides this session.

Two responsibilities, always both:
1. **Build the thing** — test-first at pre-agreed seams, small changesets, no regressions, docs grown. (This is the old `feature` discipline; `implement` absorbs it.)
2. **Drive the JIRA states** — the issue moves To Do → In Progress → In Review → Done as the work actually progresses, using the project's *real* workflow (discover transitions; never assume status names).

Do not skip the JIRA transitions and do not fake the build discipline. A merged PR with the ticket left in "To Do" is a failure of this skill.

</what-to-do>

<phases>

## Phase 0: Claim

1. **Resolve the target.** If given an issue key, use it. If given `next` (or nothing), find the ready queue with JQL (`labels = "ready-for-agent"`, see `<jira-mechanics>`) and pick the oldest unblocked one — confirm with me before claiming.
2. **Read the issue fully** with `getJiraIssue` (include `comment`, `description`, `parent`, `issuelinks`, `status`, `labels`): its spec, acceptance criteria, any agent brief comment from `triage`, and its parent Feature/epic for context. Read the linked PRD (Confluence) if one is referenced.
3. **Check it's actually takeable.** If it's blocked by an open issue, stop and say so. If it's under-specified (no acceptance criteria, vague brief), stop and recommend `grill-with-docs` or `to-prd` first — don't build on fog.
4. **Feature vs Task.** If the key is a **Feature** with child **Tasks**, don't build the Feature directly — work its Tasks one at a time (Phase 0→7 per Task), then close the Feature when all its Tasks are Done (Phase 7). If it's a leaf **Task** (or a Feature with no children), implement it directly.
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
5. **Loop.** If you're inside a parent Feature, pick its next unblocked Task and go again from Phase 0. When every Task under the Feature is Done, transition the **Feature** to Done. When every Feature under the epic is Done, the epic is done — tell me.

Report at the end: the issue key(s) moved, their new statuses, the branch/PR, and what's next in the tree.

</phases>

<supporting-info>

<jira-track-discipline>

The whole point is that the board reflects reality without me nudging it. But **every project's workflow is different** — statuses may be named `To Do / In Progress / In Review / Done`, or `Selected / Building / Review / Shipped`, or anything else.

- **Never hardcode a status name.** Always `getTransitionsForJiraIssue` to see the available transitions from the issue's *current* status, then pick the one that matches the phase you're entering, then `transitionJiraIssue`.
- If no transition matches a phase (e.g. the project has no "In Review"), skip it — don't invent statuses.
- Confirm the mapping (which status = In Progress / In Review / Done) with me on first use in a project, and stay consistent with what `triage`, `to-issues`, and `create-epic` use.
- The state labels (`ready-for-agent` etc.) and native statuses can coexist — when you take a `ready-for-agent` issue, remove that label as you move it In Progress so the ready queue stays honest.

</jira-track-discipline>

<scope>

`implement` builds **one issue** — a build **Task** or **Feature** (planned work), or a **Bug** that `triage` has marked `ready-for-agent`. It does not plan, decompose, or spec: if the issue isn't ready, hand back to `grill-with-docs` / `to-prd` / `to-issues`. It does not resolve **investigation tickets** — those are decision work, closed with a decision comment by `create-epic`'s Investigation lane (via `research` / `prototype` / `grill-with-docs`), not built.

</scope>

<jira-mechanics>

Load the Atlassian tools first (deferred) in one call:

```
ToolSearch → jira transition issue
```

The Atlassian connector's server prefix differs per install (and changes if it's reinstalled), so never hardcode it — read the prefix off what that call returns, then load the whole set in one further `ToolSearch → select:…` using that prefix with: `getAccessibleAtlassianResources`, `searchJiraIssuesUsingJql`, `getJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `getTransitionsForJiraIssue`, `transitionJiraIssue`.

**Discovery.** `getAccessibleAtlassianResources` → `cloudId`. Read the issue with `getJiraIssue` (fields: `summary, description, status, labels, parent, issuelinks, comment, assignee`).

**Finding the ready queue** (`implement next`): `project = PROJ AND labels = "ready-for-agent" AND statusCategory != Done ORDER BY created ASC`. Filter out anything with an open blocker in `issuelinks`.

**Transitions.** `getTransitionsForJiraIssue` → the list of transitions valid from the current status (each has an `id` and a target status name). Pick the one matching the phase; `transitionJiraIssue` with that `id`. For a transition that requires fields (e.g. a resolution on Done), pass them in the transition `fields`. Re-fetch or re-list transitions after moving, since the valid set changes with status.

**Editing the issue.** `editJiraIssue` for description edits (ticking acceptance criteria, updating a spec) and label changes — read current labels first, then re-set the whole array (JIRA replaces it). Keep exactly one state label if the project uses them.

**Comments.** `addCommentToJiraIssue` with `contentFormat: "markdown"` for a review-ready note or a blocker explanation.

**GitHub linkage.** Put the issue key in the branch name (`PROJ-124-…`), commit messages, and PR title so the JIRA↔GitHub app links code and PRs to the issue automatically. Smart Commit syntax can transition and comment: `PROJ-124 #comment done #time 2h`.

</jira-mechanics>

</supporting-info>
