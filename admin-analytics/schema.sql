PRAGMA foreign_keys = ON;

-- Portfolio-owned analytics data lives in the NEWadminD1 database beside Sink tables.
-- Raw rows retain trusted request context for 90 days; daily summaries retain 13 months.
CREATE TABLE IF NOT EXISTS portfolio_analytics_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  source_event_type TEXT,
  path TEXT NOT NULL,
  target TEXT,
  progress REAL,
  active_ms INTEGER,
  media_id TEXT,
  media_kind TEXT,
  played_ms INTEGER,
  duration_ms INTEGER,
  referrer TEXT,
  campaign_json TEXT,
  shortlink_slug TEXT,
  source TEXT NOT NULL DEFAULT 'portfolio',
  source_event_id TEXT,
  event_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  visitor_key TEXT,
  session_key TEXT,
  session_started_at INTEGER,
  ip TEXT,
  user_agent TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  timezone TEXT,
  latitude REAL,
  longitude REAL,
  colo TEXT,
  is_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_bot IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_events_at
  ON portfolio_analytics_events (event_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_events_path
  ON portfolio_analytics_events (path, event_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_events_type
  ON portfolio_analytics_events (event_type, event_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_events_source
  ON portfolio_analytics_events (source, event_at);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_events_session
  ON portfolio_analytics_events (session_key, event_at);

CREATE TABLE IF NOT EXISTS portfolio_analytics_daily (
  day TEXT NOT NULL,
  dimension TEXT NOT NULL,
  dimension_value TEXT NOT NULL,
  source TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  session_count INTEGER NOT NULL DEFAULT 0,
  active_ms INTEGER NOT NULL DEFAULT 0,
  visitor_hll TEXT NOT NULL DEFAULT '',
  first_event_at INTEGER,
  last_event_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, dimension, dimension_value, source)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_daily_dimension
  ON portfolio_analytics_daily (dimension, dimension_value, day);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_daily_source
  ON portfolio_analytics_daily (source, day);

CREATE TABLE IF NOT EXISTS portfolio_analytics_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);