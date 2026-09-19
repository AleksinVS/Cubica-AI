DROP TABLE IF EXISTS debug_session_checkpoints;
ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS debug_paused_requires_preview_source;
ALTER TABLE game_sessions DROP COLUMN IF EXISTS debug_paused;
