---
name: create-epic
description: Macro grilling + planning session that shapes a whole project into a JIRA epic — discovers the vision when it isn't clear yet, then either decomposes it into a dependency-ordered set of high-level Features (construction; each Feature's sub-tasks come later, per-Feature, via grill-with-docs → to-prd → to-issues) OR, when the shape is still foggy, maps the open decisions as investigation tickets and works them until the way is clear (investigation). Records epic-level ADRs and publishes to JIRA with dependency links and GitHub linkage. Use when starting a new project or large body of work and you need to define its scope, checkpoints, and plan — the macro counterpart to grill-with-docs.
argument-hint: "The project / epic idea (a rough sentence is fine)"
---

<what-to-do>

You are running a **macro** grilling session. `grill-with-docs` grills a single feature; this grills an entire **project**. The output is a real JIRA **epic** — either a set of high-level Features ready to be specced, or a map of investigation tickets that resolve the decisions blocking decomposition. Which one depends on how much fog is left after you discover the shape.

Interview me relentlessly, but structured in phases: **Discover → Shape → Chart**, then one of two lanes — **Construction** (Decompose → Sequence → Publish) or **Investigation** (Map → Publish → Work). Do not skip ahead — a fuzzy scope produces a fuzzy epic.

**`create-epic` stops at Features; it does not pre-build their sub-task breakdown** — each Feature's sub-tasks are created later, per-Feature, by `to-issues` after that Feature has been sharpened with `grill-with-docs` and `to-prd`.

**This skill sits inside a board-driven workflow.** Read [BOARD.md](../plan-ticket/BOARD.md)
first — the Epic you create is a **grouping and never appears on the board**; the **Features**
you create are level-0 tickets that land in the **`To Plan`** column, where each is later
picked up by `/plan-ticket` on its own. You are *filling the inbox*, not filling the board.

`create-epic` is also where `/plan-ticket` sends a ticket that turns out to be a whole project
rather than one deliverable. The size-and-fog judgment both skills make lives in one shared
place — [ROUTING.md](../plan-ticket/ROUTING.md). Phase 3's Construction/Investigation fork is
the same call; keep them in step.

Rules for this session — note that discovery runs **one question at a time**, unlike the
round-based frontier that `/grilling` uses. A macro session is finding the shape, and batching
questions before the shape exists produces a round of questions built on guesses:

- Ask questions **one at a time**, waiting for my answer before continuing.
- For every question, **provide your recommended answer** and reasoning — don't just interrogate.
- If a question can be answered by **exploring the codebase or existing docs, do that instead of asking me**.
- Challenge my language against `CONTEXT.md`; sharpen fuzzy terms; stress-test with concrete scenarios.
- Capture decisions inline as they crystallise — update `CONTEXT.md` and ADRs there and then, don't batch.

**Assume I often do NOT have a clear vision yet.** Discovering the shape of the project is part of the job. When the idea is fuzzy, spend real time in Phase 1 diverging before you converge. Never force premature structure onto an idea that hasn't been explored.

</what-to-do>

<phases>

## Phase 1: Discover — find the shape

Goal: turn a rough idea into a **crisp problem statement and a reason this project exists**.

Start by reading the room. Ask (or infer from context/codebase): *is the vision clear, or are we still figuring out what this even is?*

- **If fuzzy → diverge.** Explore openly before narrowing. Good moves: ask what triggered this now; ask what "done and great" feels like; surface 2–3 genuinely different framings of the project and ask which resonates; probe for the underlying pain vs. the proposed solution (people often describe a solution, not a problem). Reflect back what you're hearing as candidate problem statements and let me correct them.
- **If clear → confirm and pressure-test.** Restate the vision in your words, then attack it: what's the riskiest assumption? What would make this not worth doing?

Converge Phase 1 only when you can write, and I agree with:

