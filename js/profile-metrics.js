const metricFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function updateMetricElements(metrics) {
  if (!metrics) return;

  document.querySelectorAll('[data-metric]').forEach((element) => {
    const metricName = element.dataset.metric;
    const value = Number(metrics[metricName] ?? 0);
    element.textContent = metricFormat.format(value);
    element.setAttribute('title', value.toLocaleString('en'));
  });
}

async function readMetrics() {
  const response = await fetch('/api/profile-metrics', {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Profile metrics request failed (${response.status})`);
  }

  return response.json();
}

async function trackVisitOncePerSession() {
  const sessionKey = `profile-visit:${window.location.pathname}`;

  if (sessionStorage.getItem(sessionKey)) {
    return readMetrics();
  }

  const response = await fetch('/api/profile-metrics', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_path: window.location.pathname || '/',
      referrer: document.referrer || null,
      user_agent: navigator.userAgent || null,
    }),
  });

  if (!response.ok) {
    throw new Error(`Profile metrics request failed (${response.status})`);
  }

  sessionStorage.setItem(sessionKey, 'true');
  return response.json();
}

async function initProfileMetrics() {
  try {
    const metrics = await trackVisitOncePerSession();
    updateMetricElements(metrics);
  } catch (error) {
    console.warn('Unable to update profile metrics:', error);

    try {
      updateMetricElements(await readMetrics());
    } catch (readError) {
      console.warn('Unable to read profile metrics:', readError);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfileMetrics);
} else {
  initProfileMetrics();
}

document.addEventListener('profile-metrics:targets-ready', async () => {
  try {
    updateMetricElements(await readMetrics());
  } catch (error) {
    console.warn('Unable to refresh delayed profile metrics:', error);
  }
});

window.profileMetrics = {
  refresh: async () => updateMetricElements(await readMetrics()),
};
