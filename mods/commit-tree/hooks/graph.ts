import type { Pending, Pill, Row } from '../types'

/** A commit's seat in the picture: which lane, and which line it belongs to. */
export type Seat = { lane: number; color: number }

/** One parent link: from a commit's row to its parent's, travelling in a lane. */
export type Link = {
  from: number
  /** The parent's row, or -1 when the parent is older than what was read. */
  to: number
  lane: number
  color: number
}

/**
 * Give each commit a lane, newest first. A lane holds the next commit it
 * waits for. A first parent carries on in its child's lane; another parent
 * opens a lane of its own. Lanes waiting for the same commit meet at it, so a
 * branch keeps its own line and colour until the commit it grew from.
 */
export function layLanes(commits: readonly Pick<Row, 'hash' | 'parents'>[]) {
  const rowOf = new Map(commits.map((one, at) => [one.hash, at]))
  const lanes: ({ hash: string; color: number } | null)[] = []
  const seats: Seat[] = []
  const links: Link[] = []
  let nextColor = 0

  const free = () => {
    const at = lanes.indexOf(null)

    return at < 0 ? lanes.length : at
  }

  commits.forEach((one, row) => {
    let lane = lanes.findIndex(slot => slot?.hash === one.hash)
    let color: number
    if (lane < 0) {
      lane = free()
      color = nextColor++
    } else {
      color = lanes[lane]!.color
    }
    lanes.forEach((slot, at) => {
      if (slot?.hash === one.hash) lanes[at] = null
    })
    seats.push({ lane, color })

    one.parents.forEach((parent, nth) => {
      let slot = lane
      let lineColor = color
      if (nth === 0) {
        lanes[lane] = { hash: parent, color }
      } else {
        const waiting = lanes.findIndex(held => held?.hash === parent)
        if (waiting >= 0) {
          slot = waiting
          lineColor = lanes[waiting]!.color
        } else {
          slot = free()
          lineColor = nextColor++
          lanes[slot] = { hash: parent, color: lineColor }
        }
      }
      links.push({ from: row, to: rowOf.get(parent) ?? -1, lane: slot, color: lineColor })
    })
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
  })

  const width = Math.max(1, ...seats.map(s => s.lane + 1), ...links.map(l => l.lane + 1))

  return { seats, links, width }
}

/** How long ago, in the fewest letters: `now`, `5m`, `3h`, `2d`, `3w`, `4mo`, `2y`. */
export function ago(seconds: number, nowMs = Date.now()): string {
  const s = Math.max(0, nowMs / 1000 - seconds)
  if (!seconds) return ''
  if (s < 60) return 'now'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  if (s < 86400 * 14) return Math.floor(s / 86400) + 'd'
  if (s < 86400 * 60) return Math.floor(s / (86400 * 7)) + 'w'
  if (s < 86400 * 365) return Math.floor(s / (86400 * 30)) + 'mo'

  return Math.floor(s / (86400 * 365)) + 'y'
}

/** A name to draw on a commit, with the remote copies that sit on it too. */
export type Label = { kind: Pill['kind']; name: string; also: string[] }

/**
 * Fold `origin/main` into `main` when both sit on the same commit: one label
 * that says the branch is pushed, not two that say the same thing.
 */
export function foldPills(pills: readonly Pill[]): Label[] {
  const labels: Label[] = pills
    .filter(p => p.kind !== 'remote')
    .map(p => ({ kind: p.kind, name: p.name, also: [] as string[] }))
  for (const p of pills) {
    if (p.kind !== 'remote') continue
    const cut = p.name.indexOf('/')
    const remote = p.name.slice(0, cut)
    const branch = p.name.slice(cut + 1)
    const mine = labels.find(l => (l.kind === 'local' || l.kind === 'head') && l.name === branch)
    if (mine) mine.also.push(remote)
    else labels.push({ kind: 'remote', name: p.name, also: [] })
  }

  return labels
}

/** Lane colours, mid tones that read on a light and a dark page alike. */
export const LANE_COLORS = [
  '#4c8dff',
  '#f0a030',
  '#2fb67c',
  '#c56ee0',
  '#ef6461',
  '#22b3c4',
  '#8f86ff',
  '#c9a227',
]

const LANE = 16
const ROW = 28
const PAD = 14
/** Narrower than this, a row drops its hash and its labels drop their remote. */
const NARROW = 420
/** The picture's most characters; the surface refuses one past 131072. */
const BUDGET = 120000
/** The picture's most rows; the surface refuses one taller than 4096px. */
const MAX_ROWS = Math.floor((4096 - 8) / ROW)

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const clip = (s: string, room: number) =>
  room < 4 ? '' : s.length <= room ? s : s.slice(0, room - 1).trimEnd() + '…'

