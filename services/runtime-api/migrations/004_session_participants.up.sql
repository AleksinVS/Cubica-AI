-- Pre-release destructive cutover: no existing session snapshot has the
-- authoritative seat metadata required by ADR-059. Dependent rows are removed
-- by their existing ON DELETE CASCADE foreign keys; immutable game_bundles are
-- intentionally retained.
DELETE FROM game_sessions;

CREATE FUNCTION cubica_session_participants_are_valid(value JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) = 0 THEN FALSE
    ELSE
      NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(value) AS participant(item)
        WHERE jsonb_typeof(item) <> 'object'
          OR NOT (item ?& ARRAY['seatId', 'playerId', 'kind', 'joinState'])
          OR item - ARRAY['seatId', 'playerId', 'kind', 'joinState'] <> '{}'::jsonb
          OR jsonb_typeof(item->'seatId') <> 'string'
          OR item->>'seatId' = ''
          OR jsonb_typeof(item->'playerId') <> 'string'
          OR item->>'playerId' = ''
          OR item->>'kind' NOT IN ('human', 'agent')
          OR item->>'joinState' <> 'local'
      )
      AND jsonb_array_length(value) = (
        SELECT COUNT(DISTINCT item->>'seatId') FROM jsonb_array_elements(value) AS participant(item)
      )
      AND jsonb_array_length(value) = (
        SELECT COUNT(DISTINCT item->>'playerId') FROM jsonb_array_elements(value) AS participant(item)
      )
  END;
$$;

ALTER TABLE game_sessions
  ADD COLUMN participants JSONB NOT NULL,
  ADD CONSTRAINT game_sessions_participants_array_check CHECK (
    jsonb_typeof(participants) = 'array' AND jsonb_array_length(participants) > 0
  ),
  ADD CONSTRAINT game_sessions_participants_shape_check CHECK (
    cubica_session_participants_are_valid(participants)
  );
