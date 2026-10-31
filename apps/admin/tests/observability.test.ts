import { describe, expect, it } from 'vitest'
import {
  appendObservabilityQuery,
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

  it('keeps unavailable provider values visible instead of converting them to zero', () => {
    expect(formatObservabilityMetric({ value: null, unit: 'ms' })).toBe('—')
    expect(formatObservabilityNumber(null, 'MB')).toBe('—')
    expect(formatObservabilityMetric({ value: 128, unit: 'MB' })).toMatch(/MiB$/)
  })

  it('humanizes bytes, durations, and counts while preserving their raw unit for tooltips', () => {
    expect(formatObservabilityNumber(2 * 1024 ** 3, 'bytes')).toBe('2 GiB')
    expect(formatObservabilityNumber(125, 'seconds')).toBe('2.08 min')
    expect(formatObservabilityNumber(12_500, 'players')).toBe('12.5K players')
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
