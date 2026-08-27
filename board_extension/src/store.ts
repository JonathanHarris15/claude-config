import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatEntry } from './agent';

/**
 * A ticket's conversation, kept in the repo the agent works in rather than in
 * memory. Closing the window, or the whole editor, must not lose what an agent
 * did — and a conversation about a repo belongs next to that repo.
 */
export interface StoredConversation {
  ticket: string;
  space: string;
  /** The Claude session to resume, so the model has not forgotten either. */
  sessionId?: string;
  permissionMode: string;
  model?: string;
  transcript: ChatEntry[];
  updatedAt: string;
}

function folder(repo: string): string {
  const configured =
    vscode.workspace.getConfiguration('board').get<string>('conversationDir') ||
    '.board/conversations';
  return path.join(repo, ...configured.split(/[\/]/));
}

function file(repo: string, ticket: string): string {
  return path.join(folder(repo), `${ticket}.json`);
}

export function load(repo: string, ticket: string): StoredConversation | undefined {
  try {
    const raw = fs.readFileSync(file(repo, ticket), 'utf8');
    const parsed = JSON.parse(raw) as StoredConversation;
    return parsed && Array.isArray(parsed.transcript) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function save(repo: string, conversation: StoredConversation): void {
  try {
    const dir = folder(repo);
    fs.mkdirSync(dir, { recursive: true });
    ensureReadme(dir);
    fs.writeFileSync(
      file(repo, conversation.ticket),
      JSON.stringify({ ...conversation, updatedAt: new Date().toISOString() }, null, 2)
    );
    fs.writeFileSync(path.join(dir, `${conversation.ticket}.md`), asMarkdown(conversation));
  } catch {
    // A conversation that cannot be written is not worth killing the session
    // over; the transcript is still live in the panel.
  }
}

export function list(repo: string): string[] {
  try {
    return fs
      .readdirSync(folder(repo))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

/** A readable mirror, so the log is worth opening without a JSON viewer. */
function asMarkdown(conversation: StoredConversation): string {
  const lines = [
    `# ${conversation.ticket}`,
    '',
    `Space ${conversation.space} · permission ${conversation.permissionMode}` +
      (conversation.model ? ` · model ${conversation.model}` : '') +
      ` · updated ${conversation.updatedAt}`,
    ''
  ];
  for (const entry of conversation.transcript) {
    lines.push(`### ${entry.role} · ${entry.at}`, '', entry.text, '');
  }
  return lines.join('\n');
}

function ensureReadme(dir: string): void {
  const readme = path.join(dir, 'README.md');
  if (fs.existsSync(readme)) {
    return;
  }
  fs.writeFileSync(
    readme,
    [
      '# Agent conversations',
      '',
      'Written by the Board VS Code extension. One pair of files per ticket:',
      '',
      '- `<TICKET>.json` — the state the panel reloads, including the Claude',
      '  session id so the conversation can be resumed rather than restarted.',
      '- `<TICKET>.md` — the same conversation, readable.',
      '',
      'Safe to delete: a missing file just starts that ticket fresh. Commit them',
      'if you want the reasoning in history, ignore them if you do not.',
      ''
    ].join('\n')
  );
}
