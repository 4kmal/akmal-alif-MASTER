
import test from 'node:test';
import assert from 'node:assert/strict';

import { createAnalyticsClient, initAnalytics } from '../js/analytics.js';

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event = {}) {
    if (!event.type) throw new Error('Fake events need a type');
    if (!event.target) event.target = this;
    event.currentTarget = this;
    const listeners = [...(this.listeners.get(event.type) || [])];
    for (const listener of listeners) listener.call(this, event);
    return !event.defaultPrevented;
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
  }

  values() {
    return String(this.element.className || '').split(/\s+/).filter(Boolean);
  }

  contains(value) {
    return this.values().includes(value);
  }

  add(...values) {
    this.element.className = [...new Set([...this.values(), ...values])].join(' ');
  }

  remove(...values) {
    this.element.className = this.values().filter((value) => !values.includes(value)).join(' ');
  }
}

function splitSelector(selector) {
  return String(selector).split(',').map((value) => value.trim()).filter(Boolean);
}

function matchesSelector(element, selector) {
  const selectors = splitSelector(selector);
  return selectors.some((candidate) => {
    if (candidate === '*') return true;
    if (candidate.includes(' ')) {
      const parts = candidate.split(/\s+/);
      return matchesSelector(element, parts.at(-1));
    }
    const compoundAttribute = candidate.match(/^([a-z0-9-]+)(\[[^\]]+\])$/i);
    if (compoundAttribute) {
      if (element.tagName.toLowerCase() !== compoundAttribute[1].toLowerCase()) return false;
      const attribute = compoundAttribute[2].match(/^\[([^\]=]+)(?:=["']?([^"']+)["']?)?\]$/);
      if (!attribute) return false;
      const value = element.getAttribute(attribute[1]);
      return value != null && (attribute[2] == null || value === attribute[2]);
    }
    const attribute = candidate.match(/^\[([^\]=]+)(?:=["']?([^"']+)["']?)?\]$/);
    if (attribute) {
      const value = element.getAttribute(attribute[1]);
      return value != null && (attribute[2] == null || value === attribute[2]);
    }
    const tag = candidate.match(/^([a-z0-9-]+)?((?:#[a-z0-9_-]+)?(?:\.[a-z0-9_-]+)*)$/i);
    if (!tag) return false;
    if (tag[1] && element.tagName.toLowerCase() !== tag[1].toLowerCase()) return false;
    const suffix = tag[2] || '';
    const id = suffix.match(/#([a-z0-9_-]+)/i)?.[1];
    if (id && element.id !== id) return false;
    const classes = [...suffix.matchAll(/\.([a-z0-9_-]+)/gi)].map((match) => match[1]);
    return classes.every((value) => element.classList.contains(value));
  });
}

class FakeElement extends FakeEventTarget {
  constructor(tagName, {
    id = '',
    className = '',
    href = '',
    download = '',
    top = 0,
    height = 100,
    scrollHeight = height,
    mediaId = '',
  } = {}) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.id = id;
    this.className = className;
    this.href = href;
    this.download = download;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.scrollHeight = scrollHeight;
    this._rect = { top, height };
    this.currentTime = 0;
    this.duration = 0;
    this.currentSrc = '';
    if (mediaId) this.dataset.mediaId = mediaId;
    if (href) this.setAttribute('href', href);
    if (download) this.setAttribute('download', download);
    if (id) this.setAttribute('id', id);
    if (className) this.setAttribute('class', className);
    this.classList = new FakeClassList(this);
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'class') this.className = String(value);
    if (name === 'href') this.href = String(value);
    if (name === 'download') this.download = String(value);
  }

  getAttribute(name) {
    if (this.attributes.has(name)) return this.attributes.get(name);
    if (name === 'id' && this.id) return this.id;
    if (name === 'class' && this.className) return this.className;
    if (name === 'href' && this.href) return this.href;
    if (name === 'download' && this.download) return this.download;
    return null;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    let element = this;
    while (element) {
      if (element.matches(selector)) return element;
      element = element.parentNode;
    }
    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches?.(selector)) matches.push(child);
      matches.push(...(child.querySelectorAll?.(selector) || []));
    }
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  setTop(top) {
    this._rect.top = top;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor({ pathname = '/', host = 'www.akmalalif.com', bodyClass = '', referrer = '' } = {}) {
    super();
    this.readyState = 'complete';
    this.visibilityState = 'visible';
    this.referrer = referrer;
    this.documentElement = { clientHeight: 800 };
    this.body = new FakeElement('body', { className: bodyClass });
    this.body.classList = new FakeClassList(this.body);
    this._focused = true;
    this.location = {
      hostname: host,
      origin: 'https://' + host,
      pathname,
      search: '',
      href: 'https://' + host + pathname,
    };
  }

  hasFocus() {
    return this._focused;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

class FakeWindow extends FakeEventTarget {
  constructor(documentRef, navigatorRef) {
    super();
    this.document = documentRef;
    this.navigator = navigatorRef;
    this.location = documentRef.location;
    this.innerHeight = 800;
    this.performance = { now: () => 0 };
  }
}

function makeClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutImpl(callback, delay = 0) {
    const id = nextId++;
    timers.set(id, { id, at: current + Math.max(0, Number(delay) || 0), callback });
    return id;
  }

  function clearTimeoutImpl(id) {
    timers.delete(id);
  }

  function advance(milliseconds) {
    const target = current + milliseconds;
    let safety = 0;
    while (safety++ < 10000) {
      const due = [...timers.values()]
        .filter((timer) => timer.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      timers.delete(due.id);
      current = due.at;
      due.callback();
    }
    current = target;
  }

  return {
    now: () => current,
    setTimeoutImpl,
    clearTimeoutImpl,
    advance,
    pendingCount: () => timers.size,
  };
}

function makePage(options = {}) {
  const documentRef = new FakeDocument(options);
  const navigatorRef = { onLine: options.onLine !== false, sendBeacon: options.sendBeacon };
  const windowRef = new FakeWindow(documentRef, navigatorRef);
  const article = options.article || null;
  const media = options.media || null;
  if (article) documentRef.body.appendChild(article);
  if (media) documentRef.body.appendChild(media);
  return { documentRef, navigatorRef, windowRef, article, media };
}

function makeFetch(responses = []) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const response = responses.length ? responses.shift() : { ok: true, status: 204 };
    if (response instanceof Error) throw response;
    return response;
  };
  return { calls, fetchImpl };
}

