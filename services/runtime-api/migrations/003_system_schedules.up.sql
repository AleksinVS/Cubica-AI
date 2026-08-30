-- Protected, bundle-pinned system schedules for delayed Game Intents.
--
-- The scheduler principal is durable for receipt/event foreign keys but has no
-- credential. Authority comes only from the internal repository method; a
-- caller cannot obtain it by presenting a `sys_` command id.

ALTER TABLE command_receipts
  DROP CONSTRAINT IF EXISTS command_receipts_session_id_principal_id_fkey;
ALTER TABLE session_events
  DROP CONSTRAINT IF EXISTS session_events_session_id_principal_id_fkey;

-- Public contracts allow opaque string principal ids. The original UUID-only
-- storage predated the stable `system-scheduler:<sessionId>` identity.
ALTER TABLE session_principals
  ALTER COLUMN principal_id TYPE TEXT USING principal_id::text,
  ALTER COLUMN credential_sha256 DROP NOT NULL;
ALTER TABLE command_receipts
  ALTER COLUMN principal_id TYPE TEXT USING principal_id::text;
ALTER TABLE session_events
  ALTER COLUMN principal_id TYPE TEXT USING principal_id::text;

ALTER TABLE session_principals
  ADD CONSTRAINT session_principals_auth_shape_check CHECK (
    (principal_kind = 'system' AND credential_sha256 IS NULL)
    OR
    (principal_kind <> 'system' AND credential_sha256 ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE command_receipts
  ADD CONSTRAINT command_receipts_session_principal_fkey
  FOREIGN KEY (session_id, principal_id)
  REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE;
ALTER TABLE session_events
  ADD CONSTRAINT session_events_session_principal_fkey
  FOREIGN KEY (session_id, principal_id)
  REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE;

-- A composite key lets the database prove that a schedule's immutable bundle
-- is the same one pinned by its owning session.
ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_id_bundle_hash_key UNIQUE (id, bundle_hash);

CREATE TABLE IF NOT EXISTS system_schedules (
  schedule_id TEXT NOT NULL CHECK (schedule_id ~ '^[A-Za-z0-9_-]{22,128}$'),
  session_id UUID NOT NULL,
  bundle_hash TEXT NOT NULL,
  action_id TEXT NOT NULL CHECK (length(action_id) > 0),
  params JSONB NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  definition_hash TEXT NOT NULL CHECK (definition_hash ~ '^sha256:[a-f0-9]{64}$'),
  trigger JSONB NOT NULL CHECK (jsonb_typeof(trigger) = 'object'),
  false_policy TEXT NOT NULL CHECK (false_policy IN ('defer', 'skip')),
  max_occurrences INTEGER NOT NULL CHECK (max_occurrences BETWEEN 1 AND 64),
  next_occurrence INTEGER NOT NULL CHECK (next_occurrence >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'cancelled', 'completed')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, schedule_id),
  FOREIGN KEY (session_id, bundle_hash)
    REFERENCES game_sessions(id, bundle_hash) ON DELETE CASCADE,
  FOREIGN KEY (bundle_hash)
    REFERENCES game_bundles(bundle_hash),
  CHECK (
    (status = 'pending' AND next_occurrence <= max_occurrences)
    OR (status = 'completed' AND next_occurrence = max_occurrences + 1)
    OR (status = 'cancelled' AND next_occurrence <= max_occurrences + 1)
  )
);

CREATE INDEX IF NOT EXISTS system_schedules_pending_idx
  ON system_schedules (session_id, status, next_occurrence)
  WHERE status = 'pending';
