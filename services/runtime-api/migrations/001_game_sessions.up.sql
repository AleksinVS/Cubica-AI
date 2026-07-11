-- Durable session snapshots defined by ADR-005.
-- `state` contains the complete current runtime state. `history` is reserved as
-- a separate sliding-window JSONB column for AI chat history when that boundary
-- is enabled; current deterministic games keep their history inside `state`.
CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY,
  game_id TEXT NOT NULL,
  player_id TEXT,
  content_source_id TEXT,
  session_role TEXT CHECK (session_role IN ('player', 'facilitator', 'assistant', 'observer')),
  state JSONB NOT NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  state_version BIGINT NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  last_event_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS game_sessions_game_id_idx ON game_sessions (game_id);
CREATE INDEX IF NOT EXISTS game_sessions_updated_at_idx ON game_sessions (updated_at);
