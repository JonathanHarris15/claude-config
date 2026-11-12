# .claude

My personal Claude Code configuration, synced across machines.

## What's in here

| Path | What it is |
| --- | --- |
| `skills/` | Custom skills — a ticket workflow that works on any tracker (`create-ticket` / `create-epic` → `plan-ticket` → `grill-with-docs` → `to-prd` → `to-issues` → `implement` → `review`, all resting on `tracker`), plus the two pieces `grill-with-docs` composes (`grilling`, `domain-modeling`), and `tdd`, `diagnose`, `prototype`, `research`, `codebase-design`, `improve-codebase-architecture`, `wizard`, `writing-for-agents`, `retro`, `sync-config`, `wait-what`. |
| `agents/` | Custom subagents. Markdown with frontmatter; the frontmatter sets the model, tools, and description. |
| `workflows/` | Multi-agent orchestration scripts. Plain JS that fans out subagents with real control flow — loops, pipelines, adversarial verification. |
| `mods/` | Mods — code that changes Claude's own interface. `config-map` opens the dashboard; `commit-tree` draws the repo's commit tree. |
| `dashboard/` | A local page for managing all of this, and for seeing how each thing syncs. It also shows how often each skill gets used. |
| `hooks/` | Hook scripts. `skill-usage.mjs` logs every skill use, whether you type `/name` or Claude loads it. Run `node ~/.claude/hooks/skill-usage.mjs report` to see every skill with its use count and last date, least used first. |
| `usage/` | The skill-use logs: one append-only file per machine, so the logs never clash when they sync. Skill files are never touched. On a new machine, run `skill-usage.mjs backfill` once to count past uses from its session transcripts. |
| `settings.json` | Global settings: effort level, theme, permission allowlist, hooks, and the `CLAUDE_CODE_PLUGIN_DIRS` that loads the mods. |
| `CLAUDE.md` | Instructions prepended to every session, in every project, on every machine. |

## The ticket workflow

The skills in here are not a grab-bag — most of them are one workflow, and **the board
is its spine**, in whatever tool the project uses. Every piece of work lives on the board, and the skills move it
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

The full contract is [`skills/tracker/BOARD.md`](skills/tracker/BOARD.md) — what the columns and
levels mean. The [`tracker`](skills/tracker/SKILL.md) skill is the other half: how a skill finds out
which tool a project uses, and how to touch it. One backend file per tool sits under
[`skills/tracker/backends/`](skills/tracker/backends/): Jira, Notion, GitHub Issues, and
[`OTHER.md`](skills/tracker/backends/OTHER.md) for anything else (Linear, Asana, Todoist…), which
maps the tool once and writes the map down.

### Using it in a project

```sh
/tracker             # see (or set up) where this project keeps its work
/create-ticket ...   # jot one thing into To Plan, without planning it
/create-epic ...     # shape a whole project into an epic and its tickets
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
own. It makes the calls a PRD left open and lists them in the PR. Anything else that surprises it
gets parked on the board with a note, and the run carries on.

The bar for trivial is deliberately strict: if there is one thing worth asking you, it isn't
trivial and it goes down the normal lane instead.

No tool, project key, type name or status is hardcoded in any skill. Skills ask for an
*action* — "move a ticket", "add sub-tasks" — and the backend file says how it works there.
The tool is read from a `<!-- tracker-config -->` block in the project's own `CLAUDE.md` (an older
`<!-- jira-config -->` block still counts). With no block, `tracker` looks for clues in the repo —
ticket keys in branches and commits, links in the README, issue templates — then asks the tools,
then asks you, and writes the block for next time. Tickets and docs are separate switches, so a
project can keep tickets in GitHub and its glossary and ADRs in the repo.

Where a tool has no home for something (labels, blockers, sub-tasks, due dates), it goes in the
ticket body in one shared text form, so every skill reads a body the same way on every tool.

Per-project working notes live in [`board/`](board/), one file per short name. `plan-ticket`,
`implement` and `review` read them and follow them over their own defaults — "don't run the full
suite", "deploy a test build before review".

**Keeping Notion projects alike.** Copies in Notion don't follow their template, so the template is a
file: [`skills/notion-project/STANDARD.md`](skills/notion-project/STANDARD.md). `/notion-project new
<SHORT>` builds a teamspace from it, and `/notion-project check ALL` adds whatever a project is
missing. To change how every project works, edit the file and run the check. Short names come from
the teamspace names (`WARD - Wardrobe App`), so a project needs no repo to be planned.

### The whole flow

Four ways to touch the work — create, plan, write code, push — and each has its own door:

```
 ① CREATE TICKETS                                      Under it all: /tracker
  /create-ticket    one idea, bug or follow-up          finds the tool and how to
  /create-epic      a project → epic + its tickets      use it — Jira · Notion ·
  /improve-codebase-architecture   refactors it found   GitHub · anything else
  by hand           client reports, scratch notes
        │
        ▼
  ┌───────────┐
  │  TO PLAN  │  the inbox — nothing here is specced
  └─────┬─────┘
        │ ② PLAN    /plan-ticket  KEY · 10 (smallest first) · ALL
        │           reads size and clarity, then picks a lane:
        │             trivial ......... 2-line PRD, skip the rest ─────────┐
        │             project ......... /create-epic → new tickets ↺ To Plan
        │             investigation ... research / prototype / grill
        │                               → decision comment → closed
        │             bug ............. /diagnose ──┐                      │
        │             need facts ...... /research ──┤                      │
        │             need feel ....... /prototype ─┼→ /grill-with-docs    │
        │             fog or sharp .................┘         │            │
        │                                      /to-prd → /to-issues        │
        ▼                                                     │            │
  ┌───────────┐ ◀─────────────────────────────────────────────┴────────────┘
  │   TO DO   │  PRD + sub-tasks, each marked afk or hitl
  └─────┬─────┘
        │ ③ WRITE CODE   /implement  KEY · next · 6 · ALL
        │                (a count or ALL = afk-only batch, one PR)
        ▼
  ┌─────────────┐  tests first at real seams (/tdd), commit per sub-task
  │ IN PROGRESS │  stops at a hitl step → back to To Do with a note
  └─────┬───────┘
        │ ④ PUSH   /review (standards · spec · domain) → push branch, open PR
        ▼
  ┌───────────┐
  │ IN REVIEW │  you review — it never merges its own PR
  └─────┬─────┘
        │  you merge
        ▼
  ┌───────────┐
  │   DONE    │
  └───────────┘

 Side doors, code with no ticket: /diagnose · /tdd · /prototype · /review on any branch
