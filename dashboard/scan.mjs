// One sweep of the config folder: every item, and how each one reaches other
// machines. Reads only. Everything here is keyed by a path relative to the
// config root, with forward slashes, so it reads the same on Windows and Mac.

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { localDay, readUsage } from '../hooks/skill-usage.mjs'

/** Top-level things and what they are, in plain words. */
const NOTES = {
  'CLAUDE.md': 'your global instructions, read every session',
  'settings.json': 'permissions, model, theme, hooks',
  'README.md': 'how this repo works',
  '.gitignore': 'the allow list deciding what git syncs',
  dashboard: 'this page',
  skills: 'your own skills',
  agents: 'subagent definitions',
  commands: 'slash commands',
  workflows: 'workflow scripts',
  hooks: 'hook scripts',
  usage: 'how often each skill gets used, one log per machine',
  board: 'per-space working notes',
  mods: 'mods: changes to Claude\'s own interface',
  plugins: 'installed plugins, fetched per machine',
  'dev-mods': 'mods a session is still writing',
  projects: 'session transcripts and memory',
  'file-history': 'a snapshot of every file edited',
  backups: 'old copies, and what the dashboard deleted',
  'history.jsonl': 'your prompt history',
  '.credentials.json': 'your sign-in token, never synced',
  'settings.local.json': 'settings for this machine only',
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

export const toRel = (root, abs) => path.relative(root, abs).split(path.sep).join('/')

const run = (root, args) =>
  new Promise(resolve => {
    execFile(
      'git',
      ['-C', root, ...args],
      { maxBuffer: 32 * 1024 * 1024, timeout: 20000, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr: String(stderr || err?.message || '') }),
    )
  })

/** What git knows: tracked files, what changed, and what has not been pushed. */
export async function readGit(root) {
  const blank = {
    isRepo: false,
    branch: '',
    remote: '',
    ahead: 0,
    behind: 0,
    lastCommit: '',
    trackedCount: 0,
    changes: [],
    hasUpstream: false,
    trouble: '',
  }
  const top = await run(root, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { ...blank, trouble: 'This folder is not a git repo.', tracked: new Set(), changed: new Map(), unpushed: new Set() }
  const [a, b] = await Promise.all([fs.realpath(top.stdout.trim()), fs.realpath(root)])
  if (a !== b) {
    return { ...blank, trouble: 'This folder sits inside another repo, not its own.', tracked: new Set(), changed: new Map(), unpushed: new Set() }
  }

  const tracked = new Set((await run(root, ['ls-files', '-z'])).stdout.split('\0').filter(Boolean))

  // Rename and copy entries carry a second path, which -z sends as its own field.
  const changed = new Map()
  const fields = (await run(root, ['status', '--porcelain=v1', '-z', '-uall'])).stdout.split('\0').filter(Boolean)
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i].slice(0, 2)
    changed.set(fields[i].slice(3), code)
    if (code[0] === 'R' || code[0] === 'C') i++
  }

  const branch = (await run(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  // A remote URL can carry a token; only ever show the host and repo.
  const remote = (await run(root, ['remote', 'get-url', 'origin'])).stdout.trim().replace(/\/\/[^/@]+@/, '//')
  const lastCommit = (await run(root, ['log', '-1', '--format=%s (%cr)'])).stdout.trim()

  let ahead = 0
  let behind = 0
  let unpushed = new Set()
  const counted = await run(root, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
  if (counted.ok) {
    ;[behind, ahead] = counted.stdout.trim().split(/\s+/).map(Number)
    const names = await run(root, ['diff', '--name-only', '-z', '@{u}...HEAD'])
    unpushed = new Set(names.stdout.split('\0').filter(Boolean))
  }

  return {
    isRepo: true,
    branch,
    remote,
    ahead,
    behind,
    lastCommit,
    hasUpstream: counted.ok,
    trackedCount: tracked.size,
    changes: [...changed].map(([file, code]) => ({ path: file, code })),
    trouble: '',
    tracked,
    changed,
    unpushed,
  }
}

/** How a set of files in the repo folder reaches other machines. */
export function routeOf(files, git) {
  if (!git.isRepo) return { route: 'local', note: 'No repo here, so this stays on this machine.' }
  const edited = files.filter(one => git.changed.has(one))
  const fresh = edited.filter(one => git.changed.get(one) === '??')
  const held = files.filter(one => git.tracked.has(one))
  const ahead = files.filter(one => git.unpushed.has(one))
  if (edited.length) {
    const count = edited.length === 1 ? '1 file' : edited.length + ' files'
    return {
      route: 'pending',
      note: fresh.length === edited.length && !held.length
        ? 'New. Git will carry it once you commit and push it.'
        : count + ' changed. Other machines get this once you commit and push.',
    }
  }
  if (ahead.length) return { route: 'pending', note: 'Committed, but not pushed yet.' }
  if (held.length) return { route: 'git', note: 'In your config repo, so every linked machine has it.' }
  return { route: 'local', note: 'The allow list leaves this out, so it stays on this machine.' }
}

/** Every file under a path, skipping nothing but dependencies and git itself. */
export async function walk(abs) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const one of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (one.name === 'node_modules' || one.name === '.git' || one.name === '.DS_Store') continue
    const inner = path.join(abs, one.name)
    if (one.isDirectory()) out.push(...(await walk(inner)))
    else if (one.isFile()) out.push(inner)
  }
  return out
}

