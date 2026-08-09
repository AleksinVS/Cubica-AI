/* This file is generated from docs/architecture/schemas/product-knowledge/product-knowledge.schema.json. Do not edit it manually. */

export type ProductKnowledgeContracts =
  | KnowledgePage
  | ExactPatchProposal
  | DecisionEnvelope
  | ImpactAssessment
  | KnowledgeWriteOperation
  | SemanticReviewResult
  | ShadowAuthorizationReceipt
  | ConversationMessage
  | ConversationTurn
  | ModelGatewayRequest
  | ModelGatewayResult
  | ShadowContentFreeMetric;
export type SchemaVersion = '1.0.0';
export type RoleScope = 'developer' | 'facilitator' | 'global';
export type CubicaUri = string;
export type AppliesToUri =
  | {
      [k: string]: unknown | undefined;
    }
  | 'cubica://scope/all-user-games';
export type AppliesToUri1 = string;
export type Sha256 = string;
export type ExactPatchProposal = {
  [k: string]: unknown | undefined;
} & {
  schema_version: SchemaVersion;
  proposal_id: string;
  base_commit: string;
  /**
   * SHA-256 of cubica-product-context-patch/v1 followed by a newline and the recursively key-sorted UTF-8 JSON proposal with only this self-referential patch_hash field omitted.
   */
  patch_hash: string;
  /**
   * @minItems 1
   * @maxItems 20
   */
  operations: ExactPatchOperation[];
  /**
   * @minItems 1
   */
  source_refs: SourceRef[];
  /**
   * @minItems 1
   */
  applies_to: (AppliesToUri & AppliesToUri1)[];
};
export type ExactPatchOperation = {
  [k: string]: unknown | undefined;
} & {
  kind: 'replace_exact' | 'insert_before_exact' | 'insert_after_exact' | 'delete_exact' | 'create_file';
  path: string;
  base_file_hash?: Sha256;
  old_text?: string;
  old_text_hash?: Sha256;
  new_text?: string;
  expected_matches?: 1;
  reason: string;
  /**
   * @minItems 1
   */
  source_refs: SourceRef[];
};
export type KnowledgeWriteOperation = {
  [k: string]: unknown | undefined;
} & {
  schema_version: SchemaVersion;
  operation_id: string;
  space_id: string;
  creator_ref: CubicaUri;
  idempotency_key: string;
  proposal_id: string;
  patch_hash: Sha256 | null;
  status: 'pending_confirmation' | 'rejected' | 'expired' | 'ready' | 'applying' | 'applied' | 'failed' | 'conflict';
  status_reason:
    | 'awaiting_confirmation'
    | 'explicitly_rejected'
    | 'confirmation_expired'
    | 'ready_to_apply'
    | 'lease_expired'
    | 'temporary_storage_failure'
    | 'base_revision_changed'
    | 'read_set_changed'
    | 'impact_changed'
    | 'authorization_changed'
    | 'policy_changed'
    | 'requires_extended_review'
    | 'invalid_payload'
    | 'secret_detected'
    | 'git_ref_conflict'
    | 'applied'
    | 'payload_purged';
  decision_envelope_id: string;
  decision_envelope?: DecisionEnvelope | null;
  patch_payload?: ExactPatchProposal | null;
  source_refs?: SourceRef[] | null;
  confirmation?: {
    operation_id: string;
    patch_hash: Sha256;
    principal_ref: CubicaUri;
    method: 'exact_command' | 'user_confirmation' | 'domain_action';
    confirmed_at: string;
  } | null;
  confirmed_patch_hash?: Sha256 | null;
  commit_sha?: string;
  attempt_count: number;
  lease_owner?: string | null;
  lease_expires_at?: string;
  next_retry_at?: string;
  last_error_at?: string;
  last_error_code?:
    'storage_unavailable' | 'git_ref_conflict' | 'invalid_payload' | 'authorization_changed' | 'policy_changed';
  applied_at?: string;
  payload_purged_at?: string;
  created_at: string;
};
export type ShadowGameUri = string;
export type ConversationMessage = {
  [k: string]: unknown | undefined;
} & {
  schema_version: SchemaVersion;
  message_ref: CubicaUri;
  thread_ref: CubicaUri;
  stable_turn_key: string;
  sequence: number;
  actor: 'user' | 'agent';
  revision: Sha256;
  content_hash: Sha256;
  byte_length: number;
  content_base64: string | null;
  tombstone: boolean;
  retained_until: string;
  created_at: string;
  deleted_at?: string;
};
export type ModelGatewayResult = {
  [k: string]: unknown | undefined;
} & {
  schema_version: SchemaVersion;
  request_id: string;
  outcome: 'proposal' | 'no_change';
  proposal: ExactPatchProposal | null;
};

