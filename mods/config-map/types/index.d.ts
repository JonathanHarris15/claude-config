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
}

/** The description read out of a skill's own file, once it is picked. */
export type Detail = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'config-map': {
      scan: Shaped<Scan | null>
      view: Shaped<'skills' | 'config'>
      pick: Shaped<string>
      detail: Shaped<Detail | null>
      shut: Shaped<string[]>
      isBusy: Shaped<boolean>
    }
  }
}