function payloadFrom(call) {
  return JSON.parse(call.options.body);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}


async function flushClient(client, clock) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    clock?.advance(0);
    await flushMicrotasks();
    await client.flush();
    await flushMicrotasks();
  }
}
test('never posts from local or preview hosts', async () => {
  for (const host of ['localhost', 'preview.akmalalif.com', 'akmal-alif.pages.dev']) {
    const page = makePage({ host });
    const fetcher = makeFetch();
    const client = createAnalyticsClient({
      windowRef: page.windowRef,
      documentRef: page.documentRef,
      navigatorRef: page.navigatorRef,
      fetchImpl: fetcher.fetchImpl,
      now: () => 0,
    });

    assert.equal(client.getState().enabled, false);
    await client.flush();
    assert.equal(fetcher.calls.length, 0);
    client.destroy();
  }
});

test('initialization is idempotent and sends one page view with same-origin credentials', async () => {
  const page = makePage({ pathname: '/portfolio' });
  const clock = makeClock();
  const fetcher = makeFetch();
  const options = {
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
  };
  const first = initAnalytics({ ...options, forceEnabled: true });
  const second = initAnalytics({ ...options, forceEnabled: true });
  assert.equal(first, second);

  await flushClient(first, clock);
  assert.equal(fetcher.calls.length, 1);
  assert.equal(payloadFrom(fetcher.calls[0]).events.filter((event) => event.type === 'page_view').length, 1);
  assert.equal(fetcher.calls[0].options.credentials, 'same-origin');
  page.windowRef.dispatchEvent({ type: 'pageshow' });
  await flushClient(first, clock);
  const lifecycleEvents = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(lifecycleEvents.filter((event) => event.type === 'page_view').length, 1);
  first.destroy();
});

