import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Ticket, Tracker } from '../types'

// Ticket keys in Claude's replies become links; hovering one shows its ticket
// card in this mod's row of the band above the prompt.
//
// Which prefixes are tickets, and where they live, comes from each project's
// CLAUDE.md config block (`tracker-config` or `jira-config`), the same blocks
// the ticket skills read. Projects seen once are remembered in $.store, so a
// session started in ~/.claude still knows WARD and METH.
//
// Drawing never fetches: a render notes the keys it lacks, and a timer
// started at session.start fetches them through the session's own MCP
// connections and writes the results, which redraws the replies.

// Bump the shape tag when Ticket's fields change: old cached values are dropped.
const PLUGIN = 'ticket-peek'
const tickets = atom({ plugin: 'ticket-peek', key: 'tickets' } as const, {}, {
  shape: 'tickets-3',
})
/** The keys whose cards the band holds, as replies last drew them. */
const bandKeys = atom({ plugin: 'ticket-peek', key: 'bandKeys' } as const, [] as string[])

/** A failed fetch is tried again after this long; a found ticket is kept. */
const RETRY_MS = 30_000
const needsFetch = (t: Ticket | undefined, now: number) =>
  !t ||
  (t.state === 'error' && now - (t.fetchedAt ?? 0) > RETRY_MS) ||
  (t.state === 'loading' && now >= (t.retryAt ?? 0))

// A reply can hold a dozen keys, each a few connector calls; sent at once they
// trip Notion's rate limit. So a few go at a time, and a rate-limited one waits
// and goes again (the card keeps saying "Loading") instead of failing.
const MAX_IN_FLIGHT = 2
const BACKOFF_MS = [5_000, 15_000, 45_000]
// A short burst limit, worth waiting out; not the hourly allowance, which says
// "do not retry" too but only refills within the hour.
const RATE_LIMITED = /rate.?limit|\b429\b|too many requests/i
const attempts = new Map<string, number>()
const epicTitles = new Map<string, string>()

const STORE_TRACKERS = 'trackers'
const NOTION_SERVERS = ['claude.ai Notion', 'Notion', 'plugin:design:notion']
const JIRA_SERVERS = ['claude.ai Atlassian', 'Atlassian', 'claude.ai Atlassian Rovo', 'plugin:design:atlassian']

let trackers: Record<string, Tracker> = {}
const wanted = new Set<string>()
const inFlight = new Set<string>()

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    trackers = await loadTrackers($)
    $.clock.every(800, () => {
      void drain($)
    })
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.isSummary || !hasKey(text)) return next(e)

    const known = await read($, tickets)
    const now = await $.clock.now()
    return drawMessage($.ui.resolve(e), text, known, now)
  })

  // This mod's row of the band: every recent key's card, all hidden until hovered.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.plugin !== PLUGIN || e.props.hasSurvey) return next(e)
    const keys = await read($, bandKeys)
    if (keys.length === 0) return next(e)
    const known = await read($, tickets)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    return <Box flexDirection="column">{keys.map(k => drawCard(ui, k, known[k]))}</Box>
  })

  // Under the other mods' rows, so a card that opens never covers their buttons.
  on('ui.render', { component: 'AbovePromptList' }, ($, e, next) => {
    const rows = e.props.rows
    if (!rows.some(r => r.plugin === PLUGIN)) return next(e)
    return next({ ...e, props: { ...e.props, rows: [...rows.filter(r => r.plugin !== PLUGIN), ...rows.filter(r => r.plugin === PLUGIN)] } })
  })
}

// ───────────────────────── tracker discovery ─────────────────────────

type Dollar = EngineInterface

