# .claude

My personal Claude Code configuration, synced across machines.

## What's in here

| Path | What it is |
| --- | --- |
| `skills/` | Custom skills — a ticket planning chain that works on Jira or Notion (`create-epic` → `plan-ticket` → `grill-with-docs` → `to-prd` → `to-issues` → `implement` → `review`), plus the two pieces `grill-with-docs` composes (`grilling`, `domain-modeling`), the design chain (`design-prototype`, `design-push`, `design-pull`, `design-sync`), and `tdd`, `diagnose`, `prototype`, `research`, `codebase-design`, `improve-codebase-architecture`, `wizard`, `writing-for-agents`, `retro`, `sync-config`, `wait-what`. |
| `agents/` | Custom subagents. Markdown with frontmatter; the frontmatter sets the model, tools, and description. |
| `workflows/` | Multi-agent orchestration scripts. Plain JS that fans out subagents with real control flow — loops, pipelines, adversarial verification. |
| `commands/` | Custom slash commands. |
| `mods/` | Mods — code that changes Claude's own interface. `config-map` is a button that opens the dashboard. |
| `dashboard/` | A local page for managing all of this, and for seeing how each thing syncs. |
| `settings.json` | Global settings: effort level, theme, permission allowlist, hooks, and the `CLAUDE_CODE_PLUGIN_DIRS` that loads the mods. |
| `CLAUDE.md` | Instructions prepended to every session, in every project, on every machine. |

## The ticket workflow

The skills in here are not a grab-bag — most of them are one workflow, and **the board
is its spine**, in Jira or Notion. Every piece of work lives on the board, and the skills move it
across the board rather than working alongside it.

### The board

Five columns. **Only level-0 tickets ride it** — Epics group them (never a card),
sub-tasks live inside a card (never a card of their own).

```
To Plan  →  To Do  →  In Progress  →  In Review  →  Done
```

- **To Plan** — the inbox. Anything, at any stage. A title you scratched down mid-feature
  is as welcome as a fully-argued proposal.
- **To Do** — specced and ready. Each sub-task is marked `afk` or `hitl`, and those marks say
  whether an agent can start or you have to go first.
- **In Progress / In Review / Done** — being built.

**The rule that makes it worth trusting: nothing sits right of `To Plan` without a PRD
on it.** Those columns are a promise that the thinking is finished. The rule is upheld at
the doors — `plan-ticket` won't land a ticket without one, `implement` won't build one.

The full contract is [`skills/plan-ticket/BOARD.md`](skills/plan-ticket/BOARD.md) — what the
columns and levels mean. [`skills/plan-ticket/TRACKER.md`](skills/plan-ticket/TRACKER.md) is the
other half: how a skill finds out what a project uses. It points to
[`JIRA.md`](skills/plan-ticket/JIRA.md) and [`NOTION.md`](skills/plan-ticket/NOTION.md), which say
how to touch each one. All are shared reference, not skills.

### Using it in a project

```sh
/plan-ticket PROJ-48 # take one ticket from To Plan onto the board
/plan-ticket 10      # plan the 10 smallest, cheapest first
/plan-ticket ALL     # queue up and work the whole To Plan column
/implement PROJ-48   # build a ticket that's ready
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

No tracker, project key, type name or status is hardcoded in any skill. They're read from a
`<!-- tracker-config -->` block in the project's own `CLAUDE.md` (an older
`<!-- jira-config -->` block still counts), and if there isn't one, `plan-ticket` discovers them on
its first run and offers to write the block for next time. Tickets and docs are separate switches,
so a project can keep tickets in Jira and its glossary and ADRs in Notion.

On Notion, epics are a separate database, blockers are a relation between tickets, and sub-tasks
are a checklist in the ticket's body. New projects go in Notion; Jira is being phased out.

**Keeping Notion projects alike.** Copies in Notion don't follow their template, so the template is a
file: [`skills/notion-project/STANDARD.md`](skills/notion-project/STANDARD.md). `/notion-project new
<SHORT>` builds a teamspace from it, and `/notion-project check ALL` adds whatever a project is
missing. To change how every project works, edit the file and run the check. Short names come from
the teamspace names (`WARD - Wardrobe App`), so a project needs no repo to be planned.

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
                                        └─→ To Do
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
sensible option. It stops, marks that step `hitl`, puts the ticket back in `To Do`, and says exactly what it needed.

It refuses to start on a red test suite (you cannot detect a regression against a broken
baseline), it never merges its own PR, and it will not weaken a test to make it pass — a
failing test it didn't expect is a **stop**, not an obstacle.

## Mods

A mod is a plugin that changes Claude's own interface rather than what it knows —
a pane beside the chat, a row above the prompt, a hook on tool calls. Each one is
a folder under `mods/`, and `settings.json` loads them by naming them in
`CLAUDE_CODE_PLUGIN_DIRS`. The path uses `~`, so the same setting works on
Windows and Mac.

**`config-map`** is one button above the chat bar: it starts the config dashboard and opens it,
in the app's browser pane where there is one and your own browser otherwise.
`/config-map` does the same. Its folder holds the whole mod: `plugin.json` names
it, `hooks/register.tsx` is the code, `types/index.d.ts` declares the values it
keeps between draws, and `tests/` is run with `claude plugin test mods/config-map`.
The engine writes a `.claude-plugin/types/` beside it at every load, naming the
build; that stays untracked, since each machine regenerates it.

`CLAUDE_CODE_PLUGIN_DIRS` splits on `:` on a Mac and `;` on Windows, so with two or
more mods on, one synced `settings.json` only works on one kind of machine. The
dashboard warns before it writes a list like that.

## The config dashboard

A local page for seeing and changing everything in here. It needs Node and nothing
else, so it runs from a fresh pull on any machine. Press the button in the Claude
pane, or run:

```sh
node ~/.claude/dashboard/start.mjs --open
```

It lives at `http://127.0.0.1:4915/`, answers only this machine, and stops itself
after an hour with no page open.

- **Sync** shows how each thing reaches other machines: through git, waiting to be
  committed or pushed, through your claude.ai account, by plugin install, or not at
  all. Below that, everything else at the top of this folder.
- **Skills, Commands, Agents, Workflows, Hooks, Mods, Settings** list what is here,
  with a text editor for anything you own and a read-only view of what claude.ai or
  a plugin owns. Settings also has a form; Hooks has one too, since a hook is only
  real once a settings file names it.
- **Skill folders** are labels kept in `dashboard/folders.json`, which git syncs. The
  skills stay where they are on disk, because Claude only finds a skill directly
  under `skills/`.
- **Add to repo** names a left-out skill in the allow list. **Copy into repo** copies
  a claude.ai or plugin skill into `skills/`, leaving the original with its owner.
  Both only stage the change. `/sync-config` commits and pushes it, so nothing leaves
  the machine without you looking first; the dashboard itself never commits or pushes.
- **Delete** moves the thing to `backups/dashboard-trash/`, on this machine only.

It reads and writes only the folders above plus `settings.json`,
`settings.local.json` and `CLAUDE.md`, and refuses any request another website could
have sent, because those files can run code. Tests: `node --test 'dashboard/test/*.test.mjs'`.

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
