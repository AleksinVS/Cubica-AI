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
  SemanticReviewResult
} from './generated/product-knowledge.ts';

export type ProductKnowledgeContractName =
  | 'KnowledgePage'
  | 'ExactPatchProposal'
  | 'DecisionEnvelope'
  | 'ImpactAssessment'
  | 'KnowledgeWriteOperation'
  | 'SemanticReviewResult';

export type ProductKnowledgeContract =
  | KnowledgePage
  | ExactPatchProposal
  | DecisionEnvelope
  | ImpactAssessment
  | KnowledgeWriteOperation
  | SemanticReviewResult;

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
