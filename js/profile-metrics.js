import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mgvngrtvwlvqtkxbwtnx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndm5ncnR2d2x2cXRreGJ3dG54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTU5NzAsImV4cCI6MjA5NzI3MTk3MH0.ejiZcHa8ozmqK0BOmRHQQ7Zadquu5mzyVRciZ7o19oY';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

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
  const { data, error } = await supabase
    .from('profile_metrics')
    .select('profile_views, post_impressions')
    .eq('id', true)
    .single();

  if (error) throw error;
  return data;
}

async function trackVisitOncePerSession() {
  const sessionKey = `profile-visit:${window.location.pathname}`;

  if (sessionStorage.getItem(sessionKey)) {
    return readMetrics();
  }

  const { data, error } = await supabase.rpc('track_profile_visit', {
    page_path: window.location.pathname || '/',
    referrer: document.referrer || null,
    user_agent: navigator.userAgent || null,
  });

  if (error) throw error;
  sessionStorage.setItem(sessionKey, 'true');
  return data;
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