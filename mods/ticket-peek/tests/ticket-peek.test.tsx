import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const CLAUDE_MD = `
<!-- tracker-config -->
## Tracker
- **Short name:** WARD (ticket keys look like WARD-12)
- **Tickets:** notion
- **Notion home:** https://app.notion.com/p/home
- **Tickets data source:** collection://09e3e9b2-e459-4cb6-bf50-9148f64d97ec
<!-- /tracker-config -->
`

const ROW = {
  Name: 'Backend repo, emulators and terminal client',
  Status: 'Done',
  Type: 'Chore',
  Priority: 'High',
  Epic: '[]',
  url: 'https://app.notion.com/p/ward48',
}

const PAGE = {
  title: ROW.Name,
  text: '<content>\nThe groundwork every backend ticket builds on.\n\n## Sub-tasks\n</content>',
}

const reply = (text: string) =>
  ({
    plugin: 'ticket-peek',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
  }) as const

const BAND = {
  plugin: 'ticket-peek',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

const ok = (body: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(body) }], isError: false } })
const refused = (text: string) => ({ value: { content: [{ type: 'text', text }], isError: true } })


type McpEvent = { tool: string; args: any }

/** A session that knows WARD from a CLAUDE.md, with Notion answered by `notion`. */
async function start($: Parameters<TestBody>[0], on: On, notion?: (e: McpEvent) => unknown) {
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  if (notion) on('mcp.call', (_, e) => notion(e as McpEvent) as any)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

/** Notion with no saved view, so tickets come from the per-key query. */
const byQuery = (e: McpEvent) => (e.tool === 'notion-query-data-sources' ? ok({ results: [ROW] }) : ok(PAGE))

/** Every Box in a drawn tree, with its props. */
function boxes(tree: unknown) {
  const out: Record<string, any>[] = []
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    // The drawn tree keeps a hover style beside the props, not in them.
    const node = n as { type?: string; props?: Record<string, any>; hover?: Record<string, any>; children?: unknown }
    if (node.type === 'Box') out.push({ ...node.props, hover: node.hover })
    walk(node.children ?? node.props?.children)
  }
  walk(tree)
  return out
}

test('a key in a reply links to its ticket, and its card fills in the band', async ($, on) => {
  const clock = mock.clock(on)
  await start($, on, byQuery)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...reply('Next up is **WARD-48**, then the rest.'), surface })
    expect((await ui.find({ type: 'Text', text: /WARD-48/ }))?.text).toContain('WARD-48')
    await clock.advance(1000)
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ type: 'Text', text: /WARD-48 ·/ }))?.text).toContain('Backend repo')
    expect((await band.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork every backend')
    expect(await band.find({ type: 'Text', text: /Done · Chore/ })).toBeDefined()
    await band.unmount()
    await ui.unmount()
  }
})

test('a card stays hidden until a key in its hover group is hovered', async ($, on) => {
  const clock = mock.clock(on)
  await start($, on, byQuery)

  const ui = await $.ui.mount({ ...reply('See WARD-48.'), surface: 'desktop' })
  await clock.advance(1000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const cards = boxes(await band.drawn()).filter(b => b.hover?.display === 'flex')
  expect(cards).toHaveLength(1)
  expect(cards[0]?.display).toBe('none')
  expect(cards[0]?.hover?.scope).toBe('tp:WARD-48')
  // Nothing floats in the reply any more: no card can cover or be clipped there.
  expect(boxes(await ui.drawn()).filter(b => b.position === 'absolute')).toHaveLength(0)
  await band.unmount()
  await ui.unmount()
})

test('with no ticket seen, the band row is left to the engine', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await start($, on, byQuery)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text' }))?.text).toBe('engine')
  await band.unmount()
})

test("the band row goes under the other mods' rows", async ($, on) => {
  let handed: string[] = []
  on('ui.render', { component: 'AbovePromptList' }, ($, e) => {
    handed = e.props.rows.map(r => r.plugin)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const rows = ['ticket-peek', 'commit-tree', 'config-map'].map(plugin => ({ plugin, tree: { type: 'Box', props: {} } }))
  const list = await $.ui.mount({
    plugin: 'ticket-peek',
    component: 'AbovePromptList',
    surface: 'desktop',
    props: { ...BAND.props, rows },
  } as any)
  expect(handed).toEqual(['commit-tree', 'config-map', 'ticket-peek'])
  await list.unmount()
})

test('a table keeps its markdown and gets a chip row underneath', async ($, on) => {
  mock.clock(on)
  await start($, on)
  const ui = await $.ui.mount({ ...reply('| Ticket | What |\n| --- | --- |\n| WARD-48 | repo |'), surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Tickets:/ }))?.text).toContain('WARD-48')
  await ui.unmount()
})

