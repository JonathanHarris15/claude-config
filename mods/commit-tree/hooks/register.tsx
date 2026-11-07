import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { Branch, Pill, Row, Tree } from '../types'

const PANE = 'commit-tree'
/** How many commits to draw before the pane says it stopped. */
const CAP = 250
/** Between the fields of `for-each-ref`. Git refuses `~` in a ref name. */
const SEP = '|~|'
/** Between the fields of `log`, written by its own `%x1f`. */
const UNIT = '\u001f'
/** Widest rails the columns line up behind; a wider one pushes its row out. */
const RAILS_ROOM = 14
/** How stale a reading may be before a redraw reads again. */
const STALE_MS = 15000

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const tree = atom({ plugin: 'commit-tree', key: 'tree' } as const, null as Tree | null, {
  shape: 'tree-1',
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

  for (const line of out.split(/\r?\n/)) {
    if (!line) continue
    if (!line.startsWith('#')) {
      dirty += 1
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

  return { head, oid, upstream, ahead, behind, dirty }
}

const REF_FIELDS = [
  '%(refname)',
  '%(refname:short)',
  '%(objectname:short)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
  '%(HEAD)',
].join(SEP)

/** Every branch here and on a remote, newest tip first. */
export function readBranches(out: string): Branch[] {
  const list: Branch[] = []

  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [full = '', name = '', hash = '', upstream = '', track = '', mark = ''] = line.split(SEP)
    // `origin/HEAD` points at a remote's default branch; it is not a branch.
    if (!name || name.endsWith('/HEAD')) continue
    list.push({
      name,
      hash,
      upstream,
      track: track.trim(),
      isRemote: full.startsWith('refs/remotes/'),
      isHead: mark.trim() === '*',
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

/** Turn git's drawn log into rows, newest first, stopping at the cap. */
export function readRows(out: string, remotes: ReadonlySet<string>) {
  const rows: Row[] = []
  let commits = 0
  let isTruncated = false

  for (const line of out.split(/\r?\n/)) {
    const cut = line.indexOf(UNIT)
    if (cut < 0) {
      // Rails alone: a fork, a merge, or the gap between two lines of history.
      if (line.trim()) {
        rows.push({ rails: line, hash: '', pills: [], date: '', who: '', subject: '' })
      }
      continue
    }
    if (commits >= CAP) {
      isTruncated = true
      break
    }
    const [, hash = '', decor = '', date = '', who = '', subject = ''] = line.slice(cut).split(UNIT)
    commits += 1
    rows.push({
      rails: line.slice(0, cut),
      hash,
      pills: readPills(decor, remotes),
      date,
      who,
      subject,
    })
  }

  return { rows, isTruncated }
}

const BLANK: Tree = {
  head: '',
  headHash: '',
  dirty: 0,
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
        '--date=short',
        '--max-count=' + (CAP + 1),
        '--pretty=format:%x1f%h%x1f%D%x1f%ad%x1f%an%x1f%s',
      ])
      const drawn = log.ok ? readRows(log.out, remotes) : { rows: [], isTruncated: false }
      result = {
        ...result,
        head: head.head,
        headHash: head.oid.slice(0, 7),
        dirty: head.dirty,
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

/** One line saying where the head stands. */
export function headLine(t: Tree): string {
  if (t.trouble) return t.trouble
  const where = t.head || 'detached at ' + t.headHash
  const drift = t.upstream ? ' ↑' + t.ahead + ' ↓' + t.behind : ''
  const work = t.dirty ? t.dirty + ' changed' : 'clean'

  return where + drift + ' · ' + work
}

const PILL_COLOR: Record<Pill['kind'], Color> = {
  head: 'success',
  local: 'warning',
  remote: 'claude',
  tag: 'permission',
}

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

    const locals = t.branches.filter(one => !one.isRemote)
    const remotes = t.branches.filter(one => one.isRemote)
    const nameRoom = Math.min(30, Math.max(8, ...t.branches.map(one => one.name.length)))
    const railsRoom = Math.min(RAILS_ROOM, Math.max(2, ...t.rows.map(one => one.rails.length)))

    const branchRow = (one: Branch) => (
      <Box key={'b-' + one.name} flexWrap="nowrap" overflow="hidden">
        <Box flexShrink={0}>
          <Text mono bold={one.isHead} color={one.isHead ? 'success' : undefined} wrap="truncate-end">
            {(one.isHead ? '● ' : '  ') + one.name.padEnd(nameRoom)}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text mono dimColor wrap="truncate-end">
            {' ' + one.hash.padEnd(9)}
          </Text>
        </Box>
        {one.track ? (
          <Box flexShrink={0}>
            <Text color="warning" wrap="truncate-end">{one.track + ' '}</Text>
          </Box>
        ) : null}
        {one.upstream ? (
          <Text dimColor wrap="truncate-end">
            {one.upstream}
          </Text>
        ) : null}
      </Box>
    )

    // One row, one line. A crushed column cuts the line off at the edge rather
    // than wrapping it: a row grown to two lines pushes the rails apart, and
    // the drawn tree stops lining up with the commits beside it. The rails and
    // the hash hold their width, so the subject is what gives way first.
    const commitRow = (one: Row, at: number) => {
      if (!one.hash) {
        return (
          <Box key={'r-' + at} flexWrap="nowrap" overflow="hidden">
            <Text mono color="suggestion" wrap="truncate-end">
              {one.rails}
            </Text>
          </Box>
        )
      }

      return (
        <Box key={'c-' + at + '-' + one.hash} flexWrap="nowrap" overflow="hidden">
          <Box flexShrink={0}>
            <Text mono color="suggestion" wrap="truncate-end">
              {one.rails.padEnd(railsRoom)}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Text mono dimColor wrap="truncate-end">
              {one.hash.padEnd(8) + one.date + ' '}
            </Text>
          </Box>
          {one.pills.map(pill => (
            <Box key={'p-' + pill.name} flexShrink={0}>
              <Text bold={pill.kind === 'head'} color={PILL_COLOR[pill.kind]} wrap="truncate-end">
                {(pill.kind === 'head' ? '● ' : '') + pill.name + ' '}
              </Text>
            </Box>
          ))}
          <Text wrap="truncate-end">{one.subject}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box gap={1} alignItems="center">
          <Text bold>{t.head ? 'On ' + t.head : 'Detached at ' + t.headHash}</Text>
          <Text dimColor>{headLine(t)}</Text>
          <Button key="again" onPress={() => void readTree($)}>
            {reading ? 'Reading…' : 'Read again'}
          </Button>
        </Box>
        <Box gap={1}>
          <Text bold color="success">
            {'● checked out'}
          </Text>
          <Text color="warning">local</Text>
          <Text color="claude">remote</Text>
          <Text color="permission">tag</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{'Branches here (' + locals.length + ')'}</Text>
          {locals.length === 0 ? <Text dimColor>None.</Text> : locals.map(branchRow)}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text bold>{'Branches on remotes (' + remotes.length + ')'}</Text>
          {remotes.length === 0 ? <Text dimColor>None.</Text> : remotes.map(branchRow)}
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Box gap={1}>
            <Text bold>Commit tree</Text>
            <Text dimColor>{'newest at the top — scroll down for older'}</Text>
          </Box>
          {t.rows.map(commitRow)}
          {t.isTruncated ? <Text dimColor>{'… stopped at ' + CAP + ' commits.'}</Text> : null}
        </Box>
      </Box>
    )
  })
}
