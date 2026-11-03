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
  on('state.get', (_, e) => ({ value: { value: held[e.key], version: 1 } }))

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

test('an open group reads what each skill says it does', async ($, on) => {
  const held: Record<string, unknown> = {
    scan: { shape: 'scan-2', value: SCAN },
    shut: { shape: 'shut-1', value: [] },
  }
  on('state.get', (_, e, next) =>
    e.key in held ? { value: { value: held[e.key], version: 1 } } : next(e),
  )

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // The description rides on the row itself, not only in an opened skill.
  expect(await ui.find({ type: 'Text', text: /Test-driven development/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Atlassian work-data/ })).toBeDefined()

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
  expect(await ui.find({ type: 'Text', text: /adds one allowlist line/ })).toBeDefined()
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

  expect((await ui.find({ type: 'Text' }))?.text).toBe('Nothing read yet.')

  await ui.unmount()
})