export interface KnowledgePage {
  schema_version: SchemaVersion;
  type: 'decision' | 'preference' | 'constraint' | 'note';
  title: string;
  description: string;
  timestamp: string;
  cubica_id: string;
  role_scope: RoleScope;
  subject_key?: string;
  /**
   * @minItems 1
   */
  source_refs: SourceRef[];
  /**
   * @minItems 1
   */
  applies_to: (AppliesToUri & AppliesToUri1)[];
  depends_on?: DependencyRef[];
  state?: 'active' | 'disputed';
  body: string;
}
export interface SourceRef {
  ref: CubicaUri;
  use: 'evidence' | 'wording' | 'context' | 'confirmation';
}
export interface DependencyRef {
  ref: CubicaUri;
  relation: 'derives_from';
  content_hash: Sha256;
}
export interface DecisionEnvelope {
  schema_version: SchemaVersion;
  envelope_id: string;
  space_id: string;
  principal_ref: CubicaUri;
  role_scope: RoleScope;
  target_ref: CubicaUri;
  /**
   * @minItems 1
   */
  applies_to: (AppliesToUri & AppliesToUri1)[];
  /**
   * @minItems 1
   */
  read_set: ReadSetEntry[];
  policy_decisions: {
    access: {
      decision: 'allow' | 'deny';
      version: string;
    };
    retention: {
      decision: 'allow' | 'deny';
      version: string;
    };
    external_processing: {
      decision: 'allow' | 'deny';
      version: string;
    };
  };
  /**
   * SHA-256 of cubica-product-context-impact/v1 followed by a newline and recursively key-sorted UTF-8 JSON payload.
   */
  impact_hash: string;
  created_at: string;
}
export interface ReadSetEntry {
  ref: CubicaUri;
  kind: 'page' | 'message' | 'domain_version' | 'policy' | 'impact_query';
  purpose: 'target' | 'decision_basis' | 'constraint' | 'navigation' | 'semantic_candidate';
  revision: string;
  content_hash: Sha256;
}
export interface ImpactAssessment {
  schema_version: SchemaVersion;
  assessment_id: string;
  query: {
    kind: 'subject_key' | 'references' | 'literal_search' | 'dependencies';
    version: string;
    inputs: {
      [k: string]: unknown | undefined;
    };
    candidates: {
      ref: CubicaUri;
      revision: string;
    }[];
  };
  outcome: 'clear' | 'review_required' | 'conflict';
  /**
   * SHA-256 of cubica-product-context-impact/v1 followed by a newline and recursively key-sorted UTF-8 JSON payload.
   */
  result_hash: string;
  affected_refs?: CubicaUri[];
  checked_at: string;
}
export interface SemanticReviewResult {
  schema_version: SchemaVersion;
  review_id: string;
  operation_id: string;
  patch_hash: Sha256;
  impact_hash: Sha256;
  outcome:
    | 'no_issue'
    | 'duplicate'
    | 'contradiction'
    | 'scope_overlap'
    | 'dependent_page_may_be_stale'
    | 'requires_extended_review';
  related_refs?: CubicaUri[];
  checked_at: string;
}
export interface ShadowAuthorizationReceipt {
  schema_version: SchemaVersion;
  decision: 'allow';
  shadow_principal_ref: CubicaUri;
  role_scope: 'developer';
  /**
   * @minItems 1
   * @maxItems 1
   */
  applies_to: ShadowGameUri[];
  access_policy_ref: string;
  access_policy_revision: string;
  retention_policy_ref: string;
  retention_policy_revision: string;
  external_processing_policy_ref: string;
  external_processing_policy_revision: string;
  authorization_revision: Sha256;
  issued_at: string;
  expires_at: string;
}
export interface ConversationTurn {
  schema_version: SchemaVersion;
  turn_ref: CubicaUri;
  thread_ref: CubicaUri;
  stable_turn_key: string;
  user_message: ConversationMessage;
  agent_message: ConversationMessage;
  created_at: string;
}
export interface ModelGatewayRequest {
  schema_version: SchemaVersion;
  request_id: string;
  authorization_revision: Sha256;
  shadow_principal_ref: CubicaUri;
  /**
   * @minItems 1
   * @maxItems 1
   */
  applies_to: ShadowGameUri[];
  access_policy_ref: string;
  access_policy_revision: string;
  retention_policy_ref: string;
  retention_policy_revision: string;
  external_processing_policy_ref: string;
  external_processing_policy_revision: string;
  external_processing_decision: 'allow' | 'deny';
  /**
   * @minItems 2
   * @maxItems 2
   */
  messages: ModelGatewayMessage[];
}
export interface ModelGatewayMessage {
  message_ref: CubicaUri;
  actor: 'user' | 'agent';
  revision: Sha256;
  content_hash: Sha256;
  content_base64: string;
}
export interface ShadowContentFreeMetric {
  schema_version: SchemaVersion;
  metric_id: string;
  run_id: string;
  request_id: string | null;
  outcome:
    | 'success'
    | 'no_change'
    | 'disabled'
    | 'policy_denied'
    | 'authorization_changed'
    | 'message_changed'
    | 'message_deleted'
    | 'retention_expired'
    | 'gateway_timeout'
    | 'gateway_malformed'
    | 'gateway_oversize'
    | 'gateway_error'
    | 'gateway_outcome_unknown';
  duration_ms: number;
  input_bytes: number;
  output_bytes: number;
  proposal_operation_count: number;
  authorization_revision: Sha256;
  external_processing_policy_ref: string;
  external_processing_policy_revision: string;
  recorded_at: string;
}
