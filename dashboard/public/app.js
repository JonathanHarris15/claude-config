// The dashboard page. Plain JS, no build step, nothing fetched from elsewhere.

const ROUTES = {
  git: { label: 'Git', gist: 'In the repo and pushed. Every linked machine gets these.', hollow: false },
  pending: { label: 'Waiting to sync', gist: 'Git will carry these once you commit and push. Run /sync-config to send them.', hollow: true },
  claudeai: { label: 'claude.ai', gist: 'Your claude.ai account sends these to the app. Git has no part in it.', hollow: false },
  plugin: { label: 'Plugin install', gist: 'Installed from a marketplace here. Other machines install their own.', hollow: false },
  local: { label: 'This machine only', gist: 'Git ignores these and nothing else syncs them. A new machine will not have them.', hollow: false },
  project: { label: 'Project repo', gist: 'In the project\'s own repo, so anyone who clones it gets these.', hollow: false },
}
const ROUTE_ORDER = ['git', 'pending', 'local', 'claudeai', 'plugin']

// Line icons, drawn here so the page fetches nothing.
const ICONS = {
  sync: '<path d="M4 12a8 8 0 0 1 14-5.3M20 4v4h-4M20 12a8 8 0 0 1-14 5.3M4 20v-4h4"/>',
  skills: '<path d="M12 3.5l2.2 5.3 5.3 2.2-5.3 2.2L12 18.5l-2.2-5.3L4.5 11l5.3-2.2z"/>',
  commands: '<path d="M5 7l5 5-5 5M12 17h7"/>',
  agents: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 13.5v.5M14.5 13.5v.5"/>',
  workflows: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v3a4 4 0 0 0 4 4h6"/>',
  hooks: '<circle cx="12" cy="5" r="2"/><path d="M12 7v7a4 4 0 0 1-8 0v-1.5"/>',
  mods: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/>',
  caret: '<path d="M7 10l5 5 5-5"/>',
  pencil: '<path d="M5 19h3.5L19 8.5 15.5 5 5 15.5z"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',
  file: '<path d="M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>',
  machine: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  upload: '<path d="M12 19V8M7 12l5-5 5 5M5 4h14"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  workspace: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M8 13h8"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  flow: '<rect x="3" y="4" width="7" height="5" rx="1.5"/><rect x="14" y="4" width="7" height="5" rx="1.5"/><rect x="8.5" y="15" width="7" height="5" rx="1.5"/><path d="M6.5 9v2.5h11V9M12 11.5V15"/>',
}
const icon = (name, label) =>
  `<svg class="i" viewBox="0 0 24 24" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${ICONS[name]}</svg>`

const TABS = [
  ['sync', 'Sync'],
  ['flow', 'Ticket flow'],
  ['skills', 'Skills', 'skills', 'skill'],
  ['commands', 'Commands', 'commands'],
  ['agents', 'Agents', 'agents', 'agent'],
  ['workflows', 'Workflows', 'workflows', 'workflow'],
  ['hooks', 'Hooks'],
  ['mods', 'Mods', 'mods', 'mod'],
  ['settings', 'Settings'],
  ['workspace', 'Workspace'],
]

/** The project this session runs in, named by the launcher. Absent, the tab hides. */
const WS = new URLSearchParams(location.search).get('ws') ?? ''
const tabsShown = () => TABS.filter(one => one[0] !== 'workspace' || WS)

/** Tabs that are one page rather than a list and a reader, so the list pane goes. */
const WIDE = ['sync', 'flow']

/** How the Workspace tab groups what it found, in reading order. */
const WS_KINDS = [
  ['instructions', 'Instructions'],
  ['settings', 'Settings'],
  ['skill', 'Skills'],
  ['agent', 'Agents'],
  ['command', 'Commands'],
  ['file', 'Other files'],
]

const SCALARS = {
  theme: ['dark', 'light', 'auto'],
  effortLevel: ['low', 'medium', 'high', 'xhigh', 'max'],
  autoUpdatesChannel: ['latest', 'stable'],
}
const HOOK_EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SubagentStop', 'PreCompact']

const S = {
  tab: 'sync',
  data: null,
  filter: '',
  route: null,
  sel: null,
  file: null,
  isDirty: false,
  settingsMode: 'form',
  shut: read('shut', []),
}

const q = s => document.querySelector(s)
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const plural = (n, one) => n + ' ' + one + (n === 1 ? '' : 's')

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem('dash.' + key)) ?? fallback
  } catch {
    return fallback
  }
}
function keep(key, value) {
  try {
    localStorage.setItem('dash.' + key, JSON.stringify(value))
  } catch {}
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'That did not work (' + res.status + ').')
  return data
}

let toastTimer
function toast(text, isBad) {
  const el = q('#toast')
  el.innerHTML = icon(isBad ? 'alert' : 'check') + '<span>' + esc(text) + '</span>'
  el.className = 'toast' + (isBad ? ' bad' : '')
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), isBad ? 7000 : 3200)
}
const attempt = fn => async (...args) => {
  try {
    return await fn(...args)
  } catch (err) {
    toast(err.message, true)
  }
}

/** A small modal. window.prompt does not exist in every webview, so this does its job. */
function ask({ title, text = '', input, okLabel = 'OK', danger = false }) {
  const dialog = q('#dialog')
  q('#dialog-title').textContent = title
  q('#dialog-text').textContent = text
  q('#dialog-text').hidden = !text
  const field = q('#dialog-input')
  field.hidden = input === undefined
  field.value = input ?? ''
  const ok = q('#dialog-ok')
  ok.textContent = okLabel
  ok.className = danger ? 'danger solid' : 'primary'
  dialog.showModal()
  if (input !== undefined) field.select()
  return new Promise(done => {
    const form = q('#dialog-form')
    const cancel = q('#dialog-cancel')
    const finish = value => {
      form.removeEventListener('submit', onSubmit)
      cancel.removeEventListener('click', onCancel)
      dialog.removeEventListener('cancel', onCancel)
      dialog.close()
      done(value)
    }
    const onSubmit = event => {
      event.preventDefault()
      event.stopPropagation()
      finish(input === undefined ? true : field.value.trim())
    }
    const onCancel = event => {
      event.preventDefault()
      finish(null)
    }
    form.addEventListener('submit', onSubmit)
    cancel.addEventListener('click', onCancel)
    // Escape.
    dialog.addEventListener('cancel', onCancel)
  })
}

async function canLeave() {
  if (!S.isDirty) return true
  const sure = await ask({ title: 'Discard your unsaved changes?', okLabel: 'Discard', danger: true })
  if (sure) setDirty(false)
  return !!sure
}

function setDirty(on) {
  S.isDirty = on
  const el = q('#save-status')
  if (el && on) {
    el.textContent = 'Unsaved changes'
    el.className = 'status dirty'
  }
  const save = q('#save')
  if (save) save.disabled = !on
  q('.files button[aria-current=true]')?.classList.toggle('dirty', on)
}

// ---------- reading

const wsItems = () => S.data.workspace?.items ?? []
const allItems = () => [...Object.values(S.data.items).flat(), ...wsItems()]
const isWs = item => !!item?.id?.startsWith('ws:')
const itemsOf = tab => {
  if (tab === 'hooks') return S.data.items.hookScripts
  return S.data.items[tab] ?? []
}
const findItem = id => allItems().find(one => one.id === id)

const dot = route => `<i class="dot r-${route}${ROUTES[route]?.hollow ? ' hollow' : ''}" aria-hidden="true"></i>`
const badge = route => `<span class="badge r-${route}">${dot(route)}${esc(ROUTES[route]?.label ?? route)}</span>`

