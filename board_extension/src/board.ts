import * as vscode from 'vscode';
import { fromAdf } from './adf';
import { twgJson } from './twg';

/**
 * The six columns from BOARD.md, in workflow order. The order JIRA shows
 * is cosmetic; this is the contract.
 */
/**
 * The stages a ticket moves through, left to right. A transition is made by
 * name, so every one of these has to exist as a status in each space's JIRA
 * workflow — a column JIRA does not have will draw fine and refuse the drop.
 *
 * Three of them exist because the work produces those states and there was
 * nowhere to put them: a plan that has not been stress-tested yet, work that
 * is finished but has nobody looking at it, and work the merge queue sent
 * back. Without the last one a rejected ticket sits in In Review looking ready.
 */
export const COLUMNS = [
  'To Plan',
  'Needs Grilling',
  'To Do',
  'On Deck',
  'In Progress',
  'Ready for Review',
  'In Review',
  'Changes Requested',
  'Done'
] as const;

export type Column = (typeof COLUMNS)[number];

export interface Ticket {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  type: string;
  priority: string;
  url: string;
  created: string;
  updated: string;
  labels: string[];
  /** The epic this ticket belongs to. Epics are grouping; they are never cards. */
  epicKey?: string;
  epicName?: string;
}

interface RawIssue {
  key: string;
  summary: string;
  url?: string;
  status?: { name?: string; statusCategory?: { name?: string } };
  issueType?: { name?: string };
  priority?: { name?: string };
  labels?: string[];
  created?: string;
  updated?: string;
}

/**
 * Only level-0 items are cards. Epics are grouping and sub-tasks render
 * inside their parent, so both are excluded here rather than filtered in
 * the UI — otherwise the column counts lie.
 */
function boardJql(project: string, doneWindowDays: number): string {
  return [
    `project = "${project}"`,
    'AND issuetype != Epic',
    'AND issuetype not in subTaskIssueTypes()',
    `AND (statusCategory != Done OR updated >= -${doneWindowDays}d)`,
    'ORDER BY updated DESC'
  ].join(' ');
}

function normalise(raw: RawIssue): Ticket {
  return {
    key: raw.key,
    summary: raw.summary ?? '',
    status: raw.status?.name ?? 'Unknown',
    statusCategory: raw.status?.statusCategory?.name ?? '',
    type: raw.issueType?.name ?? '',
    priority: raw.priority?.name ?? '',
    url: raw.url ?? '',
    created: raw.created ?? '',
    updated: raw.updated ?? '',
    labels: raw.labels ?? []
  };
}

/** The space shown when nothing has been picked yet. */
export function defaultSpace(): string {
  return vscode.workspace.getConfiguration('board').get<string>('project') || 'METH';
}

export async function fetchBoard(project: string): Promise<Ticket[]> {
  const config = vscode.workspace.getConfiguration('board');
  const doneWindow = config.get<number>('doneWindowDays') ?? 14;

  const result = await twgJson<{ issues?: RawIssue[] }>([
    'jira',
    'workitem',
    'query',
    '--jql',
    boardJql(project, doneWindow),
    '-n',
    '200'
  ]);

  return enrich((result.issues ?? []).map(normalise));
}

export interface TimelineEntry {
  kind: 'change' | 'comment';
  at: string;
  who: string;
  text: string;
}

export interface SubTask {
  key: string;
  summary: string;
  status: string;
  done: boolean;
}

export interface TicketDetail {
  key: string;
  labels: string[];
  description: string;
  /** True when the JIRA description holds something Markdown cannot carry. */
  descriptionLossy: boolean;
  /** Which node types would be lost, so the panel can say why it will not save. */
  descriptionUnsupported: string[];
  hasPrd: boolean;
  subtasks: SubTask[];
  timeline: TimelineEntry[];
}

/**
 * BOARD.md's integrity rule: a ticket may not sit right of To Plan without
 * a PRD, and a PRD is the to-prd template - both headings present. A wall
 * of prose, however long, is not one.
 */
function looksLikePrd(description: string): boolean {
  const text = description.toLowerCase();
  return text.includes('problem statement') && text.includes('acceptance criteria');
}

/**
 * The board query uses a lean field set that omits labels and description,
 * so full detail is a second call made only for the selected ticket.
 */
