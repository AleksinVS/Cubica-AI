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
 * - `prototype-extraction.ts`— local prototype extraction (ADR-050)
 * - `reverse-projection.ts`  — UI edit intents back into JSON Patch
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
  pointerAffectsLens
} from "./entity-projection.ts";

// Cross-cutting semantic pointer predicate for incremental invalidation.
export { pointersOverlap } from "./semantics.ts";

// JSON Schema validation and semantic diagnostics.
export { createSchemaRegistry, validateDocument, validateJsonValue } from "./schema.ts";

// Local prototype extraction (ADR-050).
export { createPrototypeExtractionProposal, discoverPrototypeExtractionCandidates } from "./prototype-extraction.ts";

// Reverse projection of UI edit intents into JSON Patch.
export { reverseProjectIntent } from "./reverse-projection.ts";
