---
name: design-prototype
description: Write the prompt to paste into Claude Design for a new feature or a style rework, starting from scratch. Gathers the job from a ticket or the conversation, pins down what is real so the design does not invent a second version of the model, and saves the prompt to docs/design/ so design-pull can read back what was asked for. Use when the user says "/design-prototype", "design this in Claude Design", "write me a Claude Design prompt", or is about to rework a page. Not the same as /prototype, which writes throwaway code in the repo.
---

# Design prototype

The user is building a new feature, or reworking something regardless of what it
looks like today. This skill does not design it. It writes the **prompt they
paste into Claude Design**, and then it stops.

Everything hard about this skill is one problem: Claude Design cannot see the
repo. It knows the design system and nothing else. So every fact it is not given
it will invent — and an invented fact comes home looking exactly like a design
decision. That is `design-pull`'s worst failure, and this is where it gets
prevented, at source.

**Read `.claude/design.json` first** for the component source, the gallery and
the design system id. **Run `design-sync` Pass 1 before you start**, so the
design gets drawn against current tokens. Pass 1 only.

## Find out what is being built

From the ticket if there is one, from the conversation if there isn't. Read the
ticket including its PRD and its comments — the comments are usually where the
real requirement ended up.

Then read the code around it. Not to design it, to answer three questions:

1. **What data does this actually touch?** The real field names, the real
   allowed values, the real limits.
2. **What already exists that this should look like?** A sibling page, a card
   doing nearly this job.
3. **What is genuinely unsettled?** The part the user cannot picture yet. That
   is the only part Claude Design should be inventing.

If a ticket says nothing about the look and the conversation hasn't either, ask
one question: what is wrong with it now, or what should a person be able to do
that they can't. Do not ask for layout preferences — that is the job being
handed to Claude Design.

## What goes in the prompt

Six sections, in this order. Write it as prose the user can paste whole.

**1. The job.** One paragraph. Who opens this screen, what they came to do, and
what makes it hard today. No layout, no components, no adjectives about
aesthetics. If you find yourself describing a two-column grid, delete it — you
have started doing the work you are supposed to be commissioning.

**2. What is real — use these, do not invent.** The load-bearing section.

List the actual domain nouns from `CONTEXT.md`, with their actual values:

- Every value of a closed set, in full. Six tag names means all six, spelled the
  way the app spells them. Give it five and it will invent a sixth.
- Real records. Real names, real hymn titles, a real date in the real format.
  Never `Item 1`, never Lorem.
- The real limits. If a title truncates at 60 characters, include a title that
  is 58 characters long, because that is the one that breaks the layout.
- The states that exist: empty, loading, one, many, error, and whatever this
  screen's own bad day looks like.

Say plainly: *these are the real values from the product; use them exactly, and
if you need something not on this list, mark it as a suggestion.* That line is
what makes the difference between a design that pulls cleanly and a design that
needs an argument.

**3. Compose from these.** Name the component classes the design system already
has and that this screen should use — `m-btn`, `m-row`, `m-card`, whatever fits.
Read them from `components.source`; do not list from memory. Point at the
gallery for the full set.

Then the line that matters more: **if none of them fit, say so and design the
new thing — do not force it into an existing component.** A real new primitive
is a good outcome. A `m-card` bent into a shape it was never meant for is not,
and it will be much harder to spot on the way back.

**4. What is open.** Where Claude Design should have opinions. Be specific —
"the whole thing" is not a brief. This section is the counterweight to section
2: it tells the design where invention is wanted, so that invention arrives
labelled instead of smuggled.

**5. Constraints.** Short. Tokens only, no raw colour. The project's icon set,
named from the design system's rules — check it, do not assume. Both a phone
width and a desktop width, because the repo ships both. Anything the ticket
fixes as non-negotiable.

**6. What to send back.** Ask for the export prompt, plus a note on anything it
placeholdered. A design that flags its own guesses saves the entire grilling
session.

## Save it

Write the prompt to `docs/design/<slug>-prompt.md` and commit it. Head it with
the ticket key and the date. `design-pull` reads this file to work out what was
asked for versus what came back, and the two are rarely the same — which is
usually the point.

Then print it in one code block for copying, and say which sections you inferred
rather than read, so the user can correct a wrong assumption before it is drawn
in.

## Rules

- **Do not design it.** If the prompt contains your layout, you will get your
  layout back and the exercise was pointless.
- **Never invent a domain fact to fill a gap.** Look it up, or leave it out and
  say the prompt has a hole in it. A plausible wrong field name is worse than a
  missing one — it survives all the way to the code.
- **Real data or no data.** Placeholder content hides every layout problem worth
  finding.
- **One screen, or one clearly bounded flow.** A prompt covering four pages
  comes back as four half-designs.
- **Stop after writing the prompt.** The user goes to Claude Design. Do not
  start implementing anything.