test('a table with no ticket keys gets no empty chip row', async ($, on) => {
  mock.clock(on)
  await start($, on)
  const ui = await $.ui.mount({ ...reply('WARD-13 is finished:\n\n| Check | State |\n| --- | --- |\n| Code | merged |'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Tickets:/ })).toBeUndefined()
  await ui.unmount()
})

test('a reply with no known key draws as the engine draws it', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...reply('Nothing about ABC-12 here.'), surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('Notion tickets come from one read of a saved view, not a capped query per key', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  await start($, on, e => {
    if (e.tool === 'notion-query-data-sources') {
      calls.push(e.args.data.mode)
      if (e.args.data.mode !== 'view') return refused('Query Data Source usage limit has been reached')
      return ok({
        results: [
          { ...ROW, 'userDefined:ID': '48' },
          { ...ROW, 'userDefined:ID': '42', Name: '\\[prototype\\] Tagging model', url: 'https://app.notion.com/p/ward42' },
        ],
        has_more: false,
      })
    }
    calls.push(`fetch ${e.args.id}`)
    if (String(e.args.id).startsWith('collection://')) return ok({ url: 'https://app.notion.com/p/db?pvs=204' })
    if (e.args.id === 'https://app.notion.com/p/db') return ok({ text: '<views><view url="{{view://9dbb919b-14ba}}">' })
    return ok(PAGE)
  })

  const ui = await $.ui.mount({ ...reply('See WARD-48 and WARD-42.'), surface: 'desktop' })
  await clock.advance(1000)
  await clock.advance(1000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await band.find({ type: 'Text', text: /WARD-42 ·/ }))?.text).toContain('[prototype] Tagging model')
  expect(await band.find({ type: 'Text', text: /groundwork/ })).toBeDefined()
  expect(calls.filter(c => c === 'view')).toHaveLength(1)
  expect(calls).not.toContain('rows')
  await band.unmount()
  await ui.unmount()
})

test('the ID filter uses the schema name, and a refusal reads as a sentence', async ($, on) => {
  const clock = mock.clock(on)
  const tried: string[] = []
  await start($, on, e => {
    if (e.tool !== 'notion-query-data-sources') return ok(PAGE)
    const filter = e.args.data.filter.filters[0]
    tried.push(filter.property)
    if (filter.value.value === 99) {
      return refused(`{"name":"APIResponseError","code":"validation_error","status":400,"body":"{}","message":"Failed to execute query: Cannot apply the filter on ${filter.property}. Use property names and types from the data source schema."}`)
    }
    return ok({ results: [ROW] })
  })

  const ui = await $.ui.mount({ ...reply('See WARD-48 and WARD-99.'), surface: 'desktop' })
  await clock.advance(1000)
  await clock.advance(1000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(tried[0]).toBe('userDefined:ID')
  expect((await band.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork')
  const err = (await band.find({ type: 'Text', text: /refused the lookup/ }))?.text ?? ''
  expect(err).toContain('Cannot apply the filter on')
  expect(err).not.toContain('APIResponseError')
  await band.unmount()
  await ui.unmount()
})

test('a rate-limited lookup keeps loading and goes again, not an error', async ($, on) => {
  const clock = mock.clock(on)
  let limited = true
  await start($, on, e => {
    if (e.tool !== 'notion-query-data-sources') return ok(PAGE)
    if (limited) return refused('{"name":"APIResponseError","code":"rate_limited","status":429,"message":"Rate limited."}')
    return ok({ results: [ROW] })
  })

  const ui = await $.ui.mount({ ...reply('Next is WARD-48.'), surface: 'desktop' })
  await clock.advance(1000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /Loading from Notion/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /refused/ })).toBeUndefined()
  limited = false
  await clock.advance(2000)
  expect(await band.find({ type: 'Text', text: /groundwork/ })).toBeUndefined()
  await clock.advance(4000)
  expect((await band.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork')
  await band.unmount()
  await ui.unmount()
})
