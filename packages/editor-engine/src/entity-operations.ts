/**
 * Entity create / delete / refactor operations as EditorChangeSet builders
 * (ADR-057 §4.2, §4.5, §4.10; editor-preview-first-ux §9.1; design-spec §2.8;
 * ADR-050). This is Phase 6.1: the CORE, framework-agnostic, deterministic half.
 * These builders only PRODUCE an `EditorChangeSet` (ADR-034 reverse projection);
 * applying it (the multi-document apply path) and the UI are Phase 6.2 and are
 * intentionally NOT implemented here.
 *
 * Design invariants honoured here (ADR-057 §5, CLAUDE.md §10):
 *   - Builders are PURE and DETERMINISTIC: same inputs → byte-identical ChangeSet.
 *   - Entity identity and cross-entity links come ONLY from the supplied
 *     `EditorEntityProjection` (ADR-052); no bespoke entity index is built here.
 *   - Visuality ("does this type get a UI facet?") is read from the DECLARATIVE
 *     `_requiresView` schema flag on the type's authoring definition, never from a
 *     hardcoded list of types or game ids — the engine stays game-agnostic.
 *   - Reference (link) fields are recognised by the SAME generic naming
 *     convention used by `change-risk.ts` / the identity-discipline diagnostics
 *     (`*Id` / `*Ids` / `*Ref` / `*Refs`, camelCase or snake_case), never by a
 *     manifest-specific key list.
 *
 * "Facet" (фасет) = one of the several authoring documents/subtrees that together
 * make up a single editor entity (its game logic node, its UI view node, ...).
 * A "reference" / "incoming reference" (входящая ссылка) is a field on ANOTHER
 * entity whose value is this entity's `id`; the reference direction the editor
 * models is UI → game (a UI element points at a game entity id).
 */
import { isPlainJsonObject, titleFromToken } from "./shared.ts";
import { appendPointerSegment, jsonPointerExists, parseJsonPointer, readJsonPointer } from "./json-pointer-patch.ts";
import { isSameOrDescendantPointer } from "./semantics.ts";
import { inferEditorEntityDocumentChannel, inferEditorEntityDocumentKind } from "./entity-projection.ts";
import { classifyChangeSet } from "./change-risk.ts";
import { createPrototypeExtractionProposal } from "./prototype-extraction.ts";
import type {
  ChangeRisk,
  DocumentSnapshot,
  EditorChangeSet,
  EditorChangeSetJsonPatch,
  EditorEntity,
  EditorEntityDocumentKind,
  EditorEntityProjection,
  EditorEntityProjectionDocument,
  JsonObject,
  JsonPatchOperation,
  JsonValue,
  TextLocationMap
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public input/result contracts (design-spec §2.8, verbatim signatures).
// ---------------------------------------------------------------------------

/** Deletion policy for the entity's incoming references (design-spec §2.8). */
export type DeleteReferencePolicy = "abort" | "clean" | "retarget";

/** Human-facing outcome summary carried by every builder result. */
export interface EntityOperationReport {
  /** One-line English summary for logs and the (Phase 6.2) approval envelope. */
  readonly summary: string;
  /** Ordered, human-readable detail lines (what was created/removed/updated). */
  readonly details: readonly string[];
}

/** One concrete incoming reference field pointing at the operated entity's id. */
export interface EntityIncomingReference {
  readonly filePath: string;
  /** JSON Pointer of the reference field (or of the array element for list refs). */
  readonly pointer: string;
  /** The reference key that carried the link (for example `actionId`, `screenId`). */
  readonly key: string;
  /** `true` when the pointer addresses one element inside a reference array. */
  readonly isArrayElement: boolean;
}

/** `createEntity({ typeOrPrototype, containerPointer?, channel, label? })`. */
export interface BuildCreateEntityInput {
  /** Semantic type or `_definitions` prototype key of the new entity. */
  readonly typeOrPrototype: string;
  /** Active preview channel; selects the UI authoring document for the UI facet. */
  readonly channel: string;
  /** Optional UI container pointer (a drop target) for the UI node. */
  readonly containerPointer?: string;
  /** Optional editor label; drives the generated id slug. */
  readonly label?: string;
  /** Optional explicit id override (still slugged + uniqueness-checked). */
  readonly id?: string;
}

export type BuildCreateEntityResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly entityId: string; readonly report: EntityOperationReport }
  | { readonly ok: false; readonly reason: string };

/** `createPrototype({ baseType | fromEntityId })` (ADR-050). */
export type BuildCreatePrototypeInput =
  | { readonly baseType: string; readonly semantics?: string }
  | { readonly fromEntityId: string; readonly semantics?: string };

export type BuildCreatePrototypeResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly definitionType: string; readonly report: EntityOperationReport }
  | { readonly ok: false; readonly reason: string };

/** `deleteEntity({ entityId, referencePolicy, retargetTo? })`. */
export interface BuildDeleteEntityInput {
  readonly entityId: string;
  readonly referencePolicy: DeleteReferencePolicy;
  /** Required (and validated) only for `referencePolicy: "retarget"`. */
  readonly retargetTo?: string;
}

export type BuildDeleteEntityResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly report: EntityOperationReport }
  | {
      readonly ok: false;
      /** `"abort"` for the abort policy with incoming refs; otherwise an error kind. */
      readonly reason: string;
      /** Populated on an `abort` refusal so the UI can list what still points here. */
      readonly incomingReferences: readonly EntityIncomingReference[];
    };

