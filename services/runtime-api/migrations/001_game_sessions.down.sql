-- This rollback destroys persisted sessions and is therefore intended only for
-- disposable development/test databases or an explicitly approved rollback.
DROP TABLE IF EXISTS game_sessions;
