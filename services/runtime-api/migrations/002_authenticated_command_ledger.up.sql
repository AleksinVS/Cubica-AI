-- Immutable rules, server-authenticated session principals and idempotent
-- command receipts required by the typed transactional runtime cutover.
CREATE TABLE IF NOT EXISTS game_bundles (
  bundle_hash TEXT PRIMARY KEY CHECK (bundle_hash ~ '^cubica-bundle-v1:sha256:[a-f0-9]{64}$'),
  game_id TEXT NOT NULL,
  -- Exact canonical UTF-8 bytes are the replay authority. JSONB below is only
  -- a parsed inspection/index copy and may not preserve those bytes.
  canonical_bytes BYTEA NOT NULL,
  canonical_bundle JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE game_sessions
  ADD COLUMN IF NOT EXISTS bundle_hash TEXT REFERENCES game_bundles(bundle_hash),
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Legacy snapshots do not contain the exact rules or a credential that can be
-- verified. They are retained for explicit export/debugging but cannot be
-- opened as live sessions and are never assigned fabricated bundle hashes.
UPDATE game_sessions
SET archived_at = CURRENT_TIMESTAMP
WHERE bundle_hash IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS game_sessions_bundle_hash_idx ON game_sessions (bundle_hash);
CREATE INDEX IF NOT EXISTS game_sessions_live_idx
  ON game_sessions (id)
  WHERE archived_at IS NULL AND bundle_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS session_principals (
  principal_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  principal_kind TEXT NOT NULL CHECK (
    principal_kind IN ('local-controller', 'participant', 'facilitator', 'agent', 'system')
  ),
  session_role TEXT NOT NULL CHECK (
    session_role IN ('player', 'facilitator', 'assistant', 'observer')
  ),
  actor_scope JSONB NOT NULL,
  credential_sha256 TEXT NOT NULL CHECK (credential_sha256 ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, principal_id),
  UNIQUE (session_id, credential_sha256)
);

CREATE INDEX IF NOT EXISTS session_principals_credential_idx
  ON session_principals (session_id, credential_sha256);

CREATE TABLE IF NOT EXISTS command_receipts (
  receipt_id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  principal_id UUID NOT NULL,
  command_id TEXT NOT NULL CHECK (command_id ~ '^(cli_[A-Za-z0-9_-]{22}|sys_[A-Za-z0-9_-]{43})$'),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  action_id TEXT NOT NULL,
  actor_id TEXT,
  bundle_hash TEXT NOT NULL REFERENCES game_bundles(bundle_hash),
  definition_hash TEXT NOT NULL CHECK (definition_hash ~ '^sha256:[a-f0-9]{64}$'),
  plan_hash TEXT CHECK (plan_hash IS NULL OR plan_hash ~ '^sha256:[a-f0-9]{64}$'),
  state_version_before BIGINT NOT NULL CHECK (state_version_before >= 0),
  state_version_after BIGINT NOT NULL CHECK (state_version_after >= state_version_before),
  status TEXT NOT NULL CHECK (status IN ('applied', 'rejected')),
  event_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_receipt JSONB NOT NULL,
  command_result JSONB CHECK (
    command_result IS NULL OR octet_length(command_result::text) <= 65536
  ),
  audit JSONB NOT NULL CHECK (
    -- The largest Mechanics profile retains at most 8 MiB of step audit;
    -- 9 MiB leaves bounded room for receipt metadata and JSONB spacing.
    octet_length(audit::text) <= 9437184
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, principal_id, command_id),
  FOREIGN KEY (session_id, principal_id)
    REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS command_receipts_session_created_idx
  ON command_receipts (session_id, created_at);

CREATE TABLE IF NOT EXISTS session_events (
  event_id TEXT PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  receipt_id UUID NOT NULL REFERENCES command_receipts(receipt_id) ON DELETE CASCADE,
  command_id TEXT NOT NULL CHECK (command_id ~ '^(cli_[A-Za-z0-9_-]{22}|sys_[A-Za-z0-9_-]{43})$'),
  action_id TEXT NOT NULL,
  principal_id UUID NOT NULL,
  actor_id TEXT,
  audience TEXT NOT NULL CHECK (audience IN ('public', 'actor', 'server')),
  event_type TEXT NOT NULL,
  summary JSONB NOT NULL,
  event_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, sequence),
  FOREIGN KEY (session_id, principal_id)
    REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_events_session_sequence_idx
  ON session_events (session_id, sequence);
