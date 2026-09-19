ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS debug_paused BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'debug_paused_requires_preview_source'
      AND conrelid = 'game_sessions'::regclass
  ) THEN
    ALTER TABLE game_sessions
      ADD CONSTRAINT debug_paused_requires_preview_source
      CHECK (NOT debug_paused OR content_source_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS debug_session_checkpoints (
  checkpoint_id UUID PRIMARY KEY,
  source_session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  source_state_version BIGINT NOT NULL CHECK (source_state_version >= 0),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS debug_session_checkpoints_source_expiry_idx
  ON debug_session_checkpoints (source_session_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS debug_session_checkpoints_expiry_idx
  ON debug_session_checkpoints (expires_at);
