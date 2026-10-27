import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BLOG_ARTWORK_PLAYBACK_BUDGET_MS,
  LEGACY_BLOG_THUMBNAIL,
  createBlogArtworkMotionController,
  disposeBlogArtworkMotion,
  initBlogArtworkMotion,
  renderBlogFilterIcon,
  renderBlogSprite,
  resetBlogArtworkPlaybackBudgets,
  resolveBlogThumbnail,
} from '../js/blog-artwork.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...names) {
    names.forEach((name) => this.values.add(name));
  }

  remove(...names) {
    names.forEach((name) => this.values.delete(name));
  }

  contains(name) {
    return this.values.has(name);
  }
}

class FakeCard {
  constructor(slug = 'versatility-humanoid-robots') {
    this.hidden = false;
    this.dataset = { filterState: 'visible', blogSlug: slug };
    this.classList = new FakeClassList();
  }
}

class FakeSprite {
  constructor(card, artwork = 'robot-workstation') {
    this.card = card;
    this.dataset = { blogArtwork: artwork };
  }

  closest() {
    return this.card;
  }
}

class FakeRoot {
  constructor(sprites) {
    this.sprites = sprites;
  }

  querySelectorAll(selector) {
    return selector === '[data-blog-artwork]' ? this.sprites : [];
  }
}

class FakeDocument {
  constructor(root) {
    this.hidden = false;
    this.root = root;
    this.listeners = new Map();
  }

  querySelector(selector) {
    return selector === '[data-blog-posts]' ? this.root : null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  dispatch(type) {
    this.listeners.get(type)?.();
  }
}

class FakeMediaQuery {
  constructor(matches = false) {
    this.matches = matches;
    this.listeners = new Set();
  }

  addEventListener(_type, listener) {
    this.listeners.add(listener);
  }

  removeEventListener(_type, listener) {
    this.listeners.delete(listener);
  }

  change(matches) {
    this.matches = matches;
    this.listeners.forEach((listener) => listener({ matches }));
  }
}

class FakeIntersectionObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe() {}

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  setVisible(target, isIntersecting) {
    this.callback([{ target, isIntersecting }]);
  }
}

class FakeMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }

  observe() {}

  disconnect() {
    this.disconnected = true;
  }

  refresh() {
    this.callback([]);
  }
}

function makeMotionFixture({ reducedMotion = false, artwork = 'robot-workstation', reset = true } = {}) {
  if (reset) resetBlogArtworkPlaybackBudgets();
  FakeIntersectionObserver.instances = [];
  FakeMutationObserver.instances = [];

  let now = 0;
  const card = new FakeCard();
  const sprite = new FakeSprite(card, artwork);
  const root = new FakeRoot([sprite]);
  const documentRef = new FakeDocument(root);
  const mediaQuery = new FakeMediaQuery(reducedMotion);
  const controller = createBlogArtworkMotionController({
    root,
    documentRef,
    intersectionObserver: FakeIntersectionObserver,
    mutationObserver: FakeMutationObserver,
    mediaQuery,
    nowRef: () => now,
    setTimeoutRef: () => 1,
    clearTimeoutRef: () => {},
  });

  return {
    card,
    controller,
    documentRef,
    mediaQuery,
    sprite,
    intersection: FakeIntersectionObserver.instances.at(-1),
    mutations: FakeMutationObserver.instances.at(-1),
    setNow(value) {
      now = value;
    },
  };
}

