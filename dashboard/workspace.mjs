// One sweep of a project folder: the instructions, settings, skills and other
// files Claude reads when a session runs there. Reads only. Paths are relative
// to the project folder, with forward slashes; a file in a folder above it
// starts with ../.

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

import { localDay } from '../hooks/skill-usage.mjs'
import { readFrontmatter } from './scan.mjs'

/** Folders the walk below the project never enters: too big, and never config. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', 'coverage', '.next', '.venv', 'venv', '__pycache__'])
/** How far down, and how many folders, before the walk stops looking. */
const MAX_DEPTH = 6
const MAX_DIRS = 4000
/** Folders inside .claude/ that hold no config: whole checkouts of the repo. */
const SKIP_IN_CLAUDE = new Set(['worktrees'])
/** Past this many files, one .claude/ folder is holding something other than config. */
const MAX_FILES_PER_FOLDER = 300

const posix = rel => rel.split(path.sep).join('/')

const readText = async abs => {
  try {
    return await fs.readFile(abs, 'utf8')
  } catch {
    return ''
  }
}

const isFile = async abs => {
  try {
    return (await fs.stat(abs)).isFile()
  } catch {
    return false
  }
}

const isLink = async abs => {
  try {
    return (await fs.lstat(abs)).isSymbolicLink()
  } catch {
    return false
  }
}

const sameDir = async (a, b) => {
  try {
    return (await fs.realpath(a)) === (await fs.realpath(b))
  } catch {
    return false
  }
}

const git = (dir, args) =>
  new Promise(resolve => {
    execFile('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 20000, windowsHide: true }, (err, stdout) =>
      resolve({ ok: !err, stdout: String(stdout) }),
    )
  })

/** Every file under a folder, links included so the page can show them. */
async function filesUnder(abs, depth = 0, skip = new Set()) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const one of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (one.name === '.DS_Store' || SKIP.has(one.name) || skip.has(one.name)) continue
    const inner = path.join(abs, one.name)
    if (one.isDirectory() && depth < MAX_DEPTH) out.push(...(await filesUnder(inner, depth + 1)))
    else if (one.isFile() || one.isSymbolicLink()) out.push(inner)
  }
  return out
}

/**
 * The project's own folder and every folder below it worth a look: where
 * nested CLAUDE.md files and .claude/ folders live. Stops early in a huge tree.
 */
async function foldersBelow(top) {
  const out = []
  const queue = [{ abs: top, depth: 0 }]
  while (queue.length && out.length < MAX_DIRS) {
    const { abs, depth } = queue.shift()
    out.push(abs)
    if (depth >= MAX_DEPTH) continue
    let entries
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const one of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!one.isDirectory() || SKIP.has(one.name) || one.name.startsWith('.')) continue
      queue.push({ abs: path.join(abs, one.name), depth: depth + 1 })
    }
  }
  return { folders: out, isCut: queue.length > 0 }
}

/** How git treats each file: in the project's repo, waiting, or kept off it. */
async function routesOf(dir, absFiles) {
  const found = new Map(absFiles.map(abs => [abs, { route: 'local', note: 'No git repo here, so this stays on this machine.' }]))
  const top = await git(dir, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return { top: '', found }
  const repo = await fs.realpath(top.stdout.trim())
  const inside = []
  for (const abs of absFiles) {
    const rel = path.relative(repo, abs)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      found.set(abs, { route: 'local', note: 'Outside the project\'s repo, so it stays on this machine.' })
    } else inside.push([abs, posix(rel)])
  }
  if (!inside.length) return { top: repo, found }
  // Name the files when there are few; past that a command line grows too long
  // for Windows, so ask about the whole repo instead.
  const rels = inside.length <= 200 ? inside.map(([, rel]) => rel) : []
  const tracked = new Set((await git(repo, ['ls-files', '-z', '--', ...rels])).stdout.split('\0').filter(Boolean))
  const status = new Map()
  const fields = (await git(repo, ['status', '--porcelain=v1', '-z', '-uall', '--ignored=matching', '--', ...rels])).stdout.split('\0').filter(Boolean)
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i].slice(0, 2)
    status.set(fields[i].slice(3), code)
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  for (const [abs, rel] of inside) {
    const code = status.get(rel)
    if (code === '!!') found.set(abs, { route: 'local', note: 'Git ignores this, so it stays on this machine.' })
    else if (code === '??') found.set(abs, { route: 'pending', note: 'Not in the project\'s repo yet. Commit it to share it with the project.' })
    else if (code) found.set(abs, { route: 'pending', note: 'Changed. Others get this once you commit and push.' })
    else if (tracked.has(rel)) found.set(abs, { route: 'project', note: 'In the project\'s repo, so anyone who clones it gets this.' })
    else found.set(abs, { route: 'local', note: 'Git does not carry this, so it stays on this machine.' })
  }
  return { top: repo, found }
}

