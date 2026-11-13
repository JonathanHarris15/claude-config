---
name: implement
description: Build a planned ticket end-to-end, on whatever tracker the project uses, while driving it across the board — claim it and move it In Progress, work its sub-tasks test-first at agreed seams, guard against regressions, review, grow the docs, then commit/PR with the ticket key and transition to In Review / Done. Use with a ticket key, 'next' for the oldest ready one, or a count / ALL to run a whole batch of decision-free tickets unattended. Refuses tickets with no PRD.
argument-hint: "A ticket key (PROJ-124), 'next' for the oldest ready one, or a count / ALL to batch-run every decision-free ticket"
---

<what-to-do>

You are the **executor**. `create-epic` maps the project, `plan-ticket` takes a ticket from `To Plan` and specs it (`to-prd`) and slices it (`to-subtasks`) — and `implement` **builds one ticket and moves it along the board as it goes**.

Read [BOARD.md](../tracker/BOARD.md) first. What binds you: you build **level-0 tickets** — the cards. Their **sub-tasks** are your checklist inside the card, not separate cards. You take work from **`To Do`** and you drive it `In Progress → In Review → Done`. Load the **tracker** skill to find this project's tracker, then the backend file it points you to. Read the project's working notes too, if it has them: their **Working a ticket** and **Review and merge** sections override any default below — what to run, what not to run, and what has to happen before review and after merge.

Two responsibilities, always both:
1. **Build the thing** — test-first at pre-agreed seams, small changesets, no regressions, docs grown. (This is the old `feature` discipline; `implement` absorbs it.)
2. **Drive the board** — the ticket moves To Do → In Progress → In Review → Done as the work actually progresses, using the project's *real* columns (never assume a status name).

Do not skip the moves and do not fake the build discipline. A merged PR with the ticket left in "To Do" is a failure of this skill.

</what-to-do>

<phases>

## Phase 0: Claim

