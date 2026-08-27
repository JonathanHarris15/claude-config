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

// Links, checked against fixed text rather than whatever JIRA happens to hold.
// Agents hand over deploy URLs in prose, so a bare one has to be clickable, and
// the text is machine-written, so the scheme has to be checked.
(function links() {
  const anchors = (md) => {
    const found = [];
    const walk = (n) => { if (n.tag === 'a') found.push(n); (n.children || []).forEach(walk); };
    global.window.renderMarkdown(md).children.forEach(walk);
    return found;
  };
  const fail = (why) => { console.error('FAILED:', why); process.exit(1); };

  let a = anchors('deployed to https://method-preview.vercel.app/build/12 just now');
  if (a.length !== 1) fail('a bare URL is not a link');
  if (a[0].href !== 'https://method-preview.vercel.app/build/12') fail('bare URL href is ' + a[0].href);

  a = anchors('it is live at https://example.com/x.');
  if (a[0].href !== 'https://example.com/x') fail('the full stop was swallowed: ' + a[0].href);

  a = anchors('see [the build](https://example.com/b) for logs');
  if (a.length !== 1 || a[0].textContent !== 'the build') fail('a markdown link stopped working');

  a = anchors('click [here](javascript:alert(1)) now');
  if (a.length !== 0) fail('a javascript: href became a link');

  a = anchors('run `curl https://example.com` first');
  if (a.length !== 0) fail('a URL inside code became a link');

  console.log('links: bare, trailing stop, markdown, javascript: refused, code left alone');
})();

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
