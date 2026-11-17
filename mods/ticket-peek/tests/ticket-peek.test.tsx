import { expect, mock, test } from 'claude-code/testing'

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

test('a ticket key becomes a link with a hover card, on every surface', async ($, on) => {
  const clock = mock.clock(on)
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('mcp.call', (_, e) =>
    e.tool === 'notion-query-data-sources'
      ? { value: { content: [{ type: 'text', text: JSON.stringify({ results: [ROW] }) }], isError: false } }
      : { value: { content: [{ type: 'text', text: JSON.stringify(PAGE) }], isError: false } },
  )
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...reply('Next up is **WARD-48**, then the rest.'), surface })
    expect((await ui.find({ type: 'Text', text: /WARD-48/ }))?.text).toContain('WARD-48')
    await clock.advance(1000)
    expect((await ui.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork every backend')
    expect(await ui.find({ type: 'Text', text: /Done · Chore/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a table keeps its markdown and gets a chip row underneath', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply('| Ticket | What |\n| --- | --- |\n| WARD-48 | repo |'), surface: 'desktop' })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /Tickets:/ }))?.text).toContain('WARD-48')
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

test('a table with no ticket keys gets no empty chip row', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply('WARD-13 is finished:\n\n| Check | State |\n| --- | --- |\n| Code | merged |'), surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Tickets:/ })).toBeUndefined()
  await ui.unmount()
})

test('the ID filter uses the schema name, and a refusal reads as a sentence', async ($, on) => {
  const clock = mock.clock(on)
  const tried: string[] = []
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    if (e.tool !== 'notion-query-data-sources') return { value: { content: [{ type: 'text', text: JSON.stringify(PAGE) }], isError: false } }
    const property = (e.args as any).data.filter.filters[0].property as string
    tried.push(property)
    const n = (e.args as any).data.filter.filters[0].value.value as number
    if (n === 99) {
      const msg = `{"name":"APIResponseError","code":"validation_error","status":400,"body":"{}","message":"Failed to execute query: Cannot apply the filter on ${property}. Use property names and types from the data source schema."}`
      return { value: { content: [{ type: 'text', text: msg }], isError: true } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ results: [ROW] }) }], isError: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply('See WARD-48 and WARD-99.'), surface: 'desktop' })
  await clock.advance(1000)
  expect(tried[0]).toBe('userDefined:ID')
  expect((await ui.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork')
  const err = (await ui.find({ type: 'Text', text: /refused the lookup/ }))?.text ?? ''
  expect(err).toContain('Cannot apply the filter on')
  expect(err).not.toContain('APIResponseError')
  await ui.unmount()
})

test('a rate-limited lookup keeps loading and goes again, not an error', async ($, on) => {
  const clock = mock.clock(on)
  let limited = true
  on('fs.read', (_, e) => (String(e.path).endsWith('CLAUDE.md') ? { value: CLAUDE_MD } : { deny: 'missing' }))
  on('fs.stat', () => ({ deny: 'missing' }))
  on('fs.list', () => ({ value: [] }))
  on('env.get', () => ({ value: undefined }))
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('mcp.call', (_, e) => {
    if (e.tool !== 'notion-query-data-sources') return { value: { content: [{ type: 'text', text: JSON.stringify(PAGE) }], isError: false } }
    if (limited) {
      const msg = '{"name":"APIResponseError","code":"rate_limited","status":429,"message":"Rate limited. Do not retry this request automatically."}'
      return { value: { content: [{ type: 'text', text: msg }], isError: true } }
    }
    return { value: { content: [{ type: 'text', text: JSON.stringify({ results: [ROW] }) }], isError: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...reply('Next is WARD-48.'), surface: 'desktop' })
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: /Loading from Notion/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refused/ })).toBeUndefined()
  limited = false
  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: /groundwork/ })).toBeUndefined()
  await clock.advance(4000)
  expect((await ui.find({ type: 'Text', text: /groundwork/ }))?.text).toContain('groundwork')
  await ui.unmount()
})
