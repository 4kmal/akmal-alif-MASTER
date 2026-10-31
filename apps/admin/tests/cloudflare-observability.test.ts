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

function eventWithPath(path: string, env: Record<string, unknown>): never {
  return { path, context: { cloudflare: { env } } } as never
}

function createMemoryDb(initialDaily: Array<{ day: string, scope: string, metric_key: string, resource_id: string, unit: string, value: number, updated_at: number }> = []) {
  const snapshots = new Map<string, unknown>()
  const daily = new Map<string, { unit: string, value: number, updated_at: number }>()
  for (const row of initialDaily)
    daily.set(`${row.day}|${row.scope}|${row.metric_key}|${row.resource_id}`, { unit: row.unit, value: row.value, updated_at: row.updated_at })
  const db = {
    prepare(sql: string) {
      let args: unknown[] = []
      const statement: {
        bind: (...values: unknown[]) => typeof statement
        run: () => Promise<unknown>
        first: <T extends Record<string, unknown>>() => Promise<T | null>
        all: <T extends Record<string, unknown>>() => Promise<{ results?: T[] }>
      } = {
        bind(...values: unknown[]) {
          args = values
          return statement
        },
        async run() {
          if (sql.includes('cloudflare_observability_snapshots'))
            snapshots.set(String(args[0]), { capturedAt: args[2], report: args[6] })
          if (sql.includes('INSERT INTO cloudflare_observability_daily')) {
            const key = `${args[0]}|${args[1]}|${args[2]}|${args[3]}`
            daily.set(key, { unit: String(args[4]), value: Number(args[5]), updated_at: Number(args[6]) })
          }
          return {}
        },
        async first<T extends Record<string, unknown>>() {
          if (sql.includes('SELECT value, updated_at')) {
            const key = `${args[0]}|${args[1]}|${args[2]}|${args[3]}`
            const row = daily.get(key)
            return row ? { value: row.value, updated_at: row.updated_at } as T : null
          }
          return null
        },
        async all<T extends Record<string, unknown>>() {
          if (sql.includes('FROM cloudflare_observability_daily')) {
            const scope = String(args[0])
            const from = String(args[1])
            const to = String(args[2])
            const results = [...daily.entries()]
              .map(([key, row]) => {
                const [day, rowScope, metric_key, resource_id] = key.split('|')
                return { day, scope: rowScope, metric_key, resource_id, ...row }
              })
              .filter(row => row.scope === scope && row.day >= from && row.day <= to)
            return { results: results as T[] }
          }
          return { results: [] as T[] }
        },
      }
      return statement
    },
  }
  return { db, daily, snapshots }
}

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
    expect(parseCloudflareQuery({ range: '90d' }, now).to.getTime() - parseCloudflareQuery({ range: '90d' }, now).from.getTime()).toBe(90 * 24 * 60 * 60 * 1000)
    expect(parseCloudflareQuery({ range: '13m' }, now).to.getTime() - parseCloudflareQuery({ range: '13m' }, now).from.getTime()).toBe(13 * 31 * 24 * 60 * 60 * 1000)

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
  it('reuses a relative-range report cache across a clock advance', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/graphql'))
        return new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } } }), { status: 200 })
      if (url.includes('/billing/history') || url.includes('/billing/profile'))
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'forbidden' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const env = { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' }
    const now = Date.parse('2026-10-31T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const first = await readCloudflareReport(eventWithPath('/api/admin/observability/cloudflare?range=24h', env))
      const firstCallCount = calls.length
      vi.setSystemTime(now + 90_000)
      const second = await readCloudflareReport(eventWithPath('/api/admin/observability/cloudflare?range=24h', env))
      expect(calls).toHaveLength(firstCallCount)
      expect(second.meta.from).toBe('2026-10-30T12:01:30.000Z')
      expect(second.meta.to).toBe('2026-10-31T12:01:30.000Z')
      expect(first.meta.from).toBe('2026-10-30T12:00:00.000Z')
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('deduplicates quarter snapshots, aggregates additive daily metrics, and reads old daily history', async () => {
    const memory = createMemoryDb()
    let billingMetricRequests = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query?: string, variables?: { from?: string } }
        if (body.variables?.from === '2026-10-08T00:00:00.000Z')
          billingMetricRequests += 1
        const workerRow = {
          sum: {
            requests: 10,
            errors: 0,
            subrequests: 0,
            cpuTimeUs: 1_000,
            duration: 1,
            wallTime: 1,
          },
          quantiles: {
            cpuTimeP50: 1,
            cpuTimeP90: 1,
            cpuTimeP99: 1,
            cpuTimeP999: 1,
            memoryUsageBytesP50: 1,
            memoryUsageBytesP90: 1,
            memoryUsageBytesP99: 1,
            memoryUsageBytesP999: 1,
            wallTimeP50: 1,
            wallTimeP99: 1,
            wallTimeP999: 1,
            durationP50: 1,
            durationP99: 1,
          },
          dimensions: {
            datetimeHour: '2026-10-31T12:00:00Z',
            scriptName: 'akmalalif-admin',
          },
        }
        const account: Record<string, unknown> = {
          workersAggregate: body.query?.includes('workersAggregate') ? [workerRow] : [],
          workersByScript: body.query?.includes('workersByScript') ? [workerRow] : [],
          workersSeries: body.query?.includes('workersSeries') ? [workerRow] : [],
        }
        return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), { status: 200 })
      }
      if (url.includes('/billing/history') || url.includes('/billing/profile'))
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'forbidden' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const env = { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test', DB: memory.db }
    const firstAt = Date.parse('2026-10-31T12:00:00.000Z')
    const firstReport = await collectCloudflareObservability(env, firstAt)
    expect(firstReport.series.some(item => item.metric === 'workers.requests')).toBe(true)
    expect(firstReport.series.some(item => item.metric === 'workers.errors')).toBe(true)
    const billingRequestsAfterFirst = billingMetricRequests
    await collectCloudflareObservability(env, firstAt + 90 * 1000)
    expect(billingMetricRequests).toBe(billingRequestsAfterFirst)
    await collectCloudflareObservability(env, firstAt + 15 * 60 * 1000)
    await collectCloudflareObservability(env, firstAt + 15 * 60 * 1000 + 90 * 1000)
    expect(memory.snapshots.size).toBe(4)
    expect(memory.daily.get('2026-10-31|account|workers.requests|')?.value).toBe(20)

    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2027-02-01T00:00:00.000Z'))
    try {
      const historical = await readCloudflareReport(eventWithPath('/api/admin/observability/cloudflare?from=2026-10-31T00:00:00.000Z&to=2026-11-01T00:00:00.000Z', {
        CF_OBSERVABILITY_TOKEN: 'test-token',
        DB: memory.db,
      }))
      expect(historical.compute.find(item => item.key === 'workers.requests')?.value).toBe(20)
      expect(historical.coverage.every(item => item.status === 'stale')).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('combines retained daily counts with the live prefix without overlapping the UTC split day', async () => {
    const memory = createMemoryDb([
      { day: '2026-09-30', scope: 'account', metric_key: 'workers.requests', resource_id: '', unit: 'count', value: 10, updated_at: 1 },
      { day: '2026-10-01', scope: 'account', metric_key: 'workers.requests', resource_id: '', unit: 'count', value: 100, updated_at: 1 },
      { day: '2026-09-30', scope: 'account', metric_key: 'workers.memoryUsageBytesP99', resource_id: '', unit: 'bytes', value: 20, updated_at: 1 },
      { day: '2026-10-01', scope: 'account', metric_key: 'workers.memoryUsageBytesP99', resource_id: '', unit: 'bytes', value: 999, updated_at: 1 },
    ])
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query?: string }
        const workerRow = {
          sum: { requests: 5, errors: 0, subrequests: 0, cpuTimeUs: 1, duration: 1, wallTime: 1 },
          quantiles: { cpuTimeP50: 1, cpuTimeP90: 1, cpuTimeP99: 1, cpuTimeP999: 1, memoryUsageBytesP50: 10, memoryUsageBytesP90: 20, memoryUsageBytesP99: 30, memoryUsageBytesP999: 40, wallTimeP50: 1, wallTimeP99: 1, wallTimeP999: 1, durationP50: 1, durationP99: 1 },
          dimensions: { datetimeHour: '2026-10-01T00:00:00Z', scriptName: 'akmalalif-admin' },
        }
        const account: Record<string, unknown> = body.query?.includes('workersAggregate')
          ? { workersAggregate: [workerRow], workersByScript: [workerRow], workersSeries: [workerRow] }
          : {}
        return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), { status: 200 })
      }
      if (url.includes('/billing/history') || url.includes('/billing/profile'))
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'forbidden' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const env = { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test', DB: memory.db }
    const now = Date.parse('2026-10-31T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    try {
      const path = '/api/admin/observability/cloudflare?from=2026-09-29T00:00:00.000Z&to=2026-10-31T12:00:00.000Z'
      const first = await readCloudflareReport(eventWithPath(path, env))
      expect(first.compute.find(item => item.key === 'workers.requests')?.value).toBe(15)
      expect(first.compute.find(item => item.key === 'workers.memoryUsageBytesP99')?.value).toBe(30)
      const requestSeries = first.series.filter(item => item.metric === 'workers.requests')
      expect(requestSeries.map(item => item.timestamp)).toEqual(['2026-09-30T00:00:00.000Z', '2026-10-01T00:00:00Z'])
      clearCloudflareObservabilityCache()
      const second = await readCloudflareReport(eventWithPath(path, env))
      expect(second.compute.find(item => item.key === 'workers.requests')?.value).toBe(15)
      expect(second.series.filter(item => item.metric === 'workers.requests')).toHaveLength(2)
      expect(second.coverage.some(item => item.status === 'partial')).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('withholds billing totals when a cycle analytics source is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body)) as { query?: string }
        if (body.query?.includes('durableObjectsInvocations'))
          return new Response(JSON.stringify({ errors: [{ message: 'durable analytics unavailable' }] }), { status: 200 })
        const workerRow = {
          sum: { requests: 10, errors: 0, subrequests: 0, cpuTimeUs: 1, duration: 1, wallTime: 1 },
          quantiles: { cpuTimeP50: 1, cpuTimeP90: 1, cpuTimeP99: 1, cpuTimeP999: 1, memoryUsageBytesP50: 1, memoryUsageBytesP90: 1, memoryUsageBytesP99: 1, memoryUsageBytesP999: 1, wallTimeP50: 1, wallTimeP99: 1, wallTimeP999: 1, durationP50: 1, durationP99: 1 },
          dimensions: { datetimeHour: '2026-10-31T12:00:00Z', scriptName: 'akmalalif-admin' },
        }
        const account: Record<string, unknown> = body.query?.includes('workersAggregate')
          ? { workersAggregate: [workerRow], workersByScript: [workerRow], workersSeries: [workerRow] }
          : {}
        return new Response(JSON.stringify({ data: { viewer: { accounts: [account] } } }), { status: 200 })
      }
      if (url.includes('/billing/'))
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'forbidden' }] }), { status: 403 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const event = { context: { cloudflare: { env: { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' } } } } as never
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-31T12:00:00.000Z'))
    try {
      const report = await readCloudflareReport(eventWithPath('/api/admin/observability/cloudflare?range=24h', event.context.cloudflare.env))
      expect(report.billing.estimatedCharges).toBeNull()
      expect(report.billing.forecast).toBeNull()
      expect(report.billing.status).toBe('partial')
      expect(report.billing.reason).toContain('durable_objects')
    }
    finally {
      vi.useRealTimers()
    }
  })

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

  it('uses current-cycle provider rated usage and ignores posted invoice timing', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/graphql')) {
        const workerRow = {
          sum: { requests: 100, errors: 1, subrequests: 2, cpuTimeUs: 1_000, duration: 2, wallTime: 3 },
          quantiles: { cpuTimeP50: 1, cpuTimeP90: 2, cpuTimeP99: 3, cpuTimeP999: 4, memoryUsageBytesP50: 5, memoryUsageBytesP90: 6, memoryUsageBytesP99: 7, memoryUsageBytesP999: 8, wallTimeP50: 1, wallTimeP99: 2, wallTimeP999: 3, durationP50: 1, durationP99: 2 },
          dimensions: { datetimeHour: '2026-10-31T12:00:00Z', scriptName: 'akmalalif-admin' },
        }
        return new Response(JSON.stringify({ data: { viewer: { accounts: [{ workersAggregate: [workerRow], workersByScript: [workerRow], workersSeries: [workerRow] }] } } }), { status: 200 })
      }
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
      if (url.includes('/billable-usage?')) {
        return new Response(JSON.stringify({
          success: true,
          result: [
            { ServiceName: 'Workers requests', BillingPeriodStart: '2026-10-08T00:00:00Z', ChargePeriodStart: '2026-10-08T00:00:00Z', ChargePeriodEnd: '2026-10-09T00:00:00Z', BillingCurrency: 'USD', BilledCost: 1.2, EffectiveCost: 0.1 },
            { ServiceName: 'Workers CPU', BillingPeriodStart: '2026-10-08T00:00:00Z', ChargePeriodStart: '2026-10-09T00:00:00Z', ChargePeriodEnd: '2026-10-10T00:00:00Z', BillingCurrency: 'USD', BilledCost: 0.8, EffectiveCost: 0.2 },
          ],
        }), { status: 200 })
      }
      if (url.endsWith('/subscriptions')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ frequency: 'monthly', state: 'Paid', price: 5, currency: 'USD', current_period_start: '2026-10-08T00:00:00Z', current_period_end: '2026-11-08T00:00:00Z' }],
        }), { status: 200 })
      }
      if (url.endsWith('/billing/profile'))
        return new Response(JSON.stringify({ success: true, result: { total: 999 } }), { status: 200 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const event = { context: { cloudflare: { env: { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' } } } } as never
    const report = await readCloudflareReport(event)
    expect(report.billing.actualCharges).toBe(2)
    expect(report.billing.fixedFees).toBe(5)
    expect(report.billing.cycle).toEqual({ from: '2026-10-08T00:00:00Z', to: '2026-11-08T00:00:00Z', source: 'cloudflare:subscriptions' })
    expect(report.billing.status).toBe('live')
    expect(report.billing.currency).toBe('USD')
    expect(report.billing.reason).toContain('provider-rated metered usage')
    expect(calls).toContain('https://api.example.test/accounts/73138007ecb740aea99f9c99bb2a2705/billable-usage?from=2026-10-08&to=2026-11-08')
    expect(report.billing.forecast).not.toBe(report.billing.actualCharges)
  })

  it('withholds current-cycle actual charges when FOCUS billing periods do not match', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/graphql'))
        return new Response(JSON.stringify({ data: { viewer: { accounts: [{}] } } }), { status: 200 })
      if (url.endsWith('/billing/history')) {
        return new Response(JSON.stringify({ success: true, result: [{ type: 'invoice', occurred_at: '2026-10-12T10:00:00Z', amount: 4.7, currency: 'usd' }] }), { status: 200 })
      }
      if (url.includes('/billable-usage?')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ ServiceName: 'Workers requests', BillingPeriodStart: '2026-09-08T00:00:00Z', ChargePeriodStart: '2026-10-08T00:00:00Z', ChargePeriodEnd: '2026-10-09T00:00:00Z', BillingCurrency: 'USD', BilledCost: 12 }],
        }), { status: 200 })
      }
      if (url.endsWith('/subscriptions')) {
        return new Response(JSON.stringify({
          success: true,
          result: [{ frequency: 'monthly', state: 'Paid', price: 5, currency: 'USD', current_period_start: '2026-10-08T00:00:00Z', current_period_end: '2026-11-08T00:00:00Z' }],
        }), { status: 200 })
      }
      if (url.endsWith('/billing/profile'))
        return new Response(JSON.stringify({ success: true, result: { amount: 999 } }), { status: 200 })
      return new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }), { status: 200 })
    }))
    const event = { context: { cloudflare: { env: { CF_OBSERVABILITY_TOKEN: 'test-token', CF_OBSERVABILITY_API_URL: 'https://api.example.test' } } } } as never
    const report = await readCloudflareReport(event)
    expect(report.billing.actualCharges).toBeNull()
    expect(report.billing.reason).toContain('outside the provider billing period')
    expect(report.billing.reason).not.toContain('4.7')
    expect(report.billing.status).toBe('partial')
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
