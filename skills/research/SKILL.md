---
name: research
description: Investigate a question against high-trust primary sources and capture the findings where the project keeps its write-ups. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent — and the resolver for [research] investigation tickets.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings as one document, citing each claim's source.
3. Save it per the project's **Docs** switch (see [the tracker skill](../tracker/SKILL.md)). On `repo`, match where the repo already keeps such notes, and if there is none, put it somewhere sensible and say where. Anywhere else, it's a research page in that tool: pass the agent the backend file and whatever IDs it needs from the config block.

When this resolves a `[research]` investigation ticket (see `create-epic`), post the **decision** the research supports as a comment on the ticket and link the findings — the ticket's output is a decision, not just a document.
