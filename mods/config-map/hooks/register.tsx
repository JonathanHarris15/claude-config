import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Added, ConfigRow, Detail, Scan, SkillOrigin, SkillRow } from '../types'

const PANE = 'config-map'

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const scan = atom({ plugin: 'config-map', key: 'scan' } as const, null as Scan | null, { shape: 'scan-1' })
const view = atom({ plugin: 'config-map', key: 'view' } as const, 'skills' as 'skills' | 'config', {
  shape: 'view-1',
})
const pick = atom({ plugin: 'config-map', key: 'pick' } as const, '', { shape: 'pick-1' })
const detail = atom({ plugin: 'config-map', key: 'detail' } as const, null as Detail | null, {
  shape: 'detail-1',
})
const shut = atom({ plugin: 'config-map', key: 'shut' } as const, ['plugin'] as string[], {
  shape: 'shut-1',
})
const isBusy = atom({ plugin: 'config-map', key: 'isBusy' } as const, false, { shape: 'busy-1' })
const added = atom({ plugin: 'config-map', key: 'added' } as const, null as Added | null, {
  shape: 'added-1',
})

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
  }
}

/** The description a skill's own file declares, read only once it is picked. */
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

/** Read the disk again and keep what it found. */
async function rescan($: EngineInterface): Promise<void> {
  await update($, isBusy, () => true)
  try {
    const swept = await sweep($)
    await update($, scan, () => swept)
  } finally {
    await update($, isBusy, () => false)
  }
}

