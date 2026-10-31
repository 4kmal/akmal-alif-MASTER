<script setup lang="ts">
import type {
  GamingBreakdown,
  GamingPlayer,
  GamingPlayerDetail,
  GamingReport,
  GamingSession,
  GamingSessionDetail,
  ObservabilityMetric,
} from '../../../shared/types/observability'
import { Download, RefreshCw, X } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { appendObservabilityQuery, formatObservabilityMetric, formatObservabilityNumber, observabilityMetricTitle, observabilityNumberTitle, useGamingObservability } from '@/composables/useObservability'
import { useAPI } from '@/utils/api'

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'games', label: 'Games & modes' },
  { id: 'players', label: 'Players & sessions' },
  { id: 'online', label: 'Online & performance' },
] as const
type GamingTab = typeof tabs[number]['id']

type GamingBreakdownExtra = GamingBreakdown & {
  distance?: number
  disconnects?: number
  renderFailures?: number
  endReasons?: Record<string, number>
  interactions?: Record<string, number>
}

type GamingReportExtra = GamingReport & {
  games: GamingBreakdownExtra[]
  modes: GamingBreakdownExtra[]
  sectors?: GamingBreakdownExtra[]
  interactions?: Array<{ gameId: string, label: string, count: number }>
  endReasons?: Array<{ gameId: string, reason: string, count: number }>
}

type GamingSessionDetailExtra = GamingSessionDetail & {
  timelineTotal?: number
  timelineLimit?: number
  timelineTruncated?: boolean
  timelineNextCursor?: string | null
  participantsTotal?: number
  participantsLimit?: number
  participantsTruncated?: boolean
}

type GamingPlayerDetailExtra = GamingPlayerDetail & {
  sessionsTotal?: number
  sessionsLimit?: number
  sessionsTruncated?: boolean
  sessionsNextCursor?: string | null
}

const route = useRoute()
const router = useRouter()
const { data, loading, error, stale, lastUpdated, refresh, range, game, mode, transport } = useGamingObservability()
const activeTab = ref<GamingTab>(isTab(route.query.tab) ? route.query.tab as GamingTab : 'overview')
const teleportReady = ref(false)
const detailKind = ref<'session' | 'player' | null>(null)
const sessionDetail = ref<GamingSessionDetail | null>(null)
const playerDetail = ref<GamingPlayerDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
const detailMoreLoading = ref(false)
const detailMoreError = ref<string | null>(null)
const exportLoading = ref(false)
const exportError = ref<string | null>(null)
const detailPanel = useTemplateRef<HTMLElement>('detailPanel')
let detailTrigger: HTMLElement | null = null
let detailController: AbortController | null = null
let detailRequest = 0

onMounted(() => {
  teleportReady.value = true
})

function isTab(value: unknown): value is GamingTab {
  return typeof value === 'string' && tabs.some(tab => tab.id === value)
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  const key = event.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key))
    return
  event.preventDefault()
  const nextIndex = key === 'Home'
    ? 0
    : key === 'End'
      ? tabs.length - 1
      : (index + (key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const nextTab = tabs[nextIndex]
  if (!nextTab)
    return
  activeTab.value = nextTab.id
  void nextTick(() => document.getElementById(`gaming-tab-${nextTab.id}`)?.focus())
}

watch(activeTab, (value) => {
  void router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } })
})

watch(() => route.query.tab, (value) => {
  const nextTab: GamingTab = isTab(value) ? value : 'overview'
  if (nextTab !== activeTab.value)
    activeTab.value = nextTab
})

const dailyPoints = computed(() => (data.value?.daily || []).map(item => ({
  label: formatDate(item.date),
  value: item.starts,
})))
const overviewMetrics = computed(() => data.value?.overview || [])
const onlineMetrics = computed(() => data.value?.performance || [])
const activeHumans = computed(() => data.value?.live.players ?? null)
const activeBots = computed(() => data.value?.live.bots ?? null)
const selectedGameLabel = computed(() => game.value || 'All games')
const reportWithExtras = computed(() => data.value as GamingReportExtra | null)
const sessionDetailWithExtras = computed(() => sessionDetail.value as GamingSessionDetailExtra | null)
const playerDetailWithExtras = computed(() => playerDetail.value as GamingPlayerDetailExtra | null)

