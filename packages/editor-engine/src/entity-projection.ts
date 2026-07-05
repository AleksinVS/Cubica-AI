/**
 * Editor entity projection (ADR-052) plus manifest chronology timeline.
 *
 * The entity projection is an in-memory index over one or more authoring
 * documents (game/ui). It records SOURCE POINTERS and derived labels, never
 * nested copies of authoring objects, so rebuilding or discarding it can never
 * change gameplay or UI output. It also cross-links steps to their actions,
 * content, and UI screens, emitting diagnostics for unresolved or ambiguous
 * links. The YAML projection renders a compact, human-facing view for prompt
 * assembly, and the timeline builder derives flow/step chronology.
 */
import { isPlainJsonObject, isScalar, normalizeToken, titleFromToken } from "./shared.ts";
import { appendPointerSegment, buildJsonPointer, lastPointerSegmentOrRoot, parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isSameOrDescendantPointer, pointersOverlap, resolveEntityTreeLabel } from "./semantics.ts";
import type {
  BuildEditorEntityProjectionInput,
  BuildEditorEntityYamlProjectionInput,
  BuildManifestTimelineInput,
  ChangedPointersByFile,
  DiagnosticSeverity,
  EditorEntity,
  EditorEntityDocumentKind,
  EditorEntityFacetKind,
  EditorEntityFieldDictionaryEntry,
  EditorEntityKind,
  EditorEntityProjection,
  EditorEntityProjectionDiagnostic,
  EditorEntityProjectionDiagnosticCode,
  EditorEntityProjectionDocument,
  EditorEntityProjectionState,
  EditorEntitySourcePointer,
  EditorEntityYamlProjection,
  IncrementalProjectionReport,
  JsonObject,
  JsonValue,
  ManifestTimeline,
  ManifestTimelineEntry,
  PreviewEntityDescriptor,
  ProjectionLens,
  UpdateEditorEntityProjectionInput,
  UpdateEditorEntityProjectionResult
} from "./types.ts";

/**
 * Builds the project-level editor entity projection accepted in ADR-052.
 *
 * The projection is intentionally an in-memory index. It stores source pointers
 * and derived labels, never nested copies of authoring objects, so deleting or
 * rebuilding it cannot change gameplay or UI output.
 */
export function buildEditorEntityProjection(input: BuildEditorEntityProjectionInput): EditorEntityProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const sourceHashes = buildProjectionSourceHashes(documents);
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const builders = new Map<string, MutableEditorEntityBuilder>();
  const actionRefsById = collectActionRefsById(documents);
  const contentRefsById = collectContentRefsById(documents);
  const uiScreenRefsById = collectUiScreenRefsById(documents);

  for (const document of documents) {
    const expectedHash = input.expectedSourceHashes?.[document.filePath];
    if (expectedHash !== undefined && document.sourceHash !== undefined && expectedHash !== document.sourceHash) {
      diagnostics.push({
        severity: "warning",
        code: "stale-source-hash",
        source: createProjectionSourcePointer(document, "", "document"),
        message: `Projection input hash for ${document.filePath} changed.`
      });
    }
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "game")) {
    collectGameEditorEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  }

  for (const document of documents.filter((candidate) => candidate.documentKind === "ui")) {
    collectUiEditorEntities(document, builders, actionRefsById);
  }

  attachPreviewEntityFacets(input.previewEntities ?? [], documents, builders);
  collectIdentityFacetDiagnostics(builders, documents, actionRefsById, contentRefsById, input.activeChannel);

  const entities = [...builders.values()]
    .map(finalizeEditorEntityBuilder)
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  const entityDiagnostics = entities.flatMap((entity) => entity.diagnostics);

  return reindexEditorEntityProjection({
    projectionVersion: 1,
    gameId: input.gameId,
    sourceHashes,
    entities,
    diagnostics: [...diagnostics, ...entityDiagnostics]
  });
}

/**
 * Rebuilds the two DERIVED lookup indexes (`entityById`,
 * `entitiesBySourcePointer`) of a projection from its `entities`, producing a
 * complete `EditorEntityProjection`.
 *
 * `buildEditorEntityProjection` and the incremental updater both funnel through
 * here so the indexes are constructed in exactly ONE place. The Level-2 disk
 * warm-start cache revive (`reviveEditorEntityProjection`, ADR-057 §4.13
 * "Уровень 2") reuses it to reconstruct the Map indexes after a JSON round-trip:
 * the maps are intentionally NOT serialized, because they are a pure function of
 * `entities`, so rebuilding them here keeps a revived projection byte-for-byte
 * equal to a freshly built one.
 */
export function reindexEditorEntityProjection(base: {
  readonly projectionVersion: 1;
  readonly gameId: string | undefined;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly entities: readonly EditorEntity[];
  readonly diagnostics: readonly EditorEntityProjectionDiagnostic[];
}): EditorEntityProjection {
  return {
    projectionVersion: base.projectionVersion,
    gameId: base.gameId,
    sourceHashes: base.sourceHashes,
    entities: base.entities,
    entityById: new Map(base.entities.map((entity) => [entity.entityId, entity])),
    entitiesBySourcePointer: buildEntitiesBySourcePointer(base.entities),
    diagnostics: base.diagnostics
  };
}

/**
 * Version of the projection lens set (ADR-057 §4.13, UX §10).
 *
 * The "lens set" is the fixed collection of readers in `PROJECTION_LENSES` plus
 * how `buildEditorEntityProjection` turns document subtrees into entities and
 * source pointers. The future incremental cache (Phase 2.1) may only apply
 * PARTIAL, pointer-level invalidation while this version is unchanged.
 *
 * Bump this integer whenever a change could make a partial rebuild diverge from
 * a full rebuild, namely:
 *   - adding, removing, or renaming a lens;
 *   - changing any lens `readPointerPrefixes`;
 *   - changing how a lens derives entities, labels, links, or source pointers.
 * Do NOT bump for pure refactors that keep reads and outputs identical. A bump
 * forces a full projection rebuild (UX §10: "полная пересборка ... при ...
 * изменении версии линз"). The version does NOT gate ordinary per-edit
 * incremental updates — those are decided per change by
 * `updateEditorEntityProjection`.
 *
 * Version history:
 *   - v1: the original ADR-052 projection (entities + facets + link diagnostics).
 *   - v2: ADR-057 §4.13 lens declarations plus the identity-discipline lenses
 *     `entity-missing-view` / `entity-view-orphan` (Phase 1.3/1.5).
 *
 * NOTE (Phase 2.1): earlier this comment claimed v2 existed to FORCE a full
 * rebuild on every edit because the identity-discipline diagnostics are
 * cross-entity. That rationale is now obsolete: `updateEditorEntityProjection`
 * keeps those cross-entity derivations correct WITHOUT a per-edit full rebuild —
 * it takes the incremental fast path only for changes that provably cannot alter
 * identity, links, types, structure, or the game-id set (the inputs those
 * diagnostics depend on), and falls back to a full rebuild for anything else. So
 * the value stays 2 purely as the lens-set version; it is no longer a "disable
 * incremental" flag.
 */
export const PROJECTION_LENS_SET_VERSION = 2;

/**
 * Declared read dependencies of every projection lens (ADR-057 §4.13).
 *
 * Each entry mirrors one reader used by `buildEditorEntityProjection`; the
 * `readPointerPrefixes` are the honest subtrees that reader touches inside a
 * matching document. Root lenses declare the whole enclosing object (`/root`)
 * on purpose: they read only header fields (id/_label/title/name), but the
 * broader prefix stays correct even if label resolution ever reads more keys —
 * over-declaration can only cause an extra rebuild, never a missed one.
 *
 * The order and ids match the collectors so the list stays easy to audit
 * against the code; it is not otherwise significant.
 */
