<!-- eslint-disable better-tailwindcss/no-unknown-classes, vue/singleline-html-element-content-newline -->
<script setup lang="ts">
import type { ActivityEvent, ActivityFilters, ActivitySnapshot } from './live-activity-helpers'
import { useDocumentVisibility, useOnline } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ACTIVITY_EVENT_TYPES,
  createActivityPoller,
  filterActivityEvents,
  mergeActivityEvents,
  normalizeActivitySnapshot,
  parseActivityFilters,
  sameActivityFilters,
  selectReplayEvents,
  serializeActivityFilters,
} from './live-activity-helpers'

const EMPTY_SNAPSHOT: ActivitySnapshot = {
  activeWebsite: null,
  activeShortlinks: null,
  visitorEstimates: {
    website: { uniqueVisitors: null, method: null },
    shortlinks: { uniqueVisitors: null, method: null },
  },
  events: [],
  asOf: null,
}

const EVENT_LABELS: Record<string, string> = {
  page_view: 'Page view',
  heartbeat: 'Heartbeat',
  article_progress: 'Article progress',
  article_complete: 'Article complete',
  outbound_click: 'Outbound click',
  download_start: 'Download start',
  media_start: 'Media start',
  media_progress: 'Media progress',
  media_complete: 'Media complete',
  playground_open: 'Playground open',
  contact_open: 'Contact open',
  contact_interaction: 'Contact interaction',
}

const route = useRoute()
const router = useRouter()
const filters = reactive<ActivityFilters>(parseActivityFilters(route.query as Record<string, unknown>))
const snapshot = ref<ActivitySnapshot>(EMPTY_SNAPSHOT)
const loading = ref(false)
const stale = ref(false)
const error = ref('')
const paused = ref(false)
const lastSuccessfulRefresh = ref<string | null>(null)
const visibility = useDocumentVisibility()
const online = useOnline()
const prefersReducedMotion = ref(false)
const displayedIds = ref(new Set<string>())
const replayQueue = ref<ActivityEvent[]>([])
const knownIds = new Set<string>()
let replayTimer: ReturnType<typeof setTimeout> | null = null
let mediaQuery: MediaQueryList | null = null
let applyingRoute = false

const canPoll = () => !paused.value && online.value && visibility.value === 'visible'

function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError'
}

function setDisplayed(id: string) {
  const next = new Set([...displayedIds.value, id])
  while (next.size > 500) {
    const first = next.values().next().value
    if (first)
      next.delete(first)
    else
      break
  }
  displayedIds.value = next
}

function stopReplay() {
  if (replayTimer !== null) {
    clearTimeout(replayTimer)
    replayTimer = null
  }
}

function flushReplay() {
  stopReplay()
  while (replayQueue.value.length)
    setDisplayed(replayQueue.value.shift()!.id)
}

function replayNext() {
  replayTimer = null
  if (!canPoll() || prefersReducedMotion.value) {
    if (prefersReducedMotion.value)
      flushReplay()
    return
  }
  const event = replayQueue.value.shift()
  if (!event)
    return
  setDisplayed(event.id)
  if (replayQueue.value.length)
    replayTimer = setTimeout(replayNext, 420)
}

function startReplay() {
  if (prefersReducedMotion.value) {
    flushReplay()
    return
  }
  if (!replayTimer && replayQueue.value.length && canPoll())
    replayTimer = setTimeout(replayNext, 120)
}

function queueReplay(events: readonly ActivityEvent[]) {
  const queued = new Set(replayQueue.value.map(event => event.id))
  for (const event of selectReplayEvents(events, displayedIds.value, 20)) {
    if (!queued.has(event.id)) {
      replayQueue.value.push(event)
      queued.add(event.id)
    }
  }
  if (replayQueue.value.length > 100)
    replayQueue.value.splice(0, replayQueue.value.length - 100)
  startReplay()
}

function applySuccess(value: unknown) {
  const next = normalizeActivitySnapshot(value)
  const merged = mergeActivityEvents(snapshot.value.events, next.events, 100)
  const newEvents = merged.added.filter(event => !knownIds.has(event.id))
  for (const event of next.events)
    knownIds.add(event.id)
  while (knownIds.size > 500) {
    const first = knownIds.values().next().value
    if (first)
      knownIds.delete(first)
    else
      break
  }

  snapshot.value = { ...next, events: merged.events }
  stale.value = false
  error.value = ''
  lastSuccessfulRefresh.value = new Date().toISOString()
  queueReplay(newEvents)
}

