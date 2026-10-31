import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyAllowance,
  bindingIdentifiersFromSettings,
  clearCloudflareObservabilityCache,
  collectCloudflareObservability,
  cpuMicrosecondsToMilliseconds,
  durableObjectBillableRequests,
  getBillingCycle,
  normalizeProviderError,
  paginateCloudflareRest,
  parseCloudflareQuery,
  readCloudflareReport,
  runCloudflareMaintenance,
  sumMetricValues,
} from '../server/services/cloudflare-observability'

afterEach(() => {
  clearCloudflareObservabilityCache()
  vi.restoreAllMocks()
})

describe('cloudflare observability query and accounting helpers', () => {
  it('keeps only verified binding identifiers when classifying Worker resources', () => {
    const bindings = bindingIdentifiersFromSettings({
      result: {
        bindings: [
          { type: 'd1', name: 'PORTFOLIO_DB', database_id: 'd1-id' },
          { type: 'kv_namespace', name: 'KV', namespace_id: 'kv-id' },
          { type: 'r2_bucket', name: 'MEDIA', bucket_name: 'media-bucket' },
          { type: 'analytics_engine', name: 'ANALYTICS', dataset: 'portfolio_events' },
          { type: 'service', name: 'PORTFOLIO', service: 'akmalalif-portfolio' },
          { type: 'durable_object_namespace', name: 'LOBBY', namespace_id: 'do-id' },
          { type: 'secret_text', name: 'TOKEN', text: 'must-not-be-retained' },
        ],
      },
    })
    expect(bindings.d1Ids.has('d1-id')).toBe(true)
    expect(bindings.kvIds.has('kv-id')).toBe(true)
    expect(bindings.r2Names.has('media-bucket')).toBe(true)
    expect(bindings.datasets.has('portfolio_events')).toBe(true)
    expect(bindings.serviceNames.has('akmalalif-portfolio')).toBe(true)
    expect(bindings.durableObjectIds.has('do-id')).toBe(true)
    expect(JSON.stringify(bindings)).not.toContain('must-not-be-retained')
  })

  it('accepts the briefing range shorthand and preserves explicit range boundaries', () => {
    const now = Date.parse('2026-10-31T12:00:00.000Z')
    const shorthand = parseCloudflareQuery({ range: '7d', scope: 'akmalalif' }, now)
    expect(shorthand.scope).toBe('akmalalif')
    expect(shorthand.from.toISOString()).toBe('2026-10-24T12:00:00.000Z')
    expect(shorthand.to.toISOString()).toBe('2026-10-31T12:00:00.000Z')

    const explicit = parseCloudflareQuery({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z' }, now)
    expect(explicit.range).toBe('24h')
    expect(explicit.historical).toBe(false)
  })

  it('rejects unbounded ranges and invalid scopes', () => {
    expect(() => parseCloudflareQuery({ range: '365d' }, Date.parse('2026-10-31T12:00:00.000Z'))).toThrow('range must be')
    expect(() => parseCloudflareQuery({ scope: 'project' }, Date.now())).toThrow('scope must be')
    expect(() => parseCloudflareQuery({ from: '2026-10-02T00:00:00.000Z' }, Date.now())).toThrow('provided together')
  })

  it('keeps real zero separate from unavailable null and pools allowances before pricing', () => {
    expect(sumMetricValues([0, 0])).toBe(0)
    expect(sumMetricValues([null, null])).toBeNull()
    expect(applyAllowance(12, 10, 0.5)).toEqual({ billable: 2, estimatedCost: 1 })
    expect(applyAllowance(4, 10, 0.5)).toEqual({ billable: 0, estimatedCost: 0 })
  })

  it('keeps provider units explicit for CPU and WebSocket billing', () => {
    expect(cpuMicrosecondsToMilliseconds(2_500)).toBe(2.5)
    expect(cpuMicrosecondsToMilliseconds(0)).toBe(0)
    expect(cpuMicrosecondsToMilliseconds(null)).toBeNull()
    expect(durableObjectBillableRequests(40)).toBe(2)
    expect(durableObjectBillableRequests(0)).toBe(0)
    expect(durableObjectBillableRequests(null)).toBeNull()
  })

  it('identifies monthly cycle boundaries in UTC', () => {
    expect(getBillingCycle(Date.parse('2026-02-14T12:00:00.000Z'))).toEqual({
      from: '2026-02-08T00:00:00.000Z',
      to: '2026-03-08T00:00:00.000Z',
      source: 'estimated:anchor-day-8',
    })
  })

  it('normalizes a permission denial without exposing credentials', () => {
    const error = normalizeProviderError({ status: 403, message: 'denied' }, 'billing')
    expect(error.status).toBe(403)
    expect(error.source).toBe('billing')
    expect(error.message).toBe('denied')
  })
})

describe('cloudflare observability provider boundaries', () => {
  it('follows paginated inventory responses without logging the bearer token', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      calls.push(String(input))
      const page = new URL(String(input)).searchParams.get('page')
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: page === '1' ? 'first' : 'second', name: page === '1' ? 'one' : 'two' }],
        result_info: { page: Number(page), total_pages: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const rows = await paginateCloudflareRest({ CF_OBSERVABILITY_API_URL: 'https://api.example.test' }, 'secret-token', '/accounts/test/items', 'inventory.items', 1)
    expect(rows.map(row => row.id)).toEqual(['first', 'second'])
    expect(calls).toHaveLength(2)
    expect(calls.join('\n')).not.toContain('secret-token')
  })

  it('returns a truthful unavailable report when the dedicated token is missing', async () => {
    const event = { context: { cloudflare: { env: {} } } } as never
    const report = await readCloudflareReport(event)
    expect(report.meta.scope).toBe('account')
    expect(report.resources).toEqual([])
    expect(report.billing.actualCharges).toBeNull()
    expect(report.billing.estimatedCharges).toBeNull()
    expect(report.coverage.every(item => item.status === 'unavailable')).toBe(true)
  })

  it('aggregates a provider zero as zero and keeps the fallback fixed fee visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query?: string }
        const account: Record<string, unknown> = {}
        if (body.query?.includes('workersInvocationsAdaptive')) {
          account.workersInvocationsAdaptive = [{
            sum: { requests: 0, errors: 0, subrequests: 0, cpuTimeUs: 0, duration: 0, wallTime: 0 },
            quantiles: { cpuTimeP50: 0, cpuTimeP90: 0, cpuTimeP99: 0, cpuTimeP999: 0, memoryUsageBytesP50: 0, memoryUsageBytesP90: 0, memoryUsageBytesP99: 0, memoryUsageBytesP999: 0, wallTimeP50: 0, wallTimeP99: 0, wallTimeP999: 0, durationP50: 0, durationP99: 0 },
            dimensions: { datetimeFifteenMinutes: '2026-10-31T12:00:00Z', scriptName: 'akmalalif-admin' },
          }]
        }
        return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), { status: 200 })
      }
      if (url.includes('/billing/'))
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'forbidden' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const event = { context: { cloudflare: { env: { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' } } } } as never
    const report = await readCloudflareReport(event)
    expect(report.compute.find(item => item.key === 'workers.requests')?.value).toBe(0)
    expect(report.billing.estimatedCharges).toBe(5)
    expect(report.billing.actualCharges).toBeNull()
    expect(report.billing.reason).toContain('docs-2026-10-31')
  })

  it('uses the provider subscription cycle and current invoice amount when billing access is authorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/graphql'))
        return new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } } }), { status: 200 })
      if (url.endsWith('/billing/history')) {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { type: 'invoice', occurred_at: '2026-10-12T10:00:00Z', amount: 4.7, currency: 'usd' },
            { type: 'invoice', occurred_at: '2026-09-12T10:00:00Z', amount: 99, currency: 'usd' },
          ],
          result_info: { next_page: false },
        }), { status: 200 })
      }
      if (url.endsWith('/subscriptions')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ frequency: 'monthly', state: 'Paid', price: 5, currency: 'USD', current_period_start: '2026-10-08T00:00:00Z', current_period_end: '2026-11-08T00:00:00Z' }],
        }), { status: 200 })
      }
      if (url.endsWith('/billing/profile'))
        return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const event = { context: { cloudflare: { env: { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' } } } } as never
    const report = await readCloudflareReport(event)
    expect(report.billing.actualCharges).toBe(4.7)
    expect(report.billing.fixedFees).toBe(5)
    expect(report.billing.cycle).toEqual({ from: '2026-10-08T00:00:00Z', to: '2026-11-08T00:00:00Z', source: 'cloudflare:subscriptions' })
    expect(report.billing.status).toBe('live')
    expect(report.billing.currency).toBe('USD')
  })

  it('records an unavailable collection and prunes the two historical retention windows', async () => {
    const queries: string[] = []
    const db = {
      prepare(sql: string) {
        queries.push(sql)
        const statement = {
          bind() { return statement },
          async run() { return {} },
          async first() { return null },
        }
        return statement
      },
    }
    const env = { DB: db }
    const now = Date.parse('2026-10-31T12:00:00.000Z')
    const report = await collectCloudflareObservability(env, now)
    expect(report.billing.status).toBe('unavailable')
    expect(queries.some(query => query.includes('cloudflare_observability_snapshots'))).toBe(true)

    await runCloudflareMaintenance(env, now + 15 * 60 * 1000)
    expect(queries.filter(query => query.startsWith('DELETE FROM')).map(query => query.includes('snapshots'))).toEqual([true, false])
  })
})
