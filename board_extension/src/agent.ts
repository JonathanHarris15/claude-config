import { z } from 'zod';
import * as vscode from 'vscode';
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

/**
 * What an agent is doing right now. `asking` means the ticket is waiting on
 * you; `waiting` means it is queued behind another agent for something they
 * cannot both use at once, like the test suite.
 */
export type AgentState =
  'idle' | 'thinking' | 'working' | 'waiting' | 'asking' | 'paused' | 'done' | 'error';

/**
 * The same four levels Claude Code offers. `plan` lets the agent read and think
 * but never act, which is the right default for a ticket nobody has specced.
 */
export type PermissionLevel = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** What "edits without asking" waves through. Everything else still asks. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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

/* ---------------------------------------------------------------------------
   Shared resources. Two agents running the test suite at once can bring the
   machine to its knees, and an agent told to "take turns" forgets one time in
   ten. So the board takes the turn for them: every tool call passes through
   here, and one that touches a shared resource waits for it and holds it until
   the call ends. claim/release exist for anything the patterns do not know.
   --------------------------------------------------------------------------- */

interface Held {
  ticket: string;
  why: string;
  since: number;
}

interface Waiter {
  ticket: string;
  grant: () => void;
  drop: () => void;
}

export class LockTable {
  private readonly held = new Map<string, Held>();
  private readonly waiting = new Map<string, Waiter[]>();

  holder(resource: string): Held | undefined {
    return this.held.get(resource);
  }

  /** Resolves once this ticket holds the resource. Re-entrant for the holder. */
  acquire(resource: string, ticket: string, why: string, signal?: AbortSignal): Promise<void> {
    const current = this.held.get(resource);
    if (!current) {
      this.held.set(resource, { ticket, why, since: Date.now() });
      return Promise.resolve();
    }
    if (current.ticket === ticket) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        ticket,
        grant: () => {
          this.held.set(resource, { ticket, why, since: Date.now() });
          resolve();
        },
        drop: () => reject(new Error(`Stopped waiting for ${resource}.`))
      };
      const queue = this.waiting.get(resource) ?? [];
      queue.push(waiter);
      this.waiting.set(resource, queue);
      signal?.addEventListener('abort', () => {
        const index = queue.indexOf(waiter);
        if (index >= 0) {
          queue.splice(index, 1);
          waiter.drop();
        }
      });
    });
  }

  release(resource: string, ticket: string): boolean {
    const current = this.held.get(resource);
    if (!current || current.ticket !== ticket) {
      return false;
    }
    this.held.delete(resource);
    const next = this.waiting.get(resource)?.shift();
    if (next) {
      next.grant();
    }
    return true;
  }

  /** Everything a ticket holds or waits for goes, so a stopped agent cannot block the rest. */
  releaseAll(ticket: string): void {
    for (const [resource, held] of [...this.held]) {
      if (held.ticket === ticket) {
        this.release(resource, ticket);
      }
    }
    for (const queue of this.waiting.values()) {
      for (const waiter of queue.filter((entry) => entry.ticket === ticket)) {
        queue.splice(queue.indexOf(waiter), 1);
        waiter.drop();
      }
    }
  }

  snapshot(): { resource: string; ticket: string; why: string; since: number; queued: string[] }[] {
    return [...this.held].map(([resource, held]) => ({
      resource,
      ...held,
      queued: (this.waiting.get(resource) ?? []).map((waiter) => waiter.ticket)
    }));
  }
}

export const locks = new LockTable();

/**
 * Which shared resource a Bash command touches, if any. The patterns come from
 * settings so a project with an unusual test runner can name it; the defaults
 * cover the common ones.
 */
const DEFAULT_SHARED: Record<string, string> = {
  tests: '\\b(pytest|npm (run )?test|pnpm test|yarn test|vitest|jest|dotnet test|cargo test|go test|mvn test|gradle test|rspec|phpunit)\\b',
  build: '\\b(npm run build|pnpm build|yarn build|tsc\\b|cargo build|dotnet build|go build|pyinstaller|electron-builder|vsce package|docker build)\\b'
};

export function sharedResource(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName !== 'Bash' || typeof input.command !== 'string') {
    return undefined;
  }
  const configured = vscode.workspace.getConfiguration('board').get<Record<string, string>>('sharedCommands');
  const patterns = configured && Object.keys(configured).length ? configured : DEFAULT_SHARED;
  for (const [resource, pattern] of Object.entries(patterns)) {
    try {
      if (pattern && new RegExp(pattern, 'i').test(input.command)) {
        return resource;
      }
    } catch {
      // A bad pattern in settings should not break every agent.
    }
  }
  return undefined;
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
    (input.ticket as string) ??
    (input.resource as string) ??
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

