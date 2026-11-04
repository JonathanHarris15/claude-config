import { expect, test } from 'claude-code/testing'

import type { Scan } from '../types'

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

const SCAN: Scan = {
  at: 1,
  root: '/home/me/.claude',
  branch: 'main',
  trackedFiles: 400,
  dirtyFiles: 0,
  isTold: true,
  skills: [
    {
      id: 'own/tdd',
      name: 'tdd',
      origin: 'repo',
      owner: '',
      path: 'skills/tdd',
      isTracked: true,
      gist: 'Test-driven development, red to green to refactor',
    },
    {
      id: 'own/twg',
      name: 'twg',
      origin: 'local',
      owner: '',
      path: 'skills/twg',
      isTracked: false,
      gist: 'Root TWG CLI skill for Atlassian work-data tasks',
    },
    {
      id: 'synced/pdf',
      name: 'pdf',
      origin: 'synced',
      owner: 'claude.ai',
      path: 'skills/synced/bucket/pdf',
      isTracked: false,
      gist: 'Read and write PDF files',
    },
  ],
  config: [
    {
      id: 'cfg/CLAUDE.md',
      name: 'CLAUDE.md',
      kind: 'file',
      isTracked: true,
      trackedCount: 1,
      note: 'your global instructions, read every session',
    },
    {
      id: 'cfg/projects',
      name: 'projects',
      kind: 'dir',
      isTracked: false,
      trackedCount: 0,
      note: 'full session transcripts',
    },
  ],
  troubles: [],
}

test('the pane sorts skills by whether the config repo holds them', async ($, on) => {
  // Nothing sits beneath the plugin: these hooks stand for the store.
  const held: Record<string, unknown> = {
    scan: { shape: 'scan-2', value: SCAN },
    shut: { shape: 'shut-1', value: [] },
  }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ key: 'h-repo' })).toBeDefined()
    expect(await ui.find({ key: 'h-local' })).toBeDefined()
    expect(await ui.find({ key: 'h-synced' })).toBeDefined()
    expect(await ui.find({ key: 'b-own/tdd' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /400 files tracked/ })).toBeDefined()

    await ui.unmount()
  }
})

test('a skill row is its name, and what it does waits in the card', async ($, on) => {
  let picked = ''
  on('state.get', (_, e, next) => {
    const held: Record<string, unknown> = {
      scan: { shape: 'scan-2', value: SCAN },
      shut: { shape: 'shut-1', value: [] },
      pick: { shape: 'pick-1', value: picked },
    }
    return e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e)
  })

  // Shut, the list is names: a pane this narrow has no room for a second column.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^tdd$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Test-driven development/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Atlassian work-data/ })).toBeUndefined()
  await ui.unmount()

  // Opened, the card says it in full.
  picked = 'own/tdd'
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  await ui.unmount()
})

test('a shut group reads nothing under it', async ($, on) => {
  const held: Record<string, unknown> = {
    scan: { shape: 'scan-2', value: SCAN },
    shut: { shape: 'shut-1', value: ['repo'] },
  }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ key: 'h-repo' })).toBeDefined()
  expect(await ui.find({ key: 'b-own/tdd' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Test-driven development/ })).toBeUndefined()

  await ui.unmount()
})

test('the config view tells tracked from untracked', async ($, on) => {
  // The scan is seeded; every other key falls through to the engine, so the
  // press writes and redraws as it would in a session.
  const held: Record<string, unknown> = { scan: { shape: 'scan-2', value: SCAN } }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-config' })

  expect(await ui.find({ type: 'Text', text: /Tracked in the repo/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /travels to every machine/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /stays on this machine/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /full session transcripts/ })).toBeDefined()

  await ui.unmount()
})

test('an untracked skill is offered to the repo and a tracked one is not', async ($, on) => {
  // One hook, read afresh each draw, so the pick can change between mounts.
  let picked = 'own/twg'
  on('state.get', (_, e, next) => {
    const held: Record<string, unknown> = {
      scan: { shape: 'scan-2', value: SCAN },
      shut: { shape: 'shut-1', value: [] },
      pick: { shape: 'pick-1', value: picked },
    }
    return e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e)
  })

  // One already in skills/, so the allowlist alone keeps it out.
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'keep' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /one line to the allowlist/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /skills\/twg/ })).toBeDefined()
  await ui.unmount()

  // One the app owns, which is copied in instead.
  picked = 'synced/pdf'
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'keep' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /leaves the original where it is/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Comes with claude\.ai/ })).toBeDefined()
  await ui.unmount()

  // One the repo already holds has nothing to offer.
  picked = 'own/tdd'
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'keep' })).toBeUndefined()
  expect(await ui.find({ key: 'copy' })).toBeDefined()
  await ui.unmount()
})

test('a scan an earlier version stored is declined', async ($, on) => {
  // What the code before this edit wrote stays through the reload.
  on('state.get', () => ({ value: { value: { shape: 'scan-0', value: SCAN }, version: 1 } }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Nothing read yet/ })).toBeDefined()
  expect(await ui.find({ key: 'scan' })).toBeDefined()

  await ui.unmount()
})

test('a group part way open draws only the rows that have arrived', async ($, on) => {
  // What one frame of an unrolling looks like: the repo group is at nought
  // rows, every other group untouched.
  const held: Record<string, unknown> = {
    scan: { shape: 'scan-2', value: SCAN },
    shut: { shape: 'shut-1', value: [] },
    anim: { shape: 'anim-1', value: { origin: 'repo', shown: 0, to: 1 } },
  }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ key: 'h-repo' })).toBeDefined()
  expect(await ui.find({ key: 'b-own/tdd' })).toBeUndefined()
  // The groups that are not moving still draw in full.
  expect(await ui.find({ key: 'b-own/twg' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▿/ })).toBeDefined()

  await ui.unmount()
})

test('the header says what share of the skills the repo holds', async ($, on) => {
  const held: Record<string, unknown> = {
    scan: { shape: 'scan-2', value: SCAN },
    shut: { shape: 'shut-1', value: [] },
  }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  // Where vectors draw, a band per group: the share solid, the rest faint.
  const seen = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const bar = await seen.find({ type: 'Svg' })
  expect(bar).toBeDefined()
  expect(bar?.props?.source).toMatch(/<rect/)
  // The bands grow themselves in, which is the frame's own ease.
  expect(bar?.props?.source).toMatch(/<animate attributeName="width"/)
  expect(bar?.props?.isInteractive).toBe(true)
  expect(bar?.props?.alt).toMatch(/1 of 3 skills/)
  expect(await seen.find({ type: 'Text', text: /1 of 3 skills travel with you/ })).toBeDefined()
  await seen.unmount()

  // The terminal draws no vectors, so the line carries the fact alone.
  const said = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await said.find({ type: 'Svg' })).toBeUndefined()
  expect(await said.find({ type: 'Text', text: /1 of 3 skills travel with you/ })).toBeDefined()
  await said.unmount()
})
