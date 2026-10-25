const METRICS_ENDPOINT = '/api/profile-metrics';
const POLL_INTERVAL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CANONICAL_HOSTNAME = 'www.akmalalif.com';
const UNAVAILABLE_MARK = '—';
const METRIC_FIELDS = ['profile_views', 'post_impressions'];

const metricFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

let latestMetrics = null, statusState = null, initializationPromise = null;
let initialized = false, inFlightRequest = null, pollTimer = null;
let pageIsHidden = false, activityIsReady = isPageActive();
let failureHasBeenReported = false, disposed = false;
const attemptedVisitKeys = new Set();

function isPageActive() {
  return !pageIsHidden && document.visibilityState !== 'hidden' && window.navigator.onLine !== false;
}

function hasValidMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;

  return METRIC_FIELDS.every((field) => (
    Object.prototype.hasOwnProperty.call(metrics, field)
    && typeof metrics[field] === 'number'
    && Number.isFinite(metrics[field])
    && metrics[field] >= 0
  ));
}

function render() {
  document.querySelectorAll('[data-metric]').forEach((element) => {
    const metricName = element.dataset.metric;
    if (!latestMetrics) {
      if (statusState === 'unavailable') {
        element.textContent = UNAVAILABLE_MARK;
        element.removeAttribute('title');
      }
      return;
    }
    if (!METRIC_FIELDS.includes(metricName)) return;
    const value = latestMetrics[metricName];
    element.textContent = metricFormat.format(value);
    element.setAttribute('title', value.toLocaleString('en'));
  });
  if (!statusState) return;
  const statusText = statusState === 'updated'
    ? 'Updated'
    : 'Temporarily unavailable';

  document.querySelectorAll('[data-metrics-status]').forEach((element) => {
    element.dataset.state = statusState;
    element.textContent = statusText;
    element.hidden = statusState !== 'unavailable';
    element.setAttribute('aria-live', 'off');
  });
}

function applyMetrics(metrics) {
  if (!hasValidMetrics(metrics)) {
    throw new Error('Profile metrics response contained invalid totals');
  }

  latestMetrics = {
    profile_views: metrics.profile_views,
    post_impressions: metrics.post_impressions,
  };
  failureHasBeenReported = false;
  statusState = 'updated';
  render();
  return latestMetrics;
}

function recordMetricsFailure(error, source) {
  statusState = 'unavailable';
  render();
  if (failureHasBeenReported) return;

  failureHasBeenReported = true;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`Profile metrics ${source} unavailable: ${detail}`);
}

function sessionVisitWasAttempted(key) {
  if (attemptedVisitKeys.has(key)) return true;

  try {
    if (!window.sessionStorage?.getItem(key)) return false;
  } catch {
    return false;
  }

  attemptedVisitKeys.add(key);
  return true;
}

function persistVisit(key) {
  try {
    window.sessionStorage?.setItem(key, 'true');
  } catch {
    // Storage is optional; the in-memory guard remains active.
  }
}

async function requestMetrics(method = 'GET') {
  if (inFlightRequest) return inFlightRequest;

  const options = {
    method,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  };

  if (method === 'POST') Object.assign(options, {
    headers: { ...options.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_path: window.location.pathname || '/',
      referrer: document.referrer || null,
      user_agent: window.navigator.userAgent || null,
    }),
  });

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    options.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  }

  const pendingRequest = fetch(METRICS_ENDPOINT, options).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Profile metrics request failed (${response.status})`);
    }
    const payload = await response.json();
    if (!hasValidMetrics(payload)) {
      throw new Error('Profile metrics response contained invalid totals');
    }
    return payload;
  });

  inFlightRequest = pendingRequest.finally(() => {
    inFlightRequest = null;
  });
  return inFlightRequest;
}

async function loadInitialMetrics() {
  const shouldTrack = window.location.hostname === CANONICAL_HOSTNAME;
  const key = `profile-visit:${window.location.pathname || '/'}`;

  try {
    if (shouldTrack && !sessionVisitWasAttempted(key)) {
      attemptedVisitKeys.add(key);
      const metrics = await requestMetrics('POST');
      const appliedMetrics = applyMetrics(metrics);
      persistVisit(key);
      return appliedMetrics;
    }
    return applyMetrics(await requestMetrics());
  } catch (error) {
    recordMetricsFailure(error, shouldTrack ? 'initial load' : 'initial read');
  }

  if (!shouldTrack) return latestMetrics;

  try {
    return applyMetrics(await requestMetrics());
  } catch (fallbackError) {
    recordMetricsFailure(fallbackError, 'initial read');
    return latestMetrics;
  }
}

function initProfileMetrics() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = loadInitialMetrics().then(() => {
    initialized = true;
    schedulePoll();
    return latestMetrics;
  });
  return initializationPromise;
}

function stopPolling() {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  if (disposed || !initialized || !isPageActive()) return;

  pollTimer = setTimeout(() => {
    pollTimer = null;
    if (!isPageActive()) return;

    void requestMetrics()
      .then(applyMetrics)
      .catch((error) => recordMetricsFailure(error, 'poll'))
      .finally(schedulePoll);
  }, POLL_INTERVAL_MS);
}

async function refreshMetrics(source = 'refresh') {
  if (!initializationPromise) return initProfileMetrics();
  if (!initialized) await initializationPromise;

  try {
    return applyMetrics(await requestMetrics());
  } catch (error) {
    recordMetricsFailure(error, source);
    throw error;
  }
}

function refreshOnResume() {
  if (!initialized || !isPageActive()) return;
  void refreshMetrics('resume').catch(() => undefined).finally(schedulePoll);
}

function updateActivityState() {
  if (!isPageActive()) {
    activityIsReady = false;
    stopPolling();
    return;
  }
  if (!activityIsReady) {
    activityIsReady = true;
    refreshOnResume();
    return;
  }
  schedulePoll();
}

function handlePageHide() { pageIsHidden = true; updateActivityState(); }
function handlePageShow() { pageIsHidden = false; updateActivityState(); }
function handleTargetsReady() { render(); }

function cleanupProfileMetrics() {
  disposed = true;
  stopPolling();
  lifecycleListeners.forEach(([target, type, listener]) => target.removeEventListener(type, listener));
  document.removeEventListener('DOMContentLoaded', initProfileMetrics);
}

window.profileMetrics = {
  refresh: () => refreshMetrics(),
};

const lifecycleListeners = [
  [document, 'visibilitychange', updateActivityState],
  [document, 'profile-metrics:targets-ready', handleTargetsReady],
  [window, 'online', updateActivityState],
  [window, 'offline', updateActivityState],
  [window, 'pagehide', handlePageHide],
  [window, 'pageshow', handlePageShow],
];
lifecycleListeners.forEach(([target, type, listener]) => {
  target.addEventListener(type, listener);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfileMetrics, { once: true });
} else {
  void initProfileMetrics();
}

if (import.meta.hot) {
  import.meta.hot.dispose(cleanupProfileMetrics);
  import.meta.hot.accept(() => window.location.reload());
}