const dirsIn = async (abs, { hidden = false } = {}) => {
  try {
    return (await fs.readdir(abs, { withFileTypes: true }))
      .filter(one => one.isDirectory() && (hidden || !one.name.startsWith('.')))
      .map(one => one.name)
      .sort()
  } catch {
    return []
  }
}

/** The name and description out of a file's frontmatter, without a YAML library. */
export function readFrontmatter(text) {
  const found = {}
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (!head) return found
  const lines = head[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i])
    if (!line) continue
    let value = line[2].trim()
    if (/^[>|][+-]?$/.test(value)) {
      const parts = []
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim())
      value = parts.join(' ').trim()
    }
    found[line[1]] = value.replace(/^(['"])(.*)\1$/, '$2')
  }
  return found
}

const readHead = async abs => {
  try {
    return await fs.readFile(abs, 'utf8')
  } catch {
    return ''
  }
}

const readJson = async abs => {
  try {
    return JSON.parse(await fs.readFile(abs, 'utf8'))
  } catch {
    return null
  }
}

/** Plugins on this machine, each with where it came from. */
async function readPlugins(root) {
  const plugins = []
  const syncedRoot = path.join(root, 'plugins', 'synced')
  for (const bucket of await dirsIn(syncedRoot)) {
    for (const name of await dirsIn(path.join(syncedRoot, bucket))) {
      const abs = path.join(syncedRoot, bucket, name)
      // The folder can carry a suffix like ~g2; Claude calls it by its manifest name.
      const manifest = await readJson(path.join(abs, '.claude-plugin', 'plugin.json'))
      plugins.push({ name, calledBy: manifest?.name || name.replace(/~.*$/, ''), abs, route: 'claudeai' })
    }
  }
  const installed = await readJson(path.join(root, 'plugins', 'installed_plugins.json'))
  for (const [key, copies] of Object.entries(installed?.plugins ?? {})) {
    const where = copies?.[0]?.installPath
    if (!where) continue
    const rel = path.relative(root, where)
    // Only ones inside the config folder: the page reads nothing outside it.
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    const name = key.split('@')[0]
    plugins.push({ name, calledBy: name, abs: where, route: 'plugin' })
  }
  return plugins
}

const ROUTE_NOTES = {
  claudeai: 'claude.ai sends this to the app on each machine. Change it on claude.ai; edits here get overwritten.',
  plugin: 'Installed from a plugin marketplace on this machine. Other machines install their own copy.',
}

/** One sweep of everything. */
export async function scan(root) {
  const git = await readGit(root)
  const relAll = async abs => (await walk(abs)).map(one => toRel(root, one))
  const items = { skills: [], commands: [], agents: [], workflows: [], hookScripts: [], mods: [] }

  // --- Skills in your own folder
  for (const name of await dirsIn(path.join(root, 'skills'))) {
    if (name === 'synced') continue
    const rel = 'skills/' + name
    const files = await relAll(path.join(root, rel))
    const meta = readFrontmatter(await readHead(path.join(root, rel, 'SKILL.md')))
    items.skills.push({
      id: 'own/' + name,
      kind: 'skill',
      name,
      description: files.includes(rel + '/SKILL.md') ? meta.description ?? '' : 'No SKILL.md, so Claude will not load this.',
      path: rel,
      files,
      main: rel + '/SKILL.md',
      isEditable: true,
      owner: '',
      loggedAs: [name],
      ...routeOf(files, git),
    })
  }

  // --- Skills claude.ai sends down
  const syncedSkills = path.join(root, 'skills', 'synced')
  for (const bucket of await dirsIn(syncedSkills)) {
    for (const name of await dirsIn(path.join(syncedSkills, bucket))) {
      const rel = 'skills/synced/' + bucket + '/' + name
      const meta = readFrontmatter(await readHead(path.join(root, rel, 'SKILL.md')))
      items.skills.push({
        id: 'synced/' + name,
        kind: 'skill',
        name,
        description: meta.description ?? '',
        path: rel,
        files: await relAll(path.join(root, rel)),
        main: rel + '/SKILL.md',
        isEditable: false,
        owner: 'claude.ai',
        // Typed as /xlsx, loaded by Claude as anthropic-skills:xlsx.
        loggedAs: [name, 'anthropic-skills:' + name],
        route: 'claudeai',
        note: ROUTE_NOTES.claudeai,
      })
    }
  }

  // --- Flat files: commands, agents, workflows, hook scripts
  const flat = [
    ['commands', 'command', 'commands'],
    ['agents', 'agent', 'agents'],
    ['workflows', 'workflow', 'workflows'],
    ['hooks', 'hook script', 'hookScripts'],
  ]
  for (const [folder, kind, slot] of flat) {
    for (const abs of await walk(path.join(root, folder))) {
      const rel = toRel(root, abs)
      const meta = readFrontmatter(await readHead(abs))
      const name = rel.slice(folder.length + 1).replace(/\.[^.]+$/, '')
      items[slot].push({
        id: folder + '/' + name,
        kind,
        name,
        description: meta.description ?? '',
        path: rel,
        files: [rel],
        main: rel,
        isEditable: true,
        owner: '',
        ...routeOf([rel], git),
      })
    }
  }

  // --- What plugins bring. Theirs to change, so read only here.
  const pluginHooks = []
  for (const plugin of await readPlugins(root)) {
    const shared = {
      isEditable: false,
      owner: plugin.name,
      route: plugin.route,
      note: ROUTE_NOTES[plugin.route],
    }
    for (const name of await dirsIn(path.join(plugin.abs, 'skills'))) {
      const dir = path.join(plugin.abs, 'skills', name)
      const rel = toRel(root, dir)
      const meta = readFrontmatter(await readHead(path.join(dir, 'SKILL.md')))
      items.skills.push({
        id: 'plugin/' + plugin.name + '/' + name,
        kind: 'skill',
        name,
        description: meta.description ?? '',
        path: rel,
        files: await relAll(dir),
        main: rel + '/SKILL.md',
        loggedAs: [plugin.calledBy + ':' + name],
        ...shared,
      })
    }
    for (const [folder, kind, slot] of [['commands', 'command', 'commands'], ['agents', 'agent', 'agents']]) {
      for (const abs of await walk(path.join(plugin.abs, folder))) {
        const rel = toRel(root, abs)
        const meta = readFrontmatter(await readHead(abs))
        const name = path.basename(abs).replace(/\.[^.]+$/, '')
        items[slot].push({
          id: 'plugin/' + plugin.name + '/' + folder + '/' + name,
          kind,
          name,
          description: meta.description ?? '',
          path: rel,
          files: [rel],
          main: rel,
          ...shared,
        })
      }
    }
    const declared = await readJson(path.join(plugin.abs, 'hooks', 'hooks.json'))
    if (declared) pluginHooks.push(...readHookEntries(declared, { source: plugin.name, route: plugin.route, isEditable: false }))
  }

  // --- How often each skill gets used, under each name the log may hold it by.
  const usage = readUsage(root)
  for (const one of items.skills) {
    const seen = one.loggedAs.map(key => usage.skills.get(key)).filter(Boolean)
    const last = seen.map(each => each.last).sort().pop() ?? ''
    one.uses = seen.reduce((n, each) => n + each.uses, 0)
    one.lastUsed = last ? localDay(last) : ''
  }

  // --- Mods, and which of them settings.json turns on
  const settings = (await readJson(path.join(root, 'settings.json'))) ?? {}
  const named = String(settings.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '')
    .replace(/\\/g, '/')
    .split(/;|(?<=.{2}):/)
    .map(one => one.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  // One path naming the mods folder loads every mod inside it. An older
  // settings.json naming one mod at a time still reads correctly.
  const loadsAll = named.some(one => one.endsWith('/mods'))
  // A mod is off when its folder is dot-named: the loader skips those, and git
  // tracks them either way, so the choice syncs like everything else here.
  for (const folder of await dirsIn(path.join(root, 'mods'), { hidden: true })) {
    const name = folder.replace(/^\./, '')
    const rel = 'mods/' + folder
    const files = await relAll(path.join(root, rel))
    const manifest = await readJson(path.join(root, rel, '.claude-plugin', 'plugin.json'))
    if (folder.startsWith('.') && !manifest) continue // A dot folder that is no mod.
    items.mods.push({
      id: 'mod/' + name,
      kind: 'mod',
      name,
      description: manifest?.description ?? '',
      path: rel,
      files: files.filter(one => !one.includes('/.claude-plugin/types/')),
      main: files.find(one => /\/hooks\/register\.tsx?$/.test(one)) ?? files[0] ?? '',
      isEditable: true,
      isOn: !folder.startsWith('.') && (loadsAll || named.some(one => one.endsWith('/mods/' + name))),
      owner: '',
      ...routeOf(files.filter(one => !one.includes('/.claude-plugin/types/')), git),
    })
  }

  // --- Hooks named in settings files
  const hooks = [...pluginHooks]
  for (const file of ['settings.json', 'settings.local.json']) {
    const parsed = await readJson(path.join(root, file))
    if (parsed) hooks.unshift(...readHookEntries(parsed, { source: file, route: routeOf([file], git).route, isEditable: true }))
  }

  // --- Settings files
  const settingsFiles = []
  for (const file of ['settings.json', 'settings.local.json', 'CLAUDE.md']) {
    const exists = await fs.stat(path.join(root, file)).then(() => true, () => false)
    settingsFiles.push({ path: file, exists, ...routeOf([file], git) })
  }

  // --- Everything else at the top of the folder
  const config = []
  for (const one of await fs.readdir(root, { withFileTypes: true })) {
    if (one.name === '.DS_Store') continue
    const under = one.name + '/'
    let count = 0
    for (const held of git.tracked) if (held === one.name || held.startsWith(under)) count++
    config.push({
      name: one.name,
      isDir: one.isDirectory(),
      trackedCount: count,
      note: NOTES[one.name] ?? '',
    })
  }
  config.sort((a, b) => b.trackedCount - a.trackedCount || a.name.localeCompare(b.name))

  const { tracked: _t, changed: _c, unpushed: _u, ...gitPublic } = git
  const folders = (await readJson(path.join(root, 'dashboard', 'folders.json'))) ?? { folders: [] }

  return {
    at: Date.now(),
    root: root.split(path.sep).join('/'),
    machine: os.hostname(),
    platform: process.platform,
    git: gitPublic,
    items,
    hooks,
    settingsFiles,
    config,
    folders: folders.folders ?? [],
    usageSince: usage.since ? localDay(usage.since) : '',
  }
}

/** Hooks out of a settings-shaped object, each with its place in that object. */
export function readHookEntries(parsed, shared) {
  const out = []
  for (const [event, groups] of Object.entries(parsed.hooks ?? {})) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group, groupAt) => {
      ;(group.hooks ?? []).forEach((hook, hookAt) => {
        out.push({
          ...shared,
          event,
          matcher: group.matcher ?? '',
          type: hook.type ?? 'command',
          command: hook.command ?? hook.prompt ?? hook.url ?? '',
          groupAt,
          hookAt,
        })
      })
    })
  }
  return out
}