export const PROJECTION_LENSES: readonly ProjectionLens[] = [
  // Game root entity: reads the `/root` object header.
  { id: "game-root", documentKinds: ["game"], readPointerPrefixes: ["/root"] },
  // Flows, their steps, and the link ids each step declares.
  { id: "game-flow-step", documentKinds: ["game"], readPointerPrefixes: ["/root/logic/flows"] },
  // Game actions (and nested objectId links resolved against content).
  { id: "game-action", documentKinds: ["game"], readPointerPrefixes: ["/root/logic/actions"] },
  // Public metrics map.
  { id: "game-metric", documentKinds: ["game"], readPointerPrefixes: ["/root/state/public/metrics"] },
  // Object-type state models.
  { id: "game-state-model", documentKinds: ["game"], readPointerPrefixes: ["/root/objectTypes"] },
  // Cross-reference index: action id -> action source pointer.
  { id: "game-action-index", documentKinds: ["game"], readPointerPrefixes: ["/root/logic/actions"] },
  // Cross-reference index: content id -> content source pointer.
  { id: "game-content-index", documentKinds: ["game"], readPointerPrefixes: ["/root/content"] },
  // UI root header, screens, and every nested component subtree.
  { id: "ui-entities", documentKinds: ["ui"], readPointerPrefixes: ["/root"] },
  // Cross-reference index: screen id -> screen source pointer.
  { id: "ui-screen-index", documentKinds: ["ui"], readPointerPrefixes: ["/root/screens"] },
  // Preview facets attach to runtime-supplied authoring pointers, so they can
  // read anywhere in any document; `""` is the whole-document (root) prefix.
  { id: "preview-facets", readPointerPrefixes: [""] }
];

/**
 * True when a changed JSON Pointer can affect what `lens` reads.
 *
 * Affectedness is BIDIRECTIONAL nesting against the lens `readPointerPrefixes`:
 *   - the change is at or below a prefix (a field the lens reads changed), or
 *   - the change is at or above a prefix (a whole subtree the lens reads was
 *     replaced or removed from higher up — reverse nesting).
 * When `documentKind` is given and the lens is scoped to other kinds only, the
 * lens cannot be affected. This is a pure predicate; it performs no rebuild.
 */
export function pointerAffectsLens(
  lens: ProjectionLens,
  changedPointer: string,
  documentKind?: EditorEntityDocumentKind
): boolean {
  if (documentKind !== undefined && lens.documentKinds !== undefined && !lens.documentKinds.includes(documentKind)) {
    return false;
  }

  return lens.readPointerPrefixes.some((prefix) => pointersOverlap(changedPointer, prefix));
}

/**
 * Collects the ids of projection entities whose source pointers intersect a set
 * of changed pointers (foundation for Phase 2.1 incremental invalidation).
 *
 * The ONLY source of entity-to-pointer links is the projection itself (ADR-052
 * §11): this reads each entity's primary and facet source pointers and never
 * re-parses documents. `changedPointersByFile` maps a file path to the pointers
 * changed in that file (an empty pointer `""` means the whole file changed). An
 * entity is affected when any of its source pointers in a changed file overlaps
 * a changed pointer under the same bidirectional-nesting rule used by
 * `pointerAffectsLens`.
 */
export function collectAffectedEntities(
  projection: EditorEntityProjection,
  changedPointersByFile: Readonly<Record<string, readonly string[]>>
): ReadonlySet<string> {
  const affected = new Set<string>();

  for (const entity of projection.entities) {
    for (const source of collectEntitySourcePointers(entity)) {
      const changedPointers = changedPointersByFile[source.filePath];
      if (changedPointers === undefined) {
        continue;
      }

      if (changedPointers.some((changed) => pointersOverlap(changed, source.pointer))) {
        affected.add(entity.entityId);
        break;
      }
    }
  }

  return affected;
}

/**
 * Wraps a freshly built projection with the input that produced it (ADR-057
 * §4.13, UX §10 "Уровень 1"), giving `updateEditorEntityProjection` a value to
 * diff the next input against. This is a thin convenience; callers may build the
 * state object literally instead.
 */
export function createEditorEntityProjectionState(input: BuildEditorEntityProjectionInput): EditorEntityProjectionState {
  return { projection: buildEditorEntityProjection(input), input };
}

/**
 * Incrementally updates an `EditorEntityProjection` for a set of changed pointers
 * (ADR-057 §4.13; editor-preview-first-ux §10 "Уровень 1 — инкрементальная
 * пересборка в памяти"; design-spec §2.6, §5).
 *
 * The main correctness gate is: the returned projection is DEEPLY EQUAL to
 * `buildEditorEntityProjection(next.input)` for every change (verified by the
 * equivalence property tests). To honour that while doing far less work, the
 * updater takes a FAST PATH only for changes it can prove are safe, and falls
 * back to a full rebuild for everything else:
 *
 *   - The projection depends on a small, fixed set of authoring inputs: labels
 *     (`_label`/`title`/`name`/`id`), types (`_type`/`type`), channel headers
 *     (`_channel`/`_manifestType`), link/reference keys (`*Id`/`*Ref`/…, per the
 *     identity-discipline rules), the visibility flags (`_requiresView`/
 *     `_decorative`), and the OBJECT STRUCTURE (which entities exist, array
 *     order). It never reads other content values.
 *   - A change that touches any of the topology/identity inputs above — or that
 *     replaces a whole object/array subtree, adds/removes a sibling key, or
 *     shifts an array — forces a FULL rebuild. That is exactly the set of inputs
 *     the cross-entity identity diagnostics depend on, so those diagnostics are
 *     never left stale (this is why `PROJECTION_LENS_SET_VERSION` no longer needs
 *     to force a per-edit full rebuild).
 *   - A change that touches ONLY a scalar LABEL field refreshes just the labels
 *     of the AFFECTED entities (`collectAffectedEntities`), reusing every other
 *     entity record by reference.
 *   - A change that touches only projection-IRRELEVANT scalar fields leaves the
 *     projection unchanged; the whole previous projection is reused.
 *
 * `previous` is never mutated (ADR-057 §5: the cache is not a source of truth).
 */
export function updateEditorEntityProjection(
  previous: EditorEntityProjectionState,
  next: UpdateEditorEntityProjectionInput
): UpdateEditorEntityProjectionResult {
  const startedAt = nowMs();
  const fullRebuild = (reason: string): UpdateEditorEntityProjectionResult => ({
    state: { projection: buildEditorEntityProjection(next.input), input: next.input },
    report: { mode: "full", reason, rebuiltEntityIds: [], reusedEntityCount: 0, durationMs: nowMs() - startedAt }
  });

  // Options that change how the WHOLE projection is derived cannot be handled by
  // pointer-scoped invalidation: a channel switch re-evaluates every
  // `entity-missing-view`; preview entities and expected hashes add cross-cutting
  // facets/diagnostics. Bail to a full rebuild if any of them is in play.
  if (
    previous.input.activeChannel !== next.input.activeChannel ||
    hasPreviewEntities(previous.input) ||
    hasPreviewEntities(next.input) ||
    hasExpectedSourceHashes(previous.input) ||
    hasExpectedSourceHashes(next.input)
  ) {
    return fullRebuild("full:projection-options-changed");
  }

  const classification = classifyProjectionChanges(previous.input, next.input, next.changedPointersByFile);
  if (classification.kind === "full") {
    return fullRebuild(classification.reason);
  }

  // From here the change is provably label-only and/or irrelevant. The set of
  // entities, their kinds, links, and diagnostics are all unchanged; only label
  // strings on the affected entities can differ.
  const nextDocumentJsonByPath = buildDocumentJsonByPath(next.input.documents);
  const affected = classification.hasLabelChange
    ? collectAffectedEntities(previous.projection, next.changedPointersByFile)
    : new Set<string>();

  // A label change to an entity that CARRIES a diagnostic could change that
  // diagnostic's message/label (both embed the entity's own label). Rather than
  // re-render diagnostic text, fall back to a full rebuild in that rare case.
  for (const entity of previous.projection.entities) {
    if (affected.has(entity.entityId) && entity.diagnostics.length > 0) {
      return fullRebuild("full:label-change-on-diagnostic-entity");
    }
  }

  const rebuiltEntityIds: string[] = [];
  const entities = previous.projection.entities.map((entity) => {
    if (!affected.has(entity.entityId)) {
      return entity;
    }
    rebuiltEntityIds.push(entity.entityId);
    return refreshEntityLabels(entity, nextDocumentJsonByPath);
  });

  const projection = reindexEditorEntityProjection({
    projectionVersion: 1,
    gameId: next.input.gameId,
    sourceHashes: buildProjectionSourceHashes(next.input.documents.map(normalizeEditorEntityDocument)),
    entities,
    // Aggregate diagnostics are unchanged: the fast path never fires when an
    // affected entity has diagnostics, and unaffected entities keep theirs.
    diagnostics: previous.projection.diagnostics
  });

  return {
    state: { projection, input: next.input },
    report: {
      mode: "incremental",
      reason: classification.hasLabelChange ? "incremental:label-refresh" : "incremental:no-projection-effect",
      rebuiltEntityIds,
      reusedEntityCount: entities.length - rebuiltEntityIds.length,
      durationMs: nowMs() - startedAt
    }
  };
}

