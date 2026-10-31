import type { Link } from '../../shared/schemas/link'
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const links = sqliteTable('links', {
  slug: text().primaryKey(),
  id: text().notNull(),
  url: text().notNull(),
  comment: text(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  expiration: integer(),
  title: text(),
  description: text(),
  image: text(),
  apple: text(),
  google: text(),
  cloaking: integer({ mode: 'boolean' }),
  redirectWithQuery: integer('redirect_with_query', { mode: 'boolean' }),
  proxy: integer({ mode: 'boolean' }),
  password: text(),
  unsafe: integer({ mode: 'boolean' }),
  geo: text({ mode: 'json' }).$type<Link['geo']>(),
  normalizedUrl: text('normalized_url').notNull(),
  effectiveExpiresAt: integer('effective_expires_at'),
}, table => [
  index('links_created_at_slug_idx').on(table.createdAt, table.slug),
  index('links_created_at_desc_slug_idx').on(sql`${table.createdAt} desc`, table.slug),
  index('links_normalized_url_idx').on(table.normalizedUrl),
  index('links_id_idx').on(table.id),
])

export const tags = sqliteTable('tags', {
  name: text().primaryKey(),
})

export const linkTags = sqliteTable('link_tags', {
  linkSlug: text('link_slug').notNull().references(() => links.slug, { onDelete: 'cascade' }),
  tagName: text('tag_name').notNull().references(() => tags.name, { onDelete: 'cascade' }),
}, table => [
  primaryKey({ columns: [table.linkSlug, table.tagName] }),
  index('link_tags_tag_name_link_slug_idx').on(table.tagName, table.linkSlug),
])

export const linkTombstones = sqliteTable('link_tombstones', {
  slug: text().primaryKey(),
  deletedAt: integer('deleted_at').notNull(),
})

export const linkMigrationRuns = sqliteTable('link_migration_runs', {
  id: text().primaryKey(),
  expectedCursor: text('expected_cursor'),
  scanned: integer().notNull().default(0),
  inserted: integer().notNull().default(0),
  skipped: integer().notNull().default(0),
  expired: integer().notNull().default(0),
  force: integer({ mode: 'boolean' }).notNull(),
  status: text({ enum: ['running', 'completed'] }).notNull().default('running'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  index('link_migration_runs_status_updated_at_desc_created_at_desc_id_desc_idx').on(
    table.status,
    sql`${table.updatedAt} desc`,
    sql`${table.createdAt} desc`,
    sql`${table.id} desc`,
  ),
])

/**
 * Portfolio analytics is kept in this Worker-owned D1 beside the Sink tables.
 * The report worker reads these tables with bounded SQL so the declarations
 * stay useful for fresh local and remote migrations too.
 */
export const portfolioAnalyticsEvents = sqliteTable('portfolio_analytics_events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  sourceEventType: text('source_event_type'),
  path: text().notNull(),
  target: text(),
  progress: real(),
  activeMs: integer('active_ms'),
  mediaId: text('media_id'),
  mediaKind: text('media_kind'),
  playedMs: integer('played_ms'),
  durationMs: integer('duration_ms'),
  referrer: text(),
  campaignJson: text('campaign_json'),
  shortlinkSlug: text('shortlink_slug'),
  source: text().notNull().default('portfolio'),
  sourceEventId: text('source_event_id'),
  eventAt: integer('event_at').notNull(),
  receivedAt: integer('received_at').notNull(),
  visitorKey: text('visitor_key'),
  sessionKey: text('session_key'),
  sessionStartedAt: integer('session_started_at'),
  ip: text(),
  userAgent: text('user_agent'),
  country: text(),
  region: text(),
  city: text(),
  timezone: text(),
  latitude: real(),
  longitude: real(),
  colo: text(),
  isBot: integer('is_bot', { mode: 'boolean' }).notNull().default(false),
}, table => [
  index('idx_portfolio_analytics_events_at').on(table.eventAt),
  index('idx_portfolio_analytics_events_path').on(table.path, table.eventAt),
  index('idx_portfolio_analytics_events_type').on(table.eventType, table.eventAt),
  index('idx_portfolio_analytics_events_source').on(table.source, table.eventAt),
  index('idx_portfolio_analytics_events_session').on(table.sessionKey, table.eventAt),
])

export const portfolioAnalyticsDaily = sqliteTable('portfolio_analytics_daily', {
  day: text().notNull(),
  dimension: text().notNull(),
  dimensionValue: text('dimension_value').notNull(),
  source: text().notNull(),
  eventCount: integer('event_count').notNull().default(0),
  sessionCount: integer('session_count').notNull().default(0),
  sessionHll: text('session_hll').notNull().default(''),
  activeMs: integer('active_ms').notNull().default(0),
  visitorHll: text('visitor_hll').notNull().default(''),
  firstEventAt: integer('first_event_at'),
  lastEventAt: integer('last_event_at'),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.day, table.dimension, table.dimensionValue, table.source] }),
  index('idx_portfolio_analytics_daily_dimension').on(table.dimension, table.dimensionValue, table.day),
  index('idx_portfolio_analytics_daily_source').on(table.source, table.day),
])

