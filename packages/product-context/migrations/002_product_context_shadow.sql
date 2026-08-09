-- Isolated non-production storage for exact shadow conversations and outcomes.
--
-- The application role never owns objects and cannot bypass forced RLS. Exact
-- message bytes are immutable until a one-way tombstone clears them; shadow
-- runs use a closed lifecycle so an interrupted model call is never silently
-- retried with possibly changed authority or content.

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_app') THEN
    CREATE ROLE product_context_shadow_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_cleanup') THEN
    CREATE ROLE product_context_shadow_cleanup NOLOGIN;
  END IF;
END
$migration$;

ALTER ROLE product_context_shadow_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;
ALTER ROLE product_context_shadow_cleanup
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;

-- Deployment contract: the runtime LOGIN must separately receive membership
-- in product_context_shadow_app. This migration never grants it implicitly.

CREATE SCHEMA IF NOT EXISTS product_context_shadow;
REVOKE ALL ON SCHEMA product_context_shadow FROM PUBLIC;
GRANT USAGE ON SCHEMA product_context_shadow TO product_context_shadow_app;
GRANT USAGE ON SCHEMA product_context_shadow TO product_context_shadow_cleanup;

CREATE TABLE IF NOT EXISTS product_context_shadow.conversation_threads (
  thread_ref text PRIMARY KEY CHECK (thread_ref ~ '^cubica://'),
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  game_ref text NOT NULL CHECK (game_ref ~ '^cubica://game-project/[A-Za-z0-9._~-]+$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'tombstoned')),
  retained_until timestamptz NOT NULL,
  tombstoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_threads_owner_partition UNIQUE (thread_ref, owner_ref),
  CONSTRAINT conversation_threads_tombstone_ck CHECK (
    (status = 'active' AND tombstoned_at IS NULL) OR
    (status = 'tombstoned' AND tombstoned_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS product_context_shadow.conversation_messages (
  message_ref text PRIMARY KEY CHECK (message_ref ~ '^cubica://'),
  thread_ref text NOT NULL,
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  stable_turn_key text NOT NULL CHECK (length(stable_turn_key) BETWEEN 16 AND 200),
  sequence bigint NOT NULL CHECK (sequence > 0),
  actor text NOT NULL CHECK (actor IN ('user', 'agent')),
  revision text NOT NULL CHECK (revision ~ '^sha256:[a-f0-9]{64}$'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  content_bytes bytea,
  byte_length integer NOT NULL CHECK (byte_length >= 0),
  tombstone boolean NOT NULL DEFAULT false,
  retained_until timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_messages_thread_fk
    FOREIGN KEY (thread_ref, owner_ref)
    REFERENCES product_context_shadow.conversation_threads (thread_ref, owner_ref)
    ON DELETE CASCADE,
  CONSTRAINT conversation_messages_sequence_unique UNIQUE (thread_ref, owner_ref, sequence),
  CONSTRAINT conversation_messages_turn_actor_unique UNIQUE (thread_ref, owner_ref, stable_turn_key, actor),
  CONSTRAINT conversation_messages_owner_partition UNIQUE (message_ref, owner_ref),
  CONSTRAINT conversation_messages_content_ck CHECK (
    (NOT tombstone AND content_bytes IS NOT NULL AND deleted_at IS NULL AND octet_length(content_bytes) = byte_length) OR
    (tombstone AND content_bytes IS NULL AND deleted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS product_context_shadow.shadow_runs (
  run_id text PRIMARY KEY CHECK (run_id ~ '^shadowrun_[A-Za-z0-9_-]+$'),
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  thread_ref text NOT NULL,
  stable_turn_key text NOT NULL CHECK (length(stable_turn_key) BETWEEN 16 AND 200),
  authorization_revision text NOT NULL CHECK (authorization_revision ~ '^sha256:[a-f0-9]{64}$'),
  authorization_receipt jsonb NOT NULL CHECK (jsonb_typeof(authorization_receipt) = 'object'),
  user_message_ref text NOT NULL,
  user_message_revision text NOT NULL CHECK (user_message_revision ~ '^sha256:[a-f0-9]{64}$'),
  user_message_hash text NOT NULL CHECK (user_message_hash ~ '^sha256:[a-f0-9]{64}$'),
  agent_message_ref text NOT NULL,
  agent_message_revision text NOT NULL CHECK (agent_message_revision ~ '^sha256:[a-f0-9]{64}$'),
  agent_message_hash text NOT NULL CHECK (agent_message_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'calling_model', 'succeeded', 'denied', 'failed')),
  outcome_code text CHECK (outcome_code IN (
    'success', 'no_change', 'policy_denied', 'authorization_changed',
    'message_changed', 'message_deleted', 'retention_expired', 'gateway_timeout',
    'gateway_malformed', 'gateway_oversize', 'gateway_error', 'gateway_outcome_unknown'
  )),
  request_id text CHECK (request_id IS NULL OR request_id ~ '^modelreq_[A-Za-z0-9_-]+$'),
  result_payload jsonb,
  started_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  retained_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT shadow_runs_thread_fk
    FOREIGN KEY (thread_ref, owner_ref)
    REFERENCES product_context_shadow.conversation_threads (thread_ref, owner_ref)
    ON DELETE CASCADE,
  CONSTRAINT shadow_runs_user_message_fk
    FOREIGN KEY (user_message_ref, owner_ref)
    REFERENCES product_context_shadow.conversation_messages (message_ref, owner_ref),
  CONSTRAINT shadow_runs_agent_message_fk
    FOREIGN KEY (agent_message_ref, owner_ref)
    REFERENCES product_context_shadow.conversation_messages (message_ref, owner_ref),
  CONSTRAINT shadow_runs_stable_idempotency UNIQUE (owner_ref, stable_turn_key),
  CONSTRAINT shadow_runs_owner_partition UNIQUE (run_id, owner_ref),
  CONSTRAINT shadow_runs_terminal_ck CHECK (
    (status = 'pending' AND request_id IS NULL AND started_at IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'calling_model' AND request_id IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > started_at AND completed_at IS NULL AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'succeeded' AND request_id IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL AND outcome_code IN ('success', 'no_change') AND jsonb_typeof(result_payload) = 'object') OR
    (status IN ('denied', 'failed') AND lease_expires_at IS NULL AND completed_at IS NOT NULL AND outcome_code IS NOT NULL AND result_payload IS NULL)
  )
);

ALTER TABLE product_context_shadow.shadow_runs
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE product_context_shadow.shadow_runs
  DROP CONSTRAINT IF EXISTS shadow_runs_outcome_code_check,
  DROP CONSTRAINT IF EXISTS shadow_runs_terminal_ck;
ALTER TABLE product_context_shadow.shadow_runs
  ADD CONSTRAINT shadow_runs_outcome_code_check CHECK (outcome_code IN (
    'success', 'no_change', 'policy_denied', 'authorization_changed',
    'message_changed', 'message_deleted', 'retention_expired', 'gateway_timeout',
    'gateway_malformed', 'gateway_oversize', 'gateway_error', 'gateway_outcome_unknown'
  )),
  ADD CONSTRAINT shadow_runs_terminal_ck CHECK (
    (status = 'pending' AND request_id IS NULL AND started_at IS NULL AND lease_expires_at IS NULL AND completed_at IS NULL AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'calling_model' AND request_id IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > started_at AND completed_at IS NULL AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'succeeded' AND request_id IS NOT NULL AND started_at IS NOT NULL AND lease_expires_at IS NULL AND completed_at IS NOT NULL AND outcome_code IN ('success', 'no_change') AND jsonb_typeof(result_payload) = 'object') OR
    (status IN ('denied', 'failed') AND lease_expires_at IS NULL AND completed_at IS NOT NULL AND outcome_code IS NOT NULL AND result_payload IS NULL)
  );

CREATE TABLE IF NOT EXISTS product_context_shadow.shadow_metrics (
  metric_id text PRIMARY KEY CHECK (metric_id ~ '^metric_[A-Za-z0-9_-]+$'),
  run_id text NOT NULL,
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  request_id text CHECK (request_id IS NULL OR request_id ~ '^modelreq_[A-Za-z0-9_-]+$'),
  outcome text NOT NULL CHECK (outcome IN (
    'success', 'no_change', 'disabled', 'policy_denied',
    'authorization_changed', 'message_changed', 'message_deleted', 'retention_expired',
    'gateway_timeout', 'gateway_malformed', 'gateway_oversize', 'gateway_error',
    'gateway_outcome_unknown'
  )),
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  input_bytes integer NOT NULL CHECK (input_bytes >= 0),
  output_bytes integer NOT NULL CHECK (output_bytes >= 0),
  proposal_operation_count integer NOT NULL CHECK (proposal_operation_count BETWEEN 0 AND 20),
  authorization_revision text NOT NULL CHECK (authorization_revision ~ '^sha256:[a-f0-9]{64}$'),
  external_processing_policy_ref text NOT NULL,
  external_processing_policy_revision text NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT shadow_metrics_run_fk FOREIGN KEY (run_id, owner_ref) REFERENCES product_context_shadow.shadow_runs (run_id, owner_ref) ON DELETE CASCADE,
  CONSTRAINT shadow_metrics_one_per_run UNIQUE (run_id)
);

ALTER TABLE product_context_shadow.shadow_metrics
  DROP CONSTRAINT IF EXISTS shadow_metrics_outcome_check;
ALTER TABLE product_context_shadow.shadow_metrics
  ADD CONSTRAINT shadow_metrics_outcome_check CHECK (outcome IN (
    'success', 'no_change', 'disabled', 'policy_denied',
    'authorization_changed', 'message_changed', 'message_deleted', 'retention_expired',
    'gateway_timeout', 'gateway_malformed', 'gateway_oversize', 'gateway_error',
    'gateway_outcome_unknown'
  ));

CREATE OR REPLACE FUNCTION product_context_shadow.enforce_thread_contract()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, product_context_shadow
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'active' THEN
      RAISE EXCEPTION 'new conversation thread must be active' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.thread_ref, NEW.owner_ref, NEW.game_ref, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.thread_ref, OLD.owner_ref, OLD.game_ref, OLD.created_at) THEN
      RAISE EXCEPTION 'conversation thread identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status = 'active' AND NEW.status = 'active' THEN
      IF NEW.retained_until < OLD.retained_until OR NEW.tombstoned_at IS NOT NULL THEN
        RAISE EXCEPTION 'active thread retention can only extend' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT (OLD.status = 'active' AND NEW.status = 'tombstoned' AND NEW.retained_until = OLD.retained_until) THEN
      RAISE EXCEPTION 'conversation thread lifecycle is one-way' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM conversation_messages WHERE thread_ref = OLD.thread_ref AND NOT tombstone) THEN
      RAISE EXCEPTION 'thread cannot tombstone before every message' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION product_context_shadow.enforce_message_contract()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, product_context_shadow
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tombstone OR NOT EXISTS (
      SELECT 1 FROM conversation_threads
      WHERE thread_ref = NEW.thread_ref AND owner_ref = NEW.owner_ref
        AND status = 'active' AND retained_until >= NEW.retained_until
    ) THEN
      RAISE EXCEPTION 'message requires an active matching thread and bounded retention' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.message_ref, NEW.thread_ref, NEW.owner_ref, NEW.stable_turn_key, NEW.sequence,
           NEW.actor, NEW.content_hash, NEW.byte_length, NEW.retained_until, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.message_ref, OLD.thread_ref, OLD.owner_ref, OLD.stable_turn_key, OLD.sequence,
           OLD.actor, OLD.content_hash, OLD.byte_length, OLD.retained_until, OLD.created_at) THEN
      RAISE EXCEPTION 'message identity, actor, digest and retention are immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT (NOT OLD.tombstone AND NEW.tombstone AND OLD.content_bytes IS NOT NULL
            AND NEW.content_bytes IS NULL AND NEW.deleted_at IS NOT NULL
            AND NEW.revision IS DISTINCT FROM OLD.revision) THEN
      RAISE EXCEPTION 'message update must be a one-way content tombstone' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION product_context_shadow.enforce_shadow_run_contract()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, product_context_shadow
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'new shadow run must be pending' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(NEW.run_id, NEW.owner_ref, NEW.thread_ref, NEW.stable_turn_key,
           NEW.authorization_revision, NEW.authorization_receipt,
           NEW.user_message_ref, NEW.user_message_revision, NEW.user_message_hash,
           NEW.agent_message_ref, NEW.agent_message_revision, NEW.agent_message_hash,
           NEW.retained_until, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.run_id, OLD.owner_ref, OLD.thread_ref, OLD.stable_turn_key,
           OLD.authorization_revision, OLD.authorization_receipt,
           OLD.user_message_ref, OLD.user_message_revision, OLD.user_message_hash,
           OLD.agent_message_ref, OLD.agent_message_revision, OLD.agent_message_hash,
           OLD.retained_until, OLD.created_at) THEN
      RAISE EXCEPTION 'shadow run security binding is immutable' USING ERRCODE = '23514';
    END IF;
    IF NOT (
      (OLD.status = 'pending' AND NEW.status IN ('calling_model', 'denied', 'failed')) OR
      (OLD.status = 'calling_model' AND NEW.status IN ('succeeded', 'denied', 'failed'))
    ) THEN
      RAISE EXCEPTION 'illegal shadow run transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION product_context_shadow.enforce_thread_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION product_context_shadow.enforce_message_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION product_context_shadow.enforce_shadow_run_contract() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_thread_contract ON product_context_shadow.conversation_threads;
CREATE TRIGGER enforce_thread_contract BEFORE INSERT OR UPDATE ON product_context_shadow.conversation_threads
FOR EACH ROW EXECUTE FUNCTION product_context_shadow.enforce_thread_contract();
DROP TRIGGER IF EXISTS enforce_message_contract ON product_context_shadow.conversation_messages;
CREATE TRIGGER enforce_message_contract BEFORE INSERT OR UPDATE ON product_context_shadow.conversation_messages
FOR EACH ROW EXECUTE FUNCTION product_context_shadow.enforce_message_contract();
DROP TRIGGER IF EXISTS enforce_shadow_run_contract ON product_context_shadow.shadow_runs;
CREATE TRIGGER enforce_shadow_run_contract BEFORE INSERT OR UPDATE ON product_context_shadow.shadow_runs
FOR EACH ROW EXECUTE FUNCTION product_context_shadow.enforce_shadow_run_contract();

ALTER TABLE product_context_shadow.conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.conversation_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.conversation_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.conversation_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.shadow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.shadow_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.shadow_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_shadow.shadow_metrics FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_threads_owner_policy ON product_context_shadow.conversation_threads;
CREATE POLICY conversation_threads_owner_policy ON product_context_shadow.conversation_threads
  TO product_context_shadow_app
  USING (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''));
DROP POLICY IF EXISTS conversation_messages_owner_policy ON product_context_shadow.conversation_messages;
CREATE POLICY conversation_messages_owner_policy ON product_context_shadow.conversation_messages
  TO product_context_shadow_app
  USING (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''));
DROP POLICY IF EXISTS shadow_runs_owner_policy ON product_context_shadow.shadow_runs;
CREATE POLICY shadow_runs_owner_policy ON product_context_shadow.shadow_runs
  TO product_context_shadow_app
  USING (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''));
