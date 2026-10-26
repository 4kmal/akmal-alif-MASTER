import type { Link } from '../../shared/schemas/link'
import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