/** Millisecond clock that works in both Node and the browser (framework-agnostic). */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function hasPreviewEntities(input: BuildEditorEntityProjectionInput): boolean {
  return (input.previewEntities?.length ?? 0) > 0;
}

function hasExpectedSourceHashes(input: BuildEditorEntityProjectionInput): boolean {
  return input.expectedSourceHashes !== undefined && Object.keys(input.expectedSourceHashes).length > 0;
}

/** Maps file path -> current parsed JSON for quick pointer reads during refresh. */
function buildDocumentJsonByPath(
  documents: readonly EditorEntityProjectionDocument[]
): ReadonlyMap<string, JsonValue> {
  const byPath = new Map<string, JsonValue>();
  for (const document of documents) {
    if (document.json !== undefined) {
      byPath.set(document.filePath, document.json);
    }
  }
  return byPath;
}

/**
 * The outcome of classifying a change set for the incremental fast path.
 *   - `full`: at least one change can alter entity topology/identity/links, so a
 *     full rebuild is required; `reason` is machine-readable telemetry.
 *   - `incremental`: every change is a scalar label edit or a projection-
 *     irrelevant scalar edit; `hasLabelChange` says whether any label refresh is
 *     needed at all.
 */
type ProjectionChangeClassification =
  | { readonly kind: "full"; readonly reason: string }
  | { readonly kind: "incremental"; readonly hasLabelChange: boolean };

/**
 * Classifies a change set into "safe for the incremental fast path" vs "needs a
 * full rebuild", by inspecting each changed pointer against the previous and next
 * document JSON.
 */
function classifyProjectionChanges(
  previousInput: BuildEditorEntityProjectionInput,
  nextInput: BuildEditorEntityProjectionInput,
  changedPointersByFile: ChangedPointersByFile
): ProjectionChangeClassification {
  const changedFiles = Object.keys(changedPointersByFile);
  if (changedFiles.length === 0) {
    return { kind: "full", reason: "full:no-changes-reported" };
  }

  const previousJsonByPath = buildDocumentJsonByPath(previousInput.documents);
  const nextJsonByPath = buildDocumentJsonByPath(nextInput.documents);

  // The set of documents (and their JSON presence) must be identical: a file
  // added, removed, or that failed to parse (json === undefined) can change the
  // entity set wholesale.
  if (!sameFilePathSet(previousInput.documents, nextInput.documents)) {
    return { kind: "full", reason: "full:document-set-changed" };
  }

  // Every document whose parsed JSON reference actually changed MUST be listed in
  // the change set. A changed-but-unreported file would silently desync the fast
  // path, so treat that as unknown -> full rebuild.
  for (const document of nextInput.documents) {
    const previousJson = previousJsonByPath.get(document.filePath);
    const changed = previousJson !== document.json;
    if (changed && !(document.filePath in changedPointersByFile)) {
      return { kind: "full", reason: "full:unreported-file-change" };
    }
  }

  let hasLabelChange = false;
  for (const filePath of changedFiles) {
    const pointers = changedPointersByFile[filePath] ?? [];
    if (pointers.length === 0) {
      // Empty pointer list means "changed, but where is unknown" (UX §10).
      return { kind: "full", reason: "full:unknown-pointers" };
    }

    const previousJson = previousJsonByPath.get(filePath);
    const nextJson = nextJsonByPath.get(filePath);
    if (previousJson === undefined || nextJson === undefined) {
      return { kind: "full", reason: "full:missing-document-json" };
    }

    for (const pointer of pointers) {
      const verdict = classifyChangedPointer(pointer, previousJson, nextJson);
      if (verdict === "full") {
        return { kind: "full", reason: "full:topology-change" };
      }
      if (verdict === "label") {
        hasLabelChange = true;
      }
    }
  }

  return { kind: "incremental", hasLabelChange };
}

/** Per-pointer verdict: `full` (needs rebuild), `label` (label refresh), or `irrelevant`. */
function classifyChangedPointer(
  pointer: string,
  previousJson: JsonValue,
  nextJson: JsonValue
): "full" | "label" | "irrelevant" {
  // The whole-document pointer forces a full rebuild.
  if (pointer === "") {
    return "full";
  }

  const segments = parseJsonPointer(pointer);

  // A topology/identity/link key ANYWHERE on the path forces a full rebuild. It
  // must be checked across all segments, not just the last, because links can be
  // stored as array elements (for example `.../actionIds/0`): the leaf segment is
  // a numeric index, but the ancestor key `actionIds` re-targets a reference.
  if (segments.some(isProjectionTopologyKey)) {
    return "full";
  }

  const segment = segments[segments.length - 1] ?? "";

  const previousValue = readJsonPointer(previousJson, pointer);
  const nextValue = readJsonPointer(nextJson, pointer);

  // Added or removed leaf, or a subtree (object/array) replacement: the affected
  // subtree can contain any relevant field, so rebuild fully.
  if (previousValue === undefined || nextValue === undefined) {
    return "full";
  }
  if (isContainerValue(previousValue) || isContainerValue(nextValue)) {
    return "full";
  }

  // A sibling added/removed/renamed at the parent (or an array length change)
  // shifts pointers and can add/remove entities: rebuild fully.
  if (!parentContainerShapeUnchanged(pointer, previousJson, nextJson)) {
    return "full";
  }

  return isProjectionLabelKey(segment) ? "label" : "irrelevant";
}

/**
 * True when the immediate parent container of `pointer` has the same shape (same
 * object keys or same array length) in both documents. This is a cheap guard
 * against structural edits (sibling add/remove, array insert/delete) that a
 * per-pointer scalar check would otherwise miss.
 */
function parentContainerShapeUnchanged(pointer: string, previousJson: JsonValue, nextJson: JsonValue): boolean {
  const segments = parseJsonPointer(pointer);
  if (segments.length === 0) {
    return true;
  }
  const parentPointer = buildJsonPointer(segments.slice(0, -1).map(String));
  const previousParent = readJsonPointer(previousJson, parentPointer);
  const nextParent = readJsonPointer(nextJson, parentPointer);

  if (Array.isArray(previousParent) && Array.isArray(nextParent)) {
    return previousParent.length === nextParent.length;
  }
  if (isPlainJsonObject(previousParent) && isPlainJsonObject(nextParent)) {
    const previousKeys = Object.keys(previousParent);
    const nextKeys = Object.keys(nextParent);
    return previousKeys.length === nextKeys.length && previousKeys.every((key) => key in nextParent);
  }
  // Parent kind changed (object <-> array <-> scalar): structural.
  return false;
}

/**
 * Keys whose value the projection reads to derive ENTITY TOPOLOGY, identity,
 * links, types, channel, or visibility. A change to any of them can add/remove
 * entities, re-target links, or flip an identity diagnostic, so it forces a full
 * rebuild. `id` and the `*Id`/`*Ref` link/reference keys are matched by the same
 * generic naming convention used for orphan detection (`isGameEntityReferenceKey`),
 * keeping the engine game-agnostic.
 */
function isProjectionTopologyKey(segment: string): boolean {
  if (isGameEntityReferenceKey(segment)) {
    return true;
  }
  return (
    segment === "_type" ||
    segment === "type" ||
    segment === "_channel" ||
    segment === "_manifestType" ||
    segment === "_requiresView" ||
    segment === "_decorative"
  );
}

/** Keys read only to derive a human LABEL (`resolveEntityTreeLabel`), never topology. */
function isProjectionLabelKey(segment: string): boolean {
  // `id` is also a label fallback, but it is a topology key handled before this.
  return segment === "_label" || segment === "title" || segment === "name";
}

function isContainerValue(value: JsonValue): boolean {
  return Array.isArray(value) || isPlainJsonObject(value);
}

function sameFilePathSet(
  previousDocuments: readonly EditorEntityProjectionDocument[],
  nextDocuments: readonly EditorEntityProjectionDocument[]
): boolean {
  if (previousDocuments.length !== nextDocuments.length) {
    return false;
  }
  const previousPaths = new Set(previousDocuments.map((document) => document.filePath));
  return nextDocuments.every((document) => previousPaths.has(document.filePath));
}

/**
 * Produces a refreshed copy of one entity whose labels are recomputed from the
 * CURRENT document JSON, reusing everything else (id, kind, source pointers,
 * diagnostics). Only labels can differ under a proven label-only change, so this
 * matches a full rebuild exactly for those changes.
 */
function refreshEntityLabels(entity: EditorEntity, documentJsonByPath: ReadonlyMap<string, JsonValue>): EditorEntity {
  const primarySource = refreshSourcePointerLabel(entity.primarySource, documentJsonByPath);
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>> = {};
  for (const facetKind of orderedEditorEntityFacetKinds) {
    const sources = entity.facets[facetKind];
    if (sources !== undefined && sources.length > 0) {
      facets[facetKind] = sources.map((source) => refreshSourcePointerLabel(source, documentJsonByPath));
    }
  }

  return {
    entityId: entity.entityId,
    kind: entity.kind,
    // Every builder sets `entity.label` to `primarySource.label`, so refreshing
    // the primary source keeps the two in lock-step with a full rebuild.
    label: primarySource.label ?? entity.label,
    primarySource,
    facets,
    diagnostics: entity.diagnostics
  };
}

/**
 * Recomputes one source pointer's `label` from the current node. Every source
 * label is `resolveEntityTreeLabel(node)` EXCEPT metric sources, whose label is
 * derived from the (structurally stable) metric key and therefore never changes
 * on a value edit — those keep their previous label.
 */
function refreshSourcePointerLabel(
  source: EditorEntitySourcePointer,
  documentJsonByPath: ReadonlyMap<string, JsonValue>
): EditorEntitySourcePointer {
  if (source.role === "metric") {
    return source;
  }
  const json = documentJsonByPath.get(source.filePath);
  if (json === undefined) {
    return source;
  }
  const node = readJsonPointer(json, source.pointer);
  if (!isPlainJsonObject(node)) {
    return source;
  }
  return { ...source, label: resolveEntityTreeLabel(node, source.pointer) };
}

/**
 * Creates a compact YAML-like, human-facing projection for prompt assembly.
 *
 * Technical keys such as `_type`, `_label`, `_prompt` and `$schema` are hidden
 * by default. A field dictionary can still explicitly mark a technical key as
 * meaningful when product UX needs it.
 *
 * NOTE: test-only export (LEGACY-0018): no production consumer imports this
 * builder yet; it is exercised by `tests/index.test.ts`, so it stays exported.
 */
export function buildEditorEntityYamlProjection(input: BuildEditorEntityYamlProjectionInput): EditorEntityYamlProjection {
  const documents = input.documents.map(normalizeEditorEntityDocument);
  const documentsByPath = new Map(documents.map((document) => [document.filePath, document]));
  const maxDepth = Math.max(1, input.maxDepth ?? 4);
  const hiddenTechnicalPointers: EditorEntitySourcePointer[] = [];
  const diagnostics: EditorEntityProjectionDiagnostic[] = [];
  const lines = [`Сущность: ${formatYamlScalar(input.entity.label)}`, `Тип: ${formatYamlScalar(input.entity.kind)}`];

  for (const facetKind of orderedEditorEntityFacetKinds) {
    const facetSources = input.entity.facets[facetKind] ?? [];
    if (facetSources.length === 0) {
      continue;
    }

    lines.push(`${editorEntityFacetLabel(facetKind)}:`);
    for (const source of facetSources) {
      const document = documentsByPath.get(source.filePath);
      const value = document?.json === undefined ? undefined : readJsonPointer(document.json, source.pointer);
      if (value === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "unresolved-source-pointer",
          source,
          message: `Cannot build YAML projection because ${source.filePath}#${source.pointer} does not resolve.`
        });
        lines.push(`  - ${formatYamlScalar(source.label ?? source.role ?? source.pointer)}: "[unavailable]"`);
        continue;
      }

      const sectionLabel = source.label ?? source.role ?? titleFromToken(lastPointerSegmentOrRoot(source.pointer));
      lines.push(`  - ${formatYamlScalar(sectionLabel)}:`);
      appendMeaningfulYamlLines({
        lines,
        value,
        pointer: source.pointer,
        indent: 6,
        fieldDictionary: input.fieldDictionary ?? [],
        hiddenTechnicalPointers,
        hiddenSourceBase: source,
        maxDepth
      });
    }
  }

  for (const hidden of hiddenTechnicalPointers) {
    diagnostics.push({
      severity: "warning",
      code: "hidden-technical-field",
      source: hidden,
      message: `Technical field ${hidden.filePath}#${hidden.pointer} is hidden from the user-facing YAML projection.`
    });
  }

  return {
    text: `${lines.join("\n")}\n`,
    hiddenTechnicalPointers,
    diagnostics
  };
}

/** Builds timeline entries from authoring v2 `root.logic.flows[].steps[]`. */
export function buildManifestChronologyTimeline(input: BuildManifestTimelineInput): ManifestTimeline {
  const snapshot = input.snapshot;
  const entries: ManifestTimelineEntry[] = [];
  const rootEntryIds: string[] = [];

  if (snapshot.json === undefined) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  const flows = readJsonPointer(snapshot.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return createManifestTimeline(entries, rootEntryIds);
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowId = readStringProperty(flow, "id") ?? `flow-${flowIndex}`;
    const flowEntry: ManifestTimelineEntry = {
      id: flowPointer,
      pointer: flowPointer,
      kind: "flow",
      label: resolveEntityTreeLabel(flow, flowPointer),
      order: flowIndex,
      flowId,
      actionIds: []
    };
    entries.push(flowEntry);
    rootEntryIds.push(flowEntry.id);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      entries.push({
        id: stepPointer,
        pointer: stepPointer,
        kind: "step",
        label: resolveEntityTreeLabel(step, stepPointer),
        order: stepIndex,
        parentId: flowEntry.id,
        flowId,
        stepId: readStringProperty(step, "id") ?? `step-${stepIndex}`,
        screenId: readStringProperty(step, "screenId"),
        actionIds: readStringArrayProperty(step, "actionIds"),
        nextStepId: readStringProperty(step, "next")
      });
    });
  });

  return createManifestTimeline(entries, rootEntryIds);
}

const orderedEditorEntityFacetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "state", "view", "design", "plugin"];

type NormalizedEditorEntityProjectionDocument = EditorEntityProjectionDocument & {
  readonly documentKind: EditorEntityDocumentKind;
};

interface MutableEditorEntityBuilder {
  readonly entityId: string;
  readonly kind: EditorEntityKind;
  readonly label: string;
  readonly primarySource: EditorEntitySourcePointer;
  readonly facets: Map<EditorEntityFacetKind, EditorEntitySourcePointer[]>;
  readonly diagnostics: EditorEntityProjectionDiagnostic[];
}