// The picture carries its own background, flipped with its text, so the two
// always match: the page behind it may follow a different theme than the OS.
const STYLE = `
.bg{fill:#fbfbfa}.t{fill:#1f2328}.d{fill:#6e7781}
.m{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
text{dominant-baseline:central}.e{text-anchor:end}
.r use{fill:transparent}.r:hover use{fill:#8882}.hd use{fill:#4c8dff1a}
.p{font-size:11px;font-weight:600}.w{fill:#fff}.o{fill:#fbfbfa}.i{font-style:italic}
@media (prefers-color-scheme:dark){.bg,.o{fill:#232322}.t{fill:#e6edf3}.d{fill:#8b949e}}
`

/** What is not yet committed, in words: `2 staged, 3 changed, 1 new`. */
export function pendingWords(p: Pending): string {
  const parts = [
    p.conflicts ? p.conflicts + ' in conflict' : '',
    p.staged ? p.staged + ' staged' : '',
    p.changed ? p.changed + ' changed' : '',
    p.added ? p.added + ' new' : '',
  ].filter(Boolean)

  return parts.length ? parts.join(', ') : 'nothing changed'
}

/** True when anything at all is changed and not committed. */
export const hasPending = (p: Pending) => p.staged + p.changed + p.added + p.conflicts > 0

/** The made-up commit that stands for the uncommitted changes. */
const WIP = '\u0000wip'

/**
 * Draw the history as one SVG: a coloured line per branch, a dot per commit,
 * its names as labels, its subject, and how long ago at the right. Hovering a
 * row shows the full subject, author, date and hash.
 */