DROP POLICY IF EXISTS shadow_metrics_owner_policy ON product_context_shadow.shadow_metrics;
CREATE POLICY shadow_metrics_owner_policy ON product_context_shadow.shadow_metrics
  TO product_context_shadow_app
  USING (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.shadow_principal_ref', true), ''));

DROP POLICY IF EXISTS conversation_threads_cleanup_policy ON product_context_shadow.conversation_threads;
CREATE POLICY conversation_threads_cleanup_policy ON product_context_shadow.conversation_threads
  TO product_context_shadow_cleanup USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS conversation_messages_cleanup_policy ON product_context_shadow.conversation_messages;
CREATE POLICY conversation_messages_cleanup_policy ON product_context_shadow.conversation_messages
  TO product_context_shadow_cleanup USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shadow_runs_cleanup_policy ON product_context_shadow.shadow_runs;
CREATE POLICY shadow_runs_cleanup_policy ON product_context_shadow.shadow_runs
  TO product_context_shadow_cleanup USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA product_context_shadow FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON product_context_shadow.conversation_threads TO product_context_shadow_app;
GRANT SELECT, INSERT, UPDATE ON product_context_shadow.conversation_messages TO product_context_shadow_app;
GRANT SELECT, INSERT, UPDATE ON product_context_shadow.shadow_runs TO product_context_shadow_app;
GRANT SELECT, INSERT ON product_context_shadow.shadow_metrics TO product_context_shadow_app;

GRANT SELECT, UPDATE ON product_context_shadow.conversation_threads TO product_context_shadow_cleanup;
GRANT SELECT, UPDATE ON product_context_shadow.conversation_messages TO product_context_shadow_cleanup;
-- `FOR UPDATE SKIP LOCKED` needs UPDATE privilege even though the function
-- ultimately deletes only expired rows. The cleanup role is NOLOGIN and the
-- application receives only EXECUTE on the fixed SECURITY DEFINER function.
GRANT SELECT, UPDATE, DELETE ON product_context_shadow.shadow_runs TO product_context_shadow_cleanup;

-- Preserve any pre-existing direct membership of the migration executor. The
-- temporary grant below must not revoke authority that an operator assigned
-- before this migration.
CREATE TEMP TABLE product_context_shadow_migration_role_state
  (had_direct_membership boolean NOT NULL);
INSERT INTO product_context_shadow_migration_role_state (had_direct_membership)
SELECT EXISTS (
  SELECT 1
  FROM pg_auth_members AS membership
  JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
  JOIN pg_roles AS member_role ON member_role.oid = membership.member
  WHERE granted_role.rolname = 'product_context_shadow_cleanup'
    AND member_role.rolname = CURRENT_USER
);

-- The migration executor receives cleanup-role membership only while defining
-- this fixed function. Schema CREATE is always removed from the NOLOGIN role.
GRANT product_context_shadow_cleanup TO CURRENT_USER;
GRANT CREATE ON SCHEMA product_context_shadow TO product_context_shadow_cleanup;
SET ROLE product_context_shadow_cleanup;

CREATE OR REPLACE FUNCTION product_context_shadow.cleanup_expired(p_limit integer)
RETURNS TABLE (runs_deleted integer, messages_tombstoned integer, threads_tombstoned integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  cleanup_now timestamptz := clock_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'cleanup limit must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;

  WITH selected AS (
    SELECT run_id
    FROM product_context_shadow.shadow_runs
    WHERE retained_until <= cleanup_now
    ORDER BY retained_until, run_id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  DELETE FROM product_context_shadow.shadow_runs AS run
  USING selected
  WHERE run.run_id = selected.run_id;
  GET DIAGNOSTICS runs_deleted = ROW_COUNT;

  WITH selected AS (
    SELECT message_ref
    FROM product_context_shadow.conversation_messages
    WHERE NOT tombstone AND retained_until <= cleanup_now
    ORDER BY retained_until, message_ref
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE product_context_shadow.conversation_messages AS message
  SET content_bytes = NULL,
      tombstone = true,
      revision = CASE
        WHEN message.revision <> message.content_hash THEN message.content_hash
        ELSE 'sha256:' || repeat('0', 64)
      END,
      deleted_at = cleanup_now,
      updated_at = cleanup_now
  FROM selected
  WHERE message.message_ref = selected.message_ref;
  GET DIAGNOSTICS messages_tombstoned = ROW_COUNT;

  WITH selected AS (
    SELECT thread.thread_ref
    FROM product_context_shadow.conversation_threads AS thread
    WHERE thread.status = 'active'
      AND thread.retained_until <= cleanup_now
      AND NOT EXISTS (
        SELECT 1 FROM product_context_shadow.conversation_messages AS message
        WHERE message.thread_ref = thread.thread_ref AND NOT message.tombstone
      )
    ORDER BY thread.retained_until, thread.thread_ref
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE product_context_shadow.conversation_threads AS thread
  SET status = 'tombstoned', tombstoned_at = cleanup_now, updated_at = cleanup_now
  FROM selected
  WHERE thread.thread_ref = selected.thread_ref;
  GET DIAGNOSTICS threads_tombstoned = ROW_COUNT;

  RETURN NEXT;
END
$function$;

REVOKE ALL ON FUNCTION product_context_shadow.cleanup_expired(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer)
  TO product_context_shadow_app;

RESET ROLE;
REVOKE CREATE ON SCHEMA product_context_shadow FROM product_context_shadow_cleanup;
DO $role_restore$
BEGIN
  IF NOT (SELECT had_direct_membership FROM product_context_shadow_migration_role_state LIMIT 1) THEN
    EXECUTE format('REVOKE product_context_shadow_cleanup FROM %I', CURRENT_USER);
  END IF;
END
$role_restore$;
DROP TABLE product_context_shadow_migration_role_state;