- **Why now / the problem** — the pain, from the stakeholder's perspective.
- **Intentions, goals & wants** — what I actually want out of this, including the soft/implicit ones. Separate *goals* (outcomes) from *wants* (nice-to-haves).
- **Definition of success** — how we'll know the epic delivered.
- **Non-goals / out of scope** — explicitly. This is where scope creep dies. Push me to name what we are deliberately NOT doing.

## Phase 2: Shape — scope and vocabulary

Nail down the boundaries and the language before decomposing.

- **Where does this live?** Which existing modules/areas does it touch? Explore the codebase — prefer extending existing seams over inventing new structure.
- **Term conflicts.** If my framing uses language that conflicts with or is missing from `CONTEXT.md`, resolve it now and update `CONTEXT.md`.
- **Constraints & dependencies.** External deadlines, other teams, tech constraints, things that must ship first.
- **Risks & unknowns.** What could sink this? What do we not know yet that we'd need to spike? **Write these down — they are the raw material for Phase 3.**

## Phase 3: Chart — build or investigate?

This is the fork. Before decomposing anything, make the honest readiness call:

> **Can I name the demoable checkpoints (Features) and sequence them right now — or are there decisions upstream that would change what the Features even are?**

- **Buildable → Construction lane** (Phase 4C onward). You know the shape well enough to slice it into vertical Features. Most concrete epics land here.
- **Still foggy → Investigation lane** (Phase 4I onward). Something upstream is unresolved and pretending to write Features would be fiction. Map the decisions first.

**Signals you must investigate first** (any one is enough):
- You catch yourself hand-waving a Feature ("...and then somehow we rank the recommendations").
- A "does this approach even work?" question is unanswered (unproven methodology, a library that may not support what you need).
- A build-vs-buy or which-architecture decision is genuinely open.
- An external constraint (legal, partner API, compliance) would reshape the plan and you don't know it yet.
- Resolving the unknown needs *doing* (a prototype, real research, a grilling pass), not just a conversation in this session.

**This is not a permanent label on the epic.** An epic very often investigates first and constructs second — the same epic transitions from resolving decisions to building deliverables once the fog lifts (see `<investigation-vs-construction>`). And at the project level, you'll have several epics sitting at different readiness — run this fork per epic, not once for the whole project.

If it's a mix — mostly clear but one gnarly unknown — prefer: file the epic in the **Construction lane** for the clear Features, and add the unknown as a single **investigation ticket** that blocks the Feature it gates. Don't send a whole epic down the Investigation lane for one spike.

---

### CONSTRUCTION LANE

## Phase 4C: Decompose — Epic → Features (high-level), + research Tasks where an idea is still too vague

