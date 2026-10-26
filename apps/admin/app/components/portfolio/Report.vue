<!-- eslint-disable better-tailwindcss/no-unknown-classes, vue/singleline-html-element-content-newline -->
<script setup lang="ts">
import type { ReportRange } from '@/utils/portfolio-report'
import {
  buildReportRangeParams,
  CANONICAL_GOAL_IDS,
  isCurrentRequest,
  normalizeReportRange,
  queryValue,
} from '@/utils/portfolio-report'
import { getTimeZone } from '@/utils/time'

type ReportName = 'overview' | 'traffic' | 'content' | 'engagement' | 'goals' | 'performance' | 'realtime' | 'history'
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
  raw: number
}

interface DrilldownItem {
  label: string
  value: string | number | null
  detail?: string
}

interface DrilldownSection {
  title: string
  note?: string
  items: DrilldownItem[]
}

interface HistoryEvent {
  event_id?: string
  event_type?: string
  source_event_type?: string
  source?: string
  source_event_id?: string
  path?: string
  target?: string
  progress?: number | null
  active_ms?: number | null
  media_id?: string | null
  media_kind?: string | null
  played_ms?: number | null
  duration_ms?: number | null
  referrer?: string | null
  campaign?: Record<string, unknown> | null
  shortlink_slug?: string
  event_at?: string
  received_at?: string
  ip?: string | null
  user_agent?: string | null
  country?: string
  region?: string | null
  city?: string | null
  timezone?: string | null
  latitude?: number | null
  longitude?: number | null
  colo?: string | null
  is_bot?: boolean
}

interface ReportPayload {
  hasData: boolean
  sourceState: SourceState
  sourceNote: string
  updatedAt?: string
  range?: string
  queryRange?: string
  metrics: Metric[]
  series: ChartPoint[]
  highlights: string[]
  drilldowns: DrilldownSection[]
  alerts: string[]
  history?: {
    events: HistoryEvent[]
    hasMore: boolean
    nextCursor: string | null
  }
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
      truncated?: boolean
      series_truncated?: boolean
      rum_vitals?: {
        available?: boolean
        unavailable?: boolean
        has_data?: boolean
        reason?: string
      }
      workers?: Record<string, unknown>
    }
    cache?: {
      status?: string
      stale?: boolean
      generated_at?: string | null
      cache_age_ms?: number | null
      ttl_ms?: number | null
    }
    query_range?: {
      preset?: string
      from?: string
      to?: string
    }
    returned?: number
    has_more?: boolean
    next_cursor?: string | null
    raw_detail_cutoff?: string
    alerts?: unknown[]
    prior_period?: Record<string, unknown> | null
  }
}

const payload = shallowRef<ReportPayload | null>(null)
const loading = shallowRef(true)
const error = shallowRef('')
const refreshedAt = shallowRef('')
const route = useRoute()
const router = useRouter()
const rangePreset = ref<ReportRange>(normalizeReportRange(queryValue(route.query.range), props.report === 'history' ? '24h' : '30d'))
const customFrom = ref(queryValue(route.query.from))
const customTo = ref(queryValue(route.query.to))
const historySource = ref(queryValue(route.query.source))
const historyEventType = ref(queryValue(route.query.event_type))
const historyPath = ref(queryValue(route.query.path))
const historyCursor = ref(queryValue(route.query.cursor))

const endpoint = computed(() => props.report === 'overview'
  ? '/api/admin/overview'
  : `/api/admin/portfolio/${props.report === 'goals' ? 'conversions' : props.report}`)

const reportURL = computed(() => {
  const params = buildReportRangeParams({
    range: rangePreset.value,
    from: customFrom.value,
    to: customTo.value,
  })
  if (props.report === 'history') {
    params.set('limit', '50')
    if (historySource.value)
      params.set('source', historySource.value)
    if (historyEventType.value)
      params.set('event_type', historyEventType.value)
    if (historyPath.value.trim())
      params.set('path', historyPath.value.trim())
  }
  if (historyCursor.value)
    params.set('cursor', historyCursor.value)
  return `${endpoint.value}?${params.toString()}`
})

const historyCSVURL = computed(() => {
  const url = new URL(reportURL.value, 'https://admin.invalid')
  url.searchParams.set('format', 'csv')
  url.searchParams.delete('cursor')
  return `${url.pathname}${url.search}`
})

const defaultMetrics = computed<Metric[]>(() => {
  const labels: Record<ReportName, string[]> = {
    overview: ['Views', 'Visitors', 'Sessions', 'Goal completions'],
    traffic: ['Events', 'Unique paths', 'Referrers', 'Campaigns'],
    content: ['Content pages', 'Views', 'Completions', 'Average progress'],
    engagement: ['Events', 'Active time', 'Media events', 'Played time'],
    goals: ['Goals completed', 'LinkedIn', 'GitHub', 'Contact', 'Shortlink campaigns'],
    performance: ['Worker requests', 'Worker errors', 'CPU time', 'RUM vitals'],
    realtime: ['Active visitors', 'Shortlink active', 'Recent events', 'Visitor estimate'],
    history: ['Rows returned', 'Raw detail', 'Sources', 'Next page'],
  }

  return labels[props.report].map(label => ({ label }))
})

const metrics = computed(() => payload.value?.metrics.length ? payload.value.metrics : defaultMetrics.value)
const sourceState = computed<SourceState>(() => payload.value?.sourceState ?? (error.value ? 'unavailable' : 'not-instrumented'))
const hasData = computed(() => payload.value?.hasData === true)
const chartPoints = computed(() => {
  const points = payload.value?.series ?? []
  const maximum = Math.max(...points.map(point => point.raw), 0)
  const width = 952
  const height = 176
  return points.map((point, index) => ({
    ...point,
    x: points.length < 2 ? 500 : 24 + (index / (points.length - 1)) * width,
    y: maximum > 0 ? 220 - (point.raw / maximum) * height : 220,
  }))
})
const chartPolyline = computed(() => chartPoints.value.map(point => `${point.x},${point.y}`).join(' '))

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
  portfolioCpuP99: number | null
  scripts: Array<{
    name: string
    requests: number | null
    errors: number | null
    cpuP99: number | null
  }>
}

