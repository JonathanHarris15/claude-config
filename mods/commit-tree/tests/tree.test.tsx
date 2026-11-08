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
  // One staged, one changed and not staged, one git does not track yet.
  '1 M. N... 100644 100644 100644 aaa bbb staged.md',
  '1 .M N... 100644 100644 100644 aaa bbb notes.md',
  '? new.md',
].join('\n')

/** What `log --all --not --remotes` names: the commits no remote has yet. */
const LOCAL_ONLY = 'c3c3c3c\n'

const REFS = [
  'refs/heads/main|~|main|~|a1b1c1d|~|origin/main|~||~|*|~|1762400000|~|Newest thing',
  'refs/heads/spike|~|spike|~|c3c3c3c|~|origin/spike|~|ahead 1|~| |~|1762200000|~|Spike work',
  'refs/remotes/origin/main|~|origin/main|~|a1b1c1d|~||~||~| |~|1762400000|~|Newest thing',
  'refs/remotes/origin/spike|~|origin/spike|~|c3c3c3c|~||~||~| |~|1762200000|~|Spike work',
  // A remote branch nobody here tracks.
  'refs/remotes/origin/old|~|origin/old|~|e5e5e5e|~||~||~| |~|1762000000|~|First commit',
  // Git's pointer at the remote's default branch, which is not a branch.
  'refs/remotes/origin/HEAD|~|origin/HEAD|~|a1b1c1d|~||~||~| |~|1762400000|~|Newest thing',
].join('\n')

/** Git's colour codes around the rails, as `--color=always` writes them. */
const RED = (s: string) => `\u001b[31m${s}\u001b[m`
const GREEN = (s: string) => `\u001b[32m${s}\u001b[m`

const LOG = [
  `*${US}a1b1c1d${US}b2b2b2b${US}HEAD -> main, origin/main${US}1762400000${US}Jo${US}Newest thing`,
  `*   ${US}b2b2b2b${US}d4d4d4d c3c3c3c${US}${US}1762300000${US}Jo${US}Merge branch 'spike'`,
  `${RED('|')}${GREEN('\\')}`,
  `| *${US}c3c3c3c${US}e5e5e5e${US}spike, origin/spike${US}1762200000${US}Jo${US}Spike work`,
  `* ${GREEN('|')}${US}d4d4d4d${US}e5e5e5e${US}tag: v1${US}1762100000${US}Jo${US}Older thing`,
  `${RED('|')}${GREEN('/')}`,
  `*${US}e5e5e5e${US}${US}origin/old${US}1762000000${US}Jo${US}First commit`,
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
    const stdout =
      what === 'status'
        ? STATUS
        : what === 'for-each-ref'
          ? REFS
          : e.argv.includes('--not')
            ? LOCAL_ONLY
            : LOG

    return { value: { exitCode: 0, stdout, stderr: '' } }
  })

  return runs
}

/** Every element of a drawing, the outermost first. */
function every(node: any): any[] {
  if (!node || typeof node !== 'object') return []
  const kids = ([] as any[]).concat(node.children ?? [])

  return [node, ...kids.flatMap(every)]
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

  expect(await ui.find({ type: 'Text', text: /main · 1 to push · 1 staged, 1 changed, 1 new/ })).toBeDefined()
  await ui.unmount()
})

test('the pane draws the head and one list of branches', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 to push with origin\/main/ })).toBeDefined()
    // A branch here says where it stands; its remote copy is not listed again.
    expect(await ui.find({ type: 'Text', text: /● main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 to push/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /origin\/spike/ })).toBeUndefined()
    // A remote branch nobody here tracks is listed, and says so.
    expect(await ui.find({ type: 'Text', text: /only on origin/ })).toBeDefined()
    await ui.unmount()
  }
})

