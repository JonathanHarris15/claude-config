---
name: grill-with-docs
description: Grilling session that challenges your plan against the existing domain model, sharpens terminology, and updates documentation (CONTEXT.md, ADRs) inline as decisions crystallise. Use when user wants to stress-test a plan against their project's language and documented decisions.
---

# Grill With Docs

Run a **`/grilling`** session, using the **`/domain-modeling`** skill throughout.

That's the whole skill. `grilling` owns the interrogation — the design tree, the rounds,
the recommended answer on every question. `domain-modeling` owns the paperwork — challenging
terms against `CONTEXT.md`, sharpening fuzzy language, and writing the glossary and ADRs the
moment a decision crystallises rather than batching them to the end.

Two things this composition adds on top:

- **Docs are updated inline, not afterwards.** A term resolved in round three goes into
  `CONTEXT.md` in round three. Batched documentation is documentation that never happens.
- **When the plan is fog rather than a plan**, the first round has nothing to interrogate,
  so lead with your own reading: name the two or three genuinely different things the work
  could mean, say which you'd back and why, and let the user react. Reacting is far easier
  than inventing. Once the change has a name, grill it normally.