export function drawGraph(
  all: readonly Row[],
  width: number,
  nowMs = Date.now(),
  pending?: Pending,
) {
  const commits = all.filter(one => one.hash)
  // Uncommitted changes are drawn as one more commit, a child of the head,
  // seated just above it, so the lanes treat it as the head's newest work.
  if (pending && hasPending(pending)) {
    const headAt = commits.findIndex(one => one.pills.some(p => p.kind === 'head'))
    commits.splice(Math.max(0, headAt), 0, {
      rails: '',
      railColors: [],
      hash: WIP,
      parents: headAt < 0 ? [] : [commits[headAt]!.hash],
      pills: [],
      time: 0,
      who: '',
      subject: 'Uncommitted: ' + pendingWords(pending),
      isLocal: true,
    })
  }
  const { seats, links, width: lanes } = layLanes(commits)
  const W = Math.round(width)
  const textX = PAD + (lanes - 1) * LANE + 18
  // A narrow pane keeps the subject and gives up the extras: the hash goes
  // (hovering still shows it), and a label drops the remote it matches.
  const isNarrow = W < NARROW
  const ageX = isNarrow ? W - PAD : W - PAD - 62
  const x = (lane: number) => PAD + lane * LANE
  const y = (row: number) => row * ROW + ROW / 2 + 4

  // Rows first, so the picture stops at a row and not halfway through one.
  const rowParts: string[] = []
  let size = 0
  for (const [at, one] of commits.entries()) {
    if (rowParts.length >= MAX_ROWS) break
    const seat = seats[at]!
    const color = LANE_COLORS[seat.color % LANE_COLORS.length]!
    const labels = foldPills(one.pills)
    const isHead = one.pills.some(p => p.kind === 'head')
    const isMerge = one.parents.length > 1
    const isWip = one.hash === WIP
    if (isWip) {
      const cx = x(seat.lane)
      const tip = 'Not committed yet\n' + one.subject.slice('Uncommitted: '.length)
      let parts = `<g class="r" transform="translate(0 ${y(at)})"><title>${esc(tip)}</title><use href="#b"/>`
      parts += `<circle cx="${cx}" r="5" class="o" stroke="${color}" stroke-width="2" stroke-dasharray="2.5 2"/>`
      const subject = clip(one.subject, Math.floor((W - PAD - textX) / 7))
      parts += `<text class="t i" x="${textX}">${esc(subject)}</text></g>`
      size += parts.length
      rowParts.push(parts)
      continue
    }
    const day = one.time ? new Date(one.time * 1000).toISOString().slice(0, 10) : ''
    const names = labels.map(l => [l.name, ...l.also.map(r => r + '/' + l.name)].join(', '))
    const tip = [
      one.subject,
      [one.hash, one.who, day].filter(Boolean).join(' · '),
      ...names,
      one.isLocal ? 'Only on this computer: not pushed yet' : '',
    ].filter(Boolean)

    let parts = `<g class="r${isHead ? ' hd' : ''}" transform="translate(0 ${y(at)})"><title>${esc(tip.join('\n'))}</title><use href="#b"/>`
    const cx = x(seat.lane)
    if (isHead) parts += `<circle cx="${cx}" r="7.5" fill="none" stroke="${color}" stroke-width="2"/>`
    // A pushed commit is a solid dot; one only on this computer is hollow.
    if (one.isLocal) {
      parts += isMerge
        ? `<circle cx="${cx}" r="3" class="o" stroke="${color}" stroke-width="1.5"/>`
        : `<circle cx="${cx}" r="4.5" class="o" stroke="${color}" stroke-width="2"/>`
    } else {
      parts += isMerge
        ? `<circle cx="${cx}" r="3.5" fill="${color}"/>`
        : `<circle cx="${cx}" r="5" fill="${color}"/>`
    }

    let tx = textX
    for (const l of labels) {
      const also = l.also.length && !isNarrow ? ' · ' + l.also.join(' ') : ''
      const text = (l.kind === 'tag' ? '◆ ' : '') + l.name + also
      const w = Math.round(text.length * 6 + 14)
      if (tx + w > ageX - 60) break
      const hue = l.kind === 'tag' ? LANE_COLORS[7]! : l.kind === 'remote' ? '#8b949e' : color
      if (l.kind === 'head') {
        parts += `<rect x="${tx}" y="-9" width="${w}" height="18" rx="9" fill="${hue}"/>`
        parts += `<text class="p w" x="${tx + 7}">${esc(text)}</text>`
      } else {
        const dash = l.kind === 'remote' ? ' stroke-dasharray="3 2"' : ''
        parts += `<rect x="${tx}" y="-9" width="${w}" height="18" rx="9" fill="${hue}22" stroke="${hue}"${dash}/>`
        parts += `<text class="p" x="${tx + 7}" fill="${hue}">${esc(text)}</text>`
      }
      tx += w + 6
    }

    const subject = clip(one.subject, Math.floor((ageX - 36 - tx) / 7))
    if (subject) parts += `<text class="${isMerge ? 'd' : 't'}" x="${tx}">${esc(subject)}</text>`
    parts += `<text class="d e" x="${ageX}">${ago(one.time, nowMs)}</text>`
    if (!isNarrow) parts += `<text class="d m e" x="${W - PAD}">${esc(one.hash.slice(0, 7))}</text>`
    parts += '</g>'

    if (size + parts.length > BUDGET * 0.8) break
    size += parts.length
    rowParts.push(parts)
  }

  const shown = rowParts.length
  const height = shown * ROW + 8
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const mid = (y1 + y2) / 2

    return `C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`
  }

  const linkParts: string[] = []
  for (const link of links) {
    if (link.from >= shown) continue
    const isOff = link.to < 0 || link.to >= shown
    const lc = seats[link.from]!.lane
    const lp = isOff ? link.lane : seats[link.to]!.lane
    const rp = isOff ? shown : link.to
    const xc = x(lc)
    const yc = y(link.from)
    const xl = x(link.lane)
    const xp = x(lp)
    const yp = isOff ? height : y(rp)

    let d = `M${xc} ${yc}`
    let yAt = yc
    if (link.lane !== lc) {
      if (rp === link.from + 1) {
        d += curve(xc, yc, xp, yp)
        yAt = yp
      } else {
        d += curve(xc, yc, xl, y(link.from + 1))
        yAt = y(link.from + 1)
      }
    }
    if (yAt < yp) {
      if (lp !== link.lane) {
        const before = y(rp - 1)
        if (before > yAt) d += `L${xl} ${before}`
        d += curve(xl, Math.max(before, yAt), xp, yp)
      } else {
        d += `L${xp} ${yp}`
      }
    }
    const color = LANE_COLORS[link.color % LANE_COLORS.length]
    const dash = commits[link.from]!.hash === WIP ? ' stroke-dasharray="3 3"' : ''
    linkParts.push(`<path d="${d}" stroke="${color}"${dash}/>`)
  }

  const source =
    // Pinned to the top: a slot narrower than guessed shrinks the picture, and
    // it should then leave its spare room below, not above.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" preserveAspectRatio="xMidYMin meet" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="13">` +
    `<style>${STYLE}</style><defs><rect id="b" x="0" y="${-ROW / 2}" width="${W}" height="${ROW}" rx="4"/></defs>` +
    `<rect class="bg" width="${W}" height="${height}" rx="8"/>` +
    `<g fill="none" stroke-width="2" stroke-linecap="round">${linkParts.join('')}</g>` +
    rowParts.join('') +
    `</svg>`

  const wips = commits.slice(0, shown).some(one => one.hash === WIP) ? 1 : 0

  return { source, shown: shown - wips, total: commits.length - wips, width: W, height }
}
