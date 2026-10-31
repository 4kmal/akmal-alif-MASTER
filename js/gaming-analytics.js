import { initAnalytics } from './analytics.js';

function newId(prefix = 'run') {
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.randomUUID === 'function') return `${prefix}-${cryptoRef.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function visibilityActive(documentRef) {
  return !documentRef || !documentRef.visibilityState || documentRef.visibilityState === 'visible';
}

/**
 * Small game-facing facade over the existing first-party analytics queue.
 * Callers report lifecycle boundaries and sparse actions; no frame, position,
 * shot, room-code, or callsign data is accepted by this facade.
 */
export function createGamingAnalytics(options = {}) {
  const windowRef = options.windowRef || (typeof window === 'undefined' ? null : window);
  const documentRef = options.documentRef || (typeof document === 'undefined' ? null : document);
  const analytics = options.analytics || initAnalytics({ windowRef, documentRef });
  const gameId = String(options.gameId || 'unknown').slice(0, 48);
  const runId = String(options.runId || newId('run')).slice(0, 96);
  const nowRef = typeof options.now === 'function' ? options.now : () => Date.now();
  const cleanup = [];
  let timer = null;
  let ended = false;
  let started = false;
  let startedAt = 0;
  let activeMs = 0;
  let activeSince = null;
  let resultStatus = null;

  function listen(target, type, listener, listenerOptions) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, listenerOptions);
    cleanup.push(() => target.removeEventListener?.(type, listener, listenerOptions));
  }

  function common(fields = {}) {
    return { game_id: gameId, run_id: runId, ...fields };
  }

  function track(type, fields = {}) {
    if (ended) return null;
    return analytics?.track?.(type, common(fields));
  }

  function heartbeat() {
    if (ended || !started) return;
    const now = Number(nowRef()) || Date.now();
    let intervalMs = 0;
    if (visibilityActive(documentRef)) {
      if (activeSince == null) activeSince = now;
      else {
        intervalMs = Math.max(0, now - activeSince);
        activeMs += intervalMs;
        activeSince = now;
      }
    } else if (activeSince != null) {
      intervalMs = Math.max(0, now - activeSince);
      activeMs += intervalMs;
      activeSince = null;
    }
    const extra = typeof options.heartbeatFields === 'function' ? options.heartbeatFields() : {};
    if (intervalMs > 0 || !visibilityActive(documentRef)) {
      track('gaming_session_heartbeat', { active_ms: intervalMs, ...extra });
    }
    void analytics?.flush?.();
  }

  function start(fields = {}) {
    if (ended || started) return api;
    started = true;
    startedAt = Number(nowRef()) || Date.now();
    activeMs = 0;
    activeSince = visibilityActive(documentRef) ? startedAt : null;
    track('gaming_session_start', { transport: 'browser', ...fields });
    timer = setInterval(heartbeat, 30_000);
    listen(windowRef, 'pagehide', () => end({ status: 'abandoned', reason: 'pagehide' }));
    listen(documentRef, 'visibilitychange', () => {
      if (visibilityActive(documentRef)) activeSince = Number(nowRef()) || Date.now();
      else heartbeat();
    });
    return api;
  }

  function interaction(action, fields = {}) {
    return track('gaming_interaction', { action, ...fields });
  }

  function performance(fields = {}) {
    return track('gaming_performance', {
      fps: finite(fields.fps), rtt_ms: finite(fields.rtt_ms), load_ms: finite(fields.load_ms),
      details: fields.details,
    });
  }

  function correlate(correlationToken, fields = {}) {
    return track('gaming_identity_link', { correlation_token: correlationToken, ...fields });
  }

  function result(fields = {}) {
    resultStatus = fields.status || 'completed';
    return track('gaming_client_result', { status: 'completed', ...fields });
  }

  function end(fields = {}) {
    if (ended || !started) return null;
    ended = true;
    if (timer !== null) clearInterval(timer);
    timer = null;
    cleanup.splice(0).forEach(remove => remove());
    const now = Number(nowRef()) || Date.now();
    if (visibilityActive(documentRef) && activeSince != null) {
      activeMs += Math.max(0, now - activeSince);
    }
    activeSince = null;
    const status = resultStatus === 'completed' ? 'completed' : (fields.status || 'ended');
    const event = analytics?.track?.('gaming_session_end', common({
      duration_ms: Math.max(0, activeMs), ...fields, status,
    }));
    void analytics?.flush?.();
    return event;
  }

  const api = { gameId, runId, start, track, interaction, performance, correlate, result, heartbeat, end };
  if (options.autoStart !== false) start(options.startFields || {});
  return api;
}

export function initGamingAnalytics(options = {}) {
  return createGamingAnalytics(options);
}