async function loadTrackers($: Dollar): Promise<Record<string, Tracker>> {
  const saved = ((await $.store.get(STORE_TRACKERS)) ?? {}) as Record<string, Tracker>
  const found: Record<string, Tracker> = {}

  const files = new Set<string>(['CLAUDE.md'])
  const home = await $.env.get('HOME').catch(() => undefined)
  const roots: string[] = []
  try {
    const here = await $.fs.stat('.', { resolve: true })
    if (here.realPath) roots.push(here.realPath.replace(/\/[^/]+\/?$/, ''))
  } catch {}
  if (home) roots.push(`${home}/dev`)
  for (const root of roots) {
    try {
      for (const entry of await $.fs.list(root)) {
        if (entry.kind === 'dir') files.add(`${root}/${entry.name}/CLAUDE.md`)
      }
    } catch {}
  }

  for (const file of files) {
    let body: string
    try {
      body = await $.fs.read(file)
    } catch {
      continue
    }
    for (const t of parseConfig(body)) found[t.prefix] = t
  }

  const merged = { ...saved, ...found }
  await $.store.set(STORE_TRACKERS, merged)
  return merged
}

/** Reads `- **Name:** value` rows out of a CLAUDE.md config block. */
export function parseConfig(body: string): Tracker[] {
  const out: Tracker[] = []
  const blocks = body.matchAll(/<!-- (tracker|jira)-config -->([\s\S]*?)<!-- \/\1-config -->/g)
  for (const [, kind, block = ''] of blocks) {
    const row: Record<string, string> = {}
    for (const m of block.matchAll(/\*\*([^*]+):\*\*\s*(.+)/g)) {
      const name = (m[1] ?? '').trim().toLowerCase()
      row[name] = (m[2] ?? '').replace(/`/g, '').trim()
    }
    const prefix = (row['short name'] ?? row['project'] ?? '').match(/[A-Z][A-Z0-9]+/)?.[0]
    if (!prefix) continue
    const tool = kind === 'jira' ? 'jira' : (row['tickets'] ?? '').toLowerCase()
    if (tool.startsWith('notion')) {
      const dataSource = row['tickets data source']?.match(/collection:\/\/[\w-]+/)?.[0]
      if (dataSource) out.push({ kind: 'notion', prefix, dataSource, home: row['notion home'] })
    } else if (tool.startsWith('jira')) {
      const site = row['site']?.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      const cloudId = row['cloud id']
      if (site && cloudId) out.push({ kind: 'jira', prefix, site, cloudId })
    }
  }
  return out
}

// ───────────────────────── fetching ─────────────────────────

async function drain($: Dollar) {
  // Drawing can't write state, so the keys it saw reach the band from here.
  const inBand = await read($, bandKeys)
  if (inBand.join() !== seenKeys.join()) {
    const next = seenKeys
    await update($, bandKeys, () => next)
  }
  if (wanted.size === 0) return
  const known = await read($, tickets)
  const now = await $.clock.now()
  for (const key of [...wanted]) {
    if (inFlight.has(key) || !needsFetch(known[key], now)) {
      // A rate-limited key stays queued until its wait is over.
      if (known[key]?.state !== 'loading') wanted.delete(key)
      continue
    }
    if (inFlight.size >= MAX_IN_FLIGHT) break
    wanted.delete(key)
    inFlight.add(key)
    void fetchTicket($, key)
      .then((ticket): Ticket => {
        attempts.delete(key)
        return ticket
      })
      .catch((err: unknown): Ticket => {
        const tries = attempts.get(key) ?? 0
        if (RATE_LIMITED.test(String(err)) && tries < BACKOFF_MS.length) {
          attempts.set(key, tries + 1)
          return { key, state: 'loading', retryAt: now + (BACKOFF_MS[tries] ?? 0) }
        }
        attempts.delete(key)
        return { key, state: 'error', error: plainError(err) }
      })
      .then(async ticket => {
        const at = await $.clock.now()
        await update($, tickets, all => ({ ...all, [key]: { ...ticket, fetchedAt: at } }))
        // Queued again only once its wait is written, so no tick sees it bare.
        if (ticket.state === 'loading') wanted.add(key)
      })
      .finally(() => inFlight.delete(key))
  }
}

/**
 * A connector's error as one short sentence. They often arrive as a JSON
 * blob (`{"name":"APIResponseError",…,"message":"…"}`), cut off before the
 * part a person can read, so the message is pulled out of it.
 */
export function plainError(err: unknown): string {
  const raw = String(err instanceof Error ? err.message : err).replace(/^Error: /, '')
  const quoted = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)?.pop()
  const message = quoted ? quoted.replace(/^"message"\s*:\s*"/, '').replace(/"$/, '').replace(/\\(.)/g, '$1') : raw
  const short = message.replace(/^Failed to execute query: /, '').split(/(?<=\.)\s/)[0] ?? message
  return short.length > 160 ? `${short.slice(0, 157).trimEnd()}…` : short
}

async function fetchTicket($: Dollar, key: string): Promise<Ticket> {
  const prefix = key.split('-')[0] ?? ''
  const tracker = trackers[prefix]
  if (!tracker) return { key, state: 'missing' }
  return tracker.kind === 'notion' ? fetchNotion($, key, tracker) : fetchJira($, key, tracker)
}

const serverFor: Record<string, string> = {}

/**
 * The servers that offer `tool`, read off the session's tool names
 * (`mcp__<server>__<tool>`). The desktop app names claude.ai connectors by an
 * id, not "claude.ai Notion", so the tool is the reliable thing to look for.
 */
async function serversWithTool($: Dollar, tool: string): Promise<string[]> {
  try {
    const suffix = `__${tool}`
    return (await $.tool.list())
      .filter(t => t.mcp && t.name.startsWith('mcp__') && t.name.endsWith(suffix))
      .map(t => t.name.slice('mcp__'.length, -suffix.length))
  } catch {
    return []
  }
}

/** Calls the first server offering `tool` that answers; remembers which one did. */
async function callAny($: Dollar, kind: string, names: string[], tool: string, args: object) {
  const found = serverFor[kind] ? [] : await serversWithTool($, tool)
  const order = [...new Set([...(serverFor[kind] ? [serverFor[kind]] : []), ...found, ...names])]
  // A guessed name that isn't connected says nothing useful; keep the errors
  // of servers that exist, so the card shows why a real connection failed.
  const failures: string[] = []
  for (const server of order) {
    try {
      const res = await $.mcp.call(server, tool, args as Record<string, unknown>)
      const text = res.content.map((c: { type: string; text?: string }) => c.text ?? '').join('')
      if (res.isError) {
        failures.push(text)
        continue
      }
      serverFor[kind] = server
      return text
    } catch (err) {
      const msg = String(err)
      if (!/no connected MCP tool/.test(msg)) failures.push(msg.replace(/^.*\$\.mcp\.call: /, ''))
    }
  }
  throw new Error(failures[0] ?? `no connected server offers ${tool}`)
}

// The fallback query, for a table with no saved view. Notion's schema names a
// property called "ID" `userDefined:ID` (the bare name
// is kept for its own system id), and its filters want the schema's name.
// Older connectors took the bare name, so it stays as the fallback.
const ID_PROPERTIES = ['userDefined:ID', 'ID']
let idProperty: string | undefined

async function queryById($: Dollar, dataSource: string, n: number) {
  const order = idProperty ? [idProperty] : ID_PROPERTIES
  let failure: unknown
  for (const property of order) {
    try {
      const raw = await callAny($, 'notion', NOTION_SERVERS, 'notion-query-data-sources', {
        data: {
          mode: 'rows',
          data_source_url: dataSource,
          filter: {
            type: 'group',
            operator: 'and',
            filters: [{ type: 'property', property, propertyType: 'auto_increment_id', operator: 'number_equals', value: { type: 'exact', value: n } }],
          },
          limit: 1,
        },
      })
      idProperty = property
      return raw
    } catch (err) {
      failure ??= err
    }
  }
  throw failure
}

// ── The whole ticket table, read once ──
// Notion's free plan caps rows and SQL queries per workspace per hour, and
// Claude's own Notion work draws on the same allowance: a query per key used
// it up. Reading a saved view of the table is not capped, and one read
// returns every ticket, so the table is read whole, kept a few minutes, and
// looked up by ID. Only a table with no view to read falls back to a query.

type Row = Record<string, string>
type Table = { at: number; byId: Map<number, Row> }
const TABLE_TTL_MS = 5 * 60_000
const TABLE_REFRESH_FOR_MISSING_MS = 30_000
const tables = new Map<string, Table>()
const loadingTables = new Map<string, Promise<Table | undefined>>()
const viewFor = new Map<string, string | null>()

/** The first saved view of the database behind a data source, or null. */
async function findView($: Dollar, dataSource: string): Promise<string | null> {
  if (viewFor.has(dataSource)) return viewFor.get(dataSource) ?? null
  let view: string | null = null
  try {
    const source = JSON.parse(await callAny($, 'notion', NOTION_SERVERS, 'notion-fetch', { id: dataSource }))
    const database = String(source.url ?? '').replace(/\?.*$/, '')
    if (database) {
      const db = String(JSON.parse(await callAny($, 'notion', NOTION_SERVERS, 'notion-fetch', { id: database })).text ?? '')
      view = db.match(/view:\/\/[0-9a-f-]+/)?.[0] ?? null
    }
  } catch {}
  viewFor.set(dataSource, view)
  return view
}

async function readTable($: Dollar, dataSource: string, view: string, now: number): Promise<Table> {
  const byId = new Map<number, Row>()
  let cursor: string | undefined
  for (let page = 0; page < 20; page++) {
    const raw = await callAny($, 'notion', NOTION_SERVERS, 'notion-query-data-sources', {
      data: { mode: 'view', view_url: view, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) },
    })
    const body = JSON.parse(raw)
    for (const row of (body.results ?? []) as Row[]) {
      const id = Number(row['userDefined:ID'] ?? row['ID'])
      if (Number.isFinite(id)) byId.set(id, row)
    }
    if (!body.has_more || !body.next_cursor) break
    cursor = body.next_cursor
  }
  const table = { at: now, byId }
  tables.set(dataSource, table)
  return table
}

/** The table, read through its view when it has one; undefined when it has none. */
async function tableFor($: Dollar, dataSource: string, n: number): Promise<Table | undefined> {
  const now = await $.clock.now()
  const kept = tables.get(dataSource)
  const fresh = kept && now - kept.at < TABLE_TTL_MS
  // A key the kept table lacks may be a ticket made since: read again, at most every 30s.
  if (kept && fresh && (kept.byId.has(n) || now - kept.at < TABLE_REFRESH_FOR_MISSING_MS)) return kept
  const pending = loadingTables.get(dataSource)
  if (pending) return pending
  const load = (async () => {
    const view = await findView($, dataSource)
    return view ? readTable($, dataSource, view, now) : undefined
  })().finally(() => loadingTables.delete(dataSource))
  loadingTables.set(dataSource, load)
  return load
}

async function fetchNotion($: Dollar, key: string, t: Extract<Tracker, { kind: 'notion' }>): Promise<Ticket> {
  const n = Number(key.split('-')[1])
  const table = await tableFor($, t.dataSource, n)
  const row = table
    ? table.byId.get(n)
    : ((JSON.parse(await queryById($, t.dataSource, n)).results ?? [])[0] as Row | undefined)
  if (!row) return { key, state: 'missing', url: t.home }

  let brief: string | undefined
  let place: string | undefined
  try {
    const page = JSON.parse(await callAny($, 'notion', NOTION_SERVERS, 'notion-fetch', { id: row.url }))
    const content = String(page.text ?? '').match(/<content>([\s\S]*?)<\/content>/)?.[1] ?? ''
    brief = firstParagraph(content)
  } catch {}
  try {
    const epicUrl = (JSON.parse(row['Epic'] ?? '[]') as string[])[0]
    if (epicUrl) {
      let title = epicTitles.get(epicUrl)
      if (!title) {
        title = String(JSON.parse(await callAny($, 'notion', NOTION_SERVERS, 'notion-fetch', { id: epicUrl })).title ?? '')
        if (title) epicTitles.set(epicUrl, title)
      }
      if (title) place = `In epic: ${title}`
    }
  } catch {}

  return {
    key,
    state: 'ok',
    url: row.url,
    title: row['Name']?.replace(/\\([[\]()*_`])/g, '$1'),
    status: row['Status'],
    type: row['Type'],
    priority: row['Priority'],
    place,
    brief,
  }
}

