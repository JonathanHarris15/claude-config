#!/usr/bin/env node
// Counts how often each skill gets used, so skills that sit in the config
// unused stand out. Each machine appends to its own file under usage/skills/,
// so the synced logs never clash. Skill files themselves are never touched.
//
//   node skill-usage.mjs hook      settings.json runs this on each prompt and Skill call
//   node skill-usage.mjs report    every skill with its uses and last date, least used first
//   node skill-usage.mjs backfill  once per machine: past uses out of session transcripts

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const configRoot = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const logDir = root => path.join(root, 'usage', 'skills')
const machine = () => os.hostname().replace(/\.local$/, '').replace(/[^\w.-]/g, '_') || 'machine'

const isFile = abs => {
  try {
    return fs.statSync(abs).isFile()
  } catch {
    return false
  }
}

const dirsIn = abs => {
  try {
    return fs.readdirSync(abs, { withFileTypes: true }).filter(one => one.isDirectory() && !one.name.startsWith('.')).map(one => one.name)
  } catch {
    return []
  }
}

/** Whether a typed /name is a skill rather than a built-in command like /model. */
function isSkill(name, root, cwd) {
  if (name.includes(':')) return true // plugin:skill
  if (isFile(path.join(root, 'skills', name, 'SKILL.md'))) return true
  if (isFile(path.join(root, 'commands', name + '.md'))) return true
  if (cwd && isFile(path.join(cwd, '.claude', 'skills', name, 'SKILL.md'))) return true
  if (cwd && isFile(path.join(cwd, '.claude', 'commands', name + '.md'))) return true
  return dirsIn(path.join(root, 'skills', 'synced')).some(bucket => isFile(path.join(root, 'skills', 'synced', bucket, name, 'SKILL.md')))
}

const typedName = text => /^\s*\/([\w:.-]+)/.exec(text)?.[1] ?? ''

function append(root, entries) {
  if (!entries.length) return
  fs.mkdirSync(logDir(root), { recursive: true })
  fs.appendFileSync(path.join(logDir(root), machine() + '.jsonl'), entries.map(one => JSON.stringify(one) + '\n').join(''))
}

function readLog(root) {
  const out = []
  for (const file of fs.existsSync(logDir(root)) ? fs.readdirSync(logDir(root)) : []) {
    if (!file.endsWith('.jsonl')) continue
    for (const line of fs.readFileSync(path.join(logDir(root), file), 'utf8').split('\n')) {
      try {
        const entry = JSON.parse(line)
        if (entry?.skill && entry.at) out.push(entry)
      } catch {}
    }
  }
  return out
}

/** Uses and last date per skill, across every machine's log. */
export function readUsage(root = configRoot()) {
  const skills = new Map()
  let since = ''
  for (const { skill, at } of readLog(root)) {
    const seen = skills.get(skill) ?? { uses: 0, last: '' }
    seen.uses++
    if (at > seen.last) seen.last = at
    skills.set(skill, seen)
    if (!since || at < since) since = at
  }
  return { skills, since }
}

/** The one use a hook event records, or null. */
function useFromEvent(event, root) {
  const base = { at: new Date().toISOString(), session: event.session_id ?? '' }
  if (event.hook_event_name === 'PostToolUse' && event.tool_name === 'Skill') {
    const skill = String(event.tool_input?.skill ?? '').replace(/^\//, '').trim()
    return skill ? { skill, by: 'claude', ...base } : null
  }
  if (event.hook_event_name === 'UserPromptSubmit') {
    const skill = typedName(String(event.prompt ?? ''))
    return skill && isSkill(skill, root, event.cwd) ? { skill, by: 'you', ...base } : null
  }
  return null
}

function hook(root) {
  try {
    const use = useFromEvent(JSON.parse(fs.readFileSync(0, 'utf8')), root)
    if (use) append(root, [use])
  } catch {}
  // Prints nothing: anything a UserPromptSubmit hook prints lands in the prompt.
}

function transcripts(abs) {
  const out = []
  for (const one of fs.existsSync(abs) ? fs.readdirSync(abs, { withFileTypes: true }) : []) {
    const inner = path.join(abs, one.name)
    if (one.isDirectory()) out.push(...transcripts(inner))
    else if (one.name.endsWith('.jsonl')) out.push(inner)
  }
  return out
}

/** Past uses out of this machine's transcripts, skipping sessions the log already has. */
function backfill(root) {
  const known = new Set(readLog(root).map(one => one.session).filter(Boolean))
  const found = []
  for (const file of transcripts(path.join(root, 'projects'))) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let entry
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      const session = entry?.sessionId
      if (!session || known.has(session) || !entry.timestamp) continue
      const base = { at: entry.timestamp, session, from: 'backfill' }
      const content = entry.message?.content
      if (entry.type === 'assistant' && Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === 'tool_use' && part.name === 'Skill' && part.input?.skill) found.push({ skill: String(part.input.skill).replace(/^\//, ''), by: 'claude', ...base })
        }
      }
      if (entry.type === 'user') {
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : ''
        const skill = /<command-name>\/?([\w:.-]+)<\/command-name>/.exec(text)?.[1]
        if (skill && isSkill(skill, root, entry.cwd)) found.push({ skill, by: 'you', ...base })
      }
    }
  }
  found.sort((a, b) => a.at.localeCompare(b.at))
  append(root, found)
  const sessions = new Set(found.map(one => one.session)).size
  console.log(`Backfilled ${found.length} past uses from ${sessions} sessions on this machine.`)
}

/** A logged time as this machine's calendar day, YYYY-MM-DD. */
export const localDay = at => new Date(at).toLocaleDateString('en-CA')

function report(root) {
  const { skills, since } = readUsage(root)
  const own = dirsIn(path.join(root, 'skills')).filter(name => name !== 'synced' && isFile(path.join(root, 'skills', name, 'SKILL.md')))
  const row = name => {
    const seen = skills.get(name) ?? { uses: 0, last: '' }
    return { name, uses: seen.uses, last: seen.last }
  }
  const byLeastUsed = (a, b) => a.uses - b.uses || a.last.localeCompare(b.last) || a.name.localeCompare(b.name)
  const width = Math.max(10, ...[...own, ...skills.keys()].map(one => one.length)) + 2
  const line = one => `  ${one.name.padEnd(width)}${String(one.uses).padStart(4)}   ${one.last ? localDay(one.last) : 'never'}`

  console.log(since ? `Skill uses since ${localDay(since)}, every machine:` : 'No skill uses logged yet.')
  console.log('\nYour skills, least used first\n')
  console.log(own.map(row).sort(byLeastUsed).map(line).join('\n'))
  const others = [...skills.keys()].filter(name => !own.includes(name)).map(row).sort((a, b) => b.uses - a.uses)
  if (others.length) console.log('\nOther skills used (plugins, projects)\n\n' + others.map(line).join('\n'))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = configRoot()
  const mode = process.argv[2]
  if (mode === 'hook') hook(root)
  else if (mode === 'backfill') backfill(root)
  else if (mode === 'report') report(root)
  else console.log('Usage: node skill-usage.mjs hook | report | backfill')
}
