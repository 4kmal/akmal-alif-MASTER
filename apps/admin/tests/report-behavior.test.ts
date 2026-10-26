import { describe, expect, it } from 'vitest'
import { getAuthToken, removeAuthToken, setAuthToken } from '../app/utils/auth-token'
import {
  buildReportRangeParams,
  canonicalGoalRows,
  isCurrentRequest,
  normalizeReportRange,
} from '../app/utils/portfolio-report'
import { readAdminHealth } from '../server/services/admin-health'

describe('portfolio report helpers', () => {
  it('builds stable custom range boundaries for report URLs', () => {
    const params = buildReportRangeParams({
      range: 'custom',
      from: '2026-10-01',
      to: '2026-10-07',
    })

    expect(params.toString()).toBe('range=custom&from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-07T23%3A59%3A59.999Z')
  })

  it('keeps legacy aggregate goal aliases out of the explicit goal set', () => {
    const rows = canonicalGoalRows([
      { id: 'linkedin', conversions: 2 },
      { id: 'engagement', conversions: 4 },
      { id: 'career_contact', conversions: 3 },
      { id: 'contact', conversions: 1 },
    ])

    expect(rows.map(row => row.id)).toEqual(['linkedin', 'contact'])
  })

  it('rejects invalid range values and stale request sequences', () => {
    expect(normalizeReportRange('nonsense')).toBe('30d')
    expect(normalizeReportRange('nonsense', '24h')).toBe('24h')
    expect(isCurrentRequest(3, 3)).toBe(true)
    expect(isCurrentRequest(2, 3)).toBe(false)
  })
})

describe('admin source health', () => {
  it('reports missing bindings as unavailable instead of zero', async () => {
    const event = { context: { cloudflare: { env: {} } } } as never
    const health = await readAdminHealth(event)
    const sink = health.source_health.find(source => source.name === 'Sink link store')

    expect(sink?.state).toBe('unavailable')
    expect(health.alerts.some(alert => alert.includes('binding'))).toBe(true)
  })

  it('reports read-only Sink counts and expiry alerts', async () => {
    const values = new Map([
      ['SELECT COUNT(*) AS count FROM links', 12],
      ['SELECT COUNT(*) AS count FROM links WHERE effective_expires_at IS NOT NULL AND effective_expires_at <= ?', 2],
      ['SELECT COUNT(*) AS count FROM links WHERE effective_expires_at IS NOT NULL AND effective_expires_at > ? AND effective_expires_at <= ?', 3],
    ])
    const db = {
      prepare(query: string) {
        return {
          bind: (..._args: unknown[]) => ({
            first: async () => ({ count: values.get(query) ?? null }),
          }),
          first: async () => ({ count: values.get(query) ?? null }),
        }
      },
    }
    const event = { context: { cloudflare: { env: { DB: db } } } } as never
    const health = await readAdminHealth(event, Date.UTC(2026, 9, 26))
    const sink = health.source_health.find(source => source.name === 'Sink link store')

    expect(sink?.state).toBe('live')
    expect(sink?.detail).toContain('2 expired')
    expect(health.alerts).toContain('2 Sink links expired.')
    expect(health.alerts).toContain('3 Sink links expire within seven days.')
  })
})

describe('owner browser authentication', () => {
  it('does not persist or return a legacy site token', () => {
    setAuthToken('legacy-token-must-not-be-stored')
    expect(getAuthToken()).toBeNull()
    removeAuthToken()
    expect(getAuthToken()).toBeNull()
  })
})
