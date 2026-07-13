---
name: to-issues
description: Break a single specced JIRA Feature (one whose description to-prd has turned into a PRD) into independently-grabbable sub-task Issues under it. Use after to-prd, to slice a Feature into the concrete implementation steps a developer picks up. JIRA-native — the breakdown step below a Feature.
argument-hint: "Optional: the JIRA Feature key to break into sub-tasks"
---

# To Issues (JIRA)

Break **one specced Feature** into independently-grabbable **sub-task Issues** under it. This is the step *below* a Feature: `create-epic` makes the Epic and its high-level **Features**; `to-prd` writes a PRD onto the chosen Feature's description; **`to-issues` slices that Feature into sub-tasks**; `implement` builds each one.

Hierarchy: **Epic → Feature → sub-task**. `to-issues` operates at the bottom edge — it takes a Feature (level 0) and creates its breakdown steps as **sub-tasks** (JIRA's sub-task level, −1, the only way a step can nest under a Feature). It does **not** create Features (that's `create-epic`) and it does **not** create Bugs (those are standalone, handled by `triage`).

## Process

### 1. Gather context

Resolve the source Feature:
- **Argument is a JIRA Feature key** → read it with `getJiraIssue` (include `description`); its PRD (from `to-prd`) is your input — mine the **User Stories** and **Implementation Decisions** for the breakdown. That Feature is the parent for the new sub-tasks.
- **No argument** → work from context; ask which **Feature** to slice. If the Feature hasn't been specified yet, run `grill-with-docs` then `to-prd` first; if there's no epic/Feature at all, offer `create-epic`.

### 2. Explore the codebase (optional)

If you haven't already, explore to understand the current state. Sub-task titles/descriptions must use the project's `CONTEXT.md` vocabulary and respect ADRs in the area.

### 3. Draft the sub-tasks

The Feature is already a vertical slice (a thin path through the layers). Break it into the **concrete implementation steps** to build that slice end-to-end.

<breakdown-rules>
- Each sub-task is an independently-grabbable, verifiable piece of the Feature.
- Cover the whole Feature: schema/data, API/logic, UI, and tests — whatever layers the slice touches.
- Prefer a handful of meaningful sub-tasks over many trivial ones. Don't over-decompose; a sub-task's own micro-steps go in a checklist in its description (JIRA has no level below sub-task).
- Sequence them by dependency where it matters.
</breakdown-rules>

Classify each sub-task **AFK** (an agent can implement and merge it without a human) or **HITL** (needs human interaction — an architectural decision, a design review). Prefer AFK where possible.

### 4. Quiz the user

Present the breakdown as a numbered list. For each sub-task show: **Title**, **AFK/HITL**, **Blocked by** (which sub-tasks must finish first), **User stories covered** (from the Feature's PRD). Ask:
- Is the granularity right (too coarse / too fine)?
- Are the dependency relationships correct?
- Should any sub-tasks merge or split?
- Are AFK/HITL classifications right?

Iterate until the user approves.

### 5. Publish to JIRA

Create each approved sub-task under the **Feature**, in dependency order (blockers first) so you can reference real keys in the links. See `<jira-mechanics>`.

Write each sub-task in the **same plain-language register as its Feature**: say what it builds and why in terms a newcomer can follow (define any jargon), and keep the acceptance criteria **specific and measurable** (pass/fail). Use this body template for each sub-task's `description`:

<subtask-template>
## What to build
Concise description of this implementation step — the behaviour it adds to the Feature. No file paths or code snippets (they go stale). Exception: a decision-encoding snippet from a prototype (state machine, reducer, schema, type shape) — inline just the decision-rich part and note it came from a prototype.

## Acceptance criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Parent Feature
`PROJ-123` (the Feature this sub-task breaks down; the PRD lives there)
</subtask-template>

Do NOT modify the parent Feature's PRD beyond linking. Report the created sub-task keys as a tree (Feature → sub-tasks).

<jira-mechanics>

Load the Atlassian tools first (deferred) in one call:

```
ToolSearch → jira create issue
```

The Atlassian connector's server prefix differs per install (and changes if it's reinstalled), so never hardcode it — read the prefix off what that call returns, then load the whole set in one further `ToolSearch → select:…` using that prefix with: `getAccessibleAtlassianResources`, `getJiraProjectIssueTypesMetadata`, `getJiraIssue`, `createJiraIssue`, `editJiraIssue`, `getIssueLinkTypes`, `createIssueLink`.

**Discovery.** `getAccessibleAtlassianResources` → `cloudId`. Read the Feature with `getJiraIssue` to get its `projectKey` and confirm it's a level-0 Feature. `getJiraProjectIssueTypesMetadata` → the real **sub-task-level** type name (JIRA's `Subtask`, which a project may have renamed to "Task"). Don't assume names verbatim — use what the metadata says.

**The hierarchy — why a breakdown step = a sub-task.** JIRA only nests three levels: Epic (1) → level-0 item (0) → sub-task (−1). `Feature`, `Task`, and `Bug` are all level 0 and cannot nest inside each other. So a step "under a Feature" must be created at the **sub-task level**, with `parent` = the Feature's key. There is no 4th level — a sub-task's own micro-steps go in a checklist in its description.

**Create each sub-task** with `createJiraIssue` (required: `cloudId`, `projectKey`, `issueTypeName`, `summary`):
- `issueTypeName` = the sub-task-level type from metadata.
- `parent` = the Feature's key.
- `description` = the sub-task template (`contentFormat: "markdown"`); acceptance criteria as a checklist.
- Tag AFK/HITL and the epic name as labels via `additional_fields`, e.g. `{"labels": ["afk", "epic-<slug>"]}`. Keep these strings consistent with `triage` and `create-epic`.
- If a sub-task is fully specified and AFK, mark it ready for an agent using the project's agent-readiness convention (a `ready-for-agent` label, or the equivalent status via a transition — match whatever `triage` uses).

**Dependency links** with `createIssueLink` (confirm the `Blocks` type via `getIssueLinkTypes`): for "A is blocked by B" → `type: "Blocks"`, `inwardIssue: B` (blocker), `outwardIssue: A` (blocked). Link sub-task-to-sub-task within the Feature.

**GitHub linkage.** Remind the user to put the issue key in branch names (`PROJ-124-...`), commit messages, and PR titles so the JIRA↔GitHub app links code and PRs to each sub-task automatically.

</jira-mechanics>
