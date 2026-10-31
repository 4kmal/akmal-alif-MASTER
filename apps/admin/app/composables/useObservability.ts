import type { MaybeRefOrGetter, Ref } from 'vue'
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

export type CloudflareRange = '24h' | '7d' | '30d'
export type CloudflareScope = 'account' | 'akmalalif'
export type GamingRange = '7d' | '30d' | '90d'

const CLOUDFLARE_RANGES: readonly CloudflareRange[] = ['24h', '7d', '30d']
const CLOUDFLARE_SCOPES: readonly CloudflareScope[] = ['account', 'akmalalif']
const GAMING_RANGES: readonly GamingRange[] = ['7d', '30d', '90d']

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

function numberFormat(value: number, compact = false): string {
  return new Intl.NumberFormat(undefined, compact
    ? { notation: 'compact', maximumFractionDigits: 2 }
    : { maximumFractionDigits: 2 }).format(value)
}

function normalizedUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/[\s_-]+/g, '')
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

  if (DURATION_SECONDS.has(normalized)) {
    const magnitude = Math.abs(value)
    if (magnitude >= 3600)
      return `${numberFormat(value / 3600)} h`
    if (magnitude >= 60)
      return `${numberFormat(value / 60)} min`
    return `${numberFormat(value)} s`
  }

  const compact = !unit || /(?:count|counts|players|sessions|rooms|bots|users|events|requests|starts|completions|matches|participants|kills|deaths|assists|score|points|interactions)$/i.test(unit)
  const formatted = numberFormat(value, compact)
  return unit ? `${formatted} ${unit}` : formatted
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
  const value = numberFormat(metric.value)
  return metric.unit ? `Raw value: ${value} ${metric.unit}` : `Raw value: ${value}`
}

export function observabilityNumberTitle(value: number | null | undefined, unit = ''): string {
  if (value === null || value === undefined)
    return 'Unavailable from the provider.'
  const formatted = numberFormat(value)
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
  const range = ref<CloudflareRange>(oneOf(queryValue(route.query.range), CLOUDFLARE_RANGES, '24h'))
  const scope = ref<CloudflareScope>(oneOf(queryValue(route.query.scope), CLOUDFLARE_SCOPES, 'account'))
  const endpoint = computed(() => appendObservabilityQuery('/api/admin/observability/cloudflare', {
    range: range.value,
    scope: scope.value,
  }))
  const resource = useObservabilityResource<CloudflareReport>(endpoint, 5 * 60 * 1000)

  function syncQuery() {
    void router.replace({
      query: {
        ...route.query,
        range: range.value,
        scope: scope.value,
      },
    })
  }

  watch([range, scope], syncQuery)
  watch(() => [queryValue(route.query.range), queryValue(route.query.scope)], ([nextRange, nextScope]) => {
    const resolvedRange = oneOf(nextRange, CLOUDFLARE_RANGES, '24h')
    const resolvedScope = oneOf(nextScope, CLOUDFLARE_SCOPES, 'account')
    if (resolvedRange !== range.value)
      range.value = resolvedRange
    if (resolvedScope !== scope.value)
      scope.value = resolvedScope
  })
  return { ...resource, range, scope }
}

export function useGamingObservability() {
  const route = useRoute()
  const router = useRouter()
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
    void router.replace({
      query: {
        ...route.query,
        range: range.value,
        game: game.value || undefined,
        mode: mode.value || undefined,
        transport: transport.value || undefined,
      },
    })
  }

  watch([range, game, mode, transport], syncQuery)
  watch(() => [
    queryValue(route.query.range),
    queryValue(route.query.game) || '',
    queryValue(route.query.mode) || '',
    queryValue(route.query.transport) || '',
  ], ([nextRange, nextGame, nextMode, nextTransport]) => {
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
  return { ...resource, range, game, mode, transport }
}

export function useObservabilitySummary() {
  return useObservabilityResource<ObservabilitySummary>('/api/admin/observability/summary', 5 * 60 * 1000)
}