const breakdownFields = [
  { key: 'kills', label: 'Kills', aliases: ['kills'], unit: 'count' },
  { key: 'deaths', label: 'Deaths', aliases: ['deaths'], unit: 'count' },
  { key: 'assists', label: 'Assists', aliases: ['assists'], unit: 'count' },
  { key: 'captures', label: 'Captures', aliases: ['captures', 'capture'], unit: 'count' },
  { key: 'contests', label: 'Contests', aliases: ['contests', 'contest'], unit: 'count' },
  { key: 'deploys', label: 'Deploys', aliases: ['deploys', 'deploy'], unit: 'count' },
  { key: 'loots', label: 'Loot', aliases: ['loots', 'loot'], unit: 'count' },
  { key: 'lifts', label: 'Lift', aliases: ['lifts', 'lift'], unit: 'count' },
  { key: 'extracted', label: 'Extracted', aliases: ['extracted'], unit: 'count' },
  { key: 'extractedValue', label: 'Extracted value', aliases: ['extractedValue', 'extracted_value'], unit: 'count' },
  { key: 'distance', label: 'Distance', aliases: ['distance', 'distanceKm', 'distance_km'], unit: 'km' },
  { key: 'disconnects', label: 'Disconnects', aliases: ['disconnects', 'disconnect'], unit: 'count' },
  { key: 'renderFailures', label: 'Render failures', aliases: ['renderFailures', 'render_failures'], unit: 'count' },
  { key: 'endReason', label: 'End reason', aliases: ['endReason', 'end_reason', 'outcome'], unit: '' },
  { key: 'endReasons', label: 'End reasons', aliases: ['endReasons', 'end_reasons'], unit: '' },
  { key: 'interactions', label: 'Interactions', aliases: ['interactions'], unit: '' },
  { key: 'zone', label: 'Zone', aliases: ['zone', 'zones'], unit: '' },
  { key: 'poi', label: 'POI', aliases: ['poi', 'pois'], unit: '' },
  { key: 'layer', label: 'Layer', aliases: ['layer', 'layers'], unit: '' },
  { key: 'audio', label: 'Audio', aliases: ['audio', 'audioTrack', 'audio_track'], unit: '' },
] as const

type BreakdownField = typeof breakdownFields[number]
const distanceBreakdownField = breakdownFields.find(field => field.key === 'distance')!
const endReasonsBreakdownField = breakdownFields.find(field => field.key === 'endReasons')!

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function nestedValue(value: Record<string, unknown>, key: string): unknown {
  if (!key.includes('.'))
    return value[key]
  const [head, ...tail] = key.split('.')
  if (!head)
    return undefined
  const child = objectValue(value[head])
  return child ? nestedValue(child, tail.join('.')) : undefined
}

function breakdownValue(item: GamingBreakdown, field: BreakdownField): unknown {
  const record = item as unknown as Record<string, unknown>
  const containers = [record, objectValue(record.stats), objectValue(record.details), objectValue(record.metrics)].filter((value): value is Record<string, unknown> => Boolean(value))
  for (const container of containers) {
    for (const alias of field.aliases) {
      const value = nestedValue(container, alias)
      if (value !== null && value !== undefined && value !== '')
        return value
    }
  }
  return null
}

const visibleBreakdownFields = computed(() => {
  const rows = [...(reportWithExtras.value?.games || []), ...(reportWithExtras.value?.modes || [])]
  return breakdownFields.filter(field => rows.some(row => breakdownValue(row, field) !== null))
})

const sectorRows = computed(() => reportWithExtras.value?.sectors || [])

const relayRows = computed(() => {
  const rows = [...(reportWithExtras.value?.games || []), ...(reportWithExtras.value?.modes || [])]
  return rows.filter((row) => {
    const endReasons = objectValue(breakdownValue(row, endReasonsBreakdownField))
    return /relay/i.test(`${row.id} ${row.label}`) || Boolean(endReasons && Object.keys(endReasons).length)
  })
})

const interactionRows = computed(() => {
  const explicit = reportWithExtras.value?.interactions || []
  if (explicit.length)
    return explicit
  const interactionsField = breakdownFields.find(field => field.key === 'interactions')!
  return [...(reportWithExtras.value?.games || []), ...(reportWithExtras.value?.modes || [])]
    .flatMap((row) => {
      const value = objectValue(breakdownValue(row, interactionsField))
      if (!value)
        return []
      return Object.entries(value).map(([label, count]) => ({
        gameId: row.id,
        label,
        count: typeof count === 'number' ? count : Number(count) || 0,
      }))
    })
})

const kesslerInteractions = computed(() => {
  return interactionRows.value.filter(item => /kessler/i.test(`${item.gameId} ${item.label}`))
})

const relayEndReasons = computed(() => {
  const rows = reportWithExtras.value?.endReasons || []
  return rows.filter(item => /relay/i.test(`${item.gameId} ${item.reason}`))
})

const authorityMetrics = computed(() => (data.value?.overview || []).filter(metric => metric.key.startsWith('authoritative_')))

