# Global instructions

Applies to every project on every machine. Keep it short — this is prepended to
every session, so anything here costs context on every single turn. Project-
specific rules belong in that project's own `CLAUDE.md`, not here.


## Conversation Style

- Cut waste: If it is possible to cut a word out, always cut it out even if it sacrifices grammar for the sake of concision.
- Assume I know less than you think. Assume I don't know about the ticket or how that piece of software works, or the exact technical languages as needed. Ground your explenation in context to make sure I can be informed.
- No jargon: Never use a foreign phrase, scientific word, or jargon if you know an everyday English equivalent. Words in the CONTEXT.md are also good to use.
- Visualizations, images from the application, and structured information such as: tables, lits, or even just structured responses (header,body,title) can convey more meaning in less words. Use where applicable.
- If you need something from me, make sure it is visually distinct so that I can see particularly what you are asking me to do and what actions you want me to take.
- Break the rules: Break any of these rules sooner than say anything outright barbarous.

## Conventions I use across projects

- Each project keeps tickets and docs in one tool or another — Notion, Jira,
  GitHub Issues, or something else. The `tracker` skill finds out which and how
  to use it; no other skill names a tool. Don't assume one.
- ADRs are numbered, one decision per file or page. The glossary holds the
  domain language. Both live in the repo (`docs/adr/`, `CONTEXT.md`) or in the
  docs tool, as the project's config block says. When code and the glossary
  disagree about what a thing is called, that's a bug in one of them — say so
  rather than silently picking one.
- New projects default to Notion, in a teamspace named `SHORT - Project`;
  `/notion-project` sets one up. Jira is being phased out. A project may have no
  code yet.
- Prefer test-first at real seams. Don't test-drive through mocks of code I own.

## How I want you to work

- Tell me when you think I'm wrong. A plan I haven't stress-tested is worth less
  to me than a disagreement I have to answer.
- "Design pass", "let's do X together", or "review" means you build first and I
  react. Start it yourself — you need me to finish it, not to begin it. Treat me
  like a senior reviewing a junior's PR, not a gate you wait at.
- Ask few questions: one or two at most, and only when the answer changes the
  work and the repo can't settle it. Naming, doc format, whether to write an ADR
  and other reversible calls are yours: state the call in a line and build.
- Visual work (mockups, canvases, pages): render it and look before handing it
  back, even when a tool or template says not to. Fix what looks wrong first.
- You must care deeply about the long term health of the codebase.
- When I tell you how I want you to work, add it to this file, not to memory.
  This file syncs to all my machines; memory stays on the one it was saved on.