// The `vscode` module only exists inside the editor host. These stubs are the
// slice the extension actually touches, so tests can load it under plain node.
const Module = require('module');

const settings = {
  project: process.env.BOARD_PROJECT || 'METH',
  site: '',
  twgPath: '',
  doneWindowDays: 14,
  refreshSeconds: 0 // no polling under test
};

const recorded = {
  commands: {},
  treeProviders: {},
  panels: [],
  opened: [],
  terminals: [],
  errors: []
};

function uri(path) {
  return { path, fsPath: path, toString: () => path, with: () => uri(path) };
}

/** Stands in for a WebviewPanel's `.webview`. */
function makeWebview() {
  const state = { html: '', messages: [], handler: null };
  const webview = {
    cspSource: 'vscode-resource://stub',
    options: {},
    asWebviewUri: (u) => uri('vscode-resource://stub' + u.path),
    onDidReceiveMessage: (fn) => {
      state.handler = fn;
      return { dispose() {} };
    },
    postMessage: (msg) => {
      state.messages.push(msg);
      return Promise.resolve(true);
    }
  };
  Object.defineProperty(webview, 'html', {
    get: () => state.html,
    set: (value) => {
      state.html = value;
    }
  });
  webview.state = state;
  return webview;
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id) {
    this.id = id;
  }
}

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (fn) => {
      this.listeners.push(fn);
      return { dispose() {} };
    };
  }
  fire(value) {
    for (const fn of this.listeners) {
      fn(value);
    }
  }
  dispose() {}
}

const stub = {
  workspace: {
    getConfiguration: () => ({ get: (key) => settings[key] }),
    workspaceFolders: [{ uri: uri(process.cwd()) }]
  },
  commands: {
    registerCommand: (name, handler) => {
      recorded.commands[name] = handler;
      return { dispose() {} };
    },
    executeCommand: (name, ...args) =>
      recorded.commands[name] ? recorded.commands[name](...args) : Promise.resolve()
  },
  window: {
    registerTreeDataProvider: (id, provider) => {
      recorded.treeProviders[id] = provider;
      return { dispose() {} };
    },
    createWebviewPanel: (id, title) => {
      const panel = {
        id,
        title,
        webview: makeWebview(),
        onDidDispose: () => ({ dispose() {} }),
        reveal() {
          panel.revealed = true;
        }
      };
      recorded.panels.push(panel);
      return panel;
    },
    createTerminal: (opts) => {
      const terminal = { opts, sent: [], show() {}, sendText: (t) => terminal.sent.push(t) };
      recorded.terminals.push(terminal);
      return terminal;
    },
    showErrorMessage: (message) => {
      recorded.errors.push(message);
      return Promise.resolve();
    }
  },
  env: {
    openExternal: (u) => {
      recorded.opened.push(String(u.path || u));
      return Promise.resolve(true);
    }
  },
  Uri: {
    joinPath: (base, ...parts) => uri([base.path, ...parts].join('/')),
    parse: (value) => uri(value),
    file: (value) => uri(value)
  },
  ViewColumn: { One: 1, Active: -1 },
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon,
  EventEmitter
};

const load = Module._load;
Module._load = function (request, ...rest) {
  return request === 'vscode' ? stub : load.call(this, request, ...rest);
};

module.exports = { recorded, settings };