/** Read the disk. Says whether anything changed, so a quiet refresh can leave the page alone. */
async function load() {
  const next = await api('GET', '/api/state')
  if (WS) {
    try {
      next.workspace = await api('GET', '/api/workspace?ws=' + encodeURIComponent(WS))
    } catch (err) {
      next.workspace = { trouble: err.message, items: [] }
    }
  }
  const text = JSON.stringify(next)
  const changed = text !== S.dataText
  S.data = next
  S.dataText = text
  q('#banner').hidden = true
  if (changed) {
    renderTop()
    renderNav()
  }
  return changed
}

// ---------- top and nav

/** Where git stands, as one word of colour and a short sentence. */
function gitState() {
  const { git } = S.data
  if (!git.isRepo) return { tone: 'bad', icon: 'alert', words: git.trouble }
  const bits = []
  if (git.changes.length) bits.push(plural(git.changes.length, 'change') + ' not committed')
  if (git.ahead) bits.push(plural(git.ahead, 'commit') + ' not pushed')
  if (bits.length) return { tone: 'local', icon: 'upload', words: bits.join(', ') }
  if (git.behind) return { tone: 'plugin', icon: 'download', words: git.behind + ' behind GitHub' }
  if (!git.hasUpstream) return { tone: 'local', icon: 'alert', words: 'No GitHub link' }
  return { tone: 'git', icon: 'check', words: 'Level with GitHub' }
}

function renderTop() {
  const { git, machine } = S.data
  q('#machine').innerHTML = icon('machine') + esc(machine)
  const state = gitState()
  const pill = q('#git-pill')
  pill.hidden = false
  pill.className = 'pill r-' + state.tone
  pill.title = 'Open Sync'
  pill.innerHTML = `<i class="dot" aria-hidden="true"></i>${git.branch ? `<b>${esc(git.branch)}</b>` : ''}<span>${esc(state.words)}</span>`
}

