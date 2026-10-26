<!-- eslint-disable better-tailwindcss/no-unknown-classes, vue/singleline-html-element-content-newline -->
<script setup lang="ts">
type ReportName = 'overview' | 'traffic' | 'content' | 'engagement' | 'goals' | 'performance'
type SourceState = 'live' | 'estimated' | 'partial' | 'unavailable' | 'not-instrumented' | 'stale'

const props = withDefaults(defineProps<{
  report?: ReportName
  title: string
  intro: string
}>(), {
  report: 'overview',
})

interface Metric {
  label: string
  value?: string | number | null
  detail?: string
  state?: SourceState
}

interface ChartPoint {
  label: string
  value: number
  raw: number
}

interface ReportPayload {
  hasData: boolean
  sourceState: SourceState
  sourceNote: string
  updatedAt?: string
  range?: string
  metrics: Metric[]
  series: ChartPoint[]
  highlights: string[]
}

interface BackendReport {
  data?: Record<string, unknown>
  meta?: {
    source?: string
    reason?: string
    detail?: string
    range?: {
      preset?: string
      from?: string
      to?: string
    }
    coverage?: {
      has_data?: boolean
      unavailable?: boolean
      stale?: boolean | number | null
      rum_vitals?: {
        available?: boolean
        unavailable?: boolean
        has_data?: boolean
        reason?: string
      }
    }
  }
}

const payload = shallowRef<ReportPayload | null>(null)
const loading = shallowRef(true)
const error = shallowRef('')
const refreshedAt = shallowRef('')

const endpoint = computed(() => props.report === 'overview'
  ? '/api/admin/overview'
  : `/api/admin/portfolio/${props.report === 'goals' ? 'conversions' : props.report}`)

const defaultMetrics = computed<Metric[]>(() => {
  const labels: Record<ReportName, string[]> = {
    overview: ['Views', 'Visitors', 'Sessions', 'Goal completions'],
    traffic: ['Events', 'Unique paths', 'Referrers', 'Campaigns'],
    content: ['Content pages', 'Views', 'Completions', 'Average progress'],
    engagement: ['Events', 'Active time', 'Media events', 'Played time'],
    goals: ['Goals completed', 'Engagement', 'Career contact', 'Shortlink campaigns'],
    performance: ['Worker requests', 'Worker errors', 'CPU time', 'RUM vitals'],
  }

  return labels[props.report].map(label => ({ label }))
})

const metrics = computed(() => payload.value?.metrics.length ? payload.value.metrics : defaultMetrics.value)
const sourceState = computed<SourceState>(() => payload.value?.sourceState ?? (error.value ? 'unavailable' : 'not-instrumented'))
const hasData = computed(() => payload.value?.hasData === true)

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : []
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sum(values: unknown[]): number | null {
  const numbers = values.map(numberValue).filter((value): value is number => value !== null)
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null
}

function latestNumber(values: unknown[]): number | null {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = numberValue(values[index])
    if (value !== null)
      return value
  }
  return null
}

interface WorkerSummary {
  requests: number | null
  errors: number | null
  cpuP99: number | null
}

function workerSummary(value: unknown): WorkerSummary {
  const source = record(value)
  const scriptValues = Array.isArray(value)
    ? [{ rows: value }]
    : Object.values(record(source.scripts))
  const totals = scriptValues.map(script => record(record(script).totals))
  const rows = scriptValues.flatMap(script => records(record(script).rows))
  const cpuP99 = latestNumber(rows.map(row => record(record(row.cpu_time_us)).p99))

  return {
    requests: sum(totals.map(total => total.requests)) ?? sum(rows.map(row => record(row.sum).requests ?? row.requests)),
    errors: sum(totals.map(total => total.errors)) ?? sum(rows.map(row => record(row.sum).errors ?? row.errors)),
    cpuP99,
  }
}

interface RumSummary {
  samples: number | null
  series: Record<string, unknown>[]
  lcpP75: number | null
  inpP75: number | null
  clsP75: number | null
}

