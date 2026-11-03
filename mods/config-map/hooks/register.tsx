import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Added, ConfigRow, Scan, SkillOrigin, SkillRow } from '../types'

const PANE = 'config-map'

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scan = atom({ plugin: 'config-map', key: 'scan' } as const, null as Scan | null, {
  shape: 'scan-2',
})
const view = atom({ plugin: 'config-map', key: 'view' } as const, 'skills' as 'skills' | 'config', {
  shape: 'view-1',
})
const pick = atom({ plugin: 'config-map', key: 'pick' } as const, '', { shape: 'pick-1' })
const shut = atom({ plugin: 'config-map', key: 'shut' } as const, ['plugin'] as string[], {
  shape: 'shut-1',
})
const isBusy = atom({ plugin: 'config-map', key: 'isBusy' } as const, false, { shape: 'busy-1' })
const added = atom({ plugin: 'config-map', key: 'added' } as const, null as Added | null, {
  shape: 'added-1',
})
const find = atom({ plugin: 'config-map', key: 'find' } as const, '', { shape: 'find-1' })

/** The line the allowlist gains above anything this pane un-ignores. */
const MARK = '# Added from the config-map pane, tracked on purpose.'

/** Files git should hold but this pane cannot copy, since it writes only text. */
const BINARY = /\.(woff2?|ttf|otf|eot|png|jpe?g|gif|webp|ico|pdf|zips?|gz|tgz|wasm|mp[34]|wav|dll|exe|so|dylib|bin)$/i

/** What each thing at the top of the config folder is, in plain words. */
const NOTES: Record<string, string> = {
  'CLAUDE.md': 'your global instructions, read every session',
  'settings.json': 'permissions, model, theme, hooks',
  'README.md': 'how this repo works',
  '.gitignore': 'the allowlist deciding what syncs',
  skills: 'your own skills',
  agents: 'subagent definitions',
  commands: 'slash commands',
  workflows: 'workflow scripts',
  hooks: 'hook scripts',
  board: 'per-space working notes',
  mods: 'mods, this pane among them',
  plugins: 'installed marketplaces, refetched per machine',
  'dev-mods': 'mods a session is still writing',
  projects: 'full session transcripts',
  'file-history': 'a snapshot of every file edited',
  backups: 'old copies of .claude.json',
  'history.jsonl': 'your prompt history',
  '.credentials.json': 'your sign-in token, never synced',
  'settings.local.json': 'permission grants for this machine only',
  'settings.json.local': 'permission grants for this machine only',
  cache: 'throwaway',
  sessions: 'throwaway',
  'shell-snapshots': 'throwaway',
  'session-env': 'throwaway',
  state: 'machine-local state',
  spares: 'machine-local state',
  ide: 'editor handshake files',
  chrome: 'browser extension state',
  downloads: 'files a session downloaded',
  '.git': 'the repo itself',
}

const GROUPS: { origin: SkillOrigin; title: string; gist: string }[] = [
  { origin: 'repo', title: 'In your config repo', gist: 'on every machine' },
  { origin: 'local', title: 'This machine only', gist: 'left out of the repo' },
  { origin: 'synced', title: 'From claude.ai', gist: 'the customize tab' },
  { origin: 'plugin', title: 'From plugins', gist: 'the plugin owns these' },
]

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find(one => one.trim())
  return line ? line.trim().slice(0, 160) : ''
}

/** Pad a name out so a column of them lines up. */
function pad(text: string, wide: number): string {
  return text.length >= wide ? text : text + ' '.repeat(wide - text.length)
}

/** Cut text to the room there is, marking that it was cut. */
function cut(text: string, wide: number): string {
  if (wide < 2) return ''
  return text.length <= wide ? text : text.slice(0, wide - 1).trimEnd() + '…'
}

/** The widest of these names, within a cap, so one column holds them all. */
function widest(names: readonly string[], cap: number): number {
  let n = 0
  for (const one of names) n = Math.max(n, one.length)
  return Math.min(cap, n)
}

/** The config folder this session reads, however the machine names home. */
async function rootOf($: EngineInterface): Promise<string> {
  const named = await $.env.get('CLAUDE_CONFIG_DIR')
  if (named) return named.replace(/\\/g, '/').replace(/\/+$/, '')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  return home.replace(/\\/g, '/').replace(/\/+$/, '') + '/.claude'
}

