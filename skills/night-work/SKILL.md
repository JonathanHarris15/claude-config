---
name: night-work
description: Drain the Night Work column unattended — take tickets one at a time, build every sub-task an agent can do without deciding anything (a PR if that finishes the ticket, a pushed branch and a handover if it stops at a HITL sub-task), and leave a report to read over coffee. Stops rather than guesses; never merges its own work. Use when you want an agent to grind through ready tickets while you sleep, or say "run the night queue" / "work the night column".
argument-hint: "Optional: max tickets to attempt this run (default 3)"
---

# Night Work

Drain the **`Night Work`** column while the user sleeps. One ticket at a time, taken as far as
it can honestly go, and a report in the morning.

Read [BOARD.md](../jira-doctor/BOARD.md) first. `Night Work` is a promise someone made:
*there is real work in this ticket an agent can do without deciding anything.* Your job is to
honour that promise — to **take each ticket as far as its decision-free work goes**, and to
**refuse the moment it runs out**.

## The stance

You are running **unattended**. Nobody will answer you. That changes what "being careful"
means, and it is the whole skill:

> **A blocked ticket in the morning is a fine outcome. A guessed one is not.**

The user can unblock a stalled ticket over coffee in two minutes. They cannot easily undo a
plausible-looking PR built on a decision you invented at 3am and never flagged — because it
*looks finished*, so it gets reviewed as if it were.

So: when the PRD doesn't answer something, you do not pick the sensible option. You **stop at
that sub-task, bank everything you finished before it, and hand the ticket back.**

## Whole tickets and part tickets

A `Night Work` ticket is not all-or-nothing. Its sub-tasks are individually classified
**AFK** (decision-free — yours) or **HITL** (needs the user — never yours), and a perfectly
legitimate ticket looks like: four AFK sub-tasks, then two HITL ones.

**You build the AFK-reachable set and stop.** A sub-task is *reachable* if it is AFK and every
sub-task blocking it is Done or itself reachable. Anything HITL is unreachable; anything
sitting behind a HITL sub-task is unreachable too, even if it's labelled AFK — you can't
build on a decision that hasn't been made.

That gives two ways a ticket can end well:

| | Outcome | Where it lands |
| --- | --- | --- |
| **Complete** | Every sub-task was reachable and you did them all. | PR open, ticket **`In Review`**. |
| **Partial** | You did the reachable ones and hit the HITL boundary. | Branch pushed, **no PR**, ticket **`On Deck`** with a handover comment. |

**A partial ticket is a success.** It is the user's mechanical work done for free, waiting at
the exact line where their judgment starts. Do not treat it as a failure, do not count it
toward the abort rule, and do not apologise for it in the report.

**A partial ticket gets no PR.** Ever. A half-finished branch with a PR on it reads as
finished work, and that is the one impression you must never create. The branch is pushed and
named in the comment; that's enough to see the diff.

## Phase 0: Preflight — refuse to start on a broken foundation

Run every check. **Any failure aborts the whole run** — say why and stop. An unattended run
that starts broken is a wasted night, and worse, a misleading one.

1. **Jira link.** `<!-- jira-config -->` block in the project's `./CLAUDE.md`. Missing → stop,
   tell them to run `/jira-setup`.
2. **Clean tree.** `git status` must be clean. Uncommitted work in the tree means you'd be
   building on top of something the user didn't finish, and your commits would swallow it.
   Dirty → stop. **Never stash it, never commit it "out of the way."**