function rumSummary(value: unknown): RumSummary | null {
  if (!value || typeof value !== 'object')
    return null

  const source = record(value)
  const series = records(source.series)
  const metrics = series.map(row => record(row.metrics))
  return {
    samples: numberValue(source.samples),
    series,
    lcpP75: latestNumber(metrics.map(metricItem => metricItem.lcp_ms_p75)),
    inpP75: latestNumber(metrics.map(metricItem => metricItem.inp_ms_p75)),
    clsP75: latestNumber(metrics.map(metricItem => metricItem.cls_p75)),
  }
}

function formatNumber(value: number | null): number | null {
  return value === null ? null : Math.round(value)
}

function formatPercent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`
}

function formatDuration(value: number | null): string | null {
  if (value === null)
    return null
  const seconds = Math.round(value / 1000)
  if (seconds < 60)
    return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function metric(label: string, value: string | number | null, detail: string, state?: SourceState): Metric {
  return { label, value, detail, state }
}

function sourceStateFor(response: BackendReport): SourceState {
  const coverage = response.meta?.coverage
  if (coverage?.unavailable)
    return 'unavailable'
  if (coverage?.stale)
    return 'stale'
  if (response.meta?.detail === 'daily_rollup')
    return 'partial'
  if (coverage?.has_data)
    return 'live'
  return 'not-instrumented'
}

function chartSeries(data: Record<string, unknown>, report: ReportName): ChartPoint[] {
  const daily = records(data.daily)
  const rawValues = daily.map(row => numberValue(report === 'overview' ? row.page_views ?? row.events : row.events))
  const points = daily.flatMap((row, index) => {
    const raw = rawValues[index] ?? null
    const day = typeof row.day === 'string' ? row.day : ''
    return raw !== null && day ? [{ label: day.slice(5), raw, value: raw }] : []
  })
  const maximum = Math.max(...points.map(point => point.raw), 0)
  return points.map(point => ({
    ...point,
    value: maximum > 0 ? Math.max(4, Math.round((point.raw / maximum) * 100)) : 4,
  }))
}

function normalizeReport(response: BackendReport, report: ReportName): ReportPayload {
  const data = record(response.data)
  const coverage = response.meta?.coverage
  const sourceState = sourceStateFor(response)
  const source = response.meta?.source || 'portfolio analytics'
  const detail = response.meta?.detail === 'daily_rollup'
    ? 'This period uses retained daily summaries; raw event detail has expired.'
    : response.meta?.reason || (coverage?.has_data ? `Source: ${source}.` : 'No trusted events were returned for this window.')
  const range = response.meta?.range?.preset || [response.meta?.range?.from, response.meta?.range?.to].filter(Boolean).join(' → ')
  const series = chartSeries(data, report)
  const metrics: Metric[] = []
  const highlights = Array.isArray(data.insights)
    ? data.insights.filter((item): item is string => typeof item === 'string')
    : []

  if (report === 'overview') {
    const goals = records(data.goals)
    const goalCompletions = sum(goals.map(goal => goal.conversions))
    metrics.push(
      metric('Views', formatNumber(numberValue(data.page_views)), 'Accepted page_view events.'),
      metric('Visitors', formatNumber(numberValue(data.unique_visitors)), 'HLL estimate from pseudonymous visitor keys.', 'estimated'),
      metric('Sessions', formatNumber(numberValue(data.sessions)), 'Thirty-minute inactivity window.'),
      metric('Goal completions', formatNumber(goalCompletions), 'Named engagement and contact events.'),
      metric('Active visitors', formatNumber(numberValue(data.active_visitors_5m)), 'Estimated visitors active in the last five minutes.', 'estimated'),
      metric('Article completions', formatNumber(numberValue(data.article_completions)), 'Explicit article_complete events.'),
    )
  }

  if (report === 'traffic') {
    const paths = records(data.paths)
    const referrers = records(data.referrers)
    const campaigns = records(data.campaigns)
    metrics.push(
      metric('Events', formatNumber(sum(paths.map(path => path.count))), 'Events grouped by path.'),
      metric('Unique paths', paths.length || null, 'Top 50 paths returned by the source.'),
      metric('Referrers', referrers.length || null, 'Normalized referrer groups.'),
      metric('Campaigns', campaigns.length || null, 'Configured UTM groups only.'),
    )
    const topPath = paths[0]
    if (typeof topPath?.path === 'string' && numberValue(topPath.count) !== null)
      highlights.push(`Most active path: ${topPath.path} (${topPath.count} events).`)
  }

  if (report === 'content') {
    const content = records(data.content)
    const views = sum(content.map(item => item.views))
    const completions = sum(content.map(item => item.completions))
    const progress = sum(content.map(item => item.average_progress))
    metrics.push(
      metric('Content pages', content.length || null, 'Blog and article paths returned by the source.'),
      metric('Views', formatNumber(views), 'Page views for content paths.'),
      metric('Completions', formatNumber(completions), 'Explicit article_complete events.'),
      metric('Average progress', formatPercent(progress === null || !content.length ? null : progress / content.length), 'Mean reported article progress.', 'estimated'),
    )
  }

  if (report === 'engagement') {
    const eventTypes = records(data.event_types)
    const media = records(data.media)
    metrics.push(
      metric('Events', formatNumber(sum(eventTypes.map(item => item.count))), 'Accepted non-bot events by type.'),
      metric('Active time', formatDuration(sum(eventTypes.map(item => item.active_ms))), 'Reported active milliseconds.'),
      metric('Media events', formatNumber(sum(media.map(item => item.events))), 'Media start, progress, and completion events.'),
      metric('Played time', formatDuration(sum(media.map(item => item.played_ms))), 'Reported media playback time.'),
    )
  }

  if (report === 'goals') {
    const goals = records(data.goals)
    const findGoal = (id: string) => goals.find(goal => goal.id === id)
    metrics.push(
      metric('Goals completed', formatNumber(sum(goals.map(goal => goal.conversions))), 'Named conversion events.'),
      metric('Engagement', formatNumber(numberValue(findGoal('engagement')?.conversions)), 'Article, media, and playground completion events.'),
      metric('Career contact', formatNumber(numberValue(findGoal('career_contact')?.conversions)), 'Contact open and interaction events.'),
      metric('Shortlink campaigns', formatNumber(numberValue(findGoal('shortlink_campaigns')?.conversions)), 'Sink events with a shortlink source.'),
    )
  }

  if (report === 'performance') {
    const workers = workerSummary(data.cloudflare)
    const rum = rumSummary(data.rum_vitals)
    const rumCoverage = record(coverage?.rum_vitals)
    const rumHasData = !!rum?.series.length && rumCoverage.has_data !== false
    const rumDetail = rumHasData
      ? [
          rum && rum.lcpP75 !== null ? `LCP p75 ${Math.round(rum.lcpP75)}ms` : null,
          rum && rum.inpP75 !== null ? `INP p75 ${Math.round(rum.inpP75)}ms` : null,
          rum && rum.clsP75 !== null ? `CLS p75 ${rum.clsP75.toFixed(3)}` : null,
        ].filter(Boolean).join(' · ') || 'Cloudflare Web Analytics samples.'
      : String(rumCoverage.reason || record(data.rum_vitals).reason || 'RUM vital ingestion is unavailable.')
    metrics.push(
      metric('Worker requests', formatNumber(workers.requests), 'Cloudflare GraphQL invocation totals.', workers.requests === null ? 'unavailable' : 'live'),
      metric('Worker errors', formatNumber(workers.errors), 'Cloudflare GraphQL invocation totals.', workers.errors === null ? 'unavailable' : 'live'),
      metric('CPU time', workers.cpuP99 === null ? null : `${Math.round(workers.cpuP99)}µs p99`, 'Cloudflare GraphQL worker CPU quantile.', workers.cpuP99 === null ? 'unavailable' : 'live'),
      metric('RUM vitals', rumHasData && rum?.samples !== null ? `${formatNumber(rum.samples)} samples` : null, rumDetail, rumHasData ? 'live' : 'unavailable'),
    )
  }

  if (report === 'overview' && numberValue(data.active_visitors_5m) !== null)
    highlights.push('Active visitors are measured over the last five minutes.')

  return {
    hasData: coverage?.has_data === true,
    sourceState,
    sourceNote: detail,
    updatedAt: typeof data.as_of === 'string' ? data.as_of : undefined,
    range,
    metrics: metrics.length ? metrics : defaultMetrics.value,
    series,
    highlights: [...new Set(highlights)],
  }
}

function formatUpdatedAt(value: string | undefined) {
  if (!value)
    return ''
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function loadReport() {
  loading.value = true
  error.value = ''
  try {
    const response = await useAPI<BackendReport>(endpoint.value)
    payload.value = normalizeReport(response, props.report)
    refreshedAt.value = new Date().toISOString()
  }
  catch (cause) {
    payload.value = null
    error.value = cause instanceof Error ? cause.message : 'The analytics service is unavailable.'
  }
  finally {
    loading.value = false
  }
}

onMounted(loadReport)
watch(endpoint, loadReport)
</script>

<template>
  <section class="portfolio-report">
    <div class="portfolio-report__heading">
      <div>
        <p class="portfolio-kicker">Private briefing / {{ report }}</p>
        <h1>{{ title }}</h1>
        <p class="portfolio-report__intro">{{ intro }}</p>
      </div>
      <div class="portfolio-report__actions">
        <PortfolioSourceBadge :state="sourceState" />
        <button class="portfolio-button portfolio-button--quiet" type="button" :disabled="loading" @click="loadReport">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="portfolio-range-line">
      <span>Detail window: 90 days</span>
      <span>Summary window: 13 months</span>
      <span v-if="payload?.range">Source range: {{ payload.range }}</span>
      <span v-if="payload?.updatedAt">Updated {{ formatUpdatedAt(payload.updatedAt) }}</span>
      <span v-else-if="refreshedAt">Checked {{ formatUpdatedAt(refreshedAt) }}</span>
    </div>

    <div class="portfolio-metric-grid">
      <PortfolioMetricCard
        v-for="metricItem in metrics"
        :key="metricItem.label"
        v-bind="metricItem"
        :state="metricItem.state ?? sourceState"
      />
    </div>

    <div v-if="error" class="portfolio-state portfolio-state--error" role="alert">
      <strong>Analytics unavailable</strong>
      <span>{{ error }}</span>
      <span>Values remain blank until a trusted source is configured.</span>
    </div>
    <div v-else-if="loading" class="portfolio-state" role="status" aria-live="polite">
      Loading trusted report data…
    </div>
    <div v-else-if="!hasData" class="portfolio-state" role="status">
      <strong>No report data returned</strong>
      <span>This state is distinct from zero activity. Add the required event source before reporting a value.</span>
    </div>

    <div
      v-if="payload?.series.length"
      class="
        portfolio-panel portfolio-panel--chart
      "
    >
      <div class="portfolio-panel__header">
        <div>
          <p class="portfolio-eyebrow">Trend</p>
          <h2>Activity across the selected windows</h2>
        </div>
        <span class="portfolio-panel__note">Source values are rendered without interpolation.</span>
      </div>
      <div class="portfolio-sparkline" role="img" aria-label="Report trend chart">
        <div
          v-for="point in payload.series"
          :key="point.label"
          class="portfolio-sparkline__bar"
          :style="{ height: `${point.value}%` }"
          :title="`${point.label}: ${point.raw}`"
        />
      </div>
      <div class="portfolio-sparkline__labels">
        <span v-for="point in payload.series" :key="point.label">{{ point.label }}</span>
      </div>
    </div>

    <div class="portfolio-panel portfolio-panel--notes">
      <div>
        <p class="portfolio-eyebrow">Source honesty</p>
        <h2>{{ payload?.sourceNote || 'Every metric must identify its source and freshness.' }}</h2>
      </div>
      <ul v-if="payload?.highlights.length">
        <li v-for="highlight in payload.highlights" :key="highlight">{{ highlight }}</li>
      </ul>
      <p v-else class="portfolio-panel__note">
        Sessions use a declared inactivity window. Completions require a named start and completion event. Missing instrumentation stays unavailable instead of becoming a false zero.
      </p>
    </div>
  </section>
</template>
