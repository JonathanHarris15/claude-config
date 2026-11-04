/** Where a skill came from, which decides whether the config repo can hold it. */
export type SkillOrigin = 'repo' | 'local' | 'synced' | 'plugin'

/** One skill found on disk. */
export type SkillRow = {
  id: string
  name: string
  origin: SkillOrigin
  /** The plugin or bucket it belongs to; empty for a skill of your own. */
  owner: string
  /** Relative to the config root, so it reads the same on either machine. */
  path: string
  isTracked: boolean
  /**
   * What the skill says it does, out of its own SKILL.md, on one line. Read in
   * a second pass, so it is empty until that pass lands.
   */
  gist: string
}

/** One entry at the top of the config folder. */
export type ConfigRow = {
  id: string
  name: string
  kind: 'file' | 'dir' | 'other'
  isTracked: boolean
  /** How many files under it the repo tracks. */
  trackedCount: number
  /** What the thing is, in plain words. */
  note: string
}

/** Everything one sweep of the disk found. */
export type Scan = {
  at: number
  root: string
  branch: string
  trackedFiles: number
  dirtyFiles: number
  skills: SkillRow[]
  config: ConfigRow[]
  /** Anything that went wrong, said plainly. */
  troubles: string[]
  /** Whether the second pass has filled the skills' descriptions in. */
  isTold: boolean
}

/**
 * A group part way open: how many of its rows are drawn right now, and how
 * many it is heading for. There is no transition prop on any element, so the
 * unrolling is this count stepped over a handful of frames.
 */
export type Reveal = { origin: string; shown: number; to: number }

/** What came of adding one skill to the repo, said in plain words. */
export type Added = {
  /** The skill it speaks for, so a stale message never sits under another. */
  id: string
  ok: boolean
  text: string
}

declare module 'claude-code' {
  interface PluginState {
    'config-map': {
      scan: Shaped<Scan | null>
      view: Shaped<'skills' | 'config'>
      pick: Shaped<string>
      shut: Shaped<string[]>
      isBusy: Shaped<boolean>
      added: Shaped<Added | null>
      find: Shaped<string>
      anim: Shaped<Reveal | null>
    }
  }
}
