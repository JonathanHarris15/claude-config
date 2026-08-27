import * as vscode from 'vscode';
import { AgentSession, AgentSnapshot, Attachment, PermissionLevel } from './agent';
import { cullWorktree, ensureWorktree, worktreeStatus } from './git';
import { listSkills } from './skills';
import * as store from './store';
import {
  COLUMNS,
  defaultSpace,
  fetchBoard,
  fetchDetail,
  moveTicket,
  repoFor,
  Ticket,
  createTicket,
  issueTypes,
  setEpic,
  updateDescription
} from './board';
import { fetchSpaces, Space } from './spaces';
import { TwgError } from './twg';

/**
 * The sidebar lists JIRA spaces. Picking one opens that space's board as an
 * editor tab — the board itself is never a side panel, it needs the width.
 */
export function activate(context: vscode.ExtensionContext) {
  const spaces = new SpacesProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('board.spaces', spaces),
    vscode.commands.registerCommand('board.open', (space?: Space | string) =>
      BoardPanel.open(resolveKey(space), context.extensionUri)
    ),
    vscode.commands.registerCommand('board.refresh', () => BoardPanel.refreshAll()),
    vscode.commands.registerCommand('board.refreshSpaces', () => spaces.refresh())
  );
}

export function deactivate() {
  AgentSession.stopAll();
  BoardPanel.disposeAll();
}

function resolveKey(space?: Space | string): string {
  if (!space) {
    return defaultSpace();
  }
  return typeof space === 'string' ? space : space.key;
}

/** The sidebar: one row per JIRA space. */
class SpacesProvider implements vscode.TreeDataProvider<Space> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh() {
    this.changed.fire();
  }

  getTreeItem(space: Space): vscode.TreeItem {
    const item = new vscode.TreeItem(space.key, vscode.TreeItemCollapsibleState.None);
    item.description = space.name;
    item.tooltip = `${space.name} (${space.key})`;
    item.iconPath = new vscode.ThemeIcon('project');
    item.command = { command: 'board.open', title: 'Open Board', arguments: [space] };
    return item;
  }

  async getChildren(): Promise<Space[]> {
    try {
      return await fetchSpaces();
    } catch (err) {
      void vscode.window.showErrorMessage(describe(err));
      return [];
    }
  }
}

/** One board tab per space, reused when the same space is picked again. */
class BoardPanel {
  private static readonly open_ = new Map<string, BoardPanel>();
  private static poller: NodeJS.Timeout | undefined;

  static open(space: string, extensionUri: vscode.Uri) {
    const existing = BoardPanel.open_.get(space);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    BoardPanel.open_.set(space, new BoardPanel(space, extensionUri));
    BoardPanel.startPolling();
  }

  static refreshAll() {
    for (const board of BoardPanel.open_.values()) {
      void board.pushBoard();
    }
  }

  static disposeAll() {
    BoardPanel.stopPolling();
    BoardPanel.open_.clear();
  }

  private static startPolling() {
    if (BoardPanel.poller) {
      return;
    }
    const seconds = vscode.workspace.getConfiguration('board').get<number>('refreshSeconds') ?? 30;
    if (seconds > 0) {
      BoardPanel.poller = setInterval(() => BoardPanel.refreshAll(), seconds * 1000);
    }
  }

