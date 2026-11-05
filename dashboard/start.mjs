#!/usr/bin/env node
// Make sure the dashboard is running, then say where.
//   node ~/.claude/dashboard/start.mjs           start it, print its address
//   node ~/.claude/dashboard/start.mjs --open    and open your browser
//   node ~/.claude/dashboard/start.mjs --stop    stop it

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildId } from './server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.CONFIG_DASHBOARD_PORT || 4915)
const URL_HOME = 'http://127.0.0.1:' + PORT + '/'
const args = process.argv.slice(2)

const say = value => console.log(JSON.stringify(value))
const nap = ms => new Promise(done => setTimeout(done, ms))

/** 'ours' with its build, 'other' if something else holds the port, or 'none'. */
async function look() {
  try {
    const res = await fetch(URL_HOME + 'api/ping', { signal: AbortSignal.timeout(1500) })
    const body = await res.json()
    if (body.app === 'claude-config-dashboard') return { state: 'ours', build: body.build }
    return { state: 'other' }
  } catch (err) {
    return err.name === 'SyntaxError' ? { state: 'other' } : { state: 'none' }
  }
}

const quit = () =>
  fetch(URL_HOME + 'api/quit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})

async function waitFor(wanted) {
  for (let i = 0; i < 50; i++) {
    if ((await look()).state === wanted) return true
    await nap(100)
  }
  return false
}

function openBrowser(url) {
  const [cmd, ...rest] =
    process.platform === 'darwin' ? ['open', url]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url]
    : ['xdg-open', url]
  spawn(cmd, rest, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

let found = await look()

if (args.includes('--stop')) {
  if (found.state === 'ours') await quit()
  say({ stopped: found.state === 'ours' })
  process.exit(0)
}

if (found.state === 'other') {
  say({ error: 'Something else is using port ' + PORT + '. Set CONFIG_DASHBOARD_PORT to pick another.' })
  process.exit(1)
}

// A pull may have brought new server code while an old copy still runs.
if (found.state === 'ours' && found.build !== buildId()) {
  await quit()
  await waitFor('none')
  found = { state: 'none' }
}

let started = false
if (found.state === 'none') {
  spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref()
  started = true
  if (!(await waitFor('ours'))) {
    say({ error: 'The dashboard did not start.' })
    process.exit(1)
  }
}

if (args.includes('--open')) openBrowser(URL_HOME)
say({ url: URL_HOME, started })
