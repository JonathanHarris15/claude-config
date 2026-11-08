// The dashboard's local server. No dependencies, so it runs from a fresh pull on
// any machine with Node. Binds to this machine only, and refuses any request a
// web page could have forged, because it can write files Claude will execute.

import { cp, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { scan } from './scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, 'public')
const MARK = '# Added from the config dashboard, tracked on purpose.'

/** Goes quiet after this long with no page open, so nothing lingers for days. */
const IDLE_MS = 60 * 60 * 1000

/** Where the page may read, and the smaller set it may change. */
const READABLE = ['skills/', 'agents/', 'workflows/', 'hooks/', 'mods/', 'plugins/synced/', 'plugins/cache/']
const WRITABLE = ['skills/', 'agents/', 'workflows/', 'hooks/', 'mods/']
const NEVER_WRITE = ['skills/synced/', 'skills/.trash/']
const TOP_FILES = ['settings.json', 'settings.local.json', 'CLAUDE.md']

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }

class Refused extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const canRead = rel => TOP_FILES.includes(rel) || READABLE.some(one => rel.startsWith(one))
const canWrite = rel =>
  TOP_FILES.includes(rel) || (WRITABLE.some(one => rel.startsWith(one)) && !NEVER_WRITE.some(one => rel.startsWith(one)))

/** Which build of the server is running, so the launcher can swap an old one out. */
export const buildId = () =>
  ['server.mjs', 'scan.mjs'].map(one => statSync(path.join(HERE, one)).mtimeMs).join('-')

/** Fixed when this copy starts, so a newer copy on disk shows up as different. */
const RUNNING_BUILD = buildId()

/** A relative path made safe: inside the root, following links, or refused. */
async function resolveInside(root, rel, allowed) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0')) throw new Refused(400, 'No path given.')
  const clean = path.posix.normalize(rel.replace(/\\/g, '/'))
  if (clean.startsWith('..') || path.posix.isAbsolute(clean) || /^[A-Za-z]:/.test(clean)) throw new Refused(403, 'That path is outside the config folder.')
  if (!allowed(clean)) throw new Refused(403, 'The dashboard does not touch ' + clean + '.')
  const abs = path.join(root, clean)
  // A link inside the folder must not lead out of it. Walk up to what exists.
  let probe = abs
  for (;;) {
    try {
      const real = await realpath(probe)
      const realRoot = await realpath(root)
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Refused(403, 'That path leads outside the config folder.')
      break
    } catch (err) {
      if (err instanceof Refused) throw err
      const up = path.dirname(probe)
      if (up === probe) break
      probe = up
    }
  }
  return { abs, rel: clean }
}

const git = (root, args) =>
  new Promise(resolve => {
    execFile('git', ['-C', root, ...args], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout, stderr: String(stderr || err?.message || '') }),
    )
  })

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

const TEMPLATES = {
  skill: name => ({
    [`skills/${name}/SKILL.md`]: `---\nname: ${name}\ndescription: What this does, and when Claude should reach for it.\n---\n\n# ${name}\n\n`,
  }),
  agent: name => ({
    [`agents/${name}.md`]: `---\nname: ${name}\ndescription: What this agent is for, and when to use it.\ntools: Read, Grep, Glob\nmodel: sonnet\n---\n\nYou are...\n`,
  }),
  workflow: name => ({
    [`workflows/${name}.js`]: `export const meta = {\n  name: '${name}',\n  description: 'What this workflow does.',\n  phases: [{ title: 'Work' }],\n}\n\nconst result = await agent('What the agent should do.', { label: 'work', phase: 'Work' })\nreturn result\n`,
  }),
  'hook script': name => ({
    // Node, not a shell script, so one file works on Windows and Mac alike.
    [`hooks/${name}.mjs`]: `// Claude sends the event as JSON on stdin. Name this file in a hook's command:\n//   node "$HOME/.claude/hooks/${name}.mjs"\n\nlet raw = ''\nfor await (const piece of process.stdin) raw += piece\nconst event = JSON.parse(raw)\n\nconsole.error(event.hook_event_name)\n`,
  }),
  mod: name => ({
    [`mods/${name}/.claude-plugin/plugin.json`]: JSON.stringify({ name, version: '0.1.0', description: 'What this mod does.' }, null, 2) + '\n',
    [`mods/${name}/hooks/hooks.json`]: '{ "modules": ["./register.tsx"] }\n',
    [`mods/${name}/hooks/register.tsx`]: `import type { Register } from 'claude-code'\n\nexport const register: Register = on => {\n  on('session.start', async ($, e, next) => {\n    $.ui.status('${name} is on')\n    return next(e)\n  })\n}\n`,
  }),
}

async function exists(abs) {
  return stat(abs).then(() => true, () => false)
}

