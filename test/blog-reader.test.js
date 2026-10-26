import assert from 'node:assert/strict';
import test from 'node:test';

import { initBlogPost } from '../js/blog-post.js';
import { buildOutlineEntries, renderBlogOutline } from '../js/blog-reader.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.classList = new FakeClassList();
    this.style = {};
    this.hidden = false;
    this._text = '';
    this._html = '';
    this.focusCount = 0;
    this.scrollCount = 0;
  }

  set textContent(value) {
    this._text = String(value ?? '');
    this.children = [];
  }

  get textContent() {
    if (!this.children.length) return this._text;
    return this.children.map((child) => child.textContent).join('');
  }

  set innerHTML(value) {
    this._html = String(value ?? '');
    this._text = '';
    this.children = [];

    if (this.tagName !== 'ARTICLE') return;

    const headingPattern = /<h([2-4])(?:\s+([^>]*))?>([\s\S]*?)<\/h\1>/gi;
    for (const [, level, attributes = '', html] of this._html.matchAll(headingPattern)) {
      const heading = new FakeElement(`h${level}`, this.ownerDocument);
      const idMatch = attributes.match(/\bid=["']([^"']+)["']/i);
      if (idMatch) heading.setAttribute('id', idMatch[1]);
      heading.textContent = html.replace(/<[^>]+>/g, '');
      this.appendChild(heading);
    }
  }

  get innerHTML() {
    return this._html;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    children.forEach((child) => this.appendChild(child));
  }

  matches(selector) {
    const trimmed = selector.trim();
    if (trimmed.startsWith('#')) return this.getAttribute('id') === trimmed.slice(1);
    if (/^h[2-4]$/i.test(trimmed)) return this.tagName.toLowerCase() === trimmed.toLowerCase();
    if (trimmed === '[id]') return this.hasAttribute('id');

    const attributeMatch = trimmed.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (attributeMatch) {
      const [, name, expected] = attributeMatch;
      return this.hasAttribute(name) && (!expected || this.getAttribute(name) === expected);
    }

    return false;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim());
    const matches = [];
    const visit = (node) => {
      if (selectors.some((item) => node.matches(item))) matches.push(node);
      node.children.forEach(visit);
    };
    this.children.forEach(visit);
    return matches;
  }

  focus() {
    this.focusCount += 1;
    this.ownerDocument.focused = this;
  }

  scrollIntoView() {
    this.scrollCount += 1;
    this.ownerDocument.scrollEvents.push(this);
  }
}

