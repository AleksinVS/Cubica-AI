ALTER TABLE session_events
  DROP CONSTRAINT IF EXISTS session_events_metric_changes_shape_check;
ALTER TABLE session_events
  DROP COLUMN IF EXISTS metric_changes;
