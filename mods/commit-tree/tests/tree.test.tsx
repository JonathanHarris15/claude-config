import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'commit-tree',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const PANE = {
  plugin: 'commit-tree',
  component: 'Pane',
  requestId: 'commit-tree',
  props: {
    title: 'Commit tree',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const US = '\u001f'

const STATUS = [
  '# branch.oid a1b1c1d000000000000000000000000000000000',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +1 -0',
  '1 .M N... 100644 100644 100644 aaa bbb notes.md',
].join('\n')

const REFS = [
  'refs/heads/main|~|main|~|a1b1c1d|~|origin/main|~||~|*',
  'refs/heads/spike|~|spike|~|c3c3c3c|~|origin/spike|~|ahead 1|~| ',
  'refs/remotes/origin/main|~|origin/main|~|a1b1c1d|~||~||~| ',
  'refs/remotes/origin/spike|~|origin/spike|~|c3c3c3c|~||~||~| ',
  // Git's pointer at the remote's default branch, which is not a branch.
  'refs/remotes/origin/HEAD|~|origin/HEAD|~|a1b1c1d|~||~||~| ',
].join('\n')

const LOG = [
  `*${US}a1b1c1d${US}HEAD -> main, origin/main${US}2026-11-06${US}Jo${US}Newest thing`,
  `*${US}b2b2b2b${US}${US}2026-11-05${US}Jo${US}Merge branch 'spike'`,
  '|\\',
  `| *${US}c3c3c3c${US}spike, origin/spike${US}2026-11-04${US}Jo${US}Spike work`,
  `* |${US}d4d4d4d${US}tag: v1${US}2026-11-03${US}Jo${US}Older thing`,
  '|/',
  `*${US}e5e5e5e${US}${US}2026-11-01${US}Jo${US}First commit`,
].join('\n')

/**
 * Stands for the machine: a git that answers, a pane that exists, and the
 * engine beneath the mods, which is what the band wraps.
 */
function repo(on: any, { fails = false, beneath = null as null | ((...a: any[]) => any) } = {}) {
  const runs: string[][] = []
  on('ui.render', ($: any, e: any) => {
    if (beneath) return beneath($, e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
  on('command.register', () => ({ value: { command: 'commit-tree' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    runs.push(e.argv)
    const what = e.argv[1] ?? ''
    if (fails) {
      return { value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository\n' } }
    }
    const stdout = what === 'status' ? STATUS : what === 'for-each-ref' ? REFS : LOG

    return { value: { exitCode: 0, stdout, stderr: '' } }
  })

  return runs
}

test('the band is one button, on every surface that has a band', async ($, on) => {
  repo(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'tree' })).toBeDefined()
    await ui.unmount()
  }
})

test('the button reads the repo and says where the head stands', async ($, on) => {
  repo(on)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'tree' })

  expect(await ui.find({ type: 'Text', text: /main ↑1 ↓0 · 1 changed/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws the head, both sets of branches and the tree', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /^On main$/ })).toBeDefined()
  // origin/HEAD is dropped, so two here and two on the remote.
  expect(await ui.find({ type: 'Text', text: /Branches here \(2\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Branches on remotes \(2\)/ })).toBeDefined()
  // The checked-out branch is marked, and a branch that has drifted says so.
  expect(await ui.find({ type: 'Text', text: /● main/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ahead 1/ })).toBeDefined()
  // Newest at the top, oldest at the bottom, and the rails in between.
  expect(await ui.find({ type: 'Text', text: /Newest thing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /First commit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\|\\/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /v1/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws on every surface it is raised on', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Newest thing/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a folder with no repository says so instead of drawing a tree', async ($, on) => {
  repo(on, { fails: true })
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /not a git repository/ })).toBeDefined()
  expect(await ui.find({ key: 'again' })).toBeDefined()
  await ui.unmount()
})

test('what an older version stored is declined', async ($, on) => {
  repo(on)
  on('state.get', () => ({ value: { value: { shape: 'tree-0', value: { head: 'old' } }, version: 1 } }))
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ key: 'tree' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /old/ })).toBeUndefined()
  await ui.unmount()
})

test('the band keeps the row another mod drew beneath it', async ($, on) => {
  repo(on, {
    beneath: ($: any, e: any) => {
      const { Button } = $.ui.resolve(e)

      return (
        <Button key="other" onPress={() => {}}>
          Open config dashboard
        </Button>
      )
    },
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ key: 'tree' })).toBeDefined()
  expect(await ui.find({ key: 'other' })).toBeDefined()
  await ui.unmount()
})

test('the band steps aside for a survey', async ($, on) => {
  repo(on, {
    beneath: ($: any, e: any) => {
      const { Text } = $.ui.resolve(e)

      return <Text key="survey">Survey</Text>
    },
  })
  const ui = await $.ui.mount({
    ...BAND,
    surface: 'desktop',
    props: { ...BAND.props, hasSurvey: true },
  })

  expect(await ui.find({ type: 'Text', text: /Survey/ })).toBeDefined()
  expect(await ui.find({ key: 'tree' })).toBeUndefined()
  await ui.unmount()
})

/** Every element of a drawing, the outermost first. */
function every(node: any): any[] {
  if (!node || typeof node !== 'object') return []
  const kids = ([] as any[]).concat(node.children ?? [])

  return [node, ...kids.flatMap(every)]
}

test('a crushed column cuts each row off instead of wrapping it', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({
    ...PANE,
    surface: 'desktop',
    props: { ...PANE.props, bodyColumns: 24 },
  })
  // Four branches, five commits and the two rails lines between them.
  const rows = every(await ui.drawn()).filter(
    one => one.type === 'Box' && one.props?.flexWrap === 'nowrap',
  )

  expect(rows.length).toBe(11)
  for (const row of rows) {
    expect(row.props.overflow).toBe('hidden')
    // Nothing in a row wraps, so a row is always one line tall.
    for (const one of every(row)) {
      if (one.type === 'Text') expect(one.props.wrap).toBe('truncate-end')
    }
    // The rails and the hash hold their width; the subject gives way first.
    // A rails-only row has nothing beside it to hold.
    if (([] as any[]).concat(row.children ?? []).length > 1) {
      const held = every(row).filter(one => one.type === 'Box' && one.props?.flexShrink === 0)
      expect(held.length >= 2).toBe(true)
    }
  }
  await ui.unmount()
})
