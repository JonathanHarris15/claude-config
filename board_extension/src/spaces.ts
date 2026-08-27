import * as vscode from 'vscode';
import { twgJson } from './twg';

/** A JIRA space — what JIRA used to call a project, and what a board is of. */
export interface Space {
  key: string;
  name: string;
  type: string;
}

interface RawSpace {
  key: string;
  name?: string;
  projectTypeKey?: string;
}

/**
 * The spaces the sidebar offers. twg has no command that lists every space an
 * account can see — `jira space` only reads one by key — so the board asks
 * about the keys it already knows: everything mapped in `board.repos`, plus
 * `board.project`. A key JIRA refuses is dropped, but if every key fails the
 * error is raised, because that is auth rather than a bad key.
 */
export async function fetchSpaces(): Promise<Space[]> {
  const config = vscode.workspace.getConfiguration('board');
  const repos = config.get<Record<string, string>>('repos') ?? {};
  const fallback = config.get<string>('project') || 'METH';
  const keys = [...new Set([...Object.keys(repos), fallback])].filter(Boolean);

  const results = await Promise.all(keys.map(readSpace));
  const spaces = results.filter((result): result is Space => !(result instanceof Error));

  if (!spaces.length) {
    const failure = results.find((result): result is Error => result instanceof Error);
    if (failure) {
      throw failure;
    }
  }

  return spaces.sort((a, b) => a.key.localeCompare(b.key));
}

/** One space, or the reason it could not be read. */
async function readSpace(key: string): Promise<Space | Error> {
  try {
    const raw = await twgJson<any>(['jira', 'space', 'get', key]);
    const space: RawSpace | undefined = Array.isArray(raw) ? raw[0] : raw;
    if (!space?.key) {
      return new Error(`twg returned no space for ${key}.`);
    }
    return {
      key: space.key,
      name: space.name ?? space.key,
      type: space.projectTypeKey ?? ''
    };
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}