test('offline queues and retries the same event ids without overlapping requests', async () => {
  const page = makePage({ onLine: false });
  const clock = makeClock();
  const firstResponse = new Error('offline');
  const fetcher = makeFetch([firstResponse, { ok: true, status: 204 }]);
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });

  assert.equal(await client.flush(), false);
  page.navigatorRef.onLine = true;
  page.windowRef.dispatchEvent({ type: 'online' });
  await client.flush();
  const firstId = payloadFrom(fetcher.calls[0]).events[0].id;
  await client.flush();
  const secondId = payloadFrom(fetcher.calls[1]).events[0].id;
  assert.equal(firstId, secondId);
  client.destroy();
});

test('heartbeat pauses while hidden and resumes after a visible focused interval', async () => {
  const page = makePage();
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  await flushClient(client, clock);
  fetcher.calls.length = 0;
  page.documentRef.visibilityState = 'hidden';
  page.documentRef.dispatchEvent({ type: 'visibilitychange' });
  clock.advance(60_000);
  assert.equal(client.getState().pending, 0);

  page.documentRef.visibilityState = 'visible';
  page.documentRef.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(client.getState().active_ms, 0);
  clock.advance(30_000);
  await client.flush();
  const events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.filter((event) => event.type === 'heartbeat').length, 1);
  assert.equal(events.find((event) => event.type === 'heartbeat').active_ms, 30_000);
  client.destroy();
});

test('archive article cards do not start reader progress tracking', async () => {
  const card = new FakeElement('article', {
    className: 'blog-card',
    top: 0,
    height: 2_000,
    scrollHeight: 2_000,
  });
  const page = makePage({ pathname: '/blogs', article: card });
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  await flushClient(client, clock);
  card.setTop(-1_500);
  page.windowRef.dispatchEvent({ type: 'scroll' });
  clock.advance(30_000);
  await flushClient(client, clock);
  const events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.some((event) => event.type === 'article_progress'), false);
  assert.equal(events.some((event) => event.type === 'article_complete'), false);
  client.destroy();
});

test('article thresholds fire once and completion uses cumulative visible reading before ninety percent', async () => {
  const article = new FakeElement('article', {
    className: 'blog-content',
    top: 0,
    height: 2_000,
    scrollHeight: 2_000,
  });
  article.setAttribute('data-blog-content', '');
  const page = makePage({ pathname: '/blog/example', article });
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  await flushClient(client, clock);
  let events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.deepEqual(
    events.filter((event) => event.type === 'article_progress').map((event) => event.progress),
    [25],
  );
  fetcher.calls.length = 0;
  clock.advance(30_000);
  await flushClient(client, clock);
  events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.filter((event) => event.type === 'article_complete').length, 0);

  article.setTop(-1_500);
  page.windowRef.dispatchEvent({ type: 'scroll' });
  await flushClient(client, clock);
  events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.deepEqual(
    events.filter((event) => event.type === 'article_progress').map((event) => event.progress),
    [50, 75, 90],
  );
  assert.equal(events.filter((event) => event.type === 'article_complete').length, 1);
  client.destroy();
});