function normalizeEditorEntityDocument(document: EditorEntityProjectionDocument): NormalizedEditorEntityProjectionDocument {
  const inferredKind = document.documentKind ?? inferEditorEntityDocumentKind(document.json);
  return {
    ...document,
    documentKind: inferredKind,
    channel: document.channel ?? inferEditorEntityDocumentChannel(document.json)
  };
}

function inferEditorEntityDocumentKind(json: JsonValue | undefined): EditorEntityDocumentKind {
  if (!isPlainJsonObject(json)) {
    return "unknown";
  }

  const manifestType = typeof json._manifestType === "string" ? json._manifestType : undefined;
  if (manifestType === "game" || manifestType === "ui") {
    return manifestType;
  }

  if (manifestType === "design") {
    return "design";
  }

  return "unknown";
}

function inferEditorEntityDocumentChannel(json: JsonValue | undefined): string | undefined {
  if (!isPlainJsonObject(json)) {
    return undefined;
  }

  return typeof json._channel === "string" && json._channel.trim() !== "" ? json._channel.trim() : undefined;
}

function buildProjectionSourceHashes(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): Readonly<Record<string, string>> {
  const sourceHashes: Record<string, string> = {};
  for (const document of documents) {
    if (document.sourceHash !== undefined) {
      sourceHashes[document.filePath] = document.sourceHash;
    }
  }
  return sourceHashes;
}

function collectGameEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  const root = document.json === undefined ? undefined : readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "game-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "game-root",
      label: rootSource.label ?? "Game",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "logic", rootSource);
  }

  collectGameFlowAndStepEntities(document, builders, diagnostics, actionRefsById, contentRefsById, uiScreenRefsById);
  collectGameActionEntities(document, builders, contentRefsById);
  collectGameMetricEntities(document, builders);
  collectGameStateModelEntities(document, builders);
}

function collectGameFlowAndStepEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  diagnostics: EditorEntityProjectionDiagnostic[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  uiScreenRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const flows = readJsonPointer(document.json, "/root/logic/flows");
  if (!Array.isArray(flows)) {
    return;
  }

  flows.forEach((flow, flowIndex) => {
    if (!isPlainJsonObject(flow)) {
      return;
    }

    const flowPointer = buildJsonPointer(["root", "logic", "flows", String(flowIndex)]);
    const flowSource = createProjectionSourcePointer(document, flowPointer, "flow", resolveEntityTreeLabel(flow, flowPointer));
    const flowEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-flow", document.filePath, flowPointer, readStringProperty(flow, "id")),
      kind: "game-flow",
      label: flowSource.label ?? "Flow",
      primarySource: flowSource
    });
    addEditorEntityFacet(flowEntity, "logic", flowSource);

    const steps = flow.steps;
    if (!Array.isArray(steps)) {
      return;
    }

    steps.forEach((step, stepIndex) => {
      if (!isPlainJsonObject(step)) {
        return;
      }

      const stepPointer = appendPointerSegment(appendPointerSegment(flowPointer, "steps"), String(stepIndex));
      const stepSource = createProjectionSourcePointer(document, stepPointer, "step", resolveEntityTreeLabel(step, stepPointer));
      const stepEntity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("game-step", document.filePath, stepPointer, readStringProperty(step, "id")),
        kind: "game-step",
        label: stepSource.label ?? "Step",
        primarySource: stepSource
      });
      addEditorEntityFacet(stepEntity, "logic", stepSource);

      for (const actionId of collectLinkIds(step, ["actionId", "actionIds"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        if (actionRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-action-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing action ${actionId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        for (const actionRef of actionRefs) {
          addEditorEntityFacet(stepEntity, "logic", actionRef);
        }
      }

      for (const contentId of collectLinkIds(step, ["activeInfoId", "cardId", "choiceId", "contentId", "infoId"])) {
        const contentRefs = contentRefsById.get(contentId) ?? [];
        if (contentRefs.length === 0) {
          stepEntity.diagnostics.push(
            createProjectionDiagnostic(
              "warning",
              "unresolved-source-pointer",
              stepSource,
              `Step ${stepSource.label ?? stepPointer} references missing content ${contentId}.`
            )
          );
          continue;
        }

        for (const contentRef of contentRefs) {
          addEditorEntityFacet(stepEntity, "content", contentRef);
        }
      }

      const screenIds = collectLinkIds(step, ["screenId", "screen_id"]);
      for (const screenId of screenIds) {
        const viewRefs = uiScreenRefsById.get(screenId) ?? [];
        if (viewRefs.length === 0) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "unresolved-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} references missing UI screen ${screenId}.`
          );
          stepEntity.diagnostics.push(diagnostic);
          continue;
        }

        if (hasDuplicateProjectionChannels(viewRefs)) {
          const diagnostic = createProjectionDiagnostic(
            "warning",
            "ambiguous-view-link",
            stepSource,
            `Step ${stepSource.label ?? stepPointer} resolves screen ${screenId} to multiple screens in the same channel.`
          );
          stepEntity.diagnostics.push(diagnostic);
        }

        for (const viewRef of viewRefs) {
          addEditorEntityFacet(stepEntity, "view", viewRef);
        }
      }
    });
  });
}

function collectGameActionEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const actions = readJsonPointer(document.json, "/root/logic/actions");
  if (!Array.isArray(actions)) {
    return;
  }

  actions.forEach((action, index) => {
    if (!isPlainJsonObject(action)) {
      return;
    }

    const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
    const source = createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("game-action", document.filePath, pointer, readStringProperty(action, "id")),
      kind: "game-action",
      label: source.label ?? "Action",
      primarySource: source
    });
    addEditorEntityFacet(entity, "logic", source);

    for (const objectId of collectNestedLinkIds(action, ["objectId"])) {
      const contentRefs = contentRefsById.get(objectId) ?? [];
      for (const contentRef of contentRefs) {
        addEditorEntityFacet(entity, "content", contentRef);
      }
    }
  });
}

function collectGameMetricEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const metricsPointer = "/root/state/public/metrics";
  const metrics = readJsonPointer(document.json, metricsPointer);
  if (!isPlainJsonObject(metrics)) {
    return;
  }

  for (const [key] of Object.entries(metrics)) {
    const pointer = appendPointerSegment(metricsPointer, key);
    const source = createProjectionSourcePointer(document, pointer, "metric", titleFromToken(key));
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("metric", document.filePath, pointer, key),
      kind: "metric",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectGameStateModelEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (document.json === undefined) {
    return;
  }

  const objectTypesPointer = "/root/objectTypes";
  const objectTypes = readJsonPointer(document.json, objectTypesPointer);
  if (!isPlainJsonObject(objectTypes)) {
    return;
  }

  for (const [key, value] of Object.entries(objectTypes)) {
    const pointer = appendPointerSegment(objectTypesPointer, key);
    const label = isPlainJsonObject(value) ? resolveEntityTreeLabel(value, pointer) : titleFromToken(key);
    const source = createProjectionSourcePointer(document, pointer, "object-type", label);
    const entity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("state-model", document.filePath, pointer, key),
      kind: "state-model",
      label: source.label ?? titleFromToken(key),
      primarySource: source
    });
    addEditorEntityFacet(entity, "state", source);
  }
}

function collectUiEditorEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): void {
  if (document.json === undefined) {
    return;
  }

  const root = readJsonPointer(document.json, "/root");
  if (isPlainJsonObject(root)) {
    const rootSource = createProjectionSourcePointer(document, "/root", "ui-root", resolveEntityTreeLabel(root, "/root"));
    const rootEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-root", document.filePath, "/root", readStringProperty(root, "id")),
      kind: "ui-root",
      label: rootSource.label ?? "UI",
      primarySource: rootSource
    });
    addEditorEntityFacet(rootEntity, "view", rootSource);
  }

  const screens = readJsonPointer(document.json, "/root/screens");
  if (!Array.isArray(screens)) {
    return;
  }

  screens.forEach((screen, screenIndex) => {
    if (!isPlainJsonObject(screen)) {
      return;
    }

    const screenPointer = buildJsonPointer(["root", "screens", String(screenIndex)]);
    const screenSource = createProjectionSourcePointer(document, screenPointer, "screen", resolveEntityTreeLabel(screen, screenPointer));
    const screenEntity = ensureEditorEntityBuilder(builders, {
      entityId: editorEntityId("ui-screen", document.filePath, screenPointer, readStringProperty(screen, "id")),
      kind: "ui-screen",
      label: screenSource.label ?? "Screen",
      primarySource: screenSource
    });
    addEditorEntityFacet(screenEntity, "view", screenSource);
    collectUiComponentEntities(document, builders, actionRefsById, screenPointer, screenEntity);
  });
}

