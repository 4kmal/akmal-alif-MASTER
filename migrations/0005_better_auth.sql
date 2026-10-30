PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_account_user ON auth_account (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_account_provider_account ON auth_account (provider_id, account_id);

CREATE TABLE IF NOT EXISTS auth_session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_session_user ON auth_session (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_expires ON auth_session (expires_at);

CREATE TABLE IF NOT EXISTS auth_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_verification_identifier ON auth_verification (identifier);
CREATE INDEX IF NOT EXISTS idx_auth_verification_expires ON auth_verification (expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limit (
  id TEXT PRIMARY KEY NOT NULL,
  key TEXT UNIQUE NOT NULL,
  count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);
