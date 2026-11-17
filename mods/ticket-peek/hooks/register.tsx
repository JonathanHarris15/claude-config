import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { Ticket, Tracker } from '../types'

// Ticket keys in Claude's replies become links with a hover card.
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
const tickets = atom({ plugin: 'ticket-peek', key: 'tickets' } as const, {}, {
  shape: 'tickets-3',
})

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
const RATE_LIMITED = /rate.?limit|\b429\b|too many requests|do not retry this request/i
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
    const ui = $.ui.resolve(e)
    return drawMessage(ui, text, known, now, e.viewport?.columns ?? 100)
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

// Notion's schema names a property called "ID" `userDefined:ID` (the bare name
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

async function fetchNotion($: Dollar, key: string, t: Extract<Tracker, { kind: 'notion' }>): Promise<Ticket> {
  const raw = await queryById($, t.dataSource, Number(key.split('-')[1]))
  const row = (JSON.parse(raw).results ?? [])[0] as Record<string, string> | undefined
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
    title: row['Name'],
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

// ── Hiding what a card covers ──
// A floating card is painted over what comes before it in the tree, and under
// what comes after: on the desktop a later Markdown block (a list, a table)
// shows through it. So a card that opens downward is not drawn beside its
// line but at the end of a box holding everything after that line: it sits
// right under the line and is painted last. `inverseText` is the page's own
// ground on every surface, so the card reads as solid.
const CARD_FILL = 'inverseText'

// ── Where a card opens ──
// The desktop clips a floating card to its own message. So a card floats over
// the text below its key when the message has room there, else over the text
// above it, and only in a message too short for either does it open in the
// flow, pushing the lines below down. Room is estimated from line lengths:
// rough, so a margin of a row is kept.

type Place = 'below' | 'above' | 'flow'
const CARD_COLS = 60

const rowsOf = (s: string, cols: number) => Math.max(1, Math.ceil(s.length / Math.max(20, cols)))

export function cardRows(key: string, t: Ticket | undefined) {
  const r = (s?: string) => (s ? rowsOf(s, CARD_COLS) : 0)
  const status = !t || t.state === 'ok' ? '' : t.state === 'error' ? `Notion refused the lookup: ${t.error}` : 'Not found'
  return 2 + rowsOf(`${key} · ${t?.title ?? ''}`, CARD_COLS) + 1 + r(status) + r(t?.place) + r(t?.brief) + 1
}

/**
 * A markdown line as a reader sees it: a link is its label (a long URL behind
 * a short label once made a card think it had room below and get clipped),
 * and emphasis marks, tags and heading or quote marks take no room.
 */
export function shown(line: string) {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^\s*(#{1,6}|>)\s+/, '')
}

function blockRows(block: { kind: string; lines: string[]; gapBefore: boolean }, cols: number) {
  const body = block.lines.reduce((n, l) => n + (l.trim() === '' || block.kind === 'table' ? 1 : rowsOf(shown(l), cols)), 0)
  return body + (block.gapBefore ? 1 : 0) + (block.kind === 'table' ? 1 : 0)
}

function drawMessage(ui: Ui, text: string, known: Record<string, Ticket>, now: number, cols: number) {
  const { Box, Markdown } = ui
  const blocks = splitBlocks(text)
  const heights = blocks.map(b => blockRows(b, cols))
  const total = heights.reduce((a, b) => a + b, 0)
  let before = 0
  const placer = (above: number, below: number) => (chip: Chip): Place => {
    const need = cardRows(chip.key, known[chip.key]) + 1
    return below >= need ? 'below' : above >= need ? 'above' : 'flow'
  }
  const salt = hash(text)
  let n = 0
  const chipFor = (label: string, key: string): Chip => {
    if (needsFetch(known[key], now)) wanted.add(key)
    return { label, key, scope: `tp:${salt}:${n++}` }
  }

  type Drawn = { node: RenderElement; below: RenderElement[] }
  const plain = (node: RenderElement): Drawn => ({ node, below: [] })
  const rows: Drawn[] = blocks.map((block, i): Drawn => {
    const mt = block.gapBefore ? 1 : 0
    const rowsHere = heights[i] ?? 1
    const above = before + mt
    before += rowsHere
    const below = total - before
    if (block.kind === 'md') return plain(<Box marginTop={mt}><Markdown text={block.lines.join('\n')} /></Box>)
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
      if (chips.length === 0) return plain(<Box marginTop={mt}><Markdown text={md} /></Box>)
      const row = drawLine(ui, [{ text: 'Tickets: ', dim: true }, ...chips.flatMap((c, i) => (i ? [{ text: '  ' }, c] : [c]))], chips, known, placer(above + rowsHere - mt - 1, below))
      return {
        node: (
          <Box marginTop={mt} flexDirection="column">
            <Markdown text={md} />
            {row.node}
          </Box>
        ),
        below: row.below,
      }
    }
    const line = block.lines[0] ?? ''
    const parts = parseLine(line, chipFor)
    const chips = parts.filter((p): p is Chip & Seg => 'scope' in p)
    const drawn = drawLine(ui, parts, chips, known, placer(above - mt, below + rowsHere - mt - 1))
    return { node: <Box marginTop={mt}>{drawn.node}</Box>, below: drawn.below }
  })

  // Folded from the end: each block, then a box of everything after it whose
  // last children are that block's downward cards, so they paint over it all.
  let tail: RenderElement | null = null
  for (let i = rows.length - 1; i >= 0; i--) {
    const { node, below } = rows[i]!
    const after = tail || below.length ? <Box flexDirection="column">{tail}{below}</Box> : null
    tail = <Box flexDirection="column">{node}{after}</Box>
  }
  return tail ?? <Box />
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

/** A line of segments and chips; its downward cards come back apart, for the caller to paint last. */
function drawLine(ui: Ui, parts: Part[], chips: Chip[], known: Record<string, Ticket>, place: (c: Chip) => Place) {
  const { Box, Text, Link } = ui
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
  const at = (where: Place) => chips.filter(c => place(c) === where).map(c => drawCard(ui, c, known[c.key], where))
  const above = at('above')
  return {
    node: (
      <Box flexDirection="column">
        {above.length ? <Box height={0}>{above}</Box> : null}
        <Text>{segs}</Text>
        {at('flow')}
      </Box>
    ),
    below: at('below'),
  }
}

function drawCard(ui: Ui, chip: Chip, t: Ticket | undefined, where: Place) {
  const { Box, Text } = ui
  const tool = trackers[chip.key.split('-')[0] ?? '']?.kind === 'jira' ? 'Jira' : 'Notion'
  const meta = [t?.status, t?.type, t?.priority && `${t.priority} priority`].filter(Boolean).join(' · ')
  return (
    <Box
      {...(where === 'flow'
        ? { marginLeft: 2 }
        : where === 'below'
          ? { position: 'absolute' as const, top: 0, left: 2, backgroundColor: CARD_FILL }
          : { position: 'absolute' as const, bottom: 0, left: 2, backgroundColor: CARD_FILL })}
      width={64}
      display="none"
      hover={{ scope: chip.scope, display: 'flex' }}
      flexDirection="column"
      borderStyle="round"
      borderColor="suggestion"
      paddingX={1}
    >
      <Text bold>
        {chip.key}
        {t?.title ? ` · ${t.title}` : ''}
      </Text>
      {!t || t.state === 'loading' ? <Text dimColor>Loading from {tool}…</Text> : null}
      {t?.state === 'missing' ? <Text dimColor>Not found in {tool}.</Text> : null}
      {t?.state === 'error' ? <Text color="error">{tool} refused the lookup: {t.error}</Text> : null}
      {meta ? <Text dimColor>{meta}</Text> : null}
      {t?.place ? <Text dimColor>{t.place}</Text> : null}
      {t?.brief ? <Text>{t.brief}</Text> : null}
      <Text dimColor size="caption">Click the key to open it in {tool}</Text>
    </Box>
  )
}

function hash(s: string) {
  let acc = 5381
  for (let i = 0; i < s.length; i++) acc = ((acc << 5) + acc + s.charCodeAt(i)) | 0
  return (acc >>> 0).toString(36)
}

