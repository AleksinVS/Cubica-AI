/**
 * Framework-agnostic editor primitives for ADR-034.
 *
 * This package treats authoring files as plain JSON documents. UI layers may
 * render graphs, inspectors, or text editors, but all edits return to the same
 * JSON Patch path so the package stays independent from React, Monaco, games,
 * and runtime-specific manifest shapes.
 *
 * This file is a thin FACADE (barrel): the implementation lives in cohesive
 * sibling modules and is re-exported here so the public import surface
 * (`@cubica/editor-engine`) is preserved. See each module's header for its
 * responsibility. When adding a new export, add it to the owning module and
 * re-export it here.
 *
 * Modules:
 * - `types.ts`               — all public type/interface contracts
 * - `shared.ts`              — dependency-free JSON/token/diagnostic helpers
 * - `json-pointer-patch.ts`  — JSON Pointer + JSON Patch (apply/inverse)
 * - `document-store.ts`      — document store and text-location mapping
 * - `change-set.ts`          — ChangeSet dry-run gate + patch journal
 * - `change-risk.ts`         — ChangeSet operation risk classification
 * - `tree-view.ts`           — JSON tree and entity tree view models
 * - `graph-projection.ts`    — authoring graph projection
 * - `role-inference.ts`      — semantic role/title/summary inference
 * - `semantics.ts`           — cross-cutting semantic-entity predicates
 * - `preview.ts`             — preview geometry, hit-testing, playthrough traces
 * - `entity-projection.ts`   — editor entity projection + YAML + timeline
 * - `schema.ts`              — JSON Schema validation + semantic diagnostics
 * - `state-fixture.ts`       — state fixture hash + semantic validation (ADR-057)
 * - `prototype-extraction.ts`— local prototype extraction (ADR-050)
 * - `reverse-projection.ts`  — UI edit intents back into JSON Patch
 * - `intent-queue.ts`        — agent intent queue + optimistic-concurrency conflict (ADR-057 §4.11)
 */

// All public type contracts.
export * from "./types.ts";

// Canonical, single-source `isPlainJsonObject` (LEGACY-0018): re-exported so
// editor-web and other consumers reuse one implementation instead of copies.
export { isPlainJsonObject } from "./shared.ts";

// JSON Pointer and JSON Patch primitives.
export {
  applyJsonPatch,
  applyJsonPatchWithInverse,
  buildJsonPointer,
  decodeJsonPointerSegment,
  encodeJsonPointerSegment,
  parseJsonPointer,
  readJsonPointer
} from "./json-pointer-patch.ts";

// Document store and text hashing.
export { hashEditorText } from "./shared.ts";
export { createDocumentStore } from "./document-store.ts";

// ChangeSet dry-run gate and journal steps.
export { createPatchJournalStep, dryRunEditorChangeSet } from "./change-set.ts";

// Operation risk policy for editor ChangeSets (ADR-057 §4.5).
export { classifyChangeSet } from "./change-risk.ts";

// JSON tree and entity tree view models.
export { TreeViewModelBuilder, buildEntityTreeViewModel, buildTreeViewModel } from "./tree-view.ts";

// Grouping-aware entity tree ("По экранам" / "По типам") over the project
// projection (ADR-057 §4.6, editor-preview-first-ux §7). Pure JSON logic with NO
// node dependency, so it is safe in this browser-reachable barrel.
export { buildEntityGroupingTreeViewModel } from "./entity-grouping-tree.ts";

// Authoring graph projection.
export { buildAuthoringGraphProjection, buildVisibleAuthoringGraphProjection } from "./graph-projection.ts";

// Preview geometry, hit-testing, and playthrough traces.
export {
  appendPreviewPlaythroughEvent,
  buildPreviewTraceRestorePlan,
  createPreviewPlaythroughTrace,
  createStaticPreviewRendererAdapter,
  hitTestPreviewPoint,
  hitTestPreviewRect,
  normalizePreviewRect,
  previewRectContainsPoint,
  previewRectsIntersect,
  sortPreviewEntitiesTopmostFirst
} from "./preview.ts";

// Editor entity projection, YAML projection, and chronology timeline.
// Also the projection lens read-dependency declarations and the incremental
// invalidation helpers that build on them (ADR-057 §4.13).
export {
  PROJECTION_LENSES,
  PROJECTION_LENS_SET_VERSION,
  buildEditorEntityProjection,
  buildEditorEntityYamlProjection,
  buildManifestChronologyTimeline,
  collectAffectedEntities,
  createEditorEntityProjectionState,
  inferEditorEntityDocumentChannel,
  inferEditorEntityDocumentKind,
  pointerAffectsLens,
  reindexEditorEntityProjection,
  updateEditorEntityProjection
} from "./entity-projection.ts";

// Cross-cutting semantic pointer predicate for incremental invalidation.
export { pointersOverlap } from "./semantics.ts";

