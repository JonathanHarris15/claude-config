import { z } from 'zod';
import { COLUMNS } from './board';
import { Command, listSkills } from './skills';

/**
 * The SDK is ESM-only and this extension compiles to CommonJS. TypeScript
 * rewrites a real `import()` into `require()`, which cannot load it — so the
 * import is hidden inside a Function the compiler will not touch.
 */
const esmImport = new Function('spec', 'return import(spec)') as (spec: string) => Promise<any>;

let sdkPromise: Promise<any> | undefined;

export function sdk(): Promise<any> {
  sdkPromise ??= esmImport('@anthropic-ai/claude-agent-sdk');
  return sdkPromise;
}

/** What an agent is doing right now. `asking` means the ticket is waiting on you. */
export type AgentState = 'idle' | 'thinking' | 'working' | 'asking' | 'done' | 'error';

/**
 * The same four levels Claude Code offers. `plan` lets the agent read and think
 * but never act, which is the right default for a ticket nobody has specced.
 */
export type PermissionLevel = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export const PERMISSION_LEVELS: { value: PermissionLevel; label: string }[] = [
  { value: 'default', label: 'ask every time' },
  { value: 'acceptEdits', label: 'edits without asking' },
  { value: 'plan', label: 'plan only, no changes' },
  { value: 'bypassPermissions', label: 'never ask' }
];

export interface ChatEntry {
  role: 'you' | 'agent' | 'tool' | 'system';
  text: string;
  at: string;
  /** How many images rode along with this message, for redrawing the log. */
  images?: number;
}

/** An image pasted or dropped into the chat box. */
export interface Attachment {
  mediaType: string;
  data: string;
}

/** A question the agent asked, held until you pick an answer. */
export interface PendingQuestion {
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  multiple: boolean;
}

/** A tool the agent wants to run, held until you allow or deny it. */
export interface PendingAsk {
  id: string;
  tool: string;
  summary: string;
}

/** What the session can do, read from the running session where possible. */
export interface ModelChoice {
  value: string;
  displayName: string;
  description: string;
}

export interface ContextUsage {
  percentage: number;
  totalTokens: number;
  maxTokens: number;
}

/** One agent as the board-wide rail sees it. */
export interface AgentInfo {
  state: AgentState;
  since?: number;
  doing?: string;
}

export interface AgentSnapshot {
  ticket: string;
  state: AgentState;
  transcript: ChatEntry[];
  /** Every tool request being held, oldest first. */
  asks: PendingAsk[];
  /** The question waiting on you, if any. */
  question?: PendingQuestion;
  sessionId?: string;
  permissionMode: PermissionLevel;
  /** True once a Claude session is actually running behind this conversation. */
  started: boolean;
  model?: string;
  models: ModelChoice[];
  /** Text arriving right now, before the message is complete. */
  streaming?: string;
  /** When the current burst of work started, so the panel can tick. */
  since?: number;
  /** The tool running right now, for the activity line. */
  doing?: string;
  /** The slash menu: local skills until a session can be asked for the real list. */
  commands: Command[];
  context?: ContextUsage;
}

/**
 * Feeds typed messages into a running session. `query` takes an async iterable
 * as its prompt, so the session stays open and the box in the panel pushes
 * into this.
 */
class InputQueue {
  private readonly queued: any[] = [];
  private waiting?: (value: IteratorResult<any>) => void;
  private closed = false;

