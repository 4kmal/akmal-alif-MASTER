import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOG_ARTWORK_STORAGE_KEY,
  LEGACY_BLOG_THUMBNAIL,
  createBlogArtworkMotionController,
  disposeBlogArtworkMotion,
  initBlogArtworkMotion,
  renderBlogFilterIcon,
  renderBlogSprite,
  resolveBlogThumbnail,
} from '../js/blog-artwork.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeCard {
  constructor() {
    this.hidden = false;
    this.dataset = { filterState: 'visible' };
    this.classList = new FakeClassList();
  }
}

class FakeSprite {
  constructor(card) {
    this.card = card;
    this.dataset = {};
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

class FakeToggle {
  constructor() {
    this.disabled = false;
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  click() {
    this.listeners.get('click')?.({ target: this });
  }
}

class FakeDocument {
  constructor(root, toggle) {
    this.hidden = false;
    this.root = root;
    this.toggle = toggle;
    this.listeners = new Map();
  }

  querySelector(selector) {
    if (selector === '[data-blog-posts]') return this.root;
    if (selector === '[data-blog-artwork-toggle]') return this.toggle;
    return null;
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
    this.observed = new Set();
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target) {
    this.observed.add(target);
  }

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

function makeMotionFixture({ paused = null, reducedMotion = false } = {}) {
  const card = new FakeCard();
  const sprite = new FakeSprite(card);
  const root = new FakeRoot([sprite]);
  const toggle = new FakeToggle();
  const documentRef = new FakeDocument(root, toggle);
  const mediaQuery = new FakeMediaQuery(reducedMotion);
  const writes = new Map();
  const storage = {
    getItem: () => paused,
    setItem: (key, value) => writes.set(key, value),
  };
  const controller = createBlogArtworkMotionController({
    root,
    documentRef,
    intersectionObserver: FakeIntersectionObserver,
    mutationObserver: FakeMutationObserver,
    storage,
    mediaQuery,
  });

  return {
    card,
    controller,
    documentRef,
    mediaQuery,
    sprite,
    storage: writes,
    toggle,
    intersection: FakeIntersectionObserver.instances.at(-1),
    mutations: FakeMutationObserver.instances.at(-1),
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

test('pauses artwork for viewport, document, filter, reduced-motion, and user state', () => {
  const fixture = makeMotionFixture();

  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
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

  fixture.toggle.click();
  assert.equal(fixture.controller.getState().userPaused, true);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'paused');
  assert.equal(fixture.toggle.textContent, 'Resume animations');
  assert.equal(fixture.toggle.attributes.get('aria-pressed'), 'true');
  assert.equal(fixture.storage.get(BLOG_ARTWORK_STORAGE_KEY), 'true');

  fixture.toggle.click();
  assert.equal(fixture.controller.getState().userPaused, false);
  assert.equal(fixture.controller.getArtworkState(fixture.sprite), 'playing');
  assert.equal(fixture.toggle.textContent, 'Pause animations');
  assert.equal(fixture.storage.get(BLOG_ARTWORK_STORAGE_KEY), 'false');

  fixture.controller.dispose();
  assert.equal(fixture.intersection.disconnected, true);
  assert.equal(fixture.mutations.disconnected, true);
});

test('reduced motion wins over stored pause state and storage failures stay in memory', () => {
  const reduced = makeMotionFixture({ paused: 'true', reducedMotion: true });

  reduced.intersection.setVisible(reduced.sprite, true);
  assert.equal(reduced.controller.getArtworkState(reduced.sprite), 'paused');
  assert.equal(reduced.toggle.disabled, true);
  assert.equal(reduced.toggle.textContent, 'Animations disabled');
  assert.equal(reduced.toggle.attributes.get('aria-label'), 'Animations disabled because reduced motion is enabled');
  reduced.toggle.click();
  assert.equal(reduced.controller.getState().userPaused, true);

  reduced.mediaQuery.change(false);
  assert.equal(reduced.toggle.disabled, false);
  assert.equal(reduced.toggle.textContent, 'Resume animations');
  assert.equal(reduced.controller.getArtworkState(reduced.sprite), 'paused');

  const card = new FakeCard();
  const sprite = new FakeSprite(card);
  const root = new FakeRoot([sprite]);
  const toggle = new FakeToggle();
  const documentRef = new FakeDocument(root, toggle);
  const controller = createBlogArtworkMotionController({
    root,
    documentRef,
    intersectionObserver: null,
    mutationObserver: null,
    storage: {
      getItem: () => { throw new Error('storage denied'); },
      setItem: () => { throw new Error('storage denied'); },
    },
    mediaQuery: new FakeMediaQuery(false),
  });

  toggle.click();
  assert.equal(controller.getState().userPaused, true);
  assert.equal(toggle.textContent, 'Resume animations');
  controller.dispose();
});

test('initialization is idempotent for the same listing and can be disposed', () => {
  const card = new FakeCard();
  const sprite = new FakeSprite(card);
  const root = new FakeRoot([sprite]);
  const toggle = new FakeToggle();
  const documentRef = new FakeDocument(root, toggle);

  const first = initBlogArtworkMotion(documentRef);
  const second = initBlogArtworkMotion(documentRef);
  assert.equal(first, second);

  disposeBlogArtworkMotion(documentRef);
  const third = initBlogArtworkMotion(documentRef);
  assert.notEqual(third, first);
  third.dispose();
});
