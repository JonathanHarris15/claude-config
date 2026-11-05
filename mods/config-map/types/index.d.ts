/** What came of the last press of the button, said in plain words. */
export type Opened = {
  /** The dashboard's address, once it is running. */
  url: string
  /** Where it opened: the app's browser pane, or the machine's own browser. */
  where: 'pane' | 'browser' | ''
  /** Why it did not open, when it did not. */
  trouble: string
}

declare module 'claude-code' {
  interface PluginState {
    'config-map': {
      opened: Shaped<Opened | null>
      isBusy: Shaped<boolean>
    }
  }
}
