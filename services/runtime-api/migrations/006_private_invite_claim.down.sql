DROP INDEX IF EXISTS session_principals_pending_invite_idx;

ALTER TABLE session_principals
  DROP CONSTRAINT IF EXISTS session_principals_invite_expiry_check,
  DROP COLUMN IF EXISTS credential_expires_at;
