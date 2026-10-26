<!-- eslint-disable better-tailwindcss/no-unknown-classes, vue/singleline-html-element-content-newline -->
<script setup lang="ts">
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
  value: number
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
  source?: string
  path?: string
  target?: string
  shortlink_slug?: string
  event_at?: string
  country?: string
  is_bot?: boolean
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
      rum_vitals?: {
        available?: boolean
        unavailable?: boolean
        has_data?: boolean
        reason?: string
      }
      workers?: Record<string, unknown>
    }
    returned?: number
    has_more?: boolean
    next_cursor?: string | null
    raw_detail_cutoff?: string
    alerts?: unknown[]
  }
}

const payload = shallowRef<ReportPayload | null>(null)
const loading = shallowRef(true)
const error = shallowRef('')
const refreshedAt = shallowRef('')
const historyRange = ref('24h')
const historySource = ref('')
const historyEventType = ref('')
const historyPath = ref('')
const historyCursor = ref('')

const endpoint = computed(() => props.report === 'overview'
  ? '/api/admin/overview'
  : `/api/admin/portfolio/${props.report === 'goals' ? 'conversions' : props.report}`)

const reportURL = computed(() => {
  if (props.report !== 'history')
    return endpoint.value

  const params = new URLSearchParams({ range: historyRange.value, limit: '50' })
  if (historySource.value)
    params.set('source', historySource.value)
  if (historyEventType.value)
    params.set('event_type', historyEventType.value)
  if (historyPath.value.trim())
    params.set('path', historyPath.value.trim())
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
    goals: ['Goals completed', 'Engagement', 'Career contact', 'Shortlink campaigns'],
    performance: ['Worker requests', 'Worker errors', 'CPU time', 'RUM vitals'],
    realtime: ['Active visitors', 'Shortlink active', 'Recent events', 'Visitor estimate'],
    history: ['Rows returned', 'Raw detail', 'Sources', 'Next page'],
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

function sourceStateFor(response: BackendReport, report: ReportName): SourceState {
  const coverage = response.meta?.coverage
  if (coverage?.unavailable)
    return 'unavailable'
  if (coverage?.stale)
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
    return raw !== null && day ? [{ label: day.slice(5), raw, value: raw }] : []
  })
  const maximum = Math.max(...points.map(point => point.raw), 0)
  return points.map(point => ({
    ...point,
    value: maximum > 0 ? Math.max(4, Math.round((point.raw / maximum) * 100)) : 4,
  }))
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

function historyEvent(value: Record<string, unknown>): HistoryEvent {
  return {
    event_id: typeof value.event_id === 'string' ? value.event_id : undefined,
    event_type: typeof value.event_type === 'string' ? value.event_type : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    path: typeof value.path === 'string' ? value.path : undefined,
    target: typeof value.target === 'string' ? value.target : undefined,
    shortlink_slug: typeof value.shortlink_slug === 'string' ? value.shortlink_slug : undefined,
    event_at: typeof value.event_at === 'string' ? value.event_at : undefined,
    country: typeof value.country === 'string' ? value.country : undefined,
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
      metric('Views', formatNumber(views), 'Page views for content paths.'),
      metric('Completions', formatNumber(completions), 'Explicit article_complete events.'),
      metric('Average progress', formatPercent(progress === null || !contentRows.length ? null : progress / contentRows.length), 'Mean reported article progress.', 'estimated'),
    )
    const contentItems = contentRows.map(item => ({
      label: valueLabel(item.title ?? item.path),
      value: countValue(item.views ?? item.events),
      detail: `${valueLabel(item.path)} · ${countValue(item.completions) ?? 0} completions · ${formatDuration(numberValue(item.active_ms)) ?? '—'} active · ${comparisonDetail(item, 'views').replace(/^\d+ /, '')}`,
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
      metric('Events', formatNumber(sum(eventTypes.map(item => item.count))), 'Accepted non-bot events by type.'),
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
      metric('Goals completed', formatNumber(sum(goals.map(goal => goal.conversions))), 'Named conversion events.'),
      metric('Engagement', formatNumber(numberValue(findGoal('engagement')?.conversions)), 'Article, media, and playground completion events.'),
      metric('Career contact', formatNumber(numberValue(findGoal('career_contact')?.conversions)), 'Contact open and interaction events.'),
      metric('Shortlink campaigns', formatNumber(numberValue(findGoal('shortlink_campaigns')?.conversions)), 'Sink events with a shortlink source.'),
    )
    const goalItems = goals.map(goal => ({
      label: valueLabel(goal.label ?? goal.id),
      value: countValue(goal.conversions),
      detail: goal.denominator_sessions != null
        ? `${countValue(goal.sessions) ?? 0} sessions · ${Math.round(Number(goal.conversion_rate ?? 0) * 100)}% of ${countValue(goal.denominator_sessions)} ${valueLabel(goal.denominator_label, 'website_sessions')}`
        : goal.denominator_clicks != null
          ? `${countValue(goal.sessions) ?? 0} sessions · ${countValue(goal.denominator_clicks)} ${valueLabel(goal.denominator_label, 'shortlink_clicks')}`
          : goal.conversion_rate == null
            ? `${countValue(goal.sessions) ?? 0} sessions`
            : `${Math.round(Number(goal.conversion_rate) * 100)}% of ${valueLabel(goal.denominator_label, 'website_sessions')}`,
    }))
    const section = drilldownSection('Goal definitions', goalItems, 'A conversion is only counted when its named event or source exists.')
    if (section)
      drilldowns.push(section)
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

  if (report === 'overview') {
    const goals = records(data.goals)
    const goalItems = goals.map(goal => ({
      label: valueLabel(goal.label ?? goal.id),
      value: countValue(goal.conversions),
      detail: 'conversions',
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
      metric('Visitor estimate', valueLabel(record(data.visitor_estimates).website?.method, 'Unavailable'), 'Method declared by the source.', activeVisitors === null ? 'unavailable' : 'estimated'),
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
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

async function loadReport() {
  loading.value = true
  error.value = ''
  try {
    const response = await useAPI<BackendReport>(reportURL.value)
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

function resetHistoryAndLoad() {
  historyCursor.value = ''
  void loadReport()
}

function loadNextHistoryPage() {
  const nextCursor = payload.value?.history?.nextCursor
  if (!nextCursor)
    return
  historyCursor.value = nextCursor
  void loadReport()
}

let realtimeTimer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  void loadReport()
  if (props.report === 'realtime')
    realtimeTimer = setInterval(() => void loadReport(), 10_000)
})
watch(reportURL, () => void loadReport())
onBeforeUnmount(() => {
  if (realtimeTimer)
    clearInterval(realtimeTimer)
})
</script>

<template>
  <section class="portfolio-report">
    <div class="portfolio-report__heading">
      <div>
        <p class="portfolio-kicker">{{ report === 'overview' ? 'Briefing' : title }}</p>
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
      <span>90-day detail · 13-month context</span>
      <span v-if="payload?.range">Source range: {{ payload.range }}</span>
      <span v-if="payload?.updatedAt">Updated {{ formatUpdatedAt(payload.updatedAt) }}</span>
      <span v-else-if="refreshedAt">Checked {{ formatUpdatedAt(refreshedAt) }}</span>
    </div>

    <form v-if="report === 'history'" class="portfolio-report__filters" @submit.prevent="resetHistoryAndLoad">
      <label>
        <span>Raw range</span>
        <select v-model="historyRange" @change="resetHistoryAndLoad">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </label>
      <label>
        <span>Source</span>
        <select v-model="historySource" @change="resetHistoryAndLoad">
          <option value="">All sources</option>
          <option value="portfolio">Portfolio</option>
          <option value="sink">Shortlinks</option>
          <option value="legacy_page_event">Legacy page events</option>
        </select>
      </label>
      <label>
        <span>Event type</span>
        <select v-model="historyEventType" @change="resetHistoryAndLoad">
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
        <input v-model="historyPath" type="search" placeholder="/blog/example" @keydown.enter.prevent="resetHistoryAndLoad">
      </label>
      <a class="portfolio-button portfolio-button--quiet" :href="historyCSVURL" download>Export CSV</a>
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
      <p class="portfolio-eyebrow">Attention</p>
      <ul>
        <li v-for="alert in payload.alerts" :key="alert">{{ alert }}</li>
      </ul>
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
        <span class="portfolio-panel__note">Daily activity from the selected window.</span>
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

    <div v-if="payload?.drilldowns.length" class="portfolio-drilldown-grid">
      <article v-for="section in payload.drilldowns" :key="section.title" class="portfolio-panel portfolio-panel--drilldown">
        <div class="portfolio-panel__header">
          <div>
            <p class="portfolio-eyebrow">Drilldown</p>
            <h2>{{ section.title }}</h2>
          </div>
          <span v-if="section.note" class="portfolio-panel__note">{{ section.note }}</span>
        </div>
        <div class="portfolio-table-wrap">
          <table class="portfolio-table">
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Value</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in section.items" :key="`${section.title}-${item.label}`">
                <th scope="row">{{ item.label }}</th>
                <td>{{ item.value ?? '—' }}</td>
                <td>{{ item.detail || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>

    <section v-if="payload?.history" class="portfolio-panel portfolio-panel--history">
      <div class="portfolio-panel__header">
        <div>
          <p class="portfolio-eyebrow">Retained detail</p>
          <h2>Event history</h2>
        </div>
        <span class="portfolio-panel__note">Raw D1 detail is retained for 90 days.</span>
      </div>
      <div class="portfolio-table-wrap">
        <table class="portfolio-table portfolio-table--history">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Event</th>
              <th scope="col">Path / slug</th>
              <th scope="col">Source</th>
              <th scope="col">Country</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in payload.history.events" :key="event.event_id">
              <td>{{ event.event_at ? formatUpdatedAt(event.event_at) : '—' }}</td>
              <th scope="row">{{ event.event_type || 'Unknown event' }}</th>
              <td>{{ event.shortlink_slug ? `/${event.shortlink_slug}` : event.path || event.target || '—' }}</td>
              <td>{{ event.source || '—' }}</td>
              <td>{{ event.country || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="portfolio-history-actions">
        <span class="portfolio-panel__note">{{ payload.history.events.length }} rows in this page.</span>
        <button v-if="payload.history.hasMore" class="portfolio-button portfolio-button--quiet" type="button" @click="loadNextHistoryPage">
          Load next page
        </button>
      </div>
    </section>

    <div class="portfolio-panel portfolio-panel--notes">
      <div>
        <p class="portfolio-eyebrow">Status</p>
        <h2>{{ payload?.sourceNote || 'Every metric must identify its source and freshness.' }}</h2>
      </div>
      <ul v-if="payload?.highlights.length">
        <li v-for="highlight in payload.highlights" :key="highlight">{{ highlight }}</li>
      </ul>
      <p v-else class="portfolio-panel__note">
        Visitor and session estimates follow each source's declared method. Blank fields mean the source did not return a value.
      </p>
    </div>
  </section>
</template>
