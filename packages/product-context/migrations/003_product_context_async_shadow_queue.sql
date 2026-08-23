-- Durable asynchronous queue state for Stage 2 shadow synthesis.
--
-- The editor role may append exact turns and enqueue an idempotent run, but it
-- cannot lease or finish work.  A separate NOLOGIN worker role owns those
-- transitions.  No bearer credential or provider body is added to storage.

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_worker') THEN
    CREATE ROLE product_context_shadow_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_shadow_worker_owner') THEN
    CREATE ROLE product_context_shadow_worker_owner NOLOGIN;
  END IF;
END
$migration$;

ALTER ROLE product_context_shadow_worker
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;
ALTER ROLE product_context_shadow_worker_owner
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;

-- A pre-existing role with inherited application/owner authority would turn
-- the fixed function boundary into a confused-deputy path. Refuse that state
-- before exposing any queue function.
DO $worker_membership_guard$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
       WHERE granted_role.rolname = 'product_context_shadow_worker_owner'
         AND NOT (member_role.rolname = SESSION_USER AND grantor_role.rolname = SESSION_USER)
     ) OR
     EXISTS (
       SELECT 1 FROM pg_auth_members AS membership
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = 'product_context_shadow_worker'
     ) OR
     pg_has_role('product_context_shadow_worker', 'product_context_shadow_app', 'MEMBER') OR
     pg_has_role('product_context_shadow_worker', 'product_context_shadow_cleanup', 'MEMBER') OR
     pg_has_role('product_context_shadow_worker', 'product_context_shadow_worker_owner', 'MEMBER') OR
     pg_has_role('product_context_shadow_worker_owner', 'product_context_shadow_app', 'MEMBER') OR
     pg_has_role('product_context_shadow_worker_owner', 'product_context_shadow_cleanup', 'MEMBER') OR
     pg_has_role('product_context_shadow_worker_owner', 'product_context_shadow_worker', 'MEMBER') OR
     pg_has_role('product_context_shadow_app', 'product_context_shadow_worker', 'MEMBER') OR
     pg_has_role('product_context_shadow_app', 'product_context_shadow_worker_owner', 'MEMBER') OR
     pg_has_role('product_context_shadow_cleanup', 'product_context_shadow_worker', 'MEMBER') OR
     pg_has_role('product_context_shadow_cleanup', 'product_context_shadow_worker_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'shadow worker roles have forbidden inherited authority' USING ERRCODE = '42501';
  END IF;
END
$worker_membership_guard$;

-- Upgrade the already-deployed cleanup boundary without trusting that 002 is
-- rerun. A foreign member could SET ROLE to the SECURITY DEFINER owner, while
-- cleanup inheriting any other role would widen that owner, so fail closed.
DO $cleanup_membership_guard$
BEGIN
  IF EXISTS (
       SELECT 1 FROM pg_auth_members AS membership
       JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
       WHERE granted_role.rolname = 'product_context_shadow_cleanup'
         AND NOT (member_role.rolname = SESSION_USER AND grantor_role.rolname = SESSION_USER)
     ) OR EXISTS (
       SELECT 1 FROM pg_auth_members AS membership
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = 'product_context_shadow_cleanup'
     ) OR EXISTS (
       SELECT 1 FROM pg_auth_members AS membership
       JOIN pg_roles AS member_role ON member_role.oid = membership.member
       WHERE member_role.rolname = 'product_context_shadow_app'
     ) THEN
    RAISE EXCEPTION 'shadow app or cleanup role has forbidden membership' USING ERRCODE = '42501';
  END IF;
END
$cleanup_membership_guard$;

-- The cleanup owner, its temporary schema CREATE, and the executor's own
-- PostgreSQL 17 membership row are restored atomically in this one statement.
DO $cleanup_owner_upgrade$
DECLARE
  executor_name text := SESSION_USER;
  acl_grantee text;
  had_executor_grant boolean := false;
  executor_admin_option boolean;
  executor_inherit_option boolean;
  executor_set_option boolean;
BEGIN
  SELECT membership.admin_option, membership.inherit_option, membership.set_option
  INTO executor_admin_option, executor_inherit_option, executor_set_option
  FROM pg_auth_members AS membership
  JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
  JOIN pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
  WHERE granted_role.rolname = 'product_context_shadow_cleanup'
    AND member_role.rolname = executor_name
    AND grantor_role.rolname = executor_name;
  had_executor_grant := FOUND;

  EXECUTE format(
    'GRANT product_context_shadow_cleanup TO %I WITH ADMIN %s, INHERIT %s, SET TRUE GRANTED BY %I',
    executor_name,
    CASE WHEN executor_admin_option THEN 'TRUE' ELSE 'FALSE' END,
    CASE WHEN executor_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
    executor_name
  );
  EXECUTE 'GRANT CREATE ON SCHEMA product_context_shadow TO product_context_shadow_cleanup';
  EXECUTE 'SET LOCAL ROLE product_context_shadow_cleanup';

  EXECUTE $definition$
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
      AND status IN ('succeeded', 'denied', 'failed', 'blocked')
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
$function$
  $definition$;

  FOR acl_grantee IN
    SELECT DISTINCT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END
    FROM pg_proc AS fn
    CROSS JOIN LATERAL aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) AS acl
    LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
    WHERE fn.oid = 'product_context_shadow.cleanup_expired(integer)'::regprocedure
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee NOT IN (fn.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'product_context_shadow_app'))
  LOOP
    EXECUTE CASE WHEN acl_grantee = 'PUBLIC'
      THEN 'REVOKE EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) FROM PUBLIC'
      ELSE format('REVOKE EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) FROM %I', acl_grantee)
    END;
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) TO product_context_shadow_app';
  EXECUTE 'RESET ROLE';
  EXECUTE 'REVOKE CREATE ON SCHEMA product_context_shadow FROM product_context_shadow_cleanup';
  IF had_executor_grant THEN
    EXECUTE format(
      'GRANT product_context_shadow_cleanup TO %I WITH ADMIN %s, INHERIT %s, SET %s GRANTED BY %I',
      executor_name,
      CASE WHEN executor_admin_option THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN executor_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN executor_set_option THEN 'TRUE' ELSE 'FALSE' END,
      executor_name
    );
  ELSE
    EXECUTE format(
      'REVOKE product_context_shadow_cleanup FROM %I GRANTED BY %I',
      executor_name, executor_name
    );
  END IF;
