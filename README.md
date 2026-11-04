# .claude

My personal Claude Code configuration, synced across machines.

## What's in here

| Path | What it is |
| --- | --- |
| `skills/` | Custom skills — a JIRA-native planning chain (`create-epic` → `plan-ticket` → `grill-with-docs` → `to-prd` → `to-issues` → `implement` → `review`), plus the two pieces `grill-with-docs` composes (`grilling`, `domain-modeling`), the design chain (`design-prototype`, `design-push`, `design-pull`, `design-sync`), and `tdd`, `diagnose`, `prototype`, `research`, `codebase-design`, `improve-codebase-architecture`, `wizard`, `writing-for-agents`, `retro`, `sync-config`, `wait-what`. |
| `agents/` | Custom subagents. Markdown with frontmatter; the frontmatter sets the model, tools, and description. |
| `workflows/` | Multi-agent orchestration scripts. Plain JS that fans out subagents with real control flow — loops, pipelines, adversarial verification. |
| `commands/` | Custom slash commands. |
| `mods/` | Mods — code that changes Claude's own interface. `config-map` is a pane listing every skill on the machine and the whole config folder, marking what this repo tracks. |
| `settings.json` | Global settings: effort level, theme, permission allowlist, hooks, and the `CLAUDE_CODE_PLUGIN_DIRS` that loads the mods. |
| `CLAUDE.md` | Instructions prepended to every session, in every project, on every machine. |

## The JIRA workflow

The skills in here are not a grab-bag — most of them are one workflow, and **the JIRA
board is its spine**. Every piece of work lives on the board, and the skills move it
across the board rather than working alongside it.

### The board

Six columns. **Only level-0 tickets ride it** — Epics group them (never a card),
sub-tasks live inside a card (never a card of their own).

```
To Plan  →  To Do  →  On Deck  →  In Progress  →  In Review  →  Done
```

- **To Plan** — the inbox. Anything, at any stage. A title you scratched down mid-feature
  is as welcome as a fully-argued proposal.
- **To Do / On Deck** — specced and ready. `To Do` means the next step is buildable without
  you; `On Deck` has judgment left in it and is *yours*.
- **In Progress / In Review / Done** — being built.

**The rule that makes it worth trusting: nothing sits right of `To Plan` without a PRD
on it.** Those columns are a promise that the thinking is finished. The rule is upheld at
the doors — `plan-ticket` won't land a ticket without one, `implement` won't build one.

The full contract is [`skills/plan-ticket/BOARD.md`](skills/plan-ticket/BOARD.md) — what the
columns and levels mean. [`skills/plan-ticket/JIRA.md`](skills/plan-ticket/JIRA.md) is the
other half: how the skills actually touch JIRA. Both are shared reference, not skills.

### Using it in a project

```sh
/plan-ticket METH-48 # take one ticket from To Plan onto the board
/plan-ticket 10      # plan the 10 smallest, cheapest first
/plan-ticket ALL     # queue up and work the whole To Plan column
/implement METH-48   # build a ticket that's ready
/implement 6         # build 6 decision-free tickets unattended, one PR back
/implement ALL       # same, for everything eligible
```

**The small-ticket loop.** Client reports and errors arrive constantly and most are tiny.
`/plan-ticket 10` reads the column, sorts smallest first, and pushes anything genuinely
trivial — an obvious fix with nothing left to decide, landing in one commit — down a fast
lane: a two-line PRD, a `trivial` label, no sub-tasks, straight to `To Do`. A typo does not
get thirty minutes of planning. Then `/implement ALL` builds every one of them back to back
and hands you a single PR with one commit per ticket, so you can drop any one of them on its
own. Anything that surprises it gets parked on the board with a note and the run carries on.

The bar for trivial is deliberately strict: if there is one thing worth asking you, it isn't
trivial and it goes down the normal lane instead.

No site, project key, issue-type name or status is hardcoded in any skill. They're read
from a `<!-- jira-config -->` block in the project's own `CLAUDE.md`, and if there isn't
one, `plan-ticket` discovers them from JIRA on its first run and offers to write the block
for next time. That's what lets you clone this repo into someone else's JIRA and have it
work.

