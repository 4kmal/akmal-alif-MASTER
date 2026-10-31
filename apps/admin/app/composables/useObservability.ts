import type { MaybeRefOrGetter, Ref } from 'vue'
import type { LocationQuery, LocationQueryRaw, Router } from 'vue-router'
import type {
  CloudflareReport,
  GamingReport,
  ObservabilityMetric,
  ObservabilitySummary,
  SourceCoverage,
  SourceStatus,
} from '../../shared/types/observability'
import { computed, onBeforeUnmount, onMounted, ref, toValue, watch } from 'vue'
import { useAPI } from '@/utils/api'

export type CloudflareRange = '24h' | '7d' | '30d' | '90d' | '13m'
export type CloudflareScope = 'account' | 'akmalalif'
export type GamingRange = '7d' | '30d' | '90d' | '13m'

const CLOUDFLARE_RANGES: readonly CloudflareRange[] = ['24h', '7d', '30d', '90d', '13m']
const CLOUDFLARE_SCOPES: readonly CloudflareScope[] = ['account', 'akmalalif']
const GAMING_RANGES: readonly GamingRange[] = ['7d', '30d', '90d', '13m']

function oneOf<T extends string>(value: string | undefined, choices: readonly T[], fallback: T): T {
  return value && choices.includes(value as T) ? value as T : fallback
}

export interface ObservabilityResource<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  stale: Ref<boolean>
  lastUpdated: Ref<string | null>
  refresh: () => Promise<void>
}

function queryValue(value: unknown): string | undefined {
  if (Array.isArray(value))
    return typeof value[0] === 'string' ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

function stringError(error: unknown): string {
  if (error instanceof Error && error.message)
    return error.message
  if (typeof error === 'string' && error)
    return error
  return 'The report could not be loaded.'
}

export function isObservabilityAbort(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

export function observabilityCoverageStatus(coverage: SourceCoverage[], retainedStale = false): SourceStatus {
  if (retainedStale || coverage.some(item => item.status === 'stale'))
    return 'stale'
  if (coverage.length === 0 || coverage.every(item => item.status === 'unavailable'))
    return 'unavailable'
  if (coverage.every(item => item.status === 'live'))
    return 'live'
  return 'partial'
}

export function appendObservabilityQuery(path: string, query: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value)
      params.set(key, value)
  }
  const encoded = params.toString()
  return encoded ? `${path}?${encoded}` : path
}

type ObservabilityQueryRouter = Pick<Router, 'replace'>
type ObservabilityQueryPatch = Record<string, string | undefined>

function querySignature(query: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(query).sort().map(key => [key, query[key]]))
}

function applyQueryPatch(query: LocationQuery | LocationQueryRaw, patch: ObservabilityQueryPatch): LocationQueryRaw {
  const next: LocationQueryRaw = { ...query }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined)
      delete next[key]
    else
      next[key] = value
  }
  return next
}

export interface ObservabilityQuerySync {
  patchQuery: (patch: ObservabilityQueryPatch) => void
  shouldIgnoreRoute: (query: LocationQuery) => boolean
}

/**
 * Serializes optimistic query patches so independent filter and tab writers
 * cannot overwrite each other while a router navigation is still pending.
 */
export function createObservabilityQuerySync(
  router: ObservabilityQueryRouter,
  getRouteQuery: () => LocationQuery,
): ObservabilityQuerySync {
  let desiredQuery: LocationQueryRaw | null = null
  let externalQuery: LocationQuery | null = null
  let flushing = false
  const localTargetKeys = new Set<string>()

  function sameQuery(left: Record<string, unknown>, right: Record<string, unknown>) {
    return querySignature(left) === querySignature(right)
  }

  function patchQuery(patch: ObservabilityQueryPatch) {
    const routeQuery = getRouteQuery()
    const next = applyQueryPatch(desiredQuery || routeQuery, patch)
    if (sameQuery(next, routeQuery))
      return

    externalQuery = null
    desiredQuery = next
    if (!flushing)
      void flush()
  }

  async function flush() {
    if (flushing)
      return
    flushing = true
    try {
      while (desiredQuery || externalQuery) {
        if (!desiredQuery) {
          const nextExternal = externalQuery
          externalQuery = null
          if (nextExternal && !sameQuery(nextExternal, getRouteQuery()))
            desiredQuery = { ...nextExternal }
          else
            continue
        }

        const next = desiredQuery
        localTargetKeys.add(querySignature(next))
        try {
          await router.replace({ query: next })
        }
        catch {
          // A later patch or external navigation supersedes this write.
        }
        if (desiredQuery === next)
          desiredQuery = null
      }
    }
    finally {
      flushing = false
      localTargetKeys.clear()
    }
  }

  function shouldIgnoreRoute(query: LocationQuery) {
    if (localTargetKeys.has(querySignature(query)))
      return true

    if (flushing || desiredQuery) {
      externalQuery = { ...query }
      desiredQuery = null
    }
    return false
  }

  return { patchQuery, shouldIgnoreRoute }
}