Break the epic into its **Features** — and **stop there** (don't pre-decompose a Feature into its implementation steps; that breakdown is deferred to `to-issues`, run **per-Feature, later**, after the Feature has been grilled and specified). Your job here is to name the right Features and describe each at a **high level**. But not every level-0 item you emit will be a Feature: some ideas aren't solid enough to build yet, and forcing them into a "Feature" would be fiction.

- **Features** — the demoable deliverables inside the epic. Each Feature is a **checkpoint**: a coherent, vertical slice (a thin path through every layer, demoable on its own) that visibly moves the epic forward. Aim for several thin Features over a few thick ones; they become the milestones you sequence and date in Phase 5C.
- **Keep the description high-level, but write it well.** A Feature carries *what it delivers* and its *acceptance criteria* (the checkable "done" conditions) — the loose brief a developer will later sharpen into a PRD via `grill-with-docs` → `to-prd`. Write it in the **`<feature-writeup-style>`**: a plain-language *What & why* that defines its jargon, plus specific, measurable acceptance criteria. Resist writing the implementation breakdown now; the sub-tasks belong to `to-issues`.
- **When a would-be Feature is still too vague to name as a buildable slice, emit a Task, not a Feature.** If you catch yourself hand-waving what the Feature even *is*, don't fake it — file it as an investigation **Task**: a level-0 item with the `investigation` label and a `[research]` / `[grill]` / `[prototype]` prefix, whose deliverable is *the research that turns it into a Feature*. It **blocks** the Feature it will become. Resolve it for clarity **first** (research/grill), and only then does the resulting Feature enter the normal `grill-with-docs` → `to-prd` → `to-issues` chain. This is the Investigation lane's tool used inline inside an otherwise-buildable epic (see Phase 3 and `<scope>`) — so a Construction-lane epic is really a mix of build Features and a few research Tasks that graduate into Features.
- Bugs are **not** part of this tree — `create-epic` never emits one. But a bug found *later*, in the thing this epic is building, may be parented to the epic if it has to be fixed before the epic ships (see `<scope>`).

Present the Features as a numbered outline and iterate with me before anything is published. For each Feature, get rough agreement on what it delivers and its acceptance criteria.

## Phase 5C: Sequence — dependencies first, then dates

- **Dependencies first.** For each Feature, establish what **blocks** what. Order the Features by dependency, not by wishful timeline. Call out anything that can run in parallel.
- **Size each item** S / M / L (or your preferred scale) so the shape of the effort is visible.
- **Then set dates — always ask.** This is a solo/small-team, milestone-driven workflow (not Scrum sprints), so due dates are a first-class part of the plan, not an afterthought. Only overlay them once the dependency order is agreed. Ask, in order:
  1. **Epic due date** — "By when do you want this whole epic done?" This is the real commitment. If there genuinely is no deadline, that's a valid answer — leave it off and say so.
  2. **Per-Feature target dates** — walk the Features (checkpoints) in dependency order and put a target date on each. These are **early-warning markers**, not commitments: a due date on a big epic with nothing in between means you don't discover you're behind until it's too late. Dated Features tell you at Feature 2 of 4 that you're slipping, not at the deadline. Derive sensible defaults from the sizes (S/M/L) and the epic due date working backwards, and let me adjust.
  (Sub-tasks don't exist yet — they're created later, per-Feature, by `to-issues` — so there are no Task-level dates to set at this stage.)

  If there's no epic deadline, skip dates entirely — dependency order is still the real plan. But don't silently skip the question; ask it every time.

## Phase 6C: Publish the epic + Features to JIRA

Turn the agreed epic and Features into real JIRA issues. See `<jira-mechanics>` for the exact tools and hierarchy. In order:

1. Confirm the **site, project, and issue types** with me before creating anything.
2. Create the **Epic** (summary = project name, description = problem / goals / non-goals / success from Phases 1–2).
3. Create each **Feature** under the Epic (parent = Epic), with a **high-level** description + acceptance criteria written in the **`<feature-writeup-style>`** (plain-language *What & why* + measurable criteria). Do **not** create their sub-tasks — that's `to-issues`, later, per-Feature.
4. Create **dependency links** (`Blocks` / `is blocked by`) between Features from Phase 5C.
5. Set **due dates** from Phase 5C: the **epic** `duedate` and each **Feature's** `duedate`.
6. Record **epic-level ADRs** (see `<adrs>`) for the hard-to-reverse decisions made along the way.
7. Explain **GitHub linkage** so code ties back to these issues (see `<jira-mechanics>`).

8. **Put every Feature in `To Plan`.** They are unspecced by definition — a Feature carries a high-level brief, not a PRD, and the board's integrity rule (see `<board>`) forbids an unspecced ticket sitting right of `To Plan`. Transition each one there (`getTransitionsForJiraIssue` → `transitionJiraIssue`); if a project creates tickets in `To Plan` by default, just verify it.

**Hand off.** Report back the Epic key and a link, plus the created Features — all sitting in `To Plan`. From here each Feature is picked up **one at a time by `/plan-ticket <KEY>`**, which routes it (usually `grill-with-docs` → `to-prd` → `to-issues`), lands it on the board, and hands it to `implement`. Tell the user they can run `/plan-ticket ALL` to work the whole column. Investigation tickets follow the Investigation lane instead — resolve them for clarity *first*, and once a resolved decision turns a foggy area into a buildable Feature, that Feature goes into `To Plan` and enters the same chain.

---

### INVESTIGATION LANE

The way isn't clear enough to build. Instead of a build tree, you produce a **map of open decisions** on the tracker and work them one at a time. The core discipline: **separate deciding from doing.** Investigation tickets resolve *decisions*, not deliverables — the output of working one is a documented decision, not shipped code.

## Phase 4I: Map the fog

The **epic itself is the map.** Its description holds four sections (see `<investigation-map>` for the template):

- **Destination** — what reaching "the way is clear" looks like.
- **Decisions so far** — one-liners for resolved questions (empty at first), each linking its ticket.
- **Fog** — questions you know are ahead but that aren't sharp enough to ticket yet.
- **Out of scope** — ruled-out directions.

Map the frontier **breadth-first**: surface *every* open decision that blocks decomposition before going deep on any one. Distinguish the questions that are already **sharp** (ready to become a ticket) from the ones still in **fog** (real but too vague to action).

## Phase 5I: Publish the map + investigation tickets

1. Confirm site / project / issue types with me.
2. Create the **Epic** with the map in its description (the four sections above).
3. For each **sharp** question, create an **investigation ticket** under the epic — see `<jira-mechanics>`. Each carries:
   - The `investigation` label (this is the third work-type, distinct from build Features and reactive Bugs — see `<scope>`).
   - A **type** prefix in the summary telling you how to resolve it: `[research]`, `[prototype]`, `[grill]`, or `[task]`.
   - A body that states **the question, not the answer**, plus what "resolved" would mean.
   - **No due date** — investigation is decision work, not a dated deliverable.
4. Wire **Blocks** links where one decision must resolve before another is answerable.
5. Leave the still-fuzzy questions in the map's **Fog** section — don't force them into tickets prematurely.
6. **Stop.** Charting the map is one session; don't start resolving tickets now. Report the epic key, the map, and the frontier of unblocked tickets.

## Phase 6I: Work the map (ongoing sessions)

Each working session (this can be a fresh `create-epic` invocation on an existing map epic, or you carry straight on):

1. Load the epic map. Pick an **unblocked** investigation ticket from the frontier.
2. Claim it (assign to me / mark in progress per the project's convention).
3. **Resolve it** with the matching skill: `[research]` → `research`, `[prototype]` → `prototype`, `[grill]` → `grill-with-docs`, `[task]` → do the small thing. The point is to reach a decision.
4. Post the **decision as a comment** on the ticket (what we decided and why; link any prototype/research asset separately), then close it.
5. **Update the map:** move the resolved question into "Decisions so far" (one line + ticket link), and **graduate** any newly-sharp questions out of "Fog" into fresh investigation tickets.
6. Record an **ADR** for any decision that's hard to reverse (see `<adrs>`).

**When the fog clears** — the map's Fog section is empty and nothing blocks decomposition, i.e. you feel the pull to just go build it — the epic has **graduated**. Re-enter the **Construction lane at Phase 4C** and decompose the now-clear epic into high-level Features. Same epic; it has moved from resolving decisions to building deliverables.

</phases>

<supporting-info>

<board>

The full contract is in [BOARD.md](../plan-ticket/BOARD.md). What binds `create-epic`:

- **The Epic never appears on the board.** It's a grouping — the answer to "what project is this part of." Don't try to give it a column.
- **Features are level-0 tickets and go to `To Plan`.** They carry a high-level brief, not a PRD. `To Do` / `On Deck` promise the thinking is finished; a fresh Feature has not had its thinking finished, so it may not sit there. `/plan-ticket` is what earns it a place further right.
- **Investigation tickets are also level-0, also `To Plan`.** They're the one exception to the PRD rule — their output is a decision comment, never a PRD, and they never enter `To Do` (deciding is never decision-free work).
- **Sub-tasks are not yours to create.** `to-issues` does that, later, per-Feature, after `to-prd`.

</board>

<investigation-vs-construction>

There is **no hard line** between a "build epic" and a "discovery epic" — that's the correct model, not a gap. They are two phases in the life of one epic, separated by a single readiness threshold: *can I decompose into demoable Features right now, or are there decisions blocking me from even knowing what the Features are?*

- Every epic starts foggy and ends clear.
- The Investigation lane's job is to convert fog into decisions until decomposition becomes honest.
- The Construction lane's job is to turn a clear epic into dated, demoable deliverables.
- The transition point is Matt Pocock's line: *"the pull to just do the work is usually the signal you've reached the edge of the map"* — that pull means the fog has lifted and it's time to decompose.

So don't ask "is this a build epic or a discovery epic?" Ask "how much fog is left, and is it thick enough that I should resolve it as tracked work before decomposing?" Run that check per epic; a project is a set of epics at mixed fog levels.

</investigation-vs-construction>

<investigation-map>

The epic description, when the epic is in the Investigation lane:

```md
## Destination
{What "the way is clear" looks like — the outcome that lets us start building.}

## Decisions so far
— (none yet)
{later: — PROJ-21: recommendation ranking runs in a background job, not the checkout request path}

## Fog
{Questions we know are ahead but can't sharply ticket yet.}
— How does a merchant review/override an automated price adjustment?

## Out of scope
— {Directions we've ruled out.}
```

Keep it terse — it's an index, not a document. The detail lives in each ticket and its decision comment.

</investigation-map>

<discovery-when-vision-is-fuzzy>

The single most important behaviour of this skill: **do not fake certainty I don't have.** If I open with "I want to build X" but can't answer why or for whom, that's a Phase 1 signal, not a green light to start decomposing. And if I know *why* but not *how* — where the approach itself is unproven — that's the Investigation lane, not a green light to invent Features.

Techniques when the vision is unclear:

- **Five-whys the request** until you hit a real problem rather than a proposed solution.
- **Offer contrasting framings.** "This could be a 'reduce manual effort' project, a 'new capability' project, or a 'de-risk the existing thing' project — they'd be scoped very differently. Which is it?"
- **Work backwards from done.** "Describe the moment you'd call this a success." The answer usually exposes the real goal.
- **Name the anti-goals.** Asking what we're explicitly NOT doing often clarifies the vision faster than asking what we are.
- **Timebox divergence.** Once a stable problem statement holds up to a couple of challenges, converge — don't explore forever.

It is correct and expected for a session to spend most of its time in Phase 1 when the idea starts vague. A well-shaped epic is the deliverable; the JIRA tree (or map) is just its serialization.

</discovery-when-vision-is-fuzzy>

<domain-awareness>

Reuse the same docs `grill-with-docs` uses.

- Read `CONTEXT.md` (the glossary) and `docs/adr/` before grilling. If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts — the map points to where each `CONTEXT.md` and `docs/adr/` lives.
- Use the project's domain vocabulary throughout the epic, tasks, tickets, and ADRs.
- Create docs lazily — only `CONTEXT.md` entries when a term is actually resolved, only an ADR when one is actually warranted.
- `CONTEXT.md` is a glossary and nothing else — no scope, no plan, no implementation detail. The scope and plan live in the JIRA epic, not in `CONTEXT.md`.

</domain-awareness>

<adrs>

Offer an **epic-level ADR** only when all three hold:

1. **Hard to reverse** — changing your mind later is costly.
2. **Surprising without context** — a future reader will ask "why did they do it this way?"
3. **A real trade-off** — there were genuine alternatives and you chose one for reasons.

Epic-scale ADRs tend to be the big bets: build-vs-buy, the sequencing strategy, a boundary decision that constrains every task under it. In the Investigation lane, **a resolved investigation ticket is a prime ADR source** — a decision reached by research or prototype that constrains everything downstream is exactly what an ADR is for. Skip ADRs for anything routine or self-evident. Record them in `docs/adr/` AND reference the ADR from the JIRA epic (or ticket) so the decision travels with the work.

</adrs>

<scope>

`create-epic` governs **planned work** — the Epic and everything under it. That planned work comes in **two kinds**, and there's a third kind it does *not* own:

1. **Build work** — Epic → Feature → sub-task. `create-epic` creates the Epic and its high-level **Features** (dated, deadline-driven); each Feature's **sub-tasks** are created later by `to-issues` after `to-prd`. The Construction lane.
2. **Investigation work** — investigation tickets under an epic (label `investigation`). Resolve *decisions*, no deliverable, no due date. The Investigation lane. These convert a foggy epic into a buildable one.
3. **Reactive work** — **Bugs.** Defects handled as they arise, with **no due date of their own**. They land in `To Plan` like everything else and are routed by `plan-ticket` to `/diagnose` — reproduce first, then spec. `create-epic` does **not** create Bugs: if bugs surface during grilling, file them into `To Plan` rather than folding them into the epic tree. A bug **may** be parented to an epic once it exists, when it has to be fixed before that epic ships — that's `plan-ticket`'s call, not this skill's.

</scope>

<feature-writeup-style>

Write **every Feature description** so someone who is **not** steeped in the project or its jargon can understand what it is and why it matters — then make the "done" conditions concrete enough to test. This is the register that works; hold to it. Use this shape:

```md
## What & why
Plain-language prose (a short paragraph or two). Say what the Feature does AND **why it exists** — the problem it solves for the user. **Define any domain term the moment you use it, in-line** — e.g. "Recommendations (suggested products) are ranked items shown to a customer at checkout." Assume the reader hasn't read the epic, the glossary, or the codebase. No implementation detail, no file paths.

## Acceptance criteria
A checklist of **specific, measurable, externally-observable** conditions — each one something you could demo or test as pass/fail. Prefer "given X, the app returns Y" / "changing A recomputes B" over a vague "supports A." Where a correct result already exists (a spreadsheet, a legacy output), make **matching it** a criterion.

## Dependencies / demo
What must exist first (reference the blocking Features/tickets), and whether the Feature is in scope for the nearest demo milestone.
```

**High-level ≠ vague.** "High-level" here means *not yet decomposed into sub-tasks* — it does **not** license jargon-dense or hand-wavy prose. Aim for the clarity of a good README: plain enough for a newcomer, specific enough to check. The deep implementation detail still lands later in `to-prd`; the accessibility and the measurable acceptance criteria start **here**.

</feature-writeup-style>

<jira-mechanics>

The Atlassian tools are MCP tools and may be **deferred** — load them first in one call:

```
ToolSearch → jira create issue
```

The Atlassian connector's server prefix differs per install (and changes if it's reinstalled), so never hardcode it — read the prefix off what that call returns, then load the whole set in one further `ToolSearch → select:…` using that prefix with: `getAccessibleAtlassianResources`, `getVisibleJiraProjects`, `getJiraProjectIssueTypesMetadata`, `getJiraIssueTypeMetaWithFields`, `createJiraIssue`, `editJiraIssue`, `addCommentToJiraIssue`, `createIssueLink`, `getIssueLinkTypes`, `searchJiraIssuesUsingJql`.

**Discovery (do this before creating anything):**

1. `getAccessibleAtlassianResources` → get the `cloudId` (or pass the site hostname like `yoursite.atlassian.net` directly as `cloudId`).
2. `getVisibleJiraProjects` (action `create`) → confirm the target **project key** with me.
3. `getJiraProjectIssueTypesMetadata` for that project → learn the exact issue-type names and their `hierarchyLevel`. This workflow uses **Epic (level 1) → Feature (level 0) → Task (sub-task, level −1)**. Confirm the project actually has a `Feature` type at level 0 and a sub-task-level type for Tasks; if `Feature` is missing (e.g. a project that only has `Story`), tell me and use the closest level-0 type or ask me to add `Feature` in the JIRA UI. Don't assume names verbatim — use what the metadata says.

**The hierarchy.** JIRA only nests three levels: Epic (1) → level-0 item (0) → sub-task (−1). `Feature`, `Task`, and `Bug` are all level 0 and **cannot nest inside each other**. `create-epic` creates the **Epic** and its **Features** (level 0), plus any **investigation tickets** (also level 0). It does **not** create the sub-task level — a Feature's implementation sub-tasks are created later by `to-issues` (after `to-prd`).

**Creating the epic + Features** with `createJiraIssue` (required: `cloudId`, `projectKey`, `issueTypeName`, `summary`):

- **Epic** — `issueTypeName` = the epic type from metadata.
- **Feature under the Epic** — `issueTypeName` = `Feature`, set `parent` to the Epic's key. If the project rejects `parent` for that type, fall back: fetch fields with `getJiraIssueTypeMetaWithFields`, find the **Epic Link** custom field, and set it via `additional_fields` (e.g. `{"customfield_10014": "PROJ-123"}`) or a follow-up `editJiraIssue`.
- Keep the Feature `description` **high-level** — what it delivers + acceptance criteria as a checklist (`contentFormat: "markdown"`). Do **not** create sub-tasks here; `to-issues` does that later, per-Feature, from the PRD.
- Add labels, priority, or a `duedate` via `additional_fields`, e.g. `{"labels": ["epic-name"], "duedate": "2026-09-01", "priority": {"name": "High"}}`.

**Creating investigation tickets** (Investigation lane) with `createJiraIssue`:

- Create them as a **level-0 type** under the epic (use `Task`/`Story` at level 0, or a `Spike` type if the project has one — check the metadata). Set `parent` = the Epic's key (or the Epic Link fallback).
- Apply the `investigation` **label** via `additional_fields` (e.g. `{"labels": ["investigation", "epic-<slug>"]}`) — the label is what marks it as decision work regardless of the underlying type.
- Prefix the `summary` with the resolution type: `[research] …`, `[prototype] …`, `[grill] …`, `[task] …`.
- `description` = the **question** and what "resolved" means. **Do not set `duedate`** on investigation tickets.
- **Resolve** a ticket by posting the decision with `addCommentToJiraIssue` (`contentFormat: "markdown"`), then closing it; update the epic description (the map) via `editJiraIssue` (read current description first, then re-set it with the "Decisions so far" line added).

**Dependency links** with `createIssueLink`:

- Use `getIssueLinkTypes` to confirm the `Blocks` type exists.
- For "A is blocked by B": `type: "Blocks"`, `inwardIssue: B` (the blocker), `outwardIssue: A` (the blocked).
- Link at the level the dependency actually lives (Feature-to-Feature or investigation-to-investigation; sub-task-to-sub-task links come later, via `to-issues`).

**Sizing / dates:** if the project has a Story Points field, set it via `additional_fields` (discover its `customfield_*` id from the type metadata). Dates go in `additional_fields.duedate` as `YYYY-MM-DD`. Only add dates once the dependency order is agreed (Phase 5C). Investigation tickets get no dates.

**GitHub linkage** — how code ties back to these issues (the JIRA↔GitHub app does this automatically once keys appear in the right places):

- **Branch names** containing the issue key, e.g. `PROJ-123-add-oauth`.
- **Commit messages** referencing the key, e.g. `PROJ-123 add token refresh`. Smart Commits can also transition issues (`PROJ-123 #time 2h #comment done`).
- **PR titles / descriptions** containing the key — the linked PR then shows in the JIRA issue's Development panel.

Tell me to name branches/PRs with the issue key so the linkage is automatic; there's no per-issue setup needed beyond the org's GitHub-for-JIRA app.

</jira-mechanics>

</supporting-info>
