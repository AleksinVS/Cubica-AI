-- Isolated PostgreSQL storage for Stage 1 product knowledge.
--
-- The migration role owns the schema and tables. The application role is a
-- deliberately powerless group role: it can use only the two product tables,
-- never owns them, and is always subject to forced row-level security (RLS).

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'product_context_stage1_app') THEN
    CREATE ROLE product_context_stage1_app NOLOGIN;
  END IF;
END
$migration$;

ALTER ROLE product_context_stage1_app
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS NOLOGIN;

GRANT product_context_stage1_app TO CURRENT_USER;

CREATE SCHEMA IF NOT EXISTS product_context_stage1;
REVOKE ALL ON SCHEMA product_context_stage1 FROM PUBLIC;
GRANT USAGE ON SCHEMA product_context_stage1 TO product_context_stage1_app;

CREATE TABLE IF NOT EXISTS product_context_stage1.knowledge_spaces (
  space_id text PRIMARY KEY CHECK (space_id ~ '^space_[A-Za-z0-9_-]+$'),
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  subject_ref text NOT NULL CHECK (subject_ref ~ '^cubica://'),
  trust_zone_ref text NOT NULL,
  access_policy_ref text NOT NULL,
  retention_policy_ref text NOT NULL,
  repository_ref text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'erasing')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_spaces_security_partition UNIQUE (space_id, owner_ref)
);

