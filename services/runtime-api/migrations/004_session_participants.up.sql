-- Pre-release destructive cutover: no existing session snapshot has the
-- authoritative seat metadata required by ADR-059. Dependent rows are removed
-- by their existing ON DELETE CASCADE foreign keys; immutable game_bundles are
-- intentionally retained.
DELETE FROM game_sessions;

ALTER TABLE game_sessions
  DROP COLUMN player_id,
  ADD COLUMN participants JSONB NOT NULL;
