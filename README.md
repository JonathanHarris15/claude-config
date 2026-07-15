# .claude

My personal Claude Code configuration, synced across machines.

## What's in here

| Path | What it is |
| --- | --- |
| `skills/` | Custom skills — a JIRA-native planning chain (`create-epic` → `grill-with-docs` → `to-prd` → `to-issues` → `implement`), plus `tdd`, `diagnose`, `prototype`, `research`, `triage`, `improve-codebase-architecture`, `rebuild-mobile`. |
| `agents/` | Custom subagents. Markdown with frontmatter; the frontmatter sets the model, tools, and description. |
| `workflows/` | Multi-agent orchestration scripts. Plain JS that fans out subagents with real control flow — loops, pipelines, adversarial verification. |
| `commands/` | Custom slash commands. |
| `settings.json` | Global settings: effort level, theme, permission allowlist, hooks. |
| `CLAUDE.md` | Instructions prepended to every session, in every project, on every machine. |

## The JIRA workflow

The skills in here are not a grab-bag — most of them are one workflow, and **the JIRA
board is its spine**. Every piece of work lives on the board, and the skills move it
across the board rather than working alongside it.

### The board

Seven columns. **Only level-0 tickets ride it** — Epics group them (never a card),
sub-tasks live inside a card (never a card of their own).

```
To Plan  →  To Do  →  On Deck  →  Night Work  →  In Progress  →  In Review  →  Done
```

- **To Plan** — the inbox. Anything, at any stage. A title you scratched down mid-feature
  is as welcome as a fully-argued proposal.
- **To Do / On Deck / Night Work** — specced and ready. `On Deck` has judgment left in it
  and is *yours*; `Night Work` is AFK-safe and an agent can grind it unattended.
- **In Progress / In Review / Done** — being built.

**The rule that makes it worth trusting: nothing sits right of `To Plan` without a PRD
on it.** Those columns are a promise that the thinking is finished. `jira-doctor` sweeps
anything that breaks the promise back to the inbox.

The full contract is [`skills/jira-doctor/BOARD.md`](skills/jira-doctor/BOARD.md).

### Using it in a project

```sh
/jira-setup          # once per project — links the repo to a JIRA project,
                     # discovers what its issue types are really called,
                     # writes a Jira block into the project's CLAUDE.md
/jira-doctor         # audit the board; run it whenever things look wrong

/plan-ticket METH-48 # take one ticket from To Plan onto the board
/plan-ticket ALL     # queue up and work the whole To Plan column
/implement METH-48   # build a ticket that's ready

/night-work          # before bed: drain the Night Work column, a PR per ticket
```

Everything downstream keys off the `<!-- jira-config -->` block that `jira-setup` writes.
No site, project key, issue-type name or status is hardcoded in any skill — they're all
discovered per-project, which is what lets you clone this repo into someone else's JIRA
and have it work.

### How planning actually happens

`/plan-ticket` is the front door, and its real job is **reading what you handed it** before
it starts working. A `To Plan` ticket might be one line or five paragraphs; it might be one
feature or a whole quarter. So it reads two dials — *how big* and *how formed* — and routes:

```
                ┌─ a whole project?  → /create-epic  (its Features land back in To Plan)
                │
   To Plan  ────┼─ a bug?            → /diagnose     (reproduce before you spec)
    ticket      │
                ├─ no idea what I want → /workshop  ─┐
                ├─ vague, need facts    → /research  ─┼─→ /grill-with-docs
                ├─ I know what I want   → /grill-with-docs
                └─ already sharp  ───────────────────┘
                                                     │
                              /to-prd → /to-issues ──┘
                                        │
                                        └─→ AFK-safe? → Night Work
                                            judgment?  → On Deck
                                            else       → To Do
```

The lanes flow into each other — a workshop that hits a factual unknown hands to research,
research hands to grill. Passing through two or three is normal.

`workshop` is the one worth knowing about: it's for when the ticket names a *feeling* rather
than a change. `grill-with-docs` interrogates a plan you have; `workshop` is for when you
don't have one, so Claude pitches three genuinely different framings and you react. Much
easier to say "not that, but that bit yes" than to invent something from nothing.

### The night agent

`/night-work`, run before bed, drains the `Night Work` column: one ticket at a time, each on
its own branch off `main`, each ending in a PR. In the morning there's a comment on every
ticket it touched and an HTML report of the night.

It is built around one idea:

> **A blocked ticket in the morning is a fine outcome. A guessed one is not.**

You can unblock a stalled ticket over coffee in two minutes. You cannot easily undo a
plausible-looking PR built on a decision it invented at 3am and never mentioned — because it
*looks* finished, so it gets reviewed as if it were. So when the PRD doesn't answer something,
it does not pick the sensible option. It stops that ticket, moves it to `On Deck`, says exactly
what it needed, and takes the next one.

It refuses to start on a red test suite (you cannot detect a regression against a broken
baseline), it never touches `On Deck`, it never merges its own PR, and it will not weaken a
test to make it pass — a failing test it didn't expect is a **stop**, not an obstacle.

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
