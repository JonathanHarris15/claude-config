/**
 * JIRA stores descriptions as Atlassian Document Format, a node tree. The
 * board shows them as Markdown and saves them back as Markdown, so the round
 * trip has to be honest about what it cannot carry: silently dropping a table
 * out of a PRD would be worse than refusing to save at all.
 */

const NEWLINE = String.fromCharCode(10);
const FENCE = String.fromCharCode(96, 96, 96);
const TICK = String.fromCharCode(96);

/** Node types that survive the trip to Markdown and back. */
const SUPPORTED = new Set([
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'blockquote',
  'rule',
  'hardBreak',
  'inlineCard',
  'emoji',
  'mention'
]);

export interface Description {
  markdown: string;
  /** True when the document holds something Markdown cannot represent. */
  lossy: boolean;
  /** The node types that would be lost, for telling the user why. */
  unsupported: string[];
}

export function fromAdf(body: unknown): Description {
  if (typeof body === 'string') {
    return { markdown: body, lossy: false, unsupported: [] };
  }
  if (!body || typeof body !== 'object') {
    return { markdown: '', lossy: false, unsupported: [] };
  }

  const unsupported = new Set<string>();
  const markdown = render(body as Node, unsupported).replace(/\n{3,}/g, NEWLINE + NEWLINE).trim();

  return {
    markdown,
    lossy: unsupported.size > 0,
    unsupported: [...unsupported].sort()
  };
}

interface Node {
  type?: string;
  text?: string;
  content?: Node[];
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
}

function children(node: Node, lost: Set<string>, join = ''): string {
  return (node.content ?? []).map((child) => render(child, lost)).join(join);
}

function render(node: Node, lost: Set<string>): string {
  const type = node.type ?? 'text';

  if (!SUPPORTED.has(type)) {
    lost.add(type);
    // Still render what is inside it, so the user sees the words even though
    // the structure around them cannot be saved.
    return children(node, lost, NEWLINE);
  }

  switch (type) {
    case 'doc':
      return children(node, lost, NEWLINE + NEWLINE);

    case 'paragraph':
      return children(node, lost);

    case 'heading': {
      const level = Math.min(6, Math.max(1, node.attrs?.level ?? 1));
      return '#'.repeat(level) + ' ' + children(node, lost);
    }

    case 'bulletList':
      return (node.content ?? [])
        .map((item) => '- ' + indent(render(item, lost)))
        .join(NEWLINE);

    case 'orderedList':
      return (node.content ?? [])
        .map((item, i) => `${i + 1}. ` + indent(render(item, lost)))
        .join(NEWLINE);

    case 'listItem':
      return children(node, lost, NEWLINE);

    case 'codeBlock': {
      const language = node.attrs?.language ?? '';
      return FENCE + language + NEWLINE + children(node, lost) + NEWLINE + FENCE;
    }

    case 'blockquote':
      return children(node, lost, NEWLINE)
        .split(NEWLINE)
        .map((line) => '> ' + line)
        .join(NEWLINE);

    case 'rule':
      return '---';

    case 'hardBreak':
      return NEWLINE;

    case 'inlineCard':
      return node.attrs?.url ?? '';

    case 'emoji':
      return node.attrs?.text ?? node.attrs?.shortName ?? '';

    case 'mention':
      return node.attrs?.text ?? '';

    case 'text':
      return applyMarks(node);

    default:
      return children(node, lost);
  }
}

function applyMarks(node: Node): string {
  let text = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'strong':
        text = `**${text}**`;
        break;
      case 'em':
        text = `*${text}*`;
        break;
      case 'code':
        text = TICK + text + TICK;
        break;
      case 'strike':
        text = `~~${text}~~`;
        break;
      case 'link':
        text = `[${text}](${mark.attrs?.href ?? ''})`;
        break;
      default:
        // underline, textColor and friends have no Markdown form. They carry
        // no structure, so losing them does not warrant blocking a save.
        break;
    }
  }
  return text;
}

/** Keep wrapped list-item lines under their bullet. */
function indent(text: string): string {
  return text.split(NEWLINE).join(NEWLINE + '  ');
}
