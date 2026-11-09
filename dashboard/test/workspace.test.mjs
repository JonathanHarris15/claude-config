// The Workspace tab's server side: a real project repo in a temp folder, a
// config folder beside it, and the real server between them over HTTP.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { createDashboard } from '../server.mjs'

let top, config, project, server, base, ws

const write = (abs, text) => {
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const inProject = (rel, text) => write(path.join(project, rel), text)
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' })
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}
const sweep = async () => (await call('GET', '/api/workspace?ws=' + ws)).body
const item = (found, rel) => found.items.find(one => one.path === rel)
const file = rel => call('GET', '/api/file?ws=' + ws + '&path=' + encodeURIComponent(rel))

before(async () => {
  top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-')))
  config = path.join(top, 'config')
  project = path.join(top, 'code', 'app')
  write(path.join(config, 'CLAUDE.md'), 'global\n')
  write(path.join(top, 'code', 'CLAUDE.md'), 'from above\n')

  fs.mkdirSync(project, { recursive: true })
  git('init', '--quiet', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'T')
  inProject('.gitignore', 'CLAUDE.local.md\n.claude/settings.local.json\n')
  inProject('CLAUDE.md', 'project rules\n')
  inProject('packages/api/CLAUDE.md', 'api rules\n')
  inProject('.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(npm test)', 'Read'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } }))
  inProject('.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Ship it\n---\n')
  inProject('.claude/agents/checker.md', '---\nname: checker\ndescription: Checks things\n---\n')
  inProject('.mcp.json', JSON.stringify({ mcpServers: { db: {}, docs: {} } }))
  inProject('src/index.js', 'console.log(1)\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'first')
  inProject('CLAUDE.local.md', 'my notes\n')
  inProject('.claude/settings.local.json', '{}')
  inProject('.claude/commands/go.md', '---\ndescription: Go\n---\n')
  inProject('.claude/output-styles/terse.md', 'short\n')
  inProject('node_modules/dep/CLAUDE.md', 'never read\n')

  server = createDashboard({ root: config })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = 'http://127.0.0.1:' + server.address().port
  ws = (await call('POST', '/api/workspace', { path: project })).body.id
})

after(() => {
  server.close()
  fs.rmSync(top, { recursive: true, force: true })
})

test('the launcher names a folder and gets back a short id', async () => {
  assert.match(ws, /^[0-9a-f]{12}$/)
  const again = await call('POST', '/api/workspace', { path: project })
  assert.equal(again.body.id, ws)
  assert.equal((await call('POST', '/api/workspace', { path: 'relative/path' })).status, 400)
  assert.equal((await call('POST', '/api/workspace', { path: path.join(top, 'nope') })).status, 404)
})

test('it finds instructions here, below, and in folders above, but not the global ones', async () => {
  const found = await sweep()
  const kinds = Object.fromEntries(found.items.map(one => [one.path, one.kind]))
  assert.equal(kinds['CLAUDE.md'], 'instructions')
  assert.equal(kinds['CLAUDE.local.md'], 'instructions')
  assert.equal(kinds['packages/api/CLAUDE.md'], 'instructions')
  assert.equal(kinds['../CLAUDE.md'], 'instructions')
  assert.equal(found.items.some(one => one.path.includes('config/CLAUDE.md')), false)
  assert.equal(found.items.some(one => one.path.includes('node_modules')), false)
  assert.equal(found.items.some(one => one.path.includes('worktrees')), false)
  assert.match(item(found, 'packages/api/CLAUDE.md').description, /packages\/api/)
})

test('it finds settings, skills, agents, commands and other files', async () => {
  const found = await sweep()
  assert.equal(item(found, '.claude/settings.json').kind, 'settings')
  assert.match(item(found, '.claude/settings.json').description, /2 permission rules, 1 hook/)
  assert.match(item(found, '.mcp.json').description, /db, docs/)
  const deploy = item(found, '.claude/skills/deploy')
  assert.equal(deploy.kind, 'skill')
  assert.equal(deploy.description, 'Ship it')
  assert.equal(item(found, '.claude/agents/checker.md').name, 'checker')
  assert.equal(item(found, '.claude/commands/go.md').kind, 'command')
  const style = item(found, '.claude/output-styles/terse.md')
  assert.equal(style.kind, 'file')
  assert.equal(style.group, 'output-styles')
})

test('each file says whether the project repo carries it', async () => {
  const found = await sweep()
  assert.equal(item(found, 'CLAUDE.md').route, 'project')
  assert.equal(item(found, 'CLAUDE.local.md').route, 'local')
  assert.equal(item(found, '.claude/settings.local.json').route, 'local')
  assert.equal(item(found, '.claude/commands/go.md').route, 'pending')
  assert.equal(item(found, '../CLAUDE.md').route, 'local')
})

test('it opens and saves a file it found', async () => {
  const opened = await file('CLAUDE.md')
  assert.equal(opened.status, 200)
  assert.equal(opened.body.text, 'project rules\n')
  assert.equal(opened.body.isEditable, true)
  const saved = await call('PUT', '/api/file', { ws, path: 'CLAUDE.md', text: 'new rules\n', mtimeMs: opened.body.mtimeMs })
  assert.equal(saved.status, 200)
  assert.equal(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), 'new rules\n')
  const stale = await call('PUT', '/api/file', { ws, path: 'CLAUDE.md', text: 'x', mtimeMs: 1 })
  assert.equal(stale.status, 409)
  const broken = await call('PUT', '/api/file', { ws, path: '.claude/settings.json', text: '{ nope' })
  assert.equal(broken.status, 400)
})

test('it touches nothing in the project it did not find', async () => {
  for (const rel of ['src/index.js', '.gitignore', '../config/CLAUDE.md', 'node_modules/dep/CLAUDE.md', '../../x']) {
    assert.equal((await file(rel)).status, 403, rel)
    assert.equal((await call('PUT', '/api/file', { ws, path: rel, text: 'x' })).status, 403, rel)
  }
  assert.equal(fs.readFileSync(path.join(project, 'src/index.js'), 'utf8'), 'console.log(1)\n')
})

test('an id the server never gave out is refused', async () => {
  assert.equal((await call('GET', '/api/workspace?ws=000000000000')).status, 404)
  assert.equal((await call('GET', '/api/file?ws=000000000000&path=CLAUDE.md')).status, 404)
})

test('another site cannot name a folder', async () => {
  const evil = await call('POST', '/api/workspace', { path: top }, { Origin: 'https://evil.example' })
  assert.equal(evil.status, 403)
  const sneaky = await call('POST', '/api/workspace', { path: top }, { 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(sneaky.status, 403)
})

test('the config folder itself is not a workspace', async () => {
  const id = (await call('POST', '/api/workspace', { path: config })).body.id
  const found = (await call('GET', '/api/workspace?ws=' + id)).body
  assert.equal(found.isConfigRoot, true)
  assert.deepEqual(found.items, [])
})
