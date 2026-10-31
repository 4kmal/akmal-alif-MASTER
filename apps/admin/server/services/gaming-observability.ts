import type { H3Event } from 'h3'
import type { GamingPlayer, GamingPlayerDetail, GamingReport, GamingSession, GamingSessionDetail } from '../../shared/types/observability'
import * as gamingAnalytics from '@portfolio-analytics'
import { createError, getQuery, getRouterParam } from 'h3'

interface WorkerBreakdown {
  id?: string
  label?: string
  starts?: number
  players?: number | null
  completions?: number
  playSeconds?: number
  score?: number | null
  distance?: number
  disconnects?: number
  renderFailures?: number
  endReasons?: Record<string, number>
  interactions?: Record<string, number>
}

interface WorkerReportData {
  unavailable?: boolean
  reason?: string
  from?: number
  to?: number
  sessions?: GamingSession[]
  players?: GamingPlayer[]
  playersCount?: number
  eventCount?: number
  daily?: Array<{ date?: string, starts?: number, players?: number | null, completions?: number, playSeconds?: number }>
  games?: WorkerBreakdown[]
  modes?: WorkerBreakdown[]
  sectors?: WorkerBreakdown[]
  interactions?: Array<{ gameId?: string, label?: string, count?: number }>
  endReasons?: Array<{ gameId?: string, reason?: string, count?: number }>
  funnel?: Array<{ stage?: string, count?: number }>
  performance?: { fps?: number | null, rttMs?: number | null, loadMs?: number | null }
  aggregate?: {
    starts?: number
    completions?: number
    abandoned?: number
    active?: number
    serverVerified?: number
    playSeconds?: number
    returningPlayers?: number
  }
  trackingStartedAt?: string | null
  authoritative?: {
    matches?: number
    completed?: number
    participants?: number
    humans?: number
    bots?: number
    kills?: number
    deaths?: number
    assists?: number
    humanKills?: number
    humanDeaths?: number
    humanAssists?: number
    botKills?: number
    botDeaths?: number
    botAssists?: number
    modes?: Array<Record<string, number | string>>
  }
  nextCursor?: string | null
}

interface GamingWorker {
  readGamingData?: (env: unknown, options?: Record<string, unknown>) => Promise<WorkerReportData>
  readGamingSession?: (env: unknown, id: string, options?: Record<string, unknown>) => Promise<GamingSessionDetail | null>
  readGamingPlayer?: (env: unknown, id: string, options?: Record<string, unknown>) => Promise<GamingPlayerDetail | null>
  runGamingMaintenance?: (env: unknown, now?: number) => Promise<unknown>
}

function worker(): GamingWorker {
  return gamingAnalytics as unknown as GamingWorker
}

function envFor(event: H3Event): unknown {
  return event.context.cloudflare?.env ?? {}
}

