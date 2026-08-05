---
name: jira-doctor
description: Audit a linked JIRA project against the board contract and repair what it can — check the six columns exist, check the Epic/ticket/sub-task shape is right, sweep stray tickets into To Plan, push un-specced tickets out of To Do, and demote tickets whose next step needs you out of To Do. Use when the board looks wrong, after jira-setup, before a big planning session, or periodically to keep the board honest.
argument-hint: "Optional: 'fix' to apply repairs after confirming, or a specific area (e.g. 'sub-tasks')"
---

# Jira Doctor

Check a linked JIRA project against [BOARD.md](./BOARD.md) — **read it first**, it is the
contract you are enforcing — and repair what can be repaired.

The board is only worth trusting if it is *true*. A ticket sitting in `To Do` that was
never actually specced is worse than no board at all: it's a promise the system will act
on. This skill's job is to find every place the board is lying and fix it.

## Phase 0: Gate

Read the project's `./CLAUDE.md` and find the `<!-- jira-config -->` block. Take the
cloudId, project key, and the **real issue-type names** from it.

**No block → stop.** Tell the user this project isn't linked to JIRA yet and they should
run `/jira-setup` first. Do not guess a project key.

Load the Atlassian tools (deferred — the server prefix differs per install, so read it off
the first call and never hardcode it):

```
ToolSearch → jira search issues
```

then in one further `ToolSearch → select:…` using that prefix: `searchJiraIssuesUsingJql`,
`getJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `getTransitionsForJiraIssue`,
`transitionJiraIssue`, `getJiraProjectIssueTypesMetadata`, `getAccessibleAtlassianResources`.

## Phase 1: Check the board's shape

**The six statuses.** Probe each with JQL — `project = <KEY> AND status = "<name>"`. A
status that exists returns results (zero results is fine and still proves existence); one
that doesn't **errors** with *"The value … does not exist for the field 'status'"*. Probe
all six: `To Plan`, `To Do`, `On Deck`, `In Progress`, `In Review`, `Done`.

**You cannot fix this yourself.** There is no board or workflow API in this connector.
When a status is missing, hand the user an exact manual fix — *Project settings → Workflows*
to add the status, *Board settings → Columns* to map a column to it — and name precisely
which ones are absent. Don't bury it; a missing status means part of this workflow
silently doesn't exist.

Be straight about the limit of the probe: it proves the **status** exists, not that a
**board column** is mapped to it. Say so.

**The hierarchy.** `getJiraProjectIssueTypesMetadata` → confirm there's a level-1 Epic type,
at least one level-0 ticket type, and a level-−1 sub-task type. If the `CLAUDE.md` block's
recorded names have drifted from reality (someone renamed a type in JIRA), flag it and offer
to rewrite the block.

## Phase 2: Examine every open ticket

Pull them all:

```
project = <KEY> AND statusCategory != Done ORDER BY status ASC, created ASC
```

Ask for the fields you need in one go — `summary, status, issuetype, description, labels,
parent, issuelinks, subtasks` — so you aren't fetching each ticket individually.

Then run each ticket through the checks below. Work from the **contract**, not from vibes:
a ticket is only sick if it violates a rule in `BOARD.md`.

### The checks

**① Stray — in a column outside the seven.**
A leftover status from the project's previous life (`Backlog`, `Selected for Development`,
`Blocked`, …). → **Propose: move to `To Plan`.** It's an idea that isn't on the workflow;
the inbox is where it belongs.

**② Lying — right of `To Plan` without a PRD.**
This is the big one. For every ticket in `To Do` / `On Deck` / `In Progress`,
check the description for **both** a `## Problem Statement` heading and an `## Acceptance
Criteria` heading. Length is not evidence — a thousand words of prose is not a PRD.

→ **Propose: move back to `To Plan`.** Post a comment saying why, so it isn't mysterious.

*Exception:* investigation tickets (label `investigation`, summary prefixed `[research]` /
`[prototype]` / `[grill]` / `[task]`) never get a PRD. **Skip them** for this check.

*Judgment call:* a ticket in `In Progress` with no PRD is being actively worked. Don't yank
it backwards — **flag it and ask**. Someone may be mid-flight.

**③ Misfiled — in `To Do` when the next step actually needs you.**
Apply the decision rule from `BOARD.md`. The test is whether the ticket's **first reachable
sub-task is AFK** — decision-free, with every blocker Done or itself reachable. A mix of AFK
and HITL sub-tasks is **fine**: `implement` builds what it can reach and stops to ask at the
first real decision.

It fails if: acceptance criteria are vague rather than pass/fail; **every** sub-task is HITL, or
the AFK ones all sit behind a HITL one (nothing to start on); there's an open blocker in
`issuelinks`; there's an unanswered question in the comments; or it's an `investigation`
ticket (deciding is never decision-free work).

Also flag — **don't demote, just say it** — any sub-task labelled `afk` whose description asks
for taste or a design call ("pick a sensible layout", "decide how errors surface"). That's a
mislabel, and the expensive kind: a builder walks into it believing it's mechanical. Propose
relabelling it `hitl`.

→ **Propose: demote to `On Deck`.** When in doubt, demote. A wrong `On Deck` costs you an
afternoon; a wrong `To Do` costs you a confident guess made on your behalf.

**④ Naked — no sub-tasks but claims to be ready.**
A ticket right of `To Plan` with a PRD but **zero sub-tasks** was specced but never sliced.
→ **Propose: run `/to-issues` on it.** (Not a demotion — the thinking is done, the slicing
isn't.)

**⑤ Misplaced level.**
- A **sub-task** sitting in a board column of its own → it shouldn't be a sub-task, or it
  shouldn't be on the board. Flag it and ask which.
- An **Epic** in a board column → Epics group, they don't ride the board. Flag it.
- A level-0 ticket with **no epic parent** → often *fine* (bugs, one-off chores are meant to
  be standalone). Don't auto-fix. Just **list them** and ask whether any want a home.

**⑥ Bug hygiene.**
A `Bug` with a **due date** violates the contract — a bug is dated by the epic it blocks,
not on its own. → **Propose: clear the due date.**

An epic parent on a Bug is **not** a violation: a bug that must be fixed before its epic
ships belongs to that epic. Don't touch it.

## Phase 3: Report, then repair

Present the findings as a table — ticket key, summary, what's wrong, proposed fix — grouped
by check, worst first (② and ③ are the ones that actually cost you something).

Then, clearly separated:

- **What I can fix** — everything above. Ask before applying; apply as a batch.
- **What you must fix by hand** — missing statuses and board columns. An exact click-path,
  not a vague gesture at settings.

If the user invoked `/jira-doctor fix`, still show the table, still confirm once, then apply.
Never transition a ticket silently.

**When you move a ticket, say why on the ticket.** `addCommentToJiraIssue`, one line, plain:
*"Moved back to To Plan by /jira-doctor: no PRD on this ticket, so it wasn't actually ready.
Run /plan-ticket METH-48 to spec it."* A ticket that moves for invisible reasons trains the
user to distrust the board — which is the exact thing this skill exists to prevent.

Use `getTransitionsForJiraIssue` → `transitionJiraIssue` for every move. **Never hardcode a
transition id or assume one exists**; if there's no valid transition from a ticket's current
status to where it needs to go, say so and leave it.

## Phase 4: Close out

End with a one-line verdict — *"Board is healthy"* or *"Board is healthy except: no `On
Deck` status, and 3 tickets need speccing"* — then the single most useful next move, which
is usually `/plan-ticket ALL` if `To Plan` has anything in it.