async function writeAtomic(abs, text) {
  await mkdir(path.dirname(abs), { recursive: true })
  const temp = abs + '.dashboard-' + process.pid + '.tmp'
  await writeFile(temp, text, 'utf8')
  await rename(temp, abs)
}

/** Put a skill in the repo: in place if it sits in skills/, or as a copy if something else owns it. */
async function trackSkill(root, id) {
  const state = await scan(root)
  const skill = state.items.skills.find(one => one.id === id)
  if (!skill) throw new Refused(404, 'No such skill.')
  if (skill.route === 'git' || skill.route === 'pending') throw new Refused(409, skill.name + ' is already in the repo.')

  if (skill.isEditable) {
    // A skill in skills/ that the allow list leaves out: name it as an exception.
    const ignore = path.join(root, '.gitignore')
    let text = await readFile(ignore, 'utf8')
    if (!text.includes(MARK)) text = text.replace(/\n*$/, '\n\n' + MARK + '\n')
    else text = text.replace(/\n*$/, '\n')
    text += `!skills/${skill.name}/\n!skills/${skill.name}/**\n`
    await writeAtomic(ignore, text)
    const added = await git(root, ['add', '--', '.gitignore', `skills/${skill.name}`])
    if (!added.ok) throw new Refused(500, 'git add failed: ' + added.stderr)
    return { path: skill.path, text: `${skill.name} is now staged where it sits. It syncs on your next commit and push.` }
  }

  // Something else writes the original, so tracking in place would be a fight.
  const target = 'skills/' + skill.name
  if (await exists(path.join(root, target))) throw new Refused(409, target + ' already exists.')
  await cp(path.join(root, skill.path), path.join(root, target), { recursive: true })
  const added = await git(root, ['add', '--', target])
  if (!added.ok) throw new Refused(500, 'git add failed: ' + added.stderr)
  return { path: target, text: `Copied to ${target} and staged. The original stays with ${skill.owner}, so you now have two with this name.` }
}

async function handleApi(root, req, url, body) {
  const route = req.method + ' ' + url.pathname

  switch (route) {
    case 'GET /api/ping':
      return { app: 'claude-config-dashboard', build: RUNNING_BUILD, root: root.split(path.sep).join('/') }

    case 'GET /api/state':
      return scan(root)

    case 'GET /api/file': {
      const { abs, rel } = await resolveInside(root, url.searchParams.get('path'), canRead)
      let info
      try {
        info = await stat(abs)
      } catch {
        throw new Refused(404, rel + ' does not exist.')
      }
      if (!info.isFile()) throw new Refused(400, rel + ' is not a file.')
      const base = { path: rel, mtimeMs: info.mtimeMs, isEditable: canWrite(rel) }
      if (info.size > 2 * 1024 * 1024) return { ...base, isBinary: true, text: '', isEditable: false }
      const bytes = await readFile(abs)
      if (bytes.includes(0)) return { ...base, isBinary: true, text: '', isEditable: false }
      return { ...base, isBinary: false, text: bytes.toString('utf8') }
    }

    case 'PUT /api/file': {
      const { abs, rel } = await resolveInside(root, body.path, canWrite)
      if (typeof body.text !== 'string') throw new Refused(400, 'No text given.')
      if (rel.endsWith('.json')) {
        try {
          JSON.parse(body.text)
        } catch (err) {
          throw new Refused(400, 'That is not valid JSON, so it was not saved: ' + err.message)
        }
      }
      const was = await stat(abs).catch(() => null)
      if (was && body.mtimeMs !== undefined && was.mtimeMs !== body.mtimeMs) {
        throw new Refused(409, rel + ' changed on disk since you opened it. Reload it first.')
      }
      await writeAtomic(abs, body.text)
      return { path: rel, mtimeMs: (await stat(abs)).mtimeMs }
    }

    case 'POST /api/new': {
      const make = TEMPLATES[body.kind]
      if (!make) throw new Refused(400, 'Nothing to make of that kind.')
      if (!NAME.test(body.name ?? '')) throw new Refused(400, 'Use letters, numbers, dashes and dots in the name.')
      const files = make(body.name)
      const made = Object.keys(files)
      for (const rel of made) {
        const { abs } = await resolveInside(root, rel, canWrite)
        if (await exists(abs)) throw new Refused(409, rel + ' already exists.')
      }
      for (const rel of made) await writeAtomic(path.join(root, rel), files[rel])
      return { path: made[made.length - 1] }
    }

    case 'POST /api/new-file': {
      const dir = String(body.dir ?? '')
      const name = String(body.name ?? '')
      if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').includes('..')) throw new Refused(400, 'That file name will not do.')
      const { abs, rel } = await resolveInside(root, dir + '/' + name, canWrite)
      if (await exists(abs)) throw new Refused(409, rel + ' already exists.')
      await writeAtomic(abs, '')
      return { path: rel }
    }

    case 'POST /api/delete': {
      // Moved, not erased: an untracked file has no other copy anywhere.
      const { abs, rel } = await resolveInside(root, body.path, canWrite)
      if (TOP_FILES.includes(rel)) throw new Refused(403, rel + ' cannot be deleted from here.')
      if (rel.split('/').length < 2) throw new Refused(403, 'That is a whole section.')
      if (!(await exists(abs))) throw new Refused(404, rel + ' does not exist.')
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const kept = path.join(root, 'backups', 'dashboard-trash', stamp, rel)
      await mkdir(path.dirname(kept), { recursive: true })
      await cp(abs, kept, { recursive: true })
      await rm(abs, { recursive: true, force: true })
      return { kept: path.relative(root, kept).split(path.sep).join('/') }
    }

    case 'POST /api/track':
      return trackSkill(root, body.id)

    case 'POST /api/mod-on': {
      // On and off is where the folder sits. The loader skips a dot-named one,
      // and git tracks it either way, so the choice syncs with everything else.
      const name = String(body.name ?? '').replace(/^\.+/, '')
      if (!NAME.test(name)) throw new Refused(400, 'That is not a mod name.')
      const on = body.on === true
      const from = path.join(root, 'mods', on ? '.' + name : name)
      const to = path.join(root, 'mods', on ? name : '.' + name)
      if (!(await exists(from))) {
        if (await exists(to)) return { name, isOn: on } // Already where it should be.
        throw new Refused(404, 'mods/' + name + ' does not exist.')
      }
      if (await exists(to)) {
        throw new Refused(409, 'Both mods/' + name + ' and mods/.' + name + ' exist. Sort that out by hand.')
      }
      await rename(from, to)
      return { name, isOn: on }
    }

    case 'POST /api/folders': {
      if (!Array.isArray(body.folders)) throw new Refused(400, 'No folders given.')
      const folders = body.folders.map(one => ({
        name: String(one.name ?? '').trim().slice(0, 80),
        skills: Array.isArray(one.skills) ? one.skills.filter(id => typeof id === 'string') : [],
      }))
      if (folders.some(one => !one.name)) throw new Refused(400, 'A folder needs a name.')
      if (new Set(folders.map(one => one.name)).size !== folders.length) throw new Refused(409, 'Two folders share a name.')
      await writeAtomic(path.join(root, 'dashboard', 'folders.json'), JSON.stringify({ folders }, null, 2) + '\n')
      return { folders }
    }

    case 'POST /api/fetch': {
      const done = await git(root, ['fetch', '--quiet', 'origin'])
      return { ok: done.ok, trouble: done.ok ? '' : 'Could not reach GitHub.' }
    }

    case 'POST /api/quit':
      setTimeout(() => process.exit(0), 50)
      return { ok: true }
  }
  throw new Refused(404, 'No such call.')
}