const BYTE_FACTORS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1_000,
  kib: 1024,
  kbyte: 1_000,
  kbytes: 1_000,
  mb: 1_000_000,
  mib: 1024 ** 2,
  mbyte: 1_000_000,
  mbytes: 1_000_000,
  gb: 1_000_000_000,
  gib: 1024 ** 3,
  gbyte: 1_000_000_000,
  gbytes: 1_000_000_000,
  tb: 1_000_000_000_000,
  tib: 1024 ** 4,
  tbyte: 1_000_000_000_000,
  tbytes: 1_000_000_000_000,
}

const DURATION_SECONDS = new Set(['s', 'sec', 'secs', 'second', 'seconds'])
const DURATION_MILLISECONDS = new Set(['ms', 'millisecond', 'milliseconds'])
const DURATION_MICROSECONDS = new Set(['us', 'µs', 'microsecond', 'microseconds'])
const COUNT_UNITS = new Set(['count', 'counts'])

function numberFormat(value: number, compact = false): string {
  return new Intl.NumberFormat(undefined, compact
    ? { notation: 'compact', maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 }).format(value)
}

function normalizedUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function humanizeDuration(milliseconds: number): string {
  const magnitude = Math.abs(milliseconds)
  if (magnitude >= 3_600_000)
    return `${numberFormat(milliseconds / 3_600_000)} h`
  if (magnitude >= 60_000)
    return `${numberFormat(milliseconds / 60_000)} min`
  if (magnitude >= 1_000)
    return `${numberFormat(milliseconds / 1_000)} s`
  return `${numberFormat(milliseconds)} ms`
}

function humanizeObservabilityNumber(value: number, unit = ''): string {
  const normalized = normalizedUnit(unit)
  const byteFactor = BYTE_FACTORS[normalized]
  if (byteFactor !== undefined) {
    const bytes = value * byteFactor
    const magnitude = Math.abs(bytes)
    const scales = [
      { divisor: 1024 ** 4, label: 'TiB' },
      { divisor: 1024 ** 3, label: 'GiB' },
      { divisor: 1024 ** 2, label: 'MiB' },
      { divisor: 1024, label: 'KiB' },
      { divisor: 1, label: 'B' },
    ]
    const scale = scales.find(item => magnitude >= item.divisor) || scales.at(-1)!
    return `${numberFormat(bytes / scale.divisor)} ${scale.label}`
  }

  if (DURATION_SECONDS.has(normalized))
    return humanizeDuration(value * 1_000)

  if (DURATION_MILLISECONDS.has(normalized))
    return humanizeDuration(value)

  if (DURATION_MICROSECONDS.has(normalized))
    return humanizeDuration(value / 1_000)

  if (normalized === 'ratio' || normalized === 'fraction')
    return `${numberFormat(value * 100)}%`

  if (normalized === '%' || normalized === 'percent' || normalized === 'percentage')
    return `${numberFormat(value)}%`

  if (COUNT_UNITS.has(normalized))
    return numberFormat(value, true)

  const compact = !unit || /(?:players|sessions|rooms|bots|users|events|requests|starts|completions|matches|participants|kills|deaths|assists|score|points|interactions)$/.test(normalized)
  const formatted = numberFormat(value, compact)
  return unit ? `${formatted} ${unit}` : formatted
}

