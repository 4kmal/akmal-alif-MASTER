import type { LinkCheckResult } from '#shared/types/link-check'

interface HealthReadableStatement {
  first: <T extends Record<string, unknown>>() => Promise<T | null>
}

interface HealthStatement<Bound extends HealthReadableStatement> extends HealthReadableStatement {
  bind: (...values: unknown[]) => Bound
}

interface HealthDatabase<Statement extends HealthStatement<Statement>> {
  prepare: (query: string) => Statement
  batch: (statements: Statement[]) => Promise<unknown>
}

const HEALTH_PREFIX = 'sink_health:'
const HEALTH_FRESH_MS = 7 * 24 * 60 * 60 * 1000

export async function persistLinkHealth<Statement extends HealthStatement<Statement>>(db: HealthDatabase<Statement>, results: LinkCheckResult[]): Promise<void> {
  if (!results.length)
    return
  await db.batch(results.map(result => db.prepare(`
    INSERT INTO portfolio_analytics_state(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE excluded.updated_at >= portfolio_analytics_state.updated_at
  `).bind(
    `${HEALTH_PREFIX}${result.slug}`,
    JSON.stringify({ ok: result.ok, status: result.status }),
    Date.parse(result.checkedAt),
  )))
}

export async function readLinkHealth(db: { prepare: (query: string) => HealthStatement<HealthReadableStatement> }, now: number) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS checked,
      SUM(CASE WHEN json_extract(state.value, '$.ok') = 0 THEN 1 ELSE 0 END) AS broken,
      MAX(state.updated_at) AS last_checked_at
    FROM portfolio_analytics_state AS state
    JOIN links ON state.key = ? || links.slug
    WHERE state.updated_at >= ?
  `).bind(HEALTH_PREFIX, now - HEALTH_FRESH_MS).first<{
    checked: number
    broken: number | null
    last_checked_at: number | null
  }>()
  return {
    checked: Number(row?.checked ?? 0),
    broken: Number(row?.broken ?? 0),
    lastCheckedAt: row?.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
  }
}
