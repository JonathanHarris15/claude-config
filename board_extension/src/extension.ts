import * as vscode from 'vscode';
import { AgentSession, AgentSnapshot, Attachment, MERGE_QUEUE, PermissionLevel } from './agent';
import { openNotes, notesPath } from './notes';
import { cullWorktree, ensureIntegrationWorktree, ensureWorktree, mainBranch, mergesCleanly, worktreeStatus } from './git';
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
  TicketDetail,
  createTicket,
  deleteTicket,
  issueTypes,
  setEpic,
  updateDescription,
  updateSummary
} from './board';
import { fetchSpaces, Space } from './spaces';
import { loadStory, saveStory, tellStory } from './story';
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
    vscode.commands.registerCommand('board.refreshSpaces', () => spaces.refresh()),
    vscode.commands.registerCommand('board.notes', (space?: Space | string) => {
      const key = resolveKey(space);
      const name = typeof space === 'object' && space ? space.name : key;
      return openNotes(key, name);
    })
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
/** A row in the sidebar: a space, or the one page hanging off it. */
type Row = { kind: 'space'; space: Space } | { kind: 'notes'; space: Space };

class SpacesProvider implements vscode.TreeDataProvider<Row> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh() {
    this.changed.fire();
  }

  getTreeItem(row: Row): vscode.TreeItem {
    const { space } = row;
    if (row.kind === 'notes') {
      const item = new vscode.TreeItem('working notes', vscode.TreeItemCollapsibleState.None);
      item.description = `${space.key}.md`;
      item.tooltip = `How tickets move in ${space.name}. Opens ${notesPath(space.key)}`;
      item.iconPath = new vscode.ThemeIcon('book');
      item.command = { command: 'board.notes', title: 'Open working notes', arguments: [space] };
      return item;
    }

    // Expanded, not collapsed: with one page each there is nothing to hide, and
    // a twisty nobody opens is a page nobody reads.
    const item = new vscode.TreeItem(space.key, vscode.TreeItemCollapsibleState.Expanded);
    item.description = space.name;
    item.tooltip = `${space.name} (${space.key})`;
    item.iconPath = new vscode.ThemeIcon('project');
    item.command = { command: 'board.open', title: 'Open Board', arguments: [space] };
    return item;
  }

  async getChildren(row?: Row): Promise<Row[]> {
    if (row) {
      return row.kind === 'space' ? [{ kind: 'notes', space: row.space }] : [];
    }
    try {
      return (await fetchSpaces()).map((space) => ({ kind: 'space' as const, space }));
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
  /** The last detail fetched per ticket, so a story can be written without a second round trip. */
  private readonly details = new Map<string, TicketDetail>();

  private mood = '';
  /** Tickets the merge queue has lined up, in the order it will merge them. */
  private queued: string[] = [];

  private constructor(
    private readonly space: string,
    private readonly extensionUri: vscode.Uri
  ) {
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

    this.paintTab({});
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
        // The merge queue is a conversation, not a ticket: JIRA has nothing on it.
        if (message.key === MERGE_QUEUE) {
          break;
        }
        this.pushWorktree(message.key);
        await this.pushDetail(message.key);
        this.pushStory(message.key);
        break;
      case 'tellStory':
        await this.writeStory(message.key);
        break;
      case 'deleteTicket':
        await this.remove(message.key);
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
      case 'pause':
        AgentSession.get(message.key)?.pause();
        break;
      case 'resume':
        AgentSession.get(message.key)?.resume();
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
      case 'saveSummary':
        await this.saveSummary(message.key, message.summary);
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
      // A ticket that has left In Review is through the door, whether the queue
      // merged it or you moved it yourself. Nothing else clears the line.
      this.queued = this.queued.filter((key) => this.cards.get(key)?.status === 'In Review');

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
        agents: this.paintTab(AgentSession.details(this.space)),
        queue: Boolean(repoFor(this.space)),
        queued: this.queued,
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
      this.details.set(key, detail);
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
    const integrator = ticket === MERGE_QUEUE;

    // Each ticket gets its own checkout, so two agents never tread on each
    // other. If git refuses, fall back to the repo and say so rather than
    // refusing to start.
    let workingDir = cwd;
    try {
      workingDir = integrator ? ensureIntegrationWorktree(cwd).path : ensureWorktree(cwd, ticket).path;
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
        summary: integrator ? 'Merge queue' : card?.summary ?? '',
        status: integrator ? '' : card?.status ?? 'unknown',
        cwd: workingDir,
        role: integrator ? 'integrator' : 'ticket',
        mainBranch: mainBranch(cwd)
      },
      {
        onChange: (snapshot) => this.pushAgent(snapshot),
        refreshBoard: () => {
          void this.pushBoard();
        },
        setQueue: (tickets) => {
          this.queued = tickets.filter((key) => this.cards.has(key));
          void this.pushBoard();
        },
        closeAgent: (key) => {
          if (key === MERGE_QUEUE) {
            return;
          }
          AgentSession.get(key)?.stop();
          void this.pushBoard();
        },
        moveTicket: async (key, column) => {
          await moveTicket(key, column);
          await this.pushBoard();
          this.pushWorktree(key);
        },
        tell: (key, note) => this.tell(key, note),
        queueState: () => this.queueState(cwd),
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
   * A note from the merge queue to a ticket's agent. A running agent hears it
   * now, as a turn. A stopped one gets it written into its conversation on
   * disk, so the next person or agent to open it sees it first — waking a
   * session just to deliver a note would cost real money.
   */
  private async tell(ticket: string, note: string): Promise<string> {
    const live = AgentSession.get(ticket);
    if (live) {
      await live.receive(MERGE_QUEUE, note);
      return `${ticket}'s agent is running and has the note.`;
    }
    const repo = repoFor(this.space);
    if (!repo || !this.cards.has(ticket)) {
      return `${ticket} is not on this board; nothing was told.`;
    }
    const stored = store.load(repo, ticket) ?? {
      ticket,
      space: this.space,
      permissionMode: 'default',
      transcript: [],
      updatedAt: ''
    };
    stored.transcript.push({ role: 'system', text: `${MERGE_QUEUE}: ${note}`, at: new Date().toISOString() });
    store.save(repo, stored);
    return `${ticket}'s agent is not running. The note is in its conversation and will be seen when it is next opened; tell the human if it cannot wait.`;
  }

  /** What the merge queue needs to decide an order: every In Review branch against main. */
  private async queueState(repo: string): Promise<string> {
    const main = mainBranch(repo);
    const waiting = [...this.cards.values()].filter((card) => card.status === 'In Review');
    if (!waiting.length) {
      return 'Nothing is In Review.';
    }
    const lines = waiting.map((card) => {
      const status = worktreeStatus(repo, card.key);
      const clean = status.branch ? mergesCleanly(repo, status.branch) : undefined;
      const hold = card.labels.includes('hold') ? ' · LABELLED hold — do not merge' : '';
      if (!status.exists || !status.branch) {
        return `- ${card.key} "${card.summary}": no branch or worktree found locally — fetch, or ask the human${hold}`;
      }
      return (
        `- ${card.key} "${card.summary}": branch ${status.branch}, ${status.ahead} ahead / ${status.behind} behind ${main}, ` +
        (status.dirty ? `${status.dirtyFiles} files UNCOMMITTED in its worktree, ` : '') +
        (status.merged ? 'already merged' : clean === undefined ? 'merge check unavailable' : clean ? 'merges cleanly' : 'CONFLICTS with ' + main) +
        (AgentSession.get(card.key) ? ' · its agent is running' : '') +
        hold
      );
    });
    return `In Review, trunk ${main}:\n${lines.join('\n')}`;
  }

  /**
   * The only transition a person drives from here. Everything else moves
   * because an agent moved it.
   */
  /**
   * Done is not ours to declare from In Review. The branch still has to land in
   * the main branch, and until it does, "finished" is a claim the repo does not
   * support. The merge queue is the one agent allowed to move a ticket to Done,
   * and it does it after the merge is pushed and green.
   *
   * So this hands the ticket over and leaves it exactly where it is. The queue
   * moves it when it lands, or says why it could not. The worktree stays for
   * the same reason: there is still a branch to merge.
   */
  private async complete(ticket: string) {
    const repo = repoFor(this.space);
    if (!repo) {
      void this.panel.webview.postMessage({
        type: 'error',
        message:
          `No repo is configured for ${this.space}, so there is no merge queue to hand ` +
          `${ticket} to. Set board.repos, or move the card to Done yourself.`
      });
      return;
    }

    const session = await this.openAgent(MERGE_QUEUE);
    if (!session) {
      return;
    }
    if (!this.queued.includes(ticket)) {
      this.queued.push(ticket);
      void this.pushBoard();
    }
    try {
      await session.send(`merge ${ticket}`);
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
      const why = describe(err);
      // A column the space's workflow has never heard of fails every time and
      // for one reason, so say the reason rather than passing JIRA's wording on.
      const unknown = /transition|status/i.test(why) && !/permission|resolution|required/i.test(why);
      void this.panel.webview.postMessage({
        type: 'error',
        message: unknown
          ? `JIRA would not move ${ticket} to "${column}": the ${this.space} workflow has ` +
            `no such status. Add it in JIRA — Project settings, Workflows — or move the ` +
            `card somewhere the workflow knows.

${why}`
          : `JIRA would not move ${ticket}: ${why}`
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

  /**
   * The story on disk, if one has been written. Stale means the log has moved
   * on since; the panel offers a rewrite rather than doing one unasked, because
   * a story costs a model call.
   */
  private pushStory(ticket: string) {
    const repo = repoFor(this.space);
    const story = repo ? loadStory(repo, ticket) : undefined;
    const entries = this.details.get(ticket)?.timeline.length ?? 0;
    void this.panel.webview.postMessage({
      type: 'story',
      key: ticket,
      story: story ?? null,
      stale: Boolean(story && entries > story.entries),
      canWrite: Boolean(repo),
      writing: false
    });
  }

  /** Ask Claude for the retelling, save it in the repo, show it. */
  private async writeStory(ticket: string) {
    const repo = repoFor(this.space);
    const card = this.cards.get(ticket);
    if (!repo || !card) {
      void this.panel.webview.postMessage({
        type: 'error',
        message:
          `No repo is configured for ${this.space}, so there is nowhere to keep ${ticket}'s story. ` +
          'Set "board.repos" in settings to point it at a checkout.'
      });
      return;
    }
    void this.panel.webview.postMessage({ type: 'story', key: ticket, story: null, stale: false, canWrite: true, writing: true });
    try {
      const detail = this.details.get(ticket) ?? (await fetchDetail(ticket));
      this.details.set(ticket, detail);
      const transcript =
        AgentSession.get(ticket)?.snapshot().transcript ?? store.load(repo, ticket)?.transcript ?? [];
      const story = await tellStory({ ticket: card, detail, transcript, repo });
      saveStory(repo, story);
      void this.panel.webview.postMessage({ type: 'story', key: ticket, story, stale: false, canWrite: true, writing: false });
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
      this.pushStory(ticket);
    }
  }

  /**
   * Delete a ticket. The one destructive action on the board, so it goes
   * through the editor's own modal rather than a button that can be clicked
   * twice by accident. A live agent is stopped first; its worktree is left
   * alone, because deleting a ticket must never delete work.
   */
  private async remove(ticket: string) {
    const card = this.cards.get(ticket);
    const choice = await vscode.window.showWarningMessage(
      `Delete ${ticket}${card ? ` — "${card.summary}"` : ''}?`,
      {
        modal: true,
        detail: 'This removes the ticket and its sub-tasks from JIRA. It cannot be undone. Any worktree stays on disk.'
      },
      'Delete'
    );
    if (choice !== 'Delete') {
      return;
    }
    try {
      AgentSession.get(ticket)?.stop();
      await deleteTicket(ticket);
      this.cards.delete(ticket);
      this.details.delete(ticket);
      void this.panel.webview.postMessage({ type: 'deleted', key: ticket });
      await this.pushBoard();
    } catch (err) {
      void this.panel.webview.postMessage({
        type: 'error',
        message: `JIRA would not delete ${ticket}: ${describe(err)}`
      });
    }
  }

  /** Branch, drift and merge state for the selected ticket. */
  private pushWorktree(ticket: string) {
    const repo = repoFor(this.space);
    if (!repo || ticket === MERGE_QUEUE) {
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
  /**
   * The tab is the only part of the board you can see while you are reading
   * code, so it carries the one fact worth interrupting for: whether anything
   * wants you. Grey is nothing happening, blue is busy, green is finished,
   * amber is a question, red is a crash.
   *
   * The order is the rail's order. A question outranks a crash because a
   * question is the thing that is actually blocked on you; a crashed agent has
   * already stopped and will still be stopped in a minute.
   *
   * Returns what it was given, so the push sites read as one line.
   */
  private paintTab<T extends Record<string, { state: string }>>(agents: T): T {
    const states = Object.values(agents).map((info) => info.state);
    const mood =
      states.includes('asking') ? 'asking'
        : states.includes('error') ? 'error'
          : states.includes('done') ? 'done'
            : states.some((s) => s === 'thinking' || s === 'working' || s === 'waiting')
              ? 'working'
              : 'idle';

    // Reassigning iconPath redraws the tab, so only do it when it changed.
    if (mood !== this.mood) {
      this.mood = mood;
      this.panel.iconPath = vscode.Uri.joinPath(
        this.extensionUri, 'media', `board-icon-${mood}.svg`
      );
    }
    return agents;
  }

  private pushAgent(snapshot: AgentSnapshot) {
    void this.panel.webview.postMessage({
      type: 'agent',
      snapshot,
      agents: this.paintTab(AgentSession.details(this.space))
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
  /** Rename. Refused empty, because JIRA takes it and the card goes blank. */
  private async saveSummary(ticket: string, summary: string) {
    const trimmed = (summary ?? '').trim();
    if (!trimmed) {
      void this.panel.webview.postMessage({
        type: 'error', message: 'A ticket needs a title. The rename was not saved.'
      });
      void this.panel.webview.postMessage({ type: 'renameFailed', key: ticket });
      await this.pushDetail(ticket);
      return;
    }
    try {
      await updateSummary(ticket, trimmed);
      void this.panel.webview.postMessage({ type: 'saved', key: ticket });
      await this.pushDetail(ticket);
      await this.pushBoard();
    } catch (err) {
      void this.panel.webview.postMessage({ type: 'error', message: describe(err) });
      // The panel is showing a name JIRA rejected; put the real one back, on
      // the card as well as in the panel.
      void this.panel.webview.postMessage({ type: 'renameFailed', key: ticket });
      await this.pushDetail(ticket);
      await this.pushBoard();
    }
  }

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
    <header class="bd-topbar">
      <div class="bd-topbar-title">
        <span class="bd-topbar-space">${space}</span>
        <span id="count" class="bd-topbar-count"></span>
      </div>
      <input id="search" class="bd-search" type="text" placeholder="Filter tickets…"
             spellcheck="false" aria-label="Filter tickets" />
      <div id="rail" class="bd-rail" aria-label="Live agents"></div>
      <button id="refreshBtn" class="bd-iconbtn" type="button" title="Refresh from JIRA">&#x21bb;</button>
      <div id="queue" class="bd-queue" aria-label="Merge queue" hidden></div>
    </header>
    <div id="error" class="bd-error" hidden></div>
    <div class="bd-body">
      <div id="columns" class="bd-columns"></div>
      <div id="resizer" class="bd-resizer" hidden></div>
      <aside id="detail" class="bd-detail" hidden></aside>
    </div>
    <footer class="bd-status">
      <span id="status"></span>
      <span id="space" class="bd-status-hint">drag a card to move it · click one to talk to it</span>
    </footer>
  </div>
  <script nonce="${nonce}" src="${md}"></script>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}