function renderNav() {
  q('#nav').innerHTML = tabsShown().map(([tab, label, slot]) => {
    const count = slot ? S.data.items[slot].length : tab === 'hooks' ? S.data.hooks.length + S.data.items.hookScripts.length : tab === 'workspace' ? wsItems().length : ''
    const sep = tab === 'skills' || tab === 'settings' || tab === 'workspace' ? '<div class="sep" role="presentation"></div>' : ''
    return `${sep}<button data-act="tab" data-tab="${tab}" aria-current="${S.tab === tab ? 'page' : 'false'}">${icon(tab)}${label}<span class="count">${count}</span></button>`
  }).join('')
  q('#nav [aria-current=page]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// ---------- lists

// How often a skill gets used, from the logs the skill-usage hook writes.
const usedLabel = item => item.uses ? `used ${item.uses}× · last ${item.lastUsed}` : 'never used'
const usedMeta = item => {
  if (item.kind !== 'skill') return ''
  return item.uses
    ? `<span class="meta used" title="${esc(usedLabel(item))}">${item.uses}×</span>`
    : '<span class="meta" title="Never used">unused</span>'
}

const row = (item, opts = {}) => `
  <button class="item" data-act="open" data-id="${esc(item.id)}" aria-current="${S.sel === item.id}" ${opts.drag ? 'draggable="true"' : ''} title="${esc(ROUTES[item.route]?.label)}">
    ${dot(item.route)}<span class="name">${esc(item.name)}${item.isOn === false ? '<span class="tag">off</span>' : ''}</span>${usedMeta(item)}
    ${item.description ? `<span class="desc">${esc(item.owner ? item.owner + ' · ' : '')}${esc(item.description)}</span>` : item.owner ? `<span class="desc">${esc(item.owner)}</span>` : ''}
  </button>`

const matches = item => {
  if (S.route && item.route !== S.route) return false
  const words = S.filter.toLowerCase().split(/\s+/).filter(Boolean)
  const hay = (item.name + ' ' + item.description + ' ' + item.owner).toLowerCase()
  return words.every(one => hay.includes(one))
}

function listHead(tab) {
  const meta = TABS.find(one => one[0] === tab)
  const present = ROUTE_ORDER.filter(route => itemsOf(tab).some(one => one.route === route))
  const chips = present.length > 1
    ? `<div class="chips" role="group" aria-label="Show only">${present.map(route => `<button class="chip r-${route}" data-act="route" data-route="${route}" aria-pressed="${S.route === route}">${dot(route)}${esc(ROUTES[route].label)}</button>`).join('')}</div>`
    : ''
  const buttons = [
    meta[3] ? `<button data-act="new" data-kind="${meta[3]}">${icon('plus')}New ${meta[3]}</button>` : '',
    tab === 'skills' ? `<button class="ghost" data-act="folder-new">${icon('folder')}New folder</button>` : '',
  ].join('')
  return `<div class="list-head">
    <div class="search">${icon('search')}<input id="filter" type="text" placeholder="Filter ${meta[1].toLowerCase()}" aria-label="Filter ${meta[1].toLowerCase()}" value="${esc(S.filter)}"><kbd>/</kbd></div>
    ${chips}
    ${buttons ? `<div class="row">${buttons}</div>` : ''}
  </div>`
}

function renderList() {
  const el = q('#list')
  const keepScroll = el.scrollTop
  if (S.tab === 'skills') el.innerHTML = listHead('skills') + skillsBody()
  else if (S.tab === 'hooks') el.innerHTML = hooksList()
  else if (S.tab === 'settings') el.innerHTML = settingsList()
  else if (S.tab === 'workspace') el.innerHTML = workspaceList()
  else if (!WIDE.includes(S.tab)) el.innerHTML = listHead(S.tab) + plainBody(S.tab)
  el.scrollTop = keepScroll
}

function plainBody(tab) {
  const all = itemsOf(tab)
  const shown = all.filter(matches)
  const meta = TABS.find(one => one[0] === tab)
  if (!all.length) return `<p class="empty">No ${meta[1].toLowerCase()} yet.${meta[3] ? ' Make one above.' : ''}</p>`
  if (!shown.length) return noMatch()
  return groupByRoute(shown)
}

const noMatch = () => `<p class="empty">Nothing matches${S.filter ? ` “${esc(S.filter)}”` : ''}. <button class="link" data-act="clear-filter"><u>Clear the filter</u></button></p>`

function groupByRoute(items, opts) {
  return ROUTE_ORDER.map(route => {
    const rows = items.filter(one => one.route === route)
    if (!rows.length) return ''
    return `<div class="group r-${route}">${dot(route)}${esc(ROUTES[route].label)}<span class="n">${rows.length}</span></div>${rows.map(one => row(one, opts)).join('')}`
  }).join('')
}

function skillsBody() {
  const all = S.data.items.skills
  const shown = all.filter(matches)
  const isFinding = !!S.filter || !!S.route
  const inFolder = new Set()
  const byId = new Map(all.map(one => [one.id, one]))

  const folders = S.data.folders.map(folder => {
    const members = folder.skills.map(id => byId.get(id)).filter(Boolean)
    members.forEach(one => inFolder.add(one.id))
    const visible = members.filter(matches)
    if (isFinding && !visible.length) return ''
    const isShut = !isFinding && S.shut.includes(folder.name)
    const name = esc(folder.name)
    return `<div class="folder" data-drop="${name}">
        <button class="folder-toggle" data-act="folder-toggle" data-folder="${name}" aria-expanded="${!isShut}">
          ${icon('caret').replace('class="i"', 'class="i caret"')}${name}<span class="n">${members.length}</span>
        </button>
        <span class="tools">
          <button class="ghost icon" data-act="folder-rename" data-folder="${name}" title="Rename" aria-label="Rename the folder ${name}">${icon('pencil')}</button>
          <button class="ghost icon" data-act="folder-delete" data-folder="${name}" title="Delete" aria-label="Delete the folder ${name}">${icon('trash')}</button>
        </span>
      </div>
      ${isShut ? '' : visible.map(one => row(one, { drag: true })).join('') || `<p class="empty drop-hint" data-drop="${name}">Drag skills here, or pick this folder on a skill.</p>`}`
  }).join('')

  const loose = shown.filter(one => !inFolder.has(one.id))
  const body = folders + `<div data-drop="">${groupByRoute(loose, { drag: true })}</div>`
  return shown.length || S.data.folders.length ? body : noMatch()
}

function hooksList() {
  const hookRow = hook => {
    const id = hookId(hook)
    return `<button class="item" data-act="hook" data-id="${esc(id)}" aria-current="${S.sel === id}">
      ${dot(hook.route)}<span class="name">${esc(hook.event)}</span>${hook.matcher ? `<span class="meta used">${esc(hook.matcher)}</span>` : ''}
      <span class="desc mono">${esc(hook.command)}</span></button>`
  }
  const sources = [...new Set(S.data.hooks.map(one => one.source))]
  return `<div class="list-head"><div class="row">
      <button data-act="hook-new">${icon('plus')}New hook</button>
      <button class="ghost" data-act="new" data-kind="hook script">${icon('file')}New script</button>
    </div></div>
    ${sources.map(source => `<div class="group">${esc(source)}<span class="n">${S.data.hooks.filter(one => one.source === source).length}</span></div>${S.data.hooks.filter(one => one.source === source).map(hookRow).join('')}`).join('') || '<p class="empty">No hooks yet.</p>'}
    <div class="group">Scripts in hooks/<span class="n">${S.data.items.hookScripts.length}</span></div>
    ${S.data.items.hookScripts.map(one => row(one)).join('') || '<p class="empty">A hook can run a script kept here, so it syncs with everything else.</p>'}`
}

function settingsList() {
  return S.data.settingsFiles.map(file => `
    <button class="item" data-act="settings-open" data-path="${esc(file.path)}" aria-current="${S.sel === file.path}">
      ${dot(file.route)}<span class="name">${esc(file.path)}</span>
      <span class="desc">${esc(ROUTES[file.route].label)}${file.exists ? '' : ', not made yet'}</span>
    </button>`).join('')
}

function workspaceList() {
  const ws = S.data.workspace ?? { items: [] }
  const head = `<div class="list-head">
    ${ws.path ? `<div class="where" title="${esc(ws.path)}">${icon('folder')}<span class="grow"><b>${esc(ws.name)}</b><span class="mono dim">${esc(ws.path)}</span></span></div>` : ''}
    ${ws.items.length ? `<div class="search">${icon('search')}<input id="filter" type="text" placeholder="Filter this project" aria-label="Filter this project" value="${esc(S.filter)}"><kbd>/</kbd></div>` : ''}
  </div>`
  if (ws.trouble) return head + `<p class="empty">${esc(ws.trouble)}</p>`
  if (ws.isConfigRoot) return head + '<p class="empty">This session runs in your config folder itself, so its files are the ones in the other tabs.</p>'
  if (!ws.items.length) return head + '<p class="empty">Claude finds no files of its own in this project. A CLAUDE.md at the top is the place to start.</p>'
  const shown = ws.items.filter(matches)
  if (!shown.length) return head + noMatch()
  const groups = WS_KINDS.map(([kind, label]) => {
    const rows = shown.filter(one => one.kind === kind)
    if (!rows.length) return ''
    if (kind !== 'file') return `<div class="group">${esc(label)}<span class="n">${rows.length}</span></div>${rows.map(one => row(one)).join('')}`
    // Loose files, one run per folder inside .claude/: hooks, output-styles and the like.
    const subs = [...new Set(rows.map(one => one.group))]
    return subs.map(sub => {
      const mine = rows.filter(one => one.group === sub)
      return `<div class="group">${esc(sub ? label + ' · ' + sub : label)}<span class="n">${mine.length}</span></div>${mine.map(one => row(one)).join('')}`
    }).join('')
  }).join('')
  const cut = ws.isCut ? '<p class="empty">This project is big, so the dashboard stopped looking a few folders down.</p>' : ''
  return head + groups + cut
}

// ---------- the sync view

function renderSync() {
  const { git, items, settingsFiles, config } = S.data
  const groups = [
    ['skills', 'Skills', items.skills],
    ['commands', 'Commands', items.commands],
    ['agents', 'Agents', items.agents],
    ['workflows', 'Workflows', items.workflows],
    ['hooks', 'Hook scripts', items.hookScripts],
    ['mods', 'Mods', items.mods],
  ]
  const total = route => groups.reduce((n, [, , list]) => n + list.filter(one => one.route === route).length, 0) + settingsFiles.filter(one => one.exists && one.route === route).length
  const everything = ROUTE_ORDER.reduce((n, route) => n + total(route), 0)

  const waiting = [
    git.changes.length && plural(git.changes.length, 'change') + ' not committed',
    git.ahead && plural(git.ahead, 'commit') + ' not pushed',
  ].filter(Boolean).join(', ')
  const lede = !git.isRepo
    ? git.trouble
    : waiting
      ? waiting + '.'
      : git.behind
        ? `GitHub has ${plural(git.behind, 'commit')} this machine lacks.`
        : 'Everything git carries is level with GitHub.'
  const next = !git.isRepo
    ? ''
    : waiting
      ? 'Run <code>/sync-config</code> in Claude to send them.'
      : git.behind
        ? 'A new session pulls them.'
        : ''
  const state = gitState()

  // Waiting files count too: a card that says 0 over a list of changes reads as a bug.
  const shownOf = route => total(route) || (route === 'pending' ? git.changes.length : 0)
  const counted = ROUTE_ORDER.filter(route => total(route))
  const bar = counted.map(route => `<i class="r-${route}${ROUTES[route].hollow ? ' hollow' : ''}" style="flex:${total(route)}"></i>`).join('')
  const stats = ROUTE_ORDER.map(route => `<button class="stat r-${route}" data-act="jump" data-to="card-${route}" ${shownOf(route) ? '' : 'data-none'}>
      <span class="stat-n">${shownOf(route)}</span><span class="stat-label">${dot(route)}${esc(ROUTES[route].label)}</span></button>`).join('')

  // An owner is worth naming only when it adds something the card title lacks.
  const ownerOf = (one, route) => one.owner && route !== 'git' && one.owner.toLowerCase() !== ROUTES[route].label.toLowerCase() ? one.owner : ''
  const tagOf = (tab, one) => `<button class="link" data-act="goto" data-tab="${tab}" data-id="${esc(one.id)}">${esc(one.name)}</button>`

  const card = route => {
    const shown = shownOf(route)
    const lists = groups.map(([tab, label, list]) => {
      const rows = list.filter(one => one.route === route)
      if (!rows.length) return ''
      // One run of tags per owner, so a plugin's name is said once rather than on every tag.
      const owners = [...new Set(rows.map(one => ownerOf(one, route)))]
      return owners.map(owner => `<div class="kind">${label}${owner ? `<span class="owner"> · ${esc(owner)}</span>` : ''}</div>
        <div class="tags">${rows.filter(one => ownerOf(one, route) === owner).map(one => tagOf(tab, one)).join('')}</div>`).join('')
    }).join('')
    const files = settingsFiles.filter(one => one.route === route && one.exists)
    const fileList = files.length ? `<div class="kind">Settings</div><div class="tags">${files.map(one => `<button class="link" data-act="goto" data-tab="settings" data-id="${esc(one.path)}">${esc(one.path)}</button>`).join('')}</div>` : ''
    const held = route === 'pending' && git.changes.length
      ? `<div class="kind">Files changed · ${git.changes.length}</div><div class="changes">${git.changes.slice(0, 40).map(one => `<div><span class="code">${esc(one.code === '??' ? 'new' : one.code.trim())}</span><span>${esc(one.path)}</span></div>`).join('')}${git.changes.length > 40 ? `<div class="dim">and ${git.changes.length - 40} more</div>` : ''}</div>`
      : ''
    if (!shown) return `<div class="card quiet r-${route}" id="card-${route}">
      <h3>${dot(route)}${esc(ROUTES[route].label)}<span class="n">0</span></h3>
      <p class="note">${esc(ROUTES[route].gist)}</p></div>`
    return `<div class="card r-${route}" id="card-${route}">
      <h3>${dot(route)}${esc(ROUTES[route].label)}<span class="n">${shown}</span></h3>
      <p class="note">${esc(ROUTES[route].gist)}</p>
      ${lists}${fileList}${held}
    </div>`
  }
  // Empty routes go last: they explain a route without pushing real ones down.
  const order = [...ROUTE_ORDER.filter(shownOf), ...ROUTE_ORDER.filter(route => !shownOf(route))]

  const synced = config.filter(one => one.trackedCount)
  const kept = config.filter(one => !one.trackedCount)
  const tableOf = rows => `<table>
      <thead><tr><th scope="col">Name</th><th scope="col">What it is</th><th scope="col">Sync</th></tr></thead>
      <tbody>${rows.map(one => `<tr>
        <td>${esc(one.name)}${one.isDir ? '/' : ''}</td>
        <td class="dim">${esc(one.note) || '<span class="faint">—</span>'}</td>
        <td>${one.trackedCount ? `<span class="badge r-git">${dot('git')}${one.trackedCount} in git</span>` : '<span class="faint small">this machine</span>'}</td>
      </tr>`).join('')}</tbody>
    </table>`

  const repo = repoLink(git.remote)
  q('#detail').innerHTML = `<div class="page">
    <div class="hero">
      <div class="hero-top r-${state.tone}">
        <span class="hero-icon">${icon(state.icon)}</span>
        <div class="grow">
          <p class="lede">${esc(lede)}${next ? ` <span class="dim">${next}</span>` : ''}</p>
          ${git.lastCommit ? `<p class="lede-sub">Last commit: ${esc(git.lastCommit)}${repo ? ` · ${repo}` : ''}</p>` : ''}
        </div>
        <button class="outline" data-act="fetch">${icon('sync')}Check GitHub</button>
      </div>
      <div class="bar" role="img" aria-label="${everything} items by how they sync: ${counted.map(route => ROUTES[route].label + ' ' + total(route)).join(', ')}">${bar}</div>
      <div class="stats" aria-label="Jump to a route">${stats}</div>
    </div>
    <div class="routes">${order.map(card).join('')}</div>
    <div class="card table-card">
      <div class="card-head"><h3>Everything else in this folder</h3>
      <p class="note">Git holds only what the allow list names. The rest stays on this machine, on purpose.</p></div>
      ${synced.length ? tableOf(synced) : ''}
      ${kept.length ? `<details class="more"><summary>${icon('caret')}${plural(kept.length, 'thing')} stay on this machine</summary>${tableOf(kept)}</details>` : ''}
    </div>
  </div>`
}

// ---------- the ticket workflow picture

/** The picture, read once per page. Empty string means the file is not there. */
let flowSvg = null

/** Skills and commands the picture names, as links to their own tab. */
function flowNames() {
  const words = flowSvg.replace(/<[^>]*>/g, ' ')
  const said = new Set((words.match(/\/[a-z][a-z0-9-]{2,}/g) ?? []).map(one => one.slice(1)))
  const hits = []
  for (const [tab, list] of [['skills', S.data.items.skills], ['commands', S.data.items.commands]]) {
    for (const one of list) {
      if (said.has(one.name) && !hits.some(hit => hit.name === one.name)) hits.push({ ...one, tab })
    }
  }
  return hits.sort((a, b) => a.name.localeCompare(b.name))
}

async function renderFlow() {
  const el = q('#detail')
  if (flowSvg === null) {
    el.innerHTML = '<div class="loading">Reading the picture…</div>'
    flowSvg = await fetch('/workflow.svg').then(res => (res.ok ? res.text() : '')).catch(() => '')
  }
  // The tab may have changed while that was in flight.
  if (S.tab !== 'flow') return

  if (!flowSvg) {
    el.innerHTML = `<div class="page"><div class="card">
      <h3>No picture to show</h3>
      <p class="note">The dashboard looks for <code>docs/workflow.svg</code> in this config folder and found nothing. A sync brings it back.</p>
    </div></div>`
    return
  }

  const named = flowNames()
  const links = named.length
    ? `<div class="kind">Named in the picture</div>
       <div class="tags">${named.map(one => `<button class="link" data-act="goto" data-tab="${one.tab}" data-id="${esc(one.id)}">${esc(one.name)}</button>`).join('')}</div>`
    : ''

  el.innerHTML = `<div class="page">
    <div class="card flow-card">
      <div class="card-head">
        <div class="grow">
          <h3>How a ticket moves</h3>
          <p class="note">Four ways in, one way through: an idea becomes a ticket, a plan routes it, and a merge closes it. The skills it names are a click away.</p>
        </div>
        <a class="btn" href="/workflow.svg" target="_blank" rel="noopener noreferrer">${icon('file')}Full size</a>
      </div>
      <figure class="flow-figure">
        <img src="/workflow.svg" alt="The ticket workflow: four ways in create tickets in To Plan; /plan-ticket routes each down a lane to To Do; /implement builds it; /review and a pull request move it to In Review; merging moves it to Done. The tracker skill sits under all of it.">
      </figure>
      ${links}
      <p class="note dim">The picture lives at <code>docs/workflow.svg</code>, hand-written and synced with the rest of this folder.</p>
    </div>
  </div>`
}

/** The GitHub address as a short link, or the raw remote when it is not GitHub. */
function repoLink(remote) {
  if (!remote) return ''
  const hit = /github\.com[:/](.+?)(?:\.git)?\/?$/.exec(remote)
  if (!hit) return esc(remote)
  return `<a href="https://github.com/${esc(hit[1])}" target="_blank" rel="noopener noreferrer">${esc(hit[1])}</a>`
}

// ---------- item detail

function itemHead(item) {
  const actions = []
  if (item.kind === 'skill' && !isWs(item)) {
    const current = S.data.folders.find(one => one.skills.includes(item.id))?.name ?? ''
    actions.push(`<label>${icon('folder')}<span class="sr">Folder</span>
      <select id="folder-pick" data-id="${esc(item.id)}" aria-label="Folder">
        <option value="">No folder</option>
        ${S.data.folders.map(one => `<option ${one.name === current ? 'selected' : ''}>${esc(one.name)}</option>`).join('')}
      </select></label>`)
    if (['local', 'claudeai', 'plugin'].includes(item.route)) {
      actions.push(`<button data-act="track" data-id="${esc(item.id)}">${icon('plus')}${item.isEditable ? 'Add to repo' : 'Copy into repo'}</button>`)
    }
  }
  if (item.kind === 'mod') {
    actions.push(`<label class="switch"><input type="checkbox" id="mod-on" data-name="${esc(item.name)}" ${item.isOn ? 'checked' : ''}>On for new sessions</label>`)
  }
  const del = item.isEditable && !isWs(item)
    ? `<span class="grow"></span><button class="danger" data-act="delete" data-path="${esc(item.path)}" data-name="${esc(item.name)}">${icon('trash')}Delete</button>`
    : ''
  const facts = [`<span>${icon('file')}<span class="mono">${esc(item.path)}</span></span>`]
  if (item.isLink) facts.push(`<span>${icon('lock')}A link to another file, so read only here</span>`)
  if (item.kind === 'skill') facts.push(`<span>${icon('clock')}${esc(usedLabel(item))}${S.data.usageSince ? ', counting since ' + esc(S.data.usageSince) : ''}</span>`)
  return `<div class="head">
    <button class="ghost back" data-act="back">Back</button>
    <div class="title"><h2>${esc(item.name)}</h2>${badge(item.route)}${item.isOn === false ? '<span class="tag">off</span>' : ''}</div>
    ${item.description ? `<p class="about">${esc(item.description)}</p>` : ''}
    <p class="note">${esc(item.note)}</p>
    <div class="facts">${facts.join('')}</div>
    ${actions.length || del ? `<div class="toolbar">${actions.join('')}${del}</div>` : ''}
  </div>`
}

function filesBar(item) {
  const canAdd = item.isEditable && !isWs(item)
  if (item.files.length < 2 && !(canAdd && item.files[0] !== item.path)) return ''
  const label = file => (file.startsWith(item.path + '/') ? file.slice(item.path.length + 1) : file)
  return `<div class="files" role="group" aria-label="Files">
    ${item.files.map(file => `<button data-act="file" data-path="${esc(file)}" aria-current="${S.file?.path === file}">${esc(label(file))}</button>`).join('')}
    ${canAdd ? `<button class="ghost" data-act="file-new" data-dir="${esc(item.path)}">${icon('plus')}New file</button>` : ''}
  </div>`
}

function editorHtml() {
  const file = S.file
  if (!file) return '<div class="editor" aria-busy="true"><div class="editor-bar"></div><div class="skeleton"><i></i><i></i><i></i><i></i><i></i></div></div>'
  if (file.trouble) return `<div class="callout r-bad" role="alert">${icon('alert')}<span>${esc(file.trouble)}</span></div>`
  if (file.isBinary) return `<div class="callout">${icon('file')}<span>This is not a text file, so it cannot be opened here.</span></div>`
  return `<div class="editor">
    <div class="editor-bar">
      <span class="lines-count grow">${plural(file.text.split('\n').length, 'line')}</span>
      <span class="status" id="save-status" aria-live="polite">${file.isEditable ? '' : icon('lock') + 'Read only'}</span>
      ${file.isEditable ? '<button class="primary" id="save" data-act="save" disabled title="Ctrl or Cmd + S">Save</button>' : ''}
    </div>
    <textarea id="text" spellcheck="false" aria-label="File text" ${file.isEditable ? '' : 'readonly'}>${esc(file.text)}</textarea>
  </div>`
}

async function fetchFile(path) {
  try {
    const ws = S.tab === 'workspace' ? '&ws=' + encodeURIComponent(WS) : ''
    return await api('GET', '/api/file?path=' + encodeURIComponent(path) + ws)
  } catch (err) {
    return { path, trouble: err.message }
  }
}
async function loadFile(path) {
  S.file = await fetchFile(path)
}

/** On a phone the list hides when something opens, so focus must follow to the detail. */
function focusDetail() {
  if (!matchMedia('(max-width: 820px)').matches) return
  const title = q('#detail h2')
  if (!title) return
  title.tabIndex = -1
  title.focus({ preventScroll: true })
}

function renderItem() {
  const item = findItem(S.sel)
  if (!item) return (q('#detail').innerHTML = blank())
  q('#detail').innerHTML = itemHead(item) + filesBar(item) + editorHtml()
}

/** The detail pane before anything is picked: what this tab holds, and how to get around. */
function blank() {
  const meta = TABS.find(one => one[0] === S.tab) ?? TABS[0]
  if (S.tab === 'workspace') {
    const ws = S.data.workspace ?? {}
    const n = wsItems().length
    return `<div class="blank">
      <span class="glyph">${icon('workspace')}</span>
      <h3>${esc(ws.name || 'This project')}</h3>
      <p>${n ? `${plural(n, 'thing')} Claude reads when a session runs here, on top of your global ones. Open one to read or edit it.` : 'What Claude reads when a session runs in this project shows here.'}</p>
    </div>`
  }
  const word = { hooks: 'hook', settings: 'settings file', commands: 'command' }[S.tab] ?? meta[3] ?? meta[1].toLowerCase()
  const count = meta[2] ? S.data.items[meta[2]].length : S.tab === 'hooks' ? S.data.hooks.length : S.data.settingsFiles.length
  const inGit = meta[2] ? S.data.items[meta[2]].filter(one => one.route === 'git').length : null
  const what = {
    skills: 'Open one to read or edit it, or drag it into a folder.',
    hooks: 'A hook runs a command when something happens in Claude.',
    settings: 'Settings files open as a form. Switch to Raw for the whole file.',
  }[S.tab] ?? 'Open one to read or edit it.'
  return `<div class="blank">
    <span class="glyph">${icon(meta[0])}</span>
    <h3>Pick a ${esc(word)}</h3>
    <p>${count ? `${plural(count, word.split(' ').pop())} here${inGit !== null ? `, ${inGit} in git` : ''}. ` : ''}${what}</p>
    ${meta[2] ? '<p class="keys"><span><kbd>/</kbd> filter</span><span><kbd>↑</kbd> <kbd>↓</kbd> move</span></p>' : ''}
  </div>`
}

// ---------- hooks

const hookId = hook => [hook.source, hook.event, hook.groupAt, hook.hookAt].join('|')

function renderHook() {
  if (S.sel === 'new-hook') {
    q('#detail').innerHTML = `<div class="head"><button class="ghost back" data-act="back">Back</button>
      <div class="title"><h2>New hook</h2></div>
      <p class="note">A hook runs a command when something happens in Claude. In settings.json it follows you to every machine, so keep the command portable.</p></div>
      <form class="form plain" id="hook-form">${hookFields({ event: 'PostToolUse', matcher: '', command: '' })}
      <div class="field"><label for="h-file">Save in</label><select id="h-file">
        <option value="settings.json">settings.json (synced by git)</option>
        <option value="settings.local.json">settings.local.json (this machine only)</option>
      </select></div>
      <div class="actions"><button class="primary" type="submit">Add hook</button></div></form>`
    return
  }
  const hook = S.data.hooks.find(one => hookId(one) === S.sel)
  if (!hook) return (q('#detail').innerHTML = blank())
  q('#detail').innerHTML = `<div class="head"><button class="ghost back" data-act="back">Back</button>
    <div class="title"><h2>${esc(hook.event)}</h2>${badge(hook.route)}</div>
    <div class="facts"><span>${icon('file')}<span class="mono">${esc(hook.source)}</span></span></div></div>
    <form class="form plain" id="hook-form" data-id="${esc(S.sel)}">
      ${hook.isEditable ? hookFields(hook) : `<p class="note">This hook belongs to the ${esc(hook.source)} plugin, so it is read only here.</p><pre class="mono">${esc(hook.command)}</pre>`}
      ${hook.isEditable ? `<div class="actions"><button class="primary" type="submit">Save</button><span class="grow"></span><button class="danger" type="button" data-act="hook-delete">${icon('trash')}Delete</button></div>` : ''}
    </form>`
}

const hookFields = hook => `
  <datalist id="events">${HOOK_EVENTS.map(one => `<option value="${one}">`).join('')}</datalist>
  <div class="field"><label for="h-event">When</label><input id="h-event" list="events" required value="${esc(hook.event)}"></div>
  <div class="field"><label for="h-matcher">Only for tools</label><input id="h-matcher" placeholder="Empty means all, or Bash, or Edit|Write" value="${esc(hook.matcher)}"></div>
  <div class="field tall"><label for="h-command">Run</label><textarea id="h-command" required>${esc(hook.command)}</textarea></div>`

/** Read a settings file, change it, write it back. */
async function changeJson(path, fn) {
  let file
  try {
    file = await api('GET', '/api/file?path=' + encodeURIComponent(path))
  } catch {
    file = { text: '{}' }
  }
  const value = JSON.parse(file.text || '{}')
  fn(value)
  await api('PUT', '/api/file', { path, text: JSON.stringify(value, null, 2) + '\n', mtimeMs: file.mtimeMs })
}

async function addHook(path, event, matcher, command) {
  await changeJson(path, value => {
    value.hooks ??= {}
    value.hooks[event] ??= []
    const group = { hooks: [{ type: 'command', command }] }
    if (matcher) group.matcher = matcher
    value.hooks[event].push(group)
  })
}

function dropHook(value, hook) {
  const groups = value.hooks?.[hook.event]
  if (!groups?.[hook.groupAt]?.hooks?.[hook.hookAt]) throw new Error('That hook moved. Refresh and try again.')
  groups[hook.groupAt].hooks.splice(hook.hookAt, 1)
  if (!groups[hook.groupAt].hooks.length) groups.splice(hook.groupAt, 1)
  if (!groups.length) delete value.hooks[hook.event]
  if (!Object.keys(value.hooks).length) delete value.hooks
}

// ---------- settings

const emptyLeft = (value, key) => {
  if (value[key] && !Object.keys(value[key]).length) delete value[key]
}

async function renderSettings() {
  const meta = S.data.settingsFiles.find(one => one.path === S.sel)
  if (!meta) return (q('#detail').innerHTML = blank())
  const want = S.sel
  const file = await fetchFile(want)
  // Another file was picked while this one loaded.
  if (S.sel !== want) return
  S.file = file
  if (S.file?.trouble) S.file = { path: S.sel, text: S.sel.endsWith('.json') ? '{\n}\n' : '', isEditable: true, isBinary: false }
  const isJson = S.sel.endsWith('.json')
  const head = `<div class="head"><button class="ghost back" data-act="back">Back</button>
    <div class="title"><h2>${esc(S.sel)}</h2>${badge(meta.route)}<span class="grow"></span>
    ${isJson ? `<div class="seg" role="group" aria-label="View as"><button data-act="settings-mode" data-mode="form" aria-pressed="${S.settingsMode === 'form'}">Form</button><button data-act="settings-mode" data-mode="raw" aria-pressed="${S.settingsMode === 'raw'}">Raw</button></div>` : ''}</div>
    <p class="note">${esc(meta.note)}</p></div>`
  if (!isJson || S.settingsMode === 'raw') {
    q('#detail').innerHTML = head + editorHtml()
    return
  }
  let value
  try {
    value = JSON.parse(S.file.text || '{}')
  } catch (err) {
    S.settingsMode = 'raw'
    q('#detail').innerHTML = head + `<div class="callout r-bad" role="alert">${icon('alert')}<span>This file has a JSON error, so it opens as text: ${esc(err.message)}</span></div>` + editorHtml()
    return
  }
  q('#detail').innerHTML = head + settingsForm(value)
}

/** effortLevel → Effort level. The real key stays on show under it. */
const human = key => {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
const keyLabel = (key, forId) => `<label${forId ? ` for="${forId}"` : ''}><span>${esc(human(key))}</span><span class="key">${esc(key)}</span></label>`

function settingsForm(value) {
  const scalars = Object.entries(value).filter(([, one]) => typeof one !== 'object' || one === null)
  const field = ([key, one]) => {
    const id = 'set-' + key
    let control
    if (typeof one === 'boolean') control = `<label class="switch"><input type="checkbox" id="${id}" data-set="${esc(key)}" aria-label="${esc(human(key))}" ${one ? 'checked' : ''}>${one ? 'On' : 'Off'}</label>`
    else if (SCALARS[key]) {
      const options = SCALARS[key].includes(one) ? SCALARS[key] : [one, ...SCALARS[key]]
      control = `<select id="${id}" data-set="${esc(key)}">${options.map(opt => `<option ${opt === one ? 'selected' : ''}>${esc(opt)}</option>`).join('')}</select>`
    } else control = `<input id="${id}" type="text" data-set="${esc(key)}" data-number="${typeof one === 'number'}" value="${esc(one)}">`
    return `<div class="field">${keyLabel(key, typeof one === 'boolean' ? '' : id)}${control}</div>`
  }
  const list = (key, items) => `<div class="field tall"><div class="label"><span>${esc(human(key))}${items?.length ? ` <span class="dim">· ${items.length}</span>` : ''}</span><span class="key">${esc(key)}</span></div><div class="lines">
      ${(items ?? []).map((one, at) => `<div class="line"><span>${esc(one)}</span><button class="ghost icon" data-act="list-drop" data-key="${key}" data-at="${at}" title="Remove" aria-label="Remove ${esc(one)}">${icon('x')}</button></div>`).join('')}
      <div class="adder"><input type="text" data-list-input="${key}" placeholder="Add a rule, then Enter" aria-label="Add to ${esc(key)}"><button data-act="list-add" data-key="${key}">Add</button></div>
    </div></div>`
  const envRows = Object.entries(value.env ?? {}).map(([key, one]) => `<div class="field"><label for="env-${esc(key)}" class="mono">${esc(key)}</label>
      <div class="adder"><input id="env-${esc(key)}" type="text" data-env="${esc(key)}" value="${esc(one)}"><button class="ghost icon" data-act="env-drop" data-key="${esc(key)}" title="Remove" aria-label="Remove ${esc(key)}">${icon('x')}</button></div></div>`).join('')
  const others = Object.keys(value).filter(key => typeof value[key] === 'object' && value[key] !== null && !['permissions', 'env', 'hooks'].includes(key))
  const p = value.permissions ?? {}
  return `<div class="form">
    <section><h3>General<span class="n">${scalars.length}</span></h3>${scalars.map(field).join('') || '<p class="note">Nothing set. Use Raw to add a setting.</p>'}</section>
    <section><h3>Permissions</h3>
      ${list('allow', p.allow)}
      ${p.ask?.length ? list('ask', p.ask) : ''}
      ${list('deny', p.deny)}
      ${list('additionalDirectories', p.additionalDirectories)}
    </section>
    <section><h3>Environment<span class="n">${Object.keys(value.env ?? {}).length}</span></h3>${envRows || '<p class="note">No variables set.</p>'}
      <div class="field"><div class="label"><span>Add a variable</span></div><div class="adder"><input id="env-key" type="text" placeholder="NAME" aria-label="Variable name"><input id="env-value" type="text" placeholder="value" aria-label="Variable value"><button data-act="env-add">Add</button></div></div>
    </section>
    ${value.hooks ? `<p class="note">Hooks have their own section. <button class="link" data-act="tab" data-tab="hooks"><u>Open Hooks</u></button></p>` : ''}
    ${others.length ? `<p class="note">Also set: ${others.map(esc).join(', ')}. Use Raw to change those.</p>` : ''}
  </div>`
}

async function changeSetting(fn) {
  await changeJson(S.sel, fn)
  await load()
  await renderSettings()
  toast('Saved. New sessions pick this up.')
}

// ---------- folders

async function saveFolders(next) {
  const { folders } = await api('POST', '/api/folders', { folders: next })
  S.data.folders = folders
  renderList()
}

const withoutSkill = id => S.data.folders.map(one => ({ ...one, skills: one.skills.filter(other => other !== id) }))

async function moveSkill(id, name) {
  const next = withoutSkill(id)
  if (name) next.find(one => one.name === name)?.skills.push(id)
  await saveFolders(next)
}

// ---------- mods

const pathList = text => String(text ?? '').split(/;|(?<=.{2}):/).map(one => one.trim()).filter(Boolean)

/**
 * On and off is where a mod's folder sits: the loader skips a dot-named one.
 * A list of one path per mod cannot be written portably -- the separator
 * differs per machine and settings.json syncs -- so one path names the folder
 * that holds them all, and the folder names carry the choice.
 */
async function setModOn(name, on) {
  if (on) {
    const settings = JSON.parse((await api('GET', '/api/file?path=settings.json')).text || '{}')
    const named = pathList(settings.env?.CLAUDE_CODE_PLUGIN_DIRS).map(one => one.replace(/\\/g, '/').replace(/\/+$/, ''))
    if (!named.some(one => one.endsWith('/mods'))) {
      await changeJson('settings.json', value => {
        value.env ??= {}
        value.env.CLAUDE_CODE_PLUGIN_DIRS = '~/.claude/mods'
      })
    }
  }
  await api('POST', '/api/mod-on', { name, on })
  toast((on ? 'On' : 'Off') + ' for new sessions.')
  return true
}

// ---------- moving around

function layout() {
  const shell = q('#shell')
  shell.classList.toggle('wide', WIDE.includes(S.tab))
  shell.classList.toggle('open', !!S.sel)
}

async function showTab(tab, id) {
  if (!(await canLeave())) return
  if (S.tab !== tab) {
    S.filter = ''
    S.route = null
  }
  S.tab = tab
  S.sel = id ?? null
  S.file = null
  location.hash = tab
  document.title = (TABS.find(one => one[0] === tab)?.[1] ?? 'Sync') + ' · Claude Config'
  layout()
  renderNav()
  if (tab === 'sync') return renderSync()
  if (tab === 'flow') return renderFlow()
  renderList()
  if (id && tab === 'settings') return renderSettings()
  if (id) {
    const item = findItem(id)
    if (item) await loadFile(item.main || item.files[0])
    return renderItem()
  }
  q('#detail').innerHTML = blank()
}

async function afterChange(id) {
  await load()
  await showTab(S.tab, id)
}

// ---------- what buttons do

const ACT = {
  tab: ({ tab }) => showTab(tab),
  goto: ({ tab, id }) => showTab(tab, id),
  refresh: async () => {
    if (!(await canLeave())) return
    flowSvg = null
    await load()
    await showTab(S.tab, S.sel)
    toast('Read the disk again.')
  },
  back: async () => {
    if (!(await canLeave())) return
    const was = S.sel
    S.sel = null
    S.file = null
    layout()
    renderList()
    q('#detail').innerHTML = blank()
    // Land back on the row you came from.
    ;[...document.querySelectorAll('#list [data-id]')].find(one => one.dataset.id === was)?.focus()
  },
  jump: ({ to }) => {
    const el = document.getElementById(to)
    if (!el) return
    el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    el.classList.remove('flash')
    void el.offsetWidth
    el.classList.add('flash')
  },
  route: ({ route }) => {
    S.route = S.route === route ? null : route
    renderList()
  },
  'clear-filter': () => {
    S.filter = ''
    S.route = null
    renderList()
    q('#filter')?.focus()
  },
  open: async ({ id }) => {
    if (S.sel === id || !(await canLeave())) return
    // Show the pick at once; the file follows when it arrives.
    S.sel = id
    S.file = null
    layout()
    renderList()
    renderItem()
    const item = findItem(id)
    const file = await fetchFile(item.main || item.files[0])
    if (S.sel !== id) return
    S.file = file
    renderItem()
    focusDetail()
  },
  file: async ({ path }) => {
    if (S.file?.path === path || !(await canLeave())) return
    await loadFile(path)
    renderItem()
  },
  save: async () => {
    const text = q('#text').value
    const ws = S.tab === 'workspace' ? WS : undefined
    const saved = await api('PUT', '/api/file', { path: S.file.path, text, mtimeMs: S.file.mtimeMs, ws })
    S.file = { ...S.file, text, mtimeMs: saved.mtimeMs }
    setDirty(false)
    const status = q('#save-status')
    status.innerHTML = icon('check') + 'Saved'
    status.className = 'status ok'
    await load()
    renderList()
    if (S.tab !== 'settings') {
      const item = findItem(S.sel)
      if (item) q('.head').outerHTML = itemHead(item)
    }
  },
  new: async ({ kind }) => {
    const name = await ask({ title: 'New ' + kind, text: 'A short name, with dashes instead of spaces.', input: '', okLabel: 'Make it' })
    if (!name) return
    await api('POST', '/api/new', { kind, name })
    await load()
    const tab = S.tab
    const item = allItems().find(one => one.kind === kind && one.name === name)
    await showTab(tab, item?.id)
    toast('Made. It syncs once you commit and push.')
  },
  'file-new': async ({ dir }) => {
    const name = await ask({ title: 'New file', text: 'Its name inside ' + dir + '.', input: '', okLabel: 'Make it' })
    if (!name) return
    const made = await api('POST', '/api/new-file', { dir, name })
    await load()
    await loadFile(made.path)
    renderItem()
  },
  delete: async ({ path, name }) => {
    const sure = await ask({ title: 'Delete ' + name + '?', text: 'A copy goes to backups/dashboard-trash, on this machine only.', okLabel: 'Delete', danger: true })
    if (!sure) return
    setDirty(false)
    const done = await api('POST', '/api/delete', { path })
    const item = findItem(S.sel)
    if (item?.kind === 'skill') await api('POST', '/api/folders', { folders: withoutSkill(item.id) })
    await afterChange()
    toast('Deleted. Copy kept in ' + done.kept)
  },
  track: async ({ id }) => {
    const done = await api('POST', '/api/track', { id })
    await load()
    const item = allItems().find(one => one.path === done.path)
    await showTab('skills', item?.id ?? id)
    toast(done.text)
  },
  fetch: async () => {
    const done = await api('POST', '/api/fetch', {})
    await load()
    if (S.tab === 'sync') renderSync()
    toast(done.trouble || 'Checked GitHub.', !!done.trouble)
  },
  'folder-new': async () => {
    const name = await ask({ title: 'New folder', text: 'Folders here are labels. The skill stays where it is on disk, because Claude only finds skills directly under skills/.', input: '', okLabel: 'Make it' })
    if (name) await saveFolders([...S.data.folders, { name, skills: [] }])
  },
  'folder-toggle': ({ folder }) => {
    S.shut = S.shut.includes(folder) ? S.shut.filter(one => one !== folder) : [...S.shut, folder]
    keep('shut', S.shut)
    renderList()
  },
  'folder-rename': async ({ folder }) => {
    const name = await ask({ title: 'Rename folder', input: folder, okLabel: 'Rename' })
    if (name && name !== folder) await saveFolders(S.data.folders.map(one => (one.name === folder ? { ...one, name } : one)))
  },
  'folder-delete': async ({ folder }) => {
    const sure = await ask({ title: 'Delete the folder ' + folder + '?', text: 'Only the folder goes. Its skills stay.', okLabel: 'Delete folder', danger: true })
    if (sure) await saveFolders(S.data.folders.filter(one => one.name !== folder))
  },
  hook: async ({ id }) => {
    S.sel = id
    layout()
    renderList()
    renderHook()
  },
  'hook-new': () => {
    S.sel = 'new-hook'
    layout()
    renderList()
    renderHook()
  },
  'hook-delete': async () => {
    const hook = S.data.hooks.find(one => hookId(one) === S.sel)
    const sure = await ask({ title: 'Delete this hook?', text: hook.command, okLabel: 'Delete', danger: true })
    if (!sure) return
    await changeJson(hook.source, value => dropHook(value, hook))
    await afterChange()
    toast('Hook deleted.')
  },
  'settings-open': async ({ path }) => {
    if (!(await canLeave())) return
    S.sel = path
    S.file = null
    layout()
    renderList()
    q('#detail').innerHTML = editorHtml()
    await renderSettings()
    focusDetail()
  },
  'settings-mode': async ({ mode }) => {
    if (!(await canLeave())) return
    S.settingsMode = mode
    await renderSettings()
  },
  'list-drop': ({ key, at }) => changeSetting(value => {
    value.permissions[key].splice(Number(at), 1)
    if (!value.permissions[key].length) delete value.permissions[key]
    emptyLeft(value, 'permissions')
  }),
  'list-add': ({ key }) => {
    const line = q(`[data-list-input="${key}"]`).value.trim()
    if (!line) return
    return changeSetting(value => {
      value.permissions ??= {}
      value.permissions[key] ??= []
      value.permissions[key].push(line)
    })
  },
  'env-drop': ({ key }) => changeSetting(value => {
    delete value.env[key]
    emptyLeft(value, 'env')
  }),
  'env-add': () => {
    const key = q('#env-key').value.trim()
    if (!key) return
    const text = q('#env-value').value
    return changeSetting(value => {
      value.env ??= {}
      value.env[key] = text
    })
  },
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-act]')
  if (!target) return
  if (target.tagName === 'BUTTON') event.preventDefault()
  // A button inside a folder header should not also fold it.
  event.stopPropagation()
  const run = attempt(ACT[target.dataset.act])(target.dataset)
  // Anything slower than a blink shows it is working, so a second press is not needed.
  if (target.tagName !== 'BUTTON') return
  const slow = setTimeout(() => target.setAttribute('aria-busy', 'true'), 160)
  run.finally(() => {
    clearTimeout(slow)
    target.removeAttribute('aria-busy')
  })
})

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (S.isDirty) attempt(ACT.save)()
    return
  }
  const el = event.target
  if (el.id === 'text' && event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end')
    setDirty(true)
  }
  if (el.matches?.('[data-list-input]') && event.key === 'Enter') attempt(ACT['list-add'])({ key: el.dataset.listInput })
  if (el.id === 'filter' && event.key === 'Escape' && el.value) {
    event.preventDefault()
    attempt(ACT['clear-filter'])()
  }
  if (el.id === 'filter' && event.key === 'ArrowDown') {
    event.preventDefault()
    q('#list .item')?.focus()
  }
  // Up and down walk the list, like any list should.
  if (el.matches?.('#list .item') && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    event.preventDefault()
    const rows = [...document.querySelectorAll('#list .item')]
    const next = rows[rows.indexOf(el) + (event.key === 'ArrowDown' ? 1 : -1)]
    if (next) next.focus()
    else if (event.key === 'ArrowUp') q('#filter')?.focus()
  }
  // Slash jumps to the filter from anywhere that is not a text box.
  const isTyping = el.matches?.('input, textarea, select, [contenteditable]')
  if (event.key === '/' && !isTyping && !q('#dialog').open && q('#filter')) {
    event.preventDefault()
    q('#filter').focus()
  }
})