test('maps only the three legacy pic3 cards while preserving custom and unknown covers', () => {
  const mappedSlugs = [
    ['versatility-humanoid-robots', 'robot-workstation'],
    ['hexapod-robots-military', 'hexapod'],
    ['work-life-balance-burnout', 'burnout-desk'],
  ];

  mappedSlugs.forEach(([slug, artwork]) => {
    assert.deepEqual(resolveBlogThumbnail({ slug, cover_image_url: LEGACY_BLOG_THUMBNAIL }), {
      type: 'sprite',
      artwork,
    });
    assert.deepEqual(resolveBlogThumbnail({
      slug,
      cover_image_url: `https://www.akmalalif.com${LEGACY_BLOG_THUMBNAIL}?legacy=1`,
    }), {
      type: 'sprite',
      artwork,
    });
    assert.deepEqual(resolveBlogThumbnail({ slug, cover_image_url: '' }), {
      type: 'sprite',
      artwork,
    });
    assert.deepEqual(resolveBlogThumbnail({ slug, cover_image_url: '/blog/blogpic/pic2.jpg' }), {
      type: 'image',
      src: '/blog/blogpic/pic2.jpg',
      alt: 'Blog post',
    });
    assert.deepEqual(resolveBlogThumbnail({
      slug,
      cover_image_url: 'https://custom-cdn.example/blog/blogpic/pic3.jpg',
    }), {
      type: 'image',
      src: 'https://custom-cdn.example/blog/blogpic/pic3.jpg',
      alt: 'Blog post',
    });
  });

  assert.deepEqual(resolveBlogThumbnail({ slug: 'future-post', title: 'Future post' }), {
    type: 'image',
    src: LEGACY_BLOG_THUMBNAIL,
    alt: 'Future post',
  });
  assert.match(renderBlogSprite('hexapod'), /data-blog-artwork="hexapod"/);
  assert.match(renderBlogSprite('hexapod'), /aria-hidden="true"/);
  assert.doesNotMatch(renderBlogSprite('hexapod'), /<text\b/);
});

