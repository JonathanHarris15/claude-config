// Renders a real JIRA description through media/markdown.js under a minimal
// DOM shim, so the parser is checked without launching a webview.
require('./stub-vscode');
const fs = require('fs');
const path = require('path');

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._text = null; this.attrs = {}; }
  append(...kids) {
    for (const kid of kids) {
      if (kid && kid.__fragment) this.children.push(...kid.children);
      else this.children.push(kid);
    }
  }
  set textContent(v) { this._text = v; }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  get classList() {
    const self = this;
    return { add: (c) => { self.className = (self.className + ' ' + c).trim(); } };
  }
}

global.document = {
  createElement: (tag) => new El(tag),
  createTextNode: (t) => ({ tag: '#text', textContent: t, children: [], className: '' }),
  createDocumentFragment: () => { const f = new El('#fragment'); f.__fragment = true; return f; }
};
global.window = {};

eval(fs.readFileSync(path.join(__dirname, '..', 'media', 'markdown.js'), 'utf8'));

(async () => {
  const { fetchDetail } = require('../out/board');
  const detail = await fetchDetail('METH-390');
  const tree = global.window.renderMarkdown(detail.description);

  console.log('blocks produced:', tree.children.length);
  const counts = {};
  for (const node of tree.children) counts[node.tag] = (counts[node.tag] || 0) + 1;
  console.log('block types    :', JSON.stringify(counts));

  console.log('\n--- outline ---');
  for (const node of tree.children.slice(0, 12)) {
    const label = node.tag + (node.className ? '.' + node.className.split(' ')[0] : '');
    const inner = node.tag === 'ul' || node.tag === 'ol'
      ? node.children.length + ' items'
      : JSON.stringify(node.textContent.slice(0, 58));
    console.log('  ' + label.padEnd(12) + ' ' + inner);
  }

  // Things that must have survived
  const flat = JSON.stringify(tree.children);
  const links = [];
  const walk = (n) => { if (n.tag === 'a') links.push(n.attrs); (n.children || []).forEach(walk); };
  tree.children.forEach(walk);

  console.log('\nchecks');
  console.log('  headings rendered  :', tree.children.filter((n) => n.tag[0] === 'h').length);
  console.log('  lists rendered     :', tree.children.filter((n) => n.tag === 'ul' || n.tag === 'ol').length);
  console.log('  raw "##" left over :', flat.includes('##') ? 'YES (bug)' : 'no');
  console.log('  raw "**" left over :', flat.includes('**') ? 'YES (bug)' : 'no');
  console.log('  raw "](" left over :', flat.includes('](') ? 'YES (bug)' : 'no');

  const tasks = [];
  const walkTasks = (n) => { if ((n.className || '').includes('md-task')) tasks.push(n.textContent); (n.children || []).forEach(walkTasks); };
  tree.children.forEach(walkTasks);
  console.log('  task items         :', tasks.length);
  if (tasks[0]) console.log('    e.g.', JSON.stringify(tasks[0].slice(0, 60)));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
