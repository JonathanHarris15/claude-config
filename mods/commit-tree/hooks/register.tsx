import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Branch, Pending, Pill, Row, Tree } from '../types'
import { ago, drawGraph, foldPills, hasPending, pendingWords } from './graph'

const PANE = 'commit-tree'
/** How many commits to draw before the pane says it stopped. */
const CAP = 200
/** Between the fields of `for-each-ref`. Git refuses `~` in a ref name. */
const SEP = '|~|'
/** Between the fields of `log`, written by its own `%x1f`. */
const UNIT = '\u001f'
/** Widest rails the columns line up behind; a wider one pushes its row out. */
const RAILS_ROOM = 14
/** Git's own colour codes, red to cyan, as the terminal theme draws them. */
const RAIL_THEME: Color[] = ['claude', 'success', 'warning', 'suggestion', 'permission', 'planMode']
/** How stale a reading may be before a redraw reads again. */
const STALE_MS = 15000

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tree = atom({ plugin: 'commit-tree', key: 'tree' } as const, null as Tree | null, {
  shape: 'tree-3',
})
const isReading = atom({ plugin: 'commit-tree', key: 'isReading' } as const, false, {
  shape: 'reading-1',
})

/** Run git and say plainly whether it worked. */
async function git(
  $: EngineInterface,
  args: readonly string[],
): Promise<{ ok: boolean; out: string; err: string }> {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: 20000 })

    return {
      ok: ran.exitCode === 0,
      out: ran.stdout,
      err: ran.stderr.trim().split(/\r?\n/)[0] ?? '',
    }
  } catch (err) {
    return { ok: false, out: '', err: String(err) }
  }
}

/** What `git status --porcelain=v2 --branch` says about the head. */
export function readStatus(out: string) {
  let head = ''
  let oid = ''
  let upstream = ''
  let ahead = 0
  let behind = 0
  let dirty = 0
  const pending: Pending = { staged: 0, changed: 0, added: 0, conflicts: 0 }

  for (const line of out.split(/\r?\n/)) {
    if (!line) continue
    if (!line.startsWith('#')) {
      dirty += 1
      // `1 XY` and `2 XY` name a tracked file: X staged, Y not; `.` is neither.
      const kind = line[0]
      const xy = line.slice(2, 4)
      if (kind === '?') pending.added += 1
      else if (kind === 'u') pending.conflicts += 1
      else if (kind === '1' || kind === '2') {
        if (xy[0] && xy[0] !== '.') pending.staged += 1
        if (xy[1] && xy[1] !== '.') pending.changed += 1
      }
      continue
    }
    const parts = line.split(' ')
    const key = parts[1] ?? ''
    if (key === 'branch.oid') oid = parts[2] ?? ''
    else if (key === 'branch.head') head = parts[2] ?? ''
    else if (key === 'branch.upstream') upstream = parts[2] ?? ''
    else if (key === 'branch.ab') {
      ahead = Number((parts[2] ?? '+0').slice(1)) || 0
      behind = Number((parts[3] ?? '-0').slice(1)) || 0
    }
  }
  // Git's own word for a head sitting on no branch.
  if (head === '(detached)') head = ''

  return { head, oid, upstream, ahead, behind, dirty, pending }
}

const REF_FIELDS = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname:short)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(HEAD)',
  '%(committerdate:unix)',
  '%(contents:subject)',
].join(SEP)

/** Every branch here and on a remote, newest tip first. */
export function readBranches(out: string): Branch[] {
  const list: Branch[] = []

  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [full = '', name = '', hash = '', upstream = '', track = '', mark = '', time = '', ...rest] =
      line.split(SEP)
    // `origin/HEAD` points at a remote's default branch; it is not a branch.
    // Check the full name: git shortens this one to just `origin`.
    if (!name || full.endsWith('/HEAD')) continue
    list.push({
      name,
      hash,
      upstream,
      track: track.trim(),
      isRemote: full.startsWith('refs/remotes/'),
      isHead: mark.trim() === '*',
      time: Number(time) || 0,
      subject: rest.join(SEP),
    })
  }

  return list
}