function collectUiComponentEntities(
  document: NormalizedEditorEntityProjectionDocument,
  builders: Map<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  rootPointer: string,
  screenEntity: MutableEditorEntityBuilder
): void {
  const visit = (value: JsonValue, pointer: string): void => {
    if (!isPlainJsonObject(value)) {
      return;
    }

    if (pointer !== rootPointer && isUiComponentLike(value)) {
      const source = createProjectionSourcePointer(document, pointer, "component", resolveEntityTreeLabel(value, pointer));
      const entity = ensureEditorEntityBuilder(builders, {
        entityId: editorEntityId("ui-component", document.filePath, pointer, readStringProperty(value, "id")),
        kind: "ui-component",
        label: source.label ?? "Component",
        primarySource: source
      });
      addEditorEntityFacet(entity, "view", source);
      addEditorEntityFacet(screenEntity, "view", source);

      for (const actionId of collectNestedLinkIds(value, ["actionId"])) {
        const actionRefs = actionRefsById.get(actionId) ?? [];
        for (const actionRef of actionRefs) {
          const actionEntity = builders.get(editorEntityId("game-action", actionRef.filePath, actionRef.pointer, actionId));
          if (actionEntity !== undefined) {
            addEditorEntityFacet(actionEntity, "view", source);
          }
        }
      }
    }

    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("_")) {
        continue;
      }
      if (Array.isArray(child)) {
        child.forEach((item, index) => visit(item, appendPointerSegment(appendPointerSegment(pointer, key), String(index))));
      } else {
        visit(child, appendPointerSegment(pointer, key));
      }
    }
  };

  const root = document.json === undefined ? undefined : readJsonPointer(document.json, rootPointer);
  if (root !== undefined) {
    visit(root, rootPointer);
  }
}

function attachPreviewEntityFacets(
  previewEntities: readonly PreviewEntityDescriptor[],
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: Map<string, MutableEditorEntityBuilder>
): void {
  if (previewEntities.length === 0) {
    return;
  }

  for (const previewEntity of previewEntities) {
    const source = findProjectionSourceForPreviewPointer(previewEntity.authoringPointer, documents, builders);
    if (source === undefined) {
      continue;
    }

    const owner = findProjectionOwnerForSourcePointer(source, builders);
    if (owner === undefined) {
      continue;
    }

    addEditorEntityFacet(owner, "view", {
      ...source,
      pointer: previewEntity.authoringPointer,
      label: previewEntity.label,
      role: `preview:${previewEntity.semanticRole}`
    });
  }
}

/**
 * Emits the identity-discipline diagnostics from ADR-057 §4.2 and
 * editor-preview-first-ux §2.1:
 *   - `entity-missing-view` (warning): a GAME entity whose type/prototype
 *     declares `_requiresView` for the active channel has no `view` facet
 *     resolving in that channel;
 *   - `entity-view-orphan` (warning): a UI component that is neither declared
 *     `_decorative` nor references any game entity id.
 *
 * Both признака ("requires view" / "decorative") are read DECLARATIVELY from the
 * authoring nodes (`_requiresView` / `_decorative`), never from a hardcoded list
 * of types in engine code — this is the ADR-057 §5 invariant and CLAUDE.md §10.
 * Diagnostics are attached to the builders BEFORE finalization so they flow into
 * both `entity.diagnostics` and the aggregate `projection.diagnostics`.
 */
function collectIdentityFacetDiagnostics(
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>,
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  activeChannel: string | undefined
): void {
  const documentsByPath = new Map(documents.map((document) => [document.filePath, document]));
  const gameReferenceIds = collectGameReferenceIds(builders, actionRefsById, contentRefsById);

  for (const builder of builders.values()) {
    const node = readAuthoringNode(builder.primarySource, documentsByPath);

    // "Requires view" is a game-entity type feature; check every game facet owner.
    if (builder.primarySource.documentKind === "game") {
      appendMissingViewDiagnostic(builder, node, activeChannel);
    }

    // "Orphan" applies to concrete UI elements only; screens/roots are containers.
    if (builder.kind === "ui-component") {
      appendViewOrphanDiagnostic(builder, node, gameReferenceIds);
    }
  }
}

/**
 * The set of game-entity ids a UI element may reference (identity discipline).
 *
 * It unions the explicit ids of every game-document entity (metrics, actions,
 * steps, object types, ...) with the action and content reference indexes, so a
 * UI element that binds by id or by a `*Id`/`*Ref` field can be recognised as
 * "references a game entity". Synthetic `filePath#pointer` ids (entities without
 * an explicit id) are skipped: they can never match an authored UI reference.
 */
function collectGameReferenceIds(
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>,
  actionRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>,
  contentRefsById: ReadonlyMap<string, readonly EditorEntitySourcePointer[]>
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const id of actionRefsById.keys()) {
    ids.add(id);
  }
  for (const id of contentRefsById.keys()) {
    ids.add(id);
  }
  for (const builder of builders.values()) {
    if (builder.primarySource.documentKind !== "game") {
      continue;
    }
    const publicId = builder.entityId.slice(builder.kind.length + 1);
    if (publicId !== "" && !publicId.includes("#")) {
      ids.add(publicId);
    }
  }
  return ids;
}

/** Reads the authoring object a builder's primary source points at, if present. */
function readAuthoringNode(
  source: EditorEntitySourcePointer,
  documentsByPath: ReadonlyMap<string, NormalizedEditorEntityProjectionDocument>
): JsonObject | undefined {
  const document = documentsByPath.get(source.filePath);
  if (document?.json === undefined) {
    return undefined;
  }
  const value = readJsonPointer(document.json, source.pointer);
  return isPlainJsonObject(value) ? value : undefined;
}

/** Adds `entity-missing-view` when a required view is absent in the active channel. */
function appendMissingViewDiagnostic(
  builder: MutableEditorEntityBuilder,
  node: JsonObject | undefined,
  activeChannel: string | undefined
): void {
  if (node === undefined || !requiresViewInChannel(node._requiresView, activeChannel)) {
    return;
  }
  if (entityHasViewInChannel(builder, activeChannel)) {
    return;
  }

  const channelSuffix = activeChannel === undefined ? "" : ` in channel "${activeChannel}"`;
  builder.diagnostics.push(
    createProjectionDiagnostic(
      "warning",
      "entity-missing-view",
      builder.primarySource,
      `Entity ${builder.label} requires a view${channelSuffix} but no view facet resolves there.`
    )
  );
}

/**
 * Interprets the declarative `_requiresView` flag against the active channel.
 *
 * `true` requires a view in every channel. The object form `{ channels: [...] }`
 * requires a view only in the listed channels. Any other value (absent, false,
 * malformed) means the type is non-visual — no diagnostic (UX §2.1). When no
 * active channel is supplied the requirement degrades to "requires some view".
 */
function requiresViewInChannel(requiresView: JsonValue | undefined, activeChannel: string | undefined): boolean {
  if (requiresView === true) {
    return true;
  }
  if (isPlainJsonObject(requiresView) && Array.isArray(requiresView.channels)) {
    const channels = requiresView.channels.filter((channel): channel is string => typeof channel === "string");
    return activeChannel === undefined ? channels.length > 0 : channels.includes(activeChannel);
  }
  return false;
}