END
$cleanup_owner_upgrade$;

REVOKE CREATE ON SCHEMA product_context_shadow FROM product_context_shadow_worker;
REVOKE CREATE ON SCHEMA product_context_shadow FROM product_context_shadow_worker_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA product_context_shadow FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA product_context_shadow FROM product_context_shadow_worker;
GRANT USAGE ON SCHEMA product_context_shadow TO product_context_shadow_worker;
GRANT USAGE ON SCHEMA product_context_shadow TO product_context_shadow_worker_owner;
GRANT EXECUTE ON FUNCTION product_context_shadow.cleanup_expired(integer) TO product_context_shadow_app;

ALTER TABLE product_context_shadow.shadow_runs
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS lease_token text;

-- A run that was already inside the legacy call boundary remains uncertain;
-- give it a fenced token so the new constraint can preserve and terminalize
-- it safely instead of making the migration depend on an empty queue.
DO $legacy_call_backfill$
BEGIN
  EXECUTE 'ALTER TABLE product_context_shadow.shadow_runs DISABLE TRIGGER enforce_shadow_run_contract';
  UPDATE product_context_shadow.shadow_runs
  SET attempts = GREATEST(attempts, 1),
      lease_token = COALESCE(lease_token, 'lease_legacy_' || substr(md5(run_id), 1, 24))
  WHERE status = 'calling_model';
  EXECUTE 'ALTER TABLE product_context_shadow.shadow_runs ENABLE TRIGGER enforce_shadow_run_contract';
END
$legacy_call_backfill$;

ALTER TABLE product_context_shadow.shadow_runs
  DROP CONSTRAINT IF EXISTS shadow_runs_status_check,
  DROP CONSTRAINT IF EXISTS shadow_runs_outcome_code_check,
  DROP CONSTRAINT IF EXISTS shadow_runs_attempts_ck,
  DROP CONSTRAINT IF EXISTS shadow_runs_last_error_ck,
  DROP CONSTRAINT IF EXISTS shadow_runs_lease_token_ck,
  DROP CONSTRAINT IF EXISTS shadow_runs_terminal_ck,
  ADD CONSTRAINT shadow_runs_status_check CHECK (status IN (
    'pending', 'leased', 'calling_model', 'retry_wait',
    'succeeded', 'denied', 'failed', 'blocked'
  )),
  ADD CONSTRAINT shadow_runs_outcome_code_check CHECK (outcome_code IN (
    'success','no_change','policy_denied','authorization_changed','message_changed',
    'message_deleted','retention_expired','gateway_timeout','gateway_malformed',
    'gateway_oversize','gateway_error','gateway_blocked','gateway_outcome_unknown'
  )),
  ADD CONSTRAINT shadow_runs_attempts_ck CHECK (attempts BETWEEN 0 AND 8),
  ADD CONSTRAINT shadow_runs_last_error_ck CHECK (
    last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_:-]{1,80}$'
  ),
  ADD CONSTRAINT shadow_runs_lease_token_ck CHECK (
    lease_token IS NULL OR lease_token ~ '^lease_[A-Za-z0-9_-]+$'
  ),
  ADD CONSTRAINT shadow_runs_terminal_ck CHECK (
    (status = 'pending' AND attempts = 0 AND request_id IS NULL AND started_at IS NULL
      AND lease_expires_at IS NULL AND lease_token IS NULL AND completed_at IS NULL
      AND outcome_code IS NULL AND result_payload IS NULL AND last_error_code IS NULL) OR
    (status = 'leased' AND attempts > 0 AND request_id IS NULL AND started_at IS NULL
      AND lease_expires_at IS NOT NULL AND lease_token IS NOT NULL AND completed_at IS NULL
      AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'calling_model' AND attempts > 0 AND request_id IS NOT NULL AND started_at IS NOT NULL
      AND lease_expires_at IS NOT NULL AND lease_token IS NOT NULL
      AND lease_expires_at > started_at AND completed_at IS NULL
      AND outcome_code IS NULL AND result_payload IS NULL) OR
    (status = 'retry_wait' AND attempts > 0 AND request_id IS NULL AND started_at IS NULL
      AND lease_expires_at IS NULL AND lease_token IS NULL AND completed_at IS NULL
      AND outcome_code IS NULL AND result_payload IS NULL AND last_error_code IS NOT NULL) OR
    (status = 'succeeded' AND request_id IS NOT NULL AND started_at IS NOT NULL
      AND lease_expires_at IS NULL AND lease_token IS NULL AND completed_at IS NOT NULL
      AND outcome_code IN ('success', 'no_change') AND jsonb_typeof(result_payload) = 'object') OR
    (status IN ('denied', 'failed', 'blocked') AND lease_expires_at IS NULL
      AND lease_token IS NULL AND completed_at IS NOT NULL AND outcome_code IS NOT NULL
      AND result_payload IS NULL)
  );

CREATE INDEX IF NOT EXISTS shadow_runs_queue_ready_idx
  ON product_context_shadow.shadow_runs (next_attempt_at, created_at, run_id)
  WHERE status IN ('pending', 'retry_wait', 'leased');
