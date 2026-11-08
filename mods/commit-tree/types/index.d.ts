/** One branch, local or on a remote, as `git for-each-ref` reports it. */
export type Branch = {
  /** Its short name: `main`, or `origin/main` for one on a remote. */
  name: string
  /** The short hash its tip points at. */
  hash: string
  /** The branch it tracks, when it tracks one. */
  upstream: string
  /** How far it sits from what it tracks, in git's own words. */
  track: string
  /** True for a branch on a remote. */
  isRemote: boolean
  /** True for the branch now checked out. */
  isHead: boolean
  /** When its tip was committed, in seconds since 1970. */
  time: number
  /** The first line of its tip commit. */
  subject: string
}

/** A name hanging off a commit, and what kind of name it is. */
export type Pill = {
  kind: 'head' | 'local' | 'remote' | 'tag'
  name: string
}

/** One drawn row: a commit, or a piece of the rails on its own. */
export type Row = {
  /** The railroad art git drew at the row's left end, colour codes taken out. */
  rails: string
  /** Git's lane colour for each character of the rails, 0-5, or -1 for none. */
  railColors: number[]
  /** The commit's short hash; empty on a rails-only row. */
  hash: string
  /** Its parents' short hashes, first parent first. */
  parents: string[]
  /** The names hanging off this commit. */
  pills: Pill[]
  /** When it was committed, in seconds since 1970. */
  time: number
  /** Who wrote it. */
  who: string
  /** Its first line. */
  subject: string
  /** True when no remote branch has it yet: it is only on this computer. */
  isLocal: boolean
}

/** What is changed in the folder but not yet committed, by kind. */
export type Pending = {
  /** Files staged for the next commit. */
  staged: number
  /** Tracked files changed but not staged. */
  changed: number
  /** Files git does not track yet. */
  added: number
  /** Files caught in a merge conflict. */
  conflicts: number
}

/** Everything the pane draws, read in one pass. */
export type Tree = {
  /** The branch checked out, or empty when the head is detached. */
  head: string
  /** The short hash the head points at. */
  headHash: string
  /** How many files differ from the head. */
  dirty: number
  /** The same files, by kind. */
  pending: Pending
  /** Commits the head has that its upstream has not. */
  ahead: number
  /** Commits the upstream has that the head has not. */
  behind: number
  /** What the head tracks, when it tracks anything. */
  upstream: string
  /** Every local and remote branch, newest tip first. */
  branches: Branch[]
  /** The tree, newest at the top. */
  rows: Row[]
  /** True when there were more commits than the cap. */
  isTruncated: boolean
  /** Why nothing could be read, when nothing could. */
  trouble: string
  /** The folder it was read from. */
  where: string
}

declare module 'claude-code' {
  interface PluginState {
    'commit-tree': {
      tree: Shaped<Tree | null>
      isReading: Shaped<boolean>
    }
  }
}
