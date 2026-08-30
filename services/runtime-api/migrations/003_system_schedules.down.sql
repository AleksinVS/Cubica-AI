-- Destructive rollback for disposable development/test databases only.
DROP TABLE IF EXISTS system_schedules;

-- System receipts cannot be represented by the older UUID-only principal
-- schema. Remove them in foreign-key order before restoring that schema.
DELETE FROM session_events
WHERE principal_id LIKE 'system-scheduler:%';
DELETE FROM command_receipts
WHERE principal_id LIKE 'system-scheduler:%';
DELETE FROM session_principals
WHERE principal_kind = 'system';

ALTER TABLE command_receipts
  DROP CONSTRAINT IF EXISTS command_receipts_session_principal_fkey;
ALTER TABLE session_events
  DROP CONSTRAINT IF EXISTS session_events_session_principal_fkey;
ALTER TABLE session_principals
  DROP CONSTRAINT IF EXISTS session_principals_auth_shape_check;

ALTER TABLE session_principals
  ALTER COLUMN principal_id TYPE UUID USING principal_id::uuid,
  ALTER COLUMN credential_sha256 SET NOT NULL;
ALTER TABLE command_receipts
  ALTER COLUMN principal_id TYPE UUID USING principal_id::uuid;
ALTER TABLE session_events
  ALTER COLUMN principal_id TYPE UUID USING principal_id::uuid;

ALTER TABLE command_receipts
  ADD CONSTRAINT command_receipts_session_id_principal_id_fkey
  FOREIGN KEY (session_id, principal_id)
  REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE;
ALTER TABLE session_events
  ADD CONSTRAINT session_events_session_id_principal_id_fkey
  FOREIGN KEY (session_id, principal_id)
  REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE;

ALTER TABLE game_sessions
  DROP CONSTRAINT IF EXISTS game_sessions_id_bundle_hash_key;