/** A short line on what a settings file sets, so it reads without opening. */
function settingsGist(text, rel) {
  let value
  try {
    value = JSON.parse(text || '{}')
  } catch {
    return 'Has a JSON error, so Claude may skip it.'
  }
  if (rel.endsWith('.mcp.json')) {
    const names = Object.keys(value.mcpServers ?? {})
    return names.length ? 'MCP servers: ' + names.join(', ') : 'No MCP servers named.'
  }
  const bits = []
  const rules = ['allow', 'ask', 'deny'].reduce((n, key) => n + (value.permissions?.[key]?.length ?? 0), 0)
  if (rules) bits.push(rules + (rules === 1 ? ' permission rule' : ' permission rules'))
  const hooks = Object.values(value.hooks ?? {}).flat().reduce((n, group) => n + (group?.hooks?.length ?? 0), 0)
  if (hooks) bits.push(hooks + (hooks === 1 ? ' hook' : ' hooks'))
  const env = Object.keys(value.env ?? {}).length
  if (env) bits.push(env + (env === 1 ? ' variable' : ' variables'))
  const other = Object.keys(value).filter(key => !['permissions', 'hooks', 'env', '$schema'].includes(key)).length
  if (other) bits.push(other + (other === 1 ? ' other setting' : ' other settings'))
  return bits.length ? bits.join(', ') : 'Sets nothing yet.'
}

/** What a CLAUDE.md file is for, by where it sits. */
function instructionsGist(rel) {
  const name = path.posix.basename(rel)
  const where = path.posix.dirname(rel.replace(/(^|\/)\.claude\/CLAUDE\.md$/, '$1CLAUDE.md'))
  const isLocal = name === 'CLAUDE.local.md'
  if (rel.startsWith('../')) return isLocal ? 'Your own notes from a folder above, read every session.' : 'From a folder above this one, read every session.'
  if (where === '.') return isLocal ? 'Your own notes for this project, read every session.' : 'The project\'s instructions, read every session.'
  return 'Read when Claude works in ' + where + '/.'
}

/**
 * Everything Claude reads for a session in `dir`. `configRoot` is the global
 * folder: its files belong to the other tabs, so they are left out here.
 */