/** True when the entity owns a `view` facet resolving in the active channel. */
function entityHasViewInChannel(builder: MutableEditorEntityBuilder, activeChannel: string | undefined): boolean {
  const viewFacets = builder.facets.get("view") ?? [];
  if (activeChannel === undefined) {
    return viewFacets.length > 0;
  }
  return viewFacets.some((facet) => facet.channel === activeChannel);
}

/** Adds `entity-view-orphan` for a non-decorative UI element with no game reference. */
function appendViewOrphanDiagnostic(
  builder: MutableEditorEntityBuilder,
  node: JsonObject | undefined,
  gameReferenceIds: ReadonlySet<string>
): void {
  if (node === undefined || node._decorative === true) {
    return;
  }
  if (uiComponentReferencesGameEntity(node, gameReferenceIds)) {
    return;
  }

  builder.diagnostics.push(
    createProjectionDiagnostic(
      "warning",
      "entity-view-orphan",
      builder.primarySource,
      `UI element ${builder.label} is not decorative and references no game entity.`
    )
  );
}

/**
 * True when a UI element's authoring subtree references a known game entity id.
 *
 * A reference is either a binding by `id` (a UI element whose id equals a game
 * entity id, per ADR-057 §4.2) or a link field (`*Id`/`*Ids`/`*Ref`/`*Refs`,
 * camelCase or snake_case) whose value is a known game id. The walk is
 * transitive on purpose: a container that hosts game-referencing elements is not
 * itself an orphan. Detection is by a generic naming convention (mirroring
 * change-risk.ts) so the engine stays game-agnostic.
 */
function uiComponentReferencesGameEntity(node: JsonObject, gameReferenceIds: ReadonlySet<string>): boolean {
  if (gameReferenceIds.size === 0) {
    return false;
  }

  let references = false;
  visitProjectionJson(node, "", (value) => {
    if (references || !isPlainJsonObject(value)) {
      return;
    }
    for (const [key, candidate] of Object.entries(value)) {
      if (isGameEntityReferenceKey(key) && valueMatchesGameId(candidate, gameReferenceIds)) {
        references = true;
        return;
      }
    }
  });
  return references;
}

/** True for the identity `id` field and for `*Id`/`*Ids`/`*Ref`/`*Refs` link keys. */
function isGameEntityReferenceKey(key: string): boolean {
  return key === "id" || /[a-z0-9](Id|Ids|Ref|Refs)$/.test(key) || /_(id|ids|ref|refs)$/.test(key);
}

/** True when a scalar or string-array value contains a known game entity id. */
function valueMatchesGameId(value: JsonValue, gameReferenceIds: ReadonlySet<string>): boolean {
  if (typeof value === "string") {
    return gameReferenceIds.has(value.trim());
  }
  if (Array.isArray(value)) {
    return value.some((item) => typeof item === "string" && gameReferenceIds.has(item.trim()));
  }
  return false;
}

function collectActionRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const actions = readJsonPointer(document.json, "/root/logic/actions");
    if (!Array.isArray(actions)) {
      continue;
    }

    actions.forEach((action, index) => {
      if (!isPlainJsonObject(action)) {
        return;
      }

      const actionId = readStringProperty(action, "id");
      if (actionId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "logic", "actions", String(index)]);
      pushProjectionRef(refs, actionId, createProjectionSourcePointer(document, pointer, "action", resolveEntityTreeLabel(action, pointer)));
    });
  }

  return refs;
}

function collectContentRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "game" || document.json === undefined) {
      continue;
    }

    const content = readJsonPointer(document.json, "/root/content");
    if (content === undefined) {
      continue;
    }

    visitProjectionJson(content, "/root/content", (value, pointer) => {
      if (!isPlainJsonObject(value)) {
        return;
      }

      const id = readStringProperty(value, "id");
      if (id === undefined) {
        return;
      }

      pushProjectionRef(refs, id, createProjectionSourcePointer(document, pointer, "content", resolveEntityTreeLabel(value, pointer)));
    });
  }

  return refs;
}

function collectUiScreenRefsById(
  documents: readonly NormalizedEditorEntityProjectionDocument[]
): ReadonlyMap<string, readonly EditorEntitySourcePointer[]> {
  const refs = new Map<string, EditorEntitySourcePointer[]>();
  for (const document of documents) {
    if (document.documentKind !== "ui" || document.json === undefined) {
      continue;
    }

    const screens = readJsonPointer(document.json, "/root/screens");
    if (!Array.isArray(screens)) {
      continue;
    }

    screens.forEach((screen, index) => {
      if (!isPlainJsonObject(screen)) {
        return;
      }

      const screenId = readStringProperty(screen, "id");
      if (screenId === undefined) {
        return;
      }

      const pointer = buildJsonPointer(["root", "screens", String(index)]);
      pushProjectionRef(refs, screenId, createProjectionSourcePointer(document, pointer, "screen", resolveEntityTreeLabel(screen, pointer)));
    });
  }

  return refs;
}

function visitProjectionJson(value: JsonValue, pointer: string, visitor: (value: JsonValue, pointer: string) => void): void {
  visitor(value, pointer);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visitProjectionJson(item, appendPointerSegment(pointer, String(index)), visitor));
    return;
  }

  if (!isPlainJsonObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    visitProjectionJson(child, appendPointerSegment(pointer, key), visitor);
  }
}

function pushProjectionRef(
  refs: Map<string, EditorEntitySourcePointer[]>,
  id: string,
  ref: EditorEntitySourcePointer
): void {
  const existing = refs.get(id);
  if (existing === undefined) {
    refs.set(id, [ref]);
  } else {
    existing.push(ref);
  }
}

function ensureEditorEntityBuilder(
  builders: Map<string, MutableEditorEntityBuilder>,
  input: {
    readonly entityId: string;
    readonly kind: EditorEntityKind;
    readonly label: string;
    readonly primarySource: EditorEntitySourcePointer;
  }
): MutableEditorEntityBuilder {
  const existing = builders.get(input.entityId);
  if (existing !== undefined) {
    return existing;
  }

  const builder: MutableEditorEntityBuilder = {
    entityId: input.entityId,
    kind: input.kind,
    label: input.label,
    primarySource: input.primarySource,
    facets: new Map(),
    diagnostics: []
  };
  builders.set(input.entityId, builder);
  return builder;
}

function addEditorEntityFacet(
  entity: MutableEditorEntityBuilder,
  facetKind: EditorEntityFacetKind,
  source: EditorEntitySourcePointer
): void {
  const existing = entity.facets.get(facetKind) ?? [];
  if (existing.some((candidate) => sourcePointerKey(candidate) === sourcePointerKey(source))) {
    return;
  }

  entity.facets.set(facetKind, [...existing, source]);
}

function finalizeEditorEntityBuilder(builder: MutableEditorEntityBuilder): EditorEntity {
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>> = {};
  for (const facetKind of orderedEditorEntityFacetKinds) {
    const values = builder.facets.get(facetKind);
    if (values !== undefined && values.length > 0) {
      facets[facetKind] = values;
    }
  }

  return {
    entityId: builder.entityId,
    kind: builder.kind,
    label: builder.label,
    primarySource: builder.primarySource,
    facets,
    diagnostics: builder.diagnostics
  };
}

function buildEntitiesBySourcePointer(entities: readonly EditorEntity[]): ReadonlyMap<string, readonly EditorEntity[]> {
  const result = new Map<string, EditorEntity[]>();
  for (const entity of entities) {
    for (const source of collectEntitySourcePointers(entity)) {
      const key = sourcePointerKey(source);
      const existing = result.get(key);
      if (existing === undefined) {
        result.set(key, [entity]);
      } else if (!existing.some((candidate) => candidate.entityId === entity.entityId)) {
        existing.push(entity);
      }
    }
  }

  return result;
}

function collectEntitySourcePointers(entity: EditorEntity): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets[facetKind] ?? []));
  }
  return sources;
}