  push(content: any) {
    const message = {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      origin: { kind: 'human' }
    };
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: message, done: false });
    } else {
      this.queued.push(message);
    }
  }

  close() {
    this.closed = true;
    if (this.waiting) {
      this.waiting({ value: undefined, done: true });
      this.waiting = undefined;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<any> {
    while (true) {
      if (this.queued.length) {
        yield this.queued.shift();
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<any>>((resolve) => {
        this.waiting = resolve;
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

/** One-line summary of a tool call, for the transcript and the permission prompt. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const short = name.replace(/^mcp__[^_]+__/, '');
  const value =
    (input.command as string) ??
    (input.file_path as string) ??
    (input.pattern as string) ??
    (input.column as string) ??
    (input.key as string) ??
    '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? `${short}: ${text.slice(0, 120)}` : short;
}

export const BOARD_COLUMNS = COLUMNS;

/**
 * Tool names that can move a ticket. The skills transition tickets through
 * JIRA directly as well as through move_ticket, so the board watches for both
 * rather than trusting one path.
 */
const TOUCHES_BOARD = /transition|move_ticket|jira|workitem/i;

export interface AgentHooks {
  /** Fired whenever state or transcript changes, so the UI can repaint. */
  onChange(snapshot: AgentSnapshot): void;
  /** Performs the JIRA transition and refreshes the board. */
  moveTicket(ticket: string, column: string): Promise<void>;
  /** Writes the conversation to the repo. */
  persist(snapshot: AgentSnapshot): void;
  /** Re-read the board, because something just changed the ticket in JIRA. */
  refreshBoard(): void;
}

export interface AgentContext {
  ticket: string;
  space: string;
  summary: string;
  status: string;
  cwd: string;
}

/**
 * One conversation, bound to one ticket. It behaves like a Claude Code session
 * rather than a one-shot command: the skills are loaded, you talk to it, and
 * /plan-ticket or /implement are just things you say to it.
 */
export class AgentSession {
  private static readonly live = new Map<string, AgentSession>();

  static get(ticket: string): AgentSession | undefined {
    return AgentSession.live.get(ticket);
  }

  static states(): Record<string, AgentState> {
    const out: Record<string, AgentState> = {};
    for (const [ticket, session] of AgentSession.live) {
      out[ticket] = session.state;
    }
    return out;
  }

  /**
   * The board-wide view of every live agent: state, when the current burst of
   * work started, and the tool running right now. This is what the agent rail
   * in the top bar draws, so "what is waiting on me" is answered without
   * hunting through six columns.
   */
  static details(): Record<string, AgentInfo> {
    const out: Record<string, AgentInfo> = {};
    for (const [ticket, session] of AgentSession.live) {
      out[ticket] = { state: session.state, since: session.since, doing: session.doing };
    }
    return out;
  }

  static stopAll() {
    for (const session of AgentSession.live.values()) {
      session.stop();
    }
    AgentSession.live.clear();
  }

  private readonly input = new InputQueue();
  private transcript: ChatEntry[] = [];
  private state: AgentState = 'idle';
  private queue: { ask: PendingAsk; decide: (allow: boolean) => void }[] = [];
  private askSeq = 0;
  private held?: { question: PendingQuestion; resolve: (answers: string[] | null) => void };
  private sessionId?: string;
  private stream?: any;
  private mode: PermissionLevel = 'default';
  private model?: string;
  private models: ModelChoice[] = [];
  private commands: Command[] = [];
  private usage?: ContextUsage;
  private boardDirty = false;
  private streaming = '';
  private since?: number;
  private doing?: string;
  private lastPaint = 0;

  constructor(
    private readonly context: AgentContext,
    private readonly hooks: AgentHooks
  ) {
    AgentSession.live.set(context.ticket, this);
    // Seed the slash menu from disk so it works before anything is running.
    this.commands = listSkills(context.cwd);
  }

  get ticket(): string {
    return this.context.ticket;
  }

  /** Reopen a conversation written to the repo by an earlier window. */
  restore(transcript: ChatEntry[], sessionId?: string, mode?: PermissionLevel, model?: string) {
    this.transcript = transcript.slice();
    this.sessionId = sessionId;
    if (mode) {
      this.mode = mode;
    }
    if (model) {
      this.model = model;
    }
    this.changed(false);
  }

  snapshot(): AgentSnapshot {
    return {
      ticket: this.context.ticket,
      state: this.state,
      transcript: this.transcript,
      asks: this.queue.map((entry) => entry.ask),
      question: this.held?.question,
      sessionId: this.sessionId,
      permissionMode: this.mode,
      started: Boolean(this.stream),
      model: this.model,
      models: this.models,
      streaming: this.streaming || undefined,
      since: this.since,
      doing: this.doing,
      commands: this.commands,
      context: this.usage
    };
  }

  /** Anything typed into the chat box, with any images that came with it. */
  async send(text: string, images: Attachment[] = []) {
    await this.ensureStream();
    this.record('you', text, images.length);

    if (!images.length) {
      this.input.push(text);
    } else {
      this.input.push([
        ...images.map((image) => ({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data }
        })),
        { type: 'text', text }
      ]);
    }
    this.setState('thinking');
  }

  /** Plan and Implement are just things you say to an open conversation. */
  async runSkill(skill: string) {
    await this.send(`/${skill} ${this.context.ticket}`);
  }

  async setMode(mode: PermissionLevel) {
    this.mode = mode;
    if (this.stream?.setPermissionMode) {
      try {
        await this.stream.setPermissionMode(mode);
      } catch {
        // Only supported while streaming; the next session picks it up anyway.
      }
    }
    this.changed();
  }

  /** Switch model mid-conversation, the way /model does in the terminal. */
  async setModel(model: string) {
    this.model = model || undefined;
    if (this.stream?.setModel) {
      try {
        await this.stream.setModel(this.model);
      } catch {
        // Only available while streaming; the next session picks it up.
      }
    }
    this.changed();
  }

  /** Stop what it is doing without ending the conversation. */
  async interrupt() {
    // Anything still held must be released, or its promise outlives the run.
    this.answerAll(false);
    if (this.held) {
      this.answerQuestion(this.held.question.id, null);
    }
    try {
      await this.stream?.interrupt?.();
    } catch {
      // Nothing running is not an error.
    }
    this.setState('idle');
  }

  /** Answer one held tool request. Anything else stays queued. */
  answer(id: string, allow: boolean) {
    const entry = this.queue.find((held) => held.ask.id === id);
    entry?.decide(allow);
  }

  /** Pick an answer to the agent's question. */
  answerQuestion(id: string, answers: string[] | null) {
    if (this.held?.question.id !== id) {
      return;
    }
    const resolve = this.held.resolve;
    this.held = undefined;
    resolve(answers);
    this.setState('working');
  }

  /** Answer everything currently held, in order. */
  answerAll(allow: boolean) {
    for (const entry of [...this.queue]) {
      entry.decide(allow);
    }
  }

  stop() {
    this.input.close();
    void this.stream?.interrupt?.();
    this.stream = undefined;
    AgentSession.live.delete(this.context.ticket);
    this.setState('idle');
  }

  /**
   * The Claude session starts on the first thing you say, not when the panel
   * opens. Startup costs real money, so an unopened ticket should cost nothing.
   */
  private async ensureStream() {
    if (this.stream) {
      return;
    }
    const { query } = await sdk();

    this.stream = query({
      prompt: this.input,
      options: {
        cwd: this.context.cwd,
        resume: this.sessionId,
        permissionMode: this.mode,
        includePartialMessages: true,
        ...(this.model ? { model: this.model } : {}),
        // Omitting settingSources loads user, project and local settings, which
        // is what makes the skills in ~/.claude/skills available here.
        skills: 'all',
        canUseTool: (name: string, input: Record<string, unknown>) =>
          this.requestPermission(name, input),
        mcpServers: { board: await this.boardTools() }
      }
    });

    void this.consume();
  }

  /**
   * Ask the running session what it actually offers, rather than hardcoding a
   * model list or a command list that will drift. The local skill scan seeded
   * the menu; this replaces it with the authoritative one, which also carries
   * the built-in commands.
   */
  private async loadCapabilities() {
    try {
      const models = await this.stream?.supportedModels?.();
      if (Array.isArray(models)) {
        this.models = models.map((model: any) => ({
          value: model.value,
          displayName: model.displayName ?? model.value,
          description: model.description ?? ''
        }));
      }
    } catch {
      // An older CLI may not answer; the picker just stays empty.
    }

    try {
      const commands = await this.stream?.supportedCommands?.();
      if (Array.isArray(commands) && commands.length) {
        this.commands = commands.map((command: any) => ({
          name: command.name,
          description: command.description ?? '',
          argumentHint: command.argumentHint ?? '',
          source: 'built-in' as const
        }));
      }
    } catch {
      // Keep the skills read off disk.
    }

    await this.readContextUsage();
    this.changed();
  }

  /** How full the context window is, for the meter under the composer. */
  private async readContextUsage() {
    try {
      const usage = await this.stream?.getContextUsage?.();
      if (usage && typeof usage.percentage === 'number') {
        this.usage = {
          percentage: usage.percentage,
          totalTokens: usage.totalTokens,
          maxTokens: usage.maxTokens
        };
        this.changed();
      }
    } catch {
      // Not fatal; the meter just does not show.
    }
  }

  private async consume() {
    try {
      for await (const message of this.stream) {
        this.handle(message);
      }
    } catch (err) {
      this.record('system', err instanceof Error ? err.message : String(err));
      this.setState('error');
    }
  }

  private handle(message: any) {
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionId = message.session_id;
      void this.loadCapabilities();
      this.changed();
      return;
    }

    if (message.type === 'stream_event') {
      const event = message.event;
      if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        this.streaming += event.delta.text ?? '';
        this.paintThrottled();
      }
      if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        this.doing = event.content_block.name;
        this.changed(false);
      }
      return;
    }

    if (message.type === 'user' && this.boardDirty) {
      this.boardDirty = false;
      this.hooks.refreshBoard();
      return;
    }

    if (message.type === 'assistant') {
      this.streaming = '';
      for (const block of message.message?.content ?? []) {
        if (block.type === 'text' && block.text.trim()) {
          this.record('agent', block.text);
        }
        if (block.type === 'tool_use') {
          this.record('tool', describeTool(block.name, block.input ?? {}));
          this.setState('working');
        }
      }
      return;
    }

    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        this.record('system', `run ended: ${message.subtype}`);
      }
      void this.readContextUsage();
      this.setState('done');
    }
  }

  /**
   * Claude asks for several tools at once. Holding one pending request in a
   * single field meant the second overwrote the first, whose promise never
   * resolved and whose turn therefore hung forever. They queue.
   */
  private requestPermission(
    name: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<any> {
    // The board's own tools are ours; asking about them is noise.
    if (name.startsWith('mcp__board__')) {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }

    return new Promise((resolve) => {
      const ask: PendingAsk = {
        id: `${this.context.ticket}-${++this.askSeq}`,
        tool: name,
        summary: describeTool(name, input)
      };

      const settle = (outcome: any) => {
        const index = this.queue.findIndex((entry) => entry.ask.id === ask.id);
        if (index < 0) {
          return; // already answered
        }
        this.queue.splice(index, 1);
        resolve(outcome);
        this.present();
      };

      this.queue.push({
        ask,
        decide: (allow: boolean) =>
          settle(
            allow
              ? { behavior: 'allow', updatedInput: input }
              : { behavior: 'deny', message: 'You declined this in the board panel.' }
          )
      });

      // An interrupted run must not leave a promise nobody will ever resolve.
      options?.signal?.addEventListener('abort', () =>
        settle({ behavior: 'deny', message: 'The run was interrupted.' })
      );

      this.present();
    });
  }

  /** Reflect the queue into the panel. */
  private present() {
    if (this.queue.length) {
      this.setState('asking');
    } else if (this.state === 'asking') {
      this.setState('working');
    } else {
      this.changed();
    }
  }

  /**
   * Board tools run in the extension host, so the agent moving its ticket and
   * the card changing colour are the same action. The instructions are how a
   * skill learns it is being run from a board rather than a terminal.
   */
  private async boardTools() {
    const { createSdkMcpServer, tool } = await sdk();
    const columns = BOARD_COLUMNS as unknown as [string, ...string[]];
    const { ticket, space, summary, status } = this.context;

    return createSdkMcpServer({
      name: 'board',
      version: '1.0.0',
      instructions: [
        `You were opened from a ticket board inside VS Code, not a terminal.`,
        `This conversation is bound to ${ticket} in the ${space} space:`,
        `"${summary}", currently in ${status}.`,
        ``,
        `THE BOARD`,
        `Six columns, left to right: ${BOARD_COLUMNS.join(' -> ')}.`,
        `Only level-0 tickets appear; epics are grouping and sub-tasks render`,
        `inside their parent. A ticket may not sit right of To Plan without a`,
        `PRD on it. The full contract is in the plan-ticket skill BOARD.md file;`,
        `read it before moving anything you are unsure about.`,
        ``,
        `MOVING THIS TICKET`,
        `Call move_ticket the moment ${ticket} genuinely changes stage. You may`,
        `also transition it through JIRA directly and the board will notice, but`,
        `move_ticket repaints immediately, so prefer it.`,
        ``,
        `Do NOT move this ticket to Done. In Review is where your work ends; a`,
        `human marks it complete from the board once they have looked at it.`,
        ``,
        `THE HUMAN`,
        `They are watching this conversation in a panel beside the board, and`,
        `they drive you by typing here: /plan-ticket and /implement are things`,
        `they say, not buttons. When you ask to run a tool they see it as a`,
        `prompt on the card, so say plainly what you want and why.`,
        `Use say for a line of progress that should not end your turn.`,
        ``,
        `WHAT THIS PANEL CAN AND CANNOT DO`,
        `It is a chat panel in a sidebar, roughly 380 pixels wide by default,`,
        `not a terminal. What works here:`,
        `- Your replies render as Markdown: headings, lists, code, links.`,
        `- ask() puts a real multiple-choice question in front of them.`,
        `- Permission prompts appear on the card; several at once is fine.`,
        `- They can paste images to you.`,
        ``,
        `What does NOT work here, so do not reach for it:`,
        `- AskUserQuestion. The panel cannot render it and the call is wasted.`,
        `  Use ask() instead.`,
        `- Anything drawing a terminal UI: progress bars, spinners, cursor moves,`,
        `  ANSI colour, box drawing. It is HTML, and it will look like noise.`,
        `- Interactive commands that wait on stdin. Nothing can type into them.`,
        `- Opening an editor, a pager, or a browser and expecting them to see it.`,
        ``,
        `Keep replies short. This is a narrow column beside a board, not a`,
        `full-width terminal, and long prose is hard to read here.`
      ].join('\n'),
      tools: [
        tool(
          'move_ticket',
          `Move ${ticket} to a different column on the board.`,
          { column: z.enum(columns) },
          async ({ column }: { column: string }) => {
            await this.hooks.moveTicket(ticket, column);
            this.record('tool', `moved ${ticket} to ${column}`);
            return { content: [{ type: 'text', text: `${ticket} is now in ${column}.` }] };
          }
        ),
        tool(
          'ask',
          'Ask the human a question with two to five concrete options. Use this ' +
            'instead of AskUserQuestion, which this panel cannot render. Blocks ' +
            'until they choose. Only for decisions you cannot make yourself.',
          {
            question: z.string(),
            options: z
              .array(z.object({ label: z.string(), description: z.string().optional() }))
              .min(2)
              .max(5),
            multiple: z.boolean().optional()
          },
          async ({ question, options, multiple }: any) => {
            if (this.held) {
              return {
                content: [
                  { type: 'text', text: 'A question is already waiting. Ask one at a time.' }
                ]
              };
            }

            const answers = await new Promise<string[] | null>((resolve) => {
              this.held = {
                question: {
                  id: `${ticket}-q${++this.askSeq}`,
                  question,
                  options,
                  multiple: Boolean(multiple)
                },
                resolve
              };
              this.record('agent', question);
              this.setState('asking');
            });

            if (!answers) {
              return {
                content: [{ type: 'text', text: 'They did not answer. Decide it yourself and say why.' }]
              };
            }
            this.record('you', answers.join(', '));
            return { content: [{ type: 'text', text: 'They chose: ' + answers.join(', ') }] };
          }
        ),
        tool(
          'say',
          'Post a short line to the human watching this ticket, without ending your turn.',
          { note: z.string() },
          async ({ note }: { note: string }) => {
            this.record('agent', note);
            return { content: [{ type: 'text', text: 'Shown on the board.' }] };
          }
        )
      ]
    });
  }

  private record(role: ChatEntry['role'], text: string, images = 0) {
    const entry: ChatEntry = { role, text, at: new Date().toISOString() };
    if (images) {
      entry.images = images;
    }
    this.transcript.push(entry);
    this.changed();
  }

  private setState(state: AgentState) {
    const busy = state === 'thinking' || state === 'working';
    if (busy && !this.since) {
      this.since = Date.now();
    }
    if (!busy) {
      this.since = undefined;
      this.doing = undefined;
    }
    this.state = state;
    this.changed();
  }

  /**
   * A delta per token would repaint the panel hundreds of times a second.
   * Ten times a second still reads as live and costs nothing.
   */
  private paintThrottled() {
    const now = Date.now();
    if (now - this.lastPaint < 100) {
      return;
    }
    this.lastPaint = now;
    this.changed(false);
  }

  private changed(persist = true) {
    const snapshot = this.snapshot();
    this.hooks.onChange(snapshot);
    if (persist) {
      this.hooks.persist(snapshot);
    }
  }
}