CREATE INDEX IF NOT EXISTS shadow_runs_calling_expiry_idx
  ON product_context_shadow.shadow_runs (lease_expires_at, run_id)
  WHERE status = 'calling_model';

ALTER TABLE product_context_shadow.shadow_metrics
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1;
ALTER TABLE product_context_shadow.shadow_metrics
  DROP CONSTRAINT IF EXISTS shadow_metrics_one_per_run,
  DROP CONSTRAINT IF EXISTS shadow_metrics_run_attempt_unique,
  DROP CONSTRAINT IF EXISTS shadow_metrics_attempt_number_ck,
  DROP CONSTRAINT IF EXISTS shadow_metrics_outcome_check,
  ADD CONSTRAINT shadow_metrics_run_attempt_unique UNIQUE (run_id, attempt_number),
  ADD CONSTRAINT shadow_metrics_attempt_number_ck CHECK (attempt_number BETWEEN 1 AND 8),
  ADD CONSTRAINT shadow_metrics_outcome_check CHECK (outcome IN (
    'success','no_change','disabled','policy_denied','authorization_changed',
    'message_changed','message_deleted','retention_expired','gateway_timeout',
    'gateway_malformed','gateway_oversize','gateway_error','gateway_retry_scheduled','gateway_blocked',
    'gateway_outcome_unknown'
  ));

CREATE OR REPLACE FUNCTION product_context_shadow.enforce_shadow_run_contract()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, product_context_shadow
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.attempts <> 0 THEN
      RAISE EXCEPTION 'new shadow run must be pending and unattempted' USING ERRCODE = '23514';
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
      (OLD.status IN ('pending', 'retry_wait') AND NEW.status IN ('leased', 'denied', 'failed', 'blocked')) OR
      (OLD.status = 'leased' AND NEW.status IN ('leased', 'calling_model', 'retry_wait', 'denied', 'failed', 'blocked')) OR
      (OLD.status = 'calling_model' AND NEW.status IN ('succeeded', 'denied', 'failed', 'blocked', 'retry_wait'))
    ) THEN
      RAISE EXCEPTION 'illegal asynchronous shadow run transition: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.attempts < OLD.attempts OR NEW.attempts > OLD.attempts + 1 THEN
      RAISE EXCEPTION 'shadow run attempts are monotonic and bounded per transition' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE UPDATE ON product_context_shadow.shadow_runs FROM product_context_shadow_app;
GRANT SELECT, INSERT ON product_context_shadow.shadow_runs TO product_context_shadow_app;

DROP POLICY IF EXISTS shadow_threads_worker_policy ON product_context_shadow.conversation_threads;
DROP POLICY IF EXISTS shadow_messages_worker_policy ON product_context_shadow.conversation_messages;
DROP POLICY IF EXISTS shadow_runs_worker_policy ON product_context_shadow.shadow_runs;
DROP POLICY IF EXISTS shadow_metrics_worker_policy ON product_context_shadow.shadow_metrics;
DROP POLICY IF EXISTS shadow_threads_worker_owner_policy ON product_context_shadow.conversation_threads;
CREATE POLICY shadow_threads_worker_owner_policy ON product_context_shadow.conversation_threads
  TO product_context_shadow_worker_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shadow_messages_worker_owner_policy ON product_context_shadow.conversation_messages;
CREATE POLICY shadow_messages_worker_owner_policy ON product_context_shadow.conversation_messages
  TO product_context_shadow_worker_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shadow_runs_worker_owner_policy ON product_context_shadow.shadow_runs;
CREATE POLICY shadow_runs_worker_owner_policy ON product_context_shadow.shadow_runs
  TO product_context_shadow_worker_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS shadow_metrics_worker_owner_policy ON product_context_shadow.shadow_metrics;
CREATE POLICY shadow_metrics_worker_owner_policy ON product_context_shadow.shadow_metrics
  TO product_context_shadow_worker_owner USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA product_context_shadow FROM product_context_shadow_worker;
GRANT SELECT, UPDATE ON product_context_shadow.conversation_threads TO product_context_shadow_worker_owner;
GRANT SELECT, UPDATE ON product_context_shadow.conversation_messages TO product_context_shadow_worker_owner;
GRANT SELECT, UPDATE ON product_context_shadow.shadow_runs TO product_context_shadow_worker_owner;
GRANT SELECT, INSERT ON product_context_shadow.shadow_metrics TO product_context_shadow_worker_owner;

-- Create the fixed queue API under a non-login owner. The migration executor's
-- exact PostgreSQL 17 membership options and grantor are restored atomically;
-- a statement-by-statement runner cannot leave membership or schema CREATE.
DO $worker_function_owner$
DECLARE
  executor_name text := SESSION_USER;
  acl_function text;
  acl_grantee text;
  had_executor_grant boolean := false;
  executor_admin_option boolean;
  executor_inherit_option boolean;
  executor_set_option boolean;