async function fetchJira($: Dollar, key: string, t: Extract<Tracker, { kind: 'jira' }>): Promise<Ticket> {
  const raw = await callAny($, 'jira', JIRA_SERVERS, 'getJiraIssue', {
    cloudId: t.cloudId,
    issueIdOrKey: key,
    fields: ['summary', 'status', 'issuetype', 'priority', 'parent', 'description'],
    responseContentFormat: 'markdown',
    updateHistory: false,
  })
  const body = JSON.parse(raw)
  const issue = body.issues?.nodes?.[0] ?? body
  const f = issue?.fields
  if (!f) return { key, state: 'missing', url: `https://${t.site}/browse/${key}` }

  const type = f.issuetype?.name as string | undefined
  let place: string | undefined
  if (f.issuetype?.subtask && f.parent?.key) place = `Sub-task inside ${f.parent.key} · ${f.parent.fields?.summary ?? ''}`
  else if (type === 'Epic') place = 'Epic'
  else if (f.parent?.key) place = `In the ${f.parent.key} epic · ${f.parent.fields?.summary ?? ''}`

  return {
    key,
    state: 'ok',
    url: issue.webUrl ?? `https://${t.site}/browse/${key}`,
    title: f.summary,
    status: f.status?.name,
    type,
    priority: f.priority?.name,
    place,
    brief: typeof f.description === 'string' ? firstParagraph(f.description) : undefined,
  }
}