```

### How planning actually happens

`/plan-ticket` is the front door, and its real job is **reading what you handed it** before
it starts working. A `To Plan` ticket might be one line or five paragraphs; it might be one
feature or a whole quarter. So it reads two dials — *how big* and *how formed* — and routes
it down one of the lanes in step ② above. Every lane ends at `/to-prd` → `/to-issues` → `To Do`.

The lanes flow into each other — a grilling that hits a factual unknown hands to research,
research hands back to grill. Passing through two or three is normal.

`grill-with-docs` is the default and does most of the work. When a ticket is pure fog — it
names a *feeling* rather than a change — the grilling just starts a step wider: Claude puts
two or three genuinely different readings of the ticket in front of you and says which it
would back, because reacting is far easier than inventing.

### Keeping going beats stalling

`/implement` is built around one idea:

> **Committed work you can review beats a blocked ticket.**

A branch costs nothing to undo, and a stalled ticket is no progress at all. So when the PRD
doesn't answer something, it makes its best call and keeps going. The risk is a plausible-looking
PR built on a decision nobody mentioned, because it *looks* finished and gets reviewed as if it
were. So every call goes at the top of the PR, where you review it as a choice.

It still stops at a sub-task marked `hitl`, since someone has already said that call needs you. It
stops at a regression, it never merges its own PR, and it will not weaken a test to make it pass:
a failing test it didn't expect is a **stop**, not an obstacle.

## Mods

A mod is a plugin that changes Claude's own interface rather than what it knows —
a pane beside the chat, a row above the prompt, a hook on tool calls. Each one is
a folder under `mods/`, and `settings.json` loads them with a single
`CLAUDE_CODE_PLUGIN_DIRS` of `~/.claude/mods` — the folder that holds them, not
each mod in turn. Every mod inside it loads, so adding one is just adding a
folder. The path uses `~`, so the same setting works on Windows and Mac.

**`config-map`** is one button above the chat bar: it starts the config dashboard and opens it,
in the app's browser pane where there is one and your own browser otherwise.
It also passes along the session's project folder, so the dashboard gets a Workspace tab
listing what Claude reads there: CLAUDE.md files (above, in and below the project),
`.claude/` settings, skills, agents, commands and other files, and `.mcp.json`.
`/config-map` does the same. Its folder holds the whole mod: `plugin.json` names
it, `hooks/register.tsx` is the code, `types/index.d.ts` declares the values it
keeps between draws, and `tests/` is run with `claude plugin test mods/config-map`.
The engine writes a `.claude-plugin/types/` beside it at every load, naming the
build; that stays untracked, since each machine regenerates it.

**`commit-tree`** is a second button on that row. It opens a read-only pane
holding the repository's commit tree: the branch you are on and how far it has
drifted, every branch here and on a remote with the checked-out one marked, and
then git's own graph, newest commit at the top and oldest at the bottom, each
row labelled with its hash, date, branch and tag names, and subject. The arrow
keys scroll it while the pane has focus, and it re-reads itself every fifteen
seconds. `/commit-tree` opens it too. Same layout as above, tested with
`claude plugin test mods/commit-tree`.

Both mods draw on the band above the prompt, which is **one drawing shared by
every mod**: a mod that returns its own tree there replaces what the mods beneath
it drew. So each one takes what `next(e)` gives it and lays its own row beside it,
and the buttons sit in a row instead of hiding each other. A new mod that draws
there has to do the same.

Naming the folder rather than each mod also steps around a trap. A list of paths
is split per platform, and on Windows a `;`-joined list does not load at all,
while a `:`-joined list of `~` paths does not either — only a single path is
reliably read.

That leaves on and off to the folder names, which is where they now live: **a mod
is off when its folder is dot-named**, `mods/.commit-tree`, because the loader
skips those. Git tracks a dot-named folder like any other, so the choice syncs to
your other machines with everything else, and nothing is deleted to turn a mod
off. The dashboard's switch does the rename, and turning one on also makes sure
`settings.json` names the folder.

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