BEGIN
  SELECT membership.admin_option, membership.inherit_option, membership.set_option
  INTO executor_admin_option, executor_inherit_option, executor_set_option
  FROM pg_auth_members AS membership
  JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
  JOIN pg_roles AS member_role ON member_role.oid = membership.member
  JOIN pg_roles AS grantor_role ON grantor_role.oid = membership.grantor
  WHERE granted_role.rolname = 'product_context_shadow_worker_owner'
    AND member_role.rolname = executor_name
    AND grantor_role.rolname = executor_name;
  had_executor_grant := FOUND;

  EXECUTE format(
    'GRANT product_context_shadow_worker_owner TO %I WITH ADMIN %s, INHERIT %s, SET TRUE GRANTED BY %I',
    executor_name,
    CASE WHEN executor_admin_option THEN 'TRUE' ELSE 'FALSE' END,
    CASE WHEN executor_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
    executor_name
  );
  EXECUTE 'GRANT CREATE ON SCHEMA product_context_shadow TO product_context_shadow_worker_owner';
  EXECUTE 'SET LOCAL ROLE product_context_shadow_worker_owner';

  -- Old 003 exposed a split reread/mark boundary. Remove its exact function
  -- and every direct ACL in the same atomic owner statement before publishing
  -- the replacement prepare-call boundary.
  IF to_regprocedure('product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)') IS NOT NULL THEN
    FOR acl_grantee IN
      SELECT DISTINCT CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END
      FROM pg_proc AS fn
      CROSS JOIN LATERAL aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) AS acl
      LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
      WHERE fn.oid = 'product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)'::regprocedure
        AND acl.privilege_type = 'EXECUTE' AND acl.grantee <> fn.proowner
    LOOP
      EXECUTE CASE WHEN acl_grantee = 'PUBLIC'
        THEN 'REVOKE EXECUTE ON FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz) FROM PUBLIC'
        ELSE format('REVOKE EXECUTE ON FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz) FROM %I', acl_grantee)
      END;
    END LOOP;
    EXECUTE 'DROP FUNCTION product_context_shadow.worker_mark_calling(text,text,text,integer,timestamptz)';
  END IF;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_claim(
  p_lease_ms integer, p_max_attempts integer, p_now timestamptz,
  p_target_owner_ref text, p_target_game_ref text, p_target_stable_turn_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  selected_run product_context_shadow.shadow_runs%ROWTYPE;
  changed_run product_context_shadow.shadow_runs%ROWTYPE;
  payload jsonb;
  token text;
  thread_valid boolean;
  binding_outcome text;
  authority_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_ms IS NULL OR p_lease_ms < 1 OR p_lease_ms > 120000 OR
     p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 8 OR p_now IS NULL THEN
    RAISE EXCEPTION 'invalid worker claim bounds' USING ERRCODE = '22023';
  END IF;
  IF (p_target_owner_ref IS NULL) <> (p_target_game_ref IS NULL) OR
     (p_target_owner_ref IS NULL) <> (p_target_stable_turn_key IS NULL) THEN
    RAISE EXCEPTION 'worker target must be complete or absent' USING ERRCODE = '22023';
  END IF;

  FOR changed_run IN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'failed', outcome_code = 'gateway_outcome_unknown', lease_token = NULL,
        lease_expires_at = NULL, completed_at = p_now,
        last_error_code = 'expired_calling_model', updated_at = p_now
    WHERE status = 'calling_model' AND lease_expires_at <= authority_now
      AND (p_target_owner_ref IS NULL OR (
        owner_ref = p_target_owner_ref AND stable_turn_key = p_target_stable_turn_key
        AND authorization_receipt->>'shadow_principal_ref' = p_target_owner_ref
        AND authorization_receipt->'applies_to'->>0 = p_target_game_ref
        AND EXISTS (SELECT 1 FROM product_context_shadow.conversation_threads AS target_thread
          WHERE target_thread.thread_ref = shadow_runs.thread_ref
            AND target_thread.owner_ref = p_target_owner_ref AND target_thread.game_ref = p_target_game_ref)
      ))
    RETURNING *
  LOOP
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(changed_run.run_id || ':' || changed_run.attempts::text),
      changed_run.run_id, changed_run.owner_ref, changed_run.request_id,
      'gateway_outcome_unknown', 0, 0, 0, 0, changed_run.authorization_revision,
      changed_run.authorization_receipt->>'external_processing_policy_ref',
      changed_run.authorization_receipt->>'external_processing_policy_revision',
      p_now, changed_run.attempts
    );
  END LOOP;

  -- Retention is authoritative even while a pre-call lease is held. Fencing
  -- the token makes a concurrent authorizer lose the lease before it can
  -- enter calling_model. Pending expiry counts as the first content-free
  -- worker attempt so every terminal run has a valid per-attempt metric.
  FOR changed_run IN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'failed', attempts = GREATEST(attempts, 1),
        outcome_code = 'retention_expired', lease_token = NULL,
        lease_expires_at = NULL, completed_at = p_now,
        last_error_code = 'retention_expired', updated_at = p_now
    WHERE status IN ('pending', 'retry_wait', 'leased') AND retained_until <= authority_now
      AND (p_target_owner_ref IS NULL OR (
        owner_ref = p_target_owner_ref AND stable_turn_key = p_target_stable_turn_key
        AND authorization_receipt->>'shadow_principal_ref' = p_target_owner_ref
        AND authorization_receipt->'applies_to'->>0 = p_target_game_ref
        AND EXISTS (SELECT 1 FROM product_context_shadow.conversation_threads AS target_thread
          WHERE target_thread.thread_ref = shadow_runs.thread_ref
            AND target_thread.owner_ref = p_target_owner_ref AND target_thread.game_ref = p_target_game_ref)
      ))
    RETURNING *
  LOOP
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(changed_run.run_id || ':' || changed_run.attempts::text),
      changed_run.run_id, changed_run.owner_ref, NULL, 'retention_expired', 0, 0, 0, 0,
      changed_run.authorization_revision,
      changed_run.authorization_receipt->>'external_processing_policy_ref',
      changed_run.authorization_receipt->>'external_processing_policy_revision',
      p_now, changed_run.attempts
    );
  END LOOP;

  UPDATE product_context_shadow.shadow_runs
  SET status = 'blocked', outcome_code = 'gateway_blocked', completed_at = p_now,
      last_error_code = 'attempts_exhausted', updated_at = p_now
  WHERE status = 'retry_wait' AND attempts >= p_max_attempts AND next_attempt_at <= authority_now
    AND (p_target_owner_ref IS NULL OR (
      owner_ref = p_target_owner_ref AND stable_turn_key = p_target_stable_turn_key
      AND authorization_receipt->>'shadow_principal_ref' = p_target_owner_ref
      AND authorization_receipt->'applies_to'->>0 = p_target_game_ref
      AND EXISTS (SELECT 1 FROM product_context_shadow.conversation_threads AS target_thread
        WHERE target_thread.thread_ref = shadow_runs.thread_ref
          AND target_thread.owner_ref = p_target_owner_ref AND target_thread.game_ref = p_target_game_ref)
    ));

  FOR changed_run IN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'blocked', outcome_code = 'gateway_blocked', lease_token = NULL,
        lease_expires_at = NULL, completed_at = p_now,
        last_error_code = 'attempts_exhausted', updated_at = p_now
    WHERE status = 'leased' AND attempts >= p_max_attempts AND lease_expires_at <= authority_now
      AND (p_target_owner_ref IS NULL OR (
        owner_ref = p_target_owner_ref AND stable_turn_key = p_target_stable_turn_key
        AND authorization_receipt->>'shadow_principal_ref' = p_target_owner_ref
        AND authorization_receipt->'applies_to'->>0 = p_target_game_ref
        AND EXISTS (SELECT 1 FROM product_context_shadow.conversation_threads AS target_thread
          WHERE target_thread.thread_ref = shadow_runs.thread_ref
            AND target_thread.owner_ref = p_target_owner_ref AND target_thread.game_ref = p_target_game_ref)
      ))
    RETURNING *
  LOOP
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(changed_run.run_id || ':' || changed_run.attempts::text),
      changed_run.run_id, changed_run.owner_ref, NULL, 'gateway_blocked', 0, 0, 0, 0,
      changed_run.authorization_revision,
      changed_run.authorization_receipt->>'external_processing_policy_ref',
      changed_run.authorization_receipt->>'external_processing_policy_revision',
      p_now, changed_run.attempts
    );
  END LOOP;

  SELECT * INTO selected_run
  FROM product_context_shadow.shadow_runs
  WHERE attempts < p_max_attempts AND retained_until > authority_now AND (
    (status IN ('pending', 'retry_wait') AND next_attempt_at <= authority_now) OR
    (status = 'leased' AND lease_expires_at <= authority_now)
  )
    AND (p_target_owner_ref IS NULL OR (
      owner_ref = p_target_owner_ref AND stable_turn_key = p_target_stable_turn_key
      AND authorization_receipt->>'shadow_principal_ref' = p_target_owner_ref
      AND authorization_receipt->'applies_to'->>0 = p_target_game_ref
      AND EXISTS (
        SELECT 1 FROM product_context_shadow.conversation_threads AS target_thread
        WHERE target_thread.thread_ref = shadow_runs.thread_ref
          AND target_thread.owner_ref = p_target_owner_ref
          AND target_thread.game_ref = p_target_game_ref
      )
    ))
  ORDER BY next_attempt_at, created_at, run_id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  token := 'lease_' || md5(selected_run.run_id || ':' || (selected_run.attempts + 1)::text || ':' || authority_now::text || ':' || random()::text);
  UPDATE product_context_shadow.shadow_runs
  SET status = 'leased', attempts = attempts + 1, lease_token = token,
      lease_expires_at = authority_now + make_interval(secs => p_lease_ms::double precision / 1000),
      request_id = NULL, started_at = NULL, completed_at = NULL,
      outcome_code = NULL, result_payload = NULL, updated_at = p_now
  WHERE run_id = selected_run.run_id RETURNING * INTO selected_run;

  SELECT jsonb_build_object(
    'run', to_jsonb(selected_run),
    'messages', COALESCE(jsonb_agg(
      (to_jsonb(message) - 'content_bytes') || jsonb_build_object(
        'content_base64', CASE WHEN message.content_bytes IS NULL THEN NULL ELSE replace(replace(encode(message.content_bytes, 'base64'), chr(10), ''), chr(13), '') END
      ) ORDER BY message.sequence
    ), '[]'::jsonb)
  ) INTO payload
  FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = selected_run.owner_ref
    AND message.message_ref IN (selected_run.user_message_ref, selected_run.agent_message_ref);

  SELECT EXISTS (
    SELECT 1 FROM product_context_shadow.conversation_threads AS thread
    WHERE thread.thread_ref = selected_run.thread_ref
      AND thread.owner_ref = selected_run.owner_ref
      AND thread.game_ref = selected_run.authorization_receipt->'applies_to'->>0
      AND thread.status = 'active' AND thread.retained_until > authority_now
  ) INTO thread_valid;
  binding_outcome := CASE
    WHEN jsonb_array_length(payload->'messages') <> 2 THEN 'message_deleted'
    WHEN NOT thread_valid THEN 'message_changed'
    ELSE NULL
  END;
  IF binding_outcome IS NOT NULL THEN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'failed', outcome_code = binding_outcome, lease_token = NULL,
        lease_expires_at = NULL, completed_at = p_now,
        last_error_code = binding_outcome, updated_at = p_now
    WHERE run_id = selected_run.run_id RETURNING * INTO changed_run;
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(changed_run.run_id || ':' || changed_run.attempts::text),
      changed_run.run_id, changed_run.owner_ref, NULL, binding_outcome, 0, 0, 0, 0,
      changed_run.authorization_revision,
      changed_run.authorization_receipt->>'external_processing_policy_ref',
      changed_run.authorization_receipt->>'external_processing_policy_revision',
      p_now, changed_run.attempts
    );
    RETURN NULL;
  END IF;
  RETURN payload;
