import assert from 'node:assert/strict';
import test from 'node:test';

let importSequence = 0;

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: options.once === true });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, listener) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter((entry) => entry.listener !== listener));
  }

  dispatchEvent(event) {
    const entries = [...(this.listeners.get(event.type) || [])];
    entries.forEach((entry) => {
      entry.listener(event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    });
    return true;
  }
}

class FakeElement {
  constructor(metricName) {
    this.dataset = metricName
      ? { metric: metricName }
      : {};
    this.attributes = new Map();
    this.textContent = '...';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.readyState = 'complete';
    this.visibilityState = 'visible';
    this.referrer = 'https://referrer.example/';
    this.metricElements = [];
    this.statusElements = [];
  }

  querySelectorAll(selector) {
    if (selector === '[data-metric]') return this.metricElements;
    if (selector === '[data-metrics-status]') return this.statusElements;
    return [];
  }
}

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, dueAt: this.now + delay });
    return id;
  };

  clearTimeout = (id) => {
    this.timers.delete(id);
  };

  async tick(milliseconds) {
    const end = this.now + milliseconds;

    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= end)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) break;

      const [id, timer] = due;
      this.timers.delete(id);
      this.now = timer.dueAt;
      timer.callback();
      await flushPromises();
    }

    this.now = end;
    await flushPromises();
  }
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function makeStorage({ unavailable = false } = {}) {
  const values = new Map();
  if (unavailable) {
    return {
      getItem() {
        throw new Error('session storage unavailable');
      },
      setItem() {
        throw new Error('session storage unavailable');
      },
    };
  }

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function installGlobals(browser, clock, fetchStub, warnings) {
  const previous = new Map();
  const globals = {
    window: browser.window,
    document: browser.document,
    fetch: fetchStub,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  };

  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  previous.set('console', Object.getOwnPropertyDescriptor(globalThis, 'console'));
  Object.defineProperty(globalThis, 'console', {
    configurable: true,
    writable: true,
    value: {
      ...console,
      warn: (...args) => warnings.push(args.join(' ')),
    },
  });

  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

async function loadBrowserModule({
  hostname = 'localhost',
  pathname = '/',
  responses = [],
  storage,
  readyState = 'complete',
} = {}) {
  const document = new FakeDocument();
  document.readyState = readyState;
  const clock = new FakeClock();
  const warnings = [];
  const fetchCalls = [];
  const queue = [...responses];
  const browser = {
    document,
    window: null,
  };
  const window = new FakeEventTarget();
  window.location = {
    hostname,
    pathname,
    reload() {},
  };
  window.navigator = {
    onLine: true,
    userAgent: 'profile-metrics-test',
  };
  window.sessionStorage = storage ?? makeStorage();
  window.window = window;
  browser.window = window;

  const fetchStub = (url, options = {}) => {
    fetchCalls.push({
      url,
      method: options.method || 'GET',
      options,
    });

    const nextResponse = queue.shift();
    if (typeof nextResponse === 'function') return nextResponse();
    if (nextResponse instanceof Error) return Promise.reject(nextResponse);
    return Promise.resolve(nextResponse ?? response({
      profile_views: 10,
      post_impressions: 20,
    }));
  };

  const restoreGlobals = installGlobals(browser, clock, fetchStub, warnings);
  const moduleUrl = new URL('../js/profile-metrics.js?test=' + String(importSequence += 1), import.meta.url);
  await import(moduleUrl.href);
  await flushPromises();

  return {
    browser,
    clock,
    document,
    fetchCalls,
    warnings,
    restoreGlobals,
    async cleanup() {
      window.dispatchEvent({ type: 'pagehide' });
      await flushPromises();
      restoreGlobals();
    },
  };
}

function metricPair(document, initial = '...') {
  const profile = new FakeElement('profile_views');
  const impressions = new FakeElement('post_impressions');
  profile.textContent = initial;
  impressions.textContent = initial;
  document.metricElements = [profile, impressions];
  return { profile, impressions };
}

function statusElement(document) {
  const status = new FakeElement();
  document.statusElements = [status];
  return status;
}

test('polls GET every 15 seconds while the page is active', async () => {
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 10, post_impressions: 20 }),
      response({ profile_views: 11, post_impressions: 21 }),
    ],
  });
  const elements = metricPair(page.document);
  page.document.dispatchEvent({ type: 'profile-metrics:targets-ready' });

  await flushPromises();
  assert.deepEqual(page.fetchCalls.map((call) => call.method), ['GET']);
  assert.equal(elements.profile.textContent, '10');

  await page.clock.tick(14_999);
  assert.equal(page.fetchCalls.length, 1);

  await page.clock.tick(1);
  assert.deepEqual(page.fetchCalls.map((call) => call.method), ['GET', 'GET']);
  assert.equal(elements.profile.textContent, '11');
  assert.equal(elements.impressions.textContent, '21');

  await page.cleanup();
});

