// Turns reviewed release markdown into studio-ready HTML fragments and Tiptap documents.
// Supported blocks: "# title", "##"–"####" headings, paragraphs, "> " quotes, "- " and "1. " lists,
// and the directives "::youtube <id> | <title>" and "::diagram <key> | <caption>".
// Inline: `code`, [text](https://…), **strong** and *em*.

const INLINE = /`([^`]+)`|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;

export function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function parseInline(value) {
  const segments = [];
  let last = 0;
  for (const match of value.matchAll(INLINE)) {
    if (match.index > last) segments.push({ text: value.slice(last, match.index), marks: [] });
    const [, code, linkText, href, strong, em] = match;
    if (code !== undefined) segments.push({ text: code, marks: [{ type: 'code' }] });
    else if (linkText !== undefined) {
      for (const inner of parseInline(linkText)) segments.push({ text: inner.text, marks: [...inner.marks, { type: 'link', href }] });
    }
    else if (strong !== undefined) segments.push({ text: strong, marks: [{ type: 'bold' }] });
    else segments.push({ text: em, marks: [{ type: 'italic' }] });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ text: value.slice(last), marks: [] });
  return segments;
}

function directive(block) {
  const match = block.match(/^::(youtube|diagram)\s+([\w-]+)(?:\s*\|\s*(.+))?$/s);
  return match ? { type: match[1], id: match[2], label: (match[3] ?? '').trim() } : null;
}

export function parseMarkdownPost(source) {
  const raw = source.trim().split(/\r?\n\s*\r?\n/);
  const title = raw.shift()?.match(/^#\s+(.+)$/)?.[1]?.trim();
  if (!title) throw new Error('A post must start with a "# " title');
  const blocks = raw.map((block) => {
    const lines = block.split(/\r?\n/);
    const heading = block.match(/^(#{2,4})\s+(.+)$/s);
    if (heading) return { type: 'heading', level: heading[1].length, text: heading[2].trim() };
    const embed = directive(block.trim());
    if (embed) return embed;
    if (lines.every(line => line.startsWith('>'))) return { type: 'quote', text: lines.map(line => line.replace(/^>\s?/, '')).join(' ') };
    if (lines.every(line => /^- /.test(line))) return { type: 'list', ordered: false, items: lines.map(line => line.slice(2).trim()) };
    if (lines.every(line => /^\d+\. /.test(line))) return { type: 'list', ordered: true, items: lines.map(line => line.replace(/^\d+\.\s+/, '').trim()) };
    return { type: 'paragraph', text: lines.join(' ') };
  });
  return { title, blocks };
}

// HTML keeps one anchor around formatted link text; Tiptap stores the link as a mark on each text run.
function inlineHtml(value) {
  let html = '';
  let last = 0;
  for (const match of value.matchAll(INLINE)) {
    html += escapeHtml(value.slice(last, match.index));
    const [, code, linkText, href, strong, em] = match;
    if (code !== undefined) html += `<code>${escapeHtml(code)}</code>`;
    else if (linkText !== undefined) html += `<a href="${escapeHtml(href)}">${inlineHtml(linkText)}</a>`;
    else if (strong !== undefined) html += `<strong>${escapeHtml(strong)}</strong>`;
    else html += `<em>${escapeHtml(em)}</em>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(value.slice(last));
}

export function renderPostHtml({ blocks }) {
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading': return `<h${block.level}>${inlineHtml(block.text)}</h${block.level}>`;
      case 'quote': return `<blockquote><p>${inlineHtml(block.text)}</p></blockquote>`;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        return `<${tag}>${block.items.map(item => `<li><p>${inlineHtml(item)}</p></li>`).join('')}</${tag}>`;
      }
      case 'youtube': {
        const label = escapeHtml(block.label || 'YouTube video');
        return `<div class="blog-youtube" data-youtube-id="${escapeHtml(block.id)}" data-youtube-load="click" aria-label="${label}"><button type="button">${label}</button></div>`;
      }
      case 'diagram': {
        const label = escapeHtml(block.label);
        const path = `/assets/blog/diagrams/${escapeHtml(block.id)}.svg`;
        return `<figure class="blog-diagram" data-diagram-key="${escapeHtml(block.id)}" aria-label="${label}"><noscript><a href="${path}">${label}</a></noscript>${label ? `<figcaption>${label}</figcaption>` : ''}</figure>`;
      }
      default: return `<p>${inlineHtml(block.text)}</p>`;
    }
  }).join('\n');
}

function tiptapText(value) {
  return parseInline(value).filter(({ text }) => text).map(({ text, marks }) => {
    const node = { type: 'text', text };
    if (marks.length) {
      node.marks = marks.map(mark => mark.type === 'link'
        ? { type: 'link', attrs: { href: mark.href, target: '_blank' } }
        : { type: mark.type });
    }
    return node;
  });
}

const paragraph = value => ({ type: 'paragraph', content: tiptapText(value) });

export function renderPostTiptap({ blocks }) {
  return {
    type: 'doc',
    content: blocks.map((block) => {
      switch (block.type) {
        case 'heading': return { type: 'heading', attrs: { level: block.level }, content: tiptapText(block.text) };
        case 'quote': return { type: 'blockquote', content: [paragraph(block.text)] };
        case 'list': return {
          type: block.ordered ? 'orderedList' : 'bulletList',
          content: block.items.map(item => ({ type: 'listItem', content: [paragraph(item)] })),
        };
        case 'youtube': return { type: 'blogYouTube', attrs: { videoId: block.id, title: block.label } };
        case 'diagram': return { type: 'blogDiagram', attrs: { diagramKey: block.id, caption: block.label } };
        default: return paragraph(block.text);
      }
    }),
  };
}

export function countWords(html) {
  return html.replace(/<[^>]*>/g, ' ').match(/\S+/g)?.length ?? 0;
}
