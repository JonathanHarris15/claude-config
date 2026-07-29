---
name: plan-ticket
description: Take a ticket from the To Plan column all the way to the board — read how big and how formed it is, route it down the right lane (workshop / research / grill / diagnose, or escalate a whole project to create-epic), then converge on a PRD and sub-tasks and land it in To Do or On Deck. The front door of the JIRA workflow. Use with a ticket key (/plan-ticket METH-48) or ALL to work the whole To Plan column.
argument-hint: "A JIRA ticket key (e.g. METH-48), or ALL to queue up the whole To Plan column"
---

# Plan Ticket

The **front door**. Everything in `To Plan` comes through here and leaves specced, sliced,
and sitting in the right column.

Read [BOARD.md](../jira-doctor/BOARD.md) (the contract you're upholding) and
[ROUTING.md](./ROUTING.md) (the judgment call you're making) before you start.

**The premise:** `To Plan` is a genuine inbox, and things land in it at wildly different
stages of formulation. A title you scratched down mid-feature. A Feature `create-epic`
emitted with a loose brief. A long ticket you wrote by hand on a good day and half-forgot.
A bug. They are not the same problem and they must not get the same treatment — the whole
skill is about **reading which one you're holding** before you start working it.

## Phase 0: Gate

Read the project's `./CLAUDE.md` and find the `<!-- jira-config -->` block.

**No block → stop immediately.** Say plainly: *"This project isn't linked to Jira yet. Run
`/jira-setup` first."* Then **stop** — don't offer to plan anything anyway, don't guess a
project key, don't half-run it. The whole point of the spine is that it isn't optional.

Take the cloudId, project key, and the **real issue-type names** from the block. Load the
Atlassian tools (deferred — read the server prefix off the first call, never hardcode it):

```
ToolSearch → jira search issues
```

then one `ToolSearch → select:…` with that prefix for: `searchJiraIssuesUsingJql`,
`getJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `createJiraIssue`,
`getTransitionsForJiraIssue`, `transitionJiraIssue`, `createIssueLink`, `getIssueLinkTypes`.

---

# Single ticket: `/plan-ticket METH-48`

## Phase 1: Read it

`getJiraIssue` with `summary, description, issuetype, status, labels, parent, issuelinks,
comment, subtasks`.

**Sanity-check it's actually in `To Plan`.** If it isn't:
- Already right of `To Plan` **with** a PRD → it's already planned. Say so, show what's on
  it, and ask if they want to re-plan (which means overwriting the PRD — confirm explicitly).
- Right of `To Plan` **without** a PRD → the board is lying. Plan it anyway, and mention that
  `/jira-doctor` would have caught this.

Then **explore the codebase** before forming any opinion. Read `CONTEXT.md` (the glossary)
and `docs/adr/`; if a `CONTEXT-MAP.md` exists, follow it to the right context. A ticket that
looks foggy in isolation is often perfectly clear once you see the code it lands in — and a
question you could answer by reading the repo is a question you must never ask the user.

## Phase 2: Read the two dials

Apply [ROUTING.md](./ROUTING.md). Two dials, **size first**:

1. **Size** — is this one deliverable, a whole project, or a pile of unrelated things?
2. **Clarity** — fog / unknowns / sharp / already-specced. (Bugs skip this — they go to
   `/diagnose` to be reproduced first.)

## Phase 3: Say what you see, and get agreement

**Do not silently start a workshop.** Tell the user what you read and where you're taking it:

> **METH-48 — "Make onboarding less painful"**
>
> This is one deliverable, not a project — it lives entirely in the signup flow.
>
> But it's **fog**. It names a feeling, not a change: there's no statement of what "less
> painful" means, and I can't find a definition of done anywhere in it. The code has three
> plausible places this could mean — the email verification round-trip, the six-field form,
> or the empty first-run state — and they'd be completely different pieces of work.
>
> **I'd take this to `/workshop`** — I'll put three genuinely different framings in front of
> you and you tell me which one is the itch you were actually scratching. Roughly 15 minutes.
>
> Sound right, or do you already know which one you meant?

Give a **recommendation with reasoning**, not a menu. If the user overrides you ("no, just
grill it, I know what I want"), take the override — but if you think they're wrong, say so
once, then do as they say.

## Phase 4: Run the lane

| Read | Run |
| --- | --- |
| **A project, not a ticket** | `/create-epic`. The epic's Features land back in `To Plan` as fresh tickets. Close METH-48 with a comment linking the epic — it did its job. **Stop here**; the new tickets each come through `plan-ticket` on their own. |
| **A pile** | Split into sibling tickets in `To Plan`, close the original, then plan each. |
| **Bug** | `/diagnose` — reproduce and find the cause. Then re-read the clarity dial; usually the cause makes the fix obvious → go straight to Phase 5. If it won't reproduce, park it in `To Plan` with what you found and say what you need. |
| **Fog** | `/workshop` → then usually `/grill-with-docs`. |
| **Unknowns (facts)** | `/research` → then `/grill-with-docs`. |
| **Unknowns (feel)** | `/prototype` → then `/grill-with-docs`. |
| **Sharp** | `/grill-with-docs`. **The default lane.** |
| **Already specced** | Straight to Phase 5 — but only after honestly hunting for one question whose answer would change the PRD. If you find one, it wasn't this lane. |

Lanes **flow into each other**. A workshop that surfaces a factual unknown hands to research;
research that resolves it hands to grill. Passing through two or three is normal, not a
failure — just say when you're moving between them.

**Placement.** Before you converge: if the ticket has no epic parent, ask which epic it
belongs under, or confirm it's genuinely standalone (bugs and one-off chores usually are).
Don't invent an epic for a one-off.

## Phase 5: Converge

Always both, in order — no exceptions, whatever lane it took:

1. **`/to-prd`** — writes the PRD onto **this ticket's own description**. The ticket *is* the
   PRD; there's no separate doc.
2. **`/to-issues`** — creates the real **sub-tasks** under it. These don't get board columns;
   they show as a progress count inside the card, which is what lets you glance at a To Do
   ticket in the morning and see it got 4 of 7 done before it stalled.

## Phase 6: Land it

Now make the call that decides who does this work. Apply the AFK-safety rule from `BOARD.md`
**strictly** — and note the question it asks is *not* "is this ticket entirely AFK?" but **"can
an agent do any real work here without deciding anything?"** Compute the ticket's
**AFK-reachable set**: the AFK sub-tasks whose blockers are all Done or themselves reachable.
Anything HITL, and anything sitting behind a HITL sub-task, is out of reach.

- **`To Do`** — a PRD with pass/fail criteria, sub-tasks that each name what they build,
  **a non-empty AFK-reachable set**, and no open blockers. Mixed tickets belong here:
  `implement` builds what it can reach and stops to ask at the first real decision, with the
  mechanical half already done.
- **`On Deck`** — ready, but **the next step needs you**. Every sub-task is HITL, or the AFK
  ones all sit behind a HITL one, so there is nothing to start on. **Yours.**

The classification that matters most is **per sub-task**, not per ticket. A HITL sub-task no
longer condemns the whole ticket — but a HITL sub-task *mislabelled AFK* is worse, because a
builder walks straight into it believing it's mechanical. When in doubt, call it HITL.

**Recommend, with the reason, then confirm before moving:**

> Specced. METH-48 has a PRD and 5 sub-tasks.
>
> I'd put it in **To Do** — sub-tasks 1, 2, 4 and 5 are mechanical and can be built straight
> through. It'll stop at sub-task 3, "surface the verification error inline," because there's
> no right answer to *how* that should look and it shouldn't invent one. You'd get four of five
> done, and one question to answer.
>
> (If sub-task 3 blocked the others, it'd be On Deck instead — but it doesn't.)
>
> Move it to To Do?

Transition with `getTransitionsForJiraIssue` → `transitionJiraIssue`. **Never assume a
transition exists**; if there's no valid path from the current status, say so and stop.

Report: the key, its new column, the sub-task count, and why it landed where it did.

---

# Batch: `/plan-ticket ALL`

Same skill, but you **queue first and work second** — so the user sees the whole shape of the
column before committing an afternoon to it.

## Phase A: Survey

```
project = <KEY> AND status = "To Plan" ORDER BY created ASC
```

Read every one. Explore the codebase **once**, up front — the context is shared across all of
them and re-reading it per ticket is waste.

## Phase B: Classify all of them

Run **Phase 1 and 2** (read + two dials) on every ticket. Do not run any lane yet. This is
cheap and it's what makes the queue honest.

Consider dispatching a **subagent per ticket** to do the reading and classification in
parallel — they're independent, and a column of 12 tickets is otherwise a long silent wait.
Each returns: size, clarity, proposed lane, and the one-line reason. You make the final call.

## Phase C: Show the queue

A table, ordered by **what unblocks what** (an epic escalation first — its Features become new
tickets that themselves need planning), then cheapest-first within that:

| Ticket | Summary | Read | Lane | You needed? |
| --- | --- | --- | --- | --- |
| METH-51 | Rework the sync engine | **Project** | `/create-epic` | Heavily — ~45m |
| METH-48 | Make onboarding less painful | Fog | `/workshop` → grill | Yes — ~15m |
| METH-52 | Retry failed webhooks | Sharp | `/grill-with-docs` | Some — ~10m |
| METH-49 | Duplicate rows on import | Bug | `/diagnose` | Only if it won't repro |
| METH-50 | Add `--json` to the CLI | Specced | straight to `to-prd` | No |

Then: *"That's roughly 90 minutes of your attention. Want to do all of them, a subset, or
just the cheap ones?"* **Let them cut the queue before you start.** Seeing that one scratch
note is secretly a 3-week project is often the most valuable thing this skill produces, and
they may well want to stop right there and think.

## Phase D: Work the queue

One at a time, in order, **interactively** — Phases 3→6 per ticket. This is not unattended:
workshops and grillings are conversations, and batching them wouldn't make them faster, just
worse.

After each ticket lands, show a one-line progress marker (*"3 of 6 done — METH-52 → On Deck"*)
and carry straight on to the next. **Don't ask permission to continue** between tickets; they
already approved the queue. Do stop and ask if a ticket turns out to be something the queue
didn't predict — a "sharp" one that's actually fog, or a ticket that turns out to be a project.

At the end: what landed where, what's left in `To Plan` and why, and anything the planning
surfaced that wants its own ticket.