function formatBreakdownValue(item: GamingBreakdown, field: BreakdownField) {
  const value = breakdownValue(item, field)
  if (value === null)
    return '—'
  if (typeof value === 'number')
    return formatObservabilityNumber(value, field.unit)
  if (Array.isArray(value))
    return value.join(', ')
  if (typeof value === 'object')
    return Object.entries(value).map(([label, count]) => `${label}: ${typeof count === 'number' ? formatObservabilityNumber(count, 'count') : String(count)}`).join(' · ')
  return String(value)
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function formatDateTime(value: string | null | undefined) {
  if (!value)
    return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function metricReason(metric: ObservabilityMetric) {
  return metric.value === null ? (metric.detail || 'Provider did not return this metric.') : metric.detail
}

function sessionLabel(session: GamingSession) {
  return session.playerLabel || session.playerId || 'Anonymous player'
}

function gameLabel(id: string) {
  return data.value?.games.find(item => item.id === id)?.label || id
}

async function exportReport() {
  if (!import.meta.client || !data.value || exportLoading.value)
    return
  exportLoading.value = true
  exportError.value = null
  try {
    const path = appendObservabilityQuery('/api/admin/observability/gaming', {
      range: range.value,
      game: game.value || undefined,
      mode: mode.value || undefined,
      transport: transport.value || undefined,
      format: 'csv',
    })
    const blob = await useAPI<Blob>(path, { responseType: 'blob' })
    if (!(blob instanceof Blob))
      throw new Error('The gaming export did not return a CSV file.')
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `gaming-${range.value}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  catch (cause: unknown) {
    exportError.value = cause instanceof Error ? cause.message : 'The gaming export could not be downloaded.'
  }
  finally {
    exportLoading.value = false
  }
}

function clearDetail() {
  const trigger = detailTrigger
  detailController?.abort()
  detailRequest += 1
  detailController = null
  detailKind.value = null
  sessionDetail.value = null
  playerDetail.value = null
  detailError.value = null
  detailMoreError.value = null
  detailMoreLoading.value = false
  detailTrigger = null
  void nextTick(() => trigger?.focus())
}

async function openSession(session: GamingSession, event?: Event) {
  detailTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  detailController?.abort()
  detailController = new AbortController()
  const request = ++detailRequest
  detailKind.value = 'session'
  sessionDetail.value = null
  playerDetail.value = null
  detailLoading.value = true
  detailError.value = null
  detailMoreError.value = null
  try {
    const result = await useAPI<GamingSessionDetail>(`/api/admin/observability/gaming/sessions/${encodeURIComponent(session.id)}`, { signal: detailController.signal })
    if (request === detailRequest)
      sessionDetail.value = result
  }
  catch (cause: unknown) {
    if (request !== detailRequest || (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError'))
      return
    detailError.value = cause instanceof Error ? cause.message : 'Session details could not be loaded.'
  }
  finally {
    if (request === detailRequest)
      detailLoading.value = false
  }
}

async function openPlayer(player: GamingPlayer, event?: Event) {
  detailTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  detailController?.abort()
  detailController = new AbortController()
  const request = ++detailRequest
  detailKind.value = 'player'
  sessionDetail.value = null
  playerDetail.value = null
  detailLoading.value = true
  detailError.value = null
  detailMoreError.value = null
  try {
    const result = await useAPI<GamingPlayerDetail>(`/api/admin/observability/gaming/players/${encodeURIComponent(player.id)}`, { signal: detailController.signal })
    if (request === detailRequest)
      playerDetail.value = result
  }
  catch (cause: unknown) {
    if (request !== detailRequest || (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError'))
      return
    detailError.value = cause instanceof Error ? cause.message : 'Player details could not be loaded.'
  }
  finally {
    if (request === detailRequest)
      detailLoading.value = false
  }
}

async function loadMoreSessionTimeline() {
  const current = sessionDetailWithExtras.value
  const cursor = current?.timelineNextCursor
  if (!current || !cursor || detailMoreLoading.value)
    return
  detailMoreLoading.value = true
  detailMoreError.value = null
  const controller = new AbortController()
  detailController?.abort()
  detailController = controller
  const request = ++detailRequest
  try {
    const path = appendObservabilityQuery(`/api/admin/observability/gaming/sessions/${encodeURIComponent(current.session.id)}`, { timeline_cursor: cursor })
    const result = await useAPI<GamingSessionDetailExtra>(path, { signal: controller.signal })
    if (request === detailRequest && sessionDetail.value) {
      sessionDetail.value = {
        ...result,
        timeline: [...sessionDetail.value.timeline, ...result.timeline.filter(item => !sessionDetail.value?.timeline.some(existing => existing.id === item.id))],
      }
    }
  }
  catch (cause: unknown) {
    if (request !== detailRequest || (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError'))
      return
    detailMoreError.value = cause instanceof Error ? cause.message : 'More timeline events could not be loaded.'
  }
  finally {
    if (request === detailRequest)
      detailMoreLoading.value = false
  }
}

async function loadMorePlayerSessions() {
  const current = playerDetailWithExtras.value
  const cursor = current?.sessionsNextCursor
  if (!current || !cursor || detailMoreLoading.value)
    return
  detailMoreLoading.value = true
  detailMoreError.value = null
  const controller = new AbortController()
  detailController?.abort()
  detailController = controller
  const request = ++detailRequest
  try {
    const path = appendObservabilityQuery(`/api/admin/observability/gaming/players/${encodeURIComponent(current.player.id)}`, { cursor })
    const result = await useAPI<GamingPlayerDetailExtra>(path, { signal: controller.signal })
    if (request === detailRequest && playerDetail.value) {
      playerDetail.value = {
        ...result,
        sessions: [...playerDetail.value.sessions, ...result.sessions.filter(item => !playerDetail.value?.sessions.some(existing => existing.id === item.id))],
      }
    }
  }
  catch (cause: unknown) {
    if (request !== detailRequest || (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError'))
      return
    detailMoreError.value = cause instanceof Error ? cause.message : 'More player sessions could not be loaded.'
  }
  finally {
    if (request === detailRequest)
      detailMoreLoading.value = false
  }
}

watch(detailKind, (kind) => {
  if (kind)
    void nextTick(() => detailPanel.value?.focus())
})

function handleDetailKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    clearDetail()
  }
}

onBeforeUnmount(() => detailController?.abort())
</script>

<template>
  <section class="observability-page" aria-labelledby="gaming-report-title">
    <header class="observability-heading">
      <div>
        <p class="portfolio-eyebrow">Gaming observability</p>
        <h1 id="gaming-report-title">Gaming</h1>
        <p>Anonymous journeys, sessions, game modes, and online performance with verification labels.</p>
      </div>
    </header>

    <Teleport v-if="teleportReady" to="#dashboard-header-actions">
      <div class="observability-controls">
        <button class="observability-button" type="button" :disabled="loading" @click="refresh">
          <RefreshCw :size="15" :class="{ 'motion-safe:animate-spin': loading }" aria-hidden="true" />
          Refresh
        </button>
        <button class="observability-button" type="button" :disabled="!data || exportLoading" @click="exportReport">
          <Download :size="15" aria-hidden="true" />
          {{ exportLoading ? 'Preparing CSV…' : 'Export CSV' }}
        </button>
      </div>
    </Teleport>

    <div class="observability-filter-line" aria-label="Gaming report filters">
      <label>
        Range
        <select v-model="range" class="observability-filter">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="13m">Last 13 months</option>
        </select>
      </label>
      <label>
        Game
        <select v-model="game" class="observability-filter">
          <option value="">All games</option>
          <option v-for="item in data?.games || []" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label>
        Mode
        <select v-model="mode" class="observability-filter">
          <option value="">All modes</option>
          <option v-for="item in data?.modes || []" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label>
        Transport
        <input v-model="transport" class="observability-filter" type="search" placeholder="All transports">
      </label>
      <div class="observability-filter-line__grow observability-meta">
        {{ selectedGameLabel }} · refreshes while this tab is visible
        <span v-if="lastUpdated"> · refreshed {{ formatDateTime(lastUpdated) }}</span>
      </div>
    </div>

    <div class="observability-tabs" role="tablist" aria-label="Gaming report sections">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.id"
        class="observability-tab"
        :id="`gaming-tab-${tab.id}`"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        aria-controls="gaming-panel"
        :tabindex="activeTab === tab.id ? 0 : -1"
        :data-active="activeTab === tab.id"
        @keydown="handleTabKeydown($event, index)"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
    </div>

    <p v-if="stale" class="observability-stale" role="status">The selected filters are still pending or failed. Showing the last successful gaming response from {{ formatDateTime(data?.meta?.from) }} to {{ formatDateTime(data?.meta?.to) }}.</p>
    <p v-if="error" class="observability-error" role="alert">{{ error }}</p>
    <p v-if="exportError" class="observability-error" role="alert">{{ exportError }}</p>
    <p v-else-if="loading && !data" class="observability-empty" aria-live="polite">Loading gaming report…</p>
    <p v-else-if="!data" class="observability-empty">No gaming report returned for this range.</p>
    <p v-if="range === '13m'" class="observability-meta">Session and player drilldowns cover the last 90 days; older totals use daily summaries.</p>

    <template v-if="data">
      <div id="gaming-panel" class="observability-panel" role="tabpanel" :aria-labelledby="`gaming-tab-${activeTab}`" tabindex="0">
        <div class="observability-card observability-card--full">
          <div class="observability-card__header">
            <div><h2>Source coverage</h2><p>Server verified and client reported data remain distinguishable below.</p></div>
            <ObservabilityCoverage :coverage="data.coverage" />
          </div>
          <p class="observability-meta">{{ formatDateTime(data.meta.from) }} → {{ formatDateTime(data.meta.to) }} · checked {{ formatDateTime(data.meta.checkedAt) }}</p>
        </div>

        <div v-if="activeTab === 'overview'" class="observability-grid">
          <article v-for="metric in overviewMetrics" :key="metric.key" class="observability-card observability-card--metric">
            <h2>{{ metric.label }}</h2>
            <span class="observability-value" :title="observabilityMetricTitle(metric)" :data-unavailable="metric.value === null">{{ formatObservabilityMetric(metric) }}</span>
            <p v-if="metricReason(metric)" class="observability-card__hint">{{ metricReason(metric) }}</p>
          </article>
          <article class="observability-card observability-card--metric"><h2>Active humans</h2><span class="observability-value" :data-unavailable="activeHumans === null">{{ formatObservabilityNumber(activeHumans) }}</span><p class="observability-card__hint">Current player presence</p></article>
          <article class="observability-card observability-card--metric"><h2>Active bots</h2><span class="observability-value" :data-unavailable="activeBots === null">{{ formatObservabilityNumber(activeBots) }}</span><p class="observability-card__hint">Bots kept separate from humans</p></article>
        </div>

        <article v-if="activeTab === 'games' && authorityMetrics.length" class="observability-card observability-card--full">
          <div class="observability-card__header"><div><h2>Server verified mode stats</h2><p>Authoritative counters are shown when the arcade telemetry source returns them.</p></div></div>
          <div class="observability-table-wrap">
            <table class="observability-table">
              <thead><tr><th>Metric</th><th>Value</th><th>Source detail</th></tr></thead>
              <tbody>
                <tr v-for="metric in authorityMetrics" :key="metric.key"><th scope="row">{{ metric.label }}</th><td :title="observabilityMetricTitle(metric)">{{ formatObservabilityMetric(metric) }}</td><td class="observability-table__muted">{{ metric.detail || 'Server verified' }}</td></tr>
              </tbody>
            </table>
          </div>
        </article>

        <article v-if="activeTab === 'overview'" class="observability-card observability-card--wide">
          <div class="observability-card__header"><div><h2>Anonymous journey starts</h2><p>Daily counts are returned by the gaming source.</p></div></div>
          <ObservabilityLineChart :points="dailyPoints" empty-label="No daily gaming series returned." />
        </article>

        <div v-if="activeTab === 'overview'" class="observability-grid">
          <article class="observability-card">
            <div class="observability-card__header"><div><h2>Journey funnel</h2><p>Entry, play, and completion counts for the selected window.</p></div></div>
            <div class="observability-bars">
              <div v-for="stage in data.funnel" :key="stage.stage" class="observability-bar">
                <div class="observability-bar__label"><span>{{ stage.stage }}</span><strong>{{ stage.count }}</strong></div>
                <div class="observability-bar__track"><div class="observability-bar__value" :style="{ width: `${data.funnel[0]?.count ? Math.min(100, stage.count / data.funnel[0].count * 100) : 0}%` }" /></div>
              </div>
              <p v-if="data.funnel.length === 0" class="observability-empty">No funnel data returned.</p>
            </div>
          </article>
          <article class="observability-card">
            <div class="observability-card__header"><div><h2>Games</h2><p>Starts and completion counts by game.</p></div></div>
            <ul class="observability-inline-list">
              <li v-for="item in data.games.slice(0, 6)" :key="item.id"><span>{{ item.label }}</span><strong>{{ item.starts }}</strong></li>
              <li v-if="data.games.length === 0" class="observability-table__muted">No game breakdown returned.</li>
            </ul>
          </article>
        </div>

        <div v-if="activeTab === 'games'" class="observability-grid">
          <article class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Games & modes</h2><p>Per-game and mode stats, including RELAY RUN distance and Kessler interactions where returned.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Game</th><th>Starts</th><th>Players</th><th>Completions</th><th>Play time</th><th>Score</th><th v-for="field in visibleBreakdownFields" :key="`game-head-${field.key}`">{{ field.label }}</th></tr></thead>
                <tbody>
                  <tr v-for="item in data.games" :key="item.id"><th scope="row">{{ item.label }}</th><td :title="observabilityNumberTitle(item.starts)">{{ formatObservabilityNumber(item.starts) }}</td><td :title="observabilityNumberTitle(item.players)">{{ formatObservabilityNumber(item.players) }}</td><td :title="observabilityNumberTitle(item.completions)">{{ formatObservabilityNumber(item.completions) }}</td><td :title="observabilityNumberTitle(item.playSeconds, 's')">{{ formatObservabilityNumber(item.playSeconds, 's') }}</td><td :title="observabilityNumberTitle(item.score)">{{ formatObservabilityNumber(item.score) }}</td><td v-for="field in visibleBreakdownFields" :key="`${item.id}-${field.key}`">{{ formatBreakdownValue(item, field) }}</td></tr>
                  <tr v-if="data.games.length === 0"><td :colspan="6 + visibleBreakdownFields.length" class="observability-table__muted">No game rows returned.</td></tr>
                </tbody>
              </table>
            </div>
          </article>
          <article class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Modes</h2><p>Mode-level counts for the selected filters.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Mode</th><th>Starts</th><th>Players</th><th>Completions</th><th>Play time</th><th>Score</th><th v-for="field in visibleBreakdownFields" :key="`mode-head-${field.key}`">{{ field.label }}</th></tr></thead>
                <tbody>
                  <tr v-for="item in data.modes" :key="item.id"><th scope="row">{{ item.label }}</th><td :title="observabilityNumberTitle(item.starts)">{{ formatObservabilityNumber(item.starts) }}</td><td :title="observabilityNumberTitle(item.players)">{{ formatObservabilityNumber(item.players) }}</td><td :title="observabilityNumberTitle(item.completions)">{{ formatObservabilityNumber(item.completions) }}</td><td :title="observabilityNumberTitle(item.playSeconds, 's')">{{ formatObservabilityNumber(item.playSeconds, 's') }}</td><td :title="observabilityNumberTitle(item.score)">{{ formatObservabilityNumber(item.score) }}</td><td v-for="field in visibleBreakdownFields" :key="`${item.id}-${field.key}`">{{ formatBreakdownValue(item, field) }}</td></tr>
                  <tr v-if="data.modes.length === 0"><td :colspan="6 + visibleBreakdownFields.length" class="observability-table__muted">No mode rows returned.</td></tr>
                </tbody>
              </table>
            </div>
          </article>
          <article v-if="sectorRows.length" class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Sector popularity</h2><p>Sector-level starts, players, completions, and play time.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Sector</th><th>Starts</th><th>Players</th><th>Completions</th><th>Play time</th><th>Score</th></tr></thead>
                <tbody>
                  <tr v-for="item in sectorRows" :key="item.id"><th scope="row">{{ item.label }}</th><td>{{ formatObservabilityNumber(item.starts) }}</td><td>{{ formatObservabilityNumber(item.players) }}</td><td>{{ formatObservabilityNumber(item.completions) }}</td><td>{{ formatObservabilityNumber(item.playSeconds, 's') }}</td><td>{{ formatObservabilityNumber(item.score) }}</td></tr>
                  <tr v-if="sectorRows.length === 0"><td colspan="6" class="observability-table__muted">No sector rows returned.</td></tr>
                </tbody>
              </table>
            </div>
          </article>
          <article v-if="relayRows.length || relayEndReasons.length" class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>RELAY RUN telemetry</h2><p>Distance and end reasons stay separate from completion counts.</p></div></div>
            <div v-if="relayRows.length" class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Breakdown</th><th>Distance</th><th>End reasons</th></tr></thead>
                <tbody>
                  <tr v-for="item in relayRows" :key="`relay-${item.id}`"><th scope="row">{{ item.label }}</th><td>{{ formatBreakdownValue(item, distanceBreakdownField) }}</td><td>{{ formatBreakdownValue(item, endReasonsBreakdownField) }}</td></tr>
                </tbody>
              </table>
            </div>
            <div v-if="relayEndReasons.length" class="observability-table-wrap observability-table-wrap--spaced">
              <table class="observability-table">
                <thead><tr><th>Game</th><th>End reason</th><th>Count</th></tr></thead>
                <tbody><tr v-for="item in relayEndReasons" :key="`${item.gameId}-${item.reason}`"><th scope="row">{{ item.gameId }}</th><td>{{ item.reason }}</td><td>{{ formatObservabilityNumber(item.count) }}</td></tr></tbody>
              </table>
            </div>
          </article>
          <article v-if="kesslerInteractions.length" class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Kessler interactions</h2><p>Interaction events returned for the selected game and mode filters.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Game</th><th>Interaction</th><th>Count</th></tr></thead>
                <tbody><tr v-for="item in kesslerInteractions" :key="`${item.gameId}-${item.label}`"><th scope="row">{{ item.gameId }}</th><td>{{ item.label }}</td><td>{{ formatObservabilityNumber(item.count) }}</td></tr></tbody>
              </table>
            </div>
          </article>
        </div>

        <div v-if="activeTab === 'players'" class="observability-grid">
          <article class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Players</h2><p>Anonymous and returning players can be opened for session history.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Player</th><th>Sessions</th><th>Play time</th><th>First seen</th><th>Last seen</th><th>Journey</th><th /></tr></thead>
                <tbody>
                  <tr v-for="player in data.players" :key="player.id"><th scope="row">{{ player.label }}</th><td>{{ player.sessions }}</td><td>{{ formatObservabilityNumber(player.playSeconds, 's') }}</td><td>{{ formatDateTime(player.firstSeenAt) }}</td><td>{{ formatDateTime(player.lastSeenAt) }}</td><td>{{ player.returning ? 'Returning' : 'New' }}</td><td><button type="button" class="observability-table__action" @click="openPlayer(player, $event)">Inspect</button></td></tr>
                  <tr v-if="data.players.length === 0"><td colspan="7" class="observability-table__muted">No player rows returned.</td></tr>
                </tbody>
              </table>
            </div>
          </article>
          <article class="observability-card observability-card--full">
            <div class="observability-card__header"><div><h2>Sessions</h2><p>Verification is displayed per session: server verified or client reported.</p></div></div>
            <div class="observability-table-wrap">
              <table class="observability-table">
                <thead><tr><th>Player</th><th>Game / mode</th><th>Transport</th><th>Started</th><th>Duration</th><th>Score</th><th>Verification</th><th /></tr></thead>
                <tbody>
                  <tr v-for="session in data.sessions" :key="session.id"><th scope="row">{{ sessionLabel(session) }}</th><td>{{ gameLabel(session.gameId) }}<span v-if="session.mode" class="observability-table__muted"> · {{ session.mode }}</span></td><td>{{ session.transport }}</td><td>{{ formatDateTime(session.startedAt) }}</td><td>{{ formatObservabilityNumber(session.durationSeconds, 's') }}</td><td>{{ formatObservabilityNumber(session.score) }}</td><td><span class="observability-status" :data-state="session.verification === 'server_verified' ? 'live' : 'partial'">{{ session.verification === 'server_verified' ? 'Server verified' : 'Client reported' }}</span></td><td><button type="button" class="observability-table__action" @click="openSession(session, $event)">Inspect</button></td></tr>
                  <tr v-if="data.sessions.length === 0"><td colspan="8" class="observability-table__muted">No session rows returned.</td></tr>
                </tbody>
              </table>
            </div>
          </article>
        </div>

        <div v-if="activeTab === 'online'" class="observability-grid">
          <article class="observability-card observability-card--metric"><h2>Active humans</h2><span class="observability-value" :data-unavailable="activeHumans === null">{{ formatObservabilityNumber(activeHumans) }}</span><p class="observability-card__hint">Checked {{ formatDateTime(data.live.checkedAt) }}</p></article>
          <article class="observability-card observability-card--metric"><h2>Active bots</h2><span class="observability-value" :data-unavailable="activeBots === null">{{ formatObservabilityNumber(activeBots) }}</span><p class="observability-card__hint">Kept separate from human presence</p></article>
          <article class="observability-card observability-card--metric"><h2>Rooms</h2><span class="observability-value" :data-unavailable="data.live.rooms === null">{{ formatObservabilityNumber(data.live.rooms) }}</span><p class="observability-card__hint">Live source status: {{ data.live.status }}</p></article>
          <article v-for="metric in onlineMetrics" :key="metric.key" class="observability-card observability-card--metric"><h2>{{ metric.label }}</h2><span class="observability-value" :data-unavailable="metric.value === null">{{ formatObservabilityMetric(metric) }}</span><p v-if="metricReason(metric)" class="observability-card__hint">{{ metricReason(metric) }}</p></article>
          <article v-if="onlineMetrics.length === 0" class="observability-card observability-card--full"><p class="observability-empty">No performance metrics returned.</p></article>
        </div>
      </div>
    </template>

    <div v-if="detailKind" class="observability-drawer" role="dialog" aria-modal="true" aria-labelledby="gaming-detail-title" @keydown="handleDetailKeydown">
      <article ref="detailPanel" class="observability-drawer__panel" tabindex="-1">
        <header class="observability-drawer__header">
          <div>
            <h2 id="gaming-detail-title">{{ detailKind === 'session' ? 'Session detail' : 'Player detail' }}</h2>
            <p v-if="sessionDetail">{{ sessionLabel(sessionDetail.session) }} · {{ gameLabel(sessionDetail.session.gameId) }}</p>
            <p v-else-if="playerDetail">{{ playerDetail.player.label }}</p>
          </div>
          <button class="observability-button" type="button" aria-label="Close detail" @click="clearDetail"><X :size="15" aria-hidden="true" /></button>
        </header>
        <p v-if="detailLoading" class="observability-empty">Loading detail…</p>
        <p v-else-if="detailError" class="observability-error">{{ detailError }}</p>
        <template v-else-if="sessionDetail">
          <div class="observability-grid">
            <article class="observability-card observability-card--metric"><h3>Verification</h3><span class="observability-value">{{ sessionDetail.session.verification === 'server_verified' ? 'Server verified' : 'Client reported' }}</span></article>
            <article class="observability-card observability-card--metric"><h3>Duration</h3><span class="observability-value">{{ formatObservabilityNumber(sessionDetail.session.durationSeconds, 's') }}</span></article>
            <article class="observability-card observability-card--metric"><h3>Score</h3><span class="observability-value">{{ formatObservabilityNumber(sessionDetail.session.score) }}</span></article>
          </div>
          <div v-if="sessionDetail.session.details" class="observability-card"><div class="observability-card__header"><h3>Game details</h3></div><ul class="observability-inline-list"><li v-for="(value, key) in sessionDetail.session.details" :key="key"><span>{{ key }}</span><strong>{{ value ?? '—' }}</strong></li></ul></div>
          <div class="observability-card">
            <div class="observability-card__header">
              <div><h3>Timeline</h3><p>{{ sessionDetail.timeline.length }}<span v-if="sessionDetailWithExtras?.timelineTotal"> of {{ sessionDetailWithExtras?.timelineTotal }}</span> events loaded<span v-if="sessionDetailWithExtras?.timelineTruncated && !sessionDetailWithExtras?.timelineNextCursor"> · provider limit reached</span></p></div>
              <button v-if="sessionDetailWithExtras?.timelineNextCursor" class="observability-button" type="button" :disabled="detailMoreLoading" @click="loadMoreSessionTimeline">{{ detailMoreLoading ? 'Loading…' : 'Load more' }}</button>
            </div>
            <ul class="observability-inline-list"><li v-for="item in sessionDetail.timeline" :key="item.id"><span>{{ formatDateTime(item.at) }} · {{ item.kind }}</span><strong>{{ item.detail || '—' }}</strong></li><li v-if="sessionDetail.timeline.length === 0" class="observability-table__muted">No timeline events returned.</li></ul>
            <p v-if="detailMoreError" class="observability-error" role="alert">{{ detailMoreError }}</p>
          </div>
          <div class="observability-card">
            <div class="observability-card__header"><div><h3>Participants</h3><p>{{ sessionDetail.participants.length }}<span v-if="sessionDetailWithExtras?.participantsTotal"> of {{ sessionDetailWithExtras?.participantsTotal }}</span> participants shown<span v-if="sessionDetailWithExtras?.participantsTruncated"> · provider limit reached</span></p></div></div>
            <ul class="observability-inline-list"><li v-for="item in sessionDetail.participants" :key="item.label"><span>{{ item.label }}{{ item.bot ? ' · bot' : ' · human' }}</span><strong>{{ item.score ?? '—' }}</strong></li><li v-if="sessionDetail.participants.length === 0" class="observability-table__muted">No participant rows returned.</li></ul>
          </div>
        </template>
        <template v-else-if="playerDetail">
          <div class="observability-grid"><article class="observability-card observability-card--metric"><h3>Sessions</h3><span class="observability-value">{{ playerDetail.player.sessions }}</span></article><article class="observability-card observability-card--metric"><h3>Play time</h3><span class="observability-value">{{ formatObservabilityNumber(playerDetail.player.playSeconds, 's') }}</span></article><article class="observability-card observability-card--metric"><h3>Journey</h3><span class="observability-value">{{ playerDetail.player.returning ? 'Returning' : 'New' }}</span></article></div>
          <div class="observability-card">
            <div class="observability-card__header">
              <div><h3>Sessions</h3><p>{{ playerDetail.sessions.length }}<span v-if="playerDetailWithExtras?.sessionsTotal"> of {{ playerDetailWithExtras?.sessionsTotal }}</span> sessions loaded<span v-if="playerDetailWithExtras?.sessionsTruncated && !playerDetailWithExtras?.sessionsNextCursor"> · provider limit reached</span></p></div>
              <button v-if="playerDetailWithExtras?.sessionsNextCursor" class="observability-button" type="button" :disabled="detailMoreLoading" @click="loadMorePlayerSessions">{{ detailMoreLoading ? 'Loading…' : 'Load more' }}</button>
            </div>
            <ul class="observability-inline-list"><li v-for="session in playerDetail.sessions" :key="session.id"><span>{{ gameLabel(session.gameId) }} · {{ formatDateTime(session.startedAt) }}</span><strong>{{ session.verification === 'server_verified' ? 'Server verified' : 'Client reported' }}</strong></li><li v-if="playerDetail.sessions.length === 0" class="observability-table__muted">No sessions returned.</li></ul>
            <p v-if="detailMoreError" class="observability-error" role="alert">{{ detailMoreError }}</p>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>