export async function fetchDetail(key: string): Promise<TicketDetail> {
  const raw = await twgJson<any>(['jira', 'workitem', 'get', key]);
  const issue = Array.isArray(raw) ? raw[0] : raw.issues ? raw.issues[0] : raw;

  const description = fromAdf(issue.description ?? '');
  const subtasks: SubTask[] = (issue.subtasks ?? []).map((sub: any) => ({
    key: sub.key,
    summary: sub.fields?.summary ?? sub.summary ?? '',
    status: sub.fields?.status?.name ?? sub.status?.name ?? '',
    done:
      (sub.fields?.status?.statusCategory?.name ?? sub.status?.statusCategory?.name ?? '') === 'Done'
  }));

  const timeline = await fetchChangelog(key);
  for (const comment of issue.comment?.comments ?? []) {
    timeline.push({
      kind: 'comment',
      at: comment.created ?? '',
      who: comment.author?.displayName ?? 'unknown',
      text: plainText(comment.body ?? '')
    });
  }
  timeline.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    key,
    labels: issue.labels ?? [],
    description: description.markdown,
    descriptionLossy: description.lossy,
    descriptionUnsupported: description.unsupported,
    hasPrd: looksLikePrd(description.markdown),
    subtasks,
    timeline
  };
}

/** Status transitions and field edits - the durable half of the timeline. */
async function fetchChangelog(key: string): Promise<TimelineEntry[]> {
  const entries: TimelineEntry[] = [];
  let log: any;
  try {
    log = await twgJson<any>(['jira', 'workitem', 'changelog', 'query', '--issue-id', key, '--first', '100']);
  } catch {
    return entries;
  }

  for (const entry of collect(log, ['changelog', 'histories', 'values', 'nodes', 'edges'])) {
    const node = entry.node ?? entry;
    const who = node.author?.displayName ?? 'unknown';
    const at = node.created ?? node.timestamp ?? '';
    for (const item of node.items ?? []) {
      const field = item.field ?? item.fieldId ?? 'field';
      const from = item.fromString ?? item.from ?? '';
      const to = item.toString ?? item.to ?? '';
      entries.push({
        kind: 'change',
        at,
        who,
        text:
          field === 'status'
            ? `${from} → ${to}`
            : `${field}: ${from || 'empty'} → ${to || 'empty'}`
      });
    }
  }
  return entries;
}

