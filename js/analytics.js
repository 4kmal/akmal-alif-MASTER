
const PROD_HOSTNAME = 'www.akmalalif.com';
const EVENTS_ENDPOINT = '/api/events';
const MAX_EVENTS_PER_BATCH = 20;
const MAX_BATCH_BYTES = 32 * 1024;
const MAX_QUEUE_SIZE = 120;
const MAX_EVENT_ATTEMPTS = 3;
const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVITY_TICK_MS = 1_000;
const RETRY_DELAY_MS = 1_000;
const MAX_ACTIVITY_DELTA_MS = 10_000;
const MAX_MEDIA_DELTA_MS = 10_000;
const MEDIA_PROGRESS_MARKS = [25, 50, 75];
const MEDIA_COMPLETION_COVERAGE = 0.9;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const EVENT_TYPES = new Set([
  'page_view',
  'heartbeat',
  'article_progress',
  'article_complete',
  'outbound_click',
  'download_start',
  'media_start',
  'media_progress',
  'media_complete',
  'playground_open',
  'contact_open',
  'contact_interaction',
]);

const FIELD_LIMITS = {
  path: 512,
  target: 512,
  media_id: 256,
  media_kind: 64,
  referrer: 512,
  campaign: 128,
};

function getDefaultWindow() {
  return typeof window === 'undefined' ? null : window;
}

function getDefaultDocument() {
  return typeof document === 'undefined' ? null : document;
}

function getDefaultNavigator(windowRef) {
  return windowRef?.navigator || (typeof navigator === 'undefined' ? null : navigator);
}

function getDefaultFetch(windowRef) {
  if (typeof windowRef?.fetch === 'function') return windowRef.fetch.bind(windowRef);
  if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
  return null;
}

function getDefaultNow(windowRef) {
  if (typeof windowRef?.performance?.now === 'function') {
    return () => windowRef.performance.now();
  }
  if (typeof globalThis.performance?.now === 'function') {
    return () => globalThis.performance.now();
  }
  return () => Date.now();
}

function getDefaultTimer(windowRef, method, fallback) {
  if (typeof windowRef?.[method] === 'function') return windowRef[method].bind(windowRef);
  if (typeof globalThis[method] === 'function') return globalThis[method].bind(globalThis);
  return fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function limitedString(value, limit) {
  if (value == null) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, limit);
}