/** `renameEntityId({ entityId, newId })` — always dangerous (ADR-057 §4.5). */
export interface BuildRenameEntityIdInput {
  readonly entityId: string;
  readonly newId: string;
}

export type BuildRenameEntityIdResult =
  | {
      readonly ok: true;
      readonly changeSet: EditorChangeSet;
      readonly report: EntityOperationReport;
      /** Always `"dangerous"`; verified through `classifyChangeSet` (ADR-057 §4.5). */
      readonly risk: ChangeRisk;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * `addViewFacet({ entityId, channel, containerPointer? })` — adds ONLY the UI
 * (view) facet for an ALREADY EXISTING game entity in one channel (design-spec
 * §3.2 "создать вид", editor-preview-first-ux §2.1). This is the counterpart of
 * `createEntity` (which creates BOTH facets of a brand-new entity): here the game
 * facet already exists, so the change touches the UI document only.
 */
export interface BuildAddViewFacetInput {
  readonly entityId: string;
  /** Preview channel whose UI authoring document receives the new view node. */
  readonly channel: string;
  /** Optional UI container pointer (a drop target) for the new UI node. */
  readonly containerPointer?: string;
}

export type BuildAddViewFacetResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly report: EntityOperationReport }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// 1. createEntity — atomic cross-manifest game facet + optional UI facet.
// ---------------------------------------------------------------------------

/**
 * Builds ONE `EditorChangeSet` that atomically creates a new entity: a game
 * facet in the game authoring document and — for VISUAL types only — a UI facet
 * (a UI node referencing the game id) in the active channel's UI document.
 *
 * The single ChangeSet may carry JSON patches for TWO file paths at once; the
 * contract allows that (multi-file), and the multi-document apply is Phase 6.2.
 */