/** The first prose paragraph of a ticket body, as plain text, cut short. */
export function firstParagraph(md: string): string | undefined {
  for (const para of md.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p || /^(#|- \[|\||```|<)/.test(p) && !/^<mention/.test(p)) continue
    const plain = p
      .replace(/<mention[^>]*>([^<]*)<\/mention>/g, '$1')
      .replace(/<date start="([^"]+)"[^>]*\/>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (plain.length < 12) continue
    return plain.length > 280 ? `${plain.slice(0, 277).trimEnd()}…` : plain
  }
  return undefined
}

// ───────────────────────── drawing ─────────────────────────

// METH-58, and the sub-task form METH-56(325) the Method CLAUDE.md asks for.
const KEY = /\b([A-Z][A-Z0-9]{1,9})-(\d+)(?:\((\d+)\))?/g

function hasKey(text: string) {
  for (const m of text.matchAll(KEY)) if (trackers[m[1] ?? '']) return true
  return false
}

type Ui = ReturnType<EngineInterface['ui']['resolve']>
type Chip = { label: string; key: string; scope: string }

/** Splits a reply into blocks: plain markdown, lines holding keys, tables. */
export function splitBlocks(text: string) {
  type Block = { kind: 'md' | 'line' | 'table'; lines: string[]; gapBefore: boolean }
  const blocks: Block[] = []
  let fence = false
  let gap = false
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const blank = line.trim() === ''
    const kind: Block['kind'] =
      fence || /^\s*(```|~~~)/.test(line) ? 'md'
      : /^\s*\|/.test(line) ? 'table'
      : !blank && [...line.matchAll(KEY)].some(m => trackers[m[1] ?? '']) ? 'line'
      : 'md'
    if (blank && !fence) {
      gap = true
      continue
    }
    const last = blocks[blocks.length - 1]
    if (last && last.kind === kind && kind !== 'line' && !(gap && kind === 'md' && !fence)) {
      if (gap) last.lines.push('')
      last.lines.push(line)
    } else {
      blocks.push({ kind, lines: [line], gapBefore: gap && blocks.length > 0 })
    }
    gap = false
  }
  return blocks
}

// ── The card's seat: the band above the prompt ──
// A card floating in the transcript fought the desktop's drawing: blocks drawn
// after it showed through, its message's edge clipped it, and a short message
// had no room so it pushed the text apart. So every card sits, hidden, in this
// mod's own row of the band above the prompt, and hovering a key anywhere
// reveals that key's card there: a key and its card share the hover group
// `tp:<KEY>`. The row goes last in the band, under the other mods' buttons, so
// a card never covers them, and the band's size limit, which keeps rows from
// the top, drops this row before theirs.

/** Cards kept in the band: the most recently drawn keys. */
const BAND_CARDS = 16
const scopeOf = (key: string) => `tp:${key}`

/** Keys in the order replies drew them, most recent last. */
let seenKeys: string[] = []
function noteSeen(key: string) {
  if (seenKeys[seenKeys.length - 1] === key) return
  seenKeys = [...seenKeys.filter(k => k !== key), key].slice(-BAND_CARDS)
}

function drawMessage(ui: Ui, text: string, known: Record<string, Ticket>, now: number) {
  const { Box, Markdown } = ui
  const chipFor = (label: string, key: string): Chip => {
    if (needsFetch(known[key], now)) wanted.add(key)
    noteSeen(key)
    return { label, key, scope: scopeOf(key) }
  }

  const rows = splitBlocks(text).map(block => {
    const mt = block.gapBefore ? 1 : 0
    if (block.kind === 'md') return <Box marginTop={mt}><Markdown text={block.lines.join('\n')} /></Box>
    if (block.kind === 'table') {
      const chips: Chip[] = []
      const seen = new Set<string>()
      const md = block.lines
        .map(line =>
          line.replace(KEY, (whole, p: string, num: string, sub?: string) => {
            if (!trackers[p]) return whole
            const key = `${p}-${sub ?? num}`
            if (!seen.has(key)) {
              seen.add(key)
              chips.push(chipFor(key, key))
            }
            const url = linkFor(key, known)
            return url ? `[${whole}](${url})` : whole
          }),
        )
        .join('\n')
      if (chips.length === 0) return <Box marginTop={mt}><Markdown text={md} /></Box>
      // A table's keys are plain links inside its Markdown; this row gives
      // them something to hover.
      return (
        <Box marginTop={mt} flexDirection="column">
          <Markdown text={md} />
          {drawLine(ui, [{ text: 'Tickets: ', dim: true }, ...chips.flatMap((c, i) => (i ? [{ text: '  ' }, c] : [c]))], known)}
        </Box>
      )
    }
    return <Box marginTop={mt}>{drawLine(ui, parseLine(block.lines[0] ?? '', chipFor), known)}</Box>
  })
  return <Box flexDirection="column">{rows}</Box>
}

type Seg = { text?: string; bold?: boolean; italic?: boolean; mono?: boolean; dim?: boolean; href?: string; heading?: boolean }
type Part = Seg | (Chip & Seg)

/** One markdown line holding keys, as styled segments and chips. */
export function parseLine(line: string, chipFor: (label: string, key: string) => Chip): Part[] {
  const out: Part[] = []
  let body = line
  const lead = line.match(/^(\s*)/)?.[1]?.length ?? 0
  const heading = /^\s*#{1,6}\s+/.test(line)
  body = body.replace(/^\s*#{1,6}\s+/, '')
  let prefix = ''
  let m: RegExpMatchArray | null
  if ((m = body.match(/^\s*[-*+]\s+\[( |x|X)\]\s+/))) prefix = m[1] === ' ' ? '☐ ' : '☑ '
  else if ((m = body.match(/^\s*[-*+]\s+/))) prefix = '• '
  else if ((m = body.match(/^\s*(\d+[.)])\s+/))) prefix = `${m[1]} `
  else if ((m = body.match(/^\s*>\s?/))) prefix = '▎ '
  if (m) body = body.slice(m[0].length)
  else body = body.trimStart()
  if (lead || prefix) out.push({ text: ' '.repeat(lead) + prefix, dim: prefix === '▎ ' })

  const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g
  const pushText = (s: string, style: Seg) => {
    let at = 0
    for (const k of s.matchAll(KEY)) {
      const [whole, p = '', num = '', sub] = k
      if (!trackers[p]) continue
      if (k.index! > at) out.push({ ...style, text: s.slice(at, k.index) })
      out.push({ ...style, ...chipFor(whole, `${p}-${sub ?? num}`) })
      at = k.index! + whole.length
    }
    if (at < s.length) out.push({ ...style, text: s.slice(at) })
  }
  const base: Seg = heading ? { bold: true, heading: true } : {}
  let at = 0
  for (const t of body.matchAll(INLINE)) {
    if (t.index! > at) pushText(body.slice(at, t.index), base)
    const [whole, code, bold, italic, link] = t
    if (code) pushText(code.slice(1, -1), { ...base, mono: true })
    else if (bold) pushText(bold.slice(2, -2), { ...base, bold: true })
    else if (italic) pushText(italic.slice(1, -1), { ...base, italic: true })
    else if (link) {
      const lm = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
      out.push({ ...base, text: lm?.[1] ?? whole, href: lm?.[2] })
    }
    at = t.index! + whole.length
  }
  if (at < body.length) pushText(body.slice(at), base)
  return out
}

function linkFor(key: string, known: Record<string, Ticket>) {
  const t = known[key]
  if (t?.url) return t.url
  const tr = trackers[key.split('-')[0] ?? '']
  if (tr?.kind === 'jira') return `https://${tr.site}/browse/${key}`
  return tr?.home
}

/** A line of segments, its keys drawn as links that light their card in the band. */
function drawLine(ui: Ui, parts: Part[], known: Record<string, Ticket>) {
  const { Text, Link } = ui
  const segs = parts.map(p => {
    const style = { bold: p.bold, italic: p.italic, mono: p.mono, dimColor: p.dim, size: p.heading ? ('heading' as const) : undefined }
    if ('scope' in p) {
      const url = linkFor(p.key, known)
      return (
        <Text {...style} color="suggestion" hover={{ scope: p.scope, underline: true }}>
          {url ? <Link href={url}>{p.label}</Link> : p.label}
        </Text>
      )
    }
    if (p.href) return <Text {...style}><Link href={p.href}>{p.text ?? ''}</Link></Text>
    return <Text {...style}>{p.text ?? ''}</Text>
  })
  return <Text>{segs}</Text>
}

/** One key's card for the band: hidden until a key in its hover group is. */
function drawCard(ui: Ui, key: string, t: Ticket | undefined) {
  const { Box, Text } = ui
  const tool = trackers[key.split('-')[0] ?? '']?.kind === 'jira' ? 'Jira' : 'Notion'
  const meta = [t?.status, t?.type, t?.priority && `${t.priority} priority`, t?.place].filter(Boolean).join(' · ')
  const status =
    !t || t.state === 'loading' ? `Loading from ${tool}…`
    : t.state === 'missing' ? `Not found in ${tool}.`
    : t.state === 'error' ? `${tool} refused the lookup: ${t.error}`
    : meta
  return (
    <Box
      display="none"
      hover={{ scope: scopeOf(key), display: 'flex' }}
      flexDirection="column"
      borderStyle="round"
      borderColor="suggestion"
      paddingX={1}
    >
      <Text bold>
        {key}
        {t?.title ? ` · ${t.title}` : ''}
      </Text>
      {status ? <Text dimColor={t?.state !== 'error'} color={t?.state === 'error' ? 'error' : undefined}>{status}</Text> : null}
      {t?.brief ? <Text>{t.brief}</Text> : null}
    </Box>
  )
}