### How planning actually happens

`/plan-ticket` is the front door, and its real job is **reading what you handed it** before
it starts working. A `To Plan` ticket might be one line or five paragraphs; it might be one
feature or a whole quarter. So it reads two dials — *how big* and *how formed* — and routes:

```
                ┌─ a whole project?  → /create-epic  (its Features land back in To Plan)
                │
   To Plan  ────┼─ a bug?            → /diagnose     (reproduce before you spec)
    ticket      │
                ├─ vague, need facts    → /research  ─┐
                ├─ unsure how it feels  → /prototype ─┼─→ /grill-with-docs
                ├─ I know what I want   → /grill-with-docs
                └─ already sharp  ───────────────────┘
                                                     │
                              /to-prd → /to-issues ──┘
                                        │
                                        └─→ next step buildable? → To Do
                                            needs your judgment?  → On Deck
```

The lanes flow into each other — a grilling that hits a factual unknown hands to research,
research hands back to grill. Passing through two or three is normal.

`grill-with-docs` is the default and does most of the work. When a ticket is pure fog — it
names a *feeling* rather than a change — the grilling just starts a step wider: Claude puts
two or three genuinely different readings of the ticket in front of you and says which it
would back, because reacting is far easier than inventing.

### Stopping beats guessing

`/implement` is built around one idea:

> **A blocked ticket is a fine outcome. A guessed one is not.**

You can unblock a stalled ticket in two minutes. You cannot easily undo a plausible-looking
PR built on a decision it invented and never mentioned — because it *looks* finished, so it
gets reviewed as if it were. So when the PRD doesn't answer something, it does not pick the
sensible option. It stops, moves the ticket to `On Deck`, and says exactly what it needed.

It refuses to start on a red test suite (you cannot detect a regression against a broken
baseline), it never merges its own PR, and it will not weaken a test to make it pass — a
failing test it didn't expect is a **stop**, not an obstacle.

## Mods

A mod is a plugin that changes Claude's own interface rather than what it knows —
a pane beside the chat, a row above the prompt, a hook on tool calls. Each one is
a folder under `mods/`, and `settings.json` loads them by naming them in
`CLAUDE_CODE_PLUGIN_DIRS`. The path uses `~`, so the same setting works on
Windows and Mac.

**`config-map`** answers "what have I actually got, and which of it survives a new
machine?" It opens a pane with two views:

- **Skills** — every skill on the machine, in four groups: the ones in this repo
  (so they're on every machine), the ones only on this machine (the `twg-*` ones
  the `twg` installer writes, which the allowlist leaves out on purpose), the ones
  claude.ai syncs down from the customize tab, and the ones plugins bring. Each
  group opens and closes. A row is the skill's name and nothing else — the pane
  is narrow, and a half-sentence cut off mid-word is worse than no sentence.
  Click one and it opens where it sits, under its own row: what it does in full,
  read out of its own `SKILL.md`, where it lives, and what you can do with it.
- **Config** — everything at the top of `~/.claude`, split into what the repo
  tracks and what it doesn't, each with a plain-words note saying what it is.

The descriptions come in a second pass, so the list is there to read before all
hundred-odd `SKILL.md` files have been opened. The filter searches them even
though no row shows one.

The header shows the branch, how many files are tracked, and whether anything is
uncommitted, and under it a slim bar: one band per group, as wide as that group's
share of every skill, solid for the part the repo holds and faint for the part it
doesn't. Each group header wears the same colour, so the bar and the list read as
one thing. The bands grow out of nothing the first time the bar draws, one just
after another — that one runs inside the vector frame, so it is a real ease
rather than the stepped count the groups unroll with. Under the bar, the fact in
words — "24 of 93 skills travel with you" —
which is also all the terminal shows, having no vectors to draw.

A filled dot marks anything the repo holds and a hollow one anything
it doesn't, so the whole list is scannable without reading a word. There's a
filter field where the surface has one — type a name or a few words from a
description, and every group opens to show what matched. `/config-map` reopens
the pane; `refresh` re-reads the disk.

