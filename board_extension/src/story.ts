import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatEntry, sdk } from './agent';
import { Ticket, TicketDetail } from './board';

/**
 * A ticket's history, told as a story: what happened, the decisions made and
 * why. The log tab already holds every transition and comment; this is the
 * retelling a person can actually read. Claude writes it on request from the
 * log, the description and the agent conversation, and it is cached in the
 * repo next to the conversations so it costs nothing to reopen.
 */
export interface Story {
  key: string;
  markdown: string;
  writtenAt: string;
  /** How many log entries existed when it was written, so staleness is cheap to see. */
  entries: number;
}

function folder(repo: string): string {
  const conversations =
    vscode.workspace.getConfiguration('board').get<string>('conversationDir') ||
    '.board/conversations';
  const parts = conversations.split(/[\/]/);
  parts[parts.length - 1] = 'history';
  return path.join(repo, ...parts);
}

const HEADER = /^<!-- board-story written=(\S+) entries=(\d+) -->\r?\n/;

export function loadStory(repo: string, key: string): Story | undefined {
  try {
    const raw = fs.readFileSync(path.join(folder(repo), `${key}.md`), 'utf8');
    const head = HEADER.exec(raw);
    if (!head) {
      return undefined;
    }
    return { key, writtenAt: head[1], entries: Number(head[2]), markdown: raw.slice(head[0].length) };
  } catch {
    return undefined;
  }
}

export function saveStory(repo: string, story: Story): void {
  const dir = folder(repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${story.key}.md`),
    `<!-- board-story written=${story.writtenAt} entries=${story.entries} -->\n${story.markdown}`
  );
}

/**
 * The voice is the /wait-what skill's: ASD-STE100 Simplified Technical
 * English, and the project's own words. The shape is a history's, not a
 * re-pitch's — where it stands, what happened, what was decided and why.
 */
const VOICE = [
  'You write the history of one ticket for the person who owns the project.',
  'Write in ASD-STE100 Simplified Technical English: sentences of at most 20 words,',
  'one idea per sentence, active voice, simple everyday words. Use the past tense',
  'for events and the present tense for the current state. Use only the project',
  'words from the glossary you are given; do not invent terms and do not use',
  'jargon the glossary does not use.',
  '',
  'Answer in Markdown with exactly these headings and nothing before the first:',
  '',
  '## Where it stands',
  'One or two sentences: which column, what is finished, what is waiting.',
  '',
  '## What happened',
  'Dated lines, oldest first, each `**YYYY-MM-DD** — ` then one to three sentences.',
  'Only events that changed the ticket: planned, specced, moved, built, reviewed,',
  'reparented, blocked. Merge trivial field edits into the event they belong to,',
  'or drop them.',
  '',
  '## Decisions',
  'One bullet per decision: `**The decision.** Why it was made.` Take these from',
  'the description, the comments and the conversation. If there are none, write',
  '`No decisions recorded yet.`',
  '',
  '## Open',
  'What is unresolved or waiting on a person. Leave this heading out entirely if',
  'nothing is open.',
  '',
  'At most 250 words. No preamble, no closing summary, no extra headings.'
].join('\n');

export interface StoryInput {
  ticket: Ticket;
  detail: TicketDetail;
  transcript: ChatEntry[];
  /** The repo the ticket belongs to; CONTEXT.md is read from here. */
  repo: string;
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '\n…' : text;
}

function glossary(repo: string): string {
  try {
    return clip(fs.readFileSync(path.join(repo, 'CONTEXT.md'), 'utf8'), 6000);
  } catch {
    return '(no CONTEXT.md in this repo — use the words the ticket itself uses)';
  }
}

function brief(input: StoryInput): string {
  const { ticket, detail, transcript } = input;
  const log = detail.timeline
    .map((entry) => `- ${entry.at.slice(0, 16)} · ${entry.who} · ${entry.kind}: ${clip(entry.text, 400)}`)
    .join('\n');

  // Tool lines are noise for a history; the words between them are the story.
  const said = transcript
    .filter((entry) => entry.role !== 'tool')
    .map((entry) => `${entry.role} (${entry.at.slice(0, 16)}): ${clip(entry.text, 700)}`)
    .join('\n\n');

  const subtasks = detail.subtasks.length
    ? detail.subtasks.map((sub) => `- [${sub.done ? 'x' : ' '}] ${sub.summary}`).join('\n')
    : '(none)';

  return [
    `# Ticket`,
    `${ticket.key} · ${ticket.type} · now in ${ticket.status}`,
    `Summary: ${ticket.summary}`,
    ticket.epicName ? `Epic: ${ticket.epicName}` : '',
    ticket.labels.length ? `Labels: ${ticket.labels.join(', ')}` : '',
    `Created ${ticket.created.slice(0, 10)}, last updated ${ticket.updated.slice(0, 10)}`,
    '',
    `# Description`,
    clip(detail.description || '(empty)', 6000),
    '',
    `# Sub-tasks`,
    subtasks,
    '',
    `# Log (transitions and comments, oldest first)`,
    log || '(nothing recorded)',
    '',
    `# Agent conversation`,
    clip(said || '(no conversation yet)', 14000),
    '',
    `# Glossary (CONTEXT.md)`,
    glossary(input.repo)
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** One turn, no tools, a small model: a story should cost cents, not dollars. */
export async function tellStory(input: StoryInput): Promise<Story> {
  const { query } = await sdk();
  const model = vscode.workspace.getConfiguration('board').get<string>('storyModel') || undefined;

  const stream = query({
    prompt: brief(input),
    options: {
      cwd: input.repo,
      tools: [],
      maxTurns: 1,
      settingSources: [],
      systemPrompt: VOICE,
      ...(model ? { model } : {})
    }
  });

  let text = '';
  let final = '';
  for await (const message of stream) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text') {
          text += block.text;
        }
      }
    }
    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        throw new Error(`Claude could not write the story: ${message.subtype}`);
      }
      final = typeof message.result === 'string' ? message.result : '';
    }
  }

  const markdown = (final || text).trim();
  if (!markdown) {
    throw new Error('Claude returned an empty story.');
  }
  return {
    key: input.ticket.key,
    markdown,
    writtenAt: new Date().toISOString(),
    entries: input.detail.timeline.length
  };
}
