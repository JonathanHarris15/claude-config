// Runs the real server over HTTP against a real git repo in a temp folder.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { createDashboard } from '../server.mjs'
import { readFrontmatter } from '../scan.mjs'

let root, server, base

const write = (rel, text) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
const call = async (method, url, body, headers = {}) => {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}
const state = async () => (await call('GET', '/api/state')).body
const skill = (found, id) => found.items.skills.find(one => one.id === id)

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-')))
  git('init', '--quiet', '-b', 'main')
  git('config', 'user.email', 't@example.com')
  git('config', 'user.name', 'T')
  write('.gitignore', '*\n!.gitignore\n!settings.json\n!CLAUDE.md\n!skills/\n!skills/**\n!mods/\n!mods/**\n!agents/\n!agents/**\n!dashboard/\n!dashboard/**\nskills/twg*/\nskills/synced/\nskills/.trash/\n')
  write('settings.json', JSON.stringify({ model: 'x', env: { CLAUDE_CODE_PLUGIN_DIRS: '~/.claude/mods/on' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } }))
  write('CLAUDE.md', 'hello\n')
  write('skills/kept/SKILL.md', '---\nname: kept\ndescription: >\n  Folded words\n  over lines.\n---\nbody\n')
  write('agents/a.md', '---\nname: a\ndescription: An agent\n---\n')
  write('mods/on/.claude-plugin/plugin.json', '{"name":"on","description":"A mod"}')
  write('mods/on/hooks/register.tsx', 'x')
  write('mods/off/.claude-plugin/plugin.json', '{"name":"off"}')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'first')
  write('skills/twg-x/SKILL.md', '---\nname: twg-x\ndescription: Local\n---\n')
  write('skills/fresh/SKILL.md', '---\nname: fresh\ndescription: New\n---\n')
  write('skills/synced/acct/fromai/SKILL.md', '---\nname: fromai\ndescription: Cloud\n---\n')
  write('skills/synced/acct/manifest.json', '{}')
  write('plugins/synced/acct/pl/skills/pskill/SKILL.md', '---\nname: pskill\n---\n')
  write('plugins/cache/m/inst/1/skills/ins/SKILL.md', '---\nname: ins\n---\n')
  write('plugins/installed_plugins.json', JSON.stringify({ plugins: { 'inst@m': [{ installPath: path.join(root, 'plugins/cache/m/inst/1') }] } }))
  write('.credentials.json', 'SECRET')
  server = createDashboard({ root })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  base = 'http://127.0.0.1:' + server.address().port
})

after(() => {
  server.close()
  fs.rmSync(root, { recursive: true, force: true })
})

test('every skill says how it reaches other machines', async () => {
  const found = await state()
  assert.equal(skill(found, 'own/kept').route, 'git')
  assert.equal(skill(found, 'own/fresh').route, 'pending')
  assert.equal(skill(found, 'own/twg-x').route, 'local')
  assert.equal(skill(found, 'synced/fromai').route, 'claudeai')
  assert.equal(skill(found, 'plugin/pl/pskill').route, 'claudeai')
  assert.equal(skill(found, 'plugin/inst/ins').route, 'plugin')
  assert.equal(skill(found, 'synced/fromai').isEditable, false)
})

test('an edit to a tracked skill shows as waiting, then clears when committed', async () => {
  write('skills/kept/extra.md', 'x')
  assert.equal(skill(await state(), 'own/kept').route, 'pending')
  fs.rmSync(path.join(root, 'skills/kept/extra.md'))
  assert.equal(skill(await state(), 'own/kept').route, 'git')
})

test('a folded description reads as one line', async () => {
  assert.equal(skill(await state(), 'own/kept').description, 'Folded words over lines.')
  assert.deepEqual(readFrontmatter('no frontmatter'), {})
})

test('mods say whether settings turn them on', async () => {
  const { mods } = (await state()).items
  assert.equal(mods.find(one => one.name === 'on').isOn, true)
  assert.equal(mods.find(one => one.name === 'off').isOn, false)
})

test('hooks in settings are listed', async () => {
  const [hook] = (await state()).hooks
  assert.equal(hook.event, 'Stop')
  assert.equal(hook.command, 'echo hi')
  assert.equal(hook.isEditable, true)
})

test('saving writes the file, and a stale save is refused', async () => {
  const opened = (await call('GET', '/api/file?path=skills/kept/SKILL.md')).body
  const saved = await call('PUT', '/api/file', { path: 'skills/kept/SKILL.md', text: opened.text + 'more\n', mtimeMs: opened.mtimeMs })
  assert.equal(saved.status, 200)
  assert.match(fs.readFileSync(path.join(root, 'skills/kept/SKILL.md'), 'utf8'), /more/)
  const stale = await call('PUT', '/api/file', { path: 'skills/kept/SKILL.md', text: 'old', mtimeMs: opened.mtimeMs })
  assert.equal(stale.status, 409)
  git('checkout', '--', 'skills/kept/SKILL.md')
})

test('broken JSON is never saved over settings', async () => {
  const res = await call('PUT', '/api/file', { path: 'settings.json', text: '{ nope' })
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8')).model, 'x')
})