function createProjectionSourcePointer(
  document: NormalizedEditorEntityProjectionDocument,
  pointer: string,
  role: string,
  label?: string
): EditorEntitySourcePointer {
  return {
    filePath: document.filePath,
    pointer,
    documentKind: document.documentKind,
    channel: document.channel,
    role,
    label
  };
}

function createProjectionDiagnostic(
  severity: DiagnosticSeverity,
  code: EditorEntityProjectionDiagnosticCode,
  source: EditorEntitySourcePointer,
  message: string,
  target?: EditorEntitySourcePointer
): EditorEntityProjectionDiagnostic {
  return {
    severity,
    code,
    source,
    target,
    message
  };
}

function editorEntityId(kind: EditorEntityKind, filePath: string, pointer: string, explicitId: string | undefined): string {
  const stablePart = explicitId === undefined || explicitId.trim() === "" ? `${filePath}#${pointer}` : explicitId.trim();
  return `${kind}:${stablePart}`;
}

function sourcePointerKey(source: EditorEntitySourcePointer): string {
  return `${source.filePath}#${source.pointer}`;
}

function collectLinkIds(value: JsonObject, keys: readonly string[]): readonly string[] {
  const ids: string[] = [];
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      ids.push(candidate.trim());
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (typeof item === "string" && item.trim() !== "") {
          ids.push(item.trim());
        }
      }
    }
  }
  return [...new Set(ids)];
}

function collectNestedLinkIds(value: JsonValue, keys: readonly string[]): readonly string[] {
  const ids = new Set<string>();
  visitProjectionJson(value, "", (candidate) => {
    if (!isPlainJsonObject(candidate)) {
      return;
    }

    for (const id of collectLinkIds(candidate, keys)) {
      ids.add(id);
    }
  });
  return [...ids];
}

function hasDuplicateProjectionChannels(refs: readonly EditorEntitySourcePointer[]): boolean {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    const key = `${ref.filePath}:${ref.channel ?? "default"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function isUiComponentLike(value: JsonObject): boolean {
  const type = readStringProperty(value, "_type") ?? readStringProperty(value, "type");
  return type !== undefined && normalizeToken(type).includes("component");
}

function findProjectionSourceForPreviewPointer(
  authoringPointer: string,
  documents: readonly NormalizedEditorEntityProjectionDocument[],
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): EditorEntitySourcePointer | undefined {
  for (const document of documents) {
    if (document.json === undefined || readJsonPointer(document.json, authoringPointer) === undefined) {
      continue;
    }

    const owner = [...builders.values()].find((entity) =>
      collectMutableEntitySourcePointers(entity).some((source) => source.filePath === document.filePath && isSameOrDescendantPointer(authoringPointer, source.pointer))
    );
    if (owner !== undefined) {
      return createProjectionSourcePointer(document, authoringPointer, "preview", owner.label);
    }
  }

  return undefined;
}

function findProjectionOwnerForSourcePointer(
  source: EditorEntitySourcePointer,
  builders: ReadonlyMap<string, MutableEditorEntityBuilder>
): MutableEditorEntityBuilder | undefined {
  return [...builders.values()].find((entity) =>
    collectMutableEntitySourcePointers(entity).some(
      (candidate) => candidate.filePath === source.filePath && isSameOrDescendantPointer(source.pointer, candidate.pointer)
    )
  );
}

function collectMutableEntitySourcePointers(entity: MutableEditorEntityBuilder): readonly EditorEntitySourcePointer[] {
  const sources = [entity.primarySource];
  for (const facetKind of orderedEditorEntityFacetKinds) {
    sources.push(...(entity.facets.get(facetKind) ?? []));
  }
  return sources;
}

function appendMeaningfulYamlLines(input: {
  readonly lines: string[];
  readonly value: JsonValue;
  readonly pointer: string;
  readonly indent: number;
  readonly fieldDictionary: readonly EditorEntityFieldDictionaryEntry[];
  readonly hiddenTechnicalPointers: EditorEntitySourcePointer[];
  readonly hiddenSourceBase: EditorEntitySourcePointer;
  readonly maxDepth: number;
}): void {
  if (input.maxDepth <= 0) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(summarizeYamlValue(input.value))}`);
    return;
  }

  if (Array.isArray(input.value)) {
    if (input.value.length === 0) {
      input.lines.push(`${" ".repeat(input.indent)}[]`);
      return;
    }

    input.value.forEach((item, index) => {
      const childPointer = appendPointerSegment(input.pointer, String(index));
      if (isScalar(item) || item === null) {
        input.lines.push(`${" ".repeat(input.indent)}- ${formatYamlScalar(item)}`);
      } else {
        input.lines.push(`${" ".repeat(input.indent)}-`);
        appendMeaningfulYamlLines({ ...input, value: item, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
      }
    });
    return;
  }

  if (!isPlainJsonObject(input.value)) {
    input.lines.push(`${" ".repeat(input.indent)}${formatYamlScalar(input.value)}`);
    return;
  }

  const entries = Object.entries(input.value).filter(([key]) => shouldIncludeMeaningfulYamlField(key, appendPointerSegment(input.pointer, key), input.fieldDictionary));
  if (entries.length === 0) {
    input.lines.push(`${" ".repeat(input.indent)}{}`);
  }

  for (const [key, child] of Object.entries(input.value)) {
    const childPointer = appendPointerSegment(input.pointer, key);
    if (!shouldIncludeMeaningfulYamlField(key, childPointer, input.fieldDictionary)) {
      if (isTechnicalProjectionField(key)) {
        input.hiddenTechnicalPointers.push({
          ...input.hiddenSourceBase,
          pointer: childPointer,
          role: key,
          label: resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary)
        });
      }
      continue;
    }

    const label = resolveProjectionFieldLabel(key, childPointer, input.fieldDictionary);
    if (isScalar(child) || child === null) {
      input.lines.push(`${" ".repeat(input.indent)}${label}: ${formatYamlScalar(child)}`);
    } else {
      input.lines.push(`${" ".repeat(input.indent)}${label}:`);
      appendMeaningfulYamlLines({ ...input, value: child, pointer: childPointer, indent: input.indent + 2, maxDepth: input.maxDepth - 1 });
    }
  }
}

function shouldIncludeMeaningfulYamlField(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): boolean {
  const dictionaryEntry = resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary);
  if (dictionaryEntry?.meaningful === false) {
    return false;
  }

  if (isTechnicalProjectionField(key)) {
    return dictionaryEntry?.meaningful === true;
  }

  return true;
}

function resolveProjectionFieldLabel(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): string {
  return resolveProjectionFieldDictionaryEntry(key, pointer, fieldDictionary)?.label ?? titleFromToken(key);
}

function resolveProjectionFieldDictionaryEntry(
  key: string,
  pointer: string,
  fieldDictionary: readonly EditorEntityFieldDictionaryEntry[]
): EditorEntityFieldDictionaryEntry | undefined {
  return fieldDictionary.find((entry) => entry.pointer === pointer) ?? fieldDictionary.find((entry) => entry.key === key);
}

function isTechnicalProjectionField(key: string): boolean {
  return key === "$schema" || key.startsWith("_");
}

function editorEntityFacetLabel(facetKind: EditorEntityFacetKind): string {
  switch (facetKind) {
    case "logic":
      return "Логика";
    case "content":
      return "Содержание";
    case "state":
      return "Состояние";
    case "view":
      return "Отображение";
    case "design":
      return "Дизайн";
    case "plugin":
      return "Плагин";
  }
}

function formatYamlScalar(value: JsonValue | string): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value) || isPlainJsonObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

function summarizeYamlValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }

  if (isPlainJsonObject(value)) {
    return `${Object.keys(value).length} fields`;
  }

  return String(value);
}

function createManifestTimeline(
  entries: readonly ManifestTimelineEntry[],
  rootEntryIds: readonly string[]
): ManifestTimeline {
  return {
    entries,
    rootEntryIds,
    entryById: new Map(entries.map((entry) => [entry.id, entry]))
  };
}

function readStringProperty(value: JsonObject, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

function readStringArrayProperty(value: JsonObject, key: string): readonly string[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}