test('pauses while hidden or offline and refreshes once on each resume', async () => {
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 1, post_impressions: 2 }),
      response({ profile_views: 3, post_impressions: 4 }),
      response({ profile_views: 5, post_impressions: 6 }),
    ],
  });
  metricPair(page.document);

  await flushPromises();
  page.document.visibilityState = 'hidden';
  page.document.dispatchEvent({ type: 'visibilitychange' });
  await page.clock.tick(30_000);
  assert.equal(page.fetchCalls.length, 1);

  page.document.visibilityState = 'visible';
  page.document.dispatchEvent({ type: 'visibilitychange' });
  await flushPromises();
  assert.equal(page.fetchCalls.length, 2);

  page.browser.window.navigator.onLine = false;
  page.browser.window.dispatchEvent({ type: 'offline' });
  await page.clock.tick(30_000);
  assert.equal(page.fetchCalls.length, 2);

  page.browser.window.navigator.onLine = true;
  page.browser.window.dispatchEvent({ type: 'online' });
  await flushPromises();
  assert.equal(page.fetchCalls.length, 3);

  await page.cleanup();
});

test('does not overlap a slow poll with another poll', async () => {
  const slowPoll = deferred();
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 10, post_impressions: 20 }),
      () => slowPoll.promise,
      response({ profile_views: 12, post_impressions: 22 }),
    ],
  });
  metricPair(page.document);

  await page.clock.tick(15_000);
  assert.equal(page.fetchCalls.length, 2);

  await page.clock.tick(15_000);
  assert.equal(page.fetchCalls.length, 2);

  slowPoll.resolve(response({ profile_views: 11, post_impressions: 21 }));
  await flushPromises();
  await page.clock.tick(14_999);
  assert.equal(page.fetchCalls.length, 2);
  await page.clock.tick(1);
  assert.equal(page.fetchCalls.length, 3);

  await page.cleanup();
});

test('records one canonical-host visit per session path even when storage is unavailable', async () => {
  const page = await loadBrowserModule({
    hostname: 'www.akmalalif.com',
    pathname: '/about',
    storage: makeStorage({ unavailable: true }),
    responses: [
      response({ profile_views: 31, post_impressions: 41 }),
      response({ profile_views: 32, post_impressions: 42 }),
    ],
  });
  metricPair(page.document);

  await flushPromises();
  page.document.dispatchEvent({ type: 'DOMContentLoaded' });
  page.document.dispatchEvent({ type: 'profile-metrics:targets-ready' });
  await page.browser.window.profileMetrics.refresh();

  assert.deepEqual(page.fetchCalls.map((call) => call.method), ['POST', 'GET']);
  assert.equal(JSON.parse(page.fetchCalls[0].options.body).page_path, '/about');

  await page.cleanup();
});

test('uses GET only away from the canonical public host', async () => {
  const page = await loadBrowserModule({
    hostname: 'localhost',
    pathname: '/local',
    responses: [
      response({ profile_views: 7, post_impressions: 8 }),
      response({ profile_views: 9, post_impressions: 10 }),
    ],
  });
  metricPair(page.document);

  await page.browser.window.profileMetrics.refresh();
  assert.deepEqual(page.fetchCalls.map((call) => call.method), ['GET', 'GET']);

  await page.cleanup();
});

test('paints cached metrics when delayed partial targets arrive', async () => {
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 1234, post_impressions: 5678 }),
    ],
  });

  await flushPromises();
  const elements = metricPair(page.document);
  const status = statusElement(page.document);
  page.document.dispatchEvent({ type: 'profile-metrics:targets-ready' });

  assert.equal(elements.profile.textContent, '1.2K');
  assert.equal(elements.impressions.textContent, '5.7K');
  assert.equal(status.textContent, 'Updated');
  assert.equal(page.fetchCalls.length, 1);

  await page.cleanup();
});

test('retains the last good values and logs only once across failed polls', async () => {
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 100, post_impressions: 200 }),
      response({ profile_views: Number.NaN, post_impressions: 201 }),
      new Error('network disconnected'),
    ],
  });
  const elements = metricPair(page.document);
  const status = statusElement(page.document);
  page.document.dispatchEvent({ type: 'profile-metrics:targets-ready' });

  await page.clock.tick(15_000);
  assert.equal(elements.profile.textContent, '100');
  assert.equal(elements.impressions.textContent, '200');
  assert.equal(status.textContent, 'Temporarily unavailable');
  assert.equal(status.getAttribute('aria-live'), 'off');
  assert.equal(page.warnings.length, 1);

  await page.clock.tick(15_000);
  assert.equal(elements.profile.textContent, '100');
  assert.equal(elements.impressions.textContent, '200');
  assert.equal(page.warnings.length, 1);

  await page.cleanup();
});

test('marks counters unavailable for a malformed first response instead of showing zero', async () => {
  const page = await loadBrowserModule({
    responses: [
      response({ profile_views: 88 }),
    ],
  });
  const elements = metricPair(page.document);
  const status = statusElement(page.document);
  page.document.dispatchEvent({ type: 'profile-metrics:targets-ready' });

  await flushPromises();
  assert.equal(elements.profile.textContent, '—');
  assert.equal(elements.impressions.textContent, '—');
  assert.equal(status.textContent, 'Temporarily unavailable');
  assert.equal(page.warnings.length, 1);

  await page.cleanup();
});