const ADDITIVE_SERIES_PATTERN = /request|invocation|error|exception|event|count|cpu|duration|traffic|bandwidth|egress|ingress|byte|second|minute|hour/i
const NON_ADDITIVE_SERIES_PATTERN = /memory|headroom|percentile|p\d{2}|latency|storage|capacity|utilization|percent(?:age)?|ratio|fraction|rate|gauge/i

function isAdditiveSeriesMetric(metric: Pick<ObservabilityMetric, 'key' | 'label' | 'unit'>): boolean {
  const text = `${metric.key} ${metric.label} ${metric.unit}`
  return ADDITIVE_SERIES_PATTERN.test(text) && !NON_ADDITIVE_SERIES_PATTERN.test(text)
}

export interface CloudflareChartPoint {
  timestamp: string
  value: number
}

export function aggregateCloudflareSeries(
  series: CloudflareReport['series'],
  metric: Pick<ObservabilityMetric, 'key' | 'label' | 'unit'> & { resourceId?: string },
  range: CloudflareRange,
): CloudflareChartPoint[] {
  const matching = series.filter(point => point.metric === metric.key
    && (!metric.resourceId || point.resourceId === metric.resourceId))
  if (matching.length === 0)
    return []

  const accountPoints = metric.resourceId ? [] : matching.filter(point => !point.resourceId)
  const source = accountPoints.length > 0 ? accountPoints : matching
  const bucketMs = range === '24h' ? 60 * 60 * 1000 : range === '7d' ? 12 * 60 * 60 * 1000 : 2 * 24 * 60 * 60 * 1000
  const additive = isAdditiveSeriesMetric(metric)
  const buckets = new Map<number, { total: number, latestAt: number, latestValue: number }>()

  for (const point of source) {
    const time = Date.parse(point.timestamp)
    if (!Number.isFinite(time) || !Number.isFinite(point.value))
      continue
    const bucket = Math.floor(time / bucketMs) * bucketMs
    const current = buckets.get(bucket)
    if (!current) {
      buckets.set(bucket, { total: point.value, latestAt: time, latestValue: point.value })
      continue
    }
    if (additive)
      current.total += point.value
    if (time >= current.latestAt) {
      current.latestAt = time
      current.latestValue = point.value
    }
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([time, bucket]) => ({
      timestamp: new Date(time).toISOString(),
      value: additive ? bucket.total : bucket.latestValue,
    }))
}

export function formatObservabilityMetric(metric: Pick<ObservabilityMetric, 'value' | 'unit'> | null | undefined): string {
  if (!metric || metric.value === null || metric.value === undefined)
    return '—'

  return humanizeObservabilityNumber(metric.value, metric.unit)
}

export function formatObservabilityNumber(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined)
    return '—'
  return humanizeObservabilityNumber(value, unit)
}

export function observabilityMetricTitle(metric: Pick<ObservabilityMetric, 'value' | 'unit'> | null | undefined): string {
  if (!metric || metric.value === null || metric.value === undefined)
    return 'Unavailable from the provider.'
  const value = String(metric.value)
  return metric.unit ? `Raw value: ${value} ${metric.unit}` : `Raw value: ${value}`
}

export function observabilityNumberTitle(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined)
    return 'Unavailable from the provider.'
  const formatted = String(value)
  return unit ? `Raw value: ${formatted} ${unit}` : `Raw value: ${formatted}`
}

export function useObservabilityResource<T>(
  endpoint: MaybeRefOrGetter<string>,
  intervalMs: number,
): ObservabilityResource<T> {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const stale = ref(false)
  const lastUpdated = ref<string | null>(null)
  let controller: AbortController | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let requestId = 0

  function stopTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function syncTimer() {
    stopTimer()
    if (import.meta.client && document.visibilityState === 'visible')
      timer = setInterval(() => void refresh(), intervalMs)
  }

  async function refresh() {
    const currentRequest = ++requestId
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    error.value = null
    if (data.value !== null)
      stale.value = true

    try {
      const result = await useAPI<T>(toValue(endpoint), { signal: controller.signal })
      if (currentRequest !== requestId)
        return
      data.value = result
      stale.value = false
      lastUpdated.value = new Date().toISOString()
    }
    catch (cause: unknown) {
      if (currentRequest !== requestId || isObservabilityAbort(cause))
        return
      error.value = stringError(cause)
      stale.value = data.value !== null
    }
    finally {
      if (currentRequest === requestId)
        loading.value = false
    }
  }

  function handleVisibilityChange() {
    syncTimer()
    if (document.visibilityState === 'visible')
      void refresh()
  }

  watch(() => toValue(endpoint), () => void refresh())

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    syncTimer()
    void refresh()
  })

  onBeforeUnmount(() => {
    stopTimer()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    controller?.abort()
    controller = null
  })

  return { data, loading, error, stale, lastUpdated, refresh }
}

