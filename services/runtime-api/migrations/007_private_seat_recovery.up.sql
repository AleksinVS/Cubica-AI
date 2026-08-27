-- A joined guest keeps its durable credential until one pending recovery
-- capability is successfully consumed. Only digests cross the store boundary.
ALTER TABLE session_principals
  ADD COLUMN recovery_token_sha256 TEXT;

ALTER TABLE session_principals
  ADD COLUMN recovery_token_expires_at TIMESTAMPTZ;

ALTER TABLE session_principals
  ADD CONSTRAINT session_principals_recovery_token_check CHECK (
    (recovery_token_sha256 IS NULL AND recovery_token_expires_at IS NULL)
    OR (
      recovery_token_sha256 ~ '^[a-f0-9]{64}$'
      AND recovery_token_expires_at IS NOT NULL
      AND credential_expires_at IS NULL
      AND principal_kind = 'participant'
      AND session_role = 'player'
    )
  );

CREATE UNIQUE INDEX session_principals_pending_recovery_idx
  ON session_principals (session_id, recovery_token_sha256)
  WHERE recovery_token_sha256 IS NOT NULL;
