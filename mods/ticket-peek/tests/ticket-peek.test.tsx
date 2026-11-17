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