function applyError(cause: unknown) {
  if (isAbortError(cause))
    return
  stale.value = true
  error.value = cause instanceof Error ? cause.message : 'The realtime source is unavailable.'
}

const poller = createActivityPoller<unknown>({
  load: signal => useAPI<unknown>('/api/admin/portfolio/realtime', { signal }),
  ready: canPoll,
  onSuccess: applySuccess,
  onError: applyError,
  onStart: () => { loading.value = true },
  onSettled: () => { loading.value = false },
})

const filteredEvents = computed(() => filterActivityEvents(snapshot.value.events, filters))
const displayedEvents = computed(() => filteredEvents.value.filter(event => displayedIds.value.has(event.id)))
const replaying = computed(() => replayQueue.value.length > 0)
const sourceState = computed<'estimated' | 'stale'>(() => stale.value ? 'stale' : 'estimated')
const statusLabel = computed(() => {
  if (paused.value)
    return 'Paused'
  if (!online.value)
    return 'Offline'
  if (visibility.value !== 'visible')
    return 'Waiting for visibility'
  if (stale.value)
    return 'Showing last successful refresh'
  return 'Polling every 10 seconds'
})

const chartBuckets = computed(() => {
  const buckets = new Map<string, number>()
  for (const event of filteredEvents.value) {
    const date = new Date(event.timestamp)
    date.setSeconds(0, 0)
    const key = date.toISOString()
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-12)
    .map(([timestamp, count]) => ({ timestamp, count }))
})

const chartMax = computed(() => Math.max(...chartBuckets.value.map(bucket => bucket.count), 1))
const chartSummary = computed(() => {
  const count = filteredEvents.value.length
  if (!count)
    return 'No trusted realtime events match the current filters.'
  return `${count} trusted event${count === 1 ? '' : 's'} across ${chartBuckets.value.length} one-minute bucket${chartBuckets.value.length === 1 ? '' : 's'}.`
})

const countryRows = computed(() => {
  const counts = new Map<string, number>()
  for (const event of filteredEvents.value) {
    if (event.country)
      counts.set(event.country, (counts.get(event.country) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([country, count]) => ({ country, count }))
    .sort((left, right) => right.count - left.count || left.country.localeCompare(right.country))
    .slice(0, 12)
})
const countryMax = computed(() => Math.max(countryRows.value[0]?.count ?? 1, 1))

function queryMatchesFilters(query: Record<string, unknown>) {
  return sameActivityFilters(filters, parseActivityFilters(query))
}

function syncPolling() {
  if (canPoll()) {
    void poller.refresh()
    poller.start()
    startReplay()
  }
  else {
    poller.stop()
    stopReplay()
  }
}

function togglePaused() {
  paused.value = !paused.value
  syncPolling()
}

function refreshNow() {
  if (!canPoll())
    return
  poller.invalidate()
  void poller.refresh()
}

function updateMotionPreference() {
  prefersReducedMotion.value = mediaQuery?.matches ?? false
  if (prefersReducedMotion.value)
    flushReplay()
  else
    startReplay()
}

function eventLabel(eventType: string) {
  return EVENT_LABELS[eventType] ?? eventType.replaceAll('_', ' ')
}

function sourceLabel(source: string) {
  return source === 'sink' ? 'Sink shortlink' : source === 'portfolio' ? 'Portfolio' : source
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp)
  return Number.isNaN(date.valueOf())
    ? timestamp
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date)
}

function formatLastRefresh(timestamp: string | null) {
  return timestamp ? formatTime(timestamp) : 'Not refreshed yet'
}

function routeQueryMatches(query: Record<string, unknown>, expected: Record<string, string>) {
  const actual = serializeActivityFilters(parseActivityFilters(query))
  return Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => actual[key] === value)
}

watch(() => route.query, (query) => {
  if (queryMatchesFilters(query as Record<string, unknown>))
    return
  applyingRoute = true
  Object.assign(filters, parseActivityFilters(query as Record<string, unknown>))
  applyingRoute = false
  poller.invalidate()
  void poller.refresh()
}, { deep: true })

watch(filters, () => {
  if (applyingRoute)
    return
  const query = serializeActivityFilters(filters)
  if (!routeQueryMatches(route.query as Record<string, unknown>, query))
    void router.replace({ path: '/admin/activity', query })
  poller.invalidate()
  void poller.refresh()
}, { deep: true })

