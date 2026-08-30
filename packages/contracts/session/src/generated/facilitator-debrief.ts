/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical JSON Schema in docs/architecture/schemas/ (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   npm run generate:contracts
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string;
/**
 * @minItems 1
 * @maxItems 64
 *
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "EventSequenceReferences".
 */
export type EventSequenceReferences = [number, ...number[]];

/**
 * Facilitator-only status and accepted AI debrief draft derived from a pinned gameplay journal boundary.
 */
export interface FacilitatorDebriefResponse {
  format: "cubica.facilitator-debrief";
  schemaVersion: "1.0.0";
  sessionId: string;
  gameId: string;
  status: "absent" | "generating" | "ready" | "failed";
  canGenerate: boolean;
  runId?: string;
  requestedAt?: string;
  completedAt?: string;
  journalSha256?: Sha256;
  throughEventSequence?: number;
  provider?: "z.ai";
  model?: "glm-4.7";
  promptVersion?: "facilitator-debrief-ru-v1";
  draft?: FacilitatorDebriefDraft;
  error?: FacilitatorDebriefError;
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefDraft".
 */
export interface FacilitatorDebriefDraft {
  title: string;
  summary: string;
  /**
   * @minItems 1
   * @maxItems 32
   */
  facts: [FacilitatorDebriefFact, ...FacilitatorDebriefFact[]];
  /**
   * @maxItems 32
   */
  interpretations: FacilitatorDebriefInterpretation[];
  /**
   * @minItems 1
   * @maxItems 16
   */
  reflectionQuestions:
    | [FacilitatorDebriefQuestion]
    | [FacilitatorDebriefQuestion, FacilitatorDebriefQuestion]
    | [FacilitatorDebriefQuestion, FacilitatorDebriefQuestion, FacilitatorDebriefQuestion]
    | [FacilitatorDebriefQuestion, FacilitatorDebriefQuestion, FacilitatorDebriefQuestion, FacilitatorDebriefQuestion]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ]
    | [
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion,
        FacilitatorDebriefQuestion
      ];
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefFact".
 */
export interface FacilitatorDebriefFact {
  statement: string;
  eventSequences: EventSequenceReferences;
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefInterpretation".
 */
export interface FacilitatorDebriefInterpretation {
  statement: string;
  confidence: "low" | "medium" | "high";
  eventSequences: EventSequenceReferences;
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefQuestion".
 */
export interface FacilitatorDebriefQuestion {
  question: string;
  eventSequences: EventSequenceReferences;
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefError".
 */
export interface FacilitatorDebriefError {
  code:
    | "provider_unavailable"
    | "provider_timeout"
    | "provider_rejected"
    | "provider_outcome_unknown"
    | "provider_invalid_response"
    | "input_too_large"
    | "internal_error";
  message: string;
}
/**
 * This interface was referenced by `FacilitatorDebriefResponse`'s JSON-Schema
 * via the `definition` "FacilitatorDebriefGenerationRequest".
 */
export interface FacilitatorDebriefGenerationRequest {
  expectedStateVersion: number;
}
