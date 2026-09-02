-- Migration: add the `session_type` column to an existing `sessions` table.
--
-- Fresh installs get this from schema.sql; run this only against a database
-- that predates the column.
--
--   wrangler d1 execute wsrs-notes --local  --file=migrations/2026-09-02-session-type.sql
--   wrangler d1 execute wsrs-notes --remote --file=migrations/2026-09-02-session-type.sql

ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'tbc';
-- values: tbc | listening | learning