/** The page's only callers are its own: same host, and never another site. */
function refuseForged(req, port) {
  const host = req.headers.host ?? ''
  if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) return 'wrong host'
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return 'another site'
  if (req.method !== 'GET') {
    const origin = req.headers.origin
    if (origin && origin !== 'http://' + host) return 'another origin'
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return 'not JSON'
  }
  return ''
}

export function createDashboard({ root, onActivity = () => {} }) {
  const server = http.createServer(async (req, res) => {
    onActivity()
    const send = (status, type, data) => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(data)
    }
    const json = (status, value) => send(status, 'application/json; charset=utf-8', JSON.stringify(value))

    const port = server.address().port
    const forged = refuseForged(req, port)
    if (forged) return json(403, { error: 'Refused: ' + forged + '.' })

    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname.startsWith('/api/')) {
        let body = {}
        if (req.method !== 'GET') {
          let raw = ''
          for await (const piece of req) {
            raw += piece
            if (raw.length > 8 * 1024 * 1024) throw new Refused(413, 'Too large.')
          }
          body = raw ? JSON.parse(raw) : {}
        }
        return json(200, await handleApi(root, req, url, body))
      }
      if (req.method !== 'GET') return json(405, { error: 'No.' })
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      if (!/^[a-z.]+$/.test(name) || !TYPES[path.extname(name)]) return send(404, 'text/plain', 'Not found')
      return send(200, TYPES[path.extname(name)], await readFile(path.join(PUBLIC, name)))
    } catch (err) {
      if (err.code === 'ENOENT') return send(404, 'text/plain', 'Not found')
      return json(err.status ?? 500, { error: err.message })
    }
  })
  return server
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await realpath(process.argv[1]))) {
  const root = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'))
  const port = Number(process.env.CONFIG_DASHBOARD_PORT || 4915)
  let last = Date.now()
  const server = createDashboard({ root, onActivity: () => (last = Date.now()) })
  server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + port + '/'))
  server.on('error', err => {
    console.error(err.message)
    process.exit(1)
  })
  setInterval(() => {
    if (Date.now() - last > IDLE_MS) process.exit(0)
  }, 60 * 1000).unref()
}