0. **Check there is code to work in.** A project may have no repo yet (see [the tracker skill](../tracker/SKILL.md)). If so, stop and say there is nothing to build in.
1. **Resolve the target.** A ticket key means that ticket. `next` (or nothing) means list the `To Do` column and take the oldest unblocked ticket with a reachable sub-task — confirm with me before claiming. **A count or `ALL` means batch mode — go to `<batch>` instead of working these phases directly.**
2. **Read the ticket fully**: its PRD (on Notion, follow the card's `Full spec:` link, and the epic's PRD if it links to one), acceptance criteria, comments, blockers, labels, sub-tasks, and its epic for context.
3. **Check it's actually takeable.** If it's blocked by an open issue, stop and say so. If it has **no PRD** (no `## Problem Statement` + `## Acceptance Criteria`) it should never have left `To Plan` — **stop**, say the board was lying to you, and recommend `/plan-ticket <KEY>`. Don't build on fog, and don't quietly spec it yourself; that's how an un-reviewed guess becomes a merged PR.
4. **The ticket vs its sub-tasks.** The **ticket** is the unit that rides the board. Work its **sub-tasks** one at a time (Phases 1–4 and 6, then commit, per sub-task; Phase 5's review runs once, over the whole ticket, before you ship), ticking each one as it lands, so the card stays true. The ticket itself moves `In Progress` once, at the start, and `In Review` once, at the end. If it has no sub-tasks, implement it directly — but say so, because `to-subtasks` should have made some.

   **If you were given a sub-task allowlist** (*"work only sub-tasks 1, 3 and 4"*), that list is a hard boundary. Work exactly those, in the order given, and **stop**. The ones left out need me, and doing "just the obvious part" of one is the failure this split exists to prevent. A ticket that still has unfinished sub-tasks when you stop is **not** finished: tick what you did, **do not open a PR**, push the branch, and say plainly which sub-task you stopped on and what it needs from me.
5. **Move it to In Progress**, matching the project's real workflow. Assign it to me if the project expects an assignee.
6. **Branch** named with the ticket key the way the backend file shows (`PROJ-124-ranking-fn`, or `124-ranking-fn` on GitHub), so the tracker links the work.

## Phase 1: Understand where it lives

- Read the glossary and the ADRs for the area, wherever this project keeps them (see [the tracker skill](../tracker/SKILL.md)). Use domain vocabulary throughout.
- Identify the **existing module** this issue extends. Prefer growing an existing module over adding a new one; only propose a new module if there's a genuine seam that doesn't exist yet.
- Define the **interface** the module exposes once this is done — inputs, outputs, behaviour — in precise domain language. This is what the tests will pin.

## Phase 2: Tests first (at agreed seams)

Write failing tests that specify the behaviour at the module's interface, before implementation. If a `/tdd` skill is available, use it for the red-green-refactor loop; otherwise run the loop inline. Rules:

- Use domain language from the glossary — never implementation terms like `y_offset`, `line`, or `index` when a precise term exists.
- Test what the module *does*, not how — tests that depend on internal state or private methods will rot.
- Cover the cases and edge cases from the issue's acceptance criteria and any grilling, not hypothetical ones.
- Run the new tests to confirm they fail **for the right reason** (not a syntax error or missing import).

Not everything is TDD-able. Apply test-first at the pre-agreed seams (pure logic, module interfaces); for glue/UI where a test would just mirror the implementation, say so and build directly.

## Phase 3: Build

Implement until the Phase 2 tests pass.

- Extend the identified module. Keep the interface as simple as possible; push complexity inward.
- Keep changesets **small and focused** so Phase 4 catches regressions close to their cause.
- **A decision the PRD doesn't settle:** make your best call, note it, and keep going. Phase 7 puts these calls at the top of the PR, so they get reviewed as choices.
- Log errors to `ERROR_LOG.md` lazily as they arise — one entry per problem, updated iteratively, no duplicates.
- Tick the ticket's acceptance-criteria checkboxes (in its body) as each is genuinely met, so progress is visible on the board.

## Phase 4: Guard

After each meaningful change, run the tests related to it.

If a test that was passing before this work began is now failing: **stop** and fix the regression before continuing. Do not reach Phase 6 with a regression open. Run a typecheck regularly too, and the full suite once, just before you open the PR — unless the working notes say the suite is too costly, in which case run what they allow and say so in the PR. If it fails and you can't tell whether this work caused it, run that test on the merge-base.

## Phase 5: Review

Once per ticket, when nothing reachable is left and before you open a PR, run the **`/review`** skill on the change. It reviews three things at once and keeps them apart: whether the code follows the repo's standards, whether it does what this ticket's PRD asked for, and whether it speaks the language in the glossary.

The fixed point is the merge-base with main — the whole of this ticket's work, not the last commit. Pass it the ticket key so the Spec axis measures against the real acceptance criteria.

Address what it surfaces before shipping. Treat a **Domain** finding as blocking — a wrong name outlives a bug, and it is cheap to fix now and expensive later. If you disagree with a finding, say why rather than quietly skipping it.

## Phase 6: Grow

Once tests pass and no regressions remain:

1. Add any new terms coined during development to the glossary. Keep entries precise — glossary only, no implementation detail, no spec language.
2. Create an ADR **only** if all three hold: hard to reverse, surprising without context, a genuine trade-off with real alternatives.
3. Clear `ERROR_LOG.md` contents.

## Phase 7: Commit, then ship

**After each sub-task:**

1. **Commit** with the project's commit style, led by the ticket key so the tracker links it, e.g. `PROJ-124 add recommendation ranking fn`.
2. **Tick the sub-task** on the ticket.
3. **Loop.** If another sub-task is reachable, go again from Phase 1. You don't re-claim — the ticket is already `In Progress`.

**When nothing reachable is left**, the ticket is either finished or stopped:

- **Finished** — every sub-task is done. **Open a PR** with the key in the title, linked the way the backend file says, with every call you made that the PRD didn't settle listed at the top. **Move the ticket to In Review** (or skip it if the project has no review column). Then do whatever the working notes' **Review and merge** section asks before review, such as deploying a test build.
- **Stopped** — a HITL sub-task, or the end of an allowlist. Push the branch, **don't open a PR**, move the ticket back to `To Do`, and comment which sub-task it stopped on and what it needs from me.

**On merge → Done.** If the tracker moves it on merge, let it and check. Otherwise move it yourself. Never leave a merged ticket behind. Then do whatever the working notes ask after merge. When every ticket under an epic is Done, the epic is done — tell me.

Report at the end: the ticket key(s) moved, their new statuses, the branch/PR, the calls you made, and what's next in the tree.

</phases>

<batch>

# Batch: `/implement 6` or `/implement ALL`

Run a queue of decision-free tickets back to back, unattended, and hand back one PR. This is
what the trivial lane exists to feed. A number caps the run; `ALL` takes everything eligible.

## What is eligible

A ticket qualifies only if **every** one of its sub-tasks is AFK-reachable — or it is a
`trivial` ticket, which has no sub-tasks and is AFK by definition (see
[BOARD.md](../tracker/BOARD.md)). A ticket with one HITL sub-task in it is **not** eligible,
even if you could reach three AFK ones first: a batch run is not the place to stop half way.
That ticket waits for an interactive `/implement <KEY>`.

List the `To Do` column, `trivial` first, then oldest. Then drop anything with an open blocker, anything with a HITL sub-task, and anything without a
PRD. **Show the user the list and the count before you start**, then go. That is the last gate;
you do not ask again.

## How it runs

**One branch, one commit per ticket, one PR at the end.** Branch it off main with a name that
says what it is, not a ticket key — `batch-2026-08-26` or similar — since it carries several.

For each ticket in turn:

1. Move it to In Progress.
2. Build it with the normal discipline — Phases 1→6. Tests still come first, regressions still
   stop you, the glossary still grows. **Batch does not mean sloppy.** What batch removes is the
   conversation, not the standard.
3. Run `/review` on that ticket's commit range, and fix what it surfaces before moving on.
4. **Commit once**, message led by the ticket key, so the ticket is one revertible unit.
5. Move it to In Review and post a one-line comment saying it is in the batch branch.
6. Run the tests related to that ticket before the next one starts, and the full suite once
   before you open the PR (the working notes can override this, as in Phase 4). If the full suite fails, find the ticket that caused it and park it.

At the end, open **one PR** listing every ticket key it contains. Say which commit is which, and list the calls you made under each ticket.

## Parking

When a ticket surprises you, **park that ticket and carry on with the next one.** Do not stop
the batch, and do not push through.

Park it when: the change spreads well past what the ticket implied; a test fails for a reason
you didn't cause; or a trivial ticket turns out to need more than one commit.

A decision the PRD doesn't settle is not a reason to park. Make your best call and keep going,
as in Phase 3.

To park: revert or drop that ticket's work so the branch stays clean, mark the step that stopped
you HITL, move the ticket back to `To Do`, and comment plainly what it hit and what it needs. A
trivial ticket that wasn't trivial goes back to `To Plan` with its `trivial` label removed. Then
move to the next ticket.

Coming back to "six done, two parked, here's why, and these are the calls I made" is the point
of the mode.

## Reporting back

Close with a short table — ticket, done or parked, one line why for each park, and any calls you made — plus the PR
link and the total. Say plainly if the parked pile is bigger than the done pile; that means the
planning was optimistic, not that the run failed, and it is worth knowing before the next batch.

</batch>

<supporting-info>

<board-discipline>

The whole point is that the board reflects reality without me nudging it. But **every project's workflow is different** — statuses may be named `To Do / In Progress / In Review / Done`, or `Selected / Building / Review / Shipped`, or anything else.

- **Never hardcode a status name.** Use what the tracker lists, per the backend file.
- If nothing matches a phase (e.g. the project has no "In Review"), skip it — don't invent statuses.
- The five columns in `BOARD.md` are the *intended* names. Read the project's config block for what it actually calls them, and if a column doesn't exist, say so rather than inventing one.
- **When unattended, leave alone any ticket with no reachable sub-task.** A person is supposed to make a call first. An agent taking one is the failure this rule exists to prevent.

</board-discipline>

<scope>

`implement` builds **one level-0 ticket** — a `Feature`, `Task`, or `Bug` that has been through `/plan-ticket` and carries a PRD. It does not plan, decompose, or spec: if the ticket isn't ready, hand it back to **`/plan-ticket`**. It does not resolve **investigation tickets** — those are decision work, routed by `/plan-ticket` to `research` / `prototype` / `grill-with-docs` and closed with a decision comment, not built.

</scope>

<tracker-mechanics>

The backend file named in [the tracker skill](../tracker/SKILL.md) covers the tools, moving a ticket,
listing a column, editing a body without destroying what's on it, and linking code.

**Finding the ready queue** (`implement next`) — list `To Do`, oldest first, and drop anything with
an open blocker or nothing reachable.

**Stopping and deciding.** A `To Do` ticket may legitimately mix `afk` and `hitl` sub-tasks; you
build the AFK ones you can reach and stop at the first HITL one (see Phase 0.4), because someone
has already said that call needs me. If a sub-task labelled `afk` turns out to have a decision in
it after all, make your best call, as in Phase 3, and keep going.

**Ticking acceptance criteria** means editing the body — read it first, then re-set it,
so you don't wipe anything you didn't write. Same for labels: keep exactly one state label if
the project uses them.

</tracker-mechanics>

</supporting-info>