  private static stopPolling() {
    if (BoardPanel.poller) {
      clearInterval(BoardPanel.poller);
      BoardPanel.poller = undefined;
    }
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly cards = new Map<string, Ticket>();
  private types: string[] = [];

  private constructor(private readonly space: string, extensionUri: vscode.Uri) {
    this.panel = vscode.window.createWebviewPanel(
      'board',
      `Board · ${space}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
      }
    );

    this.panel.webview.html = render(this.panel.webview, extensionUri, space);
    this.panel.webview.onDidReceiveMessage((message) => this.handle(message));
    this.panel.onDidDispose(() => {
      BoardPanel.open_.delete(space);
      if (!BoardPanel.open_.size) {
        BoardPanel.stopPolling();
      }
    });
  }

  private async handle(message: any) {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.pushBoard();
        break;
      case 'select':
        this.pushWorktree(message.key);
        await this.pushDetail(message.key);
        break;
      case 'openInJira':
        if (message.url) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case 'plan':
        await this.runSkill(message.key, 'plan-ticket');
        break;
      case 'implement':
        await this.runSkill(message.key, 'implement');
        break;
      case 'chat':
        await this.chat(message.key, message.text, message.images ?? []);
        break;
      case 'mode':
        await (await this.openAgent(message.key))?.setMode(message.mode as PermissionLevel);
        break;
      case 'model':
        await (await this.openAgent(message.key))?.setModel(message.model);
        break;
      case 'interrupt':
        await AgentSession.get(message.key)?.interrupt();
        break;
      case 'complete':
        await this.complete(message.key);
        break;
      case 'createTicket':
        await this.create(message.summary, message.issueType, message.column, message.epic);
        break;
      case 'moveTicket':
        await this.drag(message.key, message.column, message.epic);
        break;
      case 'worktree':
        this.pushWorktree(message.key);
        break;
      case 'cull':
        await this.cull(message.key, Boolean(message.force));
        break;
      case 'permission':
        AgentSession.get(message.key)?.answer(message.id, message.allow);
        break;
      case 'permissionAll':
        AgentSession.get(message.key)?.answerAll(message.allow);
        break;
      case 'answerQuestion':
        AgentSession.get(message.key)?.answerQuestion(message.id, message.answers);
        break;
      case 'stopAgent':
        AgentSession.get(message.key)?.stop();
        break;
      case 'agentState':
        this.pushAgentState(message.key);
        break;
      case 'saveDescription':
        await this.saveDescription(message.key, message.markdown);
        break;
    }
  }

  private async pushBoard() {
    try {
      if (!this.types.length) {
        this.types = await issueTypes(this.space);
      }
      const tickets = await fetchBoard(this.space);
      this.cards.clear();
      for (const ticket of tickets) {
        this.cards.set(ticket.key, ticket);
      }
      // Epics are grouping, never cards, so they ride alongside the columns.
      const epics = new Map<string, string>();
      for (const ticket of tickets) {
        if (ticket.epicKey) {
          epics.set(ticket.epicKey, ticket.epicName ?? ticket.epicKey);
        }
      }

      void this.panel.webview.postMessage({
        type: 'board',
        columns: COLUMNS,
        tickets: group(tickets),
        agents: AgentSession.states(),
        types: this.types,
        epics: [...epics].map(([key, name]) => ({ key, name }))
      });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }

  private async pushDetail(key: string) {
    try {
      const detail = await fetchDetail(key);
      void this.panel.webview.postMessage({ type: 'detail', detail });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }

  /**
   * Open (or reopen) the conversation for a ticket. It behaves like a Claude
   * Code session: the skills are loaded and Plan / Implement are just things
   * said to it. Nothing starts a Claude session until you actually speak.
   */
  private async openAgent(ticket: string): Promise<AgentSession | undefined> {
    const running = AgentSession.get(ticket);
    if (running) {
      return running;
    }

    const cwd = repoFor(this.space);
    if (!cwd) {
      void this.panel.webview.postMessage({
        type: 'error',
        message:
          `No repo is configured for ${this.space}, so its agents have nowhere to run. ` +
          'Set "board.repos" in settings to point it at a checkout.'
      });
      return undefined;
    }

    const card = this.cards.get(ticket);

    // Each ticket gets its own checkout, so two agents never tread on each
    // other. If git refuses, fall back to the repo and say so rather than
    // refusing to start.
    let workingDir = cwd;
    try {
      workingDir = ensureWorktree(cwd, ticket).path;
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'error',
        message: `Could not make a worktree for ${ticket}, so it is running in the repo itself: ${describe(err)}`
      });
    }

    const session = new AgentSession(
      {
        ticket,
        space: this.space,
        summary: card?.summary ?? '',
        status: card?.status ?? 'unknown',
        cwd: workingDir
      },
      {
        onChange: (snapshot) => this.pushAgent(snapshot),
        refreshBoard: () => {
          void this.pushBoard();
        },
        moveTicket: async (key, column) => {
          await moveTicket(key, column);
          await this.pushBoard();
        },
        persist: (snapshot) =>
          store.save(cwd, {
            ticket,
            space: this.space,
            sessionId: snapshot.sessionId,
            permissionMode: snapshot.permissionMode,
            model: snapshot.model,
            transcript: snapshot.transcript,
            updatedAt: ''
          })
      }
    );

    const stored = store.load(cwd, ticket);
    if (stored) {
      session.restore(
        stored.transcript,
        stored.sessionId,
        stored.permissionMode as PermissionLevel,
        stored.model
      );
    }
    return session;
  }

  /**
   * The only transition a person drives from here. Everything else moves
   * because an agent moved it.
   */
  private async complete(ticket: string) {
    try {
      await moveTicket(ticket, 'Done');

      const repo = repoFor(this.space);
      if (repo) {
        const culled = cullWorktree(repo, ticket);
        if (!culled.removed && culled.reason !== 'no worktree') {
          void this.panel.webview.postMessage({
            type: 'error',
            message:
              `${ticket} is Done, but its worktree was kept: ${culled.reason}. ` +
              'Nothing was deleted — merge or discard the branch, then cull it from the panel.'
          });
        }
      }

      await this.pushBoard();
      await this.pushDetail(ticket);
      this.pushWorktree(ticket);
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }

  /**
   * A card dragged to another column. This is the human overruling everything:
   * no PRD check, no agent opinion. If JIRA refuses the transition we say so
   * and re-read, which snaps the card back to the truth.
   */
  private async drag(ticket: string, column: string, epic?: string | null) {
    const card = this.cards.get(ticket);

    try {
      if (card && card.status !== column) {
        await moveTicket(ticket, column);
      }
      // Dropping into another swimlane means what it looks like: a new epic,
      // or none at all in the unparented lane.
      if (epic !== undefined && card && (card.epicKey ?? null) !== epic) {
        await setEpic(ticket, epic);
      }
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'error',
        message: `JIRA would not move ${ticket}: ${describe(err)}`
      });
    }

    await this.pushBoard();
    this.pushWorktree(ticket);
  }

  /** Make a ticket straight into a column. */
  private async create(summary: string, type: string, column: string, epic?: string) {
    const text = String(summary ?? '').trim();
    if (!text) {
      return;
    }
    try {
      const key = await createTicket({
        space: this.space,
        type: type || this.types[0] || 'Task',
        summary: text,
        epic: epic || undefined,
        column
      });
      await this.pushBoard();
      void this.panel.webview.postMessage({ type: 'created', key });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }

  /** Branch, drift and merge state for the selected ticket. */
  private pushWorktree(ticket: string) {
    const repo = repoFor(this.space);
    if (!repo) {
      return;
    }
    try {
      void this.panel.webview.postMessage({ type: 'worktree', status: worktreeStatus(repo, ticket) });
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'worktree',
        status: { ticket, exists: false, dirty: false, ahead: 0, behind: 0, merged: false, mainBranch: 'main', error: describe(err) }
      });
    }
  }

  private async cull(ticket: string, force: boolean) {
    const repo = repoFor(this.space);
    if (!repo) {
      return;
    }
    const result = cullWorktree(repo, ticket, force);
    if (!result.removed) {
      void this.panel.webview.postMessage({
        type: 'error',
        message: `Worktree kept: ${result.reason}`
      });
    }
    this.pushWorktree(ticket);
  }

  private async runSkill(ticket: string, skill: string) {
    const session = await this.openAgent(ticket);
    if (!session) {
      return;
    }
    try {
      await session.runSkill(skill);
    } catch (err) {
      session.stop();
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }

  private async chat(ticket: string, text: string, images: Attachment[]) {
    const session = await this.openAgent(ticket);
    if (!session) {
      return;
    }
    try {
      await session.send(text, images);
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }
  private pushAgent(snapshot: AgentSnapshot) {
    void this.panel.webview.postMessage({
      type: 'agent',
      snapshot,
      agents: AgentSession.states()
    });

    // The skills move tickets through JIRA themselves, so the board cannot
    // rely on move_ticket being called. Re-read when a turn ends, rather than
    // leaving the card stale until the next poll.
    if (snapshot.state === 'done' || snapshot.state === 'error') {
      void this.pushBoard();
      this.pushWorktree(snapshot.ticket);
    }
  }

  /**
   * Selecting a ticket shows its conversation even when nothing is running:
   * the transcript was written to the repo, so a reopened window picks up
   * where the last one left off.
   */
  private pushAgentState(ticket: string) {
    const session = AgentSession.get(ticket);
    if (session) {
      this.pushAgent(session.snapshot());
      return;
    }

    const cwd = repoFor(this.space);
    const stored = cwd ? store.load(cwd, ticket) : undefined;
    this.pushAgent({
      ticket,
      state: 'idle',
      transcript: stored?.transcript ?? [],
      asks: [],
      sessionId: stored?.sessionId,
      permissionMode: (stored?.permissionMode as PermissionLevel) ?? 'default',
      started: false,
      model: stored?.model,
      models: [],
      // The slash menu works before anything is running.
      commands: listSkills(cwd)
    });
  }

  /**
   * Write an edited description back to JIRA. The panel only offers this when
   * the description round-tripped cleanly to Markdown, so nothing structural
   * is lost here — see adf.ts.
   */
  private async saveDescription(ticket: string, markdown: string) {
    try {
      await updateDescription(ticket, markdown);
      void this.panel.webview.postMessage({ type: 'saved', key: ticket });
      await this.pushDetail(ticket);
      await this.pushBoard();
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
    }
  }
}


/** Tickets whose status is not one of the six land in "Other" rather than vanishing. */
function group(tickets: Ticket[]): Record<string, Ticket[]> {
  const buckets: Record<string, Ticket[]> = {};
  for (const column of COLUMNS) {
    buckets[column] = [];
  }
  for (const ticket of tickets) {
    const column = (COLUMNS as readonly string[]).includes(ticket.status) ? ticket.status : 'Other';
    (buckets[column] ??= []).push(ticket);
  }
  return buckets;
}

function describe(err: unknown): string {
  if (err instanceof TwgError) {
    return err.stderr ? `${err.message}\n\n${err.stderr}` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function render(webview: vscode.Webview, root: vscode.Uri, space: string): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(root, 'media', 'board.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(root, 'media', 'board.js'));
  const md = webview.asWebviewUri(vscode.Uri.joinPath(root, 'media', 'markdown.js'));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const nonce = Array.from({ length: 32 }, () =>
    alphabet.charAt(Math.floor(Math.random() * alphabet.length))
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
<link href="${css}" rel="stylesheet">
<title>Board ${space}</title>
</head>
<body>
  <div class="bd-shell">
    <div id="error" class="bd-error" hidden></div>
    <div class="bd-body">
      <div id="columns" class="bd-columns"></div>
      <div id="resizer" class="bd-resizer" hidden></div>
      <aside id="detail" class="bd-detail" hidden></aside>
    </div>
    <footer class="bd-status">
      <span id="status"></span>
      <span id="space">${space}</span>
    </footer>
  </div>
  <script nonce="${nonce}" src="${md}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}
