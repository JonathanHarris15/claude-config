/**
 * A small Markdown renderer for the description tab.
 *
 * It builds DOM nodes rather than assigning innerHTML: a JIRA description is
 * other people's text, and the webview must never be a place where that text
 * can become markup. Strict CSP rules out a library, so this covers the blocks
 * that actually appear in these PRDs and nothing more.
 */
(function () {
  const NL = String.fromCharCode(10);
  const TICK = String.fromCharCode(96);
  const FENCE = TICK + TICK + TICK;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  /** Inline spans: code, links, bare URLs, bold, italic, strikethrough. */
  // A literal, not a built string: the escapes have to reach the regex engine.
  // The bare URL comes last so a [label](url) is taken whole, not half-eaten.
  const INLINE = /(`[^`]+`)|(\[[^\]]*\]\([^)]*\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(~~[^~]+~~)|(https?:\/\/[^\s<>\[\]"'`]+)/g;

  /**
   * The only schemes a click may follow. This text is written by an agent, so
   * a javascript: or data: href is not a hypothetical — anything else renders
   * as the plain words it is. Relative links land here too, and correctly: the
   * panel is a webview with no workspace to resolve them against.
   */
  const SAFE_SCHEME = /^(?:https?:|mailto:)/i;

  function anchor(label, href) {
    if (!SAFE_SCHEME.test(href)) {
      return document.createTextNode(label);
    }
    const link = el('a', 'md-link', label);
    link.href = href;
    link.title = href;
    return link;
  }

  function inline(text, parent) {
    let last = 0;
    let match;
    INLINE.lastIndex = 0;

    while ((match = INLINE.exec(text)) !== null) {
      if (match.index > last) {
        parent.append(document.createTextNode(text.slice(last, match.index)));
      }
      const token = match[0];
      let consumed = token.length;

      if (token.startsWith(TICK)) {
        parent.append(el('code', 'md-code', token.slice(1, -1)));
      } else if (token.startsWith('[')) {
        const split = token.indexOf('](');
        const label = token.slice(1, split);
        const href = token.slice(split + 2, -1);
        parent.append(anchor(label || href, href));
      } else if (token.startsWith('http')) {
        // A URL ending a sentence must not swallow the full stop, and one in
        // brackets must not swallow the bracket.
        const url = token.replace(/[.,;:!?)\]}'"]+$/, '');
        parent.append(anchor(url, url));
        consumed = url.length;
      } else if (token.startsWith('**')) {
        parent.append(el('strong', null, token.slice(2, -2)));
      } else if (token.startsWith('~~')) {
        parent.append(el('del', null, token.slice(2, -2)));
      } else {
        parent.append(el('em', null, token.slice(1, -1)));
      }
      last = match.index + consumed;
      INLINE.lastIndex = last;
    }

    if (last < text.length) {
      parent.append(document.createTextNode(text.slice(last)));
    }
    return parent;
  }

  const BULLET = /^\s*[-*+]\s+(.*)$/;
  const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
  const TASK = /^\[([ xX])\]\s+(.*)$/;

  window.renderMarkdown = function (text) {
    const out = document.createDocumentFragment();
    const lines = String(text || '').split(NL);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) {
        i++;
        continue;
      }

      // fenced code
      if (line.trimStart().startsWith(FENCE)) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trimStart().startsWith(FENCE)) {
          body.push(lines[i]);
          i++;
        }
        i++; // closing fence
        out.append(el('pre', 'md-pre', body.join(NL)));
        continue;
      }

      // heading
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = Math.min(4, heading[1].length + 1); // h2..h4; the panel owns h1
        out.append(inline(heading[2], el('h' + level, 'md-h md-h' + heading[1].length)));
        i++;
        continue;
      }

      // horizontal rule
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.append(el('hr', 'md-hr'));
        i++;
        continue;
      }

      // blockquote
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          body.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.append(inline(body.join(' '), el('blockquote', 'md-quote')));
        continue;
      }

      // list — bullets, numbers, and task items
      if (BULLET.test(line) || NUMBER.test(line)) {
        const ordered = !BULLET.test(line) && NUMBER.test(line);
        const list = el(ordered ? 'ol' : 'ul', 'md-list');

        while (i < lines.length && (BULLET.test(lines[i]) || NUMBER.test(lines[i]))) {
          const match = BULLET.exec(lines[i]) || NUMBER.exec(lines[i]);
          let content = match[1];
          i++;

          // continuation lines belong to the item above
          while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && !NUMBER.test(lines[i]) && !/^#{1,6}\s/.test(lines[i])) {
            content += ' ' + lines[i].trim();
            i++;
          }

          const item = el('li', 'md-item');
          const task = TASK.exec(content);
          if (task) {
            const done = task[1].toLowerCase() === 'x';
            item.classList.add('md-task');
            if (done) item.classList.add('md-task--done');
            item.append(el('span', 'md-check', done ? '[x]' : '[ ]'));
            inline(task[2], item);
          } else {
            inline(content, item);
          }
          list.append(item);
        }
        out.append(list);
        continue;
      }

      // paragraph
      const body = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !BULLET.test(lines[i]) &&
        !NUMBER.test(lines[i]) &&
        !/^\s*>/.test(lines[i]) &&
        !lines[i].trimStart().startsWith(FENCE)
      ) {
        body.push(lines[i].trim());
        i++;
      }
      out.append(inline(body.join(' '), el('p', 'md-p')));
    }

    return out;
  };
})();
