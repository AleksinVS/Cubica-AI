/**
 * Schema-backed contract validation for the isolated product-knowledge core.
 *
 * JSON Schema is the structural source of truth. These helpers intentionally
 * compile that schema with strict Ajv 2020-12 settings instead of duplicating
 * its shape in TypeScript predicates; TypeScript types are generated only for
 * callers that already passed this runtime boundary.
 */
import { createHash } from 'node:crypto';
import Ajv2020Module, { type ErrorObject, type Options, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import productKnowledgeSchema from '../../../docs/architecture/schemas/product-knowledge/product-knowledge.schema.json' with { type: 'json' };

import type {
  DecisionEnvelope,
  ExactPatchProposal,
  ImpactAssessment,
  KnowledgePage,
  KnowledgeWriteOperation,
  SemanticReviewResult,
  ShadowAuthorizationReceipt,
  ConversationMessage,
  ConversationTurn,
  ModelGatewayRequest,
  ModelGatewayResult,
  ShadowContentFreeMetric,
  ShadowEvaluationManifest,
  ShadowEvaluationReport
} from './generated/product-knowledge.ts';

export type ProductKnowledgeContractName =
  | 'KnowledgePage'
  | 'ExactPatchProposal'
  | 'DecisionEnvelope'
  | 'ImpactAssessment'
  | 'KnowledgeWriteOperation'
  | 'SemanticReviewResult'
  | 'ShadowAuthorizationReceipt'
  | 'ConversationMessage'
  | 'ConversationTurn'
  | 'ModelGatewayRequest'
  | 'ModelGatewayResult'
  | 'ShadowContentFreeMetric'
  | 'ShadowEvaluationManifest'
  | 'ShadowEvaluationReport';

export type ProductKnowledgeContract =
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
  | ShadowContentFreeMetric
  | ShadowEvaluationManifest
  | ShadowEvaluationReport;

/** The fully qualified schema identifier used by all strict Ajv validators. */
export const productKnowledgeSchemaId = productKnowledgeSchema.$id;

interface Ajv2020Instance {
  addSchema(schema: object): Ajv2020Instance;
  getSchema(keyRef: string): ValidateFunction | undefined;
}
type Ajv2020Constructor = new (options?: Options) => Ajv2020Instance;
type AddFormats = (instance: Ajv2020Instance) => Ajv2020Instance;

// Ajv publishes CommonJS-compatible defaults; this narrow cast preserves the
// strict validator API under NodeNext without replacing schema validation.
const Ajv2020 = Ajv2020Module as unknown as Ajv2020Constructor;
const addFormats = addFormatsModule as unknown as AddFormats;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(productKnowledgeSchema);

function validatorFor(name: ProductKnowledgeContractName): ValidateFunction {
  const validator = ajv.getSchema(`${productKnowledgeSchemaId}#/$defs/${name}`);
  if (!validator) throw new Error(`Missing compiled Product Knowledge schema definition: ${name}`);
  return validator;
}

/**
 * Validates one named public contract and returns Ajv diagnostics on failure.
 * The returned value is only narrowed after the canonical schema accepted it.
 */
export function validateProductKnowledgeContract<T extends ProductKnowledgeContract>(
  name: ProductKnowledgeContractName,
  candidate: unknown
): { ok: true; value: T } | { ok: false; errors: readonly ErrorObject[] } {
  const validator = validatorFor(name);
  if (validator(candidate)) return { ok: true, value: candidate as T };
  return { ok: false, errors: validator.errors ?? [] };
}

const evaluationCategories = [
  'transient_conversation', 'existing_fact', 'unconfirmed_agent_suggestion',
  'confirmed_new_knowledge', 'correction'
] as const;

/** Semantic checks for the evaluator's fixed matrix and content-free report. */
export function validateShadowEvaluationManifest(value: unknown): value is ShadowEvaluationManifest {
  const checked = validateProductKnowledgeContract<ShadowEvaluationManifest>('ShadowEvaluationManifest', value);
  if (!checked.ok) return false;
  return checked.value.scenarios.every((scenario, index) => scenario.category === evaluationCategories[index]) &&
    new Set(checked.value.scenarios.map((scenario) => scenario.stable_turn_key)).size === 5;
}

/** Schema validation plus lifecycle/order invariants that JSON Schema cannot express. */
export function validateShadowEvaluationReport(value: unknown): value is ShadowEvaluationReport {
  const checked = validateProductKnowledgeContract<ShadowEvaluationReport>('ShadowEvaluationReport', value);
  if (!checked.ok) return false;
  const report = checked.value;
  if (report.scenarios.some((scenario, index) => scenario.category !== evaluationCategories[index])) return false;
  const expected = ['no_change', 'no_change', 'no_change', 'proposal', 'proposal'] as const;
  if (report.scenarios.some((scenario, index) => scenario.expected_outcome !== expected[index])) return false;
  const reviewFields = (scenario: typeof report.scenarios[number]) => [scenario.review_expected_outcome, scenario.review_all_and_only_confirmed_facts, scenario.review_correct_page_minimal_patch, scenario.review_no_duplicate_contradiction_unrelated_rewrite];
  if (report.scenarios.some((scenario) => { const values = reviewFields(scenario); return values.some((value) => value === null) && values.some((value) => value !== null); })) return false;
  if (!report.cleanup.started && (report.cleanup.initial_runs !== 0 || report.cleanup.initial_metrics !== 0 || report.cleanup.initial_messages !== 0 || report.cleanup.initial_threads !== 0 || report.cleanup.runs_deleted !== 0 || report.cleanup.metrics_deleted !== 0 || report.cleanup.messages_tombstoned !== 0 || report.cleanup.threads_tombstoned !== 0)) return false;
  if (report.cleanup.started && (report.cleanup.runs_deleted !== Math.max(0, report.cleanup.initial_runs - report.cleanup.active_runs) || report.cleanup.metrics_deleted !== Math.max(0, report.cleanup.initial_metrics - report.cleanup.active_metrics) || report.cleanup.messages_tombstoned !== Math.max(0, report.cleanup.initial_messages - report.cleanup.active_messages) || report.cleanup.threads_tombstoned !== Math.max(0, report.cleanup.initial_threads - report.cleanup.active_threads))) return false;
  if (report.cleanup.passed && (report.cleanup.active_runs !== 0 || report.cleanup.active_metrics !== 0 || report.cleanup.active_messages !== 0 || report.cleanup.active_threads !== 0 || report.cleanup.active_text_bytes !== 0)) return false;
  if (report.cleanup.passed && report.status !== 'completed' && report.status !== 'hard_stopped') return false;
  if (report.scenarios.some((scenario) => scenario.git_unchanged !== report.git_unchanged)) return false;
  const reviewed = report.scenarios.map((scenario) => reviewFields(scenario).every((value) => value === true));
  const actualExpected = report.scenarios.every((scenario) => scenario.actual_outcome === scenario.expected_outcome);
  if (report.status === 'awaiting_review') {
    const currentIndex = report.scenarios.findIndex((scenario) => scenario.actual_outcome !== 'pending' && reviewFields(scenario).every((value) => value === null));
    if (currentIndex < 0) return false;
    const current = report.scenarios[currentIndex]!;
    if (current.actual_outcome !== current.expected_outcome || report.scenarios.slice(currentIndex + 1).some((scenario) => scenario.actual_outcome !== 'pending')) return false;
    if (report.scenarios.slice(0, currentIndex).some((scenario) => !reviewFields(scenario).every((value) => value === true) || scenario.actual_outcome !== scenario.expected_outcome)) return false;
  }
  if (report.status === 'ready') {
    const next = report.scenarios.findIndex((scenario) => scenario.actual_outcome === 'pending');
    if (next < 0 || report.scenarios.slice(0, next).some((scenario) => !reviewFields(scenario).every((value) => value === true) || scenario.actual_outcome !== scenario.expected_outcome) || report.scenarios.slice(next).some((scenario) => scenario.actual_outcome !== 'pending' || !reviewFields(scenario).every((value) => value === null))) return false;
  }
  if ((report.status === 'ready_for_cleanup' || report.status === 'completed') && (!actualExpected || !reviewed.every(Boolean))) return false;
  if (report.status === 'completed' && (!report.cleanup.passed || !report.git_unchanged)) return false;
  if (report.status === 'hard_stopped') {
    const hasReason = !report.git_unchanged || report.scenarios.some((scenario) =>
      (scenario.actual_outcome !== 'pending' && scenario.actual_outcome !== scenario.expected_outcome) ||
      reviewFields(scenario).some((value) => value === false));
    if (!hasReason) return false;
  }
  return true;
}

/**
 * Produces a reproducible digest of a JSON payload without trusting property
 * insertion order. Domain prefixes prevent the same JSON bytes from being
 * reused as a hash in a different product-knowledge decision.
 */
export async function hashCanonicalPayload(
  domain: 'patch' | 'impact',
  payload: unknown
): Promise<`sha256:${string}`> {
  const canonical = JSON.stringify(sortJson(payload));
  const bytes = new TextEncoder().encode(`cubica-product-context-${domain}/v1\n${canonical}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Synchronous form used inside the deliberately synchronous bare-Git boundary. */
export function hashCanonicalPayloadSync(
  domain: 'patch' | 'impact',
  payload: unknown
): `sha256:${string}` {
  const canonical = JSON.stringify(sortJson(payload));
  return `sha256:${createHash('sha256').update(`cubica-product-context-${domain}/v1\n${canonical}`, 'utf8').digest('hex')}`;
}

/**
 * Computes the proposal receipt over every proposal field except patch_hash.
 * Excluding that single self-referential field makes the digest reproducible;
 * proposal_id, base_commit, applicability, sources and exact operations remain
 * bound by the receipt.
 */
export function hashExactPatchProposal(proposal: ExactPatchProposal): `sha256:${string}` {
  const { patch_hash: _excludedSelfHash, ...content } = proposal;
  return hashCanonicalPayloadSync('patch', content);
}

/** Rejects a schema-shaped proposal whose claimed receipt does not bind its content. */
export function verifyExactPatchProposalHash(proposal: ExactPatchProposal): boolean {
  return proposal.patch_hash === hashExactPatchProposal(proposal);
}

/** Recursively sorts ordinary JSON objects; arrays retain their semantic order. */
function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}
