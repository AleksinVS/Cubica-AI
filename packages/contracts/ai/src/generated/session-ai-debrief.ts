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
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "Uuid".
 */
export type Uuid = string;
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string;

/**
 * A facilitator-only AI-derived debrief of one exact public gameplay journal.
 */
export interface SessionAiDebriefArtifact {
  format: "cubica.session-ai-debrief";
  schemaVersion: "1.0.0";
  artifactId: Uuid;
  requestId: Uuid;
  sessionId: string;
  gameId: string;
  status: "draft" | "confirmed";
  createdAt: string;
  confirmedAt?: string;
  provenance: SessionAiDebriefProvenance;
  sections: SessionAiDebriefSections;
  outputSha256: Sha256;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefProvenance".
 */
export interface SessionAiDebriefProvenance {
  throughEventSequence: number;
  journalSha256: Sha256;
  methodologyVersion: string;
  promptVersion: string;
  provider: "openai";
  model: string;
  usage: SessionAiDebriefUsage;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefUsage".
 */
export interface SessionAiDebriefUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefSections".
 */
export interface SessionAiDebriefSections {
  /**
   * @minItems 1
   * @maxItems 32
   */
  facts: [SessionAiDebriefFact, ...SessionAiDebriefFact[]];
  /**
   * @maxItems 32
   */
  interpretations: SessionAiDebriefInterpretation[];
  /**
   * @minItems 1
   * @maxItems 32
   */
  facilitatorQuestions: [SessionAiDebriefQuestion, ...SessionAiDebriefQuestion[]];
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefFact".
 */
export interface SessionAiDebriefFact {
  statement: string;
  /**
   * @minItems 1
   * @maxItems 16
   */
  evidenceEventIds:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefInterpretation".
 */
export interface SessionAiDebriefInterpretation {
  statement: string;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefQuestion".
 */
export interface SessionAiDebriefQuestion {
  question: string;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefGenerateRequest".
 */
export interface SessionAiDebriefGenerateRequest {
  requestId: Uuid;
}
/**
 * This interface was referenced by `SessionAiDebriefArtifact`'s JSON-Schema
 * via the `definition` "SessionAiDebriefConfirmRequest".
 */
export interface SessionAiDebriefConfirmRequest {
  outputSha256: Sha256;
}