function sanitizePath(value, locationRef) {
  const raw = value == null ? locationRef?.pathname || '/' : String(value);
  let path = raw;
  try {
    path = new URL(raw, locationRef?.href || 'https://www.akmalalif.com/').pathname;
  } catch {
    path = raw.split(/[?#]/, 1)[0];
  }
  if (!path.startsWith('/')) path = '/' + path;
  return limitedString(path, FIELD_LIMITS.path) || '/';
}

function sanitizeReferrer(value, locationRef) {
  const raw = limitedString(value, 2048);
  if (!raw) return '';
  try {
    const parsed = new URL(raw, locationRef?.href || 'https://www.akmalalif.com/');
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const path = parsed.pathname || '/';
    return limitedString(parsed.origin + path, FIELD_LIMITS.referrer);
  } catch {
    return limitedString(raw.split(/[?#]/, 1)[0], FIELD_LIMITS.referrer);
  }
}

function sanitizeTarget(value, locationRef) {
  const raw = limitedString(value, FIELD_LIMITS.target * 4);
  if (!raw || raw === '#' || raw.startsWith('#') || /^javascript:/i.test(raw)) return '';
  if (/^mailto:/i.test(raw)) return 'mailto';
  if (/^tel:/i.test(raw)) return 'tel';

  try {
    const parsed = new URL(raw, locationRef?.href || 'https://www.akmalalif.com/');
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return limitedString(parsed.origin + (parsed.pathname || '/'), FIELD_LIMITS.target);
  } catch {
    return limitedString(raw.split(/[?#]/, 1)[0], FIELD_LIMITS.target);
  }
}

function sanitizeMediaId(value, locationRef) {
  const raw = limitedString(value, FIELD_LIMITS.media_id * 4);
  if (!raw) return '';
  if (/^(?:https?:)?\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw, locationRef?.href || 'https://www.akmalalif.com/');
      if (['http:', 'https:'].includes(parsed.protocol)) {
        return limitedString(parsed.origin + (parsed.pathname || '/'), FIELD_LIMITS.media_id);
      }
    } catch {
      // Preserve non-URL track identifiers below.
    }
  }
  return limitedString(raw.split(/[?#]/, 1)[0], FIELD_LIMITS.media_id);
}

function sanitizeCampaign(locationRef) {
  if (!locationRef) return undefined;
  let params;
  try {
    params = new URLSearchParams(locationRef.search || '');
  } catch {
    return undefined;
  }

  const campaign = {};
  for (const key of UTM_KEYS) {
    const value = limitedString(params.get(key), FIELD_LIMITS.campaign);
    if (value) campaign[key] = value;
  }
  return Object.keys(campaign).length ? campaign : undefined;
}

function createUuid(windowRef) {
  const cryptoRef = windowRef?.crypto || globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return cryptoRef.randomUUID();
  if (typeof cryptoRef?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' + hex.slice(20);
  }
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).byteLength;
  if (typeof Blob === 'function') return new Blob([text]).size;
  return text.length;
}

function closestElement(node, selector) {
  if (!node) return null;
  if (typeof node.closest === 'function') return node.closest(selector);
  let current = node;
  while (current) {
    if (typeof current.matches === 'function' && current.matches(selector)) return current;
    current = current.parentNode;
  }
  return null;
}

function queryAll(documentRef, selector) {
  if (typeof documentRef?.querySelectorAll !== 'function') return [];
  try {
    return Array.from(documentRef.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function isMediaElement(element) {
  const tag = String(element?.tagName || '').toLowerCase();
  return tag === 'audio' || tag === 'video';
}

function describeElement(element) {
  if (!element) return '';
  const id = limitedString(element.id, 96);
  if (id) return '#' + id;
  const className = typeof element.className === 'string'
    ? element.className.split(/\s+/).filter(Boolean)[0]
    : '';
  if (className) return '.' + limitedString(className, 96);
  return String(element.tagName || 'element').toLowerCase();
}

function isProductionLocation(locationRef) {
  return String(locationRef?.hostname || '').toLowerCase() === PROD_HOSTNAME;
}

export function createAnalyticsClient(options = {}) {
  const windowRef = options.windowRef || getDefaultWindow();
  const documentRef = options.documentRef || getDefaultDocument();
  const navigatorRef = options.navigatorRef || getDefaultNavigator(windowRef);
  const locationRef = options.locationRef || windowRef?.location || {
    hostname: '',
    pathname: '/',
    href: 'https://www.akmalalif.com/',
    search: '',
  };
  const fetchImpl = options.fetchImpl || getDefaultFetch(windowRef);
  const now = options.now || getDefaultNow(windowRef);
  const setTimeoutImpl = options.setTimeoutImpl || getDefaultTimer(windowRef, 'setTimeout', setTimeout);
  const clearTimeoutImpl = options.clearTimeoutImpl || getDefaultTimer(windowRef, 'clearTimeout', clearTimeout);
  const requestAnimationFrameImpl = options.requestAnimationFrameImpl
    || getDefaultTimer(windowRef, 'requestAnimationFrame', (callback) => setTimeoutImpl(callback, 0));
  const cancelAnimationFrameImpl = options.cancelAnimationFrameImpl
    || getDefaultTimer(windowRef, 'cancelAnimationFrame', clearTimeoutImpl);
  const uuidFactory = options.uuidFactory || (() => createUuid(windowRef));
  const logger = options.logger || { debug() {} };
  const enabled = options.forceEnabled === true || isProductionLocation(locationRef);

  let started = false;
  let destroyed = false;
  let domReady = false;
  let pageViewSent = false;
  let flushTimer = null;
  let retryTimer = null;
  let activityTimer = null;
  let articleFrame = null;
  let flushPromise = null;
  let inFlightBatch = null;
  let lastActivityAt = null;
  let activeState = false;
  let activeSinceHeartbeat = 0;
  let droppedEvents = 0;
  let interactionSequence = 0;

  const pending = [];
  const cleanup = [];
  const mediaStates = new WeakMap();
  const mediaElements = new Set();
  const contactInteractionTimes = new Map();
  let articleElement = null;
  let articleState = null;
  let domObserver = null;
  let mediaDiscoveryTimer = null;
  let mediaDiscoveryAttempts = 0;

  function listen(target, type, listener, listenerOptions) {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, listener, listenerOptions);
    cleanup.push(() => target.removeEventListener?.(type, listener, listenerOptions));
  }

  function isOnline() {
    return navigatorRef?.onLine !== false;
  }

  function isVisibleAndFocused() {
    const visible = !documentRef?.visibilityState || documentRef.visibilityState === 'visible';
    const focused = typeof documentRef?.hasFocus === 'function' ? documentRef.hasFocus() : true;
    return visible && focused;
  }

  function currentPath() {
    return sanitizePath(locationRef?.pathname || '/', locationRef);
  }

  function eventFields(fields = {}) {
    const result = {};
    if (fields.target) {
      const rawTarget = limitedString(fields.target, FIELD_LIMITS.target);
      const isElementLabel = /^([#.][a-z0-9_-]+|[a-z][a-z0-9_-]*)$/i.test(rawTarget);
      const target = isElementLabel ? rawTarget : sanitizeTarget(rawTarget, locationRef);
      if (target) result.target = target;
    }
    if (fields.progress != null) {
      result.progress = clamp(Math.round(finiteNumber(fields.progress)), 0, 100);
    }
    for (const key of ['active_ms', 'played_ms', 'duration_ms']) {
      if (fields[key] != null) {
        result[key] = clamp(Math.round(finiteNumber(fields[key])), 0, 86_400_000);
      }
    }
    if (fields.media_id) {
      const mediaId = sanitizeMediaId(fields.media_id, locationRef);
      if (mediaId) result.media_id = mediaId;
    }
    if (fields.media_kind) {
      result.media_kind = limitedString(fields.media_kind, FIELD_LIMITS.media_kind);
    }
    if (fields.referrer) {
      const referrer = sanitizeReferrer(fields.referrer, locationRef);
      if (referrer) result.referrer = referrer;
    }
    if (fields.campaign && typeof fields.campaign === 'object') {
      const campaign = {};
      for (const key of UTM_KEYS) {
        const value = limitedString(fields.campaign[key], FIELD_LIMITS.campaign);
        if (value) campaign[key] = value;
      }
      if (Object.keys(campaign).length) result.campaign = campaign;
    }
    return result;
  }

  function createEvent(type, fields = {}) {
    if (!EVENT_TYPES.has(type)) return null;
    const event = {
      id: uuidFactory(),
      type,
      path: sanitizePath(fields.path || currentPath(), locationRef),
      ...eventFields(fields),
    };
    return event;
  }

  function scheduleFlush(delay = 0) {
    if (!enabled || destroyed || !fetchImpl || !isOnline() || flushTimer !== null || retryTimer !== null || flushPromise) return;
    flushTimer = setTimeoutImpl(() => {
      flushTimer = null;
      void flush();
    }, delay);
  }

  function enqueue(type, fields = {}) {
    if (!enabled || destroyed) return null;
    const event = createEvent(type, fields);
    if (!event) return null;

    pending.push({ event, attempts: 0, sequence: interactionSequence += 1 });
    while (pending.length > MAX_QUEUE_SIZE) {
      pending.shift();
      droppedEvents += 1;
    }
    scheduleFlush();
    return event.id;
  }

  function takeBatch() {
    const batch = [];
    while (pending.length && batch.length < MAX_EVENTS_PER_BATCH) {
      const next = pending[0];
      const candidate = { events: batch.concat(next).map((entry) => entry.event) };
      if (byteLength(candidate) <= MAX_BATCH_BYTES) {
        batch.push(pending.shift());
        continue;
      }
      if (!batch.length) {
        pending.shift();
        droppedEvents += 1;
        continue;
      }
      break;
    }
    return batch;
  }

  function requeueBatch(batch) {
    if (!batch.length) return;
    pending.unshift(...batch);
    while (pending.length > MAX_QUEUE_SIZE) {
      pending.shift();
      droppedEvents += 1;
    }
  }

  function responseOk(response) {
    return Boolean(response && (response.ok === true || (response.status >= 200 && response.status < 300)));
  }

  async function flush() {
    if (flushPromise) return flushPromise;
    if (!enabled || destroyed || !fetchImpl || !isOnline()) return false;

    const batch = takeBatch();
    if (!batch.length) return false;

    const body = JSON.stringify({ events: batch.map((entry) => entry.event) });
    inFlightBatch = batch;
    flushPromise = (async () => {
      try {
        const response = await fetchImpl(EVENTS_ENDPOINT, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body,
          keepalive: true,
        });
        if (!responseOk(response)) {
          throw new Error('Analytics event request failed');
        }
        inFlightBatch = null;
        return true;
      } catch (error) {
        inFlightBatch = null;
        const retryable = [];
        for (const entry of batch) {
          entry.attempts += 1;
          if (entry.attempts < MAX_EVENT_ATTEMPTS) retryable.push(entry);
          else droppedEvents += 1;
        }
        requeueBatch(retryable);
        if (retryable.length) {
          retryTimer = setTimeoutImpl(() => {
            retryTimer = null;
            scheduleFlush();
          }, RETRY_DELAY_MS);
        }
        logger?.debug?.('Portfolio analytics request deferred', error);
        return false;
      } finally {
        flushPromise = null;
        if (pending.length && isOnline()) scheduleFlush();
      }
    })();
    return flushPromise;
  }

  function beaconBody(batch) {
    const body = JSON.stringify({ events: batch.map((entry) => entry.event) });
    const BlobRef = windowRef?.Blob || (typeof Blob === 'function' ? Blob : null);
    return BlobRef ? new BlobRef([body], { type: 'application/json' }) : body;
  }

  function flushWithBeacon() {
    if (!enabled || destroyed || typeof navigatorRef?.sendBeacon !== 'function' || inFlightBatch) return false;
    const batch = takeBatch();
    if (!batch.length) return false;

    let accepted = false;
    try {
      accepted = navigatorRef.sendBeacon(EVENTS_ENDPOINT, beaconBody(batch)) === true;
    } catch (error) {
      logger?.debug?.('Portfolio analytics beacon unavailable', error);
    }
    if (!accepted) requeueBatch(batch);
    return accepted;
  }

  function updateActivity() {
    const current = finiteNumber(now(), Date.now());
    if (lastActivityAt === null) {
      lastActivityAt = current;
      activeState = isVisibleAndFocused();
      return;
    }
    const delta = clamp(current - lastActivityAt, 0, MAX_ACTIVITY_DELTA_MS);
    lastActivityAt = current;
    const active = isVisibleAndFocused();
    if (!active || !activeState || delta <= 0) {
      activeState = active;
      return;
    }
    activeState = true;

    activeSinceHeartbeat += delta;
    if (articleState && !articleState.complete) {
      articleState.activeMs += delta;
    }

    while (activeSinceHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      activeSinceHeartbeat -= HEARTBEAT_INTERVAL_MS;
      enqueue('heartbeat', { active_ms: HEARTBEAT_INTERVAL_MS });
    }

    if (articleState?.at90 && !articleState.complete && articleState.activeMs >= HEARTBEAT_INTERVAL_MS) {
      articleState.complete = true;
      enqueue('article_complete', { progress: 100, active_ms: HEARTBEAT_INTERVAL_MS });
    }
  }

  function stopActivityTimer() {
    if (activityTimer !== null) clearTimeoutImpl(activityTimer);
    activityTimer = null;
  }

  function scheduleActivityTimer() {
    stopActivityTimer();
    if (destroyed || !isVisibleAndFocused()) return;
    activityTimer = setTimeoutImpl(() => {
      activityTimer = null;
      updateActivity();
      scheduleActivityTimer();
    }, ACTIVITY_TICK_MS);
  }

  function handleActivityBoundary() {
    updateActivity();
    scheduleActivityTimer();
    if (isOnline()) scheduleFlush();
  }

  function getArticleProgress(element) {
    if (!element) return 0;
    const rect = typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { top: 0, height: element.scrollHeight || 0 };
    const height = finiteNumber(element.scrollHeight, finiteNumber(rect.height));
    const viewportHeight = finiteNumber(windowRef?.innerHeight, finiteNumber(documentRef?.documentElement?.clientHeight, 0));
    if (height <= 0 || viewportHeight <= 0) return 0;
    return clamp(((viewportHeight - finiteNumber(rect.top)) / height) * 100, 0, 100);
  }

  function findArticle() {
    if (!documentRef || typeof documentRef.querySelector !== 'function') return null;
    const pathname = String(documentRef.location?.pathname || '');
    if (!/^\/blog\/[^/]+\/?$/.test(pathname)) return null;
    const content = documentRef.querySelector('[data-blog-content]');
    if (!content || String(content.tagName || '').toLowerCase() !== 'article') return null;
    const isReader = typeof content.matches === 'function'
      ? content.matches('article.blog-content')
      : content.classList?.contains('blog-content');
    return isReader ? content : null;
  }

  function evaluateArticleProgress() {
    articleFrame = null;
    const found = findArticle();
    if (found !== articleElement) {
      articleElement = found;
      articleState = found
        ? { fired: new Set(), at90: false, activeMs: 0, complete: false }
        : null;
    }
    if (!articleElement || !articleState) return;

    const progress = getArticleProgress(articleElement);
    for (const threshold of [25, 50, 75, 90]) {
      if (progress >= threshold && !articleState.fired.has(threshold)) {
        articleState.fired.add(threshold);
        enqueue('article_progress', { progress: threshold });
      }
    }
    articleState.at90 = progress >= 90;
    if (articleState.at90 && articleState.activeMs >= HEARTBEAT_INTERVAL_MS && !articleState.complete) {
      articleState.complete = true;
      enqueue('article_complete', { progress: 100, active_ms: HEARTBEAT_INTERVAL_MS });
    }
  }

  function scheduleArticleProgress() {
    if (articleFrame !== null || destroyed) return;
    let completedSynchronously = false;
    const frameId = requestAnimationFrameImpl(() => {
      completedSynchronously = true;
      articleFrame = null;
      evaluateArticleProgress();
    });
    if (!completedSynchronously) articleFrame = frameId;
  }

  function walkMedia(node) {
    if (!node) return;
    if (isMediaElement(node)) attachMedia(node);
    if (typeof node.querySelectorAll === 'function') {
      for (const element of node.querySelectorAll('audio, video')) attachMedia(element);
    }
  }

  function resolveMediaInfo(element) {
    const player = windowRef?.persistentPlayer;
    if (player && (player.audio === element || player.secondaryAudio === element)) {
      const track = typeof player.getCurrentTrack === 'function'
        ? player.getCurrentTrack()
        : player.tracks?.find((item) => item.id === player.currentTrack);
      return {
        id: track?.id || player.currentTrack || element.currentSrc || element.src || 'player',
        kind: 'audio',
        duration: finiteNumber(player.duration, finiteNumber(element.duration)),
      };
    }
    const id = element?.dataset?.mediaId || element?.id || element?.currentSrc || element?.src || 'media';
    return {
      id,
      kind: String(element?.tagName || '').toLowerCase() === 'video' ? 'video' : 'audio',
      duration: finiteNumber(element?.duration),
    };
  }

  function mediaStateFor(element, info) {
    const key = info.kind + ':' + limitedString(info.id, FIELD_LIMITS.media_id);
    let state = mediaStates.get(element);
    if (!state || state.key !== key) {
      state = {
        key,
        info,
        playing: false,
        seeking: false,
        started: false,
        completed: false,
        marks: new Set(),
        playedMs: 0,
        playedRanges: [],
        lastNow: null,
        lastTime: finiteNumber(element?.currentTime),
      };
      mediaStates.set(element, state);
    } else {
      state.info = info;
    }
    return state;
  }

  function mediaCurrentTime(element) {
    return finiteNumber(element?.currentTime);
  }

  function addPlayedInterval(state, start, end) {
    const from = Math.min(start, end);
    const to = Math.max(start, end);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return;

    const ranges = [];
    let nextFrom = from;
    let nextTo = to;
    let inserted = false;
    for (const [rangeFrom, rangeTo] of state.playedRanges) {
      if (rangeTo + 0.25 < nextFrom) {
        ranges.push([rangeFrom, rangeTo]);
        continue;
      }
      if (nextTo + 0.25 < rangeFrom) {
        if (!inserted) {
          ranges.push([nextFrom, nextTo]);
          inserted = true;
        }
        ranges.push([rangeFrom, rangeTo]);
        continue;
      }
      nextFrom = Math.min(nextFrom, rangeFrom);
      nextTo = Math.max(nextTo, rangeTo);
    }
    if (!inserted) ranges.push([nextFrom, nextTo]);
    state.playedRanges = ranges;
    state.playedMs = ranges.reduce((total, [rangeFrom, rangeTo]) => (
      total + (rangeTo - rangeFrom) * 1000
    ), 0);
  }

  function accrueMediaTime(element, state) {
    const current = mediaCurrentTime(element);
    const currentNow = finiteNumber(now(), Date.now());
    if (!state.playing || state.seeking || state.lastNow === null) {
      state.lastNow = currentNow;
      state.lastTime = current;
      return;
    }

    const wallDelta = clamp(currentNow - state.lastNow, 0, MAX_MEDIA_DELTA_MS);
    const previousTime = state.lastTime;
    const mediaDelta = current - previousTime;
    state.lastNow = currentNow;
    state.lastTime = current;
    if (wallDelta <= 0 || mediaDelta <= 0) return;

    if (mediaDelta < -0.5 || mediaDelta > wallDelta / 1000 + 2) return;
    addPlayedInterval(state, previousTime, current);
  }

  function mediaFields(element, state) {
    const info = state.info || resolveMediaInfo(element);
    const duration = finiteNumber(info.duration, finiteNumber(element?.duration));
    return {
      media_id: sanitizeMediaId(info.id, locationRef),
      media_kind: info.kind,
      played_ms: state.playedMs,
      duration_ms: duration > 0 ? duration * 1000 : undefined,
    };
  }

  function handleMediaPlay(element) {
    const info = resolveMediaInfo(element);
    const state = mediaStateFor(element, info);
    state.playing = true;
    state.seeking = false;
    state.lastNow = finiteNumber(now(), Date.now());
    state.lastTime = mediaCurrentTime(element);
    if (!state.started) {
      state.started = true;
      enqueue('media_start', mediaFields(element, state));
    }
  }

  function handleMediaPause(element) {
    const state = mediaStateFor(element, resolveMediaInfo(element));
    accrueMediaTime(element, state);
    state.playing = false;
  }

  function handleMediaSeeking(element) {
    const state = mediaStateFor(element, resolveMediaInfo(element));
    accrueMediaTime(element, state);
    state.seeking = true;
    state.lastNow = finiteNumber(now(), Date.now());
    state.lastTime = mediaCurrentTime(element);
  }

  function handleMediaSeeked(element) {
    const state = mediaStateFor(element, resolveMediaInfo(element));
    state.seeking = false;
    state.lastNow = finiteNumber(now(), Date.now());
    state.lastTime = mediaCurrentTime(element);
  }

  function handleMediaTimeUpdate(element) {
    const state = mediaStateFor(element, resolveMediaInfo(element));
    accrueMediaTime(element, state);
    if (!state.playing || state.seeking) return;

    const duration = finiteNumber(state.info?.duration, finiteNumber(element?.duration));
    const progress = duration > 0 ? (state.playedMs / (duration * 1000)) * 100 : 0;
    for (const mark of MEDIA_PROGRESS_MARKS) {
      if (progress >= mark && !state.marks.has(mark)) {
        state.marks.add(mark);
        enqueue('media_progress', { progress: mark, ...mediaFields(element, state) });
      }
    }
  }

  function handleMediaEnded(element) {
    const state = mediaStateFor(element, resolveMediaInfo(element));
    accrueMediaTime(element, state);
    state.playing = false;
    if (!state.started || state.completed) return;
    const duration = finiteNumber(state.info?.duration, finiteNumber(element?.duration));
    if (duration > 0 && state.playedMs < duration * 1000 * MEDIA_COMPLETION_COVERAGE) return;
    state.completed = true;
    enqueue('media_complete', { progress: 100, ...mediaFields(element, state) });
  }

  function attachMedia(element) {
    if (!isMediaElement(element) || mediaElements.has(element)) return;
    mediaElements.add(element);
    listen(element, 'play', () => handleMediaPlay(element));
    listen(element, 'pause', () => handleMediaPause(element));
    listen(element, 'seeking', () => handleMediaSeeking(element));
    listen(element, 'seeked', () => handleMediaSeeked(element));
    listen(element, 'timeupdate', () => handleMediaTimeUpdate(element));
    listen(element, 'ended', () => handleMediaEnded(element));
  }

  function discoverPersistentPlayer() {
    if (destroyed) return;
    const player = windowRef?.persistentPlayer;
    if (player?.audio) attachMedia(player.audio);
    if (player?.secondaryAudio) attachMedia(player.secondaryAudio);
    if (player?.audio && player?.secondaryAudio) return;
    if (mediaDiscoveryAttempts >= 20) return;
    mediaDiscoveryAttempts += 1;
    mediaDiscoveryTimer = setTimeoutImpl(() => {
      mediaDiscoveryTimer = null;
      discoverPersistentPlayer();
    }, 250);
  }

  function setupMediaTracking() {
    for (const element of queryAll(documentRef, 'audio, video')) attachMedia(element);
    if (typeof MutationObserver === 'function' && documentRef?.body) {
      domObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes || []) walkMedia(node);
        }
        scheduleArticleProgress();
      });
      domObserver.observe(documentRef.body, { childList: true, subtree: true });
    }
    discoverPersistentPlayer();
  }

  function getPlaygroundTarget() {
    const controller = windowRef?.playground3D;
    const tool = controller?.tools?.[controller.currentTool];
    return tool?.url || tool?.link || '';
  }

  function isContactTarget(element) {
    // The arcade beside the chat is a game, not a contact interaction.
    if (closestElement(element, '.arcade-panel, .arcade-overlay')) return false;
    return Boolean(closestElement(element, '.contact-page, .contact-wrapper, .contact-container'));
  }

  function noteContactInteraction(element) {
    if (!isContactTarget(element)) return;
    const target = describeElement(element);
    const key = eventTypeForContact(element) + ':' + target;
    const current = finiteNumber(now(), Date.now());
    const previous = contactInteractionTimes.get(key);
    if (previous != null && current - previous < 1_000) return;
    contactInteractionTimes.set(key, current);
    enqueue('contact_interaction', { target });
  }

  function eventTypeForContact(element) {
    const tag = String(element?.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' ? 'field' : 'control';
  }

  function isDownloadTarget(element) {
    return Boolean(
      closestElement(element, '#downloadBtn, a[download], [data-download]'),
    );
  }

  function handleClick(event) {
    const source = event?.target;
    if (!source) return;

    const playgroundButton = closestElement(source, '#playground-launch-btn');
    if (playgroundButton) {
      enqueue('playground_open', { target: getPlaygroundTarget() });
    }

    const downloadTarget = closestElement(source, '#downloadBtn, a[download], [data-download]');
    if (downloadTarget) {
      let mediaId;
      const player = windowRef?.persistentPlayer;
      if (player?.currentTrack) mediaId = player.currentTrack;
      const playerDownload = downloadTarget.id === 'downloadBtn';
      if (!playerDownload || mediaId) {
        enqueue('download_start', {
          target: downloadTarget.href || downloadTarget.getAttribute?.('href') || '',
          media_id: mediaId,
          media_kind: mediaId ? 'audio' : undefined,
        });
      }
    } else {
      const link = closestElement(source, 'a[href]');
      if (link) {
        const rawHref = link.getAttribute?.('href') || link.href || '';
        const target = sanitizeTarget(rawHref, locationRef);
        if (target && isOutboundHref(rawHref, locationRef)) {
          enqueue('outbound_click', { target });
        }
      }
    }

    if (event?.type === 'click') noteContactInteraction(source);
  }

  function isOutboundHref(rawHref, locationRef) {
    if (!rawHref || rawHref === '#' || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) return false;
    if (/^(mailto|tel):/i.test(rawHref)) return true;
    try {
      const parsed = new URL(rawHref, locationRef?.href || 'https://www.akmalalif.com/');
      if (!['http:', 'https:'].includes(parsed.protocol)) return false;
      return parsed.origin !== locationRef?.origin;
    } catch {
      return false;
    }
  }

  function handleContactEvent(event) {
    if (event?.type === 'click' || event?.type === 'input' || event?.type === 'change' || event?.type === 'focusin') {
      noteContactInteraction(event.target);
    }
  }

  function setupDelegatedEvents() {
    listen(documentRef, 'click', handleClick, true);
    listen(documentRef, 'input', handleContactEvent, true);
    listen(documentRef, 'change', handleContactEvent, true);
    listen(documentRef, 'focusin', handleContactEvent, true);
  }

  function setupPageSpecificEvents() {
    const path = currentPath();
    const contact = Boolean(documentRef?.body?.classList?.contains?.('contact-page'))
      || path === '/contact'
      || path.startsWith('/contact/');
    if (contact) enqueue('contact_open');

    setupDelegatedEvents();
    setupMediaTracking();
    scheduleArticleProgress();
  }

  function handlePageHide() {
    updateActivity();
    flushWithBeacon();
  }

  function handlePageShow() {
    lastActivityAt = finiteNumber(now(), Date.now());
    activeState = isVisibleAndFocused();
    scheduleActivityTimer();
  }

  function setupLifecycle() {
    listen(documentRef, 'visibilitychange', handleActivityBoundary);
    listen(windowRef, 'focus', handleActivityBoundary);
    listen(windowRef, 'blur', handleActivityBoundary);
    listen(windowRef, 'online', handleActivityBoundary);
    listen(windowRef, 'offline', handleActivityBoundary);
    listen(windowRef, 'pagehide', handlePageHide);
    listen(windowRef, 'pageshow', handlePageShow);
    listen(windowRef, 'scroll', scheduleArticleProgress, { passive: true });
    listen(windowRef, 'resize', scheduleArticleProgress, { passive: true });
  }

  function onDomReady() {
    if (domReady || destroyed) return;
    domReady = true;
    setupPageSpecificEvents();
    lastActivityAt = finiteNumber(now(), Date.now());
    activeState = isVisibleAndFocused();
    scheduleActivityTimer();
  }

  function start() {
    if (started || destroyed) return api;
    started = true;
    if (!enabled) return api;

    if (!pageViewSent) {
      pageViewSent = true;
      enqueue('page_view', {
        referrer: sanitizeReferrer(documentRef?.referrer, locationRef),
        campaign: sanitizeCampaign(locationRef),
      });
    }

    setupLifecycle();
    if (documentRef?.readyState === 'loading') {
      listen(documentRef, 'DOMContentLoaded', onDomReady, { once: true });
    } else {
      onDomReady();
    }
    return api;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cleanup.splice(0).forEach((remove) => remove());
    if (flushTimer !== null) clearTimeoutImpl(flushTimer);
    if (retryTimer !== null) clearTimeoutImpl(retryTimer);
    stopActivityTimer();
    if (mediaDiscoveryTimer !== null) clearTimeoutImpl(mediaDiscoveryTimer);
    if (articleFrame !== null) cancelAnimationFrameImpl(articleFrame);
    domObserver?.disconnect?.();
    flushTimer = null;
    retryTimer = null;
    mediaDiscoveryTimer = null;
    articleFrame = null;
    pending.length = 0;
  }

  const api = {
    start,
    track: enqueue,
    flush,
    destroy,
    getState() {
      return {
        enabled,
        started,
        destroyed,
        pending: pending.length,
        droppedEvents,
        inFlight: Boolean(flushPromise),
        active_ms: Math.round(activeSinceHeartbeat),
        article_progress: articleState ? Array.from(articleState.fired) : [],
      };
    },
  };

  if (options.autoStart !== false) start();
  return api;
}

export function initAnalytics(options = {}) {
  const windowRef = options.windowRef || getDefaultWindow();
  if (windowRef && !options.forceNew && windowRef.__portfolioAnalyticsClient) {
    return windowRef.__portfolioAnalyticsClient;
  }

  const client = createAnalyticsClient(options);
  if (windowRef) windowRef.__portfolioAnalyticsClient = client;
  return client;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const client = initAnalytics();
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      client.destroy();
      if (window.__portfolioAnalyticsClient === client) delete window.__portfolioAnalyticsClient;
    });
  }
}