export function buildCreateEntityChangeSet(
  input: BuildCreateEntityInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildCreateEntityResult {
  const docs = normalizeDocuments(documents);
  const gameDoc = docs.find((doc) => doc.kind === "game");
  if (gameDoc === undefined || !isPlainJsonObject(gameDoc.json)) {
    return { ok: false, reason: "createEntity requires a game authoring document with an object root." };
  }

  // id = ASCII slug from the label (Cyrillic transliterated), made unique
  // against every existing public id in the projection (design-spec §2.8).
  const label = input.label ?? titleFromToken(shortTypeName(input.typeOrPrototype));
  const baseId = slugifyEntityId(input.id ?? input.label ?? shortTypeName(input.typeOrPrototype));
  const id = makeUniqueId(baseId, collectPublicEntityIds(projection));

  // Game facet: a minimal instance. From a prototype the instance only carries
  // `_type` (+ id/_label) and inherits its body from `_definitions[type]`
  // (ADR-050); a from-scratch type produces the same minimal shape.
  const gameNode: JsonObject = { id, _type: input.typeOrPrototype, _label: label };
  const patches: EditorChangeSetJsonPatch[] = [
    { filePath: gameDoc.filePath, operations: addKeyedIntoContainerOps(gameDoc.json, "/root/content", id, gameNode) }
  ];
  const details = [`Add game facet "${label}" (${id}) at /root/content in ${gameDoc.filePath}.`];

  // UI facet only for visual types, recognised by the DECLARATIVE `_requiresView`
  // flag on the type's authoring definition (design-spec §1.5; ADR-057 §4.2, §5).
  const visual = isVisualType(input.typeOrPrototype, input.channel, docs);
  if (visual) {
    const uiDoc = docs.find((doc) => doc.kind === "ui" && (doc.channel === input.channel || doc.channel === undefined));
    if (uiDoc === undefined || !isPlainJsonObject(uiDoc.json)) {
      return { ok: false, reason: `Visual type "${input.typeOrPrototype}" needs a UI document for channel "${input.channel}".` };
    }
    // The UI node references the game entity by id through an explicit `*Id` link
    // field (`gameEntityId`), which the identity-discipline convention recognises
    // as a game reference (so the node is not flagged an orphan).
    const uiNode: JsonObject = { id, _type: input.typeOrPrototype, _label: label, gameEntityId: id };
    const containerPointer = input.containerPointer ?? "/root/children";
    patches.push({ filePath: uiDoc.filePath, operations: addNodeIntoContainerOps(uiDoc.json, containerPointer, id, uiNode) });
    details.push(`Add UI facet referencing "${id}" into ${containerPointer} of ${uiDoc.filePath}.`);
  } else {
    details.push("Non-visual type: no UI facet created.");
  }

  const changeSet: EditorChangeSet = {
    id: `create-entity:${id}`,
    summary: `Create entity "${label}" (${id})${visual ? " with game and UI facets" : " (game facet only)"}.`,
    jsonPatches: patches
  };
  return { ok: true, changeSet, entityId: id, report: { summary: changeSet.summary, details } };
}

// ---------------------------------------------------------------------------
// 2. createPrototype — add a local prototype to `_definitions` (ADR-050).
// ---------------------------------------------------------------------------

/**
 * Builds a ChangeSet that adds a local, game-level prototype to `_definitions`
 * (ADR-050 §5/§6). It never promotes to the platform catalogue and never
 * auto-promotes. Two paths (design-spec §2.8):
 *   - `{ baseType }`      → a fresh definition `{ _extends: baseType, _semantics }`.
 *   - `{ fromEntityId }`  → reuse `createPrototypeExtractionProposal` when the
 *                           entity has sibling instances of the same `_type`;
 *                           otherwise lift the single instance's shape.
 */
export function buildCreatePrototypeChangeSet(
  input: BuildCreatePrototypeInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildCreatePrototypeResult {
  const docs = normalizeDocuments(documents);

  if ("baseType" in input) {
    // Route the definition to the authoring doc whose kind matches the type
    // namespace (`ui.*` → a UI doc, else the game doc). Prototypes are per-file.
    const targetDoc = pickDefinitionDocument(input.baseType, docs);
    if (targetDoc === undefined || !isPlainJsonObject(targetDoc.json)) {
      return { ok: false, reason: `createPrototype needs an authoring document for base type "${input.baseType}".` };
    }
    const definitionType = makeUniqueDefinitionType(input.baseType, targetDoc.json);
    const definition: JsonObject = {
      _extends: input.baseType,
      _semantics: input.semantics ?? `Local prototype extending ${input.baseType}.`
    };
    const changeSet: EditorChangeSet = {
      id: `create-prototype:${definitionType}`,
      summary: `Create local prototype ${definitionType} extending ${input.baseType}.`,
      jsonPatches: [
        { filePath: targetDoc.filePath, operations: addKeyedIntoContainerOps(targetDoc.json, "/_definitions", definitionType, definition) }
      ]
    };
    return {
      ok: true,
      changeSet,
      definitionType,
      report: { summary: changeSet.summary, details: [`Add ${definitionType} to /_definitions of ${targetDoc.filePath}.`] }
    };
  }

  // fromEntityId path.
  const entity = projection.entityById.get(input.fromEntityId);
  if (entity === undefined) {
    return { ok: false, reason: `Unknown entity for createPrototype: ${input.fromEntityId}` };
  }
  const doc = docs.find((candidate) => candidate.filePath === entity.primarySource.filePath);
  if (doc === undefined || !isPlainJsonObject(doc.json)) {
    return { ok: false, reason: `Missing authoring document for entity ${input.fromEntityId}.` };
  }
  const node = readJsonPointer(doc.json, entity.primarySource.pointer);
  if (!isPlainJsonObject(node)) {
    return { ok: false, reason: `Entity ${input.fromEntityId} does not resolve to an object.` };
  }
  const baseType = typeof node._type === "string" ? node._type : `ui.${pascalCase(entity.label)}`;
  const definitionType = makeUniqueDefinitionType(baseType, doc.json);
  const semantics = input.semantics ?? `Prototype extracted from ${entity.label}.`;

  // Prefer the shared extraction pipeline when >=2 sibling instances exist.
  const siblings = collectSameTypeInstancePointers(doc.json, typeof node._type === "string" ? node._type : undefined);
  if (siblings.length >= 2) {
    const proposal = createPrototypeExtractionProposal({
      snapshot: snapshotFromDocument(doc),
      sourcePointers: siblings,
      definitionType,
      definitionSemantics: semantics
    });
    if (!proposal.ok) {
      return { ok: false, reason: proposal.diagnostics[0]?.message ?? "Prototype extraction failed." };
    }
    return {
      ok: true,
      changeSet: proposal.proposal.changeSet,
      definitionType,
      report: { summary: proposal.proposal.changeSet.summary, details: [proposal.proposal.score.summary] }
    };
  }

  // Single-instance lift: create a definition extending the current `_type` and
  // re-point the instance at the new definition (minimal, empty common body).
  const definition: JsonObject = typeof node._type === "string" ? { _extends: node._type, _semantics: semantics } : { _semantics: semantics };
  const changeSet: EditorChangeSet = {
    id: `create-prototype:${definitionType}`,
    summary: `Create local prototype ${definitionType} from ${entity.label}.`,
    jsonPatches: [
      {
        filePath: doc.filePath,
        operations: [
          ...addKeyedIntoContainerOps(doc.json, "/_definitions", definitionType, definition),
          { op: "replace", path: appendPointerSegment(entity.primarySource.pointer, "_type"), value: definitionType }
        ]
      }
    ]
  };
  return {
    ok: true,
    changeSet,
    definitionType,
    report: { summary: changeSet.summary, details: [`Lift ${entity.label} into ${definitionType}.`] }
  };
}

// ---------------------------------------------------------------------------
// 3. deleteEntity — entity-level deletion with an incoming-reference policy.
// ---------------------------------------------------------------------------

/**
 * Builds a ChangeSet that deletes an entity and applies the chosen policy to its
 * incoming references (ADR-057 §4.10; editor-preview-first-ux §9.1). The set of
 * referrers is discovered through the SAME projection index `change-risk.ts`
 * uses (`entitiesBySourcePointer`); the concrete writable reference-field
 * pointers are resolved by scanning for reference-convention keys equal to the
 * entity id.
 *   - `abort`    → refuse and return the incoming reference list (no ChangeSet).
 *   - `clean`    → also remove every incoming reference field.
 *   - `retarget` → replace every incoming reference with `retargetTo`.
 */
export function buildDeleteEntityChangeSet(
  input: BuildDeleteEntityInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildDeleteEntityResult {
  const docs = normalizeDocuments(documents);
  const entity = projection.entityById.get(input.entityId);
  if (entity === undefined) {
    return { ok: false, reason: `Unknown entity: ${input.entityId}`, incomingReferences: [] };
  }

  const publicId = publicEntityId(entity);
  const owned = ownedSourcePointers(projection, entity);
  const incoming =
    publicId === undefined ? [] : collectIncomingReferences(docs, publicId, owned);

  if (incoming.length > 0 && input.referencePolicy === "abort") {
    return { ok: false, reason: "abort", incomingReferences: incoming };
  }
  if (input.referencePolicy === "retarget") {
    const retargetTo = input.retargetTo;
    if (retargetTo === undefined || !collectPublicEntityIds(projection).has(retargetTo)) {
      return { ok: false, reason: "retarget requires an existing retargetTo entity id.", incomingReferences: incoming };
    }
  }

  // Remove every OWNED facet node; group by file and remove deepest-last so
  // sibling array-index removals in one file do not shift each other.
  const removalOps = new Map<string, JsonPatchOperation[]>();
  const pushOp = (filePath: string, op: JsonPatchOperation): void => {
    const list = removalOps.get(filePath) ?? [];
    list.push(op);
    removalOps.set(filePath, list);
  };
  for (const source of owned) {
    pushOp(source.filePath, { op: "remove", path: source.pointer });
  }
  const details = [`Delete entity "${entity.label}" (${owned.length} facet node(s)).`];

  if (incoming.length > 0 && input.referencePolicy === "clean") {
    for (const ref of incoming) {
      pushOp(ref.filePath, { op: "remove", path: ref.pointer });
    }
    details.push(`Clean ${incoming.length} incoming reference(s).`);
  }
  if (incoming.length > 0 && input.referencePolicy === "retarget") {
    for (const ref of incoming) {
      pushOp(ref.filePath, { op: "replace", path: ref.pointer, value: input.retargetTo as string });
    }
    details.push(`Retarget ${incoming.length} incoming reference(s) to "${input.retargetTo}".`);
  }

  const jsonPatches: EditorChangeSetJsonPatch[] = [...removalOps.entries()].map(([filePath, ops]) => ({
    filePath,
    operations: orderRemovalsDeepestFirst(ops)
  }));
  const changeSet: EditorChangeSet = {
    id: `delete-entity:${input.entityId}`,
    summary: `Delete entity "${entity.label}" (${input.referencePolicy} policy).`,
    jsonPatches
  };
  return { ok: true, changeSet, report: { summary: changeSet.summary, details } };
}

// ---------------------------------------------------------------------------
// 4. renameEntityId — change the id and every incoming reference (dangerous).
// ---------------------------------------------------------------------------

/**
 * Builds a ChangeSet that renames an entity's `id` AND rewrites every incoming
 * reference (UI → game direction) across all documents to the new id (ADR-057
 * §4.2, §4.10). It is ALWAYS classified `dangerous` (ADR-057 §4.5); the result
 * carries the risk verified through the existing `classifyChangeSet`.
 */
export function buildRenameEntityIdChangeSet(
  input: BuildRenameEntityIdInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildRenameEntityIdResult {
  const docs = normalizeDocuments(documents);
  const entity = projection.entityById.get(input.entityId);
  if (entity === undefined) {
    return { ok: false, reason: `Unknown entity: ${input.entityId}` };
  }
  const oldId = publicEntityId(entity);
  if (oldId === undefined) {
    return { ok: false, reason: `Entity ${input.entityId} has no explicit id to rename.` };
  }
  if (input.newId.trim() === "" || slugifyEntityId(input.newId) !== input.newId) {
    return { ok: false, reason: `newId must be a valid ASCII id slug: ${input.newId}` };
  }
  const taken = collectPublicEntityIds(projection);
  taken.delete(oldId);
  if (taken.has(input.newId)) {
    return { ok: false, reason: `newId is already in use: ${input.newId}` };
  }

  // The entity's own `id` field must exist at `<primary>/id` to be renamed.
  const doc = docs.find((candidate) => candidate.filePath === entity.primarySource.filePath);
  const node = doc !== undefined && doc.json !== undefined ? readJsonPointer(doc.json, entity.primarySource.pointer) : undefined;
  if (!isPlainJsonObject(node) || node.id !== oldId) {
    return { ok: false, reason: `Entity ${input.entityId} does not carry an editable id field.` };
  }

  const owned = ownedSourcePointers(projection, entity);
  const incoming = collectIncomingReferences(docs, oldId, owned);
  const opsByFile = new Map<string, JsonPatchOperation[]>();
  const push = (filePath: string, op: JsonPatchOperation): void => {
    const list = opsByFile.get(filePath) ?? [];
    list.push(op);
    opsByFile.set(filePath, list);
  };
  push(entity.primarySource.filePath, {
    op: "replace",
    path: appendPointerSegment(entity.primarySource.pointer, "id"),
    value: input.newId
  });
  for (const ref of incoming) {
    push(ref.filePath, { op: "replace", path: ref.pointer, value: input.newId });
  }

  const changeSet: EditorChangeSet = {
    id: `rename-entity-id:${oldId}->${input.newId}`,
    summary: `Rename entity id "${oldId}" to "${input.newId}" (updates ${incoming.length} reference(s)).`,
    jsonPatches: [...opsByFile.entries()].map(([filePath, operations]) => ({ filePath, operations }))
  };
  // Verify the risk with the SHARED classifier: an id-field replace (and any
  // reference retarget) is dangerous by ADR-057 §4.5.
  const risk = classifyChangeSet(changeSet, projection).risk;
  return {
    ok: true,
    changeSet,
    risk,
    report: {
      summary: changeSet.summary,
      details: [`Rename id at ${entity.primarySource.filePath}.`, `Rewrite ${incoming.length} incoming reference(s).`]
    }
  };
}

// ---------------------------------------------------------------------------
// 5. addViewFacet — add ONLY a UI view node for an existing game entity.
// ---------------------------------------------------------------------------

/**
 * Builds a ChangeSet that adds a UI (view) facet referencing an EXISTING game
 * entity by its id, in the active channel's UI authoring document. It reuses the
 * exact UI-node shape `buildCreateEntityChangeSet` emits (`{ id, _type, _label,
 * gameEntityId }`) so the identity-discipline convention recognises the link
 * (UI → game) and the node is not flagged an orphan. The game facet is NEVER
 * touched: this is the "создать вид" affordance for a `entity-missing-view`
 * entity, not a full create.
 */
export function buildAddViewFacetChangeSet(
  input: BuildAddViewFacetInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildAddViewFacetResult {
  const docs = normalizeDocuments(documents);
  const entity = projection.entityById.get(input.entityId);
  if (entity === undefined) {
    return { ok: false, reason: `Unknown entity: ${input.entityId}` };
  }
  const publicId = publicEntityId(entity);
  if (publicId === undefined) {
    return { ok: false, reason: `Entity ${input.entityId} has no explicit id to reference from a view.` };
  }

  // Refuse when the entity already has a view (or design) facet in this channel:
  // the affordance only fills a MISSING view, never duplicates an existing one.
  const existingViewSources = [...(entity.facets.view ?? []), ...(entity.facets.design ?? [])];
  if (existingViewSources.some((source) => source.channel === undefined || source.channel === input.channel)) {
    return { ok: false, reason: `Entity ${input.entityId} already has a view in channel "${input.channel}".` };
  }

  const uiDoc = docs.find((doc) => doc.kind === "ui" && (doc.channel === input.channel || doc.channel === undefined));
  if (uiDoc === undefined || !isPlainJsonObject(uiDoc.json)) {
    return { ok: false, reason: `No UI authoring document for channel "${input.channel}".` };
  }

  // Carry the game entity's own `_type`/`_label` onto the UI node so the view is
  // self-describing (same fields `createEntity` writes). `_type` is optional: an
  // entity created from scratch may not carry one.
  const primaryDoc = docs.find((doc) => doc.filePath === entity.primarySource.filePath);
  const primaryNode = primaryDoc?.json !== undefined ? readJsonPointer(primaryDoc.json, entity.primarySource.pointer) : undefined;
  const type = isPlainJsonObject(primaryNode) && typeof primaryNode._type === "string" ? primaryNode._type : undefined;
  const uiNode: JsonObject = {
    id: publicId,
    ...(type !== undefined ? { _type: type } : {}),
    _label: entity.label,
    gameEntityId: publicId
  };
  const containerPointer = input.containerPointer ?? "/root/children";
  const changeSet: EditorChangeSet = {
    id: `add-view-facet:${publicId}:${input.channel}`,
    summary: `Add ${input.channel} view for "${entity.label}" (${publicId}).`,
    jsonPatches: [{ filePath: uiDoc.filePath, operations: addNodeIntoContainerOps(uiDoc.json, containerPointer, publicId, uiNode) }]
  };
  return {
    ok: true,
    changeSet,
    report: {
      summary: changeSet.summary,
      details: [`Add UI facet referencing "${publicId}" into ${containerPointer} of ${uiDoc.filePath}.`]
    }
  };
}

// ---------------------------------------------------------------------------
// 6. fillEntityLabel — add a derived default `_label` to a tree-visible entity
//    that is missing one (Вариант А "fix first" quick fix, TSK-20260708). The
//    `_label` schema check (schema.ts: "must define a non-empty _label") blocks
//    apply/save/preview; this deterministic fix unblocks a manifest by naming
//    the unnamed entities, which the author can then refine. Game-agnostic: the
//    default label is humanised from the entity's OWN authoring `id`, never a
//    hardcoded per-game string.
// ---------------------------------------------------------------------------

/** Input for {@link buildFillEntityLabelChangeSet}. */
export interface BuildFillEntityLabelInput {
  readonly entityId: string;
}

/** Input for {@link buildFillMissingLabelsChangeSet} (the bulk "fix all"). */
export interface BuildFillMissingLabelsInput {
  readonly entityIds: readonly string[];
}

export type BuildFillEntityLabelResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly report: EntityOperationReport }
  | { readonly ok: false; readonly reason: string };

export type BuildFillMissingLabelsResult =
  | { readonly ok: true; readonly changeSet: EditorChangeSet; readonly filledCount: number; readonly report: EntityOperationReport }
  | { readonly ok: false; readonly reason: string };

/**
 * Humanised default `_label` for an entity: title-cased from its authoring `id`
 * (read off the primary node when present), else the public entity id, else the
 * last pointer segment. Deterministic and locale-neutral (`titleFromToken`).
 */
function deriveDefaultEntityLabel(entity: EditorEntity, primaryNode: JsonValue | undefined): string {
  const idFromNode = isPlainJsonObject(primaryNode) && typeof primaryNode.id === "string" ? primaryNode.id.trim() : "";
  const publicId = publicEntityId(entity);
  const lastSegment = entity.primarySource.pointer.split("/").filter((segment) => segment !== "").at(-1);
  const seed = idFromNode !== "" ? idFromNode : (publicId ?? lastSegment ?? entity.kind);
  return titleFromToken(seed);
}

/**
 * Computes the add/replace `_label` operation (and its value) for one entity, or
 * `undefined` when the entity already carries a non-empty `_label` FIELD.
 *
 * The check reads the primary node's own `_label` — NOT `entity.label`, which
 * falls back to `title`/`name`/`id` for display (semantics.ts) and so is set
 * even when `_label` is absent. This mirrors the schema check exactly, so the
 * fix targets precisely the entities the `_label` diagnostic flags.
 */
function fillLabelOperation(
  entity: EditorEntity,
  docs: readonly NormalizedOperationDocument[]
): { readonly value: string; readonly operation: JsonPatchOperation } | undefined {
  const primaryDoc = docs.find((doc) => doc.filePath === entity.primarySource.filePath);
  const primaryNode = primaryDoc?.json !== undefined ? readJsonPointer(primaryDoc.json, entity.primarySource.pointer) : undefined;
  const currentLabel = isPlainJsonObject(primaryNode) && typeof primaryNode._label === "string" ? primaryNode._label.trim() : "";
  if (currentLabel !== "") {
    return undefined;
  }
  const value = deriveDefaultEntityLabel(entity, primaryNode);
  const labelPointer = appendPointerSegment(entity.primarySource.pointer, "_label");
  // "add" creates the member; when `_label` exists but is empty it must be
  // "replace" (RFC 6902 "add" also replaces, but be explicit for clarity).
  const exists = primaryDoc?.json !== undefined && jsonPointerExists(primaryDoc.json, labelPointer);
  return { value, operation: { op: exists ? "replace" : "add", path: labelPointer, value } };
}

/**
 * Builds a ChangeSet that fills the missing `_label` of ONE entity with a
 * derived default. Refuses when the entity is unknown or already has a `_label`.
 */
export function buildFillEntityLabelChangeSet(
  input: BuildFillEntityLabelInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildFillEntityLabelResult {
  const docs = normalizeDocuments(documents);
  const entity = projection.entityById.get(input.entityId);
  if (entity === undefined) {
    return { ok: false, reason: `Unknown entity: ${input.entityId}` };
  }
  const fill = fillLabelOperation(entity, docs);
  if (fill === undefined) {
    return { ok: false, reason: `Entity ${input.entityId} already has a _label.` };
  }
  const changeSet: EditorChangeSet = {
    id: `fill-label:${input.entityId}`,
    summary: `Fill missing _label with "${fill.value}".`,
    jsonPatches: [{ filePath: entity.primarySource.filePath, operations: [fill.operation] }]
  };
  return {
    ok: true,
    changeSet,
    report: { summary: changeSet.summary, details: [`Set _label = "${fill.value}" at ${entity.primarySource.filePath}.`] }
  };
}

/**
 * Builds ONE atomic ChangeSet that fills the missing `_label` of every given
 * entity (the Checks tab "Исправить все"): unresolved or already-labelled
 * entities are skipped; add operations are grouped by file so one durable
 * commit + one undo step names them all. Refuses only when none needs a label.
 */
export function buildFillMissingLabelsChangeSet(
  input: BuildFillMissingLabelsInput,
  projection: EditorEntityProjection,
  documents: readonly EditorEntityProjectionDocument[]
): BuildFillMissingLabelsResult {
  const docs = normalizeDocuments(documents);
  const opsByFile = new Map<string, JsonPatchOperation[]>();
  const seen = new Set<string>();
  let filledCount = 0;
  for (const entityId of input.entityIds) {
    if (seen.has(entityId)) {
      continue;
    }
    seen.add(entityId);
    const entity = projection.entityById.get(entityId);
    if (entity === undefined) {
      continue;
    }
    const fill = fillLabelOperation(entity, docs);
    if (fill === undefined) {
      continue;
    }
    const list = opsByFile.get(entity.primarySource.filePath) ?? [];
    list.push(fill.operation);
    opsByFile.set(entity.primarySource.filePath, list);
    filledCount += 1;
  }
  if (filledCount === 0) {
    return { ok: false, reason: "No given entity is missing a label." };
  }
  const jsonPatches: EditorChangeSetJsonPatch[] = [...opsByFile.entries()].map(([filePath, operations]) => ({ filePath, operations }));
  const changeSet: EditorChangeSet = {
    id: `fill-labels:${[...seen].sort().join(",")}`,
    summary: `Fill ${filledCount} missing _label${filledCount === 1 ? "" : "s"}.`,
    jsonPatches
  };
  return {
    ok: true,
    changeSet,
    filledCount,
    report: { summary: changeSet.summary, details: [`Set ${filledCount} _label field(s) across ${jsonPatches.length} file(s).`] }
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/** A document paired with its resolved kind and channel. */
interface NormalizedOperationDocument {
  readonly filePath: string;
  readonly json: JsonValue | undefined;
  readonly kind: EditorEntityDocumentKind;
  readonly channel: string | undefined;
}

function normalizeDocuments(documents: readonly EditorEntityProjectionDocument[]): readonly NormalizedOperationDocument[] {
  return documents.map((doc) => ({
    filePath: doc.filePath,
    json: doc.json,
    kind: doc.documentKind ?? inferEditorEntityDocumentKind(doc.json),
    channel: doc.channel ?? inferEditorEntityDocumentChannel(doc.json)
  }));
}

/**
 * Compact Cyrillic (Russian) → ASCII transliteration table. Kept inline (no
 * dependency, CLAUDE.md "no new deps"): transliteration is a GENERAL slug concern
 * — the same table is applied to any label, never keyed to a game's language.
 */
const CYRILLIC_TO_ASCII: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y",
  ь: "", э: "e", ю: "yu", я: "ya"
};

/**
 * Turns any label into an ASCII id slug: transliterate Cyrillic, lowercase,
 * collapse every run of non-alphanumeric characters into single hyphens, and
 * trim leading/trailing hyphens. Empty results fall back to `"entity"`.
 */
export function slugifyEntityId(label: string): string {
  let out = "";
  for (const char of label.toLowerCase()) {
    out += CYRILLIC_TO_ASCII[char] ?? char;
  }
  const slug = out
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "entity" : slug;
}

/** Appends `-2`, `-3`, ... to `base` until it is not present in `taken`. */
function makeUniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) {
    counter += 1;
  }
  return `${base}-${counter}`;
}

/**
 * Every existing PUBLIC entity id in the projection. The projection stores ids as
 * `${kind}:${publicId}`; synthetic `filePath#pointer` ids (entities without an
 * explicit id) are skipped, mirroring `collectGameReferenceIds` in the projection.
 */
function collectPublicEntityIds(projection: EditorEntityProjection): Set<string> {
  const ids = new Set<string>();
  for (const entity of projection.entities) {
    const publicId = publicEntityId(entity);
    if (publicId !== undefined) {
      ids.add(publicId);
    }
  }
  return ids;
}

/** The explicit public id of an entity, or `undefined` for synthetic ids. */
function publicEntityId(entity: EditorEntity): string | undefined {
  const publicId = entity.entityId.slice(entity.kind.length + 1);
  return publicId === "" || publicId.includes("#") ? undefined : publicId;
}

/** Last dotted segment of a type, for example `ui.MetricBar` → `MetricBar`. */
function shortTypeName(type: string): string {
  const parts = type.split(".");
  return parts[parts.length - 1] ?? type;
}

/** PascalCase an arbitrary label into a valid definition name segment. */
function pascalCase(label: string): string {
  const parts = slugifyEntityId(label).split("-").filter((part) => part !== "");
  const name = parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
  return name === "" ? "Prototype" : name;
}

/**
 * True when the authoring definition of `type` declares `_requiresView` for the
 * channel. Read purely from the DECLARATIVE flag on `_definitions[type]` across
 * the documents (ADR-057 §4.2, §5) — never from a hardcoded type list. A type
 * with no definition (created from scratch) is treated as non-visual.
 */
function isVisualType(type: string, channel: string, docs: readonly NormalizedOperationDocument[]): boolean {
  for (const doc of docs) {
    if (!isPlainJsonObject(doc.json)) {
      continue;
    }
    const definition = readJsonPointer(doc.json, appendPointerSegment("/_definitions", type));
    if (isPlainJsonObject(definition) && requiresViewInChannel(definition._requiresView, channel)) {
      return true;
    }
  }
  return false;
}

/** `true`/`{channels:[...]}` interpretation of `_requiresView` (ADR-057 §4.2). */
function requiresViewInChannel(requiresView: JsonValue | undefined, channel: string): boolean {
  if (requiresView === true) {
    return true;
  }
  if (isPlainJsonObject(requiresView) && Array.isArray(requiresView.channels)) {
    return requiresView.channels.includes(channel);
  }
  return false;
}

/** Chooses the authoring document a new `type` prototype belongs in. */
function pickDefinitionDocument(
  type: string,
  docs: readonly NormalizedOperationDocument[]
): NormalizedOperationDocument | undefined {
  const wantsUi = type.startsWith("ui.");
  return docs.find((doc) => (wantsUi ? doc.kind === "ui" : doc.kind === "game")) ?? docs.find((doc) => doc.kind === "game");
}

/** Picks a unique `_definitions` key derived from a base type (`…Local`, `…Local2`, …). */
function makeUniqueDefinitionType(baseType: string, json: JsonValue): string {
  const segments = baseType.split(".");
  const namespace = segments.slice(0, -1).join(".") || "local";
  const name = segments[segments.length - 1] ?? "Prototype";
  let candidate = `${namespace}.${name}Local`;
  let counter = 2;
  while (jsonPointerExists(json, appendPointerSegment("/_definitions", candidate))) {
    candidate = `${namespace}.${name}Local${counter}`;
    counter += 1;
  }
  return candidate;
}

/** All concrete instance pointers (outside `_definitions`) whose `_type` matches. */
function collectSameTypeInstancePointers(json: JsonValue, type: string | undefined): readonly string[] {
  if (type === undefined) {
    return [];
  }
  const pointers: string[] = [];
  const visit = (value: JsonValue, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, appendPointerSegment(pointer, String(index))));
      return;
    }
    if (!isPlainJsonObject(value)) {
      return;
    }
    if (!pointer.startsWith("/_definitions") && value._type === type) {
      pointers.push(pointer);
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, appendPointerSegment(pointer, key));
    }
  };
  visit(json, "");
  return pointers;
}

