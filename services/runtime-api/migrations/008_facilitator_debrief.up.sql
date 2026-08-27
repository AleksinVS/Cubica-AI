-- Session-owned facilitator debrief attempts accepted by ADR-104.
-- The exact public journal remains in session_events; this table stores only
-- its hash and the rest of the bounded provider audit.
CREATE TABLE facilitator_debrief_attempts (
  run_id TEXT PRIMARY KEY CHECK (run_id ~ '^debrief_[A-Za-z0-9_-]{8,128}$'),
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
  expected_state_version BIGINT NOT NULL CHECK (expected_state_version >= 0),
  through_event_sequence BIGINT NOT NULL CHECK (through_event_sequence >= 0),
  journal_sha256 TEXT NOT NULL CHECK (journal_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  provider TEXT NOT NULL CHECK (provider = 'z.ai'),
  endpoint TEXT NOT NULL CHECK (endpoint = 'https://api.z.ai/api/paas/v4/chat/completions'),
  model TEXT NOT NULL CHECK (model = 'glm-4.7'),
  prompt_version TEXT NOT NULL CHECK (prompt_version = 'facilitator-debrief-ru-v1'),
  system_prompt TEXT NOT NULL CHECK (octet_length(system_prompt) BETWEEN 1 AND 32768),
  system_prompt_sha256 TEXT NOT NULL CHECK (system_prompt_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  provider_parameters JSONB NOT NULL CHECK (octet_length(provider_parameters::text) <= 16384),
  request_body_sha256 TEXT NOT NULL CHECK (request_body_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  -- Oversized rejected requests are still auditable, so the measured size is
  -- not constrained to the provider admission limit.
  request_bytes BIGINT NOT NULL CHECK (request_bytes >= 1),
  -- Provider input retained without duplicated public-journal bytes.
  input_snapshot_without_journal JSONB NOT NULL,
  provider_request_id TEXT CHECK (
    provider_request_id IS NULL OR length(provider_request_id) BETWEEN 1 AND 256
  ),
  provider_status INTEGER CHECK (
    provider_status IS NULL OR provider_status BETWEEN 100 AND 599
  ),
  provider_usage JSONB CHECK (
    provider_usage IS NULL OR octet_length(provider_usage::text) <= 524288
  ),
  response_bytes INTEGER CHECK (
    response_bytes IS NULL OR response_bytes BETWEEN 0 AND 524288
  ),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 3600000),
  raw_response_utf8 TEXT CHECK (
    raw_response_utf8 IS NULL OR octet_length(raw_response_utf8) <= 524288
  ),
  draft JSONB CHECK (draft IS NULL OR octet_length(draft::text) <= 524288),
  error JSONB CHECK (error IS NULL OR octet_length(error::text) <= 4096),
  requested_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  CHECK (
    (status = 'generating' AND completed_at IS NULL AND draft IS NULL AND error IS NULL)
    OR
    (status = 'ready' AND completed_at IS NOT NULL AND draft IS NOT NULL AND error IS NULL)
    OR
    (status = 'failed' AND completed_at IS NOT NULL AND draft IS NULL AND error IS NOT NULL)
  )
);

CREATE UNIQUE INDEX facilitator_debrief_one_generating_per_session_idx
  ON facilitator_debrief_attempts (session_id)
  WHERE status = 'generating';

CREATE UNIQUE INDEX facilitator_debrief_one_ready_per_session_idx
  ON facilitator_debrief_attempts (session_id)
  WHERE status = 'ready';

CREATE INDEX facilitator_debrief_session_requested_idx
  ON facilitator_debrief_attempts (session_id, requested_at DESC);
