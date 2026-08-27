import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Per-space working notes: how tickets move in this space, and what to know
 * before touching one. Every space works slightly differently — what counts as
 * ready, who reviews, which labels mean something — and none of that fits in a
 * ticket or in the code.
 *
 * They live in ~/.claude/board rather than in the space's repo, so a space with
 * no repo configured still gets a page, and so they travel between machines
 * with the rest of the config. One rule, no exceptions to remember.
 */
export function notesPath(space: string): string {
  return path.join(os.homedir(), '.claude', 'board', `${space}.md`);
}

/** The page a space starts with: headings to answer, not answers. */
function template(space: string, name: string): string {
  return [
    `# ${space} — working notes`,
    '',
    `${name}. How tickets move in this space, and what to know before you take`,
    'one. Written for whoever picks up a ticket next, which is usually you.',
    '',
    '## Before a ticket leaves To Plan',
    '',
    'What has to be true. What a PRD in this space has to answer that a PRD',
    'elsewhere would not.',
    '',
    '## Working a ticket',
    '',
    'Where the code lives, what to run before you believe it works, anything an',
    'agent gets wrong here if nobody tells it.',
    '',
    '## Review and merge',
    '',
    'Who or what reviews. What the merge queue should refuse. Which labels mean',
    'something — `hold`, and any others this space uses.',
    '',
    '## Things that have bitten us',
    '',
    'One line each. Delete them once they stop being true.',
    ''
  ].join('\n');
}

/**
 * Open a space's notes, writing the starting page first if there is none. It is
 * opened as source rather than preview: it exists to be edited, and an empty
 * preview looks like a broken feature rather than a page waiting for you.
 */
export async function openNotes(space: string, name: string): Promise<void> {
  const file = notesPath(space);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, template(space, name), 'utf8');
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc, { preview: false });
}