function workerSummary(value: unknown): WorkerSummary {
  const source = record(value)
  const scripts = Object.entries(record(source.scripts)).map(([name, script]) => ({
    name,
    value: record(script),
  }))
  if (!scripts.length && (Array.isArray(value) || Object.keys(record(source.totals)).length || Array.isArray(source.rows))) {
    scripts.push({ name: 'portfolio', value: Array.isArray(value) ? { rows: value } : source })
  }
  const summaries = scripts.map(({ name, value: script }) => {
    const totals = record(script.totals)
    const rows = records(script.rows)
    return {
      name,
      requests: numberValue(totals.requests) ?? sum(rows.map(row => record(row.sum).requests ?? row.requests)),
      errors: numberValue(totals.errors) ?? sum(rows.map(row => record(row.sum).errors ?? row.errors)),
      cpuP99: numberValue(record(totals.cpu_time_us).p99)
        ?? latestNumber(rows.map(row => record(record(row.cpu_time_us)).p99)),
    }
  })
  const portfolio = summaries.find(script => /portfolio/i.test(script.name))

  return {
    requests: sum(summaries.map(script => script.requests)),
    errors: sum(summaries.map(script => script.errors)),
    portfolioCpuP99: portfolio?.cpuP99 ?? (summaries.length === 1 ? summaries[0]?.cpuP99 ?? null : null),
    scripts: summaries,
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
  const periodMetrics = record(source.period_metrics)
  const metrics = series.map(row => record(row.metrics))
  return {
    samples: numberValue(source.samples),
    series,
    lcpP75: numberValue(periodMetrics.lcp_ms_p75) ?? latestNumber(metrics.map(metricItem => metricItem.lcp_ms_p75)),
    inpP75: numberValue(periodMetrics.inp_ms_p75) ?? latestNumber(metrics.map(metricItem => metricItem.inp_ms_p75)),
    clsP75: numberValue(periodMetrics.cls_p75) ?? latestNumber(metrics.map(metricItem => metricItem.cls_p75)),
  }
}

function formatNumber(value: number | null): number | null {
  return value === null ? null : Math.round(value)
}

function formatPercent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`
}

function formatDuration(value: number | null | undefined): string | null {
  if (value === null || value === undefined)
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

function sourceStateFor(response: BackendReport, report: ReportName): SourceState {
  const coverage = response.meta?.coverage
  if (coverage?.unavailable)
    return 'unavailable'
  if (coverage?.stale || response.meta?.cache?.stale)
    return 'stale'
  if (response.meta?.detail === 'daily_rollup')
    return 'partial'
  if (report === 'history' && records(response.data?.events).length)
    return 'live'
  if (coverage?.has_data)
    return 'live'
  return 'not-instrumented'
}

function chartSeries(data: Record<string, unknown>, report: ReportName): ChartPoint[] {
  const daily = records(data.daily)
  const rawValues = daily.map(row => numberValue(
    report === 'overview' ? row.page_views ?? row.events : row.events,
  ))
  const points = daily.flatMap((row, index) => {
    const raw = rawValues[index] ?? null
    const day = typeof row.day === 'string' ? row.day : ''
    return raw !== null && day ? [{ label: day.slice(5), raw }] : []
  })
  return points
}

function drilldownSection(title: string, items: DrilldownItem[], note?: string): DrilldownSection | null {
  return items.length ? { title, items: items.slice(0, 12), note } : null
}

function valueLabel(value: unknown, fallback = 'Unknown') {
  if (typeof value === 'string' && value.trim())
    return value
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  return fallback
}

function countValue(value: unknown) {
  const number = numberValue(value)
  return number === null ? null : Math.round(number)
}

function comparisonDetail(item: Record<string, unknown>, noun = 'events') {
  const change = numberValue(item.change_percent)
  const trend = typeof item.trend === 'string' && item.trend !== 'flat' ? item.trend : ''
  const comparison = change === null
    ? trend
    : `${change > 0 ? '+' : ''}${Math.round(change)}%${trend ? ` ${trend}` : ''}`
  return comparison ? `${noun} · ${comparison}` : noun
}

function priorValue(response: BackendReport, data: Record<string, unknown>, key: string): number | null {
  const summary = record(data.comparison ?? response.meta?.prior_period)
  return numberValue(summary[key])
}

function priorDetail(response: BackendReport, data: Record<string, unknown>, key: string, noun: string): string {
  const previous = priorValue(response, data, key)
  return previous === null ? '' : `Previous period: ${formatNumber(previous)} ${noun}.`
}

function withPriorDetail(detail: string, response: BackendReport, data: Record<string, unknown>, key: string, noun: string): string {
  const previous = priorDetail(response, data, key, noun)
  return previous ? `${detail} ${previous}` : detail
}

function goalConversions(goals: Record<string, unknown>[]): number | null {
  const values = goals
    .filter(goal => typeof goal.id === 'string' && CANONICAL_GOAL_IDS.has(goal.id))
    .map(goal => goal.conversions)
  return sum(values)
}

function goalPriorConversions(response: BackendReport, goalId: string): number | null {
  const priorGoals = records(record(response.meta?.prior_period).goals)
  const goal = priorGoals.find(item => item.id === goalId)
  return numberValue(goal?.conversions)
}

function goalDetail(goal: Record<string, unknown>, response: BackendReport): string {
  const sessions = countValue(goal.sessions)
  const denominatorSessions = countValue(goal.denominator_sessions)
  const denominatorClicks = countValue(goal.denominator_clicks)
  const rate = numberValue(goal.conversion_rate)
  const denominatorLabel = typeof goal.denominator_label === 'string' && goal.denominator_label.trim()
    ? goal.denominator_label.replaceAll('_', ' ')
    : denominatorClicks !== null ? 'shortlink clicks' : 'website sessions'
  const pieces: string[] = []
  if (sessions !== null)
    pieces.push(`${sessions} sessions`)
  if (rate !== null && (denominatorSessions !== null || denominatorClicks !== null))
    pieces.push(`${Math.round(rate * 100)}% of ${denominatorClicks ?? denominatorSessions} ${denominatorLabel}`)
  else if (rate !== null)
    pieces.push(`${Math.round(rate * 100)}% of website sessions`)
  if (!pieces.length)
    pieces.push('Unavailable')
  const previous = goalPriorConversions(response, String(goal.id ?? ''))
  if (previous !== null)
    pieces.push(`previous period: ${previous} conversions`)
  return pieces.join(' · ')
}

function historyEvent(value: Record<string, unknown>): HistoryEvent {
  return {
    event_id: typeof value.event_id === 'string' ? value.event_id : undefined,
    event_type: typeof value.event_type === 'string' ? value.event_type : undefined,
    source_event_type: typeof value.source_event_type === 'string' ? value.source_event_type : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    source_event_id: typeof value.source_event_id === 'string' ? value.source_event_id : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    target: typeof value.target === 'string' ? value.target : undefined,
    progress: numberValue(value.progress),
    active_ms: numberValue(value.active_ms),
    media_id: typeof value.media_id === 'string' ? value.media_id : null,
    media_kind: typeof value.media_kind === 'string' ? value.media_kind : null,
    played_ms: numberValue(value.played_ms),
    duration_ms: numberValue(value.duration_ms),
    referrer: typeof value.referrer === 'string' ? value.referrer : null,
    campaign: value.campaign && typeof value.campaign === 'object' ? value.campaign as Record<string, unknown> : null,
    shortlink_slug: typeof value.shortlink_slug === 'string' ? value.shortlink_slug : undefined,
    event_at: typeof value.event_at === 'string' ? value.event_at : undefined,
    received_at: typeof value.received_at === 'string' ? value.received_at : undefined,
    ip: typeof value.ip === 'string' ? value.ip : null,
    user_agent: typeof value.user_agent === 'string' ? value.user_agent : null,
    country: typeof value.country === 'string' ? value.country : undefined,
    region: typeof value.region === 'string' ? value.region : null,
    city: typeof value.city === 'string' ? value.city : null,
    timezone: typeof value.timezone === 'string' ? value.timezone : null,
    latitude: numberValue(value.latitude),
    longitude: numberValue(value.longitude),
    colo: typeof value.colo === 'string' ? value.colo : null,
    is_bot: value.is_bot === true,
  }
}

function normalizeReport(response: BackendReport, report: ReportName): ReportPayload {
  const data = record(response.data)
  const coverage = response.meta?.coverage
  const sourceState = sourceStateFor(response, report)
  const source = response.meta?.source || 'portfolio analytics'
  const detail = response.meta?.detail === 'daily_rollup'
    ? 'This period uses retained daily summaries; raw event detail has expired.'
    : response.meta?.reason || (coverage?.has_data ? `Source: ${source}.` : 'No trusted events were returned for this window.')
  const range = response.meta?.range?.preset || [response.meta?.range?.from, response.meta?.range?.to].filter(Boolean).join(' → ')
  const queryRange = response.meta?.query_range
  const queryRangeLabel = queryRange
    ? queryRange.preset || [queryRange.from, queryRange.to].filter(Boolean).join(' → ')
    : undefined
  const series = chartSeries(data, report)
  const metrics: Metric[] = []
  const drilldowns: DrilldownSection[] = []
  const alerts: string[] = []
  const highlights = Array.isArray(data.insights)
    ? data.insights.filter((item): item is string => typeof item === 'string')
    : []

  for (const item of [
    ...(Array.isArray(data.alerts) ? data.alerts : []),
    ...(Array.isArray(response.meta?.alerts) ? response.meta.alerts : []),
  ]) {
    if (typeof item === 'string' && item.trim())
      alerts.push(item)
  }
  if (coverage?.unavailable)
    alerts.push('One or more analytics sources are unavailable for this window.')
  if (coverage?.stale)
    alerts.push('The latest trusted event is older than the freshness threshold.')
  if (coverage?.truncated)
    alerts.push('Raw detail has expired for part of this window; retained daily summaries are shown.')
  if (coverage?.series_truncated)
    alerts.push('The provider time series is limited to its query window; period totals remain complete.')

  if (report === 'overview') {
    const goals = records(data.goals)
    const goalCompletions = goalConversions(goals)
    metrics.push(
      metric('Views', formatNumber(numberValue(data.page_views)), withPriorDetail('Accepted page_view events.', response, data, 'page_views', 'page views')),
      metric('Visitors', formatNumber(numberValue(data.unique_visitors)), 'HLL estimate from pseudonymous visitor keys.', 'estimated'),
      metric('Sessions', formatNumber(numberValue(data.sessions)), withPriorDetail('Thirty-minute inactivity window.', response, data, 'sessions', 'sessions')),
      metric('Goal completions', formatNumber(goalCompletions), 'Sum of distinct goal IDs only; legacy aggregate aliases are excluded.'),
      metric('Active visitors', formatNumber(numberValue(data.active_visitors_5m)), 'Estimated visitors active in the last five minutes.', 'estimated'),
      metric('Article completions', formatNumber(numberValue(data.article_completions)), withPriorDetail('Explicit article_complete events.', response, data, 'article_completions', 'completions')),
    )
  }

  if (report === 'traffic') {
    const paths = records(data.paths)
    const referrers = records(data.referrers)
    const campaigns = records(data.campaigns)
    metrics.push(
      metric('Events', formatNumber(sum(paths.map(path => path.count))), withPriorDetail('Events grouped by path.', response, data, 'events', 'events')),
      metric('Unique paths', paths.length || null, 'Top 50 paths returned by the source.'),
      metric('Referrers', referrers.length || null, 'Normalized referrer groups.'),
      metric('Campaigns', campaigns.length || null, 'Configured UTM groups only.'),
    )
    const topPath = paths[0]
    if (typeof topPath?.path === 'string' && numberValue(topPath.count) !== null)
      highlights.push(`Most active path: ${topPath.path} (${topPath.count} events).`)
    const pathItems = paths.map(item => ({
      label: valueLabel(item.path),
      value: countValue(item.count),
      detail: comparisonDetail(item),
    }))
    const referrerItems = referrers.map(item => ({
      label: valueLabel(item.referrer),
      value: countValue(item.count),
      detail: 'events',
    }))
    const campaignItems = campaigns.map(item => ({
      label: valueLabel(item.campaign),
      value: countValue(item.count),
      detail: 'events',
    }))
    const locationItems = records(data.locations).map(item => ({
      label: [valueLabel(item.country), valueLabel(item.region, '')].filter(Boolean).join(' / '),
      value: countValue(item.count),
      detail: 'events',
    }))
    for (const section of [
      drilldownSection('Top paths', pathItems),
      drilldownSection('Referrers', referrerItems),
      drilldownSection('Campaigns', campaignItems),
      drilldownSection('Locations', locationItems, 'Country and region are coarse location fields.'),
      drilldownSection('Landing pages', records(data.landing_pages).map(item => ({
        label: valueLabel(item.path ?? item.page),
        value: countValue(item.count ?? item.views),
        detail: comparisonDetail(item, 'entry events'),
      }))),
      drilldownSection('Exit pages', records(data.exit_pages).map(item => ({
        label: valueLabel(item.path ?? item.page),
        value: countValue(item.count ?? item.views),
        detail: comparisonDetail(item, 'exit events'),
      }))),
      drilldownSection('Devices', records(data.devices).map(item => ({
        label: valueLabel(item.device ?? item.name),
        value: countValue(item.count ?? item.events),
        detail: 'events',
      }))),
      drilldownSection('Browsers', records(data.browsers).map(item => ({
        label: valueLabel(item.browser ?? item.name),
        value: countValue(item.count ?? item.events),
        detail: 'events',
      }))),
      drilldownSection('Operating systems', records(data.operating_systems).map(item => ({
        label: valueLabel(item.operating_system ?? item.os ?? item.name),
        value: countValue(item.count ?? item.events),
        detail: 'events',
      }))),
    ]) {
      if (section)
        drilldowns.push(section)
    }
  }

  if (report === 'content') {
    const content = records(data.content)
    const pages = records(data.pages)
    const contentRows = pages.length ? pages : content
    const views = sum(contentRows.map(item => item.views ?? item.events))
    const completions = sum(contentRows.map(item => item.completions))
    const progress = sum(contentRows.map(item => item.average_progress))
    metrics.push(
      metric('Content pages', contentRows.length || null, 'Blog and article paths returned by the source.'),
      metric('Views', formatNumber(views), withPriorDetail('Page views for content paths.', response, data, 'page_views', 'page views')),
      metric('Completions', formatNumber(completions), withPriorDetail('Explicit article_complete events.', response, data, 'article_completions', 'completions')),
      metric('Average progress', formatPercent(progress === null || !contentRows.length ? null : progress / contentRows.length), 'Mean reported article progress.', 'estimated'),
    )
    const contentItems = contentRows.map(item => ({
      label: valueLabel(item.title ?? item.path),
      value: countValue(item.views ?? item.events),
      detail: `${valueLabel(item.path)} · ${countValue(item.completions) ?? 'Unavailable'} completions · ${formatDuration(numberValue(item.active_ms)) ?? '—'} active · ${comparisonDetail(item, 'views').replace(/^\d+ /, '')}`,
    }))
    const section = drilldownSection('Content paths', contentItems)
    if (section)
      drilldowns.push(section)
    const categories = records(data.category_comparisons ?? data.categories).map(item => ({
      label: valueLabel(item.category_name ?? item.category ?? item.name ?? item.category_slug),
      value: countValue(item.views ?? item.events ?? item.count),
      detail: comparisonDetail(item, 'content views'),
    }))
    const categorySection = drilldownSection('Content categories', categories)
    if (categorySection)
      drilldowns.push(categorySection)
    const catalog = record(data.content_catalog)
    if (Object.keys(catalog).length) {
      const catalogSection = drilldownSection('Content metadata', [{
        label: 'Portfolio catalog',
        value: catalog.available === true ? 'Available' : 'Unavailable',
        detail: valueLabel(catalog.reason, catalog.source ? `Source: ${catalog.source}` : 'Metadata source did not return a status.'),
      }])
      if (catalogSection)
        drilldowns.push(catalogSection)
    }
  }

  if (report === 'engagement') {
    const eventTypes = records(data.event_types)
    const media = records(data.media)
    metrics.push(
      metric('Events', formatNumber(sum(eventTypes.map(item => item.count))), withPriorDetail('Accepted non-bot events by type.', response, data, 'events', 'events')),
      metric('Active time', formatDuration(sum(eventTypes.map(item => item.active_ms))), 'Reported active milliseconds.'),
      metric('Media events', formatNumber(sum(media.map(item => item.events))), 'Media start, progress, and completion events.'),
      metric('Played time', formatDuration(sum(media.map(item => item.played_ms))), 'Reported media playback time.'),
    )
    const eventItems = eventTypes.map(item => ({
      label: valueLabel(item.event_type),
      value: countValue(item.count),
      detail: `${formatDuration(numberValue(item.active_ms)) ?? '—'} active`,
    }))
    const mediaItems = media.map(item => ({
      label: valueLabel(item.media_id),
      value: countValue(item.events),
      detail: `${formatDuration(numberValue(item.played_ms)) ?? '—'} played`,
    }))
    for (const section of [drilldownSection('Event types', eventItems), drilldownSection('Media', mediaItems)]) {
      if (section)
        drilldowns.push(section)
    }
  }

  if (report === 'goals') {
    const goals = records(data.goals)
    const findGoal = (id: string) => goals.find(goal => goal.id === id)
    metrics.push(
      metric('Goals completed', formatNumber(goalConversions(goals)), 'Sum of distinct goal IDs only; legacy aggregate aliases are excluded.'),
      metric('LinkedIn', formatNumber(numberValue(findGoal('linkedin')?.conversions)), goalDetail(findGoal('linkedin') ?? { id: 'linkedin' }, response)),
      metric('GitHub', formatNumber(numberValue(findGoal('github')?.conversions)), goalDetail(findGoal('github') ?? { id: 'github' }, response)),
      metric('Contact', formatNumber(numberValue(findGoal('contact')?.conversions)), goalDetail(findGoal('contact') ?? { id: 'contact' }, response)),
      metric('Shortlink campaigns', formatNumber(numberValue(findGoal('shortlink_campaigns')?.conversions)), 'Sink events with a shortlink source.'),
    )
    const goalItems = goals.map(goal => ({
      label: valueLabel(goal.label ?? goal.id),
      value: countValue(goal.conversions),
      detail: goalDetail(goal, response),
    }))
    const section = drilldownSection('Goal definitions', goalItems, 'A conversion is only counted when its named event or source exists.')
    if (section)
      drilldowns.push(section)
  }

  if (report === 'performance') {
    const workers = workerSummary(data.cloudflare)
    const rum = rumSummary(data.rum_vitals)
    const rumCoverage = record(coverage?.rum_vitals)
    const rumHasData = rum !== null && rum.samples !== null && rum.samples > 0 && rumCoverage.has_data !== false
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
      metric('Portfolio CPU p99', workers.portfolioCpuP99 === null ? null : `${Math.round(workers.portfolioCpuP99)}µs`, 'Cloudflare GraphQL CPU quantile for the portfolio Worker.', workers.portfolioCpuP99 === null ? 'unavailable' : 'live'),
      metric('RUM vitals', rumHasData && rum?.samples !== null ? `${formatNumber(rum.samples)} samples` : null, rumDetail, rumHasData ? 'live' : 'unavailable'),
    )
    const workerItems = workers.scripts.map(script => ({
      label: script.name,
      value: script.cpuP99 === null ? 'Unavailable' : `${Math.round(script.cpuP99)}µs p99`,
      detail: `${formatNumber(script.requests) ?? 'Unavailable'} requests · ${formatNumber(script.errors) ?? 'Unavailable'} errors`,
    }))
    const workerSection = drilldownSection('Worker performance', workerItems, 'CPU percentiles remain separate per Worker; totals cover the selected provider range.')
    if (workerSection)
      drilldowns.push(workerSection)
  }

  if (report === 'overview') {
    const goals = records(data.goals)
    const goalItems = goals.filter(goal => CANONICAL_GOAL_IDS.has(String(goal.id))).map(goal => ({
      label: valueLabel(goal.label ?? goal.id),
      value: countValue(goal.conversions),
      detail: goalDetail(goal, response),
    }))
    const section = drilldownSection('Goals in this brief', goalItems)
    if (section)
      drilldowns.push(section)
  }

  const sourceRows = records(data.source_health ?? data.sources)
  if (sourceRows.length) {
    const sourceSection = drilldownSection('Source health', sourceRows.map(item => ({
      label: valueLabel(item.name ?? item.source ?? item.id),
      value: valueLabel(item.state ?? (item.available === false ? 'Unavailable' : 'Live')),
      detail: valueLabel(item.reason ?? item.detail, 'Freshness and availability reported by the source.'),
    })))
    if (sourceSection)
      drilldowns.push(sourceSection)
  }
  const workerHealth = record(coverage?.workers)
  const sourceHealthItems = Object.entries(workerHealth).map(([name, status]) => {
    const item = record(status)
    return {
      label: name,
      value: valueLabel(item.available === false ? 'Unavailable' : item.has_data === false ? 'No data' : 'Live'),
      detail: valueLabel(item.reason, valueLabel(item.source, 'Worker source')),
    }
  })
  const rumHealth = record(coverage?.rum_vitals)
  if (Object.keys(rumHealth).length) {
    sourceHealthItems.push({
      label: 'RUM vitals',
      value: valueLabel(rumHealth.available === false ? 'Unavailable' : rumHealth.has_data === false ? 'No data' : 'Live'),
      detail: valueLabel(rumHealth.reason, 'Cloudflare Web Analytics'),
    })
  }
  const healthSection = drilldownSection('Source health', sourceHealthItems)
  if (healthSection && !sourceRows.length)
    drilldowns.push(healthSection)

  if (report === 'realtime') {
    const events = records(data.events)
    const activeVisitors = numberValue(data.active_5m)
    const shortlinkActive = numberValue(data.shortlink_active_5m)
    metrics.push(
      metric('Active visitors', formatNumber(activeVisitors), 'Estimated website visitors in the last five minutes.', 'estimated'),
      metric('Shortlink active', formatNumber(shortlinkActive), 'Shortlink activity in the last five minutes.', 'estimated'),
      metric('Recent events', events.length, 'Raw events returned for the five-minute window.'),
      metric('Visitor estimate', valueLabel(record(record(data.visitor_estimates).website).method, 'Unavailable'), 'Method declared by the source.', activeVisitors === null ? 'unavailable' : 'estimated'),
    )
    const eventItems = events.map(item => ({
      label: `${valueLabel(item.event_type)} · ${valueLabel(item.path)}`,
      value: valueLabel(item.source),
      detail: typeof item.timestamp === 'string' ? formatUpdatedAt(item.timestamp) : 'recent',
    }))
    const section = drilldownSection('Recent activity', eventItems, 'This view refreshes every ten seconds while visible.')
    if (section)
      drilldowns.push(section)
  }

  let history: ReportPayload['history']
  if (report === 'history') {
    const events = records(data.events).map(historyEvent)
    const cutoff = response.meta?.raw_detail_cutoff
    metrics.push(
      metric('Rows returned', events.length, 'Raw D1 events in the selected page.'),
      metric('Raw detail', cutoff ? `Since ${formatUpdatedAt(cutoff)}` : 'Last 90 days', 'Raw detail is pruned after 90 days.', 'partial'),
      metric('Sources', new Set(events.map(event => event.source).filter(Boolean)).size || null, 'Portfolio, Sink, and legacy source labels.'),
      metric('Next page', response.meta?.has_more ? 'Available' : 'End', 'Cursor pagination keeps history bounded.'),
    )
    history = {
      events,
      hasMore: response.meta?.has_more === true || data.has_more === true,
      nextCursor: typeof response.meta?.next_cursor === 'string'
        ? response.meta.next_cursor
        : typeof data.next_cursor === 'string' ? data.next_cursor : null,
    }
  }

  if (report === 'overview' && numberValue(data.active_visitors_5m) !== null)
    highlights.push('Active visitors are measured over the last five minutes.')

  return {
    hasData: coverage?.has_data === true,
    sourceState,
    sourceNote: detail,
    updatedAt: typeof data.as_of === 'string' ? data.as_of : undefined,
    range,
    queryRange: queryRangeLabel || undefined,
    metrics: metrics.length ? metrics : defaultMetrics.value,
    series,
    highlights: [...new Set(highlights)],
    drilldowns,
    alerts: [...new Set(alerts)],
    history,
  }
}

function formatUpdatedAt(value: string | undefined) {
  if (!value)
    return ''
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: getTimeZone() }).format(date)
}

function persistFilterQuery() {
  const query = { ...route.query } as Record<string, string | string[] | undefined>
  query.range = rangePreset.value
  if (rangePreset.value === 'custom') {
    if (customFrom.value)
      query.from = customFrom.value
    else
      delete query.from
    if (customTo.value)
      query.to = customTo.value
    else
      delete query.to
  }
  else {
    delete query.from
    delete query.to
  }
  if (props.report === 'history') {
    for (const [key, value] of [
      ['source', historySource.value],
      ['event_type', historyEventType.value],
      ['path', historyPath.value.trim()],
      ['cursor', historyCursor.value],
    ] as const) {
      if (value)
        query[key] = value
      else
        delete query[key]
    }
  }
  void router.replace({ query }).catch(() => {})
}

function applyFilters() {
  historyCursor.value = ''
  persistFilterQuery()
}

function syncFiltersFromRoute() {
  const nextRange = normalizeReportRange(queryValue(route.query.range), props.report === 'history' ? '24h' : '30d')
  const nextFrom = queryValue(route.query.from)
  const nextTo = queryValue(route.query.to)
  const nextSource = queryValue(route.query.source)
  const nextEventType = queryValue(route.query.event_type)
  const nextPath = queryValue(route.query.path)
  const nextCursor = queryValue(route.query.cursor)
  if (nextRange !== rangePreset.value)
    rangePreset.value = nextRange
  if (nextFrom !== customFrom.value)
    customFrom.value = nextFrom
  if (nextTo !== customTo.value)
    customTo.value = nextTo
  if (nextSource !== historySource.value)
    historySource.value = nextSource
  if (nextEventType !== historyEventType.value)
    historyEventType.value = nextEventType
  if (nextPath !== historyPath.value)
    historyPath.value = nextPath
  if (nextCursor !== historyCursor.value)
    historyCursor.value = nextCursor
}

let requestSequence = 0
let activeController: AbortController | null = null
let mounted = false

async function loadReport() {
  if (import.meta.client && (document.visibilityState !== 'visible' || navigator.onLine === false))
    return
  const sequence = ++requestSequence
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  loading.value = true
  error.value = ''
  try {
    const response = await useAPI<BackendReport>(reportURL.value, { signal: controller.signal })
    if (controller.signal.aborted || !isCurrentRequest(sequence, requestSequence))
      return
    payload.value = normalizeReport(response, props.report)
    refreshedAt.value = new Date().toISOString()
  }
  catch (cause) {
    if (controller.signal.aborted || !isCurrentRequest(sequence, requestSequence))
      return
    payload.value = null
    error.value = cause instanceof Error ? cause.message : 'The analytics service is unavailable.'
  }
  finally {
    if (isCurrentRequest(sequence, requestSequence)) {
      loading.value = false
      if (activeController === controller)
        activeController = null
    }
  }
}

function loadNextHistoryPage() {
  const nextCursor = payload.value?.history?.nextCursor
  if (!nextCursor)
    return
  historyCursor.value = nextCursor
  persistFilterQuery()
}

let realtimeTimer: ReturnType<typeof setInterval> | undefined
let visibilityHandler: (() => void) | undefined
let onlineHandler: (() => void) | undefined

onMounted(() => {
  mounted = true
  syncFiltersFromRoute()
  void loadReport()
  visibilityHandler = () => {
    if (document.visibilityState === 'visible')
      void loadReport()
  }
  onlineHandler = () => void loadReport()
  document.addEventListener('visibilitychange', visibilityHandler)
  window.addEventListener('online', onlineHandler)
  if (props.report === 'realtime') {
    realtimeTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine !== false)
        void loadReport()
    }, 10_000)
  }
})
watch(reportURL, () => {
  if (mounted)
    void loadReport()
})
watch(() => [route.query.range, route.query.from, route.query.to, route.query.source, route.query.event_type, route.query.path, route.query.cursor], syncFiltersFromRoute)
onBeforeUnmount(() => {
  mounted = false
  requestSequence++
  activeController?.abort()
  if (realtimeTimer)
    clearInterval(realtimeTimer)
  if (visibilityHandler)
    document.removeEventListener('visibilitychange', visibilityHandler)
  if (onlineHandler)
    window.removeEventListener('online', onlineHandler)
})
</script>

<template>
  <section class="portfolio-report">
    <div class="portfolio-report__heading">
      <div>
        <p class="portfolio-kicker">
          {{ report === 'overview' ? 'Briefing' : title }}
        </p>
        <h1>{{ title }}</h1>
        <p class="portfolio-report__intro">
          {{ intro }}
        </p>
      </div>
      <div class="portfolio-report__actions">
        <PortfolioSourceBadge :state="sourceState" />
        <button class="portfolio-button portfolio-button--quiet" type="button" :disabled="loading" @click="loadReport">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="portfolio-range-line">
      <span>90-day detail · 13-month context</span>
      <span v-if="payload?.range">Source range: {{ payload.range }}</span>
      <span v-if="payload?.queryRange">Provider range: {{ payload.queryRange }}</span>
      <span v-if="payload?.updatedAt">Updated {{ formatUpdatedAt(payload.updatedAt) }}</span>
      <span v-else-if="refreshedAt">Checked {{ formatUpdatedAt(refreshedAt) }}</span>
    </div>

    <form class="portfolio-report__filters" @submit.prevent="applyFilters">
      <label>
        <span>Report range</span>
        <select v-model="rangePreset" @change="applyFilters">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="custom">Custom dates</option>
        </select>
      </label>
      <template v-if="rangePreset === 'custom'">
        <label>
          <span>From</span>
          <input v-model="customFrom" type="date" required>
        </label>
        <label>
          <span>To</span>
          <input v-model="customTo" type="date" required>
        </label>
      </template>
      <template v-if="report === 'history'">
        <label>
          <span>Source</span>
          <select v-model="historySource" @change="applyFilters">
            <option value="">All sources</option>
            <option value="portfolio">Portfolio</option>
            <option value="sink">Shortlinks</option>
            <option value="legacy_page_event">Legacy page events</option>
          </select>
        </label>
        <label>
          <span>Event type</span>
          <select v-model="historyEventType" @change="applyFilters">
            <option value="">All event types</option>
            <option value="page_view">Page view</option>
            <option value="article_complete">Article complete</option>
            <option value="outbound_click">Outbound click</option>
            <option value="contact_open">Contact open</option>
            <option value="media_complete">Media complete</option>
          </select>
        </label>
        <label class="portfolio-report__filter-wide">
          <span>Path</span>
          <input v-model.lazy="historyPath" type="search" placeholder="/blog/example" @keydown.enter.prevent="applyFilters">
        </label>
        <a class="portfolio-button portfolio-button--quiet" :href="historyCSVURL" download>Export CSV</a>
      </template>
      <button class="portfolio-button portfolio-button--quiet" type="submit">
        Apply range
      </button>
    </form>

    <div class="portfolio-metric-grid">
      <PortfolioMetricCard
        v-for="metricItem in metrics"
        :key="metricItem.label"
        v-bind="metricItem"
        :state="metricItem.state"
      />
    </div>

    <div v-if="error" class="portfolio-state portfolio-state--error" role="alert">
      <strong>Analytics unavailable</strong>
      <span>{{ error }}</span>
      <span>Check the source connection to resume this report.</span>
    </div>
    <div v-else-if="loading" class="portfolio-state" role="status" aria-live="polite">
      Loading trusted report data…
    </div>
    <div v-else-if="!hasData" class="portfolio-state" role="status">
      <strong>No trusted events returned</strong>
      <span>There is no reportable activity in this window yet.</span>
    </div>

    <div v-if="payload?.alerts.length" class="portfolio-alerts" role="status">
      <p class="portfolio-eyebrow">
        Attention
      </p>
      <ul>
        <li v-for="alert in payload.alerts" :key="alert">
          {{ alert }}
        </li>
      </ul>
    </div>

    <div
      v-if="payload?.series.length"
      class="portfolio-panel portfolio-panel--chart"
    >
      <div class="portfolio-panel__header">
        <div>
          <p class="portfolio-eyebrow">
            Trend
          </p>
          <h2>Activity across the selected windows</h2>
        </div>
        <span class="portfolio-panel__note">Daily activity from the selected window.</span>
      </div>
      <svg class="portfolio-report__chart" viewBox="0 0 1000 260" width="100%" height="260" style="display:block;width:100%;height:auto;min-height:12rem" role="img" aria-labelledby="portfolio-chart-title portfolio-chart-description">
        <title id="portfolio-chart-title">Daily report activity</title>
        <desc id="portfolio-chart-description">A line chart of activity for each day in the selected report range.</desc>
        <line
          x1="24" y1="220" x2="976" y2="220" class="
            portfolio-report__chart-axis
          " stroke="currentColor" stroke-opacity=".2" stroke-width="2"
        />
        <polyline :points="chartPolyline" class="portfolio-report__chart-line" fill="none" stroke="var(--chart-1, currentColor)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        <circle
          v-for="point in chartPoints"
          :key="`${point.label}-${point.raw}`"
          :cx="point.x"
          :cy="point.y"
          r="5"
          class="portfolio-report__chart-point"
          fill="var(--chart-1, currentColor)"
          stroke="var(--background, Canvas)"
          stroke-width="2"
        >
          <title>{{ point.label }}: {{ point.raw }}</title>
        </circle>
      </svg>
      <details class="portfolio-chart-values">
        <summary>View daily values</summary>
        <div class="portfolio-table-wrap portfolio-report__chart-table-wrap">
          <table class="portfolio-table portfolio-report__chart-table">
            <caption>Daily activity points</caption>
            <thead>
              <tr>
                <th scope="col">
                  Day
                </th><th scope="col">
                  Activity
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="point in chartPoints" :key="`table-${point.label}-${point.raw}`">
                <th scope="row">
                  {{ point.label }}
                </th>
                <td>{{ point.raw }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>

    <div v-if="payload?.drilldowns.length" class="portfolio-drilldown-grid">
      <article
        v-for="section in payload.drilldowns" :key="section.title" class="
          portfolio-panel portfolio-panel--drilldown
        "
      >
        <div class="portfolio-panel__header">
          <div>
            <p class="portfolio-eyebrow">
              Drilldown
            </p>
            <h2>{{ section.title }}</h2>
          </div>
          <span v-if="section.note" class="portfolio-panel__note">{{ section.note }}</span>
        </div>
        <div class="portfolio-table-wrap">
          <table class="portfolio-table">
            <thead>
              <tr>
                <th scope="col">
                  Dimension
                </th>
                <th scope="col">
                  Value
                </th>
                <th scope="col">
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in section.items" :key="`${section.title}-${item.label}`">
                <th scope="row">
                  {{ item.label }}
                </th>
                <td>{{ item.value ?? '—' }}</td>
                <td>{{ item.detail || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

    <section
      v-if="payload?.history" class="portfolio-panel portfolio-panel--history"
    >
      <div class="portfolio-panel__header">
        <div>
          <p class="portfolio-eyebrow">
            Retained detail
          </p>
          <h2>Event history</h2>
        </div>
        <span class="portfolio-panel__note">Raw D1 detail is retained for 90 days.</span>
      </div>
      <div class="portfolio-table-wrap">
        <table class="portfolio-table portfolio-table--history">
          <thead>
            <tr>
              <th scope="col">
                When
              </th>
              <th scope="col">
                Event
              </th>
              <th scope="col">
                Path / slug
              </th>
              <th scope="col">
                Source
              </th>
              <th scope="col">
                Country
              </th>
              <th scope="col">
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in payload.history.events" :key="event.event_id">
              <td>{{ event.event_at ? formatUpdatedAt(event.event_at) : '—' }}</td>
              <th scope="row">
                {{ event.event_type || 'Unknown event' }}
              </th>
              <td>{{ event.shortlink_slug ? `/${event.shortlink_slug}` : event.path || event.target || '—' }}</td>
              <td>{{ event.source || '—' }}</td>
              <td>{{ event.country || '—' }}</td>
              <td>
                <details class="portfolio-history__detail">
                  <summary>Inspect</summary>
                  <dl>
                    <div><dt>Received</dt><dd>{{ event.received_at ? formatUpdatedAt(event.received_at) : '—' }}</dd></div>
                    <div><dt>Source event</dt><dd>{{ [event.source_event_type, event.source_event_id].filter(Boolean).join(' · ') || '—' }}</dd></div>
                    <div><dt>Target</dt><dd>{{ event.target || '—' }}</dd></div>
                    <div><dt>Referrer</dt><dd>{{ event.referrer || '—' }}</dd></div>
                    <div><dt>Progress</dt><dd>{{ event.progress === null || event.progress === undefined ? '—' : `${event.progress}%` }}</dd></div>
                    <div><dt>Active time</dt><dd>{{ formatDuration(event.active_ms) || '—' }}</dd></div>
                    <div><dt>Media</dt><dd>{{ event.media_id || '—' }}{{ event.media_kind ? ` (${event.media_kind})` : '' }}</dd></div>
                    <div><dt>Played</dt><dd>{{ formatDuration(event.played_ms) || '—' }} / {{ formatDuration(event.duration_ms) || '—' }}</dd></div>
                    <div><dt>Location</dt><dd>{{ [event.region, event.city, event.timezone].filter(Boolean).join(' · ') || '—' }}</dd></div>
                    <div><dt>IP</dt><dd>{{ event.ip || '—' }}</dd></div>
                    <div><dt>User agent</dt><dd>{{ event.user_agent || '—' }}</dd></div>
                    <div><dt>Campaign</dt><dd>{{ event.campaign ? JSON.stringify(event.campaign) : '—' }}</dd></div>
                  </dl>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="portfolio-history-actions">
        <span class="portfolio-panel__note">{{ payload.history.events.length }} rows in this page.</span>
        <button
          v-if="payload.history.hasMore" class="
            portfolio-button portfolio-button--quiet
          " type="button" @click="loadNextHistoryPage"
        >
          Load next page
        </button>
      </div>
    </section>

    <div class="portfolio-panel portfolio-panel--notes">
      <div>
        <p class="portfolio-eyebrow">
          Status
        </p>
        <h2>{{ payload?.sourceNote || 'Every metric must identify its source and freshness.' }}</h2>
      </div>
      <ul v-if="payload?.highlights.length">
        <li v-for="highlight in payload.highlights" :key="highlight">
          {{ highlight }}
        </li>
      </ul>
      <p v-else class="portfolio-panel__note">
        Visitor and session estimates follow each source's declared method. Blank fields mean the source did not return a value.
      </p>
    </div>
  </section>
</template>
