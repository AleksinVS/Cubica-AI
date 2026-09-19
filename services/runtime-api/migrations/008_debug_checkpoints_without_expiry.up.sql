ALTER TABLE debug_session_checkpoints
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE debug_session_checkpoints
  DROP CONSTRAINT IF EXISTS debug_session_checkpoints_check;

DROP INDEX IF EXISTS debug_session_checkpoints_source_expiry_idx;
DROP INDEX IF EXISTS debug_session_checkpoints_expiry_idx;

CREATE INDEX IF NOT EXISTS debug_session_checkpoints_source_created_idx
  ON debug_session_checkpoints (source_session_id, created_at DESC);
