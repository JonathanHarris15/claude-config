// The dashboard page. Plain JS, no build step, nothing fetched from elsewhere.

const ROUTES = {
  git: { label: 'Git', gist: 'In the repo and pushed. Every linked machine gets these.', hollow: false },
  pending: { label: 'Waiting to sync', gist: 'Git will carry these once you commit and push. Run /sync-config to send them.', hollow: true },
  claudeai: { label: 'claude.ai', gist: 'Your claude.ai account sends these to the app. Git has no part in it.', hollow: false },
  plugin: { label: 'Plugin install', gist: 'Installed from a marketplace here. Other machines install their own.', hollow: false },
  local: { label: 'This machine only', gist: 'Git ignores these and nothing else syncs them. A new machine will not have them.', hollow: false },
}
const ROUTE_ORDER = ['git', 'pending', 'local', 'claudeai', 'plugin']

const TABS = [
  ['sync', 'Sync'],
  ['skills', 'Skills', 'skills', 'skill'],
  ['commands', 'Commands', 'commands', 'command'],
  ['agents', 'Agents', 'agents', 'agent'],
  ['workflows', 'Workflows', 'workflows', 'workflow'],
  ['hooks', 'Hooks'],
  ['mods', 'Mods', 'mods', 'mod'],
  ['settings', 'Settings'],
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
  el.textContent = text
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
  ok.style.background = danger ? 'var(--bad)' : ''
  ok.style.borderColor = danger ? 'var(--bad)' : ''
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
    el.textContent = 'Unsaved'
    el.className = 'status dirty'
  }
  const save = q('#save')
  if (save) save.disabled = !on
}

// ---------- reading

const allItems = () => Object.values(S.data.items).flat()
const itemsOf = tab => {
  if (tab === 'hooks') return S.data.items.hookScripts
  return S.data.items[tab] ?? []
}
const findItem = id => allItems().find(one => one.id === id)

const dot = route => `<i class="dot r-${route}${ROUTES[route]?.hollow ? ' hollow' : ''}" aria-hidden="true"></i>`
const badge = route => `<span class="badge r-${route}">${dot(route)}${esc(ROUTES[route]?.label ?? route)}</span>`

async function load() {
  S.data = await api('GET', '/api/state')
  q('#banner').hidden = true
  renderTop()
  renderNav()
}

// ---------- top and nav

function renderTop() {
  const { git, machine } = S.data
  q('#machine').textContent = machine
  const bits = []
  if (!git.isRepo) bits.push(git.trouble)
  else {
    if (git.changes.length) bits.push(plural(git.changes.length, 'change') + ' not committed')
    if (git.ahead) bits.push(plural(git.ahead, 'commit') + ' not pushed')
    if (git.behind) bits.push(git.behind + ' behind GitHub')
    if (!bits.length) bits.push(git.hasUpstream ? 'Level with GitHub' : 'No GitHub link')
  }
  q('#git-pill').textContent = (git.branch ? git.branch + ': ' : '') + bits.join(', ')
}

function renderNav() {
  q('#nav').innerHTML = TABS.map(([tab, label, slot]) => {
    const count = slot ? S.data.items[slot].length : tab === 'hooks' ? S.data.hooks.length + S.data.items.hookScripts.length : ''
    return `<button data-act="tab" data-tab="${tab}" aria-current="${S.tab === tab}">${label}<span class="count">${count}</span></button>`
  }).join('')
}

// ---------- lists

