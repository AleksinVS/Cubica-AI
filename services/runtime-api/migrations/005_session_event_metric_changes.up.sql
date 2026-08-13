-- Optional ADR-092 public metric deltas carried by durable public events.
ALTER TABLE session_events
  ADD COLUMN IF NOT EXISTS metric_changes JSONB;

ALTER TABLE session_events
  ADD CONSTRAINT session_events_metric_changes_shape_check CHECK (
    metric_changes IS NULL OR (
      jsonb_typeof(metric_changes) = 'array' AND
      jsonb_array_length(metric_changes) <= 256
    )
  );
