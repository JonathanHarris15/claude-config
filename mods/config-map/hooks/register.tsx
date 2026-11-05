import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Opened } from '../types'

/** The side pane earlier versions opened. Only ever closed now. */
const OLD_PANE = 'config-map'

// Change a tag when a value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const opened = atom({ plugin: 'config-map', key: 'opened' } as const, null as Opened | null, {
  shape: 'opened-1',
})
const isBusy = atom({ plugin: 'config-map', key: 'isBusy' } as const, false, { shape: 'busy-2' })

/** Places Node lives when an app, and not a shell, started this session. */
const NODES = ['node', '/usr/local/bin/node', '/opt/homebrew/bin/node', 'C:/Program Files/nodejs/node.exe']

/** The config folder this session reads, however the machine names home. */
async function rootOf($: EngineInterface): Promise<string> {
  const named = await $.env.get('CLAUDE_CONFIG_DIR')
  if (named) return named.replace(/\\/g, '/').replace(/\/+$/, '')
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
  return home.replace(/\\/g, '/').replace(/\/+$/, '') + '/.claude'
}

/** Run the dashboard's launcher, and read the one line of JSON it answers. */
async function launch($: EngineInterface, extra: string[]): Promise<{ url?: string; error?: string }> {
  const start = (await rootOf($)) + '/dashboard/start.mjs'
  for (const node of NODES) {
    let ran
    try {
      ran = await $.process.run([node, start, ...extra], { timeoutMs: 15000 })
    } catch {
      continue // This Node is not here. Try the next.
    }
    const line = ran.stdout.trim().split(/\r?\n/).pop() ?? ''
    try {
      return JSON.parse(line)
    } catch {
      return { error: ran.stderr.trim().split(/\r?\n/)[0] || 'The dashboard did not start.' }
    }
  }
  return { error: 'Could not find Node on this machine. The dashboard needs it.' }
}

/** Start the dashboard if it is not running, then show it. */
async function openDashboard($: EngineInterface, inPane: boolean): Promise<Opened> {
  await update($, isBusy, () => true)
  let result: Opened = { url: '', where: '', trouble: '' }
  try {
    const started = await launch($, [])
    if (!started.url) {
      result = { ...result, trouble: started.error ?? 'The dashboard did not start.' }
    } else {
      result = { ...result, url: started.url }
      let isShown = false
      if (inPane) {
        // The app's own browser pane, where there is one. Anywhere else this
        // refuses, and the machine's browser takes over.
        try {
          const shown = await $.mcp.call('Claude_Browser', 'preview_start', { url: started.url })
          isShown = !shown.isError
        } catch {
          isShown = false
        }
      }
      if (isShown) result = { ...result, where: 'pane' }
      else {
        const asked = await launch($, ['--open'])
        result = asked.url
          ? { ...result, where: 'browser' }
          : { ...result, trouble: asked.error ?? 'Could not open a browser.' }
      }
    }
  } catch (err) {
    result = { ...result, trouble: String(err) }
  }
  await update($, opened, () => result)
  await update($, isBusy, () => false)
  return result
}

const SAID = { pane: 'Open in the browser pane.', browser: 'Open in your browser.', '': '' } as const

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'config-map',
      description: 'Open the config dashboard',
    })
    // A session running the old version still has the side pane open.
    void $.ui.close({ id: OLD_PANE }).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'config-map' }, async $ => {
    const result = await openDashboard($, true)

    return { text: result.trouble || 'Config dashboard: ' + result.url }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const last = await read($, opened)
    const busy = await read($, isBusy)

    return (
      <Box flexDirection="column">
        <Box gap={1} alignItems="center">
          <Button key="open" onPress={() => void openDashboard($, true)}>
            {busy ? 'Opening…' : 'Open config dashboard'}
          </Button>
          {last?.where === 'pane' ? (
            <Button key="outside" onPress={() => void openDashboard($, false)}>
              Open in my browser instead
            </Button>
          ) : null}
          {last?.where ? <Text dimColor>{SAID[last.where]}</Text> : null}
          {last?.url ? <Link href={last.url} /> : null}
        </Box>
        {last?.trouble ? <Text color="error">{last.trouble}</Text> : null}
      </Box>
    )
  })
}