/**
 * The source pointers an entity OWNS (its own facet nodes). A facet source is
 * owned unless it is the PRIMARY source of a different entity (a cross-link, not
 * a satellite of this entity). Descendant pointers already covered by an owned
 * ancestor in the same file are dropped, so a single `remove` of the ancestor
 * takes the whole subtree with it.
 */
function ownedSourcePointers(
  projection: EditorEntityProjection,
  entity: EditorEntity
): readonly { readonly filePath: string; readonly pointer: string }[] {
  const otherPrimaries = new Set<string>();
  for (const candidate of projection.entities) {
    if (candidate.entityId !== entity.entityId) {
      otherPrimaries.add(`${candidate.primarySource.filePath}#${candidate.primarySource.pointer}`);
    }
  }

  const primaryKey = `${entity.primarySource.filePath}#${entity.primarySource.pointer}`;
  const sources = [entity.primarySource, ...Object.values(entity.facets).flat()];
  const seen = new Set<string>();
  const kept: { readonly filePath: string; readonly pointer: string }[] = [];
  for (const source of sources) {
    if (source === undefined) {
      continue;
    }
    const key = `${source.filePath}#${source.pointer}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // Keep the primary, and any facet node that no OTHER entity owns as primary.
    if (key !== primaryKey && otherPrimaries.has(key)) {
      continue;
    }
    kept.push({ filePath: source.filePath, pointer: source.pointer });
  }

  // Drop descendants covered by a kept ancestor in the same file.
  return kept.filter(
    (candidate) =>
      !kept.some(
        (other) =>
          other !== candidate &&
          other.filePath === candidate.filePath &&
          other.pointer !== candidate.pointer &&
          isSameOrDescendantPointer(candidate.pointer, other.pointer)
      )
  );
}

/**
 * Concrete incoming reference fields pointing at `targetId`, found by scanning
 * every document for reference-convention keys (`*Id`/`*Ref`, camel/snake) whose
 * value (or array element) equals the id. Pointers inside the entity's own owned
 * subtrees are skipped so its identity fields are never mistaken for a link.
 * This mirrors the reference-key convention used by `change-risk.ts`.
 */
function collectIncomingReferences(
  docs: readonly NormalizedOperationDocument[],
  targetId: string,
  owned: readonly { readonly filePath: string; readonly pointer: string }[]
): readonly EntityIncomingReference[] {
  const references: EntityIncomingReference[] = [];
  const isOwned = (filePath: string, pointer: string): boolean =>
    owned.some((source) => source.filePath === filePath && isSameOrDescendantPointer(pointer, source.pointer));

  for (const doc of docs) {
    if (doc.json === undefined) {
      continue;
    }
    const visit = (value: JsonValue, pointer: string): void => {
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, appendPointerSegment(pointer, String(index))));
        return;
      }
      if (!isPlainJsonObject(value)) {
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        const childPointer = appendPointerSegment(pointer, key);
        if (isEntityReferenceKey(key) && !isOwned(doc.filePath, childPointer)) {
          if (child === targetId) {
            references.push({ filePath: doc.filePath, pointer: childPointer, key, isArrayElement: false });
          } else if (Array.isArray(child)) {
            child.forEach((item, index) => {
              if (item === targetId) {
                references.push({
                  filePath: doc.filePath,
                  pointer: appendPointerSegment(childPointer, String(index)),
                  key,
                  isArrayElement: true
                });
              }
            });
          }
        }
        visit(child, childPointer);
      }
    };
    visit(doc.json, "");
  }
  return references;
}

/** camelCase / snake_case reference-key convention shared with `change-risk.ts`. */
function isEntityReferenceKey(key: string): boolean {
  if (key === "id" || key === "_id") {
    return false;
  }
  return /[a-z0-9](Id|Ids|Ref|Refs)$/.test(key) || /_(id|ids|ref|refs)$/.test(key);
}

/** Removes deepest / highest-array-index pointers first to keep indices stable. */
function orderRemovalsDeepestFirst(ops: readonly JsonPatchOperation[]): readonly JsonPatchOperation[] {
  return [...ops].sort((left, right) => comparePointersDescending(left.path, right.path));
}

function comparePointersDescending(left: string, right: string): number {
  const leftSegments = parseJsonPointer(left);
  const rightSegments = parseJsonPointer(right);
  const length = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftSegments[index];
    const b = rightSegments[index];
    if (a === b) {
      continue;
    }
    if (a === undefined) {
      return 1;
    }
    if (b === undefined) {
      return -1;
    }
    const aNumber = Number(a);
    const bNumber = Number(b);
    if (Number.isInteger(aNumber) && Number.isInteger(bNumber)) {
      return bNumber - aNumber;
    }
    return b.localeCompare(a);
  }
  return 0;
}

/**
 * Adds `value` under key `key` of the object container at `containerPointer`,
 * creating the container object when absent (the same conditional-`add` pattern
 * `prototype-extraction.ts` uses for `/_definitions`).
 */
function addKeyedIntoContainerOps(
  json: JsonValue,
  containerPointer: string,
  key: string,
  value: JsonValue
): readonly JsonPatchOperation[] {
  if (jsonPointerExists(json, containerPointer)) {
    return [{ op: "add", path: appendPointerSegment(containerPointer, key), value }];
  }
  return [{ op: "add", path: containerPointer, value: { [key]: value } }];
}

/**
 * Adds a node into the container at `containerPointer`: appends to an array,
 * adds a keyed member to an object, or creates a fresh array when the container
 * is absent. Deterministic for both the drop-target and default-container cases.
 */
function addNodeIntoContainerOps(
  json: JsonValue,
  containerPointer: string,
  key: string,
  value: JsonValue
): readonly JsonPatchOperation[] {
  const container = readJsonPointer(json, containerPointer);
  if (Array.isArray(container)) {
    return [{ op: "add", path: appendPointerSegment(containerPointer, "-"), value }];
  }
  if (isPlainJsonObject(container)) {
    return [{ op: "add", path: appendPointerSegment(containerPointer, key), value }];
  }
  // Missing container: create it as an array holding the node.
  return [{ op: "add", path: containerPointer, value: [value] }];
}

/** Minimal empty text-location map for reusing `DocumentSnapshot`-shaped APIs. */
const EMPTY_LOCATION_MAP: TextLocationMap = {
  get: () => undefined,
  getEntry: () => undefined,
  entries: () => []
};

/**
 * Wraps an authoring document as a minimal `DocumentSnapshot` so it can be passed
 * to `createPrototypeExtractionProposal`, which only reads `json` and `filePath`.
 */
function snapshotFromDocument(doc: NormalizedOperationDocument): DocumentSnapshot {
  return {
    filePath: doc.filePath,
    text: "",
    json: doc.json,
    diagnostics: [],
    selectedPointer: undefined,
    locationMap: EMPTY_LOCATION_MAP
  };
}