// Disk warm-start cache serialization for DocumentStore snapshots (ADR-057
// §4.13 "Уровень 2"). These are pure JSON transforms with NO node dependency, so
// they are safe in this browser-reachable barrel; the actual disk I/O lives in
// the editor-web server library. `createTextLocationMapFromEntries` is the
// map-rebuild primitive the revive step relies on.
export {
  DOCUMENT_SNAPSHOT_CACHE_FORMAT_VERSION,
  reviveDocumentSnapshot,
  serializeDocumentSnapshot
} from "./document-snapshot-serialization.ts";
export type {
  SerializedDocumentSnapshot,
  SerializedDocumentSnapshotEnvelope
} from "./document-snapshot-serialization.ts";
export { createTextLocationMapFromEntries } from "./document-store.ts";

// Disk warm-start cache serialization for the ENTITY PROJECTION (ADR-057 §4.13
// "Уровень 2 — проектные артефакты"). Pure JSON transforms with NO node
// dependency, so they are safe in this browser-reachable barrel: the disk I/O
// lives in the editor-web server library, while the REVIVE runs in the browser
// during client hydration (warm start).
export {
  EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
  reviveEditorEntityProjection,
  serializeEditorEntityProjection
} from "./editor-entity-projection-serialization.ts";
export type {
  SerializedEditorEntityProjection,
  SerializedEditorEntityProjectionEnvelope
} from "./editor-entity-projection-serialization.ts";

// JSON Schema validation and semantic diagnostics.
export { createSchemaRegistry, validateDocument, validateJsonValue } from "./schema.ts";

// State fixtures: schema id and the fixture-specific semantic checks
// (ADR-057 §4.9, §9.3; design-spec §2.5, §4). The hash PRODUCER
// (computeManifestContentHash) is deliberately NOT re-exported here: it needs
// `node:crypto`, and this barrel is reachable from browser bundles. Node-side
// consumers import it via the `@cubica/editor-engine/state-fixture-hash`
// subpath (package.json `exports`).
export {
  FIXTURE_STALE_DIAGNOSTIC_CODE,
  FIXTURE_UNKNOWN_REF_DIAGNOSTIC_CODE,
  STATE_FIXTURE_SCHEMA_ID,
  collectManifestChronologyStepIds,
  collectUiScreenIds,
  validateStateFixtureSemantics
} from "./state-fixture.ts";
export type { ValidateStateFixtureSemanticsInput } from "./state-fixture.ts";
export type { ManifestContentFile } from "./state-fixture-hash.ts";

// Local prototype extraction (ADR-050).
export { createPrototypeExtractionProposal, discoverPrototypeExtractionCandidates } from "./prototype-extraction.ts";

// Entity create/delete/refactor operations as EditorChangeSet builders
// (ADR-057 §4.2/§4.5/§4.10; editor-preview-first-ux §9.1; design-spec §2.8;
// ADR-050). Pure, deterministic, framework-agnostic builders — the multi-document
// apply and UI are Phase 6.2. `slugifyEntityId` is exported for reuse/testing of
// the id-slug rule.
export {
  buildAddViewFacetChangeSet,
  buildCreateEntityChangeSet,
  buildCreatePrototypeChangeSet,
  buildDeleteEntityChangeSet,
  buildFillEntityLabelChangeSet,
  buildFillMissingLabelsChangeSet,
  buildRenameEntityIdChangeSet,
  slugifyEntityId
} from "./entity-operations.ts";
export type {
  BuildAddViewFacetInput,
  BuildAddViewFacetResult,
  BuildFillEntityLabelInput,
  BuildFillEntityLabelResult,
  BuildFillMissingLabelsInput,
  BuildFillMissingLabelsResult,
  BuildCreateEntityInput,
  BuildCreateEntityResult,
  BuildCreatePrototypeInput,
  BuildCreatePrototypeResult,
  BuildDeleteEntityInput,
  BuildDeleteEntityResult,
  BuildRenameEntityIdInput,
  BuildRenameEntityIdResult,
  DeleteReferencePolicy,
  EntityIncomingReference,
  EntityOperationReport
} from "./entity-operations.ts";

// Reverse projection of UI edit intents into JSON Patch.
export { reverseProjectIntent } from "./reverse-projection.ts";

// Returned-intent interpreter for text-mode editing (ADR-057 §4.4, §5;
// design-spec §2.2). Pure, network-free JSON logic — safe in this
// browser-reachable barrel; the LLM agent call it signals lives in Phase 4.2.
export { interpretReturnedIntent } from "./returned-intent.ts";
export type { InterpretReturnedIntentOptions } from "./returned-intent.ts";

// Agent intent queue with optimistic concurrency (ADR-057 §4.11;
// editor-preview-first-ux §9.5; design-spec §2.4). Pure, deterministic,
// framework-agnostic queue structure + conflict detection; the agent-path
// integration and cancel wiring live in editor-web. Manual form edits NEVER
// enter this queue — they apply immediately.
export {
  INTENT_STALE_DIAGNOSTIC_CODE,
  canTransitionIntentStatus,
  changedPointersFromDiffSummary,
  createIntentQueue,
  detectIntentConflict,
  enqueueIntent,
  hasActiveIntent,
  nextPendingIntentId,
  promoteNextRunnableIntent,
  refineIntentPointers,
  selectJournalEntriesSince,
  transitionIntent,
  unionIntentPointers
} from "./intent-queue.ts";
export type {
  EnqueueIntentInput,
  IntentJournalEntry,
  IntentQueue,
  IntentQueueEntry,
  QueuedIntent,
  QueuedIntentStatus
} from "./intent-queue.ts";