watch([visibility, online, paused], syncPolling)

onMounted(() => {
  mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = mediaQuery.matches
  mediaQuery.addEventListener('change', updateMotionPreference)
  syncPolling()
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', updateMotionPreference)
  stopReplay()
  poller.dispose()
})
</script>

<template>
  <section class="portfolio-report portfolio-live-activity">
    <div class="portfolio-report__heading">
      <div>
        <p class="portfolio-kicker">Portfolio activity</p>
        <h1>Live activity</h1>
        <p class="portfolio-report__intro">
          Trusted website and shortlink events from the last five minutes, retained in a bounded timestamped replay.
        </p>
      </div>
      <div class="portfolio-report__actions portfolio-live-activity__actions">
        <PortfolioSourceBadge :state="sourceState" />
        <button
          class="portfolio-button portfolio-button--quiet"
          type="button"
          :aria-pressed="paused"
          @click="togglePaused"
        >
          {{ paused ? 'Resume polling' : 'Pause polling' }}
        </button>
        <button class="portfolio-button portfolio-button--quiet" type="button" :disabled="loading || !canPoll()" @click="refreshNow">
          {{ loading ? 'Refreshing…' : 'Refresh now' }}
        </button>
      </div>
    </div>

    <div class="portfolio-range-line portfolio-live-activity__status" role="status" aria-live="polite">
      <span>{{ statusLabel }}</span>
      <span>Last successful refresh: {{ formatLastRefresh(lastSuccessfulRefresh) }}</span>
      <span v-if="replaying">Replaying timestamped events…</span>
    </div>

    <form class="portfolio-panel portfolio-panel--live portfolio-live-activity__filters" @submit.prevent="refreshNow">
      <label>
        <span>Source</span>
        <select v-model="filters.source">
          <option value="">All sources</option>
          <option value="portfolio">Portfolio website</option>
          <option value="sink">Sink shortlinks</option>
        </select>
      </label>
      <label>
        <span>Event</span>
        <select v-model="filters.eventType">
          <option value="">All events</option>
          <option v-for="eventType in ACTIVITY_EVENT_TYPES" :key="eventType" :value="eventType">
            {{ eventLabel(eventType) }}
          </option>
        </select>
      </label>
      <label class="portfolio-live-activity__filter-wide">
        <span>Path contains</span>
        <input v-model="filters.path" type="search" maxlength="160" placeholder="/blog or /contact">
      </label>
      <button class="portfolio-button portfolio-button--quiet" type="submit" :disabled="!canPoll()">
        Apply filters
      </button>
    </form>

    <div class="portfolio-metric-grid portfolio-live-activity__metrics">
      <PortfolioMetricCard
        label="Active within 5 min · Website"
        :value="snapshot.activeWebsite"
        detail="Browser identifier estimate"
        :state="sourceState"
      />
      <PortfolioMetricCard
        label="Active within 5 min · Sink"
        :value="snapshot.activeShortlinks"
        detail="IP estimate; separate from website visitors"
        :state="sourceState"
      />
      <PortfolioMetricCard
        label="Website visitor estimate"
        :value="snapshot.visitorEstimates.website.uniqueVisitors"
        :detail="snapshot.visitorEstimates.website.method ?? 'Unavailable'"
        :state="sourceState"
      />
      <PortfolioMetricCard
        label="Sink visitor estimate"
        :value="snapshot.visitorEstimates.shortlinks.uniqueVisitors"
        :detail="snapshot.visitorEstimates.shortlinks.method ?? 'Unavailable'"
        :state="sourceState"
      />
    </div>

    <div v-if="error" class="portfolio-state portfolio-state--error" role="alert">
      <strong>Realtime refresh failed</strong>
      <span>{{ error }}</span>
      <span>Showing the last successful values while the source recovers.</span>
    </div>

    <div class="portfolio-live-activity__grid">
      <section class="portfolio-panel portfolio-panel--chart" aria-labelledby="portfolio-live-chart-heading">
        <div class="portfolio-panel__header">
          <div>
            <p class="portfolio-eyebrow">Activity by minute</p>
            <h2 id="portfolio-live-chart-heading">Recent event flow</h2>
          </div>
          <span class="portfolio-panel__note">{{ filteredEvents.length }} matching events</span>
        </div>
        <svg
          class="portfolio-live-activity__chart"
          viewBox="0 0 640 180"
          role="img"
          aria-labelledby="portfolio-live-chart-title portfolio-live-chart-description"
        >
          <title id="portfolio-live-chart-title">Recent trusted events by minute</title>
          <desc id="portfolio-live-chart-description">{{ chartSummary }}</desc>
          <line x1="24" y1="148" x2="616" y2="148" stroke="currentColor" stroke-opacity="0.3" />
          <g v-for="(bucket, index) in chartBuckets" :key="bucket.timestamp">
            <rect
              :x="32 + index * (576 / Math.max(chartBuckets.length, 1))"
              :y="148 - (bucket.count / chartMax) * 112"
              :width="Math.max(8, 420 / Math.max(chartBuckets.length, 1))"
              :height="(bucket.count / chartMax) * 112"
              rx="2"
              fill="currentColor"
              fill-opacity="0.7"
            />
            <text
              :x="32 + index * (576 / Math.max(chartBuckets.length, 1))"
              y="168"
              font-size="10"
              fill="currentColor"
              fill-opacity="0.7"
            >
              {{ formatTime(bucket.timestamp).slice(0, 5) }}
            </text>
          </g>
        </svg>
        <p class="portfolio-panel__note">{{ chartSummary }}</p>
      </section>

      <section class="portfolio-panel portfolio-panel--country" aria-labelledby="portfolio-live-country-heading">
        <div class="portfolio-panel__header">
          <div>
            <p class="portfolio-eyebrow">Trusted geography</p>
            <h2 id="portfolio-live-country-heading">Country activity</h2>
          </div>
          <span class="portfolio-panel__note">Country only; no inferred coordinates</span>
        </div>
        <svg
          v-if="countryRows.length"
          class="portfolio-live-activity__country-map"
          viewBox="0 0 480 220"
          role="img"
          aria-labelledby="portfolio-live-country-map-title portfolio-live-country-map-description"
        >
          <title id="portfolio-live-country-map-title">Trusted country activity</title>
          <desc id="portfolio-live-country-map-description">A coarse country bar map based only on trusted country fields.</desc>
          <g v-for="(row, index) in countryRows" :key="row.country">
            <text :x="8" :y="22 + index * 16" font-size="11" fill="currentColor">{{ row.country }}</text>
            <rect :x="112" :y="12 + index * 16" :width="(row.count / countryMax) * 340" height="10" rx="2" fill="currentColor" fill-opacity="0.65" />
            <text :x="464" :y="22 + index * 16" text-anchor="end" font-size="11" fill="currentColor">{{ row.count }}</text>
          </g>
        </svg>
        <p v-else class="portfolio-state" role="status">
          Trusted country fields are not included in this realtime snapshot. The event table remains available below.
        </p>
        <div v-if="countryRows.length" class="portfolio-table-wrap">
          <table class="portfolio-table portfolio-live-activity__country-table">
            <caption class="sr-only">Trusted country activity table</caption>
            <thead><tr><th scope="col">Country</th><th scope="col">Events</th></tr></thead>
            <tbody>
              <tr v-for="row in countryRows" :key="row.country"><th scope="row">{{ row.country }}</th><td>{{ row.count }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <section class="portfolio-panel portfolio-panel--events" aria-labelledby="portfolio-live-events-heading">
      <div class="portfolio-panel__header">
        <div>
          <p class="portfolio-eyebrow">Bounded replay</p>
          <h2 id="portfolio-live-events-heading">Timestamped event stream</h2>
        </div>
        <span class="portfolio-panel__note">{{ displayedEvents.length }} of {{ filteredEvents.length }} shown</span>
      </div>
      <div class="portfolio-table-wrap">
        <table class="portfolio-table portfolio-live-activity__table">
          <caption class="sr-only">Recent portfolio and Sink events sorted by event timestamp</caption>
          <thead>
            <tr><th scope="col">Time</th><th scope="col">Source</th><th scope="col">Event</th><th scope="col">Path</th><th scope="col">Target</th></tr>
          </thead>
          <tbody>
            <tr v-for="event in displayedEvents" :key="event.id">
              <td><time :datetime="event.timestamp">{{ formatTime(event.timestamp) }}</time></td>
              <td>{{ sourceLabel(event.source) }}</td>
              <td>{{ eventLabel(event.eventType) }}</td>
              <td>{{ event.path }}</td>
              <td>{{ event.target ?? event.shortlinkSlug ?? '—' }}</td>
            </tr>
            <tr v-if="!displayedEvents.length">
              <td colspan="5">No trusted events match the current filters.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>