/** The pseudo-ticket the merge queue conversation lives under, per space. */
export const MERGE_QUEUE = 'MERGE-QUEUE';

/**
 * A ticket agent builds one ticket. The integrator is the merge queue: one per
 * space, it takes what is In Review and threads it back into main.
 */
export type AgentRole = 'ticket' | 'integrator';

export interface AgentHooks {
  /** Fired whenever state or transcript changes, so the UI can repaint. */
  onChange(snapshot: AgentSnapshot): void;
  /** Performs the JIRA transition and refreshes the board. */
  moveTicket(ticket: string, column: string): Promise<void>;
  /** Writes the conversation to the repo. */
  persist(snapshot: AgentSnapshot): void;
  /** Re-read the board, because something just changed the ticket in JIRA. */
  refreshBoard(): void;
  /** Put a note in front of another ticket's agent. Returns what happened. */
  tell?(ticket: string, note: string): Promise<string>;
  /** What is In Review, with each branch's state against main. */
  queueState?(): Promise<string>;
  /** The order the queue is about to work, so the board can show the line. */
  setQueue?(tickets: string[]): void;
  /** The merge landed, so this ticket's agent has nothing left to do. */
  closeAgent?(ticket: string): void;
}

export interface AgentContext {
  ticket: string;
  space: string;
  summary: string;
  status: string;
  cwd: string;
  role?: AgentRole;
  /** The trunk the merge queue threads into. */
  mainBranch?: string;
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
   * Every live agent in one space: state, when the current burst of work
   * started, and the tool running right now. This is what the agent rail in the
   * top bar draws, so "what is waiting on me" is answered without hunting
   * through six columns.
   *
   * Scoped to the space on purpose. Sessions from every board share one map,
   * and a METH board that lists MS agents is answering a question nobody asked.
   */
  static details(space: string): Record<string, AgentInfo> {
    const out: Record<string, AgentInfo> = {};
    for (const [ticket, session] of AgentSession.live) {
      if (session.context.space !== space) {
        continue;
      }
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
  /** Parked. Set by you; released by you. */
  private paused = false;
  /** Tool calls parked by the pause, released in order when it lifts. */
  private parked: (() => void)[] = [];
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
  /** Resources taken on a tool call's behalf, released when that call ends. */
  private readonly heldForTool = new Map<string, string>();

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

  get role(): AgentRole {
    return this.context.role ?? 'ticket';
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

  /**
   * A note from another agent — the merge queue telling a ticket it conflicts,
   * say. It is shown as a system line and handed to the model as a turn.
   */
  async receive(from: string, note: string) {
    await this.ensureStream();
    this.record('system', `${from}: ${note}`);
    this.input.push(`[Note from ${from}] ${note}`);
    this.setState('thinking');
  }

  /** Plan and Implement are just things you say to an open conversation. */
  async runSkill(skill: string) {
    await this.send(`/${skill} ${this.context.ticket}`);
  }

  async setMode(mode: PermissionLevel) {
    this.mode = mode;
    // A prompt already on screen was raised under the old mode. Relaxing the
    // mode has to clear it too, or "never ask" leaves you staring at the very
    // question it was meant to remove.
    if (mode === 'bypassPermissions') {
      this.answerAll(true);
    } else if (mode === 'acceptEdits') {
      for (const entry of [...this.queue]) {
        if (EDIT_TOOLS.has(entry.ask.tool)) {
          entry.decide(true);
        }
      }
    }
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

  /**
   * Park the agent at its next step. Not an interrupt: nothing is thrown away
   * and nothing has to be redone — the run stops at the next tool call and
   * stands there until you let it go. What it is doing right now finishes,
   * because killing a half-written file to honour a button is worse than
   * waiting a second for it.
   */
  pause() {
    if (this.paused) {
      return;
    }
    this.paused = true;
    this.setState('paused');
  }

  resume() {
    if (!this.paused) {
      return;
    }
    this.paused = false;
    const waiting = this.parked;
    this.parked = [];
    for (const release of waiting) {
      release();
    }
    this.setState(waiting.length ? 'working' : this.state === 'paused' ? 'idle' : this.state);
  }

  get isPaused() {
    return this.paused;
  }

  /** Stop what it is doing without ending the conversation. */
  async interrupt() {
    // Anything still held must be released, or its promise outlives the run.
    this.answerAll(false);
    this.paused = false;
    for (const release of this.parked.splice(0)) {
      release();
    }
    if (this.held) {
      this.answerQuestion(this.held.question.id, null);
    }
    locks.releaseAll(this.context.ticket);
    this.heldForTool.clear();
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
    locks.releaseAll(this.context.ticket);
    this.heldForTool.clear();
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
        canUseTool: (name: string, input: Record<string, unknown>, options?: { signal?: AbortSignal }) =>
          this.requestPermission(name, input, options),
        // Hooks run in every permission mode, unlike the prompt above, so the
        // turn-taking cannot be switched off by "never ask".
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [this.beforeTool] }],
          PostToolUse: [{ matcher: 'Bash', hooks: [this.afterTool] }],
          PostToolUseFailure: [{ matcher: 'Bash', hooks: [this.afterTool] }]
        },
        mcpServers: { board: await this.boardTools() }
      }
    });

    void this.consume();
  }

  /** Wait for the shared resource this command needs, and hold it for the call. */
  private readonly beforeTool = async (
    input: any,
    toolUseID: string | undefined,
    options: { signal?: AbortSignal }
  ) => {
    const resource = sharedResource(input.tool_name, input.tool_input ?? {});
    if (!resource || !toolUseID) {
      return {};
    }
    const holder = locks.holder(resource);
    if (holder && holder.ticket !== this.context.ticket) {
      this.doing = `${resource} — ${holder.ticket} has it`;
      this.record('system', `waiting for the ${resource}: ${holder.ticket} is using it (${holder.why})`);
      this.setState('waiting');
    }
    try {
      await locks.acquire(
        resource,
        this.context.ticket,
        describeTool(input.tool_name, input.tool_input ?? {}),
        options?.signal
      );
    } catch {
      return {};
    }
    this.heldForTool.set(toolUseID, resource);
    if (this.state === 'waiting') {
      this.doing = input.tool_name;
      this.setState('working');
    }
    return {};
  };

  private readonly afterTool = async (_input: any, toolUseID: string | undefined) => {
    const resource = toolUseID ? this.heldForTool.get(toolUseID) : undefined;
    if (resource) {
      this.heldForTool.delete(toolUseID as string);
      locks.release(resource, this.context.ticket);
    }
    return {};
  };

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
    } finally {
      locks.releaseAll(this.context.ticket);
      this.heldForTool.clear();
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
          if (TOUCHES_BOARD.test(block.name)) {
            this.boardDirty = true;
          }
          this.setState('working');
        }
      }
      return;
    }

    if (message.type === 'result') {
      if (message.subtype !== 'success') {
        this.record('system', `run ended: ${message.subtype}`);
      }
      // A turn that ends still holding the test suite would block everyone.
      locks.releaseAll(this.context.ticket);
      this.heldForTool.clear();
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

    // Parked before anything else is decided, including "never ask": a pause
    // you can talk your way past is not a pause. The wait resolves when you
    // resume, and the call then goes on to be judged as it would have been.
    if (this.paused) {
      return new Promise<void>((release) => {
        this.parked.push(release);
        this.setState('paused');
        options?.signal?.addEventListener('abort', () => release());
      }).then(() => this.requestPermission(name, input, options));
    }

    // The mode is read here, on every call, rather than trusted to the session
    // it was started with. The SDK is told about a change as well, but a stream
    // already running need not accept one — so this is the gate that decides,
    // and switching mode mid-conversation takes effect on the very next tool.
    if (this.mode === 'bypassPermissions') {
      return Promise.resolve({ behavior: 'allow', updatedInput: input });
    }
    if (this.mode === 'acceptEdits' && EDIT_TOOLS.has(name)) {
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
    const integrator = this.role === 'integrator';

    const shared = [
      `SHARED RESOURCES`,
      `Several agents run on this machine at once. The test suite, a build, a`,
      `dev server port or a database cannot be used by two of them together.`,
      `The board takes turns for you: any Bash command that matches the shared`,
      `patterns (tests, builds) waits until the resource is free, then holds it`,
      `until the command ends. You may see "waiting for the tests" — that is`,
      `normal, do not retry or work around it. For anything the patterns do`,
      `not know (a port, a database, a file lock) call claim(resource, why)`,
      `before and release(resource) after. Claims are dropped when your turn`,
      `ends, so a forgotten release cannot block anyone for long.`,
      ``
    ];

    const panel = [
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
    ];

    const ticketInstructions = [
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
      `Do NOT move this ticket to Done. In Review is where your work ends: the`,
      `merge queue — another agent on this board — threads In Review branches`,
      `back into main and marks them Done. Leave your branch pushed, with the`,
      `PR open, and stop. If the merge queue sends you a note (it appears as a`,
      `system line, "Note from MERGE-QUEUE"), do what it asks in your own`,
      `worktree — usually a rebase onto main to clear a conflict — then push`,
      `and say so.`,
      ``,
      `THE HUMAN`,
      `They are watching this conversation in a panel beside the board, and`,
      `they drive you by typing here: /plan-ticket and /implement are things`,
      `they say, not buttons. When you ask to run a tool they see it as a`,
      `prompt on the card, so say plainly what you want and why.`,
      `Use say for a line of progress that should not end your turn.`,
      ``,
      ...shared,
      ...panel
    ];

    const integratorInstructions = [
      `You are the MERGE QUEUE for the ${space} space, opened from a ticket`,
      `board inside VS Code. Other agents build tickets, each in its own git`,
      `worktree on its own branch, and move them to In Review with a PR open.`,
      `Your job is to thread that work back into ${this.context.mainBranch ?? 'main'}:`,
      `decide the order, merge each branch, make sure the result is green, push,`,
      `and mark each ticket Done. You run in your own worktree on the`,
      `"integration" branch; nobody else touches it.`,
      ``,
      `WHEN THE HUMAN SAYS "plan"`,
      `Call queue_state, read each branch's state against main, look at the PRs`,
      `with gh (approvals, checks, "changes requested"), and answer with the`,
      `order you would merge in and why — smallest and cleanest first, a branch`,
      `that another depends on before the dependant, conflicts last. Do not`,
      `merge anything.`,
      ``,
      `WHEN THE HUMAN SAYS "go" (or "merge", or names tickets)`,
      `First call queue_line with the order you are about to work, so the human`,
      `can see the line forming. Update it whenever the order changes, and call`,
      `it with an empty list when you finish.`,
      `Then, for each ticket in your order:`,
      `1. git fetch; reset your integration branch to origin/${this.context.mainBranch ?? 'main'}.`,
      `2. Merge the ticket branch. If it conflicts and the fix is mechanical,`,
      `   resolve it yourself and say what you chose. If the conflict needs the`,
      `   author's judgment, do not guess: tell(ticket, what conflicts and where)`,
      `   so its agent rebases, skip it this round, and carry on.`,
      `3. Run the test suite. It is a shared resource; you will be made to wait`,
      `   if another agent is in it. Red means stop for that ticket: tell() the`,
      `   ticket what failed and skip it.`,
      `4. Push: git push origin integration:${this.context.mainBranch ?? 'main'}. The PR closes as`,
      `   merged on its own.`,
      `5. move_ticket(ticket, "Done"). You are the one agent allowed to.`,
      `6. close_agent(ticket). Its branch has landed, so its agent has nothing`,
      `   left to build. The conversation is kept; it just stops running.`,
      `Then bring the human's own checkout forward: in the main repo, if it is`,
      `clean, git pull --ff-only; if not, say so and leave it.`,
      ``,
      `RULES`,
      `- Never merge a ticket labelled "hold", one whose PR has changes`,
      `  requested, or one with a failing check. Say which and why.`,
      `- Never force-push, never rewrite ${this.context.mainBranch ?? 'main'}, never touch another ticket's worktree.`,
      `- One ticket at a time. Green before push, every time.`,
      `- Close with a short table: ticket, merged or skipped, one line why.`,
      ``,
      `TALKING TO OTHER AGENTS`,
      `tell(ticket, note) puts a note in front of that ticket's agent. It wakes`,
      `the agent, which costs money, so send one clear note with the file names`,
      `and what you need — not a conversation.`,
      ``,
      ...shared,
      ...panel
    ];

    const tools: any[] = [
      tool(
        'move_ticket',
        integrator
          ? 'Move a ticket to a different column on the board.'
          : `Move ${ticket} to a different column on the board.`,
        integrator ? { ticket: z.string(), column: z.enum(columns) } : { column: z.enum(columns) },
        async ({ column, ticket: which }: { column: string; ticket?: string }) => {
          const target = integrator ? String(which) : ticket;
          await this.hooks.moveTicket(target, column);
          this.record('tool', `moved ${target} to ${column}`);
          return { content: [{ type: 'text', text: `${target} is now in ${column}.` }] };
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
      ),
      tool(
        'claim',
        'Take a turn on a shared resource other agents might be using (a port, a ' +
          'database, a file). Waits until it is free. Tests and builds are claimed ' +
          'for you automatically; use this for anything else.',
        { resource: z.string(), why: z.string() },
        async ({ resource, why }: { resource: string; why: string }) => {
          const holder = locks.holder(resource);
          if (holder && holder.ticket !== ticket) {
            this.doing = `${resource} — ${holder.ticket} has it`;
            this.record('system', `waiting for ${resource}: ${holder.ticket} has it (${holder.why})`);
            this.setState('waiting');
          }
          await locks.acquire(resource, ticket, why);
          if (this.state === 'waiting') {
            this.doing = undefined;
            this.setState('working');
          }
          return { content: [{ type: 'text', text: `You hold ${resource}. Call release when done.` }] };
        }
      ),
      tool(
        'release',
        'Give back a shared resource you claimed.',
        { resource: z.string() },
        async ({ resource }: { resource: string }) => {
          const done = locks.release(resource, ticket);
          return { content: [{ type: 'text', text: done ? `Released ${resource}.` : `You did not hold ${resource}.` }] };
        }
      )
    ];

    if (integrator) {
      tools.push(
        tool(
          'queue_line',
          'Show the human which tickets you are about to merge, in the order you will ' +
            'merge them. Call it when you start and again whenever the order changes; ' +
            'call it with an empty list when you are finished.',
          { tickets: z.array(z.string()) },
          async ({ tickets }: { tickets: string[] }) => {
            this.hooks.setQueue?.(tickets);
            return {
              content: [{
                type: 'text',
                text: tickets.length
                  ? `The board is showing the line: ${tickets.join(', ')}.`
                  : 'The board is showing an empty line.'
              }]
            };
          }
        ),
        tool(
          'close_agent',
          "Shut down a ticket's agent once its branch has landed. Its conversation is " +
            'kept; it just stops running. Only call this after the merge is pushed and ' +
            'the ticket is Done.',
          { ticket: z.string() },
          async ({ ticket: done }: { ticket: string }) => {
            this.hooks.closeAgent?.(done);
            return { content: [{ type: 'text', text: `${done}'s agent is closed.` }] };
          }
        ),
        tool(
          'queue_state',
          'Every ticket In Review with its branch, how far ahead of and behind main it is, ' +
            'whether it merges cleanly, and which shared resources are busy right now.',
          {},
          async () => {
            const text = (await this.hooks.queueState?.()) ?? 'The board has no queue state hook.';
            const busy = locks.snapshot();
            const locksText = busy.length
              ? '\n\nShared resources in use:\n' +
                busy.map((held) => `- ${held.resource}: ${held.ticket} (${held.why})${held.queued.length ? ', waiting: ' + held.queued.join(', ') : ''}`).join('\n')
              : '\n\nNo shared resource is in use right now.';
            return { content: [{ type: 'text', text: text + locksText }] };
          }
        ),
        tool(
          'tell',
          "Put a note in front of another ticket's agent. It wakes that agent, so be " +
            'specific: which files, what to do, then stop.',
          { ticket: z.string(), note: z.string() },
          async ({ ticket: which, note }: { ticket: string; note: string }) => {
            const outcome = (await this.hooks.tell?.(which, note)) ?? 'The board has no tell hook.';
            this.record('tool', `told ${which}: ${note.slice(0, 120)}`);
            return { content: [{ type: 'text', text: outcome }] };
          }
        )
      );
    }

    return createSdkMcpServer({
      name: 'board',
      version: '1.0.0',
      instructions: (integrator ? integratorInstructions : ticketInstructions).join('\n'),
      tools
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
    // An unanswered prompt outranks every progress signal. The model keeps
    // streaming while a tool waits on you — it asks for several tools at once,
    // and the next tool_use block arrives after the first has already put a
    // question on screen. Without this the panel says "working" while the only
    // thing it is doing is waiting for you, which is the one lie it must not
    // tell. Failing and stopping still win: both end the wait.
    if ((this.queue.length || this.held) && state !== 'error' && state !== 'idle') {
      state = 'asking';
    }
    // Parked outranks progress for the same reason a question does: the panel
    // must not report movement that is not happening.
    if (this.paused && state !== 'error' && state !== 'idle' && state !== 'asking') {
      state = 'paused';
    }
    const busy = state === 'thinking' || state === 'working' || state === 'waiting';
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