document.addEventListener('input', event => {
  const el = event.target
  if (el.id === 'text') setDirty(true)
  if (el.id === 'filter') {
    S.filter = el.value
    const at = el.selectionStart
    renderList()
    const again = q('#filter')
    again.focus()
    again.setSelectionRange(at, at)
  }
})

document.addEventListener('change', attempt(async event => {
  const el = event.target
  if (el.id === 'folder-pick') return moveSkill(el.dataset.id, el.value)
  if (el.id === 'mod-on') {
    const done = await setModOn(el.dataset.name, el.checked)
    await afterChange(S.sel)
    return done
  }
  if (el.dataset.set) {
    const key = el.dataset.set
    const next = el.type === 'checkbox' ? el.checked : el.dataset.number === 'true' ? Number(el.value) : el.value
    return changeSetting(value => (value[key] = next))
  }
  if (el.dataset.env) return changeSetting(value => (value.env[el.dataset.env] = el.value))
}))

document.addEventListener('submit', attempt(async event => {
  if (event.target.id !== 'hook-form') return
  event.preventDefault()
  const eventName = q('#h-event').value.trim()
  const matcher = q('#h-matcher').value.trim()
  const command = q('#h-command').value.trim()
  if (S.sel === 'new-hook') {
    await addHook(q('#h-file').value, eventName, matcher, command)
    await afterChange()
    return toast('Hook added. New sessions run it.')
  }
  const hook = S.data.hooks.find(one => hookId(one) === S.sel)
  await changeJson(hook.source, value => {
    const inner = value.hooks?.[hook.event]?.[hook.groupAt]?.hooks?.[hook.hookAt]
    if (!inner) throw new Error('That hook moved. Refresh and try again.')
    if (eventName === hook.event) {
      inner.command = command
      if (matcher) value.hooks[hook.event][hook.groupAt].matcher = matcher
      else delete value.hooks[hook.event][hook.groupAt].matcher
    } else {
      dropHook(value, hook)
      value.hooks ??= {}
      value.hooks[eventName] ??= []
      const group = { hooks: [{ type: 'command', command }] }
      if (matcher) group.matcher = matcher
      value.hooks[eventName].push(group)
    }
  })
  await afterChange()
  toast('Hook saved.')
}))

