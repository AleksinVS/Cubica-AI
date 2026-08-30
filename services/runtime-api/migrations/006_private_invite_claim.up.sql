-- A non-null expiry marks a principal digest as an unclaimed one-time invite.
-- Durable session credentials and internal system principals keep it null.
ALTER TABLE session_principals
  ADD COLUMN credential_expires_at TIMESTAMPTZ;

ALTER TABLE session_principals
  ADD CONSTRAINT session_principals_invite_expiry_check CHECK (
    credential_expires_at IS NULL
    OR (
      principal_kind = 'participant'
      AND session_role = 'player'
      AND credential_sha256 ~ '^[a-f0-9]{64}$'
    )
  );

CREATE INDEX session_principals_pending_invite_idx
  ON session_principals (session_id, credential_sha256, credential_expires_at)
  WHERE credential_expires_at IS NOT NULL;