test('media progress uses unique played intervals and ignores seek jumps and buffering', async () => {
  const media = new FakeElement('audio', { id: 'playerAudio', mediaId: 'track-a' });
  media.src = '/lagu/test.mp3';
  media.currentSrc = media.src;
  media.duration = 100;
  const page = makePage({ pathname: '/' });
  page.windowRef.persistentPlayer = {
    audio: media,
    currentTrack: 'track-a?token=secret',
    duration: 100,
    getCurrentTrack: () => ({ id: 'track-a?token=secret' }),
  };
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  await flushClient(client, clock);
  fetcher.calls.length = 0;

  media.dispatchEvent({ type: 'ended' });
  media.dispatchEvent({ type: 'play' });
  clock.advance(10_000);
  media.dispatchEvent({ type: 'timeupdate' });
  assert.equal(media.currentTime, 0);

  media.currentTime = 1;
  media.dispatchEvent({ type: 'timeupdate' });
  clock.advance(1_000);
  media.currentTime = 2;
  media.dispatchEvent({ type: 'timeupdate' });

  media.currentTime = 50;
  media.dispatchEvent({ type: 'seeking' });
  clock.advance(500);
  media.dispatchEvent({ type: 'timeupdate' });
  media.dispatchEvent({ type: 'seeked' });
  clock.advance(1_000);
  media.currentTime = 51;
  media.dispatchEvent({ type: 'timeupdate' });
  media.dispatchEvent({ type: 'pause' });

  media.currentTime = 100;
  media.dispatchEvent({ type: 'ended' });
  await flushClient(client, clock);

  const events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.filter((event) => event.type === 'media_start').length, 1);
  assert.equal(events.filter((event) => event.type === 'media_complete').length, 0);
  assert.equal(events.find((event) => event.type === 'media_start').media_id, 'track-a');
  assert.equal(events.some((event) => event.type === 'media_progress' && event.progress === 50), false);
  assert.equal(events.some((event) => event.type === 'media_progress'), false);
  client.destroy();
});

test('media completion requires ninety percent unique coverage, so replay cannot qualify it', async () => {
  const media = new FakeElement('audio', { id: 'playerAudio', mediaId: 'track-a' });
  media.src = '/lagu/test.mp3';
  media.currentSrc = media.src;
  media.duration = 100;
  const page = makePage({ pathname: '/' });
  page.windowRef.persistentPlayer = { audio: media, currentTrack: 'track-a', duration: 100 };
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  await flushClient(client, clock);
  fetcher.calls.length = 0;

  media.dispatchEvent({ type: 'play' });
  clock.advance(10_000);
  media.currentTime = 10;
  media.dispatchEvent({ type: 'timeupdate' });
  media.currentTime = 0;
  media.dispatchEvent({ type: 'seeking' });
  media.dispatchEvent({ type: 'seeked' });
  clock.advance(10_000);
  media.currentTime = 10;
  media.dispatchEvent({ type: 'timeupdate' });
  media.currentTime = 100;
  media.dispatchEvent({ type: 'ended' });
  await flushClient(client, clock);

  let events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.filter((event) => event.type === 'media_complete').length, 0);

  media.currentTime = 10;
  media.dispatchEvent({ type: 'seeking' });
  media.dispatchEvent({ type: 'seeked' });
  media.dispatchEvent({ type: 'play' });
  for (let currentTime = 11; currentTime <= 90; currentTime += 1) {
    clock.advance(1_000);
    media.currentTime = currentTime;
    media.dispatchEvent({ type: 'timeupdate' });
  }
  media.currentTime = 100;
  media.dispatchEvent({ type: 'ended' });
  await flushClient(client, clock);
  events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.equal(events.filter((event) => event.type === 'media_complete').length, 1);
  const complete = events.find((event) => event.type === 'media_complete');
  assert.ok(complete.played_ms >= 90_000);
  client.destroy();
});

