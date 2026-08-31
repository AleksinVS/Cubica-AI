/**
 * Deny-by-default HTTP boundary for the Stage 2 shadow model call.
 *
 * The adapter accepts only a canonical request with an explicit external
 * processing allow decision, bounds request/response bytes and time, and
 * validates the whole response against JSON Schema. It deliberately has no
 * logger callback, so exact content and credentials cannot enter logs here.
 */
import { validateProductKnowledgeContract, verifyExactPatchProposalHash } from './contracts.ts';
import type { ModelGatewayRequest, ModelGatewayResult } from './generated/product-knowledge.ts';
import { attachModelGatewayValidationStage, type ModelGatewayValidationStage } from './model-gateway-diagnostics.ts';

export type ModelGatewayErrorCode = 'policy_denied' | 'invalid_request' | 'timeout' | 'oversize_output' | 'malformed_output' | 'transport_error' | 'outcome_unknown';

/** Content-free gateway failure; adapter details remain on an internal channel. */
export class ModelGatewayError extends Error {
  constructor(
    readonly code: ModelGatewayErrorCode,
    readonly providerCode: string | null = null,
    readonly httpStatus: number | null = null
  ) {
    super(`Shadow model gateway failed: ${code}.`);
    this.name = 'ModelGatewayError';
  }
}

export interface ModelGatewayCall {
  readonly result: ModelGatewayResult;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly durationMs: number;
}

export interface ModelGateway {
  /** Exact UTF-8 JSON byte ceiling, including base64 expansion and metadata. */
  readonly maxRequestBytes: number;
  /** Hard upper bound for one provider call, used to keep the run lease safe. */
  readonly timeoutMs: number;
  call(request: ModelGatewayRequest): Promise<ModelGatewayCall>;
}

export const DEFAULT_MODEL_GATEWAY_MAX_REQUEST_BYTES = 512 * 1024;

export interface HttpModelGatewayOptions {
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
}

export class HttpModelGateway implements ModelGateway {
  private readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;

  constructor(private readonly options: HttpModelGatewayOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname))) {
      throw new TypeError('Shadow model gateway requires HTTPS or loopback HTTP.');
    }
    if (!options.bearerToken) throw new TypeError('A model gateway credential is required.');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = positiveBound(options.timeoutMs ?? 15_000, 'timeout');
    this.maxRequestBytes = positiveBound(options.maxRequestBytes ?? DEFAULT_MODEL_GATEWAY_MAX_REQUEST_BYTES, 'request limit');
    this.maxResponseBytes = positiveBound(options.maxResponseBytes ?? 512 * 1024, 'response limit');
    this.now = options.now ?? Date.now;
  }

  async call(request: ModelGatewayRequest): Promise<ModelGatewayCall> {
    if (!validateProductKnowledgeContract<ModelGatewayRequest>('ModelGatewayRequest', request).ok) throw new ModelGatewayError('invalid_request');
    if (request.external_processing_decision !== 'allow') throw new ModelGatewayError('policy_denied');
    const body = new TextEncoder().encode(JSON.stringify(request));
    if (body.byteLength > this.maxRequestBytes) throw new ModelGatewayError('invalid_request');

    const started = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${this.options.bearerToken}`, 'content-type': 'application/json' },
        body,
        signal: controller.signal
      });
      if (!response.ok) throw new ModelGatewayError('malformed_output');
      const output = await readBounded(response, this.maxResponseBytes);
      let candidate: unknown;
      try { candidate = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output)); }
      catch { throw new ModelGatewayError('malformed_output'); }
      const validated = validateModelGatewayResult(request, candidate);
      return { result: validated, inputBytes: body.byteLength, outputBytes: output.byteLength, durationMs: Math.max(0, Math.round(this.now() - started)) };
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ModelGatewayError('timeout');
      throw new ModelGatewayError('transport_error');
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Applies the provider-neutral result invariants after canonical schema
 * validation. Keeping this check shared prevents a provider adapter from
 * weakening request, scope, hash, or conversation-source binding.
 */
export function validateModelGatewayResult(request: ModelGatewayRequest, candidate: unknown): ModelGatewayResult {
  const validated = validateProductKnowledgeContract<ModelGatewayResult>('ModelGatewayResult', candidate);
  if (!validated.ok) throw malformed('result_schema');
  if (validated.value.request_id !== request.request_id ||
      (validated.value.proposal !== null &&
        (validated.value.proposal.applies_to.length !== 1 ||
         validated.value.proposal.applies_to[0] !== request.applies_to[0]))) {
    throw malformed('result_binding');
  }
  if (validated.value.proposal !== null && !verifyExactPatchProposalHash(validated.value.proposal)) {
    throw malformed('exact_patch');
  }
  if (validated.value.proposal !== null && !proposalSourcesMatchRequest(validated.value.proposal, request)) {
    throw malformed('proposal_provenance');
  }
  return validated.value;
}

function proposalSourcesMatchRequest(proposal: NonNullable<ModelGatewayResult['proposal']>, request: ModelGatewayRequest): boolean {
  const messageActors = new Map(request.messages.map((message) => [message.message_ref, message.actor] as const));
  const allSources = [...proposal.source_refs, ...proposal.operations.flatMap((operation) => operation.source_refs)];
  return proposal.source_refs.length > 0 && proposal.operations.every((operation) => operation.source_refs.length > 0) &&
    allSources.every((source) => {
      const actor = messageActors.get(source.ref);
      return actor === 'user' || (actor === 'agent' && (source.use === 'wording' || source.use === 'context'));
    }) &&
    allSources.some((source) => messageActors.get(source.ref) === 'user' && (source.use === 'evidence' || source.use === 'confirmation'));
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) throw new ModelGatewayError('oversize_output');
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new ModelGatewayError('oversize_output');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new ModelGatewayError('oversize_output');
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function positiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`A positive integer ${label} is required.`);
  return value;
}

function malformed(stage: ModelGatewayValidationStage): ModelGatewayError {
  return attachModelGatewayValidationStage(new ModelGatewayError('malformed_output'), stage);
}