test('renders original filter icons only for the known category slugs', () => {
  ['all', 'psychology', 'machine-learning', 'neuroscience'].forEach((slug) => {
    assert.match(renderBlogFilterIcon(slug), /class="blog-filter-icon/);
    assert.match(renderBlogFilterIcon(slug), /aria-hidden="true"/);
  });
  assert.equal(renderBlogFilterIcon('uncategorized'), '');
});

test('owner-selected filter icons override slugs and cover every studio choice', () => {
  const choices = ['civic-tech', 'cybersecurity', 'game-development', 'robotics', 'anthem',
    'internet-culture', 'psychology', 'machine-learning', 'neuroscience', 'technology',
    'design', 'education', 'music', 'news', 'personal', 'projects', 'general'];
  for (const choice of choices) {
    assert.match(renderBlogFilterIcon('a-new-category', choice), /class="blog-filter-icon/);
  }
  assert.match(renderBlogFilterIcon('civic-tech', 'psychology'), /blog-filter-icon--psychology/);
  assert.match(renderBlogFilterIcon('psychology', 'robotics'), /blog-filter-icon--robotics/);
});

test('starts static until public settings enable one playback sequence', () => {
  const fixture = makeMotionFixture();

  assert.equal(fixture.controller.getState().motionMode, 'pending');
  fixture.intersection.setVisible(fixture.sprite, true);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');

  fixture.controller.setMotionMode('once');
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');
  assert.equal(fixture.controller.getArtworkBudget(fixture.sprite), BLOG_ARTWORK_PLAYBACK_BUDGET_MS);
  fixture.controller.dispose();
});

test('pauses artwork for viewport, document, filter, and reduced motion', () => {
  const fixture = makeMotionFixture();
  fixture.controller.setMotionMode('once');
  fixture.intersection.setVisible(fixture.sprite, true);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');

  fixture.documentRef.hidden = true;
  fixture.documentRef.dispatch('visibilitychange');
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
  fixture.documentRef.hidden = false;
  fixture.documentRef.dispatch('visibilitychange');
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');

  fixture.card.hidden = true;
  fixture.mutations.refresh();
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
  fixture.card.hidden = false;
  fixture.card.dataset.filterState = 'visible';
  fixture.mutations.refresh();
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');

  fixture.mediaQuery.change(true);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
  fixture.mediaQuery.change(false);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');
  fixture.controller.dispose();
});

test('one four-second budget survives pauses, remounts, and rapid re-entry', () => {
  const fixture = makeMotionFixture();
  fixture.controller.setMotionMode('once');
  fixture.intersection.setVisible(fixture.sprite, true);
  fixture.setNow(2000);
  fixture.card.hidden = true;
  fixture.mutations.refresh();
  assert.equal(fixture.controller.getArtworkBudget(fixture.sprite), 2000);

  fixture.card.hidden = false;
  fixture.mutations.refresh();
  fixture.setNow(4000);
  fixture.controller.refresh();
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
  assert.equal(fixture.controller.getArtworkBudget(fixture.sprite), 0);
  fixture.controller.dispose();

  const remount = makeMotionFixture({ reset: false });
  remount.controller.setMotionMode('once');
  remount.intersection.setVisible(remount.sprite, true);
  assert.equal(remount.controller.getArtworkState(remount.sprite), 'paused');
  remount.controller.dispose();
});

test('loads settings on initial request and visibility return, with failures static', async () => {
  resetBlogArtworkPlaybackBudgets();
  FakeIntersectionObserver.instances = [];
  FakeMutationObserver.instances = [];
  let calls = 0;
  const card = new FakeCard();
  const sprite = new FakeSprite(card);
  const root = new FakeRoot([sprite]);
  const documentRef = new FakeDocument(root);
  documentRef.defaultView = {
    IntersectionObserver: FakeIntersectionObserver,
    MutationObserver: FakeMutationObserver,
  };
  const controller = createBlogArtworkMotionController({
    root,
    documentRef,
    intersectionObserver: FakeIntersectionObserver,
    mutationObserver: FakeMutationObserver,
    mediaQuery: new FakeMediaQuery(false),
    fetchRef: async () => {
      calls += 1;
      return { ok: true, json: async () => ({ artwork_motion: calls === 1 ? 'once' : 'off' }) };
    },
    nowRef: () => 0,
    setTimeoutRef: () => 1,
    clearTimeoutRef: () => {},
  });
  const intersection = FakeIntersectionObserver.instances.at(-1);
  intersection.setVisible(sprite, true);
  assert.equal(controller.getArtworkState(sprite), 'paused');
  await controller.loadMotionSetting();
  assert.equal(controller.getState().motionMode, 'once');
  assert.equal(controller.getArtworkState(sprite), 'playing');

  documentRef.hidden = true;
  documentRef.dispatch('visibilitychange');
  documentRef.hidden = false;
  documentRef.dispatch('visibilitychange');
  await controller.loadMotionSetting();
  assert.equal(calls, 2);
  assert.equal(controller.getState().motionMode, 'off');
  assert.equal(controller.getArtworkState(sprite), 'paused');
  controller.dispose();

  const failedRoot = new FakeRoot([new FakeSprite(new FakeCard(), 'hexapod')]);
  const failed = createBlogArtworkMotionController({
    root: failedRoot,
    documentRef: new FakeDocument(failedRoot),
    intersectionObserver: null,
    mutationObserver: null,
    fetchRef: async () => { throw new Error('offline'); },
  });
  await failed.loadMotionSetting();
  assert.equal(failed.getState().motionMode, 'error');
  failed.dispose();
});

test('public artwork has no pause control or local preference path', () => {
  const source = readFileSync(new URL('../js/blog-artwork.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../blog.html', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /localStorage|blog-artwork-paused|data-blog-artwork-toggle/);
  assert.doesNotMatch(page, /data-blog-artwork-toggle|Pause animations/);
});

test('initialization is idempotent for the same listing and can be disposed', () => {
  resetBlogArtworkPlaybackBudgets();
  FakeIntersectionObserver.instances = [];
  const card = new FakeCard();
  const sprite = new FakeSprite(card);
  const root = new FakeRoot([sprite]);
  const documentRef = new FakeDocument(root);
  documentRef.defaultView = {
    IntersectionObserver: FakeIntersectionObserver,
    MutationObserver: FakeMutationObserver,
  };

  const first = initBlogArtworkMotion(documentRef);
  const second = initBlogArtworkMotion(documentRef);
  assert.equal(first, second);
  first.setMotionMode('once');
  FakeIntersectionObserver.instances.at(-1).setVisible(sprite, true);
  assert.equal(first.getArtworkState(sprite), 'playing');

  first.dispose();
  assert.equal(first.getState().disposed, true);
  const third = initBlogArtworkMotion(documentRef);
  assert.notEqual(third, first);
  assert.equal(third.getState().disposed, false);
  third.dispose();
  disposeBlogArtworkMotion(documentRef);
});