test('batches at twenty events and sends pending events through pagehide beacon', async () => {
  const beaconCalls = [];
  const page = makePage({
    sendBeacon: (url, body) => {
      beaconCalls.push({ url, body });
      return true;
    },
  });
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });

  for (let index = 0; index < 25; index += 1) {
    client.track('contact_interaction', { target: '#field' + index });
  }
  page.windowRef.dispatchEvent({ type: 'pagehide' });

  assert.equal(fetcher.calls.length, 0);
  assert.equal(beaconCalls.length, 1);
  assert.equal(beaconCalls[0].url, '/api/events');
  const beaconText = typeof beaconCalls[0].body?.text === 'function'
    ? await beaconCalls[0].body.text()
    : beaconCalls[0].body;
  const beaconEvents = JSON.parse(beaconText).events;
  assert.equal(beaconEvents.length, 20);
  assert.ok(Buffer.byteLength(beaconText, 'utf8') <= 32 * 1024);
  assert.equal(client.getState().pending, 6);
  client.destroy();
});

test('keeps large payload batches below thirty-two kibibytes', async () => {
  const page = makePage();
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });
  const largeEvent = {
    target: 'https://example.com/' + 'x'.repeat(480),
    media_id: 'm'.repeat(256),
    media_kind: 'a'.repeat(64),
    referrer: 'https://referrer.example/' + 'r'.repeat(480),
    campaign: Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']
      .map((key) => [key, 'c'.repeat(128)])),
  };
  for (let index = 0; index < 20; index += 1) {
    client.track('media_progress', largeEvent);
  }
  await client.flush();

  assert.ok(fetcher.calls.length >= 1);
  const body = fetcher.calls[0].options.body;
  assert.ok(Buffer.byteLength(body, 'utf8') <= 32 * 1024);
  assert.ok(payloadFrom(fetcher.calls[0]).events.length < 20);
  client.destroy();
});

test('contact and playground interactions are aggregate-only and skip placeholders', async () => {
  const page = makePage({ pathname: '/contact/', bodyClass: 'contact-page' });
  const input = new FakeElement('input', { id: 'chatInput' });
  const placeholder = new FakeElement('a', { href: '#' });
  const outbound = new FakeElement('a', { href: 'https://example.com/careers?email=private' });
  const launch = new FakeElement('button', { id: 'playground-launch-btn' });
  page.documentRef.body.appendChild(input);
  page.documentRef.body.appendChild(placeholder);
  page.documentRef.body.appendChild(outbound);
  page.documentRef.body.appendChild(launch);
  page.windowRef.playground3D = {
    currentTool: 5,
    tools: { 5: { isVevo: true, url: 'https://embed.vevo.com/player?autoplay=true' } },
  };
  const clock = makeClock();
  const fetcher = makeFetch();
  const client = createAnalyticsClient({
    windowRef: page.windowRef,
    documentRef: page.documentRef,
    navigatorRef: page.navigatorRef,
    fetchImpl: fetcher.fetchImpl,
    now: clock.now,
    setTimeoutImpl: clock.setTimeoutImpl,
    clearTimeoutImpl: clock.clearTimeoutImpl,
    requestAnimationFrameImpl: (callback) => {
      callback();
      return 1;
    },
    forceEnabled: true,
  });

  page.documentRef.dispatchEvent({ type: 'focusin', target: input });
  page.documentRef.dispatchEvent({ type: 'click', target: outbound });
  page.documentRef.dispatchEvent({ type: 'click', target: placeholder });
  page.documentRef.dispatchEvent({ type: 'click', target: launch });
  await flushClient(client, clock);

  const events = fetcher.calls.flatMap((call) => payloadFrom(call).events);
  assert.ok(events.some((event) => event.type === 'contact_open'));
  assert.ok(events.some((event) => event.type === 'contact_interaction'));
  const outboundEvent = events.find((event) => event.type === 'outbound_click');
  assert.equal(outboundEvent.target, 'https://example.com/careers');
  const playgroundEvent = events.find((event) => event.type === 'playground_open');
  assert.equal(playgroundEvent.target, 'https://embed.vevo.com/player');
  assert.equal(events.some((event) => event.type === 'media_complete'), false);
  client.destroy();
});