async function dirsIn($: EngineInterface, path: string): Promise<string[]> {
  if (!(await $.fs.exists(path))) return []
  try {
    const found = await $.fs.list(path)
    return found
      .filter(one => one.kind === 'dir' && !one.name.startsWith('.'))
      .map(one => one.name)
      .sort()
  } catch {
    return []
  }
}

/** One sweep of the disk: every skill, the config folder, and what git holds. */
async function sweep($: EngineInterface): Promise<Scan> {
  const troubles: string[] = []
  const root = await rootOf($)
  const git = (args: readonly string[]) =>
    $.process.run(['git', '-C', root, ...args], { timeoutMs: 20000 })

  const tracked = new Set<string>()
  let branch = 'no branch'
  let dirtyFiles = 0

  try {
    const listed = await git(['ls-files'])
    if (listed.exitCode === 0) {
      for (const line of listed.stdout.split(/\r?\n/)) {
        const one = line.trim()
        if (one) tracked.add(one)
      }
    } else {
      troubles.push('git could not read ' + root + ': ' + firstLine(listed.stderr))
    }
    const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (head.exitCode === 0 && head.stdout.trim()) branch = head.stdout.trim()
    const dirty = await git(['status', '--porcelain'])
    if (dirty.exitCode === 0) {
      dirtyFiles = dirty.stdout.split(/\r?\n/).filter(one => one.trim()).length
    }
  } catch (err) {
    troubles.push('git did not run: ' + String(err))
  }

  const countUnder = (rel: string) => {
    const under = rel + '/'
    let n = 0
    for (const one of tracked) if (one === rel || one.startsWith(under)) n += 1
    return n
  }

  const skills: SkillRow[] = []

  for (const name of await dirsIn($, root + '/skills')) {
    if (name === 'synced') continue
    const path = 'skills/' + name
    const isTracked = countUnder(path) > 0
    skills.push({
      id: 'own/' + name,
      name,
      origin: isTracked ? 'repo' : 'local',
      owner: '',
      path,
      isTracked,
      gist: '',
    })
  }

  for (const bucket of await dirsIn($, root + '/skills/synced')) {
    for (const name of await dirsIn($, root + '/skills/synced/' + bucket)) {
      skills.push({
        id: 'synced/' + name,
        name,
        origin: 'synced',
        owner: 'claude.ai',
        path: 'skills/synced/' + bucket + '/' + name,
        isTracked: false,
        gist: '',
      })
    }
  }

  for (const market of await dirsIn($, root + '/plugins/marketplaces')) {
    for (const holder of ['plugins', 'external_plugins']) {
      const base = 'plugins/marketplaces/' + market + '/' + holder
      for (const plug of await dirsIn($, root + '/' + base)) {
        for (const name of await dirsIn($, root + '/' + base + '/' + plug + '/skills')) {
          skills.push({
            id: 'plugin/' + plug + '/' + name,
            name,
            origin: 'plugin',
            owner: plug,
            path: base + '/' + plug + '/skills/' + name,
            isTracked: false,
            gist: '',
          })
        }
      }
    }
  }

  const config: ConfigRow[] = []
  try {
    for (const one of await $.fs.list(root)) {
      const trackedCount = countUnder(one.name)
      config.push({
        id: 'cfg/' + one.name,
        name: one.name,
        kind: one.kind,
        isTracked: trackedCount > 0 || tracked.has(one.name),
        trackedCount,
        note: NOTES[one.name] ?? '',
      })
    }
  } catch (err) {
    troubles.push('could not list ' + root + ': ' + String(err))
  }
  config.sort((a, b) => {
    if (a.isTracked !== b.isTracked) return a.isTracked ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return {
    at: Date.now(),
    root,
    branch,
    trackedFiles: tracked.size,
    dirtyFiles,
    skills,
    config,
    troubles,
    isTold: false,
  }
}

/** The description a skill's own file declares. */
function describedIn(text: string): string {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const body = front?.[1]
  if (!body) return ''
  const line = /^description:[ \t]*(.*)$/m.exec(body)
  if (!line) return ''
  let value = (line[1] ?? '').trim()
  if (value === '>' || value === '|' || value === '>-' || value === '|-') {
    const rest = body.slice(line.index + line[0].length).split(/\r?\n/)
    const folded: string[] = []
    for (const one of rest) {
      if (/^[ \t]+\S/.test(one)) folded.push(one.trim())
      else if (one.trim()) break
    }
    value = folded.join(' ')
  }
  const quoted = /^(['"])([\s\S]*)\1$/.exec(value)
  return (quoted?.[2] ?? value).trim()
}

/** What one skill says it does, on a single line, or nothing. */
async function gistOf($: EngineInterface, root: string, row: SkillRow): Promise<string> {
  const file = root + '/' + row.path + '/SKILL.md'
  if (!(await $.fs.exists(file))) return ''
  try {
    const held = await $.fs.read(file)
    const said = describedIn(typeof held === 'string' ? held : '')
    return said.replace(/\s+/g, ' ').trim().slice(0, 300)
  } catch {
    return ''
  }
}

/**
 * The second pass: what every skill says it does. Split from the sweep so the
 * pane draws the moment the folders are known, rather than after a hundred
 * files have been read.
 */
async function describeAll($: EngineInterface, found: Scan): Promise<Scan> {
  const told = await Promise.all(
    found.skills.map(async row => ({ ...row, gist: await gistOf($, found.root, row) })),
  )
  return { ...found, skills: told, isTold: true }
}

/** Read the disk again and keep what it found, the descriptions after. */
async function rescan($: EngineInterface): Promise<void> {
  await update($, isBusy, () => true)
  try {
    const swept = await sweep($)
    await update($, scan, () => swept)
    const told = await describeAll($, swept)
    await update($, scan, () => told)
  } finally {
    await update($, isBusy, () => false)
  }
}

/** Open a skill where it sits in the list, or shut it again. */
async function choose($: EngineInterface, row: SkillRow): Promise<void> {
  await update($, pick, was => (was === row.id ? '' : row.id))
}

/**
 * Un-ignore a path the allowlist still refuses, by name, at the end of the
 * file where the last rule wins. The allowlist stays an allowlist: one more
 * explicit exception, never a flip to a denylist.
 */
async function allowInGit($: EngineInterface, root: string, rel: string): Promise<void> {
  const asked = await $.process.run(['git', '-C', root, 'check-ignore', '-v', '--', rel], {
    timeoutMs: 20000,
  })
  // 1 says no rule mentions the path at all, so there is nothing to add.
  if (asked.exitCode !== 0) return
  // A rule matched, which is not the same as ignored: git answers 0 for a
  // negation too. `<source>:<line>:<rule>\t<path>`, the source a path of its
  // own, so take the rule from the last `:<digits>:` before the tab.
  const shown = (asked.stdout.split(/\r?\n/)[0] ?? '').split('\t')[0] ?? ''
  const rule = /:(\d+):(.*)$/.exec(shown)?.[2] ?? ''
  if (rule.startsWith('!')) return

  const file = root + '/.gitignore'
  const held = await $.fs.read(file)
  const text = typeof held === 'string' ? held : ''
  const have = new Set(text.split(/\r?\n/).map(one => one.trim()))
  const want = ['!' + rel + '/', '!' + rel + '/**'].filter(one => !have.has(one))
  if (want.length === 0) return

  const at = text.indexOf(MARK)
  if (at < 0) {
    await $.fs.write(file, text.replace(/\s*$/, '') + '\n\n' + MARK + '\n' + want.join('\n') + '\n')
    return
  }
  const cutAt = text.indexOf('\n', at)
  const after = cutAt < 0 ? text.length : cutAt + 1
  await $.fs.write(file, text.slice(0, after) + want.join('\n') + '\n' + text.slice(after))
}

/**
 * Copy a skill folder's text files across. The engine writes text and not
 * bytes, so anything else is left behind and named, never half-copied.
 */
async function copyTree(
  $: EngineInterface,
  from: string,
  to: string,
): Promise<{ files: number; missed: string[] }> {
  let files = 0
  const missed: string[] = []

  const walk = async (src: string, dst: string, where: string): Promise<void> => {
    for (const one of await $.fs.list(src)) {
      const named = where ? where + '/' + one.name : one.name
      if (one.kind === 'dir') {
        await walk(src + '/' + one.name, dst + '/' + one.name, named)
        continue
      }
      if (one.kind !== 'file' || BINARY.test(one.name)) {
        missed.push(named)
        continue
      }
      try {
        const held = await $.fs.read(src + '/' + one.name)
        // A byte no text holds says the file is not text after all.
        if (typeof held !== 'string' || held.includes('\u0000') || held.includes('�')) {
          missed.push(named)
          continue
        }
        await $.fs.write(dst + '/' + one.name, held)
        files += 1
      } catch {
        missed.push(named)
      }
    }
  }

  await walk(from, to, '')
  return { files, missed }
}

/**
 * Put one untracked skill in the repo, and say what it took. A skill already
 * sitting in `skills/` only needs the allowlist to stop refusing it; one the
 * app or a plugin owns is copied in, since git and its owner would otherwise
 * both write the same folder.
 */
async function keep($: EngineInterface, row: SkillRow, root: string): Promise<void> {
  if (row.isTracked) return
  const say = (ok: boolean, text: string) => update($, added, () => ({ id: row.id, ok, text }))

  await update($, isBusy, () => true)
  let moved = false
  try {
    let rel = row.path
    let said = ''

    if (row.origin === 'local') {
      await allowInGit($, root, rel)
      said = 'Tracked where it sits.'
    } else {
      rel = 'skills/' + row.name
      if (await $.fs.exists(root + '/' + rel)) {
        await say(false, rel + ' is already there, so nothing was copied.')
        return
      }
      const done = await copyTree($, root + '/' + row.path, root + '/' + rel)
      moved = true
      await allowInGit($, root, rel)
      said = 'Copied ' + done.files + ' files to ' + rel + '. The original stays put.'
      if (done.missed.length > 0) said += ' Left behind: ' + done.missed.join(', ') + '.'
    }

    const staged = await $.process.run(['git', '-C', root, 'add', '--', rel], { timeoutMs: 20000 })
    if (staged.exitCode !== 0) {
      await say(false, said + ' But git add failed: ' + firstLine(staged.stderr))
      return
    }
    moved = true
    await say(true, said + ' Staged — /sync-config commits and pushes it.')
  } catch (err) {
    await say(false, 'Could not add it: ' + String(err))
  } finally {
    await update($, isBusy, () => false)
  }

  if (moved) await rescan($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'config-map',
      description: 'Show every skill and the whole Claude config in a pane',
    })
    void $.ui.open({ id: PANE, title: 'Claude config' })
    void rescan($)

    return next(e)
  })

  on('command.run', { command: 'config-map' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude config' })
    void rescan($)

    return { text: 'Claude config pane opened.' }
  })
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    // The mobile app draws no field yet, so the filter is offered where there is one.
    const Field = 'Input' in table ? table.Input : undefined

    const found = await read($, scan)
    const which = await read($, view)
    const picked = await read($, pick)
    const closed = await read($, shut)
    const busy = await read($, isBusy)
    const last = await read($, added)
    const finding = await read($, find)

    if (!found) {
      return (
        <Box flexDirection="column" gap={1} paddingY={1}>
          <Text size="heading" weight="semibold">
            Claude config
          </Text>
          <Text size="footnote" dimColor>
            {busy ? 'Reading your config…' : 'Nothing read yet.'}
          </Text>
          <Button key="scan" variant="primary" onPress={() => void rescan($)}>
            Read it now
          </Button>
        </Box>
      )
    }

    const wide = Math.max(32, e.props?.bodyColumns ?? 60)

    const head = (
      <Box flexDirection="column">
        <Box justifyContent="space-between" alignItems="center">
          <Text size="heading" weight="semibold">
            Claude config
          </Text>
          <Box gap={1}>
            <Button
              key="tab-skills"
              variant={which === 'skills' ? 'primary' : 'secondary'}
              onPress={() => void update($, view, () => 'skills')}
            >
              {'Skills ' + found.skills.length}
            </Button>
            <Button
              key="tab-config"
              variant={which === 'config' ? 'primary' : 'secondary'}
              onPress={() => void update($, view, () => 'config')}
            >
              {'Config ' + found.config.length}
            </Button>
          </Box>
        </Box>
        <Box gap={1} marginTop={1} alignItems="center">
          <Text size="footnote" mono color="claude">
            {found.branch}
          </Text>
          <Text size="footnote" dimColor>
            {'· ' + found.trackedFiles + ' files tracked ·'}
          </Text>
          <Text size="footnote" color={found.dirtyFiles > 0 ? 'warning' : 'success'}>
            {found.dirtyFiles > 0 ? found.dirtyFiles + ' uncommitted' : 'clean'}
          </Text>
          <Box flexGrow={1} />
          <Button
            key="refresh"
            plain
            dimColor
            hover={{ scope: 'refresh', dimColor: false }}
            onPress={() => void rescan($)}
          >
            {busy ? 'reading…' : 'refresh'}
          </Button>
        </Box>
      </Box>
    )

    const troubles = found.troubles.map(one => (
      <Text key={'t-' + one} size="footnote" color="error" wrap="wrap">
        {one}
      </Text>
    ))

    if (which === 'config') {
      const kept = found.config.filter(one => one.isTracked)
      const rest = found.config.filter(one => !one.isTracked)
      const named = (one: ConfigRow) => one.name + (one.kind === 'dir' ? '/' : '')
      const nameWide = widest(found.config.map(named), 22)
      const noteWide = Math.max(8, wide - nameWide - 8)

      const line = (one: ConfigRow, isKept: boolean) => {
        const scope = 'cfg-' + one.id
        const note = (one.trackedCount > 1 ? one.trackedCount + ' files · ' : '') + one.note
        return (
          <Box key={(isKept ? 'k-' : 'u-') + one.id} paddingLeft={2}>
            <Text color={isKept ? 'success' : 'inactive'}>
              {isKept ? '● ' : '○ '}
            </Text>
            <Text mono hover={{ scope, color: 'claude' }}>
              {pad(cut(named(one), nameWide), nameWide)}
            </Text>
            <Text size="footnote" dimColor hover={{ scope, dimColor: false }}>
              {'   ' + cut(note, noteWide)}
            </Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="column">
          {head}
          <Box flexDirection="column" marginTop={1}>
            <Box gap={1} alignItems="center">
              <Text weight="semibold" color="success">
                Tracked in the repo
              </Text>
              <Text inverse>{' ' + kept.length + ' '}</Text>
              <Text size="footnote" dimColor>
                travels to every machine
              </Text>
            </Box>
            {kept.map(one => line(one, true))}
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Box gap={1} alignItems="center">
              <Text weight="semibold">Not tracked</Text>
              <Text inverse>{' ' + rest.length + ' '}</Text>
              <Text size="footnote" dimColor>
                stays on this machine
              </Text>
            </Box>
            {rest.map(one => line(one, false))}
          </Box>
          {troubles}
        </Box>
      )
    }

    const needle = finding.trim().toLowerCase()
    const hits = (row: SkillRow) =>
      needle === '' ||
      row.name.toLowerCase().includes(needle) ||
      row.gist.toLowerCase().includes(needle) ||
      row.owner.toLowerCase().includes(needle)

    const groups = GROUPS.map(group => ({
      group,
      rows: found.skills.filter(one => one.origin === group.origin && hits(one)),
    })).filter(one => one.rows.length > 0)
    const matched = groups.reduce((n, one) => n + one.rows.length, 0)

    return (
      <Box flexDirection="column">
        {head}

        {Field !== undefined && (
          <Box marginTop={1}>
            <Field
              key="find"
              label="Filter"
              placeholder="a name, or words from a description"
              value={finding}
              onInput={value => void update($, find, () => value)}
              onSubmit={value => void update($, find, () => value)}
            />
          </Box>
        )}

        {needle !== '' && (
          <Box gap={1} marginTop={1} alignItems="center">
            <Text size="footnote" dimColor>
              {matched + ' of ' + found.skills.length + ' match'}
            </Text>
            <Button
              key="clear"
              plain
              dimColor
              hover={{ scope: 'clear', dimColor: false }}
              onPress={() => void update($, find, () => '')}
            >
              clear
            </Button>
          </Box>
        )}

        {groups.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>{'Nothing matches “' + finding.trim() + '”.'}</Text>
          </Box>
        )}

        {groups.map(({ group, rows }) => {
          // A filter opens every group: a match nobody can see is no match.
          const isShut = needle === '' && closed.includes(group.origin)
          const nameWide = widest(
            rows.map(one => one.name),
            26,
          )
          const gistWide = Math.max(10, wide - nameWide - 11)

          return (
            <Box key={'g-' + group.origin} flexDirection="column" marginTop={1}>
              <Button
                key={'h-' + group.origin}
                plain
                hover={{ scope: 'h-' + group.origin, dimColor: false }}
                onPress={() =>
                  void update($, shut, was =>
                    was.includes(group.origin)
                      ? was.filter(one => one !== group.origin)
                      : [...was, group.origin],
                  )
                }
              >
                <Text dimColor>{isShut ? '▸  ' : '▾  '}</Text>
                <Text weight="semibold">{group.title + '  '}</Text>
                <Text inverse>{' ' + rows.length + ' '}</Text>
                <Text size="footnote" dimColor>
                  {'   ' + group.gist}
                </Text>
              </Button>

              {!isShut &&
                rows.map(row => {
                  const isOpen = row.id === picked
                  const scope = 'row-' + row.id

                  return (
                    <Box key={'r-' + row.id} flexDirection="column">
                      <Button
                        key={'b-' + row.id}
                        plain
                        hover={{ scope, dimColor: false, color: 'claude' }}
                        onPress={() => void choose($, row)}
                      >
                        <Text dimColor>{isOpen ? '  ▾ ' : '    '}</Text>
                        <Text color={row.isTracked ? 'success' : 'inactive'}>
                          {row.isTracked ? '● ' : '○ '}
                        </Text>
                        <Text mono weight={isOpen ? 'semibold' : 'regular'}>
                          {pad(cut(row.name, nameWide), nameWide)}
                        </Text>
                        <Text size="footnote" dimColor hover={{ scope, dimColor: false }}>
                          {'   ' +
                            (row.gist
                              ? cut(row.gist, gistWide)
                              : found.isTold
                                ? 'no description'
                                : '…')}
                        </Text>
                      </Button>

                      {isOpen && (
                        <Box
                          flexDirection="column"
                          marginLeft={5}
                          marginY={1}
                          paddingX={1}
                          borderStyle="round"
                          borderColor="claude"
                        >
                          <Box justifyContent="space-between" alignItems="center">
                            <Text size="caption" mono dimColor>
                              {row.path}
                            </Text>
                            <Text size="caption" color={row.isTracked ? 'success' : 'warning'}>
                              {row.isTracked ? 'in the repo' : 'not in the repo'}
                            </Text>
                          </Box>

                          <Box marginTop={1}>
                            {row.gist !== '' ? (
                              <Markdown text={row.gist} />
                            ) : (
                              <Text dimColor wrap="wrap">
                                {found.isTold
                                  ? 'Its SKILL.md declares no description.'
                                  : 'Reading its SKILL.md…'}
                              </Text>
                            )}
                          </Box>

                          {row.owner !== '' && (
                            <Text size="footnote" dimColor>
                              {'Comes with ' + row.owner + '.'}
                            </Text>
                          )}

                          {!row.isTracked && (
                            <Box marginTop={1}>
                              <Text size="footnote" color="warning" wrap="wrap">
                                {row.origin === 'local'
                                  ? 'Tracking it adds one line to the allowlist.'
                                  : 'Copying it leaves the original where it is.'}
                              </Text>
                            </Box>
                          )}

                          {last && last.id === row.id && (
                            <Box marginTop={1}>
                              <Text
                                size="footnote"
                                color={last.ok ? 'success' : 'error'}
                                wrap="wrap"
                              >
                                {last.text}
                              </Text>
                            </Box>
                          )}

                          <Box gap={1} marginTop={1}>
                            {!row.isTracked && (
                              <Button
                                key="keep"
                                variant="primary"
                                onPress={() => void keep($, row, found.root)}
                              >
                                {busy
                                  ? 'working…'
                                  : row.origin === 'local'
                                    ? 'Track in repo'
                                    : 'Copy into repo'}
                              </Button>
                            )}
                            <Button
                              key="copy"
                              onPress={press =>
                                void $.ui.copy({
                                  text: found.root + '/' + row.path,
                                  surface: press.surface,
                                })
                              }
                            >
                              Copy path
                            </Button>
                            <Button
                              key="shut"
                              role="dismiss"
                              onPress={() => void update($, pick, () => '')}
                            >
                              Close
                            </Button>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  )
                })}
            </Box>
          )
        })}
        {troubles}
      </Box>
    )
  })
}
