DROP INDEX IF EXISTS session_principals_pending_recovery_idx;

ALTER TABLE session_principals
  DROP CONSTRAINT IF EXISTS session_principals_recovery_token_check;

ALTER TABLE session_principals
  DROP COLUMN IF EXISTS recovery_token_expires_at;

ALTER TABLE session_principals
  DROP COLUMN IF EXISTS recovery_token_sha256;
