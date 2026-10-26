import type { ActivityEvent } from '../app/components/portfolio/live-activity-helpers'
import { describe, expect, it, vi } from 'vitest'
import {
  createActivityPoller,
  filterActivityEvents,
  mergeActivityEvents,
  normalizeActivitySnapshot,
  parseActivityFilters,
  selectReplayEvents,
  serializeActivityFilters,
} from '../app/components/portfolio/live-activity-helpers'

function event(id: string, timestamp: string, source = 'portfolio', path = '/'): ActivityEvent {
  return {
    id,
    timestamp,
    eventType: 'page_view',
    path,
    target: null,
    source,
    shortlinkSlug: null,
    campaign: null,
    country: null,
  }
}

describe('portfolio live activity helpers', () => {
  it('normalizes the realtime contract and preserves trusted event timestamps', () => {
    const snapshot = normalizeActivitySnapshot({
      data: {
        active_5m: 3,
        shortlink_active_5m: 2,
        visitor_estimates: {
          website: { unique_visitors: 3, method: 'Browser identifier' },
          shortlinks: { unique_visitors: 2, method: 'IP estimate' },
        },
        events: [
          { event_id: 'newest', timestamp: '2026-10-26T10:00:02.000Z', event_type: 'page_view', path: '/' },
          { event_id: 'older', timestamp: '2026-10-26T10:00:01.000Z', event_type: 'outbound_click', path: '/work', source: 'sink' },
          { event_id: 'invalid', timestamp: 'not-a-date' },
        ],
        as_of: '2026-10-26T10:00:03.000Z',
      },
    })

    expect(snapshot.activeWebsite).toBe(3)
    expect(snapshot.visitorEstimates.shortlinks.method).toBe('IP estimate')
    expect(snapshot.events.map(item => item.id)).toEqual(['newest', 'older'])
    expect(snapshot.events[1].timestamp).toBe('2026-10-26T10:00:01.000Z')
  })

  it('deduplicates stable IDs, sorts by event time, and keeps a bounded replay', () => {
    const current = [event('old', '2026-10-26T10:00:00.000Z')]
    const incoming = [
      event('old', '2026-10-26T10:00:00.000Z'),
      event('new', '2026-10-26T10:00:02.000Z'),
      event('middle', '2026-10-26T10:00:01.000Z'),
    ]
    const merged = mergeActivityEvents(current, incoming, 2)

    expect(merged.events.map(item => item.id)).toEqual(['new', 'middle'])
    expect(merged.added.map(item => item.id)).toEqual(['new', 'middle'])
    expect(selectReplayEvents(merged.events, new Set(), 2).map(item => item.id)).toEqual(['middle', 'new'])
  })

  it('round-trips URL filters and applies source, event, and path predicates', () => {
    const filters = parseActivityFilters({ source: 'sink', event: 'outbound_click', path: '/s/cv' })
    const events = [
      { ...event('sink', '2026-10-26T10:00:01.000Z', 'sink', '/s/cv'), eventType: 'outbound_click' },
      { ...event('website', '2026-10-26T10:00:02.000Z', 'portfolio', '/s/cv'), eventType: 'outbound_click' },
    ]

    expect(serializeActivityFilters(filters)).toEqual({ source: 'sink', event: 'outbound_click', path: '/s/cv' })
    expect(filterActivityEvents(events, filters).map(item => item.id)).toEqual(['sink'])
  })

  it('does not overlap requests and discards an aborted stale response before retrying', async () => {
    const requests: Array<{ signal: AbortSignal, resolve: (value: string) => void }> = []
    const successes: string[] = []
    const errors: unknown[] = []
    const poller = createActivityPoller({
      load: signal => new Promise<string>((resolve) => {
        requests.push({ signal, resolve })
      }),
      onSuccess: value => successes.push(value),
      onError: error => errors.push(error),
    })

    const first = poller.refresh()
    expect(await poller.refresh()).toBe(false)
    expect(requests).toHaveLength(1)

    poller.invalidate()
    expect(requests[0].signal.aborted).toBe(true)
    const queued = poller.refresh()
    expect(requests).toHaveLength(1)
    requests[0].resolve('stale')
    await first
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    requests[1].resolve('fresh')
    await queued
    await vi.waitFor(() => expect(successes).toEqual(['fresh']))

    expect(errors).toEqual([])
    poller.dispose()
  })

  it('schedules visible polling at ten-second intervals', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => 'snapshot')
    const poller = createActivityPoller({
      load,
      onSuccess: () => {},
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(load).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(load).toHaveBeenCalledTimes(1)
    poller.dispose()
    vi.useRealTimers()
  })
})