Groups roll open and shut rather than snapping. No element takes a height or an
opacity, so there is no transition to ask for — the pane steps the number of rows
it draws over six frames instead, about 110ms, easing out on the way open and in
on the way shut. The list arrives in order; it does not slide.

The pane draws itself from whichever surface it's on, so it is not one design:
the desktop app gets real type sizes, borders and hover highlighting, while the
terminal gets the same tree in one size. Anything surface-specific — the filter
field, which the mobile app has no control for yet, and the bar, which the
terminal cannot draw — is drawn only where it exists.

**Why it isn't desktop-only.** Dropping a surface would buy almost nothing. The
mobile app is short of exactly two elements, a text field and a dropdown, and
the pane only wants the first. The one element worth having that needs the
desktop alone is `Client`, a region the mod draws itself with its own frame
clock — real animation — but it draws in character cells with the terminal's
tags, so it would cost the type sizes, borders and hover highlighting the pane
is built on. Not a trade worth making for a tree that opens and shuts.

**Putting a skill in the repo.** Pick an untracked skill and the pane offers to
add it, which means one of two things depending on where the skill lives:

- One already sitting in `skills/` — the `twg-*` ones — is **tracked where it
  is**. Nothing moves; the pane appends an explicit `!skills/<name>/` pair under
  a marker comment, so the allowlist stays an allowlist with one more named
  exception.
- One the app or a plugin owns is **copied into `skills/<name>/`**, and the
  original stays where it is. Tracking those in place would put git and the
  thing that writes them in a fight over the same folder. The engine writes
  text and not bytes, so a binary file (a font, an image) is left behind and
  named rather than half-copied.

Either way the result is staged, not committed — `/sync-config` commits and
pushes it, so nothing leaves the machine without you looking at it first.

Its own folder holds the whole mod: `plugin.json` names it, `hooks/register.tsx`
is the code, `types/index.d.ts` declares the values it keeps between draws, and
`tests/` is run with `claude plugin test mods/config-map`. The engine writes a
`.claude-plugin/types/` beside it at every load, naming the build; that stays
untracked, since each machine regenerates it.

## The .gitignore is an allowlist, on purpose

It starts with `*` — ignore everything — and then explicitly un-ignores the
handful of paths above.

This is deliberate and worth preserving. Claude Code treats `~/.claude` as its
working directory: it stores your OAuth token in `.credentials.json`, full
session transcripts in `projects/` (~276MB, containing source from every project
you've touched), file snapshots in `file-history/`, and it adds new state
directories as it updates.

A denylist would silently start publishing each new state directory the day it
appears. An allowlist fails the other way: the worst case is that you forget to
sync something, not that you publish your credentials. **If you add new config,
add it to the allowlist explicitly. Don't flip the file to a denylist.**

Before your first push after any change to `.gitignore`:

```sh
git add -An --dry-run .        # exactly what would be tracked — read every line
git check-ignore -v .credentials.json history.jsonl projects/
```

Note that `~/.claude.json` — one level *up*, outside this repo — holds your user
ID, machine ID, prompt history, and MCP server configs (which often contain API
keys). It's out of scope here and should stay that way.

## Setting up a second machine

`git clone` won't work: Claude Code has already created `~/.claude` and put
things in it, and clone refuses a non-empty target. Attach the repo to the
existing directory instead.

```sh
cd ~/.claude

# Move aside anything the repo will bring, so checkout can't clobber local work.
mv settings.json settings.json.local 2>/dev/null
mv skills skills.local 2>/dev/null

git init
git remote add origin git@github.com:USER/REPO.git
git fetch origin
git checkout -b main --track origin/main
```

Then diff the `.local` copies back in if they held anything you wanted, and
delete them. `settings.local.json` is machine-local by design — it stays
untracked, and each machine keeps its own.

## Keeping in sync

`git pull` in `~/.claude`. Claude Code reads these files on session start, so
restart any running session to pick up changes.