3. **On the default branch, and current.** `git switch main && git pull` (or the repo's default).
   Every ticket branches from here.
4. **The test suite passes right now.** Run it. **This is the most important check in the
   skill** — you detect regressions by comparing against a green baseline, and if the baseline
   is already red you cannot tell your breakage from the breakage you inherited. A red suite
   at launch → **stop**. Report which tests were already failing. Do not "fix" them; that is
   not what you were asked to do and it is not AFK work.
5. **The queue.**
   ```
   project = <KEY> AND status = "Night Work" ORDER BY created ASC
   ```
   Empty → say so and stop cheerfully; there's nothing to do.
6. **The cap.** Default **3** tickets, or the number passed as an argument. This bounds the
   morning: the user knows the most they'll have to review.

Then **show the queue and the cap and confirm once** — and for each ticket, say up front how
far you expect to get, by counting its AFK-reachable sub-tasks:

> 4 tickets in Night Work, cap is 3 — I'll attempt METH-50, METH-52, METH-49 and leave
> METH-55. Baseline suite is green (212 passing). Working tree clean, on `main`.
>
> - **METH-50** — 5 of 5 sub-tasks AFK. Expect a PR.
> - **METH-52** — 4 of 6 AFK; sub-tasks 5–6 are HITL ("choose the empty-state copy"). I'll
>   build the first four and hand it back on a branch, no PR.
> - **METH-49** — 3 of 3 AFK. Expect a PR.
>
> I won't merge anything, I won't touch a HITL sub-task, and I'll stop rather than guess. Go?

**That confirmation covers the whole run.** After it, do not ask another question — there is
nobody there. Where `implement` says *"confirm with me before claiming"*, the confirmation was
given here, for exactly these tickets. Where it says *"stop and ask"* — **stop the ticket** and
move on.

## Phase 1: The loop

Per ticket, in queue order:

### 1. Re-check it's still takeable

The board may have moved since it was queued. Re-read the ticket (`getJiraIssue` with
`comment`, `issuelinks`, `status`, `subtasks`), and read every sub-task (labels, description,
blocked-by links).

- **Blocked** by an open issue → skip, note it, next ticket.
- **No PRD** (no `## Problem Statement` + `## Acceptance Criteria`) → it should never have been
  in this column. Move to `To Plan`, comment, next ticket.
- **Nothing reachable** — every sub-task is HITL, or the AFK ones all sit behind a HITL one →
  there is no work here for you. Move to `On Deck`, comment why, next ticket.
- **A sub-task labelled AFK is not actually AFK** — it says "decide how X should look," or a
  question about it appeared in the comments and nobody answered → **treat it as HITL** for
  tonight. It stops your reach; it does not condemn the whole ticket. Say so in the comment.

Re-checking is not paranoia. A ticket queued a week ago and a ticket queued an hour ago are
not the same object.

### 2. Draw the line before you build

Compute the **AFK-reachable set** (see *Whole tickets and part tickets*) and write it down:
which sub-tasks you will do, in dependency order, and **which sub-task is the wall** — the
first HITL one you'll stop at, and the question it needs answered.

Do this *before* you touch code. Knowing where you're going to stop is what keeps you from
drifting one sub-task past it at 4am because the next step "seemed obvious."

### 3. Branch, from clean main

`git switch main` → confirm clean → `git switch -c METH-50-short-slug`. **Every ticket starts
from `main`, never from the last ticket's branch.** Your tickets must not depend on each other's
unreviewed work — if PR #2 is built on PR #1 and the user rejects #1, they lose both.

### 4. Build the reachable set

Run **`/implement METH-50`**, naming the sub-tasks it is allowed to work — it already knows how
to work them test-first, guard against regressions, tick acceptance criteria, and drive the
ticket's JIRA states. Don't reimplement it.

> /implement METH-50 — unattended night run. Work only sub-tasks METH-51, METH-53, METH-54,
> METH-56, in that order. METH-57 and METH-58 are HITL: do not touch them, do not open a PR
> if they remain, and stop rather than ask me anything.

Three things override `implement`'s normal behaviour, because it is written for a human being present:

- **Never ask.** Any point where it would seek input is a **stop** (see below).
- **Never touch a HITL sub-task.** Not even the "obvious" part of one. It is not yours.
- **Never merge.** A complete ticket ends in `In Review`. It does not go to `Done`. Ever.

Tick each reachable sub-task Done as it lands, so the card's progress count is true in the
morning — *4 of 6* is exactly the information the user needs at a glance.

### 5. Review your own work

Run `/code-review` on the diff, and **act on what it finds** before you ship anything. You are
the only reviewer this code gets before a tired human looks at it. Work that ships with a bug
your own review flagged is worse than no work — it teaches the user not to trust the night run.

This applies to partial tickets too. Half a ticket is still code they have to read.

### 6. Ship it — the fork

Commit with the ticket key, always. What happens next depends on how far you got:

**Complete** — every sub-task done:
Push the branch. Open a PR titled `METH-50: <summary>` so JIRA links it. Transition the ticket
to **`In Review`**.

**Partial** — you hit the HITL wall:
Push the branch. **Do not open a PR** — not a draft, not anything. Transition the ticket to
**`On Deck`**: the next step in it needs the user, which is precisely what that column means.
The finished sub-tasks stay ticked Done.

### 7. Leave the audit trail

Comment on the ticket — this is what makes the night reconstructable.

**Complete:**

```markdown
> *Built unattended by /night-work.*

**Outcome:** PR #142 open, ready for review.
**Sub-tasks:** 5 of 5 done.
**Tests:** 14 added, full suite green (226 passing).
**Notes:** <anything the reviewer should know — a judgment you had to make inside the
PRD's boundaries, something surprising in the code, a shortcut you took and why.>
```

**Partial** — the handover is the whole point, so make it precise enough to resume from
without rereading the branch:

```markdown
> *Partly built unattended by /night-work — the AFK half is done, the rest needs you.*

**Outcome:** 4 of 6 sub-tasks done, pushed to branch `METH-52-inline-errors`. **No PR** —
the ticket isn't finished, and a PR would read as though it were.
**Done:** METH-53 (parser), METH-54 (validation rules), METH-55 (error model), METH-56 (wiring).
**Stopped at:** METH-57, "surface the verification error inline" — HITL.
**Why it's yours:** the PRD doesn't say *where* the error appears, and there are three
plausible places in the signup flow. Any choice I made would be a design decision you didn't make.
**What I need:** just tell me where the error goes. METH-58 is mechanical once that's settled.
**Tests:** 9 added, full suite green (221 passing).
**To resume:** `git switch METH-52-inline-errors`, then `/implement METH-52`.
```

### 8. Reset and go again

`git switch main`, confirm the tree is clean, take the next ticket.

---

## When a ticket goes wrong

First, be sure it actually did. **Reaching a HITL sub-task is not a ticket going wrong** — it
is the ticket ending exactly where it was always going to end. That's step 6's partial path, it
is a success, and it does not count toward the abort rule below.

A ticket has gone **wrong** when something you didn't plan for stops you: a surprise blocker, an
existing test failing for reasons you can't attribute to your change, an AFK sub-task that turns
out to have a decision buried in it, the build breaking. Then:

1. **Stop the ticket. Do not force it.**
2. **Leave the branch.** Don't delete it, don't reset it — it's evidence, and the user may
   want to see how far you got. Push it if there's anything worth seeing. **No PR**, even if
   most of the ticket landed — same rule as a partial.
3. **Move the ticket to `On Deck`.** It needs a human now. That's what the column is for.
4. **Comment precisely.** Not "couldn't complete this." The user needs to unblock it in two
   minutes without rerunning your night:

   ```markdown
   > *Attempted unattended by /night-work — stopped, needs you.*

   **Stopped at:** METH-50, "validate the imported rows" — labelled AFK, but it isn't:
   the PRD never says what to do with a row that half-parses, and there are three defensible answers.
   **Why:** any choice I made would be a product decision you didn't make.
   **Done so far:** METH-48 and METH-49 are complete and committed on branch `METH-47-row-import`.
   **What I need from you:** tell me what a half-parsed row does; the rest is mechanical.
   ```
5. **Next ticket.** One bad ticket must not burn the night.

**Two consecutive genuine failures → abort the run.** Two in a row is not bad luck, it's
systemic — the build is broken, a dependency moved, something is wrong with the machine. Stop,
report, don't thrash for six hours. Partial tickets never trigger this; a night of clean partials
is a good night.

---

## The never list

These are not guidelines. An unattended agent that breaks one of these does damage that
outlives the night.

- **Never merge a PR.** The user is the merge gate. Always.
- **Never touch a HITL sub-task.** Not the whole thing, not the "obvious" first half, not a
  stub to make the AFK ones fit together. The label is the fence. If an AFK sub-task turns out
  to need the answer to a HITL one, it was never reachable — stop there.
- **Never open a PR on a ticket that isn't finished.** Not a draft PR either. A partial ticket
  hands back a pushed branch and a comment, nothing more. A PR is a claim that the work is done,
  and half a ticket cannot make that claim.
- **Never push to `main`.** Never force-push, anywhere.
- **Never weaken a test to make it pass.** Do not edit, skip, delete, or loosen an existing
  test because it's in your way. **An existing test that fails is a `stop`, not an obstacle** —
  it is the codebase telling you something you don't know. This is the single most damaging
  thing you could do tonight, because it converts a caught bug into a shipped one.
- **Never tick an acceptance criterion you haven't actually met.**
- **Never make a design, product, or taste decision.** Stop instead. If you find yourself
  reasoning about what the user "probably wants," you have already failed — that reasoning is
  the thing you're not allowed to do.
- **Never take a ticket outside `Night Work`.** `On Deck` is explicitly not yours.
- **Never add a dependency, change build config, or alter CI** without stopping. Each is a
  decision with consequences past this ticket.
- **Never touch secrets, `.env`, or infrastructure.**
- **Never `git reset --hard` or delete files outside the ticket's scope.**

If a rule here and a rule elsewhere conflict, **this list wins** and you say so in the report.

---

## Phase 2: The morning report

Two outputs. Both matter — the Jira comments are the durable record, the report is the read.

### Jira

Already done: a comment on every ticket you touched (step 6, or the stop template).

### The HTML report

Build it from [REPORT-TEMPLATE.html](./REPORT-TEMPLATE.html) — the styling is done, fill in the
content. Write it to **`.night/report-YYYY-MM-DD.html`** in the project, and **add `.night/` to
the project's `.gitignore`** if it isn't there. These are disposable; they don't belong in git.

Then **publish it as an Artifact** so there's a link to open with coffee, phone in hand, before
sitting down. Title it `Night run — <date>`, favicon 🌙. If publishing fails, don't sweat it —
say where the local file is and move on.

The report answers, in this order — **the things that need the user come first, because that's
the only part they'll definitely read**:

1. **The verdict.** One line, and it has three numbers now, not two.
   *"3 attempted — 1 landed with a PR, 1 got 4 of 6 sub-tasks and needs a call from you, 1 stopped."*
2. **What needs you** — every ticket that came back short, whether it was a planned HITL stop or
   a genuine failure, and for each: how far it got, the branch it's on, exactly which sub-task is
   the wall, and the question that answers it. **This is the most valuable section in the file.**
   Write it so the user can unblock it in two minutes.
   - Be clear which kind of stop it was. *"Stopped where it was always going to stop — 4 of 6
     done, needs your call on the error placement"* is a very different message from *"stopped
     because a test I didn't expect started failing."* Don't let the second hide inside the first.
3. **What's ready to review** — the PRs, each with what it does, what changed, what tests were
   added, and anything you'd want a reviewer to look at hardest. Be honest about the shaky bits;
   you are the only one who knows where they are. **Only complete tickets appear here.** A partial
   ticket has no PR and belongs in *What needs you*, however much of it you finished.
4. **What happened** — the run, ticket by ticket, in order. The narrative.
5. **What I noticed but didn't act on** — things you saw in the code that aren't this ticket's
   job. Candidate `To Plan` tickets. Don't file them; just surface them. Filing work the user
   didn't ask for is its own kind of guessing.

**Write it like a colleague's handover note, not a build log.** Timestamps and command output
are noise. What the user wants at 8am is: *what do I need to do, and can I trust what you did?*

Answer both, plainly. Including — especially — where the answer is "don't trust this bit."