const row = (item, opts = {}) => `
  <button class="item" data-act="open" data-id="${esc(item.id)}" aria-current="${S.sel === item.id}" ${opts.drag ? 'draggable="true"' : ''} title="${esc(ROUTES[item.route]?.label)}">
    ${dot(item.route)}<span class="name">${esc(item.name)}${item.isOn === false ? ' <span class="dim small">off</span>' : ''}</span>
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
    ? `<div class="chips">${present.map(route => `<button class="chip" data-act="route" data-route="${route}" aria-pressed="${S.route === route}">${esc(ROUTES[route].label)}</button>`).join('')}</div>`
    : ''
  return `<div class="list-head">
    <input id="filter" placeholder="Filter ${meta[1].toLowerCase()}" aria-label="Filter" value="${esc(S.filter)}">
    ${chips}
    <div class="row">
      ${meta[3] ? `<button data-act="new" data-kind="${meta[3]}">New ${meta[3]}</button>` : ''}
      ${tab === 'skills' ? '<button class="ghost" data-act="folder-new">New folder</button>' : ''}
    </div>
  </div>`
}

function renderList() {
  const el = q('#list')
  const keepScroll = el.scrollTop
  if (S.tab === 'skills') el.innerHTML = listHead('skills') + skillsBody()
  else if (S.tab === 'hooks') el.innerHTML = hooksList()
  else if (S.tab === 'settings') el.innerHTML = settingsList()
  else if (S.tab !== 'sync') el.innerHTML = listHead(S.tab) + plainBody(S.tab)
  el.scrollTop = keepScroll
}

function plainBody(tab) {
  const all = itemsOf(tab)
  const shown = all.filter(matches)
  if (!all.length) return `<p class="empty">No ${TABS.find(one => one[0] === tab)[1].toLowerCase()} yet. Make one above.</p>`
  if (!shown.length) return '<p class="empty">Nothing matches.</p>'
  return groupByRoute(shown)
}

function groupByRoute(items, opts) {
  return ROUTE_ORDER.map(route => {
    const rows = items.filter(one => one.route === route)
    if (!rows.length) return ''
    return `<div class="group r-${route}">${esc(ROUTES[route].label)} · ${rows.length}</div>${rows.map(one => row(one, opts)).join('')}`
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
    return `<div class="group folder" role="button" tabindex="0" data-act="folder-toggle" data-folder="${esc(folder.name)}" data-drop="${esc(folder.name)}" aria-expanded="${!isShut}">
        <span class="caret">▾</span>${esc(folder.name)} <span class="dim">${members.length}</span>
        <span class="tools">
          <button data-act="folder-rename" data-folder="${esc(folder.name)}">Rename</button>
          <button data-act="folder-delete" data-folder="${esc(folder.name)}">Delete</button>
        </span>
      </div>
      ${isShut ? '' : visible.map(one => row(one, { drag: true })).join('') || '<p class="empty">Drag skills here.</p>'}`
  }).join('')

  const loose = shown.filter(one => !inFolder.has(one.id))
  const body = folders + `<div data-drop="">${groupByRoute(loose, { drag: true })}</div>`
  return shown.length || S.data.folders.length ? body : '<p class="empty">Nothing matches.</p>'
}

function hooksList() {
  const hookRow = hook => {
    const id = hookId(hook)
    return `<button class="item" data-act="hook" data-id="${esc(id)}" aria-current="${S.sel === id}">
      ${dot(hook.route)}<span class="name">${esc(hook.event)}${hook.matcher ? ' <span class="dim small">' + esc(hook.matcher) + '</span>' : ''}</span>
      <span class="desc">${esc(hook.command)}</span></button>`
  }
  const sources = [...new Set(S.data.hooks.map(one => one.source))]
  return `<div class="list-head"><div class="row">
      <button data-act="hook-new">New hook</button>
      <button class="ghost" data-act="new" data-kind="hook script">New script</button>
    </div></div>
    ${sources.map(source => `<div class="group">${esc(source)}</div>${S.data.hooks.filter(one => one.source === source).map(hookRow).join('')}`).join('') || '<p class="empty">No hooks yet.</p>'}
    <div class="group">Scripts in hooks/</div>
    ${S.data.items.hookScripts.map(one => row(one)).join('') || '<p class="empty">A hook can run a script kept here, so it syncs with everything else.</p>'}`
}

function settingsList() {
  return S.data.settingsFiles.map(file => `
    <button class="item" data-act="settings-open" data-path="${esc(file.path)}" aria-current="${S.sel === file.path}">
      ${dot(file.route)}<span class="name">${esc(file.path)}</span>
      <span class="desc">${esc(ROUTES[file.route].label)}${file.exists ? '' : ', not made yet'}</span>
    </button>`).join('')
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
      ? waiting + '. Run /sync-config in Claude to send them.'
      : git.behind
        ? `GitHub has ${plural(git.behind, 'commit')} this machine lacks. A new session pulls them.`
        : 'Everything git carries is level with GitHub.'

  const bar = ROUTE_ORDER.map(route => total(route) ? `<i class="r-${route}${ROUTES[route].hollow ? ' hollow' : ''}" style="flex:${total(route)}" title="${esc(ROUTES[route].label)}: ${total(route)}"></i>` : '').join('')

  const card = route => {
    const n = total(route)
    const lists = groups.map(([tab, label, list]) => {
      const rows = list.filter(one => one.route === route)
      if (!rows.length) return ''
      return `<div class="kind">${label}</div><div class="tags">${rows.map(one => `<button class="link" data-act="goto" data-tab="${tab}" data-id="${esc(one.id)}">${esc(one.owner && route !== 'git' ? one.owner + ':' : '')}${esc(one.name)}</button>`).join('')}</div>`
    }).join('')
    const files = settingsFiles.filter(one => one.route === route && one.exists)
    const fileList = files.length ? `<div class="kind">Settings</div><div class="tags">${files.map(one => `<button class="link" data-act="goto" data-tab="settings" data-id="${esc(one.path)}">${esc(one.path)}</button>`).join('')}</div>` : ''
    const held = route === 'pending' && git.changes.length
      ? `<div class="kind">Files changed</div><div class="lines">${git.changes.slice(0, 40).map(one => `<div class="mono dim">${esc(one.code === '??' ? 'new' : one.code.trim())} ${esc(one.path)}</div>`).join('')}${git.changes.length > 40 ? `<div class="dim small">and ${git.changes.length - 40} more</div>` : ''}</div>`
      : ''
    return `<div class="card r-${route}">
      <h3>${dot(route)}${esc(ROUTES[route].label)}<span class="n">${n}</span></h3>
      <p class="note">${esc(ROUTES[route].gist)}</p>
      ${lists}${fileList}${held}
      ${n === 0 && !held ? '<p class="dim small">Nothing here.</p>' : ''}
    </div>`
  }

  q('#detail').innerHTML = `<div class="page">
    <div class="row"><p class="lede grow">${esc(lede)}</p>
      <button class="ghost" data-act="fetch">Check GitHub</button></div>
    ${git.lastCommit ? `<p class="note">Last commit: ${esc(git.lastCommit)}. ${esc(git.remote)}</p>` : ''}
    <div class="bar" role="img" aria-label="${everything} items by how they sync">${bar}</div>
    <div class="routes">${ROUTE_ORDER.map(card).join('')}</div>
    <div class="card">
      <h3>Everything else in this folder</h3>
      <p class="note">Git holds only what the allow list names. The rest stays on this machine, on purpose.</p>
      <table>${config.map(one => `<tr>
        <td>${esc(one.name)}${one.isDir ? '/' : ''}</td>
        <td class="dim">${esc(one.note)}</td>
        <td class="small" style="white-space:nowrap">${one.trackedCount ? `<span class="badge r-git">${one.trackedCount} in git</span>` : '<span class="dim">not synced</span>'}</td>
      </tr>`).join('')}</table>
    </div>
  </div>`
}

// ---------- item detail

function itemHead(item) {
  const actions = []
  if (item.kind === 'skill') {
    const current = S.data.folders.find(one => one.skills.includes(item.id))?.name ?? ''
    actions.push(`<label class="small dim">Folder
      <select id="folder-pick" data-id="${esc(item.id)}">
        <option value="">None</option>
        ${S.data.folders.map(one => `<option ${one.name === current ? 'selected' : ''}>${esc(one.name)}</option>`).join('')}
      </select></label>`)
    if (['local', 'claudeai', 'plugin'].includes(item.route)) {
      actions.push(`<button data-act="track" data-id="${esc(item.id)}">${item.isEditable ? 'Add to repo' : 'Copy into repo'}</button>`)
    }
  }
  if (item.kind === 'mod') {
    actions.push(`<label class="switch small"><input type="checkbox" id="mod-on" data-name="${esc(item.name)}" ${item.isOn ? 'checked' : ''}> On in settings.json</label>`)
  }
  if (item.isEditable) actions.push(`<button class="danger" data-act="delete" data-path="${esc(item.path)}" data-name="${esc(item.name)}">Delete</button>`)
  return `<div class="head">
    <button class="ghost back" data-act="back">Back</button>
    <div class="row"><h2>${esc(item.name)}</h2>${badge(item.route)}</div>
    <p class="note">${esc(item.note)}</p>
    ${item.description ? `<p>${esc(item.description)}</p>` : ''}
    <p class="mono dim">${esc(item.path)}</p>
    <div class="row">${actions.join('')}</div>
  </div>`
}

function filesBar(item) {
  if (item.files.length < 2 && !(item.isEditable && item.files[0] !== item.path)) return ''
  const label = file => (file.startsWith(item.path + '/') ? file.slice(item.path.length + 1) : file)
  return `<div class="files">
    ${item.files.map(file => `<button data-act="file" data-path="${esc(file)}" aria-current="${S.file?.path === file}">${esc(label(file))}</button>`).join('')}
    ${item.isEditable ? `<button data-act="file-new" data-dir="${esc(item.path)}">+ file</button>` : ''}
  </div>`
}

function editorHtml() {
  const file = S.file
  if (!file) return '<div class="editor"><p class="dim">Pick a file.</p></div>'
  if (file.trouble) return `<div class="editor"><p class="status bad">${esc(file.trouble)}</p></div>`
  if (file.isBinary) return '<div class="editor"><p class="dim">This is not a text file, so it cannot be opened here.</p></div>'
  return `<div class="editor">
    <div class="editor-bar">
      <span class="mono dim grow">${esc(file.path)}</span>
      <span class="status" id="save-status">${file.isEditable ? '' : 'Read only'}</span>
      ${file.isEditable ? '<button class="primary" id="save" data-act="save" disabled title="Ctrl or Cmd + S">Save</button>' : ''}
    </div>
    <textarea id="text" spellcheck="false" aria-label="File text" ${file.isEditable ? '' : 'readonly'}>${esc(file.text)}</textarea>
  </div>`
}

async function loadFile(path) {
  try {
    S.file = await api('GET', '/api/file?path=' + encodeURIComponent(path))
  } catch (err) {
    S.file = { path, trouble: err.message }
  }
}

function renderItem() {
  const item = findItem(S.sel)
  if (!item) return (q('#detail').innerHTML = blank())
  q('#detail').innerHTML = itemHead(item) + filesBar(item) + editorHtml()
}

const blank = () => '<div class="page"><p class="dim">Pick something from the list.</p></div>'

// ---------- hooks

const hookId = hook => [hook.source, hook.event, hook.groupAt, hook.hookAt].join('|')

function renderHook() {
  if (S.sel === 'new-hook') {
    q('#detail').innerHTML = `<div class="head"><button class="ghost back" data-act="back">Back</button><h2>New hook</h2>
      <p class="note">A hook runs a command when something happens in Claude. In settings.json it follows you to every machine, so keep the command portable.</p></div>
      <form class="form" id="hook-form">${hookFields({ event: 'PostToolUse', matcher: '', command: '' })}
      <div class="field"><label for="h-file">save in</label><select id="h-file">
        <option value="settings.json">settings.json (synced by git)</option>
        <option value="settings.local.json">settings.local.json (this machine only)</option>
      </select></div>
      <div class="row"><button class="primary" type="submit">Add hook</button></div></form>`
    return
  }
  const hook = S.data.hooks.find(one => hookId(one) === S.sel)
  if (!hook) return (q('#detail').innerHTML = blank())
  q('#detail').innerHTML = `<div class="head"><button class="ghost back" data-act="back">Back</button>
    <div class="row"><h2>${esc(hook.event)}</h2>${badge(hook.route)}</div>
    <p class="mono dim">${esc(hook.source)}</p></div>
    <form class="form" id="hook-form" data-id="${esc(S.sel)}">
      ${hook.isEditable ? hookFields(hook) : `<p class="note">This hook belongs to the ${esc(hook.source)} plugin, so it is read only here.</p><pre class="mono">${esc(hook.command)}</pre>`}
      ${hook.isEditable ? '<div class="row"><button class="primary" type="submit">Save</button><button class="danger" type="button" data-act="hook-delete">Delete</button></div>' : ''}
    </form>`
}

const hookFields = hook => `
  <datalist id="events">${HOOK_EVENTS.map(one => `<option value="${one}">`).join('')}</datalist>
  <div class="field"><label for="h-event">when</label><input id="h-event" list="events" required value="${esc(hook.event)}"></div>
  <div class="field"><label for="h-matcher">only for tools</label><input id="h-matcher" placeholder="Empty means all, or Bash, or Edit|Write" value="${esc(hook.matcher)}"></div>
  <div class="field"><label for="h-command">run</label><textarea id="h-command" required>${esc(hook.command)}</textarea></div>`

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
  await loadFile(S.sel).catch(() => {})
  if (S.file?.trouble) S.file = { path: S.sel, text: S.sel.endsWith('.json') ? '{\n}\n' : '', isEditable: true, isBinary: false }
  const isJson = S.sel.endsWith('.json')
  const head = `<div class="head"><button class="ghost back" data-act="back">Back</button>
    <div class="row"><h2>${esc(S.sel)}</h2>${badge(meta.route)}<span class="grow"></span>
    ${isJson ? `<div class="row"><button class="chip" data-act="settings-mode" data-mode="form" aria-pressed="${S.settingsMode === 'form'}">Form</button><button class="chip" data-act="settings-mode" data-mode="raw" aria-pressed="${S.settingsMode === 'raw'}">Raw</button></div>` : ''}</div>
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
    q('#detail').innerHTML = head + `<p class="status bad" style="padding:8px 16px 0">This file has a JSON error: ${esc(err.message)}</p>` + editorHtml()
    return
  }
  q('#detail').innerHTML = head + settingsForm(value)
}

