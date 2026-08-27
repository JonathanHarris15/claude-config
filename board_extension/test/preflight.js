// Checks everything that has to be true before the extension can work, so a
// failure names itself instead of showing up as a blank editor window.
//   npm run preflight
const { recorded } = require('./stub-vscode');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function check(label, fn) {
  try {
    const detail = fn();
    console.log(`  ok    ${label}${detail ? ' — ' + detail : ''}`);
    return true;
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${label} — ${err.message}`);
    return false;
  }
}

async function checkAsync(label, fn) {
  try {
    const detail = await fn();
    console.log(`  ok    ${label}${detail ? ' — ' + detail : ''}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${label} — ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

(async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const c = pkg.contributes;

  console.log('\nBuild');
  check('compiled output exists', () => {
    assert(fs.existsSync(path.join(root, pkg.main)), `${pkg.main} missing — run: npm run compile`);
    return pkg.main;
  });
  check('compiled output is not stale', () => {
    const newest = fs
      .readdirSync(path.join(root, 'src'))
      .map((f) => fs.statSync(path.join(root, 'src', f)).mtimeMs)
      .reduce((a, b) => Math.max(a, b), 0);
    assert(fs.statSync(path.join(root, pkg.main)).mtimeMs >= newest, 'src/ newer than out/ — recompile');
  });
  check('webview assets present', () => {
    for (const file of ['media/board.css', 'media/board.js']) {
      assert(fs.existsSync(path.join(root, file)), `${file} missing`);
    }
    return 'board.css, board.js';
  });

  console.log('\nActivity Bar');
  check('container declared with a themable icon', () => {
    const container = c.viewsContainers?.activitybar?.[0];
    assert(container, 'no activitybar container');
    assert(fs.existsSync(path.join(root, container.icon)), `icon ${container.icon} missing`);
    assert(
      fs.readFileSync(path.join(root, container.icon), 'utf8').includes('currentColor'),
      'icon must use currentColor to theme correctly'
    );
    return `"${container.title}"`;
  });
  check('sidebar view is a tree, not a webview', () => {
    const view = c.views?.[c.viewsContainers.activitybar[0].id]?.[0];
    assert(view, 'no view declared in the container');
    assert(view.type !== 'webview', 'the sidebar should be a native tree of spaces');
    return view.id;
  });
  check('menu commands are all declared', () => {
    const declared = new Set(c.commands.map((x) => x.command));
    for (const group of Object.values(c.menus ?? {})) {
      for (const item of group) {
        assert(declared.has(item.command), `${item.command} is in a menu but not declared`);
      }
    }
    return Object.keys(c.menus ?? {}).join(', ');
  });

  console.log('\nActivation');
  const extension = require(path.join(root, pkg.main));
  check('module exports activate and deactivate', () => {
    assert(typeof extension.activate === 'function', 'no activate export');
    assert(typeof extension.deactivate === 'function', 'no deactivate export');
  });
  check('activate registers commands and the tree provider', () => {
    extension.activate({ subscriptions: [], extensionUri: { path: root } });
    for (const declared of c.commands) {
      assert(recorded.commands[declared.command], `${declared.command} declared but not registered`);
    }
    const viewId = c.views[c.viewsContainers.activitybar[0].id][0].id;
    assert(recorded.treeProviders[viewId], `no tree provider for ${viewId}`);
    return Object.keys(recorded.commands).join(', ');
  });

  console.log('\nSpaces');
  const provider = recorded.treeProviders[c.views[c.viewsContainers.activitybar[0].id][0].id];
  const spaces = await provider.getChildren();

  check('spaces listed from JIRA', () => {
    assert(!recorded.errors.length, recorded.errors[0]);
    assert(spaces.length, 'no spaces returned');
    return spaces.map((s) => s.key).join(', ');
  });

  check('each row opens its own board', () => {
    const item = provider.getTreeItem(spaces[0]);
    assert(item.label === spaces[0].key, 'row is not labelled with the space key');
    assert(item.command?.command === 'board.open', 'row does not open the board');
    assert(item.command.arguments?.[0]?.key === spaces[0].key, 'row passes the wrong space');
    return `${item.label} — ${item.description}`;
  });

  console.log('\nBoard tab');
  const space = spaces.find((s) => s.key === (process.env.BOARD_PROJECT || 'METH')) ?? spaces[0];
  await recorded.commands['board.open'](space);
  const panel = recorded.panels[0];

  check('a board tab opens for the picked space', () => {
    assert(panel, 'no editor panel created');
    assert(panel.title.includes(space.key), `tab titled "${panel.title}" does not name the space`);
    assert(panel.webview.html.includes('<!DOCTYPE html>'), 'panel HTML is empty');
    return `"${panel.title}", ${panel.webview.html.length} bytes`;
  });

  check('assets linked and nonce matches', () => {
    assert(panel.webview.html.includes('board.css'), 'stylesheet not linked');
    assert(panel.webview.html.includes('board.js'), 'script not linked');
    const nonce = /nonce-([A-Za-z0-9]+)/.exec(panel.webview.html);
    assert(nonce, 'no nonce in CSP');
    assert(panel.webview.html.includes(`nonce="${nonce[1]}"`), 'script nonce does not match CSP');
  });

  check('picking the same space reuses its tab', () => {
    recorded.commands['board.open'](space);
    assert(recorded.panels.length === 1, 'a duplicate tab was opened');
    assert(panel.revealed, 'the existing tab was not revealed');
  });

  let first;
  console.log('\nLive data');
  await panel.webview.state.handler({ type: 'ready' });

  const ok = check('board data reached the tab', () => {
    const message = panel.webview.state.messages.find((m) => m.type === 'board' || m.type === 'error');
    assert(message, 'the tab was sent nothing');
    if (message.type === 'error') {
      throw new Error(message.message.split('\n')[0]);
    }
    const counts = Object.entries(message.tickets)
      .filter(([, list]) => list.length)
      .map(([column, list]) => `${column} ${list.length}`)
      .join(', ');
    return counts || 'no tickets returned';
  });

  if (ok) {
    const board = panel.webview.state.messages.find((m) => m.type === 'board');
    first = Object.values(board.tickets).flat()[0];
    if (first) {
      await panel.webview.state.handler({ type: 'select', key: first.key });
      check('ticket detail reached the tab', () => {
        const message = panel.webview.state.messages.find(
          (m) => m.type === 'detail' || m.type === 'error'
        );
        assert(message, 'no detail message');
        if (message.type === 'error') {
          throw new Error(message.message.split('\n')[0]);
        }
        const d = message.detail;
        return `${d.key}: ${d.timeline.length} timeline entries, ${d.subtasks.length} sub-tasks`;
      });
    }
  }

  console.log('\nAgent');
  check('agent module is wired in', () => {
    const agent = require(path.join(root, 'out', 'agent.js'));
    assert(typeof agent.AgentSession === 'function', 'no AgentSession export');
    assert(Object.keys(agent.AgentSession.states()).length === 0, 'a session is unexpectedly live');
    return 'AgentSession, no live sessions';
  });

  check('SDK resolves and is ESM-loadable', () => {
    const sdkPkg = require(path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'package.json'));
    assert(sdkPkg.type === 'module', 'SDK is no longer ESM — the dynamic-import shim may be unneeded');
    return 'v' + sdkPkg.version + ' (esm)';
  });

  check('configured repos exist on disk', () => {
    const repos = c.configuration.properties['board.repos'].default;
    const missing = Object.entries(repos).filter(([, dir]) => !fs.existsSync(dir));
    assert(!missing.length, 'no checkout at ' + missing.map(([k]) => k).join(', '));
    return Object.keys(repos).join(', ');
  });

  // Preflight must never start a real session, so this drives the path where
  // no repo is configured and checks it refuses politely instead of crashing.
  await panel.webview.state.handler({ type: 'plan', key: first ? first.key : 'METH-1' });
  check('Plan without a configured repo fails politely', () => {
    const message = panel.webview.state.messages
      .slice()
      .reverse()
      .find((m) => m.type === 'error');
    assert(message, 'no error was reported');
    assert(message.message.indexOf('board.repos') >= 0, 'error does not say how to fix it');
    const live = require(path.join(root, 'out', 'agent.js')).AgentSession.states();
    assert(!Object.keys(live).length, 'a session was started during preflight');
    return 'refused, no session started';
  });

  console.log('\nDesign system');
  check('no raw colour outside the documented fallbacks', () => {
    const css = fs.readFileSync(path.join(root, 'media', 'board.css'), 'utf8');
    const found = [...new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])].sort();
    const allowed = ['#000', '#2ea043', '#3794ff', '#d29922', '#f14c4c'].sort();
    const extra = found.filter((c) => !allowed.includes(c));
    assert(!extra.length, 'unexpected raw colour: ' + extra.join(', '));
    return found.length + ' LAST RESORT fallbacks only';
  });

  check('every colour resolves through a token', () => {
    const css = fs.readFileSync(path.join(root, 'media', 'board.css'), 'utf8');
    assert(css.indexOf('@generated') >= 0, 'generated marker missing - design-sync cannot compare');
    assert(css.indexOf('--role-') >= 0, 'semantic role layer missing');
    assert(css.indexOf('--vscode-') >= 0, 'theme bridge missing');
    return 'bridge, roles and generated markers present';
  });

  await checkAsync('a description with tables refuses to save', async () => {
    const { fetchDetail } = require(path.join(root, 'out', 'board.js'));
    const d = await fetchDetail('METH-388');
    assert(d.descriptionLossy, 'METH-388 has tables but was reported as safe to save');
    assert(d.descriptionUnsupported.length, 'lossy but nothing named as the cause');
    return 'blocked on ' + d.descriptionUnsupported.join(', ');
  });

  await checkAsync('a plain description converts and stays editable', async () => {
    const { fetchBoard, fetchDetail } = require(path.join(root, 'out', 'board.js'));
    // Pinning this to one ticket made it fail the day an agent wrote a PRD with
    // checkboxes onto it. Scan for any ticket that converts cleanly instead.
    const pool = (await fetchBoard(process.env.BOARD_PROJECT || 'METH')).slice(0, 8);
    let clean = null;
    for (const ticket of pool) {
      const d = await fetchDetail(ticket.key);
      if (!d.descriptionLossy && d.description.indexOf('## ') >= 0) {
        clean = { key: ticket.key, detail: d };
        break;
      }
    }
    assert(clean, 'no ticket among ' + pool.length + ' converts cleanly with headings');
    return clean.key + ': ' + clean.detail.description.length + ' chars, headings preserved';
  });
  console.log('\nConversation store');
  check('a conversation round-trips through the repo', () => {
    const store = require(path.join(root, 'out', 'store.js'));
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'board-store-'));

    const written = {
      ticket: 'METH-999',
      space: 'METH',
      sessionId: 'abc-123',
      permissionMode: 'acceptEdits',
      transcript: [
        { role: 'you', text: 'fix it', at: '2026-08-26T10:00:00.000Z' },
        { role: 'agent', text: 'done', at: '2026-08-26T10:00:09.000Z' }
      ],
      updatedAt: ''
    };
    store.save(tmp, written);

    const read = store.load(tmp, 'METH-999');
    assert(read, 'nothing came back');
    assert(read.sessionId === 'abc-123', 'session id lost - the chat could not resume');
    assert(read.permissionMode === 'acceptEdits', 'permission level lost');
    assert(read.transcript.length === 2, 'transcript lost');
    assert(read.transcript[1].text === 'done', 'transcript garbled');

    const dir = path.join(tmp, '.board', 'conversations');
    assert(fs.existsSync(path.join(dir, 'METH-999.md')), 'no readable mirror written');
    assert(fs.existsSync(path.join(dir, 'README.md')), 'no README explaining the folder');
    assert(store.list(tmp).indexOf('METH-999') >= 0, 'not listed');

    fs.rmSync(tmp, { recursive: true, force: true });
    return 'json, markdown mirror and README';
  });

  check('a missing conversation just starts fresh', () => {
    const store = require(path.join(root, 'out', 'store.js'));
    assert(store.load(path.join(root, 'nope'), 'METH-1') === undefined, 'should be undefined');
    assert(store.list(path.join(root, 'nope')).length === 0, 'should be empty');
  });

  console.log('\nAgent panel');
  check('slash menu is seeded from real skills', () => {
    const { listSkills } = require(path.join(root, 'out', 'skills.js'));
    const all = listSkills();
    assert(all.length > 5, 'only ' + all.length + ' skills found');
    const blank = all.filter((c) => !c.description);
    // CRLF SKILL.md files silently parsed to nothing once; never again.
    assert(!blank.length, blank.length + ' skills parsed with no description: ' + blank.slice(0, 4).map((c) => c.name).join(', '));
    const planTicket = all.find((c) => c.name === 'plan-ticket');
    assert(planTicket, 'plan-ticket not in the menu');
    assert(planTicket.argumentHint, 'plan-ticket has no argument hint');
    return all.length + ' commands, all described';
  });

  check('the session exposes the controls the panel offers', () => {
    const dts = fs.readFileSync(
      path.join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.d.ts'),
      'utf8'
    );
    for (const method of ['setModel(', 'supportedModels(', 'supportedCommands(', 'getContextUsage(', 'interrupt(']) {
      assert(dts.indexOf(method) >= 0, 'SDK no longer offers ' + method);
    }
    return 'model, commands, context, interrupt';
  });

  check('the agent header stays pinned above the transcript', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const block = js.slice(js.indexOf('function drawAgent('), js.indexOf('function composerFoot('));
    const head = block.indexOf("bd-agent-head");
    const scroll = block.indexOf("el('div', 'bd-scroll')");
    assert(head >= 0 && scroll >= 0, 'the agent tab no longer has a header and a scroll region');
    assert(head < scroll, 'the header is built after the scroll region');
    assert(block.indexOf('pane.append(head)') >= 0, 'the header is not pinned to the pane');
    assert(block.indexOf('scroll.append(head)') < 0, 'the header is inside the scroll region again');
    return 'header pinned, transcript scrolls under it';
  });

  check('the panel wires every control it draws', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    for (const kind of ['mode', 'model', 'interrupt', 'chat', 'permission']) {
      const direct = js.indexOf("type: '" + kind + "'") >= 0;
      const viaPost = js.indexOf("post('" + kind + "'") >= 0;
      assert(direct || viaPost, 'panel never sends ' + kind);
      assert(ext.indexOf("case '" + kind + "'") >= 0, 'extension never handles ' + kind);
    }
    return 'mode, model, interrupt, chat, permission';
  });

  console.log('\nBoard actions');
  check('Plan and Implement are commands, not header buttons', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const header = js.slice(js.indexOf('function actions('), js.indexOf('function tabStrip('));
    assert(header.indexOf("post('plan'") < 0, 'Plan button is still in the header');
    assert(header.indexOf("post('implement'") < 0, 'Implement button is still in the header');
    assert(header.indexOf("'In Review'") >= 0, 'no In Review case in the header actions');
    assert(header.indexOf("post('complete'") >= 0, 'no Mark complete button');
    return 'only Mark complete, Stop agent and Open in JIRA';
  });

  check('Mark complete is handled and moves to Done', () => {
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    assert(ext.indexOf("case 'complete'") >= 0, 'extension never handles complete');
    const body = ext.slice(ext.indexOf('private async complete('), ext.indexOf('private async runSkill('));
    assert(body.indexOf("moveTicket(ticket, 'Done')") >= 0, 'complete does not move to Done');
    assert(body.indexOf('pushBoard()') >= 0, 'complete does not refresh the board');
    return 'transitions to Done and repaints';
  });

  check('the agent is told what the board is', () => {
    const agent = fs.readFileSync(path.join(root, 'src', 'agent.ts'), 'utf8');
    const block = agent.slice(agent.indexOf('instructions: ['), agent.indexOf('].join('));
    assert(block.indexOf('BOARD_COLUMNS.join') >= 0, 'the columns are not named to the agent');
    assert(block.indexOf('Do NOT move this ticket to Done') >= 0, 'the agent is not told Done is the human call');
    assert(block.indexOf('move_ticket') >= 0, 'move_ticket is not explained');
    return 'columns, PRD rule, and Done left to the human';
  });

  check('a JIRA change mid-turn repaints the board', () => {
    const agent = fs.readFileSync(path.join(root, 'src', 'agent.ts'), 'utf8');
    assert(agent.indexOf('TOUCHES_BOARD') >= 0, 'nothing watches for board-touching tools');
    assert(agent.indexOf('refreshBoard()') >= 0, 'refreshBoard is never called');
    assert(/transition\|move_ticket\|jira\|workitem/.test(agent), 'the watch list is missing a JIRA path');
    return 'watches move_ticket and direct JIRA transitions';
  });

  console.log('\nPermission queue');
  await checkAsync('two tools requested at once both get answered', async () => {
    const { AgentSession } = require(path.join(root, 'out', 'agent.js'));
    const noop = () => {};
    const session = new AgentSession(
      { ticket: 'TEST-1', space: 'TEST', summary: 'x', status: 'To Plan', cwd: root },
      { onChange: noop, moveTicket: async () => {}, persist: noop, refreshBoard: noop }
    );

    try {
      // Claude routinely asks for several tools in one turn. Holding them in a
      // single field meant the first promise never resolved and the run hung.
      const first = session.requestPermission('Bash', { command: 'one' }, {});
      const second = session.requestPermission('Read', { file_path: 'two.ts' }, {});

      const asks = session.snapshot().asks;
      assert(asks.length === 2, 'only ' + asks.length + ' request held; the other was dropped');
      assert(asks[0].id !== asks[1].id, 'both requests share an id');

      session.answer(asks[0].id, true);
      session.answer(asks[1].id, false);

      const settled = await Promise.race([
        Promise.all([first, second]),
        new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 2000))
      ]);
      assert(settled !== 'TIMEOUT', 'a request never resolved - the turn would hang');
      assert(settled[0].behavior === 'allow', 'the allowed tool was not allowed');
      assert(settled[1].behavior === 'deny', 'the denied tool was not denied');
      assert(session.snapshot().asks.length === 0, 'the queue did not drain');
      return 'both resolved, queue drained';
    } finally {
      session.stop();
    }
  });

  await checkAsync('interrupting releases anything still held', async () => {
    const { AgentSession } = require(path.join(root, 'out', 'agent.js'));
    const noop = () => {};
    const session = new AgentSession(
      { ticket: 'TEST-2', space: 'TEST', summary: 'x', status: 'To Plan', cwd: root },
      { onChange: noop, moveTicket: async () => {}, persist: noop, refreshBoard: noop }
    );

    try {
      const held = session.requestPermission('Bash', { command: 'slow' }, {});
      await session.interrupt();
      const settled = await Promise.race([
        held,
        new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 2000))
      ]);
      assert(settled !== 'TIMEOUT', 'interrupt left a promise nobody will resolve');
      assert(settled.behavior === 'deny', 'an interrupted request should deny');
      return 'released on interrupt';
    } finally {
      session.stop();
    }
  });

  console.log('\nWorktrees');
  check('the panel shows branch, drift and merge state', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const block = js.slice(js.indexOf('function worktreeLine('), js.indexOf('function actions('));
    for (const bit of ['wt.branch', 'wt.dirty', 'wt.ahead', 'wt.behind', 'wt.merged']) {
      assert(block.indexOf(bit) >= 0, 'the header never shows ' + bit);
    }
    assert(block.indexOf("'squash-merged'") >= 0, 'a squash merge is not distinguished');
    return 'branch, uncommitted, ahead/behind, merged';
  });

  check('the git line is quiet unless work is at risk', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const block = js.slice(js.indexOf('function worktreeLine('), js.indexOf('function actions('));
    // Uncommitted work is the only state that can lose something, so it is the
    // only one allowed to shout. Merged is the resting state.
    const chips = (block.match(/bd-chip--[a-z]+/g) || []);
    assert(chips.length === 1 && chips[0] === 'bd-chip--attention',
      'the git line uses ' + chips.length + ' chips: ' + chips.join(', '));
    assert(block.indexOf("'uncommitted'") >= 0, 'uncommitted is not the loud case');
    assert(block.indexOf("'bd-wt-quiet', 'merged into '") >= 0, 'merged is not quiet');
    assert(block.indexOf('wt.branch !== selected') >= 0, 'the branch name repeats the ticket key');
    return 'one chip, and only for uncommitted work';
  });

  check('labels read as metadata, not status', () => {
    const css = fs.readFileSync(path.join(root, 'media', 'board.css'), 'utf8');
    const quiet = css.slice(css.indexOf('.bd-chip--quiet{'), css.indexOf('.bd-chips{'));
    assert(quiet.indexOf('background:transparent') >= 0, 'label chips are still filled');
    return 'outlined, dimmed';
  });

  check('agents get their own worktree', () => {
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    assert(ext.indexOf('ensureWorktree(cwd, ticket)') >= 0, 'the session still runs in the shared repo');
    assert(ext.indexOf('cwd: workingDir') >= 0, 'the worktree is not used as the working directory');
    return 'one checkout per ticket';
  });

  check('marking complete culls the worktree', () => {
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    const body = ext.slice(ext.indexOf('private async complete('), ext.indexOf('private pushWorktree('));
    assert(body.indexOf('cullWorktree(repo, ticket)') >= 0, 'complete does not cull');
    assert(body.indexOf('was kept') >= 0, 'a refused cull is not reported');
    return 'culled, and says so when it refuses';
  });

  console.log('\nPanel affordances');
  check('the panel can be dragged wider', () => {
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    assert(ext.indexOf('id="resizer"') >= 0, 'no drag handle in the page');
    assert(js.indexOf("addEventListener('mousedown'") >= 0, 'the handle is not draggable');
    assert(js.indexOf('panelWidth') >= 0, 'the width is not remembered');
    assert(js.indexOf("addEventListener('dblclick'") >= 0, 'no way back to the default width');
    return 'drag, remember, double-click to reset';
  });

  check('agent replies render as Markdown', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const block = js.slice(js.indexOf('function drawAgent('), js.indexOf('function questionBox('));
    assert(block.indexOf('renderMarkdown(entry.text)') >= 0, 'chat entries are still plain text');
    assert(block.indexOf('renderMarkdown(snap.streaming)') >= 0, 'streaming text is still plain');
    assert(block.indexOf("entry.role === 'agent'") >= 0, 'Markdown is not limited to agent replies');
    return 'agent replies and live text';
  });

  check('the agent can ask a real question', () => {
    const agent = fs.readFileSync(path.join(root, 'src', 'agent.ts'), 'utf8');
    const js = fs.readFileSync(path.join(root, 'media', 'board.js'), 'utf8');
    const ext = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    assert(agent.indexOf("'ask',") >= 0, 'no ask tool');
    assert(js.indexOf('function questionBox(') >= 0, 'the panel cannot render a question');
    assert(js.indexOf("type: 'answerQuestion'") >= 0, 'the panel never answers');
    assert(ext.indexOf("case 'answerQuestion'") >= 0, 'the extension never handles an answer');
    assert(js.indexOf('You decide') >= 0, 'no way to decline the question');
    return 'ask tool, choices, and a way out';
  });

  check('the agent is told what this panel cannot do', () => {
    const agent = fs.readFileSync(path.join(root, 'src', 'agent.ts'), 'utf8');
    const block = agent.slice(agent.indexOf('instructions: ['), agent.indexOf('].join('));
    assert(block.indexOf('AskUserQuestion') >= 0, 'it is not warned off AskUserQuestion');
    assert(block.indexOf('ask()') >= 0, 'it is not pointed at the tool that works');
    assert(block.indexOf('CANNOT DO') >= 0, 'there is no list of what does not work here');
    return 'named the gap and the replacement';
  });

  console.log(
    failed ? `\n${failed} check(s) failed.\n` : '\nAll checks passed — the board is ready.\n'
  );
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(
    'preflight crashed:', err.message
  );
  process.exit(1);
});
