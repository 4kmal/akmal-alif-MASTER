PRAGMA foreign_keys = ON;

-- Audit metadata is intentionally separate from revision snapshots.  It records
-- who changed which studio entity and the resulting state without copying
-- article bodies, media bytes, bearer credentials, or other secrets.
CREATE TABLE IF NOT EXISTS blog_audit_records (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_audit_records_entity_created
  ON blog_audit_records (entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_audit_records_actor_created
  ON blog_audit_records (actor, created_at DESC);
