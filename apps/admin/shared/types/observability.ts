export type SourceStatus = 'live' | 'partial' | 'stale' | 'unavailable'

export interface SourceCoverage {
  source: string
  status: SourceStatus
  checkedAt: string
  reason?: string
  sampled?: boolean
}

export interface ReportMeta {
  from: string
  to: string
  checkedAt: string
  timezone: string
  trackingStartedAt?: string | null
  scope?: 'account' | 'akmalalif'
}

export interface ObservabilityMetric {
  key: string
  label: string
  value: number | null
  unit: string
  resourceId?: string
  resourceName?: string
  detail?: string
}

export interface CloudflareResource {
  id: string
  name: string
  kind: string
  project: 'akmalalif' | 'other' | 'shared' | 'unassigned'
  url?: string
}

export interface BillingUsage {
  key: string
  label: string
  consumed: number | null
  included: number | null
  billable: number | null
  unit: string
  estimatedCost: number | null
  actualCost?: number | null
  attribution: 'account' | 'resource' | 'unattributed'
}

export interface CloudflareBilling {
  status: SourceStatus
  cycle: { from: string, to: string, source: string }
  currency: string
  actualCharges: number | null
  estimatedCharges: number | null
  fixedFees: number | null
  forecast: number | null
  usage: BillingUsage[]
  url: string
  reason?: string
  pricingAsOf?: string
}

export interface CloudflareReport {
  meta: ReportMeta
  coverage: SourceCoverage[]
  resources: CloudflareResource[]
  compute: ObservabilityMetric[]
  durableObjects: ObservabilityMetric[]
  storage: ObservabilityMetric[]
  traffic: ObservabilityMetric[]
  services: ObservabilityMetric[]
  billing: CloudflareBilling
  series: Array<{ timestamp: string, metric: string, value: number, resourceId?: string }>
  deployments: Array<{ id: string, resourceName: string, createdAt: string, source?: string }>
}

export interface GamingSession {
  id: string
  gameId: string
  playerId?: string | null
  playerLabel?: string | null
  mode?: string | null
  sector?: string | null
  transport: string
  entrypoint?: string | null
  startedAt: string
  lastSeenAt: string
  endedAt: string | null
  status: string
  durationSeconds: number
  verification: 'server_verified' | 'client_reported'
  score?: number | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  details?: Record<string, number | string | null>
}

export interface GamingBreakdown {
  id: string
  label: string
  starts: number
  players: number | null
  completions: number
  playSeconds: number
  score?: number | null
}

export interface GamingPlayer {
  id: string
  label: string
  sessions: number
  playSeconds: number
  firstSeenAt: string
  lastSeenAt: string
  returning: boolean
}

export interface GamingReport {
  meta: ReportMeta
  coverage: SourceCoverage[]
  overview: ObservabilityMetric[]
  daily: Array<{ date: string, starts: number, players: number | null, completions: number, playSeconds: number }>
  games: GamingBreakdown[]
  modes: GamingBreakdown[]
  funnel: Array<{ stage: string, count: number }>
  sessions: GamingSession[]
  players: GamingPlayer[]
  live: { players: number | null, rooms: number | null, bots: number | null, checkedAt: string, status: SourceStatus }
  performance: ObservabilityMetric[]
  nextCursor?: string | null
}

export interface GamingSessionDetail {
  session: GamingSession
  timeline: Array<{ id: string, at: string, kind: string, detail?: string }>
  participants: Array<{ label: string, bot: boolean, kills?: number, deaths?: number, assists?: number, score?: number }>
}

export interface GamingPlayerDetail {
  player: GamingPlayer
  sessions: GamingSession[]
}

export interface ObservabilitySummary {
  cloudflare: Pick<CloudflareReport, 'meta' | 'coverage' | 'billing'> & { metrics: ObservabilityMetric[] }
  gaming: Pick<GamingReport, 'meta' | 'coverage' | 'overview' | 'live'>
}