export function useCloudflareObservability() {
  const route = useRoute()
  const router = useRouter()
  const querySync = createObservabilityQuerySync(router, () => route.query)
  const range = ref<CloudflareRange>(oneOf(queryValue(route.query.range), CLOUDFLARE_RANGES, '24h'))
  const scope = ref<CloudflareScope>(oneOf(queryValue(route.query.scope), CLOUDFLARE_SCOPES, 'account'))
  const endpoint = computed(() => appendObservabilityQuery('/api/admin/observability/cloudflare', {
    range: range.value,
    scope: scope.value,
  }))
  const resource = useObservabilityResource<CloudflareReport>(endpoint, 5 * 60 * 1000)

  function syncQuery() {
    querySync.patchQuery({
      range: range.value,
      scope: scope.value,
    })
  }

  watch([range, scope], syncQuery)
  watch(() => [queryValue(route.query.range), queryValue(route.query.scope)], ([nextRange, nextScope]) => {
    if (querySync.shouldIgnoreRoute(route.query))
      return
    const resolvedRange = oneOf(nextRange, CLOUDFLARE_RANGES, '24h')
    const resolvedScope = oneOf(nextScope, CLOUDFLARE_SCOPES, 'account')
    if (resolvedRange !== range.value)
      range.value = resolvedRange
    if (resolvedScope !== scope.value)
      scope.value = resolvedScope
  })
  return { ...resource, range, scope, patchQuery: querySync.patchQuery, shouldIgnoreRoute: querySync.shouldIgnoreRoute }
}

export function useGamingObservability() {
  const route = useRoute()
  const router = useRouter()
  const querySync = createObservabilityQuerySync(router, () => route.query)
  const range = ref<GamingRange>(oneOf(queryValue(route.query.range), GAMING_RANGES, '7d'))
  const game = ref(queryValue(route.query.game) || '')
  const mode = ref(queryValue(route.query.mode) || '')
  const transport = ref(queryValue(route.query.transport) || '')
  const endpoint = computed(() => appendObservabilityQuery('/api/admin/observability/gaming', {
    range: range.value,
    game: game.value || undefined,
    mode: mode.value || undefined,
    transport: transport.value || undefined,
  }))
  const resource = useObservabilityResource<GamingReport>(endpoint, 30 * 1000)

  function syncQuery() {
    querySync.patchQuery({
      range: range.value,
      game: game.value || undefined,
      mode: mode.value || undefined,
      transport: transport.value || undefined,
    })
  }

  watch([range, game, mode, transport], syncQuery)
  watch(() => [
    queryValue(route.query.range),
    queryValue(route.query.game) || '',
    queryValue(route.query.mode) || '',
    queryValue(route.query.transport) || '',
  ], ([nextRange, nextGame, nextMode, nextTransport]) => {
    if (querySync.shouldIgnoreRoute(route.query))
      return
    const resolvedRange = oneOf(nextRange, GAMING_RANGES, '7d')
    if (resolvedRange !== range.value)
      range.value = resolvedRange
    if (nextGame !== game.value)
      game.value = nextGame || ''
    if (nextMode !== mode.value)
      mode.value = nextMode || ''
    if (nextTransport !== transport.value)
      transport.value = nextTransport || ''
  })
  return { ...resource, range, game, mode, transport, patchQuery: querySync.patchQuery, shouldIgnoreRoute: querySync.shouldIgnoreRoute }
}

export function useObservabilitySummary() {
  return useObservabilityResource<ObservabilitySummary>('/api/admin/observability/summary', 5 * 60 * 1000)
}
