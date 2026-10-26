import { parseDate } from '@internationalized/date'
import { date2unix } from './time'

export const REPORT_RANGES = ['24h', '7d', '30d', '90d', 'custom'] as const

export type ReportRange = typeof REPORT_RANGES[number]

export interface ReportRangeQuery {
  range: ReportRange
  from?: string
  to?: string
}

/** Goal rows that represent a distinct action in the current contract. */
export const CANONICAL_GOAL_IDS = new Set([
  'linkedin',
  'github',
  'contact',
  'download',
  'playground',
  'article',
  'media',
  'shortlink_campaigns',
])

export function normalizeReportRange(value: unknown, fallback: ReportRange = '30d'): ReportRange {
  return typeof value === 'string' && (REPORT_RANGES as readonly string[]).includes(value)
    ? value as ReportRange
    : fallback
}

export function queryValue(value: unknown): string {
  if (Array.isArray(value))
    return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

function isoBoundary(value: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null
  try {
    const calendarDate = parseDate(value)
    const seconds = date2unix(calendarDate, endOfDay ? 'end' : 'start')
    const milliseconds = seconds * 1000 + (endOfDay ? 999 : 0)
    return new Date(milliseconds).toISOString()
  }
  catch {
    return null
  }
}

export function buildReportRangeParams(options: ReportRangeQuery): URLSearchParams {
  const params = new URLSearchParams()
  params.set('range', options.range)
  if (options.range === 'custom') {
    const from = options.from ? isoBoundary(options.from, false) : null
    const to = options.to ? isoBoundary(options.to, true) : null
    if (from)
      params.set('from', from)
    if (to)
      params.set('to', to)
  }
  return params
}

export function canonicalGoalRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter(row => typeof row.id === 'string' && CANONICAL_GOAL_IDS.has(row.id))
}

export function isCurrentRequest(sequence: number, latestSequence: number): boolean {
  return sequence === latestSequence
}
