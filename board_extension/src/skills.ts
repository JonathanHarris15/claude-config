import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** One entry in the slash menu. */
export interface Command {
  name: string;
  description: string;
  argumentHint: string;
  /** Where it came from, so the menu can group and the user can tell them apart. */
  source: 'skill' | 'project' | 'built-in';
}

/**
 * A live session can be asked what commands it has, but only once it exists,
 * and starting one costs real money. So the menu is seeded by reading the
 * skill files directly and replaced by the session's own list once there is
 * one to ask.
 */
export function listSkills(cwd?: string): Command[] {
  const roots: { dir: string; source: Command['source'] }[] = [
    { dir: path.join(os.homedir(), '.claude', 'skills'), source: 'skill' }
  ];
  if (cwd) {
    roots.push({ dir: path.join(cwd, '.claude', 'skills'), source: 'project' });
  }

  const found = new Map<string, Command>();
  for (const root of roots) {
    for (const command of readSkillDir(root.dir, root.source)) {
      // A project skill of the same name wins, matching how Claude Code resolves.
      found.set(command.name, command);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readSkillDir(dir: string, source: Command['source']): Command[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const commands: Command[] = [];
  for (const entry of entries) {
    const file = path.join(dir, entry, 'SKILL.md');
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const front = frontmatter(text);
    commands.push({
      name: front.name || entry,
      description: collapse(front.description || ''),
      argumentHint: front['argument-hint'] || '',
      source
    });
  }
  return commands;
}

/**
 * A deliberately small YAML reader: these files only carry flat string keys,
 * and folded blocks written with `>` or `|`. Anything richer is not ours.
 */
function frontmatter(raw: string): Record<string, string> {
  // Some SKILL.md files are CRLF. In a JS regex `.` does not match a carriage
  // return, so a stray one makes every key on the line fail to parse.
  const text = raw.split(String.fromCharCode(13)).join('');
  if (!text.startsWith('---')) {
    return {};
  }
  const end = text.indexOf('\n---', 3);
  if (end < 0) {
    return {};
  }

  const out: Record<string, string> = {};
  const lines = text.slice(3, end).split('\n');
  let key = '';

  for (const line of lines) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) {
      key = match[1];
      const value = match[2].trim();
      out[key] = value === '>' || value === '|' || value === '>-' || value === '|-' ? '' : strip(value);
      continue;
    }
    // a continuation line of a folded block
    if (key && /^\s+\S/.test(line)) {
      out[key] = (out[key] ? out[key] + ' ' : '') + line.trim();
    }
  }
  return out;
}

function strip(value: string): string {
  const quoted = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
  return quoted ? quoted[1] : value;
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
