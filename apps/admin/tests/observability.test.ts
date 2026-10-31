import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import { describe, expect, it } from 'vitest'
import {
  aggregateCloudflareSeries,
  appendObservabilityQuery,
  createObservabilityQuerySync,
  formatObservabilityMetric,
  formatObservabilityNumber,
  isObservabilityAbort,
  observabilityCoverageStatus,
} from '../app/composables/useObservability'

describe('observability report helpers', () => {
  it('builds provider query paths while omitting empty optional filters', () => {
    expect(appendObservabilityQuery('/api/admin/observability/cloudflare', {
      range: '24h',
      scope: 'account',
    })).toBe('/api/admin/observability/cloudflare?range=24h&scope=account')

    expect(appendObservabilityQuery('/api/admin/observability/gaming', {
      range: '7d',
      game: '',
      mode: undefined,
      transport: 'web%2Fsocket',
    })).toBe('/api/admin/observability/gaming?range=7d&transport=web%252Fsocket')
  })

  it('merges rapid filter and tab patches while delayed router writes settle', async () => {
    let currentQuery: LocationQuery = { range: '7d', game: 'exepert', tab: 'players' }
    const writes: LocationQueryRaw[] = []
    const resolvers: Array<() => void> = []
    const router = {
      replace: ({ query }: { query: LocationQueryRaw }) => new Promise<void>((resolve) => {
        writes.push({ ...query })
        resolvers.push(() => {
          currentQuery = { ...query }
          resolve()
        })
      }),
    }
    const querySync = createObservabilityQuerySync(router, () => currentQuery)

    querySync.patchQuery({ game: undefined })
    querySync.patchQuery({ range: '13m' })
    querySync.patchQuery({ tab: undefined })

    expect(writes).toEqual([{ range: '7d', tab: 'players' }])
    currentQuery = { ...writes[0] }
    expect(querySync.shouldIgnoreRoute(currentQuery)).toBe(true)

    resolvers.shift()?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(writes).toEqual([
      { range: '7d', tab: 'players' },
      { range: '13m' },
    ])
    currentQuery = { ...writes[1] }
    expect(querySync.shouldIgnoreRoute(currentQuery)).toBe(true)

    resolvers.shift()?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(currentQuery).toEqual({ range: '13m' })
  })

  it('keeps unavailable provider values visible instead of converting them to zero', () => {
    expect(formatObservabilityMetric({ value: null, unit: 'ms' })).toBe('—')
    expect(formatObservabilityNumber(null, 'MB')).toBe('—')
    expect(formatObservabilityMetric({ value: 128, unit: 'MB' })).toMatch(/MiB$/)
  })

  it('humanizes bytes, durations, and counts while preserving their raw unit for tooltips', () => {
    expect(formatObservabilityNumber(2 * 1024 ** 3, 'bytes')).toBe('2 GiB')
    expect(formatObservabilityNumber(125, 'seconds')).toBe('2.08 min')
    expect(formatObservabilityNumber(12_500, 'players')).toBe('12.5K players')
    expect(formatObservabilityNumber(1_500, 'us')).toBe('1.5 ms')
    expect(formatObservabilityNumber(1_500, 'ms')).toBe('1.5 s')
    expect(formatObservabilityNumber(12, 'count')).toBe('12')
    expect(formatObservabilityNumber(0.42, 'ratio')).toBe('42%')
  })

  it('aggregates additive account series without averaging and keeps gauge series at the latest sample', () => {
    const series = [
      { timestamp: '2026-10-31T00:05:00.000Z', metric: 'requests', value: 4, resourceId: 'worker-a' },
      { timestamp: '2026-10-31T00:05:00.000Z', metric: 'requests', value: 6, resourceId: 'worker-b' },
      { timestamp: '2026-10-31T00:25:00.000Z', metric: 'requests', value: 3, resourceId: 'worker-a' },
      { timestamp: '2026-10-31T00:25:00.000Z', metric: 'requests', value: 7, resourceId: 'worker-b' },
      { timestamp: '2026-10-31T00:05:00.000Z', metric: 'storage_bytes', value: 8, resourceId: 'worker-a' },
      { timestamp: '2026-10-31T00:25:00.000Z', metric: 'storage_bytes', value: 12, resourceId: 'worker-a' },
    ]

    expect(aggregateCloudflareSeries(series, { key: 'requests', label: 'Requests', unit: 'count' }, '24h').map(point => point.value)).toEqual([20])
    expect(aggregateCloudflareSeries(series, { key: 'storage_bytes', label: 'Storage', unit: 'bytes' }, '24h').map(point => point.value)).toEqual([12])
  })

  it('recognizes abort errors from replaced report requests', () => {
    expect(isObservabilityAbort(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isObservabilityAbort({ name: 'AbortError' })).toBe(true)
    expect(isObservabilityAbort(new Error('network'))).toBe(false)
  })

  it('maps coverage to live, partial, stale, or unavailable without implying data', () => {
    expect(observabilityCoverageStatus([])).toBe('unavailable')
    expect(observabilityCoverageStatus([{ source: 'billing', status: 'unavailable', checkedAt: '' }])).toBe('unavailable')
    expect(observabilityCoverageStatus([{ source: 'usage', status: 'live', checkedAt: '' }])).toBe('live')
    expect(observabilityCoverageStatus([{ source: 'usage', status: 'partial', checkedAt: '' }])).toBe('partial')
    expect(observabilityCoverageStatus([{ source: 'usage', status: 'live', checkedAt: '' }], true)).toBe('stale')
  })
})
