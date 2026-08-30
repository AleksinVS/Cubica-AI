-- Destructive rollback for disposable development/test databases only.
DROP TABLE IF EXISTS session_events;
DROP TABLE IF EXISTS command_receipts;
DROP TABLE IF EXISTS session_principals;

DROP INDEX IF EXISTS game_sessions_live_idx;
DROP INDEX IF EXISTS game_sessions_bundle_hash_idx;
ALTER TABLE game_sessions
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS bundle_hash;

DROP TABLE IF EXISTS game_bundles;