// Drag a skill onto a folder, or off into the open list to take it out.
document.addEventListener('dragstart', event => {
  const row = event.target.closest?.('.item[data-id]')
  if (row) event.dataTransfer.setData('text/plain', row.dataset.id)
})
document.addEventListener('dragover', event => {
  const drop = event.target.closest?.('[data-drop]')
  if (!drop) return
  event.preventDefault()
  document.querySelectorAll('.drop').forEach(one => one.classList.remove('drop'))
  if (drop.dataset.drop) drop.classList.add('drop')
})
document.addEventListener('drop', attempt(async event => {
  const drop = event.target.closest?.('[data-drop]')
  document.querySelectorAll('.drop').forEach(one => one.classList.remove('drop'))
  if (!drop) return
  event.preventDefault()
  const id = event.dataTransfer.getData('text/plain')
  if (!id) return
  await moveSkill(id, drop.dataset.drop)
  if (S.sel === id) renderItem()
}))

window.addEventListener('beforeunload', event => {
  if (S.isDirty) event.preventDefault()
})

// Pick up changes made elsewhere when you come back, without touching open work.
window.addEventListener('focus', attempt(async () => {
  if (q('#dialog').open) return
  // Redrawing an unchanged list would swallow the click that brought you back.
  if (!(await load())) return
  if (S.tab === 'sync') renderSync()
  else if (!WIDE.includes(S.tab)) renderList()
}))

// A page left open keeps the server awake, and says so if it has gone.
setInterval(() => {
  api('GET', '/api/ping').then(
    () => (q('#banner').hidden = true),
    () => {
      q('#banner').hidden = false
      q('#banner').innerHTML = icon('alert') + '<span>The dashboard server stopped. Press the button in the Claude pane to start it again.</span>'
    },
  )
}, 5 * 60 * 1000)

// Back and forward move between tabs, since each tab has its own address.
window.addEventListener('hashchange', attempt(async () => {
  const tab = location.hash.slice(1)
  if (!S.data || tab === S.tab || !tabsShown().some(one => one[0] === tab)) return
  await showTab(tab)
  // Unsaved work kept us here, so put the address back to match.
  if (S.tab !== tab) history.replaceState(null, '', '#' + S.tab)
}))

attempt(async () => {
  await load()
  const start = location.hash.slice(1)
  await showTab(tabsShown().some(one => one[0] === start) ? start : 'sync')
  // Quietly learn whether GitHub has moved on.
  api('POST', '/api/fetch', {}).then(load).then(() => S.tab === 'sync' && !S.sel && renderSync()).catch(() => {})
})()
