import type { H3Event } from 'h3'
import type { GamingReport, SourceCoverage } from '../../shared/types/observability'

type Presence = GamingReport['live']
interface PresenceEnvironment {
  PORTFOLIO?: { fetch: (url: string, init?: RequestInit) => Promise<Response> }
}

let retainedPresence: Presence | null = null

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export async function readGamingPresence(env: PresenceEnvironment, now = Date.now()): Promise<{ live: Presence, coverage: SourceCoverage }> {
  const checkedAt = new Date(now).toISOString()
  const source = 'exepert-lobby:confirmed-heartbeats'
  try {
    if (!env.PORTFOLIO)
      throw new Error('The portfolio service binding is unavailable.')
    const response = await env.PORTFOLIO.fetch('https://www.akmalalif.com/api/exepert/status', {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok)
      throw new Error(`The lobby returned HTTP ${response.status}.`)
    const payload = await response.json() as { confirmed?: Record<string, unknown> }
    const presence = payload.confirmed
    const timestamp = typeof presence?.checkedAt === 'string' ? Date.parse(presence.checkedAt) : Number.NaN
    const evidence = typeof presence?.evidenceAt === 'string' ? Date.parse(presence.evidenceAt) : Number.NaN
    if (!presence || !nonnegative(presence.players) || !nonnegative(presence.rooms) || !nonnegative(presence.bots)
      || !Number.isFinite(timestamp) || !Number.isFinite(evidence)
      || evidence > now + 5000 || now - evidence > 35_000
      || timestamp > now + 5000 || now - timestamp > 35_000
      || !['live', 'partial'].includes(String(presence.status))) {
      throw new Error('Confirmed room heartbeats are unavailable or expired.')
    }
    const live: Presence = {
      players: presence.players,
      rooms: presence.rooms,
      bots: presence.bots,
      checkedAt: new Date(timestamp).toISOString(),
      status: presence.status as 'live' | 'partial',
    }
    retainedPresence = live
    return { live, coverage: {
      source,
      status: live.status,
      checkedAt: live.checkedAt,
      reason: live.status === 'partial'
        ? 'Lobby is warming up; rooms report within ten seconds. Reservations are excluded.'
        : 'EXEPERT room heartbeats expire after 35 seconds. Reservations are excluded.',
    } }
  }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'The lobby is unavailable.'
    if (retainedPresence && now - Date.parse(retainedPresence.checkedAt) < 5 * 60_000) {
      const live: Presence = { ...retainedPresence, status: 'stale' }
      return { live, coverage: { source, status: 'stale', checkedAt: live.checkedAt, reason } }
    }
    return {
      live: { players: null, bots: null, rooms: null, checkedAt, status: 'unavailable' },
      coverage: { source, status: 'unavailable', checkedAt, reason },
    }
  }
}

export async function withGamingPresence(event: H3Event, report: GamingReport): Promise<GamingReport> {
  const presence = await readGamingPresence(event.context.cloudflare?.env ?? {})
  return { ...report, live: presence.live, coverage: [...report.coverage, presence.coverage] }
}