function settingsForm(value) {
  const scalars = Object.entries(value).filter(([, one]) => typeof one !== 'object' || one === null)
  const field = ([key, one]) => {
    const id = 'set-' + key
    let control
    if (typeof one === 'boolean') control = `<label class="switch"><input type="checkbox" id="${id}" data-set="${esc(key)}" ${one ? 'checked' : ''}>${one ? 'On' : 'Off'}</label>`
    else if (SCALARS[key]) {
      const options = SCALARS[key].includes(one) ? SCALARS[key] : [one, ...SCALARS[key]]
      control = `<select id="${id}" data-set="${esc(key)}">${options.map(opt => `<option ${opt === one ? 'selected' : ''}>${esc(opt)}</option>`).join('')}</select>`
    } else control = `<input id="${id}" data-set="${esc(key)}" data-number="${typeof one === 'number'}" value="${esc(one)}">`
    return `<div class="field"><label for="${id}">${esc(key)}</label>${control}</div>`
  }
  const list = (label, keyPath, items) => `<div class="field" style="align-items:start"><label>${esc(label)}</label><div class="lines">
      ${(items ?? []).map((one, at) => `<div class="line"><span>${esc(one)}</span><button data-act="list-drop" data-key="${keyPath}" data-at="${at}" aria-label="Remove ${esc(one)}">Remove</button></div>`).join('')}
      <div class="adder"><input data-list-input="${keyPath}" placeholder="Add a line" aria-label="Add to ${esc(label)}"><button data-act="list-add" data-key="${keyPath}">Add</button></div>
    </div></div>`
  const envRows = Object.entries(value.env ?? {}).map(([key, one]) => `<div class="field"><label for="env-${esc(key)}">${esc(key)}</label>
      <div class="adder"><input id="env-${esc(key)}" data-env="${esc(key)}" value="${esc(one)}"><button data-act="env-drop" data-key="${esc(key)}">Remove</button></div></div>`).join('')
  const others = Object.keys(value).filter(key => typeof value[key] === 'object' && value[key] !== null && !['permissions', 'env', 'hooks'].includes(key))
  const p = value.permissions ?? {}
  return `<div class="form">
    <section><h3>General</h3>${scalars.map(field).join('') || '<p class="note">Nothing set. Use Raw to add a setting.</p>'}</section>
    <section><h3>Permissions</h3>
      ${list('allow', 'allow', p.allow)}
      ${p.ask?.length ? list('ask', 'ask', p.ask) : ''}
      ${list('deny', 'deny', p.deny)}
      ${list('additionalDirectories', 'additionalDirectories', p.additionalDirectories)}
    </section>
    <section><h3>Environment</h3>${envRows || '<p class="note">No variables set.</p>'}
      <div class="adder"><input id="env-key" placeholder="NAME" aria-label="Variable name"><input id="env-value" placeholder="value" aria-label="Variable value"><button data-act="env-add">Add</button></div>
    </section>
    ${value.hooks ? '<p class="note">Hooks have their own section. <button class="link" style="text-decoration:underline" data-act="tab" data-tab="hooks">Open Hooks</button></p>' : ''}
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

async function setModOn(name, on) {
  const sep = S.data.platform === 'win32' ? ';' : ':'
  const settings = JSON.parse((await api('GET', '/api/file?path=settings.json')).text)
  const dirs = pathList(settings.env?.CLAUDE_CODE_PLUGIN_DIRS).filter(one => !one.replace(/\\/g, '/').replace(/\/+$/, '').endsWith('/mods/' + name))
  if (on) dirs.push('~/.claude/mods/' + name)
  if (dirs.length > 1) {
    const sure = await ask({
      title: 'This setting will only work on one kind of machine',
      text: `With two or more mods on, the list needs "${sep}" between them here, but ${sep === ':' ? 'Windows needs ";"' : 'a Mac needs ":"'}. settings.json syncs, so your other machines would fail to load these mods.`,
      okLabel: 'Do it anyway',
      danger: true,
    })
    if (!sure) return false
  }
  await changeJson('settings.json', value => {
    value.env ??= {}
    if (dirs.length) value.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(sep)
    else delete value.env.CLAUDE_CODE_PLUGIN_DIRS
    emptyLeft(value, 'env')
  })
  toast((on ? 'On' : 'Off') + ' for new sessions.')
  return true
}

// ---------- moving around

function layout() {
  const shell = q('#shell')
  shell.classList.toggle('wide', S.tab === 'sync')
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
  layout()
  renderNav()
  if (tab === 'sync') return renderSync()
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
    await load()
    await showTab(S.tab, S.sel)
    toast('Read the disk again.')
  },
  back: async () => {
    if (!(await canLeave())) return
    S.sel = null
    S.file = null
    layout()
    renderList()
  },
  route: ({ route }) => {
    S.route = S.route === route ? null : route
    renderList()
  },
  open: async ({ id }) => {
    if (S.sel === id || !(await canLeave())) return
    S.sel = id
    const item = findItem(id)
    await loadFile(item.main || item.files[0])
    layout()
    renderList()
    renderItem()
  },
  file: async ({ path }) => {
    if (S.file?.path === path || !(await canLeave())) return
    await loadFile(path)
    renderItem()
  },
  save: async () => {
    const text = q('#text').value
    const saved = await api('PUT', '/api/file', { path: S.file.path, text, mtimeMs: S.file.mtimeMs })
    S.file = { ...S.file, text, mtimeMs: saved.mtimeMs }
    setDirty(false)
    const status = q('#save-status')
    status.textContent = 'Saved'
    status.className = 'status'
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
    layout()
    renderList()
    await renderSettings()
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
  attempt(ACT[target.dataset.act])?.(target.dataset)
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
  if (el.matches?.('.group.folder') && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault()
    attempt(ACT['folder-toggle'])(el.dataset)
  }
  if (el.matches?.('[data-list-input]') && event.key === 'Enter') attempt(ACT['list-add'])({ key: el.dataset.listInput })
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
  await load()
  if (S.tab === 'sync') renderSync()
  else renderList()
}))

// A page left open keeps the server awake, and says so if it has gone.
setInterval(() => {
  api('GET', '/api/ping').then(
    () => (q('#banner').hidden = true),
    () => {
      q('#banner').hidden = false
      q('#banner').textContent = 'The dashboard server stopped. Press the button in the Claude pane to start it again.'
    },
  )
}, 5 * 60 * 1000)

attempt(async () => {
  await load()
  const start = location.hash.slice(1)
  await showTab(TABS.some(one => one[0] === start) ? start : 'sync')
  // Quietly learn whether GitHub has moved on.
  api('POST', '/api/fetch', {}).then(load).then(() => S.tab === 'sync' && !S.sel && renderSync()).catch(() => {})
})()