END
$function$;
  $definition$;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_reread(p_run_id text, p_lease_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE run_row product_context_shadow.shadow_runs%ROWTYPE; payload jsonb;
BEGIN
  SELECT * INTO run_row FROM product_context_shadow.shadow_runs
  WHERE run_id = p_run_id AND lease_token = p_lease_token
    AND status IN ('leased', 'calling_model') AND lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'run', to_jsonb(run_row),
    'messages', COALESCE(jsonb_agg(
      (to_jsonb(message) - 'content_bytes') || jsonb_build_object(
        'content_base64', CASE WHEN message.content_bytes IS NULL THEN NULL ELSE replace(replace(encode(message.content_bytes, 'base64'), chr(10), ''), chr(13), '') END
      ) ORDER BY message.sequence
    ), '[]'::jsonb)
  ) INTO payload
  FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref);
  RETURN payload;
END
$function$;
  $definition$;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_prepare_call(
  p_run_id text, p_lease_token text, p_request_id text,
  p_call_lease_ms integer, p_now timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  run_row product_context_shadow.shadow_runs%ROWTYPE;
  thread_row product_context_shadow.conversation_threads%ROWTYPE;
  payload jsonb;
  message_count integer;
  deleted_count integer;
  changed_count integer;
  expired_count integer;
  terminal_outcome text;
  authority_now timestamptz := clock_timestamp();
BEGIN
  IF p_call_lease_ms IS NULL OR p_call_lease_ms < 1 OR p_call_lease_ms > 120000 OR p_now IS NULL THEN
    RAISE EXCEPTION 'invalid call lease' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO run_row FROM product_context_shadow.shadow_runs
  WHERE run_id = p_run_id AND lease_token = p_lease_token AND status = 'leased'
    AND lease_expires_at > authority_now FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO thread_row FROM product_context_shadow.conversation_threads
  WHERE thread_ref = run_row.thread_ref AND owner_ref = run_row.owner_ref FOR UPDATE;
  PERFORM 1 FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref)
  ORDER BY message.message_ref FOR UPDATE;
  authority_now := clock_timestamp();
  IF run_row.lease_expires_at <= authority_now THEN RETURN NULL; END IF;
  SELECT count(*)::integer,
         count(*) FILTER (WHERE message.tombstone OR message.content_bytes IS NULL)::integer,
         count(*) FILTER (WHERE
           (message.message_ref = run_row.user_message_ref AND (
             message.actor <> 'user' OR message.revision <> run_row.user_message_revision OR
             message.content_hash <> run_row.user_message_hash OR
             octet_length(message.content_bytes) <> message.byte_length)) OR
           (message.message_ref = run_row.agent_message_ref AND (
             message.actor <> 'agent' OR message.revision <> run_row.agent_message_revision OR
             message.content_hash <> run_row.agent_message_hash OR
             octet_length(message.content_bytes) <> message.byte_length)))::integer,
         count(*) FILTER (WHERE message.retained_until <= authority_now)::integer
  INTO message_count, deleted_count, changed_count, expired_count
  FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref);
  terminal_outcome := CASE
    WHEN run_row.retained_until <= authority_now OR expired_count > 0 OR
         thread_row.retained_until <= authority_now THEN 'retention_expired'
    WHEN message_count <> 2 OR deleted_count > 0 THEN 'message_deleted'
    WHEN changed_count > 0 OR thread_row.thread_ref IS NULL OR thread_row.status <> 'active' OR
         thread_row.game_ref <> run_row.authorization_receipt->'applies_to'->>0 THEN 'message_changed'
    ELSE NULL
  END;
  IF terminal_outcome IS NOT NULL THEN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'failed', outcome_code = terminal_outcome, result_payload = NULL,
        lease_token = NULL, lease_expires_at = NULL, completed_at = p_now,
        last_error_code = terminal_outcome, updated_at = p_now
    WHERE run_id = p_run_id;
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(run_row.run_id || ':' || run_row.attempts::text), run_row.run_id,
      run_row.owner_ref, NULL, terminal_outcome, 0, 0, 0, 0, run_row.authorization_revision,
      run_row.authorization_receipt->>'external_processing_policy_ref',
      run_row.authorization_receipt->>'external_processing_policy_revision', p_now, run_row.attempts
    );
    RETURN NULL;
  END IF;
  UPDATE product_context_shadow.shadow_runs
  SET status = 'calling_model', request_id = p_request_id, started_at = p_now,
      lease_expires_at = authority_now + make_interval(secs => p_call_lease_ms::double precision / 1000),
      updated_at = p_now
  WHERE run_id = p_run_id;
  SELECT jsonb_build_object(
    'run', to_jsonb(run_row),
    'messages', jsonb_agg(
      (to_jsonb(message) - 'content_bytes') || jsonb_build_object(
        'content_base64', replace(replace(encode(message.content_bytes, 'base64'), chr(10), ''), chr(13), '')
      ) ORDER BY message.sequence)
  ) INTO payload
  FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref);
  RETURN payload;
