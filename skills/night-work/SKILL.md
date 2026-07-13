---
name: night-work
description: Drain the Night Work column unattended — take AFK-safe tickets one at a time, build each with implement, open a PR per ticket, and leave a report to read over coffee. Stops rather than guesses; never merges its own work. Use when you want an agent to grind through ready tickets while you sleep, or say "run the night queue" / "work the night column".
argument-hint: "Optional: max tickets to attempt this run (default 3)"
---

# Night Work

Drain the **`Night Work`** column while the user sleeps. One ticket at a time, a PR each,
a report in the morning.

Read [BOARD.md](../jira-doctor/BOARD.md) first. `Night Work` is a promise someone made:
*this ticket has zero open decisions, an agent can be trusted with it unattended.* Your job
is to honour that promise — and to **refuse the work the moment it turns out to be false**.

## The stance

You are running **unattended**. Nobody will answer you. That changes what "being careful"
means, and it is the whole skill:

> **A blocked ticket in the morning is a fine outcome. A guessed one is not.**

The user can unblock a stalled ticket over coffee in two minutes. They cannot easily undo a
plausible-looking PR built on a decision you invented at 3am and never flagged — because it
*looks finished*, so it gets reviewed as if it were.

So: when the PRD doesn't answer something, you do not pick the sensible option. You **stop
that ticket, move it to `On Deck`, say exactly what you needed, and take the next one.**

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

Then **show the queue and the cap and confirm once**:

> 4 tickets in Night Work, cap is 3 — I'll attempt METH-50, METH-52, METH-49 and leave
> METH-55. Baseline suite is green (212 passing). Working tree clean, on `main`.
>
> Each gets its own branch and PR. I won't merge anything, and I'll stop rather than guess.
> Go?

**That confirmation covers the whole run.** After it, do not ask another question — there is
nobody there. Where `implement` says *"confirm with me before claiming"*, the confirmation was
given here, for exactly these tickets. Where it says *"stop and ask"* — **stop the ticket** and
move on.

## Phase 1: The loop

Per ticket, in queue order:

### 1. Re-check it's still takeable

The board may have moved since it was queued. Re-read the ticket (`getJiraIssue` with
`comment`, `issuelinks`, `status`, `subtasks`).

- **Blocked** by an open issue → skip, note it, next ticket.
- **No PRD** (no `## Problem Statement` + `## Acceptance Criteria`) → it should never have been
  in this column. Move to `To Plan`, comment, next ticket.
- **AFK-safety has gone stale** — an unanswered question appeared in the comments, a sub-task
  says "decide how X should look," an `investigation` label crept on → move to `On Deck`,
  comment why, next ticket.

Re-checking is not paranoia. A ticket queued a week ago and a ticket queued an hour ago are
not the same object.

### 2. Branch, from clean main

`git switch main` → confirm clean → `git switch -c METH-50-short-slug`. **Every ticket starts
from `main`, never from the last ticket's branch.** Your tickets must not depend on each other's
unreviewed work — if PR #2 is built on PR #1 and the user rejects #1, they lose both.

### 3. Build it

Run **`/implement METH-50`** — it already knows how to work sub-tasks test-first, guard against
regressions, tick acceptance criteria, and drive the ticket's JIRA states. Don't reimplement it.

Two things override `implement`'s normal behaviour, because it is written for a human being present:

- **Never ask.** Any point where it would seek input is a **stop** (see below).
- **Never merge.** The ticket ends in `In Review`. It does not go to `Done`. Ever.

### 4. Review your own work

Run `/code-review` on the diff, and **act on what it finds** before opening the PR. You are the
only reviewer this code gets before a tired human looks at it. A PR that ships with a bug your
own review flagged is worse than no PR — it teaches the user not to trust the night run.

### 5. Ship it

Commit with the ticket key. Push the branch. Open a PR titled `METH-50: <summary>` so JIRA links
it. Transition the ticket to **`In Review`**.

### 6. Leave the audit trail

Comment on the ticket — this is what makes the night reconstructable:

```markdown
> *Built unattended by /night-work.*

**Outcome:** PR #142 open, ready for review.
**Sub-tasks:** 5 of 5 done.
**Tests:** 14 added, full suite green (226 passing).
**Notes:** <anything the reviewer should know — a judgment you had to make inside the
PRD's boundaries, something surprising in the code, a shortcut you took and why.>
```

### 7. Reset and go again

`git switch main`, confirm the tree is clean, take the next ticket.

---

## When a ticket goes wrong

**Stop the ticket. Do not force it.** Then:

1. **Leave the branch.** Don't delete it, don't reset it — it's evidence, and the user may
   want to see how far you got. Push it if there's anything worth seeing.
2. **Move the ticket to `On Deck`.** It needs a human now. That's what the column is for.
3. **Comment precisely.** Not "couldn't complete this." The user needs to unblock it in two
   minutes without rerunning your night:

   ```markdown
   > *Attempted unattended by /night-work — stopped, needs you.*

   **Stopped at:** sub-task 3 of 5, "surface the verification error inline."
   **Why:** The PRD doesn't say where the error should appear, and there are three plausible
   places in the signup flow. Any choice I made would be a design decision you didn't make.
   **Done so far:** sub-tasks 1–2 are complete and committed on branch `METH-48-inline-errors`.
   **What I need from you:** just tell me where the error goes; the rest is mechanical.
   ```
4. **Next ticket.** One bad ticket must not burn the night.

**Two consecutive failures → abort the run.** Two in a row is not bad luck, it's systemic —
the build is broken, a dependency moved, something is wrong with the machine. Stop, report,
don't thrash for six hours.

---

## The never list

These are not guidelines. An unattended agent that breaks one of these does damage that
outlives the night.

- **Never merge a PR.** The user is the merge gate. Always.
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

1. **The verdict.** One line. *"3 attempted, 2 landed, 1 stopped and needs you."*
2. **What needs you** — the stalled tickets, and for each: exactly where it stopped, the
   question that stopped it, and how far it got. **This is the most valuable section in the
   file.** Write it so the user can unblock it in two minutes.
3. **What's ready to review** — the PRs, each with what it does, what changed, what tests were
   added, and anything you'd want a reviewer to look at hardest. Be honest about the shaky bits;
   you are the only one who knows where they are.
4. **What happened** — the run, ticket by ticket, in order. The narrative.
5. **What I noticed but didn't act on** — things you saw in the code that aren't this ticket's
   job. Candidate `To Plan` tickets. Don't file them; just surface them. Filing work the user
   didn't ask for is its own kind of guessing.

**Write it like a colleague's handover note, not a build log.** Timestamps and command output
are noise. What the user wants at 8am is: *what do I need to do, and can I trust what you did?*

Answer both, plainly. Including — especially — where the answer is "don't trust this bit."
