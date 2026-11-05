import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'config-map',
  component: 'Pane',
  requestId: 'config-map',
  props: {
    title: 'Claude config',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const URL_HOME = 'http://127.0.0.1:4915/'

/** Stands for the machine: what the launcher answers, and whether the pane exists. */
function machine(on: any, { hasPane = true, answer = { url: URL_HOME, started: true } as object } = {}) {
  const calls = { pane: [] as unknown[], runs: [] as string[][] }
  on('env.get', (_: unknown, e: { name?: string; key?: string }) => ({
    value: (e.name ?? e.key) === 'HOME' ? '/home/me' : undefined,
  }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    calls.runs.push(e.argv)
    return { value: { exitCode: 0, stdout: JSON.stringify(answer) + '\n', stderr: '' } }
  })
  on('mcp.call', (_: unknown, e: unknown) => {
    calls.pane.push(e)
    if (!hasPane) throw new Error('No such server')
    return { value: { content: [], isError: false } }
  })
  return calls
}

test('the pane is one button, on every surface', async ($, on) => {
  machine(on)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'open' })).toBeDefined()
    expect(await ui.find({ key: 'outside' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the button starts the dashboard and shows it in the browser pane', async ($, on) => {
  const calls = machine(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open' })

  expect(calls.runs[0]?.[1]).toBe('/home/me/.claude/dashboard/start.mjs')
  expect(calls.pane.length).toBe(1)
  expect(calls.runs.some(argv => argv.includes('--open'))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /browser pane/ })).toBeDefined()
  expect(await ui.find({ key: 'outside' })).toBeDefined()
  await ui.unmount()
})

test('with no browser pane it falls back to the machine browser', async ($, on) => {
  const calls = machine(on, { hasPane: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open' })

  expect(calls.runs.some(argv => argv.includes('--open'))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /your browser/ })).toBeDefined()
  await ui.unmount()
})

test('a launcher that fails says why, and opens nothing', async ($, on) => {
  const calls = machine(on, { answer: { error: 'Something else is using port 4915.' } })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'open' })

  expect(await ui.find({ type: 'Text', text: /port 4915/ })).toBeDefined()
  expect(calls.pane.length).toBe(0)
  await ui.unmount()
})

test('what the old pane stored is declined', async ($, on) => {
  machine(on)
  on('state.get', () => ({ value: { value: { shape: 'opened-0', value: { url: 'old' } }, version: 1 } }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'open' })).toBeDefined()
  expect(await ui.find({ key: 'outside' })).toBeUndefined()
  await ui.unmount()
})
