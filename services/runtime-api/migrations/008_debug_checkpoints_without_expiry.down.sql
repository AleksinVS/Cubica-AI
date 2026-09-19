DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM debug_session_checkpoints WHERE expires_at IS NULL) THEN
    RAISE EXCEPTION 'Cannot restore checkpoint expiry constraint while non-expiring checkpoints exist';
  END IF;
END $$;

ALTER TABLE debug_session_checkpoints
  ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE debug_session_checkpoints
  ADD CONSTRAINT debug_session_checkpoints_check CHECK (expires_at > created_at);

DROP INDEX IF EXISTS debug_session_checkpoints_source_created_idx;
CREATE INDEX IF NOT EXISTS debug_session_checkpoints_source_expiry_idx
  ON debug_session_checkpoints (source_session_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS debug_session_checkpoints_expiry_idx
  ON debug_session_checkpoints (expires_at);
