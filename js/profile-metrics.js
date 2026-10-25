const METRICS_ENDPOINT = '/api/profile-metrics';
const POLL_INTERVAL_MS = 15_000;
const CANONICAL_HOSTNAME = 'www.akmalalif.com';
const UNAVAILABLE_MARK = '—';
const METRIC_FIELDS = ['profile_views', 'post_impressions'];

const metricFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

let latestMetrics = null;
let hasSuccessfulMetrics = false;
let statusState = null;
let initializationPromise = null;
let initialized = false;
let inFlightRequest = null;
let pollTimer = null;
let pageIsHidden = false;
let activityIsReady = isPageActive();
let failureHasBeenReported = false;
let lifecycleListenersAttached = false;
const attemptedVisitKeys = new Set();

function handleTargetsReady() {
  if (hasSuccessfulMetrics) renderMetrics();
  else if (statusState === 'unavailable') renderUnavailableMetrics();
  renderStatus();
}

function getNavigator() {
  return window.navigator || globalThis.navigator || {};
}

function getLocation() {
  return window.location || {};
}

function isOnline() {
  return getNavigator().onLine !== false;
}

function isPageActive() {
  return !pageIsHidden
    && document.visibilityState !== 'hidden'
    && isOnline();
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

function metricPath() {
  return getLocation().pathname || '/';
}

function isCanonicalHost() {
  return getLocation().hostname === CANONICAL_HOSTNAME;
}

function sessionStorageForPage() {
  try {
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

function visitKey() {
  return `profile-visit:${metricPath()}`;
}

function visitWasAttempted(key) {
  if (attemptedVisitKeys.has(key)) return true;

  const storage = sessionStorageForPage();
  if (!storage) return false;

  try {
    if (storage.getItem(key)) {
      attemptedVisitKeys.add(key);
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function markVisitAttempted(key) {
  attemptedVisitKeys.add(key);

  const storage = sessionStorageForPage();
  if (!storage) return;

  try {
    storage.setItem(key, 'true');
  } catch {
    // The in-memory guard still prevents a duplicate attempt this page.
  }
}

function renderMetrics(metrics = latestMetrics) {
  if (!hasValidMetrics(metrics)) return;

  document.querySelectorAll('[data-metric]').forEach((element) => {
    const metricName = element.dataset.metric;
    if (!METRIC_FIELDS.includes(metricName)) return;

    const value = metrics[metricName];
    element.textContent = metricFormat.format(value);
    element.setAttribute('title', value.toLocaleString('en'));
  });
}

function renderUnavailableMetrics() {
  if (hasSuccessfulMetrics) return;

  document.querySelectorAll('[data-metric]').forEach((element) => {
    element.textContent = UNAVAILABLE_MARK;
    element.removeAttribute('title');
  });
}

function renderStatus() {
  if (!statusState) return;

  const statusText = statusState === 'updated'
    ? 'Updated'
    : 'Temporarily unavailable';

  document.querySelectorAll('[data-metrics-status]').forEach((element) => {
    element.dataset.state = statusState;
    element.textContent = statusText;
    element.setAttribute('aria-live', 'off');
  });
}

function markStatus(state) {
  statusState = state;
  renderStatus();
}

function applyMetrics(metrics) {
  if (!hasValidMetrics(metrics)) {
    throw new Error('Profile metrics response contained invalid totals');
  }

  latestMetrics = {
    profile_views: metrics.profile_views,
    post_impressions: metrics.post_impressions,
  };
  hasSuccessfulMetrics = true;
  failureHasBeenReported = false;
  renderMetrics();
  markStatus('updated');
  return latestMetrics;
}

function recordMetricsFailure(error, source) {
  if (!hasSuccessfulMetrics) renderUnavailableMetrics();
  markStatus('unavailable');

  if (failureHasBeenReported) return;
  failureHasBeenReported = true;

  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`Profile metrics ${source} unavailable: ${detail}`);
}

async function requestMetrics(method = 'GET') {
  if (inFlightRequest) return inFlightRequest;

  const options = {
    method,
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  };

  if (method === 'POST') {
    const navigatorInfo = getNavigator();
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify({
      page_path: metricPath(),
      referrer: document.referrer || null,
      user_agent: navigatorInfo.userAgent || null,
    });
  }

  const pendingRequest = (async () => {
    const response = await fetch(METRICS_ENDPOINT, options);
    if (!response.ok) {
      throw new Error(`Profile metrics request failed (${response.status})`);
    }

    const payload = await response.json();
    if (!hasValidMetrics(payload)) {
      throw new Error('Profile metrics response contained invalid totals');
    }

    return payload;
  })();

  inFlightRequest = pendingRequest.then(
    (result) => {
      inFlightRequest = null;
      return result;
    },
    (error) => {
      inFlightRequest = null;
      throw error;
    },
  );

  return inFlightRequest;
}

async function loadInitialMetrics() {
  const shouldTrack = isCanonicalHost();
  const key = visitKey();

  try {
    if (shouldTrack && !visitWasAttempted(key)) {
      markVisitAttempted(key);
      return applyMetrics(await requestMetrics('POST'));
    }

    return applyMetrics(await requestMetrics('GET'));
  } catch (error) {
    recordMetricsFailure(error, shouldTrack ? 'initial load' : 'initial read');
  }

  if (!shouldTrack) return latestMetrics;

  try {
    return applyMetrics(await requestMetrics('GET'));
  } catch (fallbackError) {
    recordMetricsFailure(fallbackError, 'initial read');
    return latestMetrics;
  }
}

async function initProfileMetrics() {
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await loadInitialMetrics();
    initialized = true;
    schedulePoll();
    return latestMetrics;
  })();

  return initializationPromise;
}

async function pollMetrics() {
  if (!initialized || !isPageActive()) return;

  try {
    applyMetrics(await requestMetrics('GET'));
  } catch (error) {
    recordMetricsFailure(error, 'poll');
  } finally {
    schedulePoll();
  }
}

function stopPolling() {
  if (pollTimer === null) return;
  clearTimeout(pollTimer);
  pollTimer = null;
}

function schedulePoll() {
  stopPolling();
  if (!lifecycleListenersAttached || !initialized || !isPageActive()) return;

  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollMetrics();
  }, POLL_INTERVAL_MS);
}

async function refreshMetrics(source = 'refresh') {
  if (!initializationPromise) {
    await initProfileMetrics();
    return latestMetrics;
  }

  if (!initialized && initializationPromise) {
    await initializationPromise;
  }

  try {
    return applyMetrics(await requestMetrics('GET'));
  } catch (error) {
    recordMetricsFailure(error, source);
    throw error;
  }
}

function refreshOnResume() {
  if (!initialized || !isPageActive()) return;

  void refreshMetrics('resume')
    .catch(() => undefined)
    .finally(() => schedulePoll());
}

function updateActivityState() {
  const nextActivityState = isPageActive();

  if (!nextActivityState) {
    activityIsReady = false;
    stopPolling();
    return;
  }

  if (!activityIsReady) {
    activityIsReady = true;
    refreshOnResume();
  } else {
    schedulePoll();
  }
}

function handlePageHide() {
  pageIsHidden = true;
  updateActivityState();
}

function handlePageShow() {
  pageIsHidden = false;
  updateActivityState();
}

function attachLifecycleListeners() {
  if (lifecycleListenersAttached) return;
  lifecycleListenersAttached = true;

  document.addEventListener('visibilitychange', updateActivityState);
  document.addEventListener('DOMContentLoaded', initProfileMetrics, { once: true });
  document.addEventListener('profile-metrics:targets-ready', handleTargetsReady);
  window.addEventListener('online', updateActivityState);
  window.addEventListener('offline', updateActivityState);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('pageshow', handlePageShow);
}

function cleanupProfileMetrics() {
  stopPolling();
  document.removeEventListener('visibilitychange', updateActivityState);
  document.removeEventListener('DOMContentLoaded', initProfileMetrics);
  document.removeEventListener('profile-metrics:targets-ready', handleTargetsReady);
  window.removeEventListener('online', updateActivityState);
  window.removeEventListener('offline', updateActivityState);
  window.removeEventListener('pagehide', handlePageHide);
  window.removeEventListener('pageshow', handlePageShow);
  lifecycleListenersAttached = false;
}

window.profileMetrics = {
  refresh: () => refreshMetrics(),
};

attachLifecycleListeners();

if (document.readyState === 'loading') {
  // DOMContentLoaded starts the single initialization path.
} else {
  void initProfileMetrics();
}

if (import.meta.hot) {
  import.meta.hot.dispose(cleanupProfileMetrics);
  import.meta.hot.accept(() => window.location.reload());
}