CREATE TABLE IF NOT EXISTS product_context_stage1.knowledge_write_operations (
  operation_id text PRIMARY KEY CHECK (operation_id ~ '^op_[A-Za-z0-9_-]+$'),
  space_id text NOT NULL,
  owner_ref text NOT NULL CHECK (owner_ref ~ '^cubica://'),
  creator_ref text NOT NULL CHECK (creator_ref ~ '^cubica://'),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 16 AND 200),
  proposal_id text NOT NULL CHECK (proposal_id ~ '^prop_[A-Za-z0-9_-]+$'),
  patch_hash text CHECK (patch_hash ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN (
    'pending_confirmation', 'ready', 'applying', 'applied',
    'rejected', 'expired', 'conflict', 'failed'
  )),
  status_reason text NOT NULL CHECK (status_reason IN (
    'awaiting_confirmation', 'explicitly_rejected', 'confirmation_expired',
    'ready_to_apply', 'lease_expired', 'temporary_storage_failure',
    'base_revision_changed', 'read_set_changed', 'impact_changed',
    'authorization_changed', 'policy_changed', 'requires_extended_review',
    'invalid_payload', 'secret_detected', 'git_ref_conflict', 'applied',
    'payload_purged'
  )),
  decision_envelope_id text NOT NULL CHECK (decision_envelope_id ~ '^env_[A-Za-z0-9_-]+$'),
  decision_envelope jsonb,
  patch_payload jsonb,
  source_refs jsonb,
  confirmation jsonb,
  confirmed_patch_hash text CHECK (confirmed_patch_hash ~ '^sha256:[a-f0-9]{64}$'),
  commit_sha text CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_error_at timestamptz,
  last_error_code text CHECK (last_error_code IN (
    'storage_unavailable', 'git_ref_conflict', 'invalid_payload',
    'authorization_changed', 'policy_changed'
  )),
  applied_at timestamptz,
  payload_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT knowledge_write_operations_space_partition_fk
    FOREIGN KEY (space_id, owner_ref)
    REFERENCES product_context_stage1.knowledge_spaces (space_id, owner_ref)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_write_operations_status_reason_ck CHECK (
    (status = 'pending_confirmation' AND status_reason = 'awaiting_confirmation') OR
    (status = 'ready' AND status_reason IN ('ready_to_apply', 'lease_expired', 'temporary_storage_failure')) OR
    (status = 'applying' AND status_reason = 'ready_to_apply') OR
    (status = 'applied' AND status_reason IN ('applied', 'payload_purged')) OR
    (status = 'rejected' AND status_reason = 'explicitly_rejected') OR
    (status = 'expired' AND status_reason = 'confirmation_expired') OR
    (status = 'conflict' AND status_reason IN (
      'base_revision_changed', 'read_set_changed', 'impact_changed',
      'authorization_changed', 'policy_changed', 'requires_extended_review',
      'git_ref_conflict'
    )) OR
    (status = 'failed' AND status_reason IN ('invalid_payload', 'secret_detected'))
  ),
  CONSTRAINT knowledge_write_operations_lease_ck CHECK (
    (status = 'applying' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (status <> 'applying' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT knowledge_write_operations_commit_ck CHECK (
    (status = 'applied' AND commit_sha IS NOT NULL AND applied_at IS NOT NULL) OR
    (status <> 'applied' AND commit_sha IS NULL AND applied_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS knowledge_write_operations_ready_idx
  ON product_context_stage1.knowledge_write_operations (created_at, operation_id)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS knowledge_write_operations_expired_lease_idx
  ON product_context_stage1.knowledge_write_operations (lease_expires_at, operation_id)
  WHERE status = 'applying';

CREATE OR REPLACE FUNCTION product_context_stage1.enforce_write_operation_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, product_context_stage1
AS $function$
DECLARE
  is_content_purge boolean;
  transition_allowed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending_confirmation' OR NEW.status_reason <> 'awaiting_confirmation' THEN
      RAISE EXCEPTION 'new knowledge operation must await confirmation' USING ERRCODE = '23514';
    END IF;
    IF NEW.creator_ref IS DISTINCT FROM NEW.owner_ref THEN
      RAISE EXCEPTION 'operation creator must match its personal-space owner' USING ERRCODE = '23514';
    END IF;
    IF NEW.confirmation IS NOT NULL OR NEW.confirmed_patch_hash IS NOT NULL THEN
      RAISE EXCEPTION 'new knowledge operation cannot already be confirmed' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF ROW(
      NEW.operation_id, NEW.space_id, NEW.owner_ref, NEW.creator_ref,
      NEW.idempotency_key, NEW.proposal_id, NEW.decision_envelope_id, NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.operation_id, OLD.space_id, OLD.owner_ref, OLD.creator_ref,
      OLD.idempotency_key, OLD.proposal_id, OLD.decision_envelope_id, OLD.created_at
    ) THEN
      RAISE EXCEPTION 'knowledge operation identity is immutable' USING ERRCODE = '23514';
    END IF;

    is_content_purge :=
      OLD.payload_purged_at IS NULL AND NEW.payload_purged_at IS NOT NULL AND
      NEW.status IN ('applied', 'rejected', 'expired') AND
      NEW.decision_envelope IS NULL AND NEW.patch_payload IS NULL AND
      NEW.source_refs IS NULL AND NEW.patch_hash IS NULL AND
      NEW.confirmation IS NULL AND NEW.confirmed_patch_hash IS NULL;

    IF ROW(NEW.decision_envelope, NEW.patch_payload, NEW.source_refs, NEW.patch_hash)
       IS DISTINCT FROM
       ROW(OLD.decision_envelope, OLD.patch_payload, OLD.source_refs, OLD.patch_hash)
       AND NOT is_content_purge THEN
      RAISE EXCEPTION 'knowledge operation payload and envelope are immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.confirmation IS DISTINCT FROM OLD.confirmation OR
       NEW.confirmed_patch_hash IS DISTINCT FROM OLD.confirmed_patch_hash THEN
      IF NOT (
        (OLD.status = 'pending_confirmation' AND NEW.status = 'ready' AND
         OLD.confirmation IS NULL AND OLD.confirmed_patch_hash IS NULL) OR
        is_content_purge
      ) THEN
        RAISE EXCEPTION 'confirmation is immutable outside the confirmation transition' USING ERRCODE = '23514';
      END IF;
    END IF;

    transition_allowed :=
      (OLD.status = 'pending_confirmation' AND NEW.status IN ('ready', 'rejected', 'expired')) OR
      (OLD.status = 'ready' AND NEW.status = 'applying') OR
      (OLD.status = 'applying' AND NEW.status IN ('applied', 'ready', 'expired', 'conflict', 'failed')) OR
      (OLD.status = 'applied' AND NEW.status = 'applied' AND is_content_purge);

    IF NOT transition_allowed THEN
      RAISE EXCEPTION 'illegal knowledge operation transition: % -> %', OLD.status, NEW.status
        USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'ready' AND NEW.status = 'applying' THEN
      IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
        RAISE EXCEPTION 'claim must increment attempt_count exactly once' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.attempt_count <> OLD.attempt_count THEN
      RAISE EXCEPTION 'attempt_count changes only while claiming ready work' USING ERRCODE = '23514';
    END IF;

    IF OLD.status = 'applying' AND NEW.status = 'ready' AND
       NEW.status_reason = 'temporary_storage_failure' AND (
         NEW.last_error_code IS DISTINCT FROM 'storage_unavailable' OR
         NEW.last_error_at IS NULL
       ) THEN
      RAISE EXCEPTION 'only a timestamped storage_unavailable failure is retryable' USING ERRCODE = '23514';
    END IF;

    IF NEW.status IN ('rejected', 'expired') AND NOT is_content_purge THEN
      RAISE EXCEPTION 'rejected and expired operations must purge content in the same transition' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.payload_purged_at IS NULL THEN
    IF NEW.decision_envelope IS NULL OR NEW.patch_payload IS NULL OR NEW.source_refs IS NULL OR NEW.patch_hash IS NULL THEN
      RAISE EXCEPTION 'unpurged operation requires its complete immutable content' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.decision_envelope) <> 'object' OR
       jsonb_typeof(NEW.patch_payload) <> 'object' OR
       jsonb_typeof(NEW.source_refs) <> 'array' OR
       jsonb_array_length(NEW.source_refs) = 0 THEN
      RAISE EXCEPTION 'operation content has an invalid JSON shape' USING ERRCODE = '23514';
    END IF;
    IF NEW.patch_payload ->> 'proposal_id' <> NEW.proposal_id OR
       NEW.patch_payload ->> 'patch_hash' <> NEW.patch_hash OR
       NEW.decision_envelope ->> 'envelope_id' <> NEW.decision_envelope_id OR
       NEW.decision_envelope ->> 'space_id' <> NEW.space_id OR
       NEW.decision_envelope ->> 'principal_ref' <> NEW.owner_ref THEN
      RAISE EXCEPTION 'operation content does not match its security partition' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status IN ('ready', 'applying') OR (NEW.status = 'applied' AND NEW.payload_purged_at IS NULL) THEN
    IF NEW.confirmation IS NULL OR NEW.confirmed_patch_hash IS NULL OR
       NEW.confirmed_patch_hash IS DISTINCT FROM NEW.patch_hash OR
       NEW.confirmation ->> 'operation_id' <> NEW.operation_id OR
       NEW.confirmation ->> 'patch_hash' <> NEW.patch_hash OR
       NEW.confirmation ->> 'principal_ref' <> NEW.owner_ref THEN
      RAISE EXCEPTION 'confirmation must match operation, patch and principal' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status = 'pending_confirmation' AND
     (NEW.confirmation IS NOT NULL OR NEW.confirmed_patch_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'pending operation cannot contain confirmation' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'failed' AND (NEW.last_error_at IS NULL OR NEW.last_error_code IS NULL) THEN
    RAISE EXCEPTION 'failed operations require closed error metadata' USING ERRCODE = '23514';
  END IF;

  IF NEW.status IN ('applied', 'rejected', 'expired', 'conflict', 'failed') AND NEW.next_retry_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal operations cannot retain a retry schedule' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION product_context_stage1.enforce_write_operation_contract() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_write_operation_contract
  ON product_context_stage1.knowledge_write_operations;
CREATE TRIGGER enforce_write_operation_contract
BEFORE INSERT OR UPDATE ON product_context_stage1.knowledge_write_operations
FOR EACH ROW EXECUTE FUNCTION product_context_stage1.enforce_write_operation_contract();

ALTER TABLE product_context_stage1.knowledge_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_stage1.knowledge_spaces FORCE ROW LEVEL SECURITY;
ALTER TABLE product_context_stage1.knowledge_write_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_context_stage1.knowledge_write_operations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_spaces_owner_policy
  ON product_context_stage1.knowledge_spaces;
CREATE POLICY knowledge_spaces_owner_policy
  ON product_context_stage1.knowledge_spaces
  TO product_context_stage1_app
  USING (owner_ref = NULLIF(current_setting('cubica.principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.principal_ref', true), ''));

DROP POLICY IF EXISTS knowledge_write_operations_owner_policy
  ON product_context_stage1.knowledge_write_operations;
CREATE POLICY knowledge_write_operations_owner_policy
  ON product_context_stage1.knowledge_write_operations
  TO product_context_stage1_app
  USING (owner_ref = NULLIF(current_setting('cubica.principal_ref', true), ''))
  WITH CHECK (owner_ref = NULLIF(current_setting('cubica.principal_ref', true), ''));

REVOKE ALL ON ALL TABLES IN SCHEMA product_context_stage1 FROM PUBLIC;
REVOKE ALL
  ON product_context_stage1.knowledge_spaces,
     product_context_stage1.knowledge_write_operations
  FROM product_context_stage1_app;
GRANT SELECT, INSERT
  ON product_context_stage1.knowledge_spaces
  TO product_context_stage1_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON product_context_stage1.knowledge_write_operations
  TO product_context_stage1_app;
