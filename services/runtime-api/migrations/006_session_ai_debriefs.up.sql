-- Separate facilitator-only AI-derived artifacts. Gameplay state, event ledger
-- and command receipts remain untouched by this lifecycle (ADR-104).
CREATE TABLE IF NOT EXISTS session_ai_debriefs (
  artifact_id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  principal_id TEXT NOT NULL,
  game_id TEXT NOT NULL CHECK (game_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  status TEXT NOT NULL CHECK (status IN ('calling_provider', 'draft', 'confirmed', 'failed')),
  through_event_sequence BIGINT NOT NULL CHECK (through_event_sequence >= 0),
  journal_sha256 TEXT NOT NULL CHECK (journal_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  methodology_version TEXT NOT NULL CHECK (methodology_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  prompt_version TEXT NOT NULL CHECK (prompt_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  provider TEXT NOT NULL CHECK (provider = 'openai'),
  model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 128),
  input_document JSONB NOT NULL,
  input_canonical TEXT NOT NULL CHECK (octet_length(input_canonical) <= 1048576),
  input_sha256 TEXT NOT NULL CHECK (input_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  output_sections JSONB CHECK (output_sections IS NULL OR octet_length(output_sections::text) <= 262144),
  output_sha256 TEXT CHECK (output_sha256 IS NULL OR output_sha256 ~ '^sha256:[a-f0-9]{64}$'),
  usage JSONB,
  error_code TEXT CHECK (error_code IS NULL OR error_code IN (
    'provider_timeout', 'provider_rate_limited', 'provider_rejected',
    'provider_unavailable', 'provider_malformed', 'provider_schema_invalid',
    'provider_false_evidence', 'provider_unknown'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMPTZ,
  UNIQUE (session_id, request_id),
  FOREIGN KEY (session_id, principal_id)
    REFERENCES session_principals(session_id, principal_id) ON DELETE CASCADE,
  CHECK (
    (status = 'calling_provider' AND output_sections IS NULL AND output_sha256 IS NULL
      AND usage IS NULL AND error_code IS NULL AND confirmed_at IS NULL)
    OR (status = 'failed' AND output_sections IS NULL AND output_sha256 IS NULL
      AND usage IS NULL AND error_code IS NOT NULL AND confirmed_at IS NULL)
    OR (status = 'draft' AND output_sections IS NOT NULL AND output_sha256 IS NOT NULL
      AND usage IS NOT NULL AND error_code IS NULL AND confirmed_at IS NULL)
    OR (status = 'confirmed' AND output_sections IS NOT NULL AND output_sha256 IS NOT NULL
      AND usage IS NOT NULL AND error_code IS NULL AND confirmed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS session_ai_debriefs_session_created_idx
  ON session_ai_debriefs (session_id, created_at DESC, artifact_id DESC);
