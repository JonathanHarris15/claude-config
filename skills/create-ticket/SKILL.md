---
name: create-ticket
description: File one new ticket into the To Plan column of whatever tracker the project uses — a scratch idea, a bug you just hit, a follow-up you noticed mid-feature — without planning it. Captures enough context that /plan-ticket can pick it up cold later. Use when the user says "make a ticket", "file this", "add a bug for", "remind me to", or wants to jot something down without leaving the session. For a whole project, use create-epic.
argument-hint: "What the ticket is about — a sentence is fine. Add 'bug' if it's a bug, or an epic name to file it under"
---

# Create Ticket

**One thing in, one ticket out, in `To Plan`.** Capture, don't plan. The thinking happens later in
`/plan-ticket`, so this should take a minute, not ten.

Read [BOARD.md](../tracker/BOARD.md) for what a ticket is. Load the **tracker** skill to find where
this project keeps tickets, then use its backend file for every call.

## 1. Read what you were given

From the argument and the conversation so far, work out:

- **The title** — what the change or problem is, in a few plain words. Not "fix stuff".
- **The type** — `Bug` if something is broken, otherwise the project's usual level-0 type.
  Use the real type names the tracker gives.
- **The epic** — only if the user named one, or the conversation makes it obvious. Don't invent one.

**Is it really one ticket?** If it's a whole project — several demoable pieces, "and then also…" —
say so and offer `/create-epic` instead. If it's two unrelated things, file two tickets.

Ask nothing unless you can't write a title. One question at most.

## 2. Write a body that survives a cold read

Whoever plans this later — usually you, in a fresh session — won't have this conversation. Write
down what they'd otherwise lose:

```md
## What

{One to three sentences: what's wrong or wanted, in plain words.}

## Context

{Where it came from and what you already know: the file or screen, the error text, the steps
that showed it, the ticket or PR you were working on when it came up. Leave out what you'd only
be guessing.}
```

For a bug, include the exact error and how to see it, if you have them. **Don't diagnose and
don't propose a fix** — that's `/diagnose` and `/plan-ticket`. No `## Problem Statement` or
`## Acceptance Criteria` headings either: those mark a PRD, and a ticket in `To Plan` doesn't have
one yet.

## 3. File it

Create the ticket in **`To Plan`**, with its type and epic if it has them. Never anywhere further
right: [BOARD.md](../tracker/BOARD.md) forbids an unspecced ticket past `To Plan`.

If it's an **investigation** — a question to answer, not a thing to build — prefix the title
`[research]`, `[prototype]`, `[grill]` or `[task]` and mark it as an investigation.

## 4. Report and stop

One line: the key, the title, and the link. Then go back to whatever you were doing.

Offer `/plan-ticket <KEY>` only if the user seems to want it planned now.
