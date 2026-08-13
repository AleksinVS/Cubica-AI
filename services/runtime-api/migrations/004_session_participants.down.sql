-- Destructive rollback for disposable pre-release development/test databases
-- only. Sessions created with required participants cannot be made compatible
-- with the older shape and are intentionally removed; game_bundles remain.
DELETE FROM game_sessions;

ALTER TABLE game_sessions
  DROP CONSTRAINT IF EXISTS game_sessions_participants_array_check,
  DROP COLUMN IF EXISTS participants,
  ADD COLUMN player_id TEXT;