/** Sort the names hanging off one commit into the four kinds. */
export function readPills(decor: string, remotes: ReadonlySet<string>): Pill[] {
  if (!decor.trim()) return []
  const pills: Pill[] = []

  for (const raw of decor.split(',')) {
    const piece = raw.trim()
    if (!piece) continue
    if (piece.startsWith('HEAD -> ')) pills.push({ kind: 'head', name: piece.slice(8) })
    else if (piece === 'HEAD') pills.push({ kind: 'head', name: 'HEAD' })
    else if (piece.startsWith('tag: ')) pills.push({ kind: 'tag', name: piece.slice(5) })
    else if (remotes.has(piece.split('/')[0] ?? '')) pills.push({ kind: 'remote', name: piece })
    else pills.push({ kind: 'local', name: piece })
  }

  return pills
}

/**
 * Take git's colour codes out of a line, keeping which of its six lane
 * colours each character had: 0 for red through 5 for cyan, -1 for none.
 */
export function readColors(line: string): { plain: string; colors: number[] } {
  let plain = ''
  const colors: number[] = []
  let now = -1
  const codes = /\u001b\[([0-9;]*)m/g
  let from = 0
  for (let found = codes.exec(line); found; found = codes.exec(line)) {
    const text = line.slice(from, found.index)
    plain += text
    for (let i = 0; i < text.length; i += 1) colors.push(now)
    const parts = (found[1] ?? '').split(';').map(Number)
    const hue = parts.find(n => n >= 30 && n <= 37)
    now = hue === undefined ? (parts.every(n => !n) ? -1 : now) : (hue - 31 + 6) % 6
    from = codes.lastIndex
  }
  const rest = line.slice(from)
  plain += rest
  for (let i = 0; i < rest.length; i += 1) colors.push(now)

  return { plain, colors }
}

/** Turn git's drawn log into rows, newest first, stopping at the cap. */
export function readRows(out: string, remotes: ReadonlySet<string>) {
  const rows: Row[] = []
  let commits = 0
  let isTruncated = false

  for (const raw of out.split(/\r?\n/)) {
    const { plain: line, colors } = readColors(raw)
    const cut = line.indexOf(UNIT)
    if (cut < 0) {
      // Rails alone: a fork, a merge, or the gap between two lines of history.
      if (line.trim()) {
        const rails = line.trimEnd()
        rows.push({
          rails,
          railColors: colors.slice(0, rails.length),
          hash: '',
          parents: [],
          pills: [],
          time: 0,
          who: '',
          subject: '',
          isLocal: false,
        })
      }
      continue
    }
    if (commits >= CAP) {
      isTruncated = true
      break
    }
    const [, hash = '', parents = '', decor = '', time = '', who = '', ...subject] = line
      .slice(cut)
      .split(UNIT)
    commits += 1
    rows.push({
      rails: line.slice(0, cut),
      railColors: colors.slice(0, cut),
      hash,
      parents: parents.split(' ').filter(Boolean),
      pills: readPills(decor, remotes),
      time: Number(time) || 0,
      who,
      subject: subject.join(UNIT),
      isLocal: false,
    })
  }

  return { rows, isTruncated }
}

const BLANK: Tree = {
  head: '',
  headHash: '',
  dirty: 0,
  pending: { staged: 0, changed: 0, added: 0, conflicts: 0 },
  ahead: 0,
  behind: 0,
  upstream: '',
  branches: [],
  rows: [],
  isTruncated: false,
  trouble: '',
  where: '',
}

/** Read the whole picture: the head, every branch, and the drawn tree. */
async function readTree($: EngineInterface): Promise<Tree> {
  await update($, isReading, () => true)
  let result = BLANK
  try {
    result = { ...BLANK, where: await $.session.cwd() }
    const status = await git($, ['status', '--porcelain=v2', '--branch'])
    if (!status.ok) {
      result = { ...result, trouble: status.err || 'This folder is not a git repository.' }
    } else {
      const head = readStatus(status.out)
      const refs = await git($, [
        'for-each-ref',
        '--sort=-committerdate',
        '--format=' + REF_FIELDS,
        'refs/heads',
        'refs/remotes',
      ])
      const branches = refs.ok ? readBranches(refs.out) : []
      const remotes = new Set(
        branches.filter(one => one.isRemote).map(one => one.name.split('/')[0] ?? ''),
      )
      const log = await git($, [
        'log',
        '--graph',
        '--all',
        'HEAD',
        '--date-order',
        '--decorate=short',
        // Colour paints the rails alone (the format names no colour), and it is
        // how git says which lane each line belongs to.
        '--color=always',
        '--max-count=' + (CAP + 1),
        '--pretty=format:%x1f%h%x1f%p%x1f%D%x1f%ct%x1f%an%x1f%s',
      ])
      const drawn = log.ok ? readRows(log.out, remotes) : { rows: [] as Row[], isTruncated: false }
      // Commits no remote branch has yet. With no remote at all every commit
      // is local, which says nothing, so nothing is marked.
      if (remotes.size && drawn.rows.length) {
        const only = await git($, ['log', '--all', '--not', '--remotes', '--format=%h', '--max-count=5000'])
        const mine = new Set(only.ok ? only.out.split(/\r?\n/).filter(Boolean) : [])
        drawn.rows = drawn.rows.map(one => (mine.has(one.hash) ? { ...one, isLocal: true } : one))
      }
      result = {
        ...result,
        head: head.head,
        headHash: head.oid.slice(0, 7),
        dirty: head.dirty,
        pending: head.pending,
        ahead: head.ahead,
        behind: head.behind,
        upstream: head.upstream,
        branches,
        rows: drawn.rows,
        isTruncated: drawn.isTruncated,
        trouble: log.ok ? '' : log.err || 'There are no commits here yet.',
      }
    }
  } catch (err) {
    result = { ...result, trouble: String(err) }
  }
  await update($, tree, () => result)
  await update($, isReading, () => false)

  return result
}

/** Open the pane and read the tree into it. */
async function show($: EngineInterface): Promise<Tree> {
  await $.ui.open({ id: PANE, title: 'Commit tree' })

  return readTree($)
}

/** When the tree was last read, so a long-open pane stays near-live. */
let lastRead = 0

/** Where a branch stands against what it tracks, in plain words. */
export function driftWords(ahead: number, behind: number, upstream: string): string {
  if (!upstream) return 'not pushed'
  if (ahead && behind) return ahead + ' to push, ' + behind + ' to pull'
  if (ahead) return ahead + ' to push'
  if (behind) return behind + ' to pull'

  return 'in sync'
}

/** Git's `ahead 1, behind 2` or `gone`, as `driftWords` says it. */
export function trackWords(one: Branch): string {
  if (!one.upstream) return 'not pushed'
  if (one.track === 'gone') return 'its remote is gone'
  const ahead = Number(/ahead (\d+)/.exec(one.track)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(one.track)?.[1] ?? 0)

  return driftWords(ahead, behind, one.upstream)
}

/** One line saying where the head stands. */
export function headLine(t: Tree): string {
  if (t.trouble) return t.trouble
  const where = t.head || 'detached at ' + t.headHash
  const drift = t.head ? driftWords(t.ahead, t.behind, t.upstream) : ''

  return [where, drift, pendingWords(t.pending)].filter(Boolean).join(' · ')
}

/** The theme colour for a branch's drift: green in sync, yellow otherwise. */
function driftColor(words: string): Color {
  if (words === 'in sync') return 'success'
  if (words === 'its remote is gone') return 'error'

  return 'warning'
}

const PILL_COLOR: Record<Pill['kind'], Color> = {
  head: 'success',
  local: 'warning',
  remote: 'claude',
  tag: 'permission',
}

/** The terminal's own text glyphs for git's rails. */
const GLYPH: Record<string, string> = { '*': '●', '|': '│', '/': '╱', '\\': '╲' }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'commit-tree',
      description: 'Open the commit tree in a pane',
    })

    return next(e)
  })

  on('command.run', { command: 'commit-tree' }, async $ => {
    const t = await show($)

    return { text: 'Commit tree: ' + headLine(t) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    // The band is one drawing for every mod, so wrap what is drawn beneath
    // rather than answer in its place: another mod's row keeps its seat.
    const beneath = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, tree)
    const reading = await read($, isReading)

    return (
      <Box flexDirection="row" gap={1} alignItems="center">
        <Box gap={1} alignItems="center">
          <Button key="tree" onPress={() => void show($)}>
            {reading ? 'Reading…' : 'Commit tree'}
          </Button>
          {t ? <Text dimColor>{headLine(t)}</Text> : null}
        </Box>
        {beneath}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, tree)
    const reading = await read($, isReading)

    // Near-live without a timer: a redraw past the window reads again, and that
    // read's own redraw falls inside the window, so it stops there.
    if (!reading && Date.now() - lastRead > STALE_MS) {
      lastRead = Date.now()
      void readTree($).catch(() => {})
    }

    if (!t) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{'Reading the tree…'}</Text>
        </Box>
      )
    }

    if (t.trouble) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text color="error">{t.trouble}</Text>
          <Text dimColor>{t.where}</Text>
          <Button key="again" onPress={() => void readTree($)}>
            Read again
          </Button>
        </Box>
      )
    }

    const now = Date.now()
    // One list: each branch here says where it stands against its remote, and
    // a remote branch shows only when no branch here tracks it.
    const locals = t.branches.filter(one => !one.isRemote)
    const tracked = new Set(locals.map(one => one.upstream).filter(Boolean))
    const remoteOnly = t.branches.filter(one => one.isRemote && !tracked.has(one.name))
    const nameRoom = Math.min(28, Math.max(8, ...t.branches.map(one => one.name.length)))
    const commits = t.rows.filter(one => one.hash).length
    const drift = driftWords(t.ahead, t.behind, t.upstream)

    const branchRow = (one: Branch) => {
      const words = one.isRemote ? 'only on ' + one.name.split('/')[0] : trackWords(one)

      return (
        <Box key={'b-' + one.name} flexWrap="nowrap" overflow="hidden">
          <Box flexShrink={0}>
            <Text
              mono
              bold={one.isHead}
              color={one.isHead ? 'success' : undefined}
              dimColor={one.isRemote}
              wrap="truncate-end"
            >
              {(one.isHead ? '● ' : '  ') + one.name.padEnd(nameRoom) + '  '}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text
              color={one.isRemote ? undefined : driftColor(words)}
              dimColor={one.isRemote}
              wrap="truncate-end"
            >
              {words.padEnd(18)}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text mono dimColor wrap="truncate-end">
              {ago(one.time, now).padStart(3) + '  '}
            </Text>
          </Box>
          <Text dimColor wrap="truncate-end">
            {one.subject}
          </Text>
        </Box>
      )
    }

    const header = (
      <Box flexDirection="column">
        {/* A narrow pane moves a whole piece to the next line rather than
            squeezing each one into a column of single words. */}
        <Box gap={1} alignItems="center" flexWrap="wrap">
          <Box flexShrink={0}>
            <Text bold>{t.head || 'Detached at ' + t.headHash}</Text>
          </Box>
          {t.head ? (
            <Box flexShrink={0}>
              <Text color={driftColor(drift)}>
                {drift + (t.upstream ? ' with ' + t.upstream : '')}
              </Text>
            </Box>
          ) : null}
          <Box flexShrink={0}>
            <Text dimColor>{'· ' + pendingWords(t.pending)}</Text>
          </Box>
          <Button key="again" onPress={() => void readTree($)}>
            {reading ? 'Reading…' : 'Refresh'}
          </Button>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text bold>{'Branches'}</Text>
          {locals.length + remoteOnly.length === 0 ? <Text dimColor>None.</Text> : null}
          {locals.map(branchRow)}
          {remoteOnly.map(branchRow)}
        </Box>
      </Box>
    )

    // A key, only for the marks this history shows: an all-solid tree needs none.
    const hasLocal = t.rows.some(one => one.isLocal)
    const isDirty = hasPending(t.pending)
    const key =
      hasLocal || isDirty ? (
        <Box gap={2} flexWrap="wrap">
          <Text dimColor>{'● pushed'}</Text>
          {hasLocal ? <Text dimColor>{'○ only on this computer'}</Text> : null}
          {isDirty ? <Text dimColor>{'◌ not committed'}</Text> : null}
        </Box>
      ) : null

    const footer = (shown: number) =>
      shown < commits || t.isTruncated ? (
        <Text dimColor>{'Showing the newest ' + shown + ' commits.'}</Text>
      ) : null

    // A surface that draws pictures gets the tree as one: a coloured line per
    // branch, a dot per commit. Hovering a row shows its whole story.
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      // A desktop column is about 8px. Give the picture its size outright: the
      // frame that draws it is 150px tall when told nothing, and shrinks the
      // whole history into that. Guess a shade under the pane's width, never
      // over it: a picture wider than its slot is shrunk to fit and leaves a
      // gap where its height was.
      const width = Math.max(180, Math.min(1400, Math.floor(e.props.bodyColumns * 7.6)))
      const drawn = drawGraph(t.rows, width, now, t.pending)

      return (
        <Box flexDirection="column">
          {header}
          <Box marginTop={1} flexDirection="column">
            <Text bold>{'History'}</Text>
            {key}
            <Svg
              source={drawn.source}
              alt={'Commit tree of ' + drawn.shown + ' commits, newest at the top.'}
              width={drawn.width}
              height={drawn.height}
              isInteractive
            />
            {footer(drawn.shown)}
          </Box>
        </Box>
      )
    }

    // The terminal draws text alone: git's rails in its lane colours, then
    // hash, age, names and subject. One row, one line: a crushed column cuts
    // the line off at the edge rather than wrapping it, since a row grown to
    // two lines pushes the rails apart. The rails, hash and age hold their
    // width, so the subject is what gives way first.
    const railsRoom = Math.min(RAILS_ROOM, Math.max(2, ...t.rows.map(one => one.rails.length)))
    const rails = (one: Row, pad: number) => (
      <Text mono wrap="truncate-end">
        {[...one.rails.padEnd(pad)].map((ch, at) => {
          const hue = one.railColors[at] ?? -1

          return (
            <Text key={'g' + at} color={hue < 0 ? undefined : RAIL_THEME[hue]} wrap="truncate-end">
              {ch === '*' && one.isLocal ? '○' : (GLYPH[ch] ?? ch)}
            </Text>
          )
        })}
      </Text>
    )

    const commitRow = (one: Row, at: number) => {
      if (!one.hash) {
        return (
          <Box key={'r-' + at} flexWrap="nowrap" overflow="hidden">
            {rails(one, 0)}
          </Box>
        )
      }

      return (
        <Box key={'c-' + at + '-' + one.hash} flexWrap="nowrap" overflow="hidden">
          <Box flexShrink={0}>{rails(one, railsRoom)}</Box>
          <Box flexShrink={0}>
            <Text mono dimColor wrap="truncate-end">
              {' ' + one.hash.slice(0, 7) + ' ' + ago(one.time, now).padStart(3) + ' '}
            </Text>
          </Box>
          {foldPills(one.pills).map(label => (
            <Box key={'p-' + label.name} flexShrink={0}>
              <Text bold={label.kind === 'head'} color={PILL_COLOR[label.kind]} wrap="truncate-end">
                {(label.kind === 'head' ? '● ' : label.kind === 'tag' ? '◆ ' : '') +
                  label.name +
                  (label.also.length ? ' · ' + label.also.join(' ') : '') +
                  ' '}
              </Text>
            </Box>
          ))}
          <Text dimColor={one.parents.length > 1} wrap="truncate-end">
            {one.subject}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {header}
        <Box marginTop={1} flexDirection="column">
          <Text bold>{'History'}</Text>
          {key}
          {isDirty ? (
            <Box key="wip" flexWrap="nowrap" overflow="hidden">
              <Text color="warning" italic wrap="truncate-end">
                {'◌ Uncommitted: ' + pendingWords(t.pending)}
              </Text>
            </Box>
          ) : null}
          {t.rows.map(commitRow)}
          {footer(commits)}
        </Box>
      </Box>
    )
  })
}
