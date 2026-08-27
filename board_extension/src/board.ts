import * as vscode from 'vscode';
import { fromAdf } from './adf';
import { twgJson } from './twg';

/**
 * The six columns from BOARD.md, in workflow order. The order JIRA shows
 * is cosmetic; this is the contract.
 */
export const COLUMNS = [
  'To Plan',
  'To Do',
  'On Deck',
  'In Progress',
  'In Review',
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

  return (result.issues ?? []).map(normalise);
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
