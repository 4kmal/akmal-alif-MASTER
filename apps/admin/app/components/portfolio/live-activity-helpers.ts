export const ACTIVITY_EVENT_TYPES = [
  'page_view',
  'heartbeat',
  'article_progress',
  'article_complete',
  'outbound_click',
  'download_start',
  'media_start',
  'media_progress',
  'media_complete',
  'playground_open',
  'contact_open',
  'contact_interaction',
] as const

export type ActivityEventType = typeof ACTIVITY_EVENT_TYPES[number]
export type ActivitySource = '' | 'portfolio' | 'sink'

export interface ActivityFilters {
  source: ActivitySource
  eventType: ActivityEventType | ''
  path: string
}

export interface ActivityEvent {
  id: string
  timestamp: string
  eventType: string
  path: string
  target: string | null
  source: string
  shortlinkSlug: string | null
  campaign: Record<string, string> | null
  countryCode: string | null
  region: string | null
}

export interface VisitorEstimate {
  uniqueVisitors: number | null
  method: string | null
}

export interface ActivitySnapshot {
  activeWebsite: number | null
  activeShortlinks: number | null
  visitorEstimates: {
    website: VisitorEstimate
    shortlinks: VisitorEstimate
  }
  events: ActivityEvent[]
  asOf: string | null
}

