-- WSRS Listening Sessions Notes — D1 schema
-- Apply with:  wrangler d1 execute wsrs-notes --file=schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,          -- uuid v4, generated server-side
  title         TEXT NOT NULL DEFAULT '',
  date_text     TEXT NOT NULL DEFAULT '',  -- free text: '', 'March 2026', '14 March 2026'
  date_status   TEXT NOT NULL DEFAULT 'none',
                                           -- none | rough | pencilled | confirmed
  status        TEXT NOT NULL DEFAULT 'idea',
                                           -- idea | firming_up | well_formed | ready | archived
  notes_md      TEXT NOT NULL DEFAULT '',
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL,             -- ISO 8601 UTC
  updated_by    TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

-- Login rate limiting: one row per (ip, window) bucket.
CREATE TABLE IF NOT EXISTS login_attempts (
  ip            TEXT NOT NULL,
  window_start  INTEGER NOT NULL,          -- unix seconds, floored to the 15-min window
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);