export const portfolioAnalyticsState = sqliteTable('portfolio_analytics_state', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const gamingSessions = sqliteTable('gaming_sessions', {
  id: text().primaryKey(),
  playerKey: text('player_key'),
  sessionKey: text('session_key'),
  gameId: text('game_id').notNull(),
  mode: text(),
  sector: text(),
  transport: text().notNull(),
  entrypoint: text(),
  startedAt: integer('started_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  endedAt: integer('ended_at'),
  status: text().notNull().default('active'),
  durationSeconds: integer('duration_seconds'),
  verification: text().notNull().default('client_reported'),
  score: integer(),
  kills: integer(),
  deaths: integer(),
  assists: integer(),
  detailsJson: text('details_json'),
  matchId: text('match_id'),
  source: text().notNull().default('browser'),
}, table => [
  index('idx_gaming_sessions_started_at').on(table.startedAt),
  index('idx_gaming_sessions_game_mode').on(table.gameId, table.mode, table.startedAt),
  index('idx_gaming_sessions_player').on(table.playerKey, table.startedAt),
  index('idx_gaming_sessions_match').on(table.matchId, table.startedAt),
])

export const gamingMatches = sqliteTable('gaming_matches', {
  id: text().primaryKey(),
  gameId: text('game_id').notNull(),
  mode: text(),
  sector: text(),
  transport: text().notNull(),
  startedAt: integer('started_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  endedAt: integer('ended_at'),
  status: text().notNull().default('active'),
  verification: text().notNull().default('server_verified'),
  participantCount: integer('participant_count').notNull().default(0),
  humanCount: integer('human_count').notNull().default(0),
  botCount: integer('bot_count').notNull().default(0),
  resultJson: text('result_json'),
  source: text().notNull().default('exepert-room'),
}, table => [
  index('idx_gaming_matches_started_at').on(table.startedAt),
  index('idx_gaming_matches_game_mode').on(table.gameId, table.mode, table.startedAt),
])

export const gamingParticipants = sqliteTable('gaming_participants', {
  id: text().primaryKey(),
  matchId: text('match_id').notNull().references(() => gamingMatches.id, { onDelete: 'cascade' }),
  participantKey: text('participant_key'),
  playerKey: text('player_key'),
  linkedSessionId: text('linked_session_id'),
  bot: integer({ mode: 'boolean' }).notNull().default(false),
  kills: integer(),
  deaths: integer(),
  assists: integer(),
  score: integer(),
  detailsJson: text('details_json'),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
}, table => [
  uniqueIndex('idx_gaming_participant_match_key').on(table.matchId, table.participantKey),
  index('idx_gaming_participant_player').on(table.playerKey, table.startedAt),
])

export const gamingEvents = sqliteTable('gaming_events', {
  eventId: text('event_id').primaryKey(),
  sessionId: text('session_id').notNull(),
  matchId: text('match_id'),
  playerKey: text('player_key'),
  eventType: text('event_type').notNull(),
  eventAt: integer('event_at').notNull(),
  gameId: text('game_id').notNull(),
  mode: text(),
  sector: text(),
  action: text(),
  subject: text(),
  durationMs: integer('duration_ms'),
  activeMs: integer('active_ms'),
  score: integer(),
  kills: integer(),
  deaths: integer(),
  assists: integer(),
  distance: real(),
  fps: real(),
  rttMs: real('rtt_ms'),
  loadMs: real('load_ms'),
  detailsJson: text('details_json'),
  correlationDigest: text('correlation_digest'),
}, table => [
  index('idx_gaming_events_at').on(table.eventAt),
  index('idx_gaming_events_session').on(table.sessionId, table.eventAt),
  index('idx_gaming_events_match').on(table.matchId, table.eventAt),
  index('idx_gaming_events_type').on(table.eventType, table.eventAt),
])

export const gamingDaily = sqliteTable('gaming_daily', {
  day: text().notNull(),
  gameId: text('game_id').notNull(),
  mode: text().notNull().default(''),
  sector: text().notNull().default(''),
  transport: text().notNull().default(''),
  starts: integer().notNull().default(0),
  players: integer().notNull().default(0),
  completions: integer().notNull().default(0),
  playSeconds: integer('play_seconds').notNull().default(0),
  summaryJson: text('summary_json').notNull().default('{}'),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.day, table.gameId, table.mode, table.sector, table.transport] }),
  index('idx_gaming_daily_game_day').on(table.gameId, table.day),
])

export const gamingState = sqliteTable('gaming_state', {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const cloudflareObservabilitySnapshots = sqliteTable('cloudflare_observability_snapshots', {
  snapshotId: text('snapshot_id').primaryKey(),
  scope: text().notNull(),
  capturedAt: integer('captured_at').notNull(),
  fromAt: text('from_at').notNull(),
  toAt: text('to_at').notNull(),
  status: text().notNull(),
  reportJson: text('report_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [
  index('idx_cloudflare_observability_snapshots_scope_time').on(table.scope, table.capturedAt),
])

export const cloudflareObservabilityDaily = sqliteTable('cloudflare_observability_daily', {
  day: text().notNull(),
  scope: text().notNull(),
  metricKey: text('metric_key').notNull(),
  resourceId: text('resource_id').notNull().default(''),
  unit: text().notNull(),
  value: real(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  primaryKey({ columns: [table.day, table.scope, table.metricKey, table.resourceId] }),
  index('idx_cloudflare_observability_daily_scope_day').on(table.scope, table.day),
  index('idx_cloudflare_observability_daily_metric').on(table.metricKey, table.day),
])