/** twg wraps payloads differently per command; find the first array we recognise. */
function collect(payload: any, keys: string[]): any[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  for (const key of keys) {
    if (Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  for (const value of Object.values(payload)) {
    const found = collect(value, keys);
    if (found.length) {
      return found;
    }
  }
  return [];
}

const NEWLINE = String.fromCharCode(10);

/** Descriptions and comments arrive as Atlassian Document Format or HTML. */
function plainText(body: any): string {
  if (typeof body === 'string') {
    return body.replace(/<[^>]+>/g, ' ').replace(/[ 	]+/g, ' ').trim();
  }
  if (!body || typeof body !== 'object') {
    return '';
  }
  if (typeof body.text === 'string') {
    return body.text;
  }
  const children = body.content ?? [];
  if (!Array.isArray(children)) {
    return '';
  }
  const separator = body.type === 'paragraph' || body.type === 'heading' ? NEWLINE : ' ';
  return children.map(plainText).join(separator).trim();
}

/**
 * Move a ticket to a column. Transitions accept the target status by name, so
 * the column labels in COLUMNS are passed straight through.
 */
export async function moveTicket(key: string, column: string): Promise<void> {
  await twgJson(['jira', 'workitem', 'transition', '--id', key, '--transition-id', column]);
}

/** Where an agent working this space should run. */
export function repoFor(space: string): string | undefined {
  const repos = vscode.workspace.getConfiguration('board').get<Record<string, string>>('repos');
  return repos?.[space];
}

/**
 * Write a new description back to JIRA as Markdown. Only ever called when the
 * round trip was clean — see fromAdf.
 */
export async function updateDescription(key: string, markdown: string): Promise<void> {
  await twgJson([
    'jira',
    'workitem',
    'update',
    '--id',
    key,
    '--description',
    markdown,
    '--description-format',
    'markdown'
  ]);
}

/** Rename a ticket. The summary is the one field the board shows everywhere. */
export async function updateSummary(key: string, summary: string): Promise<void> {
  await twgJson(['jira', 'workitem', 'update', '--id', key, '--summary', summary]);
}

/**
 * The board query returns a lean field set with no parent and no labels. One
 * bulk fetch fills both in for every card at once, which is cheap enough to do
 * on every refresh and saves a call per ticket.
 */
async function enrich(tickets: Ticket[]): Promise<Ticket[]> {
  if (!tickets.length) {
    return tickets;
  }
  let raw: any;
  try {
    raw = await twgJson<any>([
      'jira',
      'workitem',
      'bulk-get',
      ...tickets.map((ticket) => ticket.key),
      '--fields',
      'summary,labels,parent'
    ]);
  } catch {
    // A board without epics is still a board.
    return tickets;
  }

  const byKey = new Map<string, any>();
  for (const row of raw?.items ?? []) {
    if (row?.ok && row.data?.key) {
      byKey.set(row.data.key, row.data);
    }
  }

  return tickets.map((ticket) => {
    const data = byKey.get(ticket.key);
    if (!data) {
      return ticket;
    }
    const parent = data.parent;
    return {
      ...ticket,
      labels: data.labels ?? ticket.labels,
      epicKey: parent?.key,
      epicName: parent?.fields?.summary ?? parent?.key
    };
  });
}

/** The level-0 issue types this space actually has. Never hardcode these. */
export async function issueTypes(space: string): Promise<string[]> {
  try {
    const raw = await twgJson<any>(['jira', 'space', 'issue-types', '--id-or-key', space]);
    const list: any[] = Array.isArray(raw)
      ? raw
      : raw.issueTypes ?? raw.values ?? Object.values(raw).find(Array.isArray) ?? [];
    const level0 = list
      .filter((type) => type.hierarchyLevel === 0 || type.hierarchyLevel === undefined)
      .map((type) => type.name)
      .filter(Boolean);
    return level0.length ? level0 : ['Task'];
  } catch {
    return ['Task'];
  }
}

/**
 * Make a ticket. Everything lands in the inbox first, then moves to the column
 * it was asked for, because that is the transition JIRA actually offers.
 */
export async function createTicket(options: {
  space: string;
  type: string;
  summary: string;
  epic?: string;
  column?: string;
}): Promise<string> {
  const args = [
    'jira',
    'workitem',
    'create',
    '--space',
    options.space,
    '--type',
    options.type,
    '--summary',
    options.summary
  ];
  if (options.epic) {
    args.push('--parent', options.epic);
  }

  const created = await twgJson<any>(args);
  const key: string | undefined = created?.key ?? created?.issue?.key ?? created?.data?.key;
  if (!key) {
    throw new Error('JIRA did not return a key for the new ticket.');
  }

  // Never assume where a new ticket lands. The workflow decides that, and this
  // project drops them in To Do, not the inbox. Read it back and move it only
  // if it is not already where it was asked for.
  if (options.column) {
    const landed = await statusOf(key);
    if (landed && landed !== options.column) {
      await moveTicket(key, options.column);
    }
  }
  return key;
}

/** Where a ticket actually is, straight from JIRA. */
async function statusOf(key: string): Promise<string | undefined> {
  try {
    const raw = await twgJson<any>(['jira', 'workitem', 'get', key, '--fields', 'status']);
    const issue = Array.isArray(raw) ? raw[0] : raw.issues ? raw.issues[0] : raw;
    return issue?.status?.name ?? issue?.fields?.status?.name;
  } catch {
    return undefined;
  }
}

/**
 * Delete a ticket for good. Sub-tasks go with it — they have no meaning
 * without their parent. JIRA's own permission check is the only gate here;
 * the confirmation is the extension's job before it ever calls this.
 */
export async function deleteTicket(key: string): Promise<void> {
  try {
    await twgJson(['jira', 'workitem', 'delete', key, '--delete-subtasks', 'true']);
  } catch (err) {
    // A delete may answer with nothing at all, which reads as "not JSON". The
    // ticket itself is the truth: if it is gone, the delete worked.
    if (await statusOf(key)) {
      throw err;
    }
  }
}

/**
 * Move a ticket into a different epic, or out of one entirely. Dragging a card
 * to another swimlane means exactly this.
 */
export async function setEpic(key: string, epic: string | null): Promise<void> {
  await twgJson(['jira', 'workitem', 'update', '--id', key, '--parent', epic ?? 'none']);
}