export interface PollerOptions<T> {
  load: (signal: AbortSignal) => Promise<T>
  ready?: () => boolean
  intervalMs?: number
  onSuccess: (value: T) => void
  onError?: (error: unknown) => void
  onStart?: () => void
  onSettled?: () => void
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeCountryCode(value: unknown): string | null {
  const candidate = text(value)?.toUpperCase()
  return candidate && /^[A-Z]{2}$/.test(candidate) ? candidate : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function campaignValue(value: unknown): Record<string, string> | null {
  const source = record(value)
  const entries = Object.entries(source)
    .map(([key, item]) => [key, text(item)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  return entries.length ? Object.fromEntries(entries) : null
}

function visitorEstimate(value: unknown): VisitorEstimate {
  const source = record(value)
  return {
    uniqueVisitors: finiteNumber(source.unique_visitors),
    method: text(source.method),
  }
}

function eventFromRecord(value: unknown): ActivityEvent | null {
  const source = record(value)
  const id = text(source.event_id) ?? text(source.id)
  const timestamp = text(source.timestamp) ?? text(source.event_at)
  if (!id || !timestamp || Number.isNaN(Date.parse(timestamp)))
    return null

  return {
    id,
    timestamp: new Date(timestamp).toISOString(),
    eventType: text(source.event_type) ?? 'unknown',
    path: text(source.path) ?? '/',
    target: text(source.target),
    source: text(source.source) ?? 'unknown',
    shortlinkSlug: text(source.shortlink_slug),
    campaign: campaignValue(source.campaign),
    countryCode: normalizeCountryCode(source.country_code) ?? normalizeCountryCode(source.country),
    region: text(source.region),
  }
}

export function normalizeActivitySnapshot(value: unknown): ActivitySnapshot {
  const root = record(value)
  const data = record(root.data ?? value)
  const events = Array.isArray(data.events)
    ? data.events.map(eventFromRecord).filter((event): event is ActivityEvent => event !== null)
    : []
  const estimates = record(data.visitor_estimates)

  return {
    activeWebsite: finiteNumber(data.active_5m),
    activeShortlinks: finiteNumber(data.shortlink_active_5m),
    visitorEstimates: {
      website: visitorEstimate(estimates.website),
      shortlinks: visitorEstimate(estimates.shortlinks),
    },
    events: sortActivityEvents(events),
    asOf: text(data.as_of),
  }
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function sortActivityEvents(events: readonly ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((left, right) => (
    timestampValue(right.timestamp) - timestampValue(left.timestamp) || left.id.localeCompare(right.id)
  ))
}

export function pruneActivityEvents(
  events: readonly ActivityEvent[],
  asOf: string | null,
  retentionMs = 5 * 60 * 1000,
): ActivityEvent[] {
  const end = asOf ? Date.parse(asOf) : Number.NaN
  if (Number.isNaN(end))
    return sortActivityEvents(events)

  const start = end - Math.max(0, retentionMs)
  return sortActivityEvents(events).filter((event) => {
    const timestamp = Date.parse(event.timestamp)
    return !Number.isNaN(timestamp) && timestamp >= start && timestamp <= end
  })
}

export function mergeActivityEvents(
  current: readonly ActivityEvent[],
  incoming: readonly ActivityEvent[],
  limit = 100,
  asOf: string | null = null,
): { events: ActivityEvent[], added: ActivityEvent[] } {
  const known = new Set(current.map(event => event.id))
  const merged = new Map(current.map(event => [event.id, event]))
  const added: ActivityEvent[] = []

  for (const event of incoming) {
    if (!known.has(event.id))
      added.push(event)
    known.add(event.id)
    merged.set(event.id, event)
  }

  const events = pruneActivityEvents([...merged.values()], asOf).slice(0, Math.max(0, limit))
  const retainedIds = new Set(events.map(event => event.id))
  return {
    events,
    added: pruneActivityEvents(added, asOf).filter(event => retainedIds.has(event.id)),
  }
}

export function activitySourceState(
  error: string,
  lastSuccessfulRefresh: string | null,
): 'estimated' | 'stale' | 'unavailable' {
  if (error && !lastSuccessfulRefresh)
    return 'unavailable'
  return error ? 'stale' : 'estimated'
}

export function filterActivityEvents(
  events: readonly ActivityEvent[],
  filters: ActivityFilters,
): ActivityEvent[] {
  const path = filters.path.trim().toLowerCase()
  return events.filter((event) => {
    if (filters.source && event.source !== filters.source)
      return false
    if (filters.eventType && event.eventType !== filters.eventType)
      return false
    return !path || event.path.toLowerCase().includes(path)
  })
}

export function parseActivityFilters(query: Record<string, unknown>): ActivityFilters {
  const sourceValue = Array.isArray(query.source) ? query.source[0] : query.source
  const eventValue = Array.isArray(query.event) ? query.event[0] : query.event
  const pathValue = Array.isArray(query.path) ? query.path[0] : query.path
  const source = sourceValue === 'portfolio' || sourceValue === 'sink' ? sourceValue : ''
  const eventType = typeof eventValue === 'string' && ACTIVITY_EVENT_TYPES.includes(eventValue as ActivityEventType)
    ? eventValue as ActivityEventType
    : ''

  return {
    source,
    eventType,
    path: typeof pathValue === 'string' ? pathValue.trim().slice(0, 160) : '',
  }
}

export function serializeActivityFilters(filters: ActivityFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.source)
    query.source = filters.source
  if (filters.eventType)
    query.event = filters.eventType
  if (filters.path.trim())
    query.path = filters.path.trim().slice(0, 160)
  return query
}

export function sameActivityFilters(left: ActivityFilters, right: ActivityFilters): boolean {
  return left.source === right.source && left.eventType === right.eventType && left.path === right.path
}

export function selectReplayEvents(
  events: readonly ActivityEvent[],
  knownIds: ReadonlySet<string>,
  limit = 20,
): ActivityEvent[] {
  return sortActivityEvents(events)
    .filter(event => !knownIds.has(event.id))
    .slice(0, Math.max(0, limit))
    .reverse()
}

export function createActivityPoller<T>(options: PollerOptions<T>) {
  const intervalMs = options.intervalMs ?? 10_000
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = options.clearTimer ?? (timer => clearTimeout(timer))
  const ready = options.ready ?? (() => true)
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let disposed = false
  let refreshQueued = false

  function schedule() {
    if (disposed || timer || !ready())
      return
    timer = setTimer(() => {
      timer = null
      void refresh().finally(schedule)
    }, intervalMs)
  }

  async function refresh(): Promise<boolean> {
    if (disposed || !ready() || controller)
      return false

    const nextController = new AbortController()
    controller = nextController
    options.onStart?.()
    try {
      const value = await options.load(nextController.signal)
      if (!nextController.signal.aborted && !disposed) {
        options.onSuccess(value)
        return true
      }
    }
    catch (error) {
      if (!nextController.signal.aborted && !disposed)
        options.onError?.(error)
    }
    finally {
      if (controller === nextController)
        controller = null
      options.onSettled?.()
      if (!controller && refreshQueued && !disposed && ready()) {
        refreshQueued = false
        void refresh()
      }
    }
    return false
  }

  function start() {
    if (disposed)
      return
    schedule()
  }

  function stop() {
    refreshQueued = false
    if (timer) {
      clearTimer(timer)
      timer = null
    }
    controller?.abort()
  }

  function invalidate() {
    if (controller) {
      refreshQueued = true
      controller.abort()
    }
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    refresh,
    start,
    stop,
    invalidate,
    dispose,
    get refreshing() {
      return controller !== null
    },
  }
}
