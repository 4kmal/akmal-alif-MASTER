PRAGMA foreign_keys = ON;

-- Portfolio-owned analytics data lives in the new admin D1 database beside Sink tables.
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
  session_hll TEXT NOT NULL DEFAULT '',
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

-- Gaming data is kept out of portfolio_analytics_events so game results and
-- client telemetry cannot change website counts or conversion reports.
-- Event detail is bounded and contains no callsigns, room codes, IPs, input
-- frames, positions, or browser identity cookies.
CREATE TABLE IF NOT EXISTS gaming_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  player_key TEXT,
  session_key TEXT,
  game_id TEXT NOT NULL,
  mode TEXT,
  sector TEXT,
  transport TEXT NOT NULL,
  entrypoint TEXT,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  duration_seconds INTEGER,
  verification TEXT NOT NULL DEFAULT 'client_reported' CHECK (verification IN ('server_verified', 'client_reported')),
  score INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  details_json TEXT,
  match_id TEXT,
  source TEXT NOT NULL DEFAULT 'browser'
);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_started_at ON gaming_sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_game_mode ON gaming_sessions (game_id, mode, started_at);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_player ON gaming_sessions (player_key, started_at);
CREATE INDEX IF NOT EXISTS idx_gaming_sessions_match ON gaming_sessions (match_id, started_at);

CREATE TABLE IF NOT EXISTS gaming_matches (
  id TEXT PRIMARY KEY NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT,
  sector TEXT,
  transport TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  verification TEXT NOT NULL DEFAULT 'server_verified' CHECK (verification = 'server_verified'),
  participant_count INTEGER NOT NULL DEFAULT 0,
  human_count INTEGER NOT NULL DEFAULT 0,
  bot_count INTEGER NOT NULL DEFAULT 0,
  result_json TEXT,
  source TEXT NOT NULL DEFAULT 'exepert-room'
);
CREATE INDEX IF NOT EXISTS idx_gaming_matches_started_at ON gaming_matches (started_at);
CREATE INDEX IF NOT EXISTS idx_gaming_matches_game_mode ON gaming_matches (game_id, mode, started_at);

CREATE TABLE IF NOT EXISTS gaming_participants (
  id TEXT PRIMARY KEY NOT NULL,
  match_id TEXT NOT NULL,
  participant_key TEXT,
  player_key TEXT,
  linked_session_id TEXT,
  bot INTEGER NOT NULL DEFAULT 0 CHECK (bot IN (0, 1)),
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  score INTEGER,
  details_json TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  FOREIGN KEY (match_id) REFERENCES gaming_matches(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gaming_participant_match_key ON gaming_participants (match_id, participant_key);
CREATE INDEX IF NOT EXISTS idx_gaming_participant_player ON gaming_participants (player_key, started_at);

CREATE TABLE IF NOT EXISTS gaming_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  match_id TEXT,
  player_key TEXT,
  event_type TEXT NOT NULL,
  event_at INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT,
  sector TEXT,
  action TEXT,
  subject TEXT,
  duration_ms INTEGER,
  active_ms INTEGER,
  score INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  distance REAL,
  fps REAL,
  rtt_ms REAL,
  load_ms REAL,
  details_json TEXT,
  correlation_digest TEXT
);
CREATE INDEX IF NOT EXISTS idx_gaming_events_at ON gaming_events (event_at);
CREATE INDEX IF NOT EXISTS idx_gaming_events_session ON gaming_events (session_id, event_at);
CREATE INDEX IF NOT EXISTS idx_gaming_events_match ON gaming_events (match_id, event_at);
CREATE INDEX IF NOT EXISTS idx_gaming_events_type ON gaming_events (event_type, event_at);

CREATE TABLE IF NOT EXISTS gaming_daily (
  day TEXT NOT NULL,
  game_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT '',
  sector TEXT NOT NULL DEFAULT '',
  transport TEXT NOT NULL DEFAULT '',
  starts INTEGER NOT NULL DEFAULT 0,
  players INTEGER NOT NULL DEFAULT 0,
  completions INTEGER NOT NULL DEFAULT 0,
  play_seconds INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, game_id, mode, sector, transport)
);
CREATE INDEX IF NOT EXISTS idx_gaming_daily_game_day ON gaming_daily (game_id, day);

CREATE TABLE IF NOT EXISTS gaming_state (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
