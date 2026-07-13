---
name: workshop
description: Collaborative idea session for when you don't know what you want yet — Claude pitches genuinely different framings of the problem, you react, and the shape emerges from the back-and-forth. Use when a ticket names a feeling rather than a change, when you can't say what done looks like, or when you say "I don't know, workshop it with me". The divergent counterpart to grill-with-docs, which interrogates a plan you already have.
argument-hint: "The itch — a ticket key, or just a rough sentence"
---

# Workshop

**The left end of the planning spectrum.** `grill-with-docs` interrogates a plan you already
have. `workshop` is for when **there is no plan** — only an itch. You wrote something down to
stop thinking about it, and now you have to think about it.

You cannot interrogate someone about a plan they don't have. Asking "what should the retry
policy be?" of a person who hasn't decided they want retries just produces a made-up answer
they'll feel committed to. So this skill inverts the usual move:

> **You pitch. I react. The shape emerges from the friction.**

Claude does the generative work here. That is the whole point — it is much easier to say
*"no, not that — but that bit, yes"* than to produce an idea from nothing.

## Phase 1: Find the itch

Before proposing anything, find out what actually happened. An idea gets written down for a
reason and the reason is usually more specific than the note.

Ask — and genuinely wait for the answer:

- **"What were you doing when you wrote this?"** The trigger is the most under-used piece of
  evidence there is. Someone writes "onboarding is rough" *right after* watching a friend get
  stuck on the email verification step. The note lost that; the memory hasn't.
- **"What does the annoyance actually feel like?"** Not the fix — the pain. Let them complain.
- **"Who is it happening to?"** You, a user, a future maintainer? Different answers, different
  projects.

**Then go read the code** before you pitch. A vague itch usually maps to two or three concrete
places in the repo, and knowing which they are is what separates a real pitch from a plausible
one. Read `CONTEXT.md` and `docs/adr/` too — pitch in *their* language, and if the itch has no
word in the glossary, that absence is itself interesting. Say so.

## Phase 2: Pitch three

Put **three genuinely different framings** in front of them. Then shut up and let them react.

**Different means different.** Three flavours of the same idea is not a workshop, it's a menu,
and it will quietly railroad them into the framing you happened to pick first. Make the three
disagree with each other about **what the problem even is**:

- One that takes the complaint at face value and fixes it directly.
- One that goes **upstream** — solves the cause rather than the symptom, possibly by deleting
  something rather than adding it.
- One that is **bigger or stranger** than they asked for — reframes the whole thing. This is
  the one that earns its keep. It's usually rejected, and the *rejection* is what tells you
  where the real boundary is.

For each, in a few lines: **what it is**, **what it's really claiming the problem is**, and
**what it costs**. Keep them concrete — a pitch you can't picture isn't a pitch. Have an
opinion and say which you'd back and why; a workshop where Claude has no preference is just
a form.

**Then stop and let them react.** Do not proceed to build on your own favourite.

## Phase 3: React, cut, re-pitch

They'll rarely pick one clean. Expect *"the second one, but not the deleting part"* — that's
the workshop working. Your job:

- **Take the fragments seriously.** "That bit, yes" is a real signal. Name what they kept.
- **Reflect it back sharpened.** "So you want X but not Y — which means the problem is really
  Z. Yes?" Making the implied problem statement explicit is most of the value here.
- **Watch for the thing they keep circling.** People return to what actually matters to them,
  often while insisting it's a side point. Name it when you see it.
- **Re-pitch on the new frame.** Two or three rounds is normal. Each round should get *narrower*
   — if round three is as broad as round one, you're not converging; say so and change tack.

**When to change tack:**

- **They can't choose between two, and it's about how it would *feel*** → stop guessing.
  `/prototype` — a rough thing they can poke beats another round of argument.
- **They can't choose because a *fact* is missing** ("does the API even let us?") → `/research`.
  Don't design on top of a guess.
- **They're now arguing about *how*, not *what*** → the workshop is **over**. That argument
  belongs in `grill-with-docs`. Say so and move.

## Phase 4: Land it

Exit when they can say the change in **one sentence**, and it survives one challenge from you.
Challenge it — a workshopped idea that hasn't been pushed on once is just enthusiasm.

Then:

1. **Write it back onto the ticket** — replace the fog with the sentence, the problem it solves,
   and (important) the framings you **rejected and why**. That's the most expensive thing this
   session produced and it's the first thing that gets forgotten. Six weeks from now someone,
   probably you, will suggest the deleted option again.
2. **Update `CONTEXT.md`** if the session coined or sharpened a term. Glossary only — no plan,
   no implementation detail.
3. **Hand off to `/grill-with-docs`.** The shape is known; now it gets sharpened. If you were
   invoked from `/plan-ticket`, return to it and carry on.

## What this skill must not do

- **Don't converge early.** If they agree with your first pitch immediately, be suspicious —
  push the strangest option once more. Instant agreement often means they're being agreeable.
- **Don't ask open questions into a void.** "What do you want it to do?" is the question they
  already couldn't answer — that's why they're here. Convert every such question into a
  proposal they can reject.
- **Don't interrogate.** That's `grill-with-docs`, and running it too early on fog produces
  confident nonsense: precise answers to questions the user hadn't decided the answers to.
- **Don't write a PRD.** Not yet. The output of a workshop is *a shape*, not a spec.
