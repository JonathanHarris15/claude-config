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
 * Every space the logged-in account can see. This is the sidebar list; picking
 * one opens its board in the editor.
 */
export async function fetchSpaces(): Promise<Space[]> {
  const raw = await twgJson<any>(['jira', 'space', 'query']);
  const list: RawSpace[] = Array.isArray(raw)
    ? raw
    : raw.spaces ?? raw.projects ?? raw.values ?? firstArray(raw);

  return list
    .filter((space) => space && space.key)
    .map((space) => ({
      key: space.key,
      name: space.name ?? space.key,
      type: space.projectTypeKey ?? ''
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function firstArray(payload: any): any[] {
  for (const value of Object.values(payload ?? {})) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}