test('the desktop draws the history as a picture', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = every(await ui.drawn()).find(one => one.type === 'Svg')

  expect(svg).toBeDefined()
  const source: string = svg.props.source
  expect(source.startsWith('<svg')).toBe(true)
  for (const subject of ['Newest thing', 'Spike work', 'Older thing', 'First commit']) {
    expect(source.includes(subject)).toBe(true)
  }
  // The pushed branch is one label, and the tag reads as a tag.
  expect(source.includes('main · origin')).toBe(true)
  expect(source.includes('◆ v1')).toBe(true)
  expect(source.includes('&#39;') || source.includes("Merge branch 'spike'")).toBe(true)
  expect(svg.props.alt).toMatch(/5 commits/)
  // Its size is given outright, rows tall and the pane wide: a frame told
  // nothing is 150px tall and shrinks the whole history into that.
  // Five commits and the uncommitted row.
  expect(svg.props.height).toBe(6 * 28 + 8)
  expect(svg.props.width).toBe(Math.floor(80 * 7.6))
  await ui.unmount()
})

test('a narrow pane gets a picture no wider than itself, without the extras', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 30 } })
  const svg = every(await ui.drawn()).find(one => one.type === 'Svg')
  const source: string = svg.props.source

  expect(svg.props.width <= 30 * 8).toBe(true)
  // The hash column goes; hovering still shows it.
  expect(source.includes('class="d m e"')).toBe(false)
  expect(source.includes('a1b1c1d')).toBe(true)
  // The pushed label drops its remote to leave room for the subject.
  expect(source.includes('main · origin')).toBe(false)
  expect(source.includes('Newest')).toBe(true)
  await ui.unmount()
})

test('uncommitted changes and unpushed commits are marked', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  // The picture: a dashed ring for the uncommitted work, linked to the head
  // by a dashed line, and a hollow dot for the commit no remote has.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const source: string = every(await ui.drawn()).find(one => one.type === 'Svg').props.source
  expect(source.includes('Uncommitted: 1 staged, 1 changed, 1 new')).toBe(true)
  expect(source.includes('stroke-dasharray="2.5 2"')).toBe(true)
  expect(source.includes('stroke-dasharray="3 3"')).toBe(true)
  const spike = source.slice(source.indexOf('<title>Spike work'), source.indexOf('</g>', source.indexOf('<title>Spike work')))
  expect(spike.includes('class="o"')).toBe(true)
  expect(spike.includes('Only on this computer')).toBe(true)
  const newest = source.slice(source.indexOf('<title>Newest thing'), source.indexOf('</g>', source.indexOf('<title>Newest thing')))
  expect(newest.includes('class="o"')).toBe(false)
  // The uncommitted row counts as no commit.
  expect(every(await ui.drawn()).find(one => one.type === 'Svg').props.alt).toMatch(/5 commits/)
  // A key says what the marks mean.
  expect(await ui.find({ type: 'Text', text: /○ only on this computer/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◌ not committed/ })).toBeDefined()
  await ui.unmount()

  // The terminal: a line for the uncommitted work, a hollow dot for the commit.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /◌ Uncommitted: 1 staged, 1 changed, 1 new/ })).toBeDefined()
  const hollow = every(await term.drawn()).filter(one => one.type === 'Text' && one.children?.[0] === '○')
  expect(hollow.length).toBe(1)
  await term.unmount()
})

test('the terminal draws the history as text in git\'s lane colours', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Svg' as any })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Newest thing/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /First commit/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /main · origin/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◆ v1/ })).toBeDefined()
  // Rails come out as lines, coloured as git coloured them.
  const glyphs = every(await ui.drawn()).filter(one => one.type === 'Text' && one.children?.[0] === '╲')
  expect(glyphs.length).toBe(1)
  expect(glyphs[0].props.color).toBe('success')
  await ui.unmount()
})

test('the pane draws on every surface it is raised on', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^History$/ })).toBeDefined()
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

test('a crushed column cuts each row off instead of wrapping it', async ($, on) => {
  repo(on)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await band.press({ key: 'tree' })
  await band.unmount()

  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, bodyColumns: 24 },
  })
  // Three branches, the uncommitted line, five commits and two rails lines.
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
