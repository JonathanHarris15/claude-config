/** Where one project keeps its tickets, read from its CLAUDE.md config block. */
export type Tracker =
  | { kind: 'notion'; prefix: string; dataSource: string; home?: string }
  | { kind: 'jira'; prefix: string; site: string; cloudId: string }

/** What the hover card shows for one ticket key. */
export type Ticket = {
  key: string
  state: 'loading' | 'ok' | 'missing' | 'error'
  url?: string
  title?: string
  status?: string
  type?: string
  priority?: string
  /** "Sub-task of METH-56", "Epic: Alpha Release" — where the key sits. */
  place?: string
  brief?: string
  error?: string
  /** When it was fetched, in ms; a failed fetch is retried after a while. */
  fetchedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'ticket-peek': { tickets: Shaped<Record<string, Ticket>> }
  }
}
