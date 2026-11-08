// Runs the real skill-usage hook script against a temp config folder.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { readUsage } from '../../hooks/skill-usage.mjs'

const SCRIPT = fileURLToPath(new URL('../../hooks/skill-usage.mjs', import.meta.url))
let root

const write = (rel, text) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const run = (mode, input = '') =>
  execFileSync(process.execPath, [SCRIPT, mode], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: root } })
const logged = () => {
  const dir = path.join(root, 'usage', 'skills')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).flatMap(file => fs.readFileSync(path.join(dir, file), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)))
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-')))
  write('skills/grilling/SKILL.md', '---\nname: grilling\n---\n')
  write('skills/unused/SKILL.md', '---\nname: unused\n---\n')
})

test('a Skill tool call is logged as used by Claude', () => {
  const out = run('hook', JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'grilling' }, session_id: 's1', cwd: root }))
  assert.equal(out, '')
  const [entry, ...rest] = logged()
  assert.equal(rest.length, 0)
  assert.equal(entry.skill, 'grilling')
  assert.equal(entry.by, 'claude')
  assert.equal(entry.session, 's1')
  assert.ok(!Number.isNaN(Date.parse(entry.at)))
})

test('a typed /skill is logged as used by you, but built-in commands and plain prompts are not', () => {
  const prompt = text => JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: text, session_id: 's2', cwd: root })
  run('hook', prompt('/grilling my plan'))
  run('hook', prompt('/model'))
  run('hook', prompt('please grill me'))
  run('hook', prompt('/design:ux-copy'))
  assert.deepEqual(logged().map(one => [one.skill, one.by]), [['grilling', 'you'], ['design:ux-copy', 'you']])
})

test('a skill in the project folder counts when typed', () => {
  const project = path.join(root, 'proj')
  fs.mkdirSync(path.join(project, '.claude', 'skills', 'deploy'), { recursive: true })
  fs.writeFileSync(path.join(project, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\n')
  run('hook', JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '/deploy', session_id: 's3', cwd: project }))
  assert.deepEqual(logged().map(one => one.skill), ['deploy'])
})

test('bad input logs nothing and never fails', () => {
  assert.equal(run('hook', 'not json'), '')
  assert.equal(run('hook', ''), '')
  assert.deepEqual(logged(), [])
})

test('uses add up across machines, keeping the latest date', () => {
  write('usage/skills/pc.jsonl', '{"skill":"grilling","at":"2026-10-01T10:00:00Z"}\n{"skill":"grilling","at":"2026-10-05T10:00:00Z"}\n')
  write('usage/skills/mac.jsonl', '{"skill":"grilling","at":"2026-10-03T10:00:00Z"}\nbroken line\n')
  const usage = readUsage(root)
  assert.equal(usage.skills.get('grilling').uses, 3)
  assert.equal(usage.skills.get('grilling').last, '2026-10-05T10:00:00Z')
  assert.equal(usage.since, '2026-10-01T10:00:00Z')
  assert.equal(usage.skills.get('unused'), undefined)
})

test('backfill reads past uses from transcripts, once per session', () => {
  const lines = [
    { type: 'user', sessionId: 'old', cwd: root, timestamp: '2026-09-01T09:00:00Z', message: { role: 'user', content: '<command-name>/grilling</command-name>\n<command-args>x</command-args>' } },
    { type: 'user', sessionId: 'old', cwd: root, timestamp: '2026-09-01T09:01:00Z', message: { role: 'user', content: '<command-name>/model</command-name>' } },
    { type: 'assistant', sessionId: 'old', cwd: root, timestamp: '2026-09-02T09:00:00Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Skill', input: { skill: 'grilling' } }] } },
    { type: 'assistant', sessionId: 'seen', cwd: root, timestamp: '2026-09-03T09:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'grilling' } }] } },
  ]
  write('projects/p/old.jsonl', lines.map(one => JSON.stringify(one)).join('\n') + '\nnot json\n')
  write('usage/skills/other.jsonl', '{"skill":"tdd","at":"2026-09-03T09:00:00Z","session":"seen"}\n')
  run('backfill')
  run('backfill')
  const mine = logged().filter(one => one.by !== undefined)
  assert.deepEqual(mine.map(one => [one.skill, one.by, one.at]), [
    ['grilling', 'you', '2026-09-01T09:00:00Z'],
    ['grilling', 'claude', '2026-09-02T09:00:00Z'],
  ])
})

test('the dashboard shows each skill with its uses', async () => {
  write('usage/skills/pc.jsonl', '{"skill":"grilling","at":"2026-10-05T10:00:00Z"}\n')
  const { scan } = await import('../scan.mjs')
  const found = await scan(root)
  const byName = name => found.items.skills.find(one => one.name === name)
  assert.equal(byName('grilling').uses, 1)
  assert.equal(byName('grilling').lastUsed, '2026-10-05')
  assert.equal(byName('unused').uses, 0)
  assert.equal(byName('unused').lastUsed, '')
  assert.equal(found.usageSince, '2026-10-05')
})

test('the report lists unused skills first', () => {
  write('usage/skills/pc.jsonl', '{"skill":"grilling","at":"2026-10-05T10:00:00Z"}\n{"skill":"xlsx","at":"2026-10-06T10:00:00Z"}\n')
  const out = run('report')
  assert.ok(out.indexOf('unused') < out.indexOf('grilling'), out)
  assert.match(out, /unused\s+0\s+never/)
  assert.match(out, /grilling\s+1\s+2026-10-05/)
  assert.match(out, /xlsx/)
})
