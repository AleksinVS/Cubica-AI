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
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "JsonValue".
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [k: string]: JsonValue;
    };
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "JsonPatchOperation".
 */
export type JsonPatchOperation =
  | {
      op: "add";
      path: string;
      value: JsonValue;
    }
  | {
      op: "replace";
      path: string;
      value: JsonValue;
    }
  | {
      op: "remove";
      path: string;
    }
  | {
      op: "test";
      path: string;
      value: JsonValue;
    };
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationRequest".
 */
export type EditorMutationRequest =
  EditorMutationPrepareRequest | EditorMutationConfirmRequest | EditorMutationDirectRequest;

export interface EditorMutationContracts {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSetJsonPatch".
 */
export interface EditorChangeSetJsonPatch {
  filePath: string;
  operations: JsonPatchOperation[];
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSetTextPatch".
 */
export interface EditorChangeSetTextPatch {
  filePath: string;
  description: string;
  beforeText?: string;
  afterText?: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSetFileCreate".
 */
export interface EditorChangeSetFileCreate {
  filePath: string;
  text: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSetFileDelete".
 */
export interface EditorChangeSetFileDelete {
  filePath: string;
  previousText?: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSetFileRename".
 */
export interface EditorChangeSetFileRename {
  fromFilePath: string;
  toFilePath: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorChangeSet".
 */
export interface EditorChangeSet {
  id: string;
  intentId?: string;
  summary: string;
  jsonPatches: EditorChangeSetJsonPatch[];
  textPatches?: EditorChangeSetTextPatch[];
  fileCreates?: EditorChangeSetFileCreate[];
  fileDeletes?: EditorChangeSetFileDelete[];
  fileRenames?: EditorChangeSetFileRename[];
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationActiveDocument".
 */
export interface EditorMutationActiveDocument {
  text: string;
  versionHash: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationPrepareRequest".
 */
export interface EditorMutationPrepareRequest {
  action: "prepare";
  gameId: string;
  sessionId: string;
  activeFilePath: string;
  activeDocument: EditorMutationActiveDocument;
  changeSet: EditorChangeSet;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationConfirmRequest".
 */
export interface EditorMutationConfirmRequest {
  action: "confirm";
  gameId: string;
  sessionId: string;
  activeFilePath: string;
  activeDocument: EditorMutationActiveDocument;
  changeSet: EditorChangeSet;
  effectDigest: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationDirectRequest".
 */
export interface EditorMutationDirectRequest {
  action: "direct";
  gameId: string;
  sessionId: string;
  activeFilePath: string;
  activeDocument: EditorMutationActiveDocument;
  changeSet: EditorChangeSet;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationDiagnostic".
 */
export interface EditorMutationDiagnostic {
  severity: "error" | "warning";
  source: string;
  pointer: string;
  message: string;
  filePath?: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationDiffSummaryItem".
 */
export interface EditorMutationDiffSummaryItem {
  filePath: string;
  pointer: string;
  operation: "add" | "replace" | "remove" | "test";
  description: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationDocument".
 */
export interface EditorMutationDocument {
  filePath: string;
  text: string;
  previousVersionHash: string;
  versionHash: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationPreview".
 */
export interface EditorMutationPreview {
  ready: boolean;
  playerUrl?: string;
  sourceMaps?: EditorMutationPreviewSourceMap[];
  diagnostics: EditorMutationDiagnostic[];
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationPreviewSourceMap".
 */
export interface EditorMutationPreviewSourceMap {
  generatedFile: string;
  sourceFile: string;
  mappings: {
    [k: string]: EditorMutationPreviewSource[];
  };
  verbatimSubtrees?: string[];
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationPreviewSource".
 */
export interface EditorMutationPreviewSource {
  file: string;
  pointer: string;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationPreparedResponse".
 */
export interface EditorMutationPreparedResponse {
  ok: true;
  status: "prepared";
  summary: string;
  effectDigest: string;
  risk: "safe" | "structural" | "dangerous";
  riskReasons: string[];
  documents: EditorMutationDocument[];
  inverseChangeSet: EditorChangeSet;
  changedPointersByFile: {
    [k: string]: string[];
  };
  diffSummary: EditorMutationDiffSummaryItem[];
  diagnostics: EditorMutationDiagnostic[];
  preview: EditorMutationPreview;
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationConfirmedResponse".
 */
export interface EditorMutationConfirmedResponse {
  ok: true;
  status: "confirmed" | "direct";
  summary: string;
  effectDigest: string;
  documents: EditorMutationDocument[];
  inverseChangeSet: EditorChangeSet;
  changedPointersByFile: {
    [k: string]: string[];
  };
  diffSummary: EditorMutationDiffSummaryItem[];
}
/**
 * This interface was referenced by `EditorMutationContracts`'s JSON-Schema
 * via the `definition` "EditorMutationNoOpResponse".
 */
export interface EditorMutationNoOpResponse {
  ok: true;
  status: "no-op";
  summary: string;
  diagnostics: EditorMutationDiagnostic[];
}
