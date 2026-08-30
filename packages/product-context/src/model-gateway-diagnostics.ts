import type { ModelGatewayError } from './model-gateway.ts';

/** Internal, content-free stages; deliberately not exported by the package entry point. */
export const MODEL_GATEWAY_VALIDATION_STAGES = [
  'provider_http',
  'provider_envelope',
  'candidate_json',
  'proposal_structure',
  'exact_patch',
  'result_schema',
  'result_binding',
  'timestamp_binding',
  'provenance',
  'final_page_policy'
] as const;
export type ModelGatewayValidationStage = typeof MODEL_GATEWAY_VALIDATION_STAGES[number];

const stages = new WeakMap<ModelGatewayError, ModelGatewayValidationStage>();
const stageSet = new Set<string>(MODEL_GATEWAY_VALIDATION_STAGES);

export function attachModelGatewayValidationStage(
  error: ModelGatewayError,
  stage: ModelGatewayValidationStage
): ModelGatewayError {
  stages.set(error, stage);
  return error;
}

export function modelGatewayValidationStage(error: ModelGatewayError): ModelGatewayValidationStage | null {
  return stages.get(error) ?? null;
}

export function modelGatewayValidationErrorCode(stage: unknown): string | null {
  return typeof stage === 'string' && stageSet.has(stage)
    ? `gateway_malformed:${stage}`
    : null;
}

export function modelGatewayValidationStageFromErrorCode(value: unknown): ModelGatewayValidationStage | null {
  if (typeof value !== 'string' || !value.startsWith('gateway_malformed:')) return null;
  const stage = value.slice('gateway_malformed:'.length);
  return stageSet.has(stage) ? stage as ModelGatewayValidationStage : null;
}