test('it reads and writes only what it should', async () => {
  for (const bad of ['.credentials.json', '../secret', '/etc/passwd', 'skills/../.credentials.json', 'projects/x', '.gitignore']) {
    assert.equal((await call('GET', '/api/file?path=' + encodeURIComponent(bad))).status, 403, bad)
    assert.equal((await call('PUT', '/api/file', { path: bad, text: 'x' })).status, 403, bad)
  }
  assert.equal((await call('PUT', '/api/file', { path: 'skills/synced/acct/fromai/SKILL.md', text: 'x' })).status, 403)
  assert.equal((await call('GET', '/api/file?path=skills/synced/acct/fromai/SKILL.md')).body.isEditable, false)
})

test('a link cannot lead out of the folder', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'out-'))
  fs.writeFileSync(path.join(outside, 'x.md'), 'secret')
  fs.symlinkSync(outside, path.join(root, 'skills/leak'))
  assert.equal((await call('GET', '/api/file?path=skills/leak/x.md')).status, 403)
  assert.equal((await call('PUT', '/api/file', { path: 'skills/leak/new.md', text: 'x' })).status, 403)
  fs.rmSync(path.join(root, 'skills/leak'))
  fs.rmSync(outside, { recursive: true })
})

test('requests another site could forge are refused', async () => {
  const evil = await call('POST', '/api/delete', { path: 'skills/kept' }, { Origin: 'https://evil.example' })
  assert.equal(evil.status, 403)
  const site = await call('GET', '/api/state', undefined, { 'Sec-Fetch-Site': 'cross-site' })
  assert.equal(site.status, 403)
  const form = await fetch(base + '/api/delete', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"path":"skills/kept"}' })
  assert.equal(form.status, 403)
  assert.ok(fs.existsSync(path.join(root, 'skills/kept/SKILL.md')))
})

test('a new skill lands where Claude finds it, and a name clash is refused', async () => {
  const made = await call('POST', '/api/new', { kind: 'skill', name: 'brand-new' })
  assert.equal(made.body.path, 'skills/brand-new/SKILL.md')
  assert.equal(skill(await state(), 'own/brand-new').route, 'pending')
  assert.equal((await call('POST', '/api/new', { kind: 'skill', name: 'brand-new' })).status, 409)
  assert.equal((await call('POST', '/api/new', { kind: 'skill', name: '../up' })).status, 400)
})

test('a new mod has every file a mod needs', async () => {
  await call('POST', '/api/new', { kind: 'mod', name: 'mymod' })
  for (const one of ['.claude-plugin/plugin.json', 'hooks/hooks.json', 'hooks/register.tsx']) {
    assert.ok(fs.existsSync(path.join(root, 'mods/mymod', one)), one)
  }
})

test('deleting keeps a copy, and cannot reach settings', async () => {
  await call('POST', '/api/new', { kind: 'skill', name: 'doomed' })
  const gone = await call('POST', '/api/delete', { path: 'skills/doomed' })
  assert.equal(gone.status, 200)
  assert.ok(!fs.existsSync(path.join(root, 'skills/doomed')))
  assert.ok(fs.existsSync(path.join(root, gone.body.kept, 'SKILL.md')))
  assert.equal((await call('POST', '/api/delete', { path: 'settings.json' })).status, 403)
  assert.equal((await call('POST', '/api/delete', { path: 'skills' })).status, 403)
})

test('tracking a left-out skill names it in the allow list, staged only', async () => {
  const before = git('rev-parse', 'HEAD')
  const done = await call('POST', '/api/track', { id: 'own/twg-x' })
  assert.equal(done.status, 200)
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /!skills\/twg-x\/\*\*/)
  assert.match(git('diff', '--cached', '--name-only'), /skills\/twg-x\/SKILL\.md/)
  assert.equal(git('rev-parse', 'HEAD'), before)
  assert.equal(skill(await state(), 'own/twg-x').route, 'pending')
})

test('tracking a claude.ai skill copies it and leaves the original', async () => {
  const done = await call('POST', '/api/track', { id: 'synced/fromai' })
  assert.equal(done.body.path, 'skills/fromai')
  assert.ok(fs.existsSync(path.join(root, 'skills/fromai/SKILL.md')))
  assert.ok(fs.existsSync(path.join(root, 'skills/synced/acct/fromai/SKILL.md')))
  assert.equal((await call('POST', '/api/track', { id: 'synced/fromai' })).status, 409)
})

test('folders save as labels and touch no skill on disk', async () => {
  const saved = await call('POST', '/api/folders', { folders: [{ name: 'Mine', skills: ['own/kept'] }] })
  assert.equal(saved.status, 200)
  assert.deepEqual((await state()).folders, [{ name: 'Mine', skills: ['own/kept'] }])
  assert.ok(fs.existsSync(path.join(root, 'skills/kept/SKILL.md')))
  assert.equal((await call('POST', '/api/folders', { folders: [{ name: 'A', skills: [] }, { name: 'A', skills: [] }] })).status, 409)
})

test('the page never sees a secret file name as readable content', async () => {
  const body = JSON.stringify(await state())
  assert.ok(!body.includes('SECRET'))
})