function one(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

function rangeDays(value: unknown): number {
  const range = one(value)
  return range === '7d' ? 7 : range === '90d' ? 90 : 30
}

function iso(value: number): string {
  return new Date(value).toISOString()
}

function metric(key: string, label: string, value: number | null, unit = 'count', detail?: string) {
  return { key, label, value, unit, ...(detail ? { detail } : {}) }
}

function gameBreakdown(row: WorkerBreakdown) {
  return {
    id: String(row.id),
    label: String(row.label || row.id),
    starts: Number(row.starts || 0),
    players: row.players == null ? null : Number(row.players),
    completions: Number(row.completions || 0),
    playSeconds: Number(row.playSeconds || 0),
    ...(row.score == null ? {} : { score: Number(row.score) }),
    distance: Number(row.distance || 0),
    disconnects: Number(row.disconnects || 0),
    renderFailures: Number(row.renderFailures || 0),
    endReasons: row.endReasons || {},
    interactions: row.interactions || {},
  }
}

function unavailableReport(range: number, now: number, reason: string): GamingReport {
  const checkedAt = new Date(now).toISOString()
  return {
    meta: {
      from: iso(now - range * 24 * 60 * 60 * 1000),
      to: iso(now),
      checkedAt,
      timezone: 'Asia/Kuala_Lumpur',
      trackingStartedAt: null,
      scope: 'akmalalif',
    },
    coverage: [{ source: 'admin-d1:gaming', status: 'unavailable', checkedAt, reason }],
    overview: [
      metric('starts', 'Game starts', null),
      metric('players', 'Pseudonymous players', null),
      metric('completions', 'Completed sessions', null),
      metric('play_seconds', 'Play time', null, 'seconds'),
      metric('events', 'Gaming events', null),
    ],
    daily: [],
    games: [],
    modes: [],
    funnel: [],
    sessions: [],
    players: [],
    live: { players: null, rooms: null, bots: null, checkedAt, status: 'unavailable' },
    performance: [
      metric('fps_avg', 'Average FPS', null, 'fps'),
      metric('rtt_avg', 'Average network RTT', null, 'ms'),
      metric('load_avg', 'Average game load', null, 'ms'),
    ],
    nextCursor: null,
  }
}

function authoritativeMetrics(authoritative: WorkerReportData['authoritative']) {
  if (!authoritative)
    return []
  const metrics = [
    metric('authoritative_matches', 'Server verified matches', authoritative.matches ?? null),
    metric('authoritative_participants', 'Server verified participants', authoritative.participants ?? null),
    metric('authoritative_humans', 'Server verified human participants', authoritative.humans ?? null),
    metric('authoritative_bots', 'Server verified bots', authoritative.bots ?? null),
    metric('authoritative_kills', 'Server verified kills', authoritative.kills ?? null),
    metric('authoritative_deaths', 'Server verified deaths', authoritative.deaths ?? null),
    metric('authoritative_assists', 'Server verified assists', authoritative.assists ?? null),
    metric('authoritative_human_kills', 'Human participant kills', authoritative.humanKills ?? null),
    metric('authoritative_human_deaths', 'Human participant deaths', authoritative.humanDeaths ?? null),
    metric('authoritative_human_assists', 'Human participant assists', authoritative.humanAssists ?? null),
    metric('authoritative_bot_kills', 'Bot kills', authoritative.botKills ?? null),
    metric('authoritative_bot_deaths', 'Bot deaths', authoritative.botDeaths ?? null),
    metric('authoritative_bot_assists', 'Bot assists', authoritative.botAssists ?? null),
  ]
  const counters = ['captures', 'contests', 'deploys', 'loots', 'lifts', 'extracted', 'extracted_value']
  for (const mode of authoritative.modes || []) {
    const modeId = String(mode.mode || 'unknown')
    for (const counter of counters) {
      if (mode[counter] == null)
        continue
      metrics.push(metric(`authoritative_${modeId}_${counter}`, `${modeId} ${counter}`, Number(mode[counter])))
    }
  }
  return metrics
}

export async function readGamingReport(event: H3Event): Promise<GamingReport> {
  const query = getQuery(event) as Record<string, unknown>
  const env = envFor(event)
  const fromWorker = worker()
  const range = rangeDays(query.range)
  const now = Date.now()
  if (!fromWorker.readGamingData)
    return unavailableReport(range, now, 'Gaming analytics worker is unavailable.')
  let data: WorkerReportData
  try {
    data = await fromWorker.readGamingData(env, {
      rangeDays: range,
      game: one(query.game),
      mode: one(query.mode),
      transport: one(query.transport),
      cursor: one(query.cursor),
      now,
    })
  }
  catch (error) {
    return unavailableReport(range, now, error instanceof Error ? error.message : 'Gaming analytics read failed.')
  }
  if (data?.unavailable)
    return unavailableReport(range, now, data.reason || 'Gaming analytics is unavailable.')

  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const aggregate = data.aggregate || {}
  const completed = Number(aggregate.completions ?? sessions.filter(row => row.status === 'completed').length)
  const verified = Number(aggregate.serverVerified ?? sessions.filter(row => row.verification === 'server_verified').length)
  const playSeconds = Number(aggregate.playSeconds ?? sessions.reduce((sum, row) => sum + Number(row.durationSeconds || 0), 0))
  const meta = {
    from: iso(Number(data.from || now - range * 24 * 60 * 60 * 1000)),
    to: iso(Number(data.to || now)),
    checkedAt: new Date(now).toISOString(),
    timezone: 'Asia/Kuala_Lumpur',
    trackingStartedAt: data.trackingStartedAt || null,
    scope: 'akmalalif' as const,
  }
  const report = {
    meta,
    coverage: [{ source: 'admin-d1:gaming', status: 'live', checkedAt: meta.checkedAt }],
    overview: [
      metric('starts', 'Game starts', Number(aggregate.starts ?? sessions.length)),
      metric('players', 'Pseudonymous players', Number(data.playersCount || 0)),
      metric('completions', 'Completed sessions', completed),
      metric('server_verified', 'Server verified sessions', verified),
      metric('abandoned', 'Abandoned sessions', Number(aggregate.abandoned ?? 0)),
      metric('active', 'Active or disconnected sessions', Number(aggregate.active ?? 0)),
      metric('returning_players', 'Returning players', Number(aggregate.returningPlayers ?? 0)),
      metric('play_seconds', 'Play time', playSeconds, 'seconds'),
      metric('events', 'Gaming events', Number(data.eventCount || 0)),
      ...authoritativeMetrics(data.authoritative),
    ],
    daily: (data.daily || []).map(row => ({
      date: String(row.date || ''),
      starts: Number(row.starts || 0),
      players: row.players == null ? null : Number(row.players),
      completions: Number(row.completions || 0),
      playSeconds: Number(row.playSeconds || 0),
    })),
    games: (data.games || []).map(gameBreakdown),
    modes: (data.modes || []).map(gameBreakdown),
    sectors: (data.sectors || []).map(gameBreakdown),
    interactions: data.interactions || [],
    endReasons: data.endReasons || [],
    funnel: (data.funnel || []).map(row => ({
      stage: String(row.stage || ''),
      count: Number(row.count || 0),
    })),
    sessions,
    players: data.players || [],
    live: {
      players: null,
      rooms: null,
      bots: null,
      checkedAt: meta.checkedAt,
      status: 'unavailable',
    },
    performance: [
      metric('fps_avg', 'Average FPS', data.performance?.fps == null ? null : Number(data.performance.fps), 'fps'),
      metric('rtt_avg', 'Average network RTT', data.performance?.rttMs == null ? null : Number(data.performance.rttMs), 'ms'),
      metric('load_avg', 'Average game load', data.performance?.loadMs == null ? null : Number(data.performance.loadMs), 'ms'),
    ],
    nextCursor: data.nextCursor || null,
  } as unknown as GamingReport
  return report
}

export async function readGamingSessionDetail(event: H3Event): Promise<GamingSessionDetail> {
  const sessionId = getRouterParam(event, 'id') || ''
  const query = getQuery(event) as Record<string, unknown>
  const read = worker().readGamingSession
  if (!read)
    throw createError({ statusCode: 503, statusMessage: 'Gaming analytics is unavailable.' })
  const detail = await read(envFor(event), sessionId, { timelineCursor: one(query.timeline_cursor) })
  if (!detail)
    throw createError({ statusCode: 404, statusMessage: 'Gaming session not found.' })
  return detail as GamingSessionDetail
}

export async function readGamingPlayerDetail(event: H3Event): Promise<GamingPlayerDetail> {
  const playerId = getRouterParam(event, 'id') || ''
  const query = getQuery(event) as Record<string, unknown>
  const read = worker().readGamingPlayer
  if (!read)
    throw createError({ statusCode: 503, statusMessage: 'Gaming analytics is unavailable.' })
  const detail = await read(envFor(event), playerId, { cursor: one(query.cursor) })
  if (!detail)
    throw createError({ statusCode: 404, statusMessage: 'Gaming player not found.' })
  return detail as GamingPlayerDetail
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function gamingSessionsCsv(report: Pick<GamingReport, 'sessions'>): Response {
  const headers = ['id', 'game_id', 'player_label', 'mode', 'sector', 'transport', 'started_at', 'ended_at', 'status', 'duration_seconds', 'verification', 'score', 'kills', 'deaths', 'assists']
  const rows = report.sessions.map(session => [
    session.id,
    session.gameId,
    session.playerLabel,
    session.mode,
    session.sector,
    session.transport,
    session.startedAt,
    session.endedAt,
    session.status,
    session.durationSeconds,
    session.verification,
    session.score,
    session.kills,
    session.deaths,
    session.assists,
  ])
  const body = `${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="gaming-sessions.csv"',
      'Cache-Control': 'no-store',
    },
  })
}

export async function readGamingSessionsCsv(event: H3Event): Promise<Response> {
  const query = getQuery(event) as Record<string, unknown>
  const fromWorker = worker()
  if (!fromWorker.readGamingData)
    throw createError({ statusCode: 503, statusMessage: 'Gaming analytics is unavailable.' })
  const env = envFor(event)
  const range = rangeDays(query.range)
  const now = Date.now()
  const sessions: GamingSession[] = []
  let cursor = one(query.cursor)
  let pages = 0
  while (pages++ < 10_000) {
    const data = await fromWorker.readGamingData(env, {
      rangeDays: range,
      game: one(query.game),
      mode: one(query.mode),
      transport: one(query.transport),
      cursor,
      now,
      sessionsOnly: true,
    })
    if (data?.unavailable)
      throw createError({ statusCode: 503, statusMessage: data.reason || 'Gaming analytics is unavailable.' })
    sessions.push(...(data.sessions || []))
    const next = data.nextCursor || ''
    if (!next || next === cursor)
      return gamingSessionsCsv({ sessions })
    cursor = next
  }
  throw createError({ statusCode: 503, statusMessage: 'Gaming CSV pagination exceeded the safety limit.' })
}

function environmentTarget(target: unknown): unknown {
  if (target && typeof target === 'object' && 'context' in target) {
    const context = (target as { context?: { cloudflare?: unknown } }).context
    if (context?.cloudflare !== undefined)
      return envFor(target as H3Event)
  }
  return target
}

export async function runGamingMaintenance(target: unknown = {}, now?: number): Promise<unknown> {
  const run = worker().runGamingMaintenance
  if (!run)
    throw createError({ statusCode: 503, statusMessage: 'Gaming maintenance is unavailable.' })
  return run(environmentTarget(target), now)
}
