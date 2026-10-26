import type { H3Event } from 'h3'
import { readLinkHealth } from '../utils/link-health-state'

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement
  first: <T extends Record<string, unknown>>() => Promise<T | null>
}

interface D1Like {
  prepare: (query: string) => D1Statement
}

export interface AdminHealthSummary {
  source_health: Array<{
    name: string
    state: 'live' | 'partial' | 'unavailable'
    available: boolean
    reason: string
    detail?: string
  }>
  alerts: string[]
}

function environment(event: H3Event): Record<string, unknown> {
  return (event.context.cloudflare?.env ?? {}) as unknown as Record<string, unknown>
}

function configuredBinding(value: unknown): boolean {
  return value !== undefined && value !== null
}

async function count(db: D1Like, query: string, ...values: unknown[]): Promise<number | null> {
  const row = await db.prepare(query).bind(...values).first<{ count?: number | string }>()
  if (row?.count === undefined || row.count === null)
    return null
  const value = Number(row.count)
  return Number.isFinite(value) ? value : null
}

/**
 * Read-only health facts for the briefing. A missing binding or failed query is
 * returned as unavailable so the UI never turns an integration failure into 0.
 */
export async function readAdminHealth(event: H3Event, now = Date.now()): Promise<AdminHealthSummary> {
  const env = environment(event)
  const source_health: AdminHealthSummary['source_health'] = []
  const alerts: string[] = []
  const db = env.DB as D1Like | undefined

  if (!db) {
    source_health.push({
      name: 'Sink link store',
      state: 'unavailable',
      available: false,
      reason: 'The admin D1 binding is unavailable.',
    })
    alerts.push('Sink link health is unavailable because the admin D1 binding is not configured.')
  }
  else {
    try {
      const [total, expired, expiring] = await Promise.all([
        count(db, 'SELECT COUNT(*) AS count FROM links'),
        count(db, 'SELECT COUNT(*) AS count FROM links WHERE effective_expires_at IS NOT NULL AND effective_expires_at <= ?', Math.floor(now / 1000)),
        count(db, 'SELECT COUNT(*) AS count FROM links WHERE effective_expires_at IS NOT NULL AND effective_expires_at > ? AND effective_expires_at <= ?', Math.floor(now / 1000), Math.floor(now / 1000) + 7 * 24 * 60 * 60),
      ])
      if (total === null || expired === null || expiring === null) {
        source_health.push({
          name: 'Sink link store',
          state: 'partial',
          available: true,
          reason: 'The links table responded without complete counts.',
        })
      }
      else {
        source_health.push({
          name: 'Sink link store',
          state: 'live',
          available: true,
          reason: `${total} links in the admin D1 store.`,
          detail: `${expired} expired · ${expiring} expiring within seven days.`,
        })
        if (expired > 0)
          alerts.push(`${expired} Sink link${expired === 1 ? '' : 's'} expired.`)
        if (expiring > 0)
          alerts.push(`${expiring} Sink link${expiring === 1 ? '' : 's'} expire within seven days.`)
      }
    }
    catch {
      source_health.push({
        name: 'Sink link store',
        state: 'unavailable',
        available: false,
        reason: 'The links table could not be read.',
      })
      alerts.push('Sink link health could not be read from the admin D1 store.')
    }
  }

  try {
    if (!db)
      throw new Error('Missing database')
    const health = await readLinkHealth(db, now)
    source_health.push({
      name: 'Sink link checks',
      state: health.checked ? 'live' : 'partial',
      available: true,
      reason: health.checked
        ? `${health.broken} failures across ${health.checked} destinations checked within seven days.`
        : 'No recent destination checks. Run Health check to inspect links.',
      detail: health.lastCheckedAt ? `Last check: ${health.lastCheckedAt}` : undefined,
    })
    if (health.broken)
      alerts.push(`${health.broken} recently checked shortlink destination${health.broken === 1 ? '' : 's'} failed. Review Health check.`)
  }
  catch {
    source_health.push({
      name: 'Sink link checks',
      state: 'unavailable',
      available: false,
      reason: 'Recent destination-check results could not be read.',
    })
  }

  for (const [name, binding, reason] of [
    ['Shortlink analytics', env.ANALYTICS, 'Analytics Engine shortlink dataset binding.'],
    ['Portfolio analytics', env.PORTFOLIO_ANALYTICS, 'Analytics Engine portfolio dataset binding.'],
  ] as const) {
    const available = configuredBinding(binding)
    source_health.push({
      name,
      state: available ? 'live' : 'unavailable',
      available,
      reason: available ? reason : 'The Analytics Engine binding is unavailable.',
    })
    if (!available)
      alerts.push(`${name} is unavailable; related metrics may be blank.`)
  }

  const performanceConfigured = Boolean(env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID && env.CF_WEB_ANALYTICS_SITE_TAG)
  source_health.push({
    name: 'Performance telemetry',
    state: performanceConfigured ? 'live' : 'unavailable',
    available: performanceConfigured,
    reason: performanceConfigured
      ? 'Cloudflare Workers and Web Analytics credentials are configured.'
      : 'Cloudflare performance credentials are unavailable.',
  })

  return { source_health, alerts: [...new Set(alerts)] }
}
