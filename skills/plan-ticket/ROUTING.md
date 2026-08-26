# Routing a `To Plan` ticket

The shared judgment call. `plan-ticket` uses it to route one ticket; `create-epic`
uses the same two dials to decide whether each ticket it emits is a buildable
Feature or a question that has to be answered first.
Keep them in step — if you change the thinking here, both skills inherit it.

Read the ticket, then read **two dials, in this order**. Size first: there is no
point classifying the fog on something that turns out to be a whole project.

---

## Dial 1 — Size: is this even one ticket?

> **Could this ship as a single coherent, demoable slice?**

| Read | Meaning | Route |
| --- | --- | --- |
| **One deliverable** | A vertical slice — thin path through the layers, demoable on its own. | Continue to Dial 2. |
| **A project** | Several demoable checkpoints. You catch yourself saying "and then also…" more than twice. Or it has phases. | **Escalate to `/create-epic`.** |
| **A pile** | Two or three *unrelated* things you jotted in one line. | **Split it.** Create the siblings in `To Plan`, then route each. |

**Escalating to `/create-epic`** means: the `To Plan` ticket is not the work, it's
the *seed of a project*. Run `create-epic` with it. The epic it produces becomes
the parent; the Features it emits land back in `To Plan` as fresh tickets, each of
which will come through `plan-ticket` on its own. Then **close the original ticket**
with a comment linking the new epic — it has done its job.

Don't be precious about this. A one-line scratch note genuinely can be a quarter of
work, and quietly speccing it as a single ticket is how you get a "Feature" with
eleven sub-tasks and a two-week tail.

**Placement.** While you're here: if the ticket is one deliverable but has **no epic
parent**, ask which epic it belongs under — or whether it's genuinely standalone
(bugs and small chores usually are). Don't invent an epic for a one-off.

---

## Dial 2 — Clarity: how much fog is left?

> **If I sat down to write the PRD right now, what would stop me?**

The four lanes are a spectrum, and they **flow into each other** — a grilling that
uncovers a factual unknown hands to research; research that resolves it hands back
to grill. It is normal for one ticket to pass through two or three.

### 🌫️ Fog — "I don't know what I want" → `/grill-with-docs`, opened wide

**Signals:** The ticket is a title and nothing else. It names a *feeling* ("the
onboarding is rough") rather than a change. You wrote it to stop thinking about it.
You cannot say what "done" looks like. Asked to describe the feature, you describe
the annoyance.

**What it needs:** The same grilling, started a step earlier. There is no plan to
interrogate yet, so the first questions are about *what the change even is* — and
because a fog ticket gives you nothing to push against, you must **lead with your
own reading**: name the two or three genuinely different things the ticket could
mean, say which you'd back and why, and let the user react. Reacting is far easier
than inventing. Only once the change has a name do you start sharpening it against
`CONTEXT.md`.

**Say you're doing this.** "This is fog, so I'm starting wider than usual" is worth
a sentence — otherwise the grilling looks like it's missing the point.

**Exit when:** You can name the change in a sentence, and it survives one challenge.
Then carry on grilling it normally.

### 🔍 Unknowns — "I know roughly what I want, but not whether it's possible" → `/research`

**Signals:** The shape is clear but rests on a fact you don't have. Does the API
support this? Is this library maintained? How does the platform actually behave
here? A build-vs-buy call is genuinely open. You're guessing at a constraint.

**What it needs:** Facts from primary sources, before design. That's `research`.
If the unknown is about *feel* rather than fact — "would this even be nice to use?"
— it's `/prototype`, not research.

**Exit when:** The unknowns are answered and written down. Then usually → `grill`.

### 🎯 Sharp — "I know what I want, I just haven't said it precisely" → `/grill-with-docs`

**Signals:** You can describe the feature. The work is getting it *out of your head*
and pinned against the domain model — sharpening terms, resolving edge cases, finding
the decisions you didn't notice you were making.

**What it needs:** Relentless one-at-a-time interrogation against `CONTEXT.md` and
the ADRs. That's `grill-with-docs`. **This is the default lane** — most tickets that
aren't fog and aren't blocked on a fact land here.

**Exit when:** No question left that would change the PRD.

### ✅ Specced — "this is already sharp" → straight to `to-prd`

**Signals:** You wrote this one carefully. It has a problem statement, a described
solution, and criteria you could test. There is genuinely nothing left to ask.

**Be suspicious of this lane.** A long ticket is not a sharp one. The test is not
"is there a lot of text" — it's **"can I find a question whose answer would change
the PRD?"** Look for one honestly. If you find one, it's not this lane; it's `grill`.
Say so, and say what the question was.

### 🐞 Bug — any ticket typed `Bug` → `/diagnose` first

Bugs bypass the clarity dial. You cannot spec a fix for something you haven't
reproduced. Run `/diagnose` to reproduce and find the cause, *then* come back and
route on clarity — usually the cause makes the fix obvious enough to go straight to
`to-prd`. If it isn't reproducible, park it in `To Plan` with what you found and
say what you need.

---

## After the lane: everything converges

Whatever lane a ticket took, it ends the same way:

```
   → /to-prd      (PRD written onto the ticket's own description)
   → /to-issues   (real sub-tasks created under it)
   → land it      (To Do / On Deck — see BOARD.md)
```

The lane is *how the fog cleared*. The convergence is *how it gets on the board*.
No ticket leaves `To Plan` without passing through both.
