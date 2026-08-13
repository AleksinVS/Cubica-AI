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
 * This interface was referenced by `PortablePublicGameplayJournal`'s JSON-Schema
 * via the `definition` "CubicaJsonValue".
 */
export type CubicaJsonValue =
  | null
  | boolean
  | number
  | string
  | CubicaJsonValue[]
  | {
      [k: string]: CubicaJsonValue;
    };

/**
 * A read-only portable projection of confirmed public gameplay events.
 */
export interface PortablePublicGameplayJournal {
  format: "cubica.public-gameplay-journal";
  schemaVersion: "1.0.0";
  sessionId: string;
  gameId: string;
  lifecycle: "active" | "archived";
  sessionCreatedAt: string;
  archivedAt?: string;
  throughEventSequence: number;
  /**
   * @maxItems 65536
   */
  entries: PortablePublicGameplayJournalEntry[];
}
/**
 * This interface was referenced by `PortablePublicGameplayJournal`'s JSON-Schema
 * via the `definition` "PortablePublicGameplayJournalEntry".
 */
export interface PortablePublicGameplayJournalEntry {
  eventId: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  summary: CubicaJsonValue;
  data: {
    [k: string]: CubicaJsonValue;
  };
  /**
   * @maxItems 256
   */
  metricChanges?: PortablePublicGameplayJournalMetricChange[];
}
/**
 * This interface was referenced by `PortablePublicGameplayJournal`'s JSON-Schema
 * via the `definition` "PortablePublicGameplayJournalMetricChange".
 */
export interface PortablePublicGameplayJournalMetricChange {
  metricId: string;
  before: number;
  after: number;
}