export async function scanWorkspace(dir, { configRoot, usage } = {}) {
  const home = path.resolve(dir)
  const base = {
    path: posix(home),
    name: path.basename(home) || home,
    isConfigRoot: false,
    repo: '',
    isCut: false,
    items: [],
  }
  if (await sameDir(home, configRoot)) return { ...base, isConfigRoot: true }

  const globalFiles = new Set([path.join(configRoot, 'CLAUDE.md'), path.join(configRoot, 'CLAUDE.local.md')])
  const relOf = abs => posix(path.relative(home, abs))
  const picked = [] // [abs, kind, extra]

  // --- Instruction files above the project: Claude reads every one up the tree.
  for (let up = path.dirname(home); ; up = path.dirname(up)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
      const abs = path.join(up, name)
      if (!globalFiles.has(abs) && (await isFile(abs))) picked.push([abs, 'instructions'])
    }
    if (path.dirname(up) === up) break
  }

  // --- The project and the folders below it.
  const { folders, isCut } = await foldersBelow(home)
  const claudeDirs = []
  for (const folder of folders) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
      const abs = path.join(folder, name)
      if (await isFile(abs)) picked.push([abs, 'instructions'])
    }
    const dotClaude = path.join(folder, '.claude')
    if (!(await sameDir(dotClaude, configRoot)) && (await fs.stat(dotClaude).then(one => one.isDirectory(), () => false))) claudeDirs.push(dotClaude)
  }
  if (await isFile(path.join(home, '.mcp.json'))) picked.push([path.join(home, '.mcp.json'), 'settings'])

  // --- What each .claude/ folder holds.
  const skills = [] // [dirAbs, files]
  let isFull = false
  for (const dotClaude of claudeDirs) {
    const held = await filesUnder(dotClaude, 0, SKIP_IN_CLAUDE)
    if (held.length > MAX_FILES_PER_FOLDER) isFull = true
    for (const abs of held.slice(0, MAX_FILES_PER_FOLDER)) {
      const inner = posix(path.relative(dotClaude, abs))
      const [first] = inner.split('/')
      if (inner === 'CLAUDE.md' || first === 'rules') picked.push([abs, 'instructions'])
      else if (/^settings(\.local)?\.json$/.test(inner)) picked.push([abs, 'settings'])
      else if (first === 'skills' && inner.split('/').length > 2) {
        const dirAbs = path.join(dotClaude, 'skills', inner.split('/')[1])
        const known = skills.find(one => one[0] === dirAbs)
        if (known) known[1].push(abs)
        else skills.push([dirAbs, [abs]])
      } else if (first === 'agents' && inner.endsWith('.md')) picked.push([abs, 'agent'])
      else if (first === 'commands' && inner.endsWith('.md')) picked.push([abs, 'command'])
      else picked.push([abs, 'file', first === inner ? '' : first])
    }
  }

  const everyFile = [...picked.map(one => one[0]), ...skills.flatMap(one => one[1])]
  const { top, found } = await routesOf(home, everyFile)

  const items = []
  for (const [abs, kind, group] of picked) {
    const rel = relOf(abs)
    const text = await readText(abs)
    const meta = readFrontmatter(text)
    let description = ''
    if (kind === 'instructions') description = rel.includes('.claude/rules/') ? meta.description ?? 'A rule file, read with the instructions.' : instructionsGist(rel)
    else if (kind === 'settings') description = settingsGist(text, rel)
    else description = meta.description ?? ''
    const name = kind === 'agent' || kind === 'command' ? path.posix.basename(rel).replace(/\.md$/, '') : rel
    const linked = await isLink(abs)
    items.push({
      id: 'ws:' + rel,
      kind,
      group: group ?? '',
      name,
      description,
      path: rel,
      files: [rel],
      main: rel,
      isEditable: !linked,
      isLink: linked,
      owner: '',
      ...found.get(abs),
    })
  }
  for (const [dirAbs, files] of skills) {
    const rel = relOf(dirAbs)
    const name = path.basename(dirAbs)
    const main = rel + '/SKILL.md'
    const hasMain = files.some(abs => relOf(abs) === main)
    const meta = readFrontmatter(await readText(path.join(dirAbs, 'SKILL.md')))
    const seen = usage?.skills?.get(name)
    // The whole skill syncs the way its least-shared file does.
    const routes = files.map(abs => found.get(abs))
    const worst = routes.find(one => one.route === 'local') ?? routes.find(one => one.route === 'pending') ?? routes[0]
    items.push({
      id: 'ws:' + rel,
      kind: 'skill',
      group: '',
      name,
      description: hasMain ? meta.description ?? '' : 'No SKILL.md, so Claude will not load this.',
      path: rel,
      files: files.map(relOf),
      main: hasMain ? main : relOf(files[0]),
      isEditable: true,
      isLink: false,
      owner: '',
      uses: seen?.uses ?? 0,
      lastUsed: seen?.last ? localDay(seen.last) : '',
      ...worst,
    })
  }

  return { ...base, repo: top ? posix(top) : '', isCut: isCut || isFull, items }
}

/** The last sweep of each folder, so opening a file just listed skips a second one. */
const recent = new Map()
const FRESH_MS = 5000

/** Sweep a folder, keeping the result a few seconds for the file calls that follow. */
export async function sweepWorkspace(dir, options) {
  const found = await scanWorkspace(dir, options)
  recent.set(path.resolve(dir), { at: Date.now(), found })
  return found
}

/** The one file a path names, if this workspace's sweep found it. */
export async function findWorkspaceFile(dir, rel, options) {
  const kept = recent.get(path.resolve(dir))
  const found = kept && Date.now() - kept.at < FRESH_MS ? kept.found : await sweepWorkspace(dir, options)
  for (const item of found.items) {
    if (!item.files.includes(rel)) continue
    // A link stays read only: writing would swap the link for a plain file.
    const abs = path.resolve(dir, rel)
    return { abs, rel, isEditable: !(await isLink(abs)) }
  }
  return null
}