/** Pick a skill, or unpick it, and fetch what its own file says it does. */
async function choose($: EngineInterface, row: SkillRow, root: string): Promise<void> {
  await update($, pick, was => (was === row.id ? '' : row.id))
  if ((await read($, pick)) !== row.id) return
  await update($, detail, () => ({ id: row.id, text: 'Reading...' }))
  const file = root + '/' + row.path + '/SKILL.md'
  let text = 'No SKILL.md here.'
  if (await $.fs.exists(file)) {
    try {
      const held = await $.fs.read(file)
      text = describedIn(typeof held === 'string' ? held : '') || 'No description declared.'
    } catch {
      text = 'Could not read SKILL.md.'
    }
  }
  await update($, detail, () => ({ id: row.id, text }))
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
  const cut = text.indexOf('\n', at)
  const after = cut < 0 ? text.length : cut + 1
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
    const { Box, Text, Button } = $.ui.resolve(e)
    const found = await read($, scan)
    const which = await read($, view)
    const picked = await read($, pick)
    const shown = await read($, detail)
    const closed = await read($, shut)
    const busy = await read($, isBusy)
    const last = await read($, added)

    if (!found) {
      return (
        <Box flexDirection="column">
          <Text dimColor>{busy ? 'Reading your config...' : 'Nothing read yet.'}</Text>
          <Button key="scan" onPress={() => void rescan($)}>
            Read it now
          </Button>
        </Box>
      )
    }

    const room = Math.max(4, (e.viewport?.rows ?? 30) - 11)

    const head = (
      <Box flexDirection="column">
        <Box gap={1}>
          <Button
            key="tab-skills"
            plain
            dimColor={which !== 'skills'}
            onPress={() => void update($, view, () => 'skills')}
          >
            {'Skills (' + found.skills.length + ')'}
          </Button>
          <Button
            key="tab-config"
            plain
            dimColor={which !== 'config'}
            onPress={() => void update($, view, () => 'config')}
          >
            {'Config (' + found.config.length + ')'}
          </Button>
          <Button key="refresh" plain dimColor onPress={() => void rescan($)}>
            {busy ? 'reading...' : 'refresh'}
          </Button>
        </Box>
        <Text dimColor>
          {found.branch +
            ' - ' +
            found.trackedFiles +
            ' files tracked - ' +
            (found.dirtyFiles ? found.dirtyFiles + ' uncommitted' : 'clean')}
        </Text>
      </Box>
    )

    const troubles = found.troubles.map(one => (
      <Text key={'t-' + one} color="red">
        {one}
      </Text>
    ))

    if (which === 'config') {
      const kept = found.config.filter(one => one.isTracked)
      const rest = found.config.filter(one => !one.isTracked)

      return (
        <Box flexDirection="column">
          {head}
          <Box marginTop={1}>
            <Text bold>{'Tracked in the repo (' + kept.length + ')'}</Text>
          </Box>
          {kept.map(one => (
            <Box key={'k-' + one.id} paddingLeft={1}>
              <Text>{one.name + (one.kind === 'dir' ? '/' : '')}</Text>
              <Text dimColor>
                {'  ' + (one.trackedCount > 1 ? one.trackedCount + ' files - ' : '') + one.note}
              </Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text bold>{'Not tracked (' + rest.length + ')'}</Text>
          </Box>
          {rest.slice(0, room).map(one => (
            <Box key={'u-' + one.id} paddingLeft={1}>
              <Text dimColor>
                {one.name + (one.kind === 'dir' ? '/' : '') + (one.note ? '  ' + one.note : '')}
              </Text>
            </Box>
          ))}
          {rest.length > room && <Text dimColor>{'  ...' + (rest.length - room) + ' more'}</Text>}
          {troubles}
        </Box>
      )
    }

    const groups = GROUPS.map(group => ({
      group,
      rows: found.skills.filter(one => one.origin === group.origin),
    })).filter(one => one.rows.length > 0)

    const chosen = found.skills.find(one => one.id === picked)

    return (
      <Box flexDirection="column">
        {head}
        {groups.map(({ group, rows }) => {
          const isShut = closed.includes(group.origin)
          const seen = isShut ? [] : rows.slice(0, room)

          return (
            <Box key={'g-' + group.origin} flexDirection="column" marginTop={1}>
              <Button
                key={'h-' + group.origin}
                plain
                onPress={() =>
                  void update($, shut, was =>
                    was.includes(group.origin)
                      ? was.filter(one => one !== group.origin)
                      : [...was, group.origin],
                  )
                }
              >
                {(isShut ? '+ ' : '- ') + group.title + ' (' + rows.length + ')  '}
                <Text dimColor>{group.gist}</Text>
              </Button>
              {seen.map(row => (
                <Box key={'r-' + row.id} paddingLeft={2}>
                  <Button key={'b-' + row.id} plain onPress={() => void choose($, row, found.root)}>
                    {(row.id === picked ? '> ' : '  ') + row.name + '  '}
                    <Text dimColor>{row.owner}</Text>
                  </Button>
                </Box>
              ))}
              {!isShut && rows.length > seen.length && (
                <Text dimColor>{'    ...' + (rows.length - seen.length) + ' more'}</Text>
              )}
            </Box>
          )
        })}
        {chosen && (
          <Box flexDirection="column" marginTop={1} borderStyle="round" paddingX={1}>
            <Text bold>{chosen.name}</Text>
            <Text dimColor>{chosen.path}</Text>
            <Text>{shown && shown.id === chosen.id ? shown.text : 'Reading...'}</Text>
            {!chosen.isTracked && (
              <Box marginTop={1}>
                <Text dimColor>
                  {chosen.origin === 'local'
                    ? 'Not in the repo. Tracking it adds one allowlist line.'
                    : 'Not in the repo. Copying it leaves the original where it is.'}
                </Text>
              </Box>
            )}
            {last && last.id === chosen.id && (
              <Box marginTop={1}>
                <Text color={last.ok ? 'green' : 'red'}>{last.text}</Text>
              </Box>
            )}
            <Box gap={1} marginTop={1}>
              {!chosen.isTracked && (
                <Button key="keep" onPress={() => void keep($, chosen, found.root)}>
                  {busy
                    ? 'working...'
                    : chosen.origin === 'local'
                      ? 'Track in repo'
                      : 'Copy into repo'}
                </Button>
              )}
              <Button
                key="copy"
                onPress={press =>
                  void $.ui.copy({ text: found.root + '/' + chosen.path, surface: press.surface })
                }
              >
                Copy path
              </Button>
              <Button key="shut" role="dismiss" onPress={() => void update($, pick, () => '')}>
                Close
              </Button>
            </Box>
          </Box>
        )}
        {troubles}
      </Box>
    )
  })
}