END
$function$;
  $definition$;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_retry(
  p_run_id text, p_lease_token text, p_error_code text, p_next_attempt_at timestamptz,
  p_duration_ms integer, p_input_bytes integer, p_output_bytes integer, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  run_row product_context_shadow.shadow_runs%ROWTYPE;
  authority_now timestamptz;
BEGIN
  IF p_next_attempt_at IS NULL OR p_next_attempt_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'invalid retry schedule' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM product_context_shadow.shadow_runs
  WHERE run_id = p_run_id AND lease_token = p_lease_token
    AND status IN ('leased', 'calling_model') AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  authority_now := clock_timestamp();
  IF run_row.lease_expires_at <= authority_now OR p_next_attempt_at <= authority_now THEN RETURN false; END IF;
  UPDATE product_context_shadow.shadow_runs
  SET status = 'retry_wait', request_id = NULL, started_at = NULL, lease_token = NULL,
      lease_expires_at = NULL, next_attempt_at = p_next_attempt_at,
      last_error_code = p_error_code, updated_at = p_now
  WHERE run_id = p_run_id;
  INSERT INTO product_context_shadow.shadow_metrics (
    metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
    output_bytes, proposal_operation_count, authorization_revision,
    external_processing_policy_ref, external_processing_policy_revision,
    recorded_at, attempt_number
  ) VALUES (
    'metric_' || md5(run_row.run_id || ':' || run_row.attempts::text), run_row.run_id,
    run_row.owner_ref, run_row.request_id, 'gateway_retry_scheduled', p_duration_ms,
    p_input_bytes, p_output_bytes, 0, run_row.authorization_revision,
    run_row.authorization_receipt->>'external_processing_policy_ref',
    run_row.authorization_receipt->>'external_processing_policy_revision', p_now, run_row.attempts
  );
  RETURN true;
END
$function$;
  $definition$;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_terminal(
  p_run_id text, p_lease_token text, p_status text, p_outcome text, p_error_code text,
  p_duration_ms integer, p_input_bytes integer, p_output_bytes integer, p_now timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  run_row product_context_shadow.shadow_runs%ROWTYPE;
  authority_now timestamptz;
BEGIN
  IF p_status NOT IN ('denied', 'failed', 'blocked') OR p_outcome NOT IN (
    'policy_denied', 'authorization_changed', 'message_changed', 'message_deleted',
    'retention_expired', 'gateway_timeout', 'gateway_malformed', 'gateway_oversize',
    'gateway_error', 'gateway_blocked', 'gateway_outcome_unknown'
  ) THEN
    RAISE EXCEPTION 'invalid terminal status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM product_context_shadow.shadow_runs
  WHERE run_id = p_run_id AND lease_token = p_lease_token
    AND status IN ('leased', 'calling_model') AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  authority_now := clock_timestamp();
  IF run_row.lease_expires_at <= authority_now THEN RETURN false; END IF;
  UPDATE product_context_shadow.shadow_runs
  SET status = p_status, outcome_code = p_outcome, result_payload = NULL,
      lease_token = NULL, lease_expires_at = NULL, completed_at = p_now,
      last_error_code = p_error_code, updated_at = p_now
  WHERE run_id = p_run_id;
  INSERT INTO product_context_shadow.shadow_metrics (
    metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
    output_bytes, proposal_operation_count, authorization_revision,
    external_processing_policy_ref, external_processing_policy_revision,
    recorded_at, attempt_number
  ) VALUES (
    'metric_' || md5(run_row.run_id || ':' || run_row.attempts::text), run_row.run_id,
    run_row.owner_ref, run_row.request_id, p_outcome, p_duration_ms, p_input_bytes,
    p_output_bytes, 0, run_row.authorization_revision,
    run_row.authorization_receipt->>'external_processing_policy_ref',
    run_row.authorization_receipt->>'external_processing_policy_revision', p_now, run_row.attempts
  );
  RETURN true;
END
$function$;
  $definition$;

  EXECUTE $definition$
CREATE OR REPLACE FUNCTION product_context_shadow.worker_complete(
  p_run_id text, p_lease_token text, p_result jsonb, p_outcome text,
  p_duration_ms integer, p_input_bytes integer, p_output_bytes integer,
  p_operation_count integer, p_now timestamptz
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, product_context_shadow
AS $function$
DECLARE
  run_row product_context_shadow.shadow_runs%ROWTYPE;
  message_count integer;
  deleted_count integer;
  changed_count integer;
  expired_count integer;
  thread_valid boolean;
  thread_expired boolean;
  terminal_outcome text;
  authority_now timestamptz;
BEGIN
  IF p_outcome NOT IN ('success', 'no_change') OR jsonb_typeof(p_result) <> 'object' OR
     p_operation_count < 0 OR p_operation_count > 20 THEN
    RAISE EXCEPTION 'invalid worker result' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO run_row FROM product_context_shadow.shadow_runs
  WHERE run_id = p_run_id AND lease_token = p_lease_token
    AND status = 'calling_model' AND lease_expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  PERFORM 1 FROM product_context_shadow.conversation_threads AS thread
  WHERE thread.thread_ref = run_row.thread_ref AND thread.owner_ref = run_row.owner_ref
  FOR UPDATE;
  PERFORM 1 FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref)
  ORDER BY message.message_ref FOR UPDATE;
  authority_now := clock_timestamp();
  IF run_row.lease_expires_at <= authority_now THEN RETURN NULL; END IF;

  -- The result and its metric commit in the same transaction as the final
  -- exact-message/retention check. A cleanup or retention transition racing
  -- the post-call reread therefore discards, rather than persists, provider
  -- output and never causes another external call.
  SELECT count(*)::integer,
         count(*) FILTER (WHERE message.tombstone OR message.content_bytes IS NULL)::integer,
         count(*) FILTER (WHERE
           (message.message_ref = run_row.user_message_ref AND (
             message.actor <> 'user' OR message.revision <> run_row.user_message_revision OR
             message.content_hash <> run_row.user_message_hash)) OR
           (message.message_ref = run_row.agent_message_ref AND (
             message.actor <> 'agent' OR message.revision <> run_row.agent_message_revision OR
             message.content_hash <> run_row.agent_message_hash)))::integer,
         count(*) FILTER (WHERE message.retained_until <= authority_now)::integer
  INTO message_count, deleted_count, changed_count, expired_count
  FROM product_context_shadow.conversation_messages AS message
  WHERE message.owner_ref = run_row.owner_ref
    AND message.message_ref IN (run_row.user_message_ref, run_row.agent_message_ref);

  SELECT EXISTS (
           SELECT 1 FROM product_context_shadow.conversation_threads AS thread
           WHERE thread.thread_ref = run_row.thread_ref AND thread.owner_ref = run_row.owner_ref
             AND thread.game_ref = run_row.authorization_receipt->'applies_to'->>0
             AND thread.status = 'active'
         ), EXISTS (
           SELECT 1 FROM product_context_shadow.conversation_threads AS thread
           WHERE thread.thread_ref = run_row.thread_ref AND thread.owner_ref = run_row.owner_ref
             AND thread.retained_until <= authority_now
         )
  INTO thread_valid, thread_expired;

  terminal_outcome := CASE
    WHEN run_row.retained_until <= authority_now OR expired_count > 0 OR thread_expired THEN 'retention_expired'
    WHEN message_count <> 2 OR deleted_count > 0 THEN 'message_deleted'
    WHEN changed_count > 0 OR NOT thread_valid THEN 'message_changed'
    ELSE NULL
  END;
  IF terminal_outcome IS NOT NULL THEN
    UPDATE product_context_shadow.shadow_runs
    SET status = 'failed', outcome_code = terminal_outcome, result_payload = NULL,
        lease_token = NULL, lease_expires_at = NULL, completed_at = p_now,
        last_error_code = terminal_outcome, updated_at = p_now
    WHERE run_id = p_run_id;
    INSERT INTO product_context_shadow.shadow_metrics (
      metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
      output_bytes, proposal_operation_count, authorization_revision,
      external_processing_policy_ref, external_processing_policy_revision,
      recorded_at, attempt_number
    ) VALUES (
      'metric_' || md5(run_row.run_id || ':' || run_row.attempts::text), run_row.run_id,
      run_row.owner_ref, run_row.request_id, terminal_outcome, p_duration_ms, p_input_bytes,
      p_output_bytes, 0, run_row.authorization_revision,
      run_row.authorization_receipt->>'external_processing_policy_ref',
      run_row.authorization_receipt->>'external_processing_policy_revision', p_now, run_row.attempts
    );
    RETURN terminal_outcome;
  END IF;

  UPDATE product_context_shadow.shadow_runs
  SET status = 'succeeded', outcome_code = p_outcome, result_payload = p_result,
      lease_token = NULL, lease_expires_at = NULL, completed_at = p_now, updated_at = p_now
  WHERE run_id = p_run_id;
  INSERT INTO product_context_shadow.shadow_metrics (
    metric_id, run_id, owner_ref, request_id, outcome, duration_ms, input_bytes,
    output_bytes, proposal_operation_count, authorization_revision,
    external_processing_policy_ref, external_processing_policy_revision,
    recorded_at, attempt_number
  ) VALUES (
    'metric_' || md5(run_row.run_id || ':' || run_row.attempts::text), run_row.run_id,
    run_row.owner_ref, run_row.request_id, p_outcome, p_duration_ms, p_input_bytes,
    p_output_bytes, p_operation_count, run_row.authorization_revision,
    run_row.authorization_receipt->>'external_processing_policy_ref',
    run_row.authorization_receipt->>'external_processing_policy_revision', p_now, run_row.attempts
  );
  RETURN 'completed';
END
$function$;
  $definition$;

  FOR acl_function, acl_grantee IN
    SELECT format('%I.%I(%s)', namespace.nspname, fn.proname,
             pg_get_function_identity_arguments(fn.oid)),
           CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END
    FROM pg_proc AS fn
    JOIN pg_namespace AS namespace ON namespace.oid = fn.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(fn.proacl, acldefault('f', fn.proowner))) AS acl
    LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
    WHERE namespace.nspname = 'product_context_shadow'
      AND fn.proname IN ('worker_claim', 'worker_reread', 'worker_prepare_call',
        'worker_retry', 'worker_terminal', 'worker_complete')
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee NOT IN (fn.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'product_context_shadow_worker'))
  LOOP
    EXECUTE CASE WHEN acl_grantee = 'PUBLIC'
      THEN format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', acl_function)
      ELSE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', acl_function, acl_grantee)
    END;
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_claim(integer,integer,timestamptz,text,text,text) TO product_context_shadow_worker';
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_reread(text,text) TO product_context_shadow_worker';
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_prepare_call(text,text,text,integer,timestamptz) TO product_context_shadow_worker';
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_retry(text,text,text,timestamptz,integer,integer,integer,timestamptz) TO product_context_shadow_worker';
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_terminal(text,text,text,text,text,integer,integer,integer,timestamptz) TO product_context_shadow_worker';
  EXECUTE 'GRANT EXECUTE ON FUNCTION product_context_shadow.worker_complete(text,text,jsonb,text,integer,integer,integer,integer,timestamptz) TO product_context_shadow_worker';

  EXECUTE 'RESET ROLE';
  EXECUTE 'REVOKE CREATE ON SCHEMA product_context_shadow FROM product_context_shadow_worker_owner';
  IF had_executor_grant THEN
    EXECUTE format(
      'GRANT product_context_shadow_worker_owner TO %I WITH ADMIN %s, INHERIT %s, SET %s GRANTED BY %I',
      executor_name,
      CASE WHEN executor_admin_option THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN executor_inherit_option THEN 'TRUE' ELSE 'FALSE' END,
      CASE WHEN executor_set_option THEN 'TRUE' ELSE 'FALSE' END,
      executor_name
    );
  ELSE
    EXECUTE format(
      'REVOKE product_context_shadow_worker_owner FROM %I GRANTED BY %I',
      executor_name, executor_name
    );
  END IF;
END
$worker_function_owner$;
