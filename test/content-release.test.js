import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInline, parseMarkdownPost, renderPostHtml, renderPostTiptap } from '../scripts/content-release.mjs';

const source = `# Title here

Intro with [a *styled* link](https://example.com/a) and \`code [not a link](https://x.test)\`.

::diagram publictransport-live-data | Figure 1. Caption & more

::youtube tniqI9CkwKI | A video

> Read the [original](https://example.com/post).

- First \`0\` packet
- Second item

1. Ref one. [https://example.com/1](https://example.com/1)
2. Ref two.`;

test('release markdown keeps formatting inside links and treats code literally', () => {
  assert.deepEqual(parseInline('[a *b*](https://e.test)'), [
    { text: 'a ', marks: [{ type: 'link', href: 'https://e.test' }] },
    { text: 'b', marks: [{ type: 'italic' }, { type: 'link', href: 'https://e.test' }] },
  ]);
  const html = renderPostHtml(parseMarkdownPost(source));
  assert.match(html, /<a href="https:\/\/example.com\/a">a <em>styled<\/em> link<\/a>/);
  assert.match(html, /<code>code \[not a link\]\(https:\/\/x.test\)<\/code>/);
});

test('release markdown renders quotes, lists and embed directives', () => {
  const post = parseMarkdownPost(source);
  assert.equal(post.title, 'Title here');
  assert.deepEqual(post.blocks.map(block => block.type), ['paragraph', 'diagram', 'youtube', 'quote', 'list', 'list']);
  const html = renderPostHtml(post);
  assert.match(html, /<figure class="blog-diagram" data-diagram-key="publictransport-live-data" aria-label="Figure 1. Caption &amp; more">/);
  assert.match(html, /<div class="blog-youtube" data-youtube-id="tniqI9CkwKI" data-youtube-load="click" aria-label="A video">/);
  assert.match(html, /<blockquote><p>Read the <a href="https:\/\/example.com\/post">original<\/a>.<\/p><\/blockquote>/);
  assert.match(html, /<ul><li><p>First <code>0<\/code> packet<\/p><\/li>/);
  assert.match(html, /<ol><li><p>Ref one\./);
});

test('release markdown becomes studio Tiptap nodes', () => {
  const doc = renderPostTiptap(parseMarkdownPost(source));
  assert.deepEqual(doc.content.map(node => node.type), ['paragraph', 'blogDiagram', 'blogYouTube', 'blockquote', 'bulletList', 'orderedList']);
  assert.deepEqual(doc.content[1].attrs, { diagramKey: 'publictransport-live-data', caption: 'Figure 1. Caption & more' });
  assert.deepEqual(doc.content[2].attrs, { videoId: 'tniqI9CkwKI', title: 'A video' });
  assert.deepEqual(doc.content[0].content[1].marks, [{ type: 'link', attrs: { href: 'https://example.com/a', target: '_blank' } }]);
});

test('a post without a title is rejected', () => {
  assert.throws(() => parseMarkdownPost('No title\n\nBody'), /must start with a "# " title/);
});