class FakeDocument {
  constructor() {
    this.title = 'Blog Post - Akmal Alif';
    this.readyState = 'complete';
    this.scrollEvents = [];
    this.head = new FakeElement('head', this);
    this.titleNode = new FakeElement('h1', this);
    this.titleNode.setAttribute('data-blog-title', '');
    this.metaNode = new FakeElement('p', this);
    this.metaNode.setAttribute('data-blog-meta', '');
    this.outlineNode = new FakeElement('div', this);
    this.outlineNode.setAttribute('id', 'blog-outline-container');
    this.contentNode = new FakeElement('article', this);
    this.contentNode.setAttribute('data-blog-content', '');
    this.roots = [this.titleNode, this.metaNode, this.outlineNode, this.contentNode];
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  querySelector(selector) {
    if (selector === 'meta[name="description"]') {
      return this.head.querySelectorAll('[name="description"]').at(0) || null;
    }
    if (selector === 'link[rel="canonical"]') {
      return this.head.querySelectorAll('[rel="canonical"]').at(0) || null;
    }
    return this.querySelectorAll(selector).at(0) || null;
  }

  querySelectorAll(selector) {
    return this.roots.concat(this.head).flatMap((root) => {
      const matches = root.matches(selector) ? [root] : [];
      return matches.concat(root.querySelectorAll(selector));
    });
  }

  getElementById(id) {
    return this.querySelectorAll('[id]').find((node) => node.getAttribute('id') === id) || null;
  }
}

function makePost({ title = 'Reader test', content_html = '<h2>First</h2><h2>Second</h2>' } = {}) {
  return {
    slug: 'reader-test',
    title,
    content_html,
    excerpt: 'Reader excerpt',
    published_at: '2026-01-01T00:00:00.000Z',
    read_minutes: 4,
    meta_title: null,
    meta_description: 'Reader description',
    canonical_path: '/blog/reader-test',
    blog_categories: { name: 'Psychology' },
  };
}

test('outline IDs preserve the first authored target and avoid document collisions', () => {
  const headings = [
    { tagName: 'H2', textContent: 'Shared', id: 'authored-target' },
    { tagName: 'H2', textContent: 'Shared', id: 'authored-target' },
    { tagName: 'H3', textContent: 'Site Header', id: '' },
    { tagName: 'H4', textContent: '日本語', id: '' },
  ];

  const entries = buildOutlineEntries(headings, ['site-header']);

  assert.deepEqual(entries.map((entry) => entry.id), [
    'authored-target',
    'shared',
    'site-header-2',
    'section-4',
  ]);
  assert.equal(entries[0].authored, true);
  assert.equal(entries[1].authored, false);
});

test('outline stays hidden without sections and renders native details with ordered links', () => {
  const documentRef = new FakeDocument();
  const container = documentRef.outlineNode;

  renderBlogOutline({ container, headings: [], documentRef });
  assert.equal(container.hidden, true);
  assert.equal(container.children.length, 0);

  const headings = [
    new FakeElement('h2', documentRef),
    new FakeElement('h3', documentRef),
  ];
  headings[0].textContent = 'First section';
  headings[1].textContent = 'Second section';
  renderBlogOutline({ container, headings, documentRef });

  assert.equal(container.hidden, false);
  assert.equal(container.children[0].tagName, 'DETAILS');
  assert.equal(container.children[0].children[0].textContent, 'On this page');
  assert.equal(container.children[0].children[1].children[0].children.length, 2);
  assert.equal(headings[0].getAttribute('id'), 'first-section');
  assert.equal(headings[0].getAttribute('tabindex'), '-1');
});

test('repeated initialization ignores stale responses and does not duplicate the outline', async () => {
  const documentRef = new FakeDocument();
  const windowRef = { location: { pathname: '/blog/reader-test.html', origin: 'https://example.test', hash: '' } };
  let resolveFirst;
  let callCount = 0;
  const fetchPost = () => {
    callCount += 1;
    if (callCount === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    return Promise.resolve(makePost({ title: 'Newest response' }));
  };

  const first = initBlogPost({ documentRef, windowRef, fetchPost, formatDate: () => '01 January 2026' });
  const second = initBlogPost({ documentRef, windowRef, fetchPost, formatDate: () => '01 January 2026' });
  await second;
  resolveFirst(makePost({ title: 'Stale response' }));
  await first;

  assert.equal(documentRef.titleNode.textContent, 'Newest response');
  assert.equal(documentRef.metaNode.textContent, 'Published 01 January 2026 · Psychology · 4 min read');
  assert.equal(documentRef.outlineNode.hidden, false);
  assert.equal(documentRef.outlineNode.children.length, 1);
  assert.equal(callCount, 2);
});

test('missing data and fetch failures clear the outline and show a stable state', async () => {
  const documentRef = new FakeDocument();
  const windowRef = { location: { pathname: '/blog/reader-test', origin: 'https://example.test', hash: '' } };

  await initBlogPost({ documentRef, windowRef, fetchPost: async () => makePost() });
  assert.equal(documentRef.outlineNode.hidden, false);

  await initBlogPost({ documentRef, windowRef, fetchPost: async () => null });
  assert.equal(documentRef.titleNode.textContent, 'Blog Post Not Found');
  assert.equal(documentRef.outlineNode.hidden, true);
  assert.equal(documentRef.outlineNode.children.length, 0);

  await initBlogPost({ documentRef, windowRef, fetchPost: async () => { throw new Error('offline'); } });
  assert.equal(documentRef.titleNode.textContent, 'Unable to Load Blog Post');
  assert.equal(documentRef.outlineNode.hidden, true);
});

test('initial URL fragments resolve once after async content is mounted', async () => {
  const documentRef = new FakeDocument();
  const windowRef = { location: { pathname: '/blog/reader-test', origin: 'https://example.test', hash: '#target' } };
  const post = makePost({ content_html: '<h2 id="target">Target section</h2><h2>Other section</h2>' });

  await initBlogPost({ documentRef, windowRef, fetchPost: async () => post });
  await initBlogPost({ documentRef, windowRef, fetchPost: async () => post });

  assert.equal(documentRef.scrollEvents.length, 1);
  assert.equal(documentRef.scrollEvents[0].getAttribute('id'), 'target');
  assert.equal(documentRef.scrollEvents[0].focusCount, 1);
});
