(function () {
  const vscode = acquireVsCodeApi();

  const columnsEl = document.getElementById('columns');
  const detailEl = document.getElementById('detail');
  const statusEl = document.getElementById('status');
  const errorEl = document.getElementById('error');
  const resizerEl = document.getElementById('resizer');

  let selected = null;
  let byKey = {};
  let agents = {};       // ticket -> agent state, for the card edge
  let snapshots = {};    // ticket -> agent chat snapshot
  let detail = null;     // the selected ticket's JIRA detail
  let tab = 'description';
  let chatDraft = '';
  let descDraft = null;  // non-null means the description is being edited
  let pending = [];      // images pasted or dropped, waiting to be sent
  let stick = true;      // follow the bottom of the transcript
  let menuEl = null;     // the slash menu element for the current render
  let menuAll = [];      // every command available
  let menuHits = [];     // the filtered rows on screen
  let menuIndex = 0;
  let menuOpen = false;
  let since = null;      // when the current burst of work started
  let wt = null;         // worktree status for the selected ticket

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'board') {
      showError(null);
      agents = message.agents || {};
      drawBoard(message.columns, message.tickets);
    } else if (message.type === 'detail') {
      if (message.detail.key === selected) {
        detail = message.detail;
        drawDetail();
      }
    } else if (message.type === 'agent') {
      agents = message.agents || {};
      snapshots[message.snapshot.ticket] = message.snapshot;
      paintCards();
      if (message.snapshot.ticket === selected) {
        drawDetail();
      }
    } else if (message.type === 'worktree') {
      if (message.status.ticket === selected) {
        wt = message.status;
        drawDetail();
      }
    } else if (message.type === 'saved') {
      descDraft = null;
    } else if (message.type === 'error') {
      showError(message.message);
    }
  });

  function showError(text) {
    errorEl.hidden = !text;
    errorEl.textContent = text || '';
  }

  /* ---------- the board ---------- */

  function drawBoard(columns, buckets) {
    const names = columns.slice();
    if (buckets.Other && buckets.Other.length) {
      names.push('Other');
    }

    byKey = {};
    columnsEl.replaceChildren();

    let total = 0;
    for (const name of names) {
      const tickets = buckets[name] || [];
      total += tickets.length;

      const column = el('div', 'bd-column');
      const head = el('div', 'bd-column-head');
      head.append(el('span', null, name), el('span', null, String(tickets.length)));
      column.append(head);

      const body = el('div', 'bd-column-body');
      if (!tickets.length) {
        body.append(el('div', 'bd-empty', 'empty'));
      }
      for (const ticket of tickets) {
        byKey[ticket.key] = ticket;
        body.append(card(ticket));
      }
      column.append(body);
      columnsEl.append(column);
    }

    statusEl.textContent =
      total + ' ticket' + (total === 1 ? '' : 's') + ' · updated ' + new Date().toLocaleTimeString();
    paintCards();
  }

  function card(ticket) {
    const node = el('button', 'bd-card');
    node.type = 'button';
    node.dataset.key = ticket.key;

    const key = el('div', 'bd-card-key');
    key.append(el('span', null, ticket.key + ' · ' + ticket.type));
    key.append(el('span', 'bd-chip', ''));
    node.append(key);
    node.append(el('div', 'bd-card-summary', ticket.summary));

    node.addEventListener('click', () => select(ticket.key));
    return node;
  }

  /**
   * Agent state is the ephemeral half of a card. The left edge carries it, and
   * "needs you" is the one that has to be findable without reading.
   */
  function paintCards() {
    for (const node of document.querySelectorAll('.bd-card')) {
      const key = node.dataset.key;
      const state = agents[key];
      const chip = node.querySelector('.bd-chip');

      node.className = 'bd-card' + (key === selected ? ' bd-card--selected' : '');
      chip.className = 'bd-chip';
      if (state && state !== 'idle') {
        node.classList.add('bd-card--' + state);
        chip.classList.add(chipRole(state));
        chip.textContent = stateWord(state);
        chip.hidden = false;
      } else {
        chip.textContent = '';
        chip.hidden = true;
      }
    }
  }

  function stateWord(state) {
    return { thinking: 'thinking', working: 'working', asking: 'needs you', done: 'done', error: 'failed' }[state] || state;
  }

  function chipRole(state) {
    if (state === 'asking') return 'bd-chip--attention';
    if (state === 'error') return 'bd-chip--broken';
    if (state === 'done') return 'bd-chip--settled';
    return 'bd-chip--running';
  }

  function select(key) {
    selected = key;
    detail = null;
    descDraft = null;
    wt = null;
    // Open on the agent when one is running, otherwise on the spec.
    const state = agents[key];
    tab = state && state !== 'idle' ? 'agent' : 'description';
    paintCards();
    drawDetail();
    vscode.postMessage({ type: 'select', key: key });
    vscode.postMessage({ type: 'agentState', key: key });
  }

  /* ---------- the detail panel ---------- */

  function drawDetail() {
    const ticket = byKey[selected];
    if (!ticket) {
      detailEl.hidden = true;
      resizerEl.hidden = true;
      return;
    }
    detailEl.hidden = false;
    resizerEl.hidden = false;
    detailEl.replaceChildren();

    // The head stays put; only the pane below it scrolls. That is what lets
    // the chat composer sit on the floor of the panel.
    const head = el('div', 'bd-detail-head');
    head.append(el('div', 'bd-detail-key', ticket.key + ' · ' + ticket.status));
    head.append(el('h2', 'bd-detail-title', ticket.summary));

    const chips = el('div', 'bd-chips');
    for (const label of (detail && detail.labels) || []) {
      chips.append(el('span', 'bd-chip bd-chip--quiet', label));
    }
    if (detail && ticket.status !== 'To Plan' && !detail.hasPrd) {
      chips.append(el('span', 'bd-chip bd-chip--broken', 'no PRD'));
    }
    if (chips.childNodes.length) {
      head.append(chips);
    }

    head.append(worktreeLine());
    head.append(actions(ticket));
    head.append(tabStrip());
    detailEl.append(head);

    const pane = el('div', 'bd-pane');
    detailEl.append(pane);

    if (tab === 'agent') {
      drawAgent(pane);
    } else {
      pane.classList.add('bd-pane--scroll');
      if (tab === 'description') {
        drawDescription(pane);
      } else {
        drawHistory(pane);
      }
    }
  }

  /**
   * Where the work for this ticket lives. Quiet unless something needs you:
   * uncommitted changes are the only state that can lose work, so they are the
   * only state that raises its voice. Merged is the resting state and reads
   * like one.
   */
  function worktreeLine() {
    const row = el('div', 'bd-worktree');
    if (!wt) {
      return row;
    }
    if (wt.error) {
      row.append(el('span', 'bd-wt-quiet', 'git: ' + wt.error));
      return row;
    }
    if (!wt.exists) {
      row.append(el('span', 'bd-wt-quiet', 'no branch yet'));
      return row;
    }

    // The branch name only earns space when it says something the ticket key
    // above it does not already say.
    if (wt.branch && wt.branch !== selected) {
      const branch = el('span', 'bd-wt-branch', wt.branch);
      branch.title = wt.path;
      row.append(branch);
    }

    if (wt.state === 'uncommitted') {
      row.append(
        el('span', 'bd-chip bd-chip--attention',
          wt.dirtyFiles + (wt.dirtyFiles === 1 ? ' file uncommitted' : ' files uncommitted'))
      );
    } else if (wt.state === 'ahead') {
      row.append(
        el('span', 'bd-wt-note',
          wt.ahead + (wt.ahead === 1 ? ' commit not in ' : ' commits not in ') + wt.mainBranch)
      );
    } else if (wt.state === 'merged') {
      row.append(el('span', 'bd-wt-quiet', 'merged into ' + wt.mainBranch));
    } else if (wt.state === 'squash-merged') {
      row.append(el('span', 'bd-wt-quiet', 'squash-merged into ' + wt.mainBranch));
    } else {
      row.append(el('span', 'bd-wt-quiet', 'nothing committed yet'));
    }

    // Only worth saying when it is far enough behind to cause conflicts.
    if (wt.behind >= 10 && wt.state !== 'merged' && wt.state !== 'squash-merged') {
      row.append(el('span', 'bd-wt-quiet', wt.behind + ' behind'));
    }

    if (wt.merged && !wt.dirty) {
      const cull = el('button', 'bd-wt-action', 'remove');
      cull.type = 'button';
      cull.title = 'Delete the worktree; the branch stays.';
      cull.addEventListener('click', () =>
        vscode.postMessage({ type: 'cull', key: selected, force: false })
      );
      row.append(cull);
    }
    return row;
  }

  function actions(ticket) {
    const state = agents[ticket.key];
    const live = state && state !== 'idle';
    const row = el('div', 'bd-actions');

    // Plan and Implement are things you say to the agent now, so they are in
    // the slash menu rather than up here. Only what you cannot say gets a
    // button.
    if (ticket.status === 'In Review') {
      row.append(button('Mark complete', () => post('complete', ticket.key)));
    }
    if (live) {
      row.append(button('Stop agent', () => post('stopAgent', ticket.key), true));
    }
    row.append(
      button('Open in JIRA', () =>
        vscode.postMessage({ type: 'openInJira', key: ticket.key, url: ticket.url }), true)
    );
    return row;
  }

  function tabStrip() {
    const strip = el('div', 'bd-tabs');
    const state = agents[selected];
    const asking = state === 'asking';

    for (const name of ['description', 'agent', 'history']) {
      const node = el('button', 'bd-tab' + (tab === name ? ' bd-tab--active' : ''));
      node.type = 'button';
      node.append(el('span', null, name));
      // An agent asking while you read the spec is the case worth signalling.
      if (name === 'agent' && asking && tab !== 'agent') {
        node.append(el('span', 'bd-tab-dot'));
      }
      node.addEventListener('click', () => {
        tab = name;
        drawDetail();
      });
      strip.append(node);
    }
    return strip;
  }

  /* ---------- description: the same text JIRA shows ---------- */

  function drawDescription(pane) {
    if (!detail) {
      pane.append(el('div', 'bd-empty', 'loading...'));
      return;
    }

    if (detail.descriptionLossy) {
      // Saving would silently drop structure JIRA has and Markdown does not.
      // Refusing is better than eating a PRD.
      pane.append(
        el('div', 'bd-notice',
          'Read-only. This description contains ' +
          detail.descriptionUnsupported.join(', ') +
          ', which cannot survive the trip through Markdown. Edit it in JIRA.')
      );
    }

    if (descDraft === null) {
      if (!detail.description) {
        pane.append(el('div', 'bd-empty', 'no description'));
      } else {
        const body = el('div', 'bd-desc');
        body.append(window.renderMarkdown(detail.description));
        pane.append(body);
      }
      if (!detail.descriptionLossy) {
        const row = el('div', 'bd-actions bd-actions--tight');
        row.append(button('Edit', () => {
          descDraft = detail.description;
          drawDetail();
        }));
        pane.append(row);
      }
      return;
    }

    const box = el('textarea', 'bd-desc-edit');
    box.value = descDraft;
    box.addEventListener('input', () => {
      descDraft = box.value;
    });
    pane.append(box);

    const row = el('div', 'bd-actions bd-actions--tight');
    const save = button('Save to JIRA', () => {
      vscode.postMessage({ type: 'saveDescription', key: selected, markdown: descDraft });
      save.disabled = true;
      save.textContent = 'Saving...';
    });
    row.append(save);
    row.append(button('Discard', () => {
      descDraft = null;
      drawDetail();
    }, true));
    pane.append(row);
    box.focus();
  }

  /* ---------- agent: the ticket conversation ---------- */

  function drawAgent(pane) {
    const snap =
      snapshots[selected] || { state: 'idle', transcript: [], permissionMode: 'default', models: [], commands: [] };

    // Pinned above the transcript. State and the two pickers must stay
    // reachable in a long conversation, not scroll off the top of it.
    const head = el('div', 'bd-section-head bd-agent-head');
    head.append(el('span', null, 'Agent · ' + stateWord(snap.state)));
    const controls = el('div', 'bd-controls');
    controls.append(modelPicker(snap));
    controls.append(permissionPicker(snap.permissionMode));
    head.append(controls);
    pane.append(head);

    const scroll = el('div', 'bd-scroll');

    if (snap.transcript.length) {
      const log = el('div', 'bd-chat-log bd-chat-log--flow');
      for (const entry of snap.transcript) {
        const line = el('div', 'bd-chat-entry');
        const who = entry.role + (entry.images ? ' · ' + entry.images + ' image' + (entry.images === 1 ? '' : 's') : '');
        line.append(el('div', 'bd-chat-who', who));
        // Agent replies are Markdown; tool output and your own words are not.
        const text = el('div', 'bd-chat-text');
        if (entry.role === 'agent') {
          text.classList.add('bd-desc');
          text.append(window.renderMarkdown(entry.text));
        } else {
          text.textContent = entry.text;
        }
        if (entry.role === 'tool') text.classList.add('bd-chat-text--tool');
        if (entry.role === 'system') text.classList.add('bd-chat-text--system');
        if (entry.role === 'you') text.classList.add('bd-quote');
        line.append(text);
        log.append(line);
      }
      scroll.append(log);
    } else {
      scroll.append(
        el('div', 'bd-empty', 'Nothing said yet. Type / for skills and commands.')
      );
    }

    // Claude asks for several tools at once; every one of them is shown,
    // because a hidden request is a turn that never finishes.
    const asks = snap.asks || [];
    if (asks.length) {
      const box = el('div', 'bd-permission');
      box.append(
        el('div', 'bd-permission-title',
          asks.length === 1 ? 'Run this?' : 'Run these ' + asks.length + '?')
      );
      for (const ask of asks) {
        const line = el('div', 'bd-permission-line');
        line.append(el('code', 'bd-permission-tool', ask.summary));
        const row = el('div', 'bd-actions bd-actions--tight');
        row.append(button('Allow', () => answer(ask.id, true)));
        row.append(button('Deny', () => answer(ask.id, false), true));
        line.append(row);
        box.append(line);
      }
      if (asks.length > 1) {
        const both = el('div', 'bd-actions bd-actions--tight');
        both.append(button('Allow all', () => answerAll(true)));
        both.append(button('Deny all', () => answerAll(false), true));
        box.append(both);
      }
      scroll.append(box);
    }

    if (snap.question) {
      scroll.append(questionBox(snap.question));
    }

    // Text arriving right now, before the message is complete.
    if (snap.streaming) {
      const live = el('div', 'bd-chat-entry');
      live.append(el('div', 'bd-chat-who', 'agent'));
      const body = el('div', 'bd-chat-text bd-streaming bd-desc');
      body.append(window.renderMarkdown(snap.streaming));
      live.append(body);
      scroll.append(live);
    }

    pane.append(scroll);

    const composer = el('div', 'bd-composer');
    composer.append(slashMenu(snap.commands || []));

    if (pending.length) {
      const strip = el('div', 'bd-attachments');
      pending.forEach((image, index) => {
        const thumb = el('div', 'bd-thumb');
        const img = document.createElement('img');
        img.src = 'data:' + image.mediaType + ';base64,' + image.data;
        thumb.append(img);
        const drop = el('button', 'bd-thumb-x', 'x');
        drop.type = 'button';
        drop.title = 'Remove';
        drop.addEventListener('click', () => {
          pending.splice(index, 1);
          drawDetail();
        });
        thumb.append(drop);
        strip.append(thumb);
      });
      composer.append(strip);
    }

    composer.append(chatBox(snap));
    composer.append(composerFoot(snap));
    pane.append(composer);

    scroll.addEventListener('scroll', () => {
      stick = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
    });
    if (stick) {
      scroll.scrollTop = scroll.scrollHeight;
    }
  }

  /**
   * A real multiple-choice question. The agent has no AskUserQuestion here, so
   * this is the only way it can put a decision in front of you.
   */
  function questionBox(question) {
    const box = el('div', 'bd-question');
    box.append(el('div', 'bd-question-title'));
    box.lastChild.append(window.renderMarkdown(question.question));
    box.lastChild.className = 'bd-question-title bd-desc';

    if (!question.multiple) {
      for (const option of question.options) {
        const choice = el('button', 'bd-choice');
        choice.type = 'button';
        choice.append(el('span', 'bd-choice-label', option.label));
        if (option.description) {
          choice.append(el('span', 'bd-choice-desc', option.description));
        }
        choice.addEventListener('click', () =>
          vscode.postMessage({
            type: 'answerQuestion', key: selected, id: question.id, answers: [option.label]
          })
        );
        box.append(choice);
      }
    } else {
      const picked = new Set();
      for (const option of question.options) {
        const choice = el('button', 'bd-choice');
        choice.type = 'button';
        choice.append(el('span', 'bd-choice-mark', '[ ]'));
        choice.append(el('span', 'bd-choice-label', option.label));
        if (option.description) {
          choice.append(el('span', 'bd-choice-desc', option.description));
        }
        choice.addEventListener('click', () => {
          if (picked.has(option.label)) {
            picked.delete(option.label);
            choice.classList.remove('bd-choice--on');
            choice.firstChild.textContent = '[ ]';
          } else {
            picked.add(option.label);
            choice.classList.add('bd-choice--on');
            choice.firstChild.textContent = '[x]';
          }
        });
        box.append(choice);
      }
      const row = el('div', 'bd-actions bd-actions--tight');
      row.append(button('Send', () =>
        vscode.postMessage({
          type: 'answerQuestion', key: selected, id: question.id, answers: [...picked]
        })
      ));
      box.append(row);
    }

    const skip = el('div', 'bd-actions bd-actions--tight');
    skip.append(button('You decide', () =>
      vscode.postMessage({ type: 'answerQuestion', key: selected, id: question.id, answers: null }),
      true
    ));
    box.append(skip);
    return box;
  }

  /** Context meter on the left, interrupt on the right while it is busy. */
  function composerFoot(snap) {
    const foot = el('div', 'bd-foot');

    const left = el('span', 'bd-foot-left');

    const running = snap.state === 'thinking' || snap.state === 'working';
    if (running) {
      since = snap.since || Date.now();
      const live = el('span', 'bd-activity');
      live.append(el('span', 'bd-dot'));
      live.append(el('span', 'bd-elapsed', elapsed()));
      if (snap.doing) {
        live.append(el('span', null, '· ' + snap.doing.replace(/^mcp__[^_]+__/, '')));
      }
      left.append(live);
    } else {
      since = null;
    }

    if (snap.context) {
      const pct = Math.round(snap.context.percentage);
      const bar = el('span', 'bd-meter');
      const fill = el('span', 'bd-meter-fill');
      fill.style.width = Math.min(100, pct) + '%';
      if (pct >= 80) fill.classList.add('bd-meter-fill--warn');
      bar.append(fill);
      left.append(bar);
      left.append(el('span', null, pct + '% of context'));
    } else {
      left.append(el('span', null, snap.started ? '' : 'starts when you speak'));
    }
    foot.append(left);

    const busy = snap.state === 'thinking' || snap.state === 'working';
    if (busy) {
      const stop = el('button', 'bd-linkish', 'interrupt');
      stop.type = 'button';
      stop.addEventListener('click', () => post('interrupt', selected));
      foot.append(stop);
    }
    return foot;
  }

  /** The same four levels Claude Code offers, per conversation. */
  function permissionPicker(current) {
    return picker(
      'bd-mode',
      [
        ['default', 'ask every time'],
        ['acceptEdits', 'edits without asking'],
        ['plan', 'plan only'],
        ['bypassPermissions', 'never ask']
      ],
      current || 'default',
      (value) => vscode.postMessage({ type: 'mode', key: selected, mode: value })
    );
  }

  /**
   * Models come from the running session, so the list is whatever this account
   * actually has. Before a session exists there is nothing to ask.
   */
  function modelPicker(snap) {
    const models = snap.models || [];
    if (!models.length) {
      const note = el('span', 'bd-model-idle', snap.model || 'default model');
      note.title = 'The model list arrives once the session starts.';
      return note;
    }
    return picker(
      'bd-mode',
      models.map((m) => [m.value, m.displayName]),
      snap.model || models[0].value,
      (value) => vscode.postMessage({ type: 'model', key: selected, model: value })
    );
  }

  function picker(className, pairs, current, onChange) {
    const node = document.createElement('select');
    node.className = className;
    for (const pair of pairs) {
      const option = document.createElement('option');
      option.value = pair[0];
      option.textContent = pair[1];
      if (pair[0] === current) option.selected = true;
      node.append(option);
    }
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  /* ---------- the slash menu ---------- */

  function slashMenu(commands) {
    const menu = el('div', 'bd-menu');
    menu.hidden = true;
    menuEl = menu;
    menuAll = commands;
    return menu;
  }

  /** Open on a leading slash, filter as you type, close on anything else. */
  function updateMenu(box) {
    if (!menuEl) return;
    const value = box.value;
    const match = /^\/([\w-]*)$/.exec(value);

    if (!match) {
      menuEl.hidden = true;
      menuOpen = false;
      return;
    }

    const term = match[1].toLowerCase();
    menuHits = menuAll
      .filter((c) => c.name.toLowerCase().indexOf(term) >= 0)
      .slice(0, 40);

    if (!menuHits.length) {
      menuEl.hidden = true;
      menuOpen = false;
      return;
    }

    if (menuIndex >= menuHits.length) menuIndex = 0;
    menuOpen = true;
    menuEl.hidden = false;
    menuEl.replaceChildren();

    menuHits.forEach((command, index) => {
      const row = el('div', 'bd-menu-row' + (index === menuIndex ? ' bd-menu-row--on' : ''));
      const name = el('span', 'bd-menu-name', '/' + command.name);
      row.append(name);
      if (command.argumentHint) {
        row.append(el('span', 'bd-menu-hint', command.argumentHint));
      }
      row.append(el('span', 'bd-menu-desc', command.description));
      row.addEventListener('mousedown', (event) => {
        event.preventDefault();
        accept(box, command);
      });
      menuEl.append(row);
    });

    const active = menuEl.children[menuIndex];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function accept(box, command) {
    box.value = '/' + command.name + ' ';
    chatDraft = box.value;
    menuEl.hidden = true;
    menuOpen = false;
    menuIndex = 0;
    box.focus();
  }

  function chatBox(snap) {
    const box = el('textarea', 'bd-chat-box');
    box.placeholder = 'Talk to this ticket...  / for skills, Enter to send, Shift+Enter for a newline, paste an image.';
    box.value = chatDraft;

    box.addEventListener('input', () => {
      chatDraft = box.value;
      menuIndex = 0;
      updateMenu(box);
    });

    box.addEventListener('paste', (event) => {
      const items = (event.clipboardData && event.clipboardData.items) || [];
      for (const item of items) {
        if (item.type && item.type.indexOf('image/') === 0) {
          event.preventDefault();
          attach(item.getAsFile());
        }
      }
    });

    box.addEventListener('dragover', (event) => event.preventDefault());
    box.addEventListener('drop', (event) => {
      const files = (event.dataTransfer && event.dataTransfer.files) || [];
      let handled = false;
      for (const file of files) {
        if (file.type && file.type.indexOf('image/') === 0) {
          handled = true;
          attach(file);
        }
      }
      if (handled) event.preventDefault();
    });

    box.addEventListener('keydown', (event) => {
      if (menuOpen) {
        if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
          event.preventDefault();
          menuIndex = (menuIndex + 1) % menuHits.length;
          updateMenu(box);
          return;
        }
        if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault();
          menuIndex = (menuIndex - 1 + menuHits.length) % menuHits.length;
          updateMenu(box);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          accept(box, menuHits[menuIndex]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          menuEl.hidden = true;
          menuOpen = false;
          return;
        }
      }

      if (event.key === 'Escape' && (snap.state === 'thinking' || snap.state === 'working')) {
        event.preventDefault();
        post('interrupt', selected);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(box);
      }
    });

    // Restore the menu after a repaint if the draft still starts with a slash.
    setTimeout(() => updateMenu(box), 0);
    return box;
  }

  /** Images ride along as base64 blocks, the way Claude Code takes a paste. */
  function attach(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      pending.push({ mediaType: file.type, data: result.slice(comma + 1) });
      drawDetail();
    };
    reader.readAsDataURL(file);
  }

  function send(box) {
    const text = box.value.trim();
    if (!text && !pending.length) return;
    vscode.postMessage({
      type: 'chat',
      key: selected,
      text: text || 'See the attached image.',
      images: pending
    });
    chatDraft = '';
    pending = [];
    box.value = '';
    menuOpen = false;
    menuIndex = 0;
    drawDetail();
  }

  /* ---------- history: what JIRA already knows ---------- */

  function drawHistory(pane) {
    if (!detail) {
      pane.append(el('div', 'bd-empty', 'loading...'));
      return;
    }

    if (detail.subtasks.length) {
      const done = detail.subtasks.filter((s) => s.done).length;
      const head = el('div', 'bd-section-head');
      head.append(el('span', null, 'Sub-tasks'), el('span', null, done + ' / ' + detail.subtasks.length));
      pane.append(head);

      const list = el('div', 'bd-subtasks');
      for (const sub of detail.subtasks) {
        const row = el('div', 'bd-subtask' + (sub.done ? ' bd-subtask--done' : ''));
        row.append(el('span', 'bd-subtask-mark', sub.done ? 'done' : 'open'));
        row.append(el('span', null, sub.summary));
        list.append(row);
      }
      pane.append(list);
    }

    pane.append(el('div', 'bd-section-head', 'History'));
    if (!detail.timeline.length) {
      pane.append(el('div', 'bd-empty', 'nothing recorded yet'));
      return;
    }
    const list = el('div', 'bd-timeline');
    for (const entry of detail.timeline) {
      const event = el('div', 'bd-event');
      event.append(el('div', 'bd-event-meta', when(entry.at) + ' · ' + entry.who));
      const text = el('div', null, entry.text);
      if (entry.kind === 'comment') text.className = 'bd-quote';
      event.append(text);
      list.append(event);
    }
    pane.append(list);
  }

  /* ---------- helpers ---------- */

  function answer(id, allow) {
    vscode.postMessage({ type: 'permission', key: selected, id: id, allow: allow });
  }

  function answerAll(allow) {
    vscode.postMessage({ type: 'permissionAll', key: selected, allow: allow });
  }

  function elapsed() {
    if (!since) return '';
    const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));
    if (seconds < 60) return seconds + 's';
    return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
  }

  function post(type, key) {
    vscode.postMessage({ type: type, key: key });
  }

  function when(value) {
    if (!value) return 'unknown';
    const date = new Date(value);
    return isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  function button(label, onClick, quiet) {
    const node = el('button', 'bd-btn' + (quiet ? ' bd-btn--quiet' : ''), label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // The clock ticks on its own so a long silence still looks alive, without
  // repainting the panel once a second.
  setInterval(() => {
    if (!since) return;
    for (const node of document.querySelectorAll('.bd-elapsed')) {
      node.textContent = elapsed();
    }
  }, 1000);

  /* ---------- panel width ---------- */

  const MIN_PANEL = 280;
  const MAX_PANEL = 1000;

  function setPanelWidth(px) {
    const width = Math.max(MIN_PANEL, Math.min(MAX_PANEL, Math.round(px)));
    detailEl.style.flexBasis = width + 'px';
    return width;
  }

  // The chosen width outlives a reload; the panel is where the work happens and
  // having to drag it wide again every time would be its own annoyance.
  const saved = vscode.getState() || {};
  if (saved.panelWidth) {
    setPanelWidth(saved.panelWidth);
  }

  resizerEl.addEventListener('mousedown', (event) => {
    event.preventDefault();
    document.body.classList.add('bd-resizing');

    const move = (moved) => {
      // The panel is on the right, so its width is whatever is left of the edge.
      setPanelWidth(window.innerWidth - moved.clientX);
    };

    const done = () => {
      document.body.classList.remove('bd-resizing');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', done);
      const width = parseInt(detailEl.style.flexBasis, 10);
      if (width) {
        vscode.setState(Object.assign({}, vscode.getState(), { panelWidth: width }));
      }
    };

    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', done);
  });

  // Double-click the handle to go back to the default width.
  resizerEl.addEventListener('dblclick', () => {
    detailEl.style.flexBasis = '';
    vscode.setState(Object.assign({}, vscode.getState(), { panelWidth: null }));
  });

  vscode.postMessage({ type: 'ready' });
})();
