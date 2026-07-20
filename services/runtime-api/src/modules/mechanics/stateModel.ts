/** Resolve and validate declared state symbols without accepting raw paths. */
import type {
  EntityCollectionModel,
  RecordCollectionModel
} from "@cubica/contracts-manifest";
import type { CollectionModel, MechanicsExecutionContext, JsonRecord } from "./types.ts";
import {
  measureBoundedJson,
  type JsonPrimitiveMeasurementCache
} from "./budget.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";
import { MechanicsExecutionError } from "./errors.ts";

const forbiddenSegments = new Set(["__proto__", "constructor", "prototype"]);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

type StateReference = {
  endpoint: string;
  bindings?: Record<string, unknown>;
};
export type ResolvedStateBindings = Record<string, string>;
type RuntimeStorageSegment = string | { context: "actor" } | { binding: string };
type RuntimeStorageLocation = {
  root: "public" | "secret" | "players";
  segments: Array<RuntimeStorageSegment>;
};
type LogicalCollectionField = CollectionModel["fields"][string];
type StoredLogicalCollectionField = Extract<LogicalCollectionField, { storage: unknown }>;
type DerivedLogicalCollectionField = Extract<LogicalCollectionField, { source: unknown }>;

/**
 * Opaque proof that one exact snapshot crossed complete read-only validation.
 *
 * The brand is private to this module and the associated data lives in a
 * private WeakMap, so neither manifest data nor a direct runtime caller can
 * forge a cache hit. The proof is deliberately request-local: no session id,
 * state version or availability decision is retained here.
 */
const verifiedReadOnlyStateAccessBrand: unique symbol =
  Symbol("cubica.verified-read-only-state-access");
export interface VerifiedReadOnlyStateAccess {
  readonly [verifiedReadOnlyStateAccessBrand]: true;
}

type StateAccessContext = Pick<
  MechanicsExecutionContext,
  "stateModel" | "state" | "preActionState" | "params" | "actor" | "limits"
> & {
  /** Present only inside one protected read-only predicate batch. */
  verifiedReadOnlyStateAccess?: VerifiedReadOnlyStateAccess;
  /**
   * Primitive byte lengths shared only inside that same batch. This is not a
   * state/object validation cache and cannot authorize a skipped branch.
   */
  jsonPrimitiveMeasurements?: JsonPrimitiveMeasurementCache;
};

type ValidatedCollectionAccess = {
  model: CollectionModel;
  entries: Array<[string, JsonRecord]>;
  raw: JsonRecord | Array<unknown>;
};

type VerifiedEndpointRead = {
  value: unknown;
};

type VerifiedCollectionRead = {
  raw: JsonRecord | Array<unknown>;
  result: ValidatedCollectionAccess;
};

type VerifiedReadOnlyStateAccessData = {
  stateModel: StateAccessContext["stateModel"];
  state: StateAccessContext["state"];
  preActionState: StateAccessContext["preActionState"];
  limits: StateAccessContext["limits"];
  endpointReads: Map<string, VerifiedEndpointRead>;
  collectionReads: Map<string, VerifiedCollectionRead>;
};

type StateModelTraversalMetadata = {
  endpoints: ReadonlyArray<
    readonly [string, StateAccessContext["stateModel"]["endpoints"][string]]
  >;
  collections: ReadonlyArray<readonly [string, CollectionModel]>;
};

type EntityAreaMetadata = {
  facet: ReadonlySet<string>;
  attribute: ReadonlySet<string>;
};

type CollectionFieldMetadata<TModel extends CollectionModel = CollectionModel> = {
  stored: ReadonlyArray<
    readonly [string, Extract<TModel["fields"][string], { storage: unknown }>]
  >;
  derived: ReadonlyArray<
    readonly [string, Extract<TModel["fields"][string], { source: unknown }>]
  >;
};

/**
 * Admitted game bundles are deeply frozen once, so their descriptive model can
 * safely own weakly referenced lookup metadata across many session snapshots.
 * Session state and validation outcomes are intentionally absent from every
 * cache: each call still traverses and validates every current stored value.
 *
 * Direct test/editor callers may supply mutable models. The helpers below
 * detect that case and rebuild metadata instead of risking stale validation.
 */
const stateModelTraversalMetadataCache = new WeakMap<
  StateAccessContext["stateModel"],
  StateModelTraversalMetadata
>();
const recordPathMetadataCache = new WeakMap<RecordCollectionModel, RecordPathNode>();
const entityAreaMetadataCache = new WeakMap<EntityCollectionModel, EntityAreaMetadata>();
const collectionFieldMetadataCache = new WeakMap<CollectionModel, CollectionFieldMetadata>();
const verifiedReadOnlyStateAccessData = new WeakMap<
  VerifiedReadOnlyStateAccess,
  VerifiedReadOnlyStateAccessData
>();

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Validate identifiers produced by runtime expressions before map access. */
export function requireMechanicsIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !identifierPattern.test(value) || forbiddenSegments.has(value)) {
    throw new MechanicsExecutionError("MECHANICS_IDENTIFIER_INVALID", `${label} must be a safe Mechanics identifier`);
  }
  return value;
}

function storageSegments(
  segments: Array<RuntimeStorageSegment>,
  context: StateAccessContext,
  bindings: ResolvedStateBindings
): Array<string> {
  return segments.map((segment) => {
    const value = typeof segment === "string"
      ? segment
      : "context" in segment
        ? context.actor.actorPlayerId
        : bindings[segment.binding];
    if (typeof value !== "string" || value.length === 0 || forbiddenSegments.has(value)) {
      throw new MechanicsExecutionError("MECHANICS_STORAGE_CONTEXT_INVALID", "A dynamic storage segment is unavailable");
    }
    return value;
  });
}

/** Binding-derived locations were not covered by the snapshot-wide model walk. */
function storageNeedsBinding(segments: ReadonlyArray<RuntimeStorageSegment>): boolean {
  return segments.some((segment) => typeof segment !== "string" && "binding" in segment);
}

function locationParts(
  storage: RuntimeStorageLocation,
  context: StateAccessContext,
  bindings: ResolvedStateBindings = {}
): Array<string> {
  return [storage.root, ...storageSegments(storage.segments, context, bindings)];
}

function readParts(root: JsonRecord, parts: Array<string>): unknown {
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as JsonRecord)[part];
  }
  return current;
}

/**
 * Resolve every state location that is knowable at the current boundary.
 *
 * Actor placeholders expand over the complete stored actor map rather than
 * only the caller. That distinction matters at commit time: one command must
 * not be able to leave another participant's declared state corrupt. A
 * parameter-derived location is validated only when that parameter is present;
 * publication cannot assign a canonical location to an absent runtime value.
 */
function availableStorageValues(
  state: JsonRecord,
  storage: {
    root: "public" | "secret" | "players";
    segments: Array<RuntimeStorageSegment>;
  },
  context: StateAccessContext
): Array<unknown> {
  let values: Array<unknown> = [state[storage.root]];
  for (const segment of storage.segments) {
    if (typeof segment === "string") {
      values = values.map((value) => isRecord(value) || Array.isArray(value)
        ? (value as JsonRecord)[segment]
        : undefined);
      continue;
    }
    if ("context" in segment) {
      values = values.flatMap((value) => {
        if (!isRecord(value)) return [];
        return Object.entries(value).map(([actorId, actorValue]) => {
          requireMechanicsIdentifier(actorId, "Stored actor id");
          return actorValue;
        });
      });
      continue;
    }
    // Binding-derived locations exist only while one StateRef is evaluated.
    // The snapshot-wide validation pass has no canonical binding assignment;
    // the concrete location was already type-checked at its mutation boundary.
    return [];
  }
  return values;
}

/**
 * Validate every stateModel symbol that can be resolved in one snapshot.
 *
 * This is the shared last gate for a Mechanics candidate and for trusted
 * editor-preview restore. It deliberately derives all shape and value rules
 * from the published stateModel: no parallel imperative game schema exists.
 */
export function assertStateMatchesModel(context: StateAccessContext): void {
  const traversal = stateModelTraversalMetadata(context.stateModel);
  for (const [endpointId, endpoint] of traversal.endpoints) {
    const values = availableStorageValues(context.state, endpoint.storage as RuntimeStorageLocation, context);
    for (const value of values) {
      // Projection-only endpoints may describe runtime-created convenience
      // branches. When absent, they have no executable value to validate.
      if (value === undefined && endpoint.usage === "projection-only") continue;
      assertValueMatchesType(context, endpoint.valueType, value, `endpoint "${endpointId}"`);
    }
  }

  for (const [collectionId, collection] of traversal.collections) {
    const values = availableStorageValues(context.state, collection.storage as RuntimeStorageLocation, context);
    for (const value of values) {
      // A missing collection is the canonical empty representation accepted by
      // authoring validation. Once present, shape, capacity, ids, object types,
      // closed facets/attributes and all declared field types are mandatory.
      if (value === undefined) continue;
      validateCollectionValue(context, collection, value, collectionId);
    }
  }
}

/**
 * Validate one authoritative snapshot and mint a non-transferable local proof.
 *
 * The complete model walk always happens before the proof exists. Individual
 * endpoint and collection reads are still validated on their first use after
 * this boundary; subsequent predicates may reuse only that same-value result.
 * This preserves fail-closed behavior if an unusual direct caller exposes a
 * changing property between the initial walk and its first actual read.
 */
export function validateReadOnlyStateAccess(
  context: StateAccessContext
): VerifiedReadOnlyStateAccess {
  assertStateMatchesModel(context);
  const proof = Object.freeze({
    [verifiedReadOnlyStateAccessBrand]: true as const
  });
  verifiedReadOnlyStateAccessData.set(proof, {
    stateModel: context.stateModel,
    state: context.state,
    preActionState: context.preActionState,
    limits: context.limits,
    endpointReads: new Map(),
    collectionReads: new Map()
  });
  return proof;
}

/**
 * Resolve proof data only when every identity that affects validation matches.
 *
 * A mismatch merely disables the optimization and falls back to the ordinary
 * validation path. It never turns an invalid proof into authority.
 */
function readOnlyStateAccessData(
  context: StateAccessContext
): VerifiedReadOnlyStateAccessData | undefined {
  const proof = context.verifiedReadOnlyStateAccess;
  if (!proof) return undefined;
  const data = verifiedReadOnlyStateAccessData.get(proof);
  return data &&
    data.stateModel === context.stateModel &&
    data.state === context.state &&
    data.preActionState === context.preActionState &&
    data.limits === context.limits
    ? data
    : undefined;
}

/** Reuse only the canonical iteration order derived from a frozen state model. */
function stateModelTraversalMetadata(
  stateModel: StateAccessContext["stateModel"]
): StateModelTraversalMetadata {
  const cached = stateModelTraversalMetadataCache.get(stateModel);
  if (cached) return cached;

  const metadata: StateModelTraversalMetadata = {
    endpoints: Object.freeze(
      Object.entries(stateModel.endpoints)
        .sort(([left], [right]) => compareCanonicalIds(left, right))
        .map(([id, endpoint]) => Object.freeze([id, endpoint] as const))
    ),
    collections: Object.freeze(
      Object.entries(stateModel.collections)
        .sort(([left], [right]) => compareCanonicalIds(left, right))
        .map(([id, collection]) => Object.freeze([id, collection] as const))
    )
  };
  // Deeply admitted bundles freeze both the model and its symbol maps. A
  // mutable direct caller receives the same result but never a reusable entry.
  if (
    Object.isFrozen(stateModel) &&
    Object.isFrozen(stateModel.endpoints) &&
    Object.isFrozen(stateModel.collections)
  ) {
    stateModelTraversalMetadataCache.set(stateModel, metadata);
  }
  return metadata;
}

function writeParts(root: JsonRecord, parts: Array<string>, value: unknown): void {
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current[part])) current[part] = {};
    current = current[part] as JsonRecord;
  }
  current[parts.at(-1) as string] = value;
}

function removeParts(root: JsonRecord, parts: Array<string>): void {
  let current: unknown = root;
  for (const part of parts.slice(0, -1)) {
    if (!isRecord(current)) return;
    current = current[part];
  }
  if (isRecord(current)) delete current[parts.at(-1) as string];
}

function resolveEndpointReference(
  context: StateAccessContext,
  reference: string | StateReference,
  resolvedBindings: ResolvedStateBindings
) {
  const endpointId = typeof reference === "string" ? reference : reference.endpoint;
  const endpoint = context.stateModel.endpoints[endpointId];
  if (!endpoint) throw new MechanicsExecutionError("MECHANICS_ENDPOINT_REF_UNKNOWN", `Unknown endpoint "${endpointId}"`);

  const required = new Set(
    (endpoint.storage.segments as Array<RuntimeStorageSegment>)
      .filter((segment): segment is { binding: string } => typeof segment !== "string" && "binding" in segment)
      .map((segment) => segment.binding)
  );
  const authored = new Set(typeof reference === "string" ? [] : Object.keys(reference.bindings ?? {}));
  const resolved = new Set(Object.keys(resolvedBindings));
  for (const name of required) {
    if (!authored.has(name) || !resolved.has(name)) {
      throw new MechanicsExecutionError(
        "MECHANICS_STATE_BINDING_MISSING",
        `Endpoint "${endpointId}" requires storage binding "${name}"`
      );
    }
  }
  for (const name of new Set([...authored, ...resolved])) {
    if (!required.has(name)) {
      throw new MechanicsExecutionError(
        "MECHANICS_STATE_BINDING_UNUSED",
        `Endpoint "${endpointId}" does not declare storage binding "${name}"`
      );
    }
  }
  for (const [name, value] of Object.entries(resolvedBindings)) {
    requireMechanicsIdentifier(value, `State binding "${name}"`);
  }
  return { endpointId, endpoint, bindings: resolvedBindings };
}

export function readEndpoint(
  context: StateAccessContext,
  reference: string | StateReference,
  source: "current" | "preAction" = "current",
  resolvedBindings: ResolvedStateBindings = {}
): unknown {
  const { endpointId, endpoint, bindings } = resolveEndpointReference(context, reference, resolvedBindings);
  if (endpoint.usage === "projection-only") {
    throw new MechanicsExecutionError(
      "MECHANICS_PROJECTION_ENDPOINT_NOT_EXECUTABLE",
      `Endpoint "${endpointId}" is available only to the player-facing projection`
    );
  }
  const state = source === "preAction" ? context.preActionState : context.state;
  const value = readParts(state, locationParts(endpoint.storage as RuntimeStorageLocation, context, bindings));
  const readOnlyData = readOnlyStateAccessData(context);
  const canReuseValidation = readOnlyData !== undefined &&
    !storageNeedsBinding(endpoint.storage.segments as Array<RuntimeStorageSegment>);
  if (canReuseValidation) {
    const cacheKey = JSON.stringify([
      source,
      endpointId,
      context.actor.actorPlayerId ?? null
    ]);
    const cached = readOnlyData.endpointReads.get(cacheKey);
    // Primitive changes and replacement objects are observed and revalidated.
    // In-place state mutation cannot occur in the assertion-only executor that
    // owns this proof; normal transactional contexts never receive one.
    if (cached && Object.is(cached.value, value)) return value;
    assertValueMatchesType(context, endpoint.valueType, value, `endpoint "${endpointId}"`);
    readOnlyData.endpointReads.set(cacheKey, { value });
    return value;
  }
  assertValueMatchesType(context, endpoint.valueType, value, `endpoint "${endpointId}"`);
  return value;
}

export function writeEndpoint(
  context: StateAccessContext,
  reference: string | StateReference,
  value: unknown,
  resolvedBindings: ResolvedStateBindings = {}
): void {
  const { endpointId, endpoint, bindings } = resolveEndpointReference(context, reference, resolvedBindings);
  if (endpoint.usage === "projection-only" || endpoint.access !== "read-write") {
    throw new MechanicsExecutionError("MECHANICS_ENDPOINT_NOT_WRITABLE", `Endpoint "${endpointId}" is not writable`);
  }
  assertValueMatchesType(context, endpoint.valueType, value, `endpoint "${endpointId}"`);
  if (value === undefined && context.stateModel.types[endpoint.valueType]?.kind === "option") {
    removeParts(context.state, locationParts(endpoint.storage as RuntimeStorageLocation, context, bindings));
    return;
  }
  writeParts(
    context.state,
    locationParts(endpoint.storage as RuntimeStorageLocation, context, bindings),
    structuredClone(value)
  );
}

export function removeEndpoint(
  context: StateAccessContext,
  reference: string | StateReference,
  resolvedBindings: ResolvedStateBindings = {}
): void {
  const { endpointId, endpoint, bindings } = resolveEndpointReference(context, reference, resolvedBindings);
  if (endpoint.usage === "projection-only" || endpoint.access !== "read-write") {
    throw new MechanicsExecutionError("MECHANICS_ENDPOINT_NOT_WRITABLE", `Endpoint "${endpointId}" is not writable`);
  }
  if (context.stateModel.types[endpoint.valueType]?.kind !== "option") {
    throw new MechanicsExecutionError(
      "MECHANICS_ENDPOINT_NOT_OPTIONAL",
      `Endpoint "${endpointId}" cannot be removed because its type is not optional`
    );
  }
  removeParts(context.state, locationParts(endpoint.storage as RuntimeStorageLocation, context, bindings));
}

export function collectionEntries(
  context: StateAccessContext,
  collectionId: string
): ValidatedCollectionAccess {
  const model = context.stateModel.collections[collectionId];
  if (!model) throw new MechanicsExecutionError("MECHANICS_COLLECTION_REF_UNKNOWN", `Unknown collection "${collectionId}"`);
  const raw = readParts(context.state, locationParts(model.storage as RuntimeStorageLocation, context));
  const readOnlyData = readOnlyStateAccessData(context);
  const canReuseValidation = readOnlyData !== undefined &&
    !storageNeedsBinding(model.storage.segments as Array<RuntimeStorageSegment>);
  if (canReuseValidation) {
    const cacheKey = JSON.stringify([
      collectionId,
      context.actor.actorPlayerId ?? null
    ]);
    const cached = readOnlyData.collectionReads.get(cacheKey);
    // The same parsed entries are safe only for the same collection object.
    // A replacement object is validated normally before becoming the new
    // request-local cache value.
    if (cached && cached.raw === raw) return cached.result;
    const result = validateCollectionValue(context, model, raw, collectionId);
    readOnlyData.collectionReads.set(cacheKey, { raw: result.raw, result });
    return result;
  }
  return validateCollectionValue(context, model, raw, collectionId);
}

function validateCollectionValue(
  context: StateAccessContext,
  model: CollectionModel,
  raw: unknown,
  collectionId: string
): ValidatedCollectionAccess {
  if (model.stableKey === "map-key") {
    if (!isRecord(raw)) throw new MechanicsExecutionError("MECHANICS_STATE_SHAPE_INVALID", `Collection "${collectionId}" must be an object map`);
    const entries = Object.entries(raw).map(([id, item]) => {
      requireMechanicsIdentifier(id, `Collection "${collectionId}" entity id`);
      if (!isRecord(item)) {
        throw new MechanicsExecutionError("MECHANICS_STATE_SHAPE_INVALID", `Collection "${collectionId}" contains a non-object entity`);
      }
      validateCollectionEntity(context, model, item, collectionId, id);
      return [id, item] as [string, JsonRecord];
    });
    if (entries.length > model.capacity) {
      throw new MechanicsExecutionError("MECHANICS_COLLECTION_CAPACITY", `Collection "${collectionId}" exceeds its declared capacity`);
    }
    return {
      model,
      raw,
      entries
    };
  }
  if (!Array.isArray(raw)) throw new MechanicsExecutionError("MECHANICS_STATE_SHAPE_INVALID", `Collection "${collectionId}" must be an array`);
  const entries = raw.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string") {
      throw new MechanicsExecutionError("MECHANICS_STATE_SHAPE_INVALID", `Collection "${collectionId}" contains an item without a stable id`);
    }
    requireMechanicsIdentifier(item.id, `Collection "${collectionId}" entity id`);
    validateCollectionEntity(context, model, item, collectionId, item.id);
    return [item.id, item] as [string, JsonRecord];
  });
  if (entries.length > model.capacity) {
    throw new MechanicsExecutionError("MECHANICS_COLLECTION_CAPACITY", `Collection "${collectionId}" exceeds its declared capacity`);
  }
  if (new Set(entries.map(([id]) => id)).size !== entries.length) {
    throw new MechanicsExecutionError(
      "MECHANICS_IDENTIFIER_DUPLICATE",
      `Collection "${collectionId}" contains duplicate stable ids`
    );
  }
  return { model, raw, entries };
}

function validateCollectionEntity(
  context: StateAccessContext,
  model: CollectionModel,
  entity: JsonRecord,
  collectionId: string,
  entityId: string
): void {
  if (model.itemShape === "record") {
    validateRecordCollectionItem(context, model, entity, collectionId, entityId);
    return;
  }
  if (typeof entity.objectType !== "string" || !model.itemTypes.includes(entity.objectType)) {
    throw new MechanicsExecutionError(
      "MECHANICS_ENTITY_TYPE_MISMATCH",
      `Entity "${entityId}" in collection "${collectionId}" has an undeclared object type`
    );
  }
  assertCollectionAreaFieldsDeclared(model, entity, "facet", collectionId, entityId);
  assertCollectionAreaFieldsDeclared(model, entity, "attribute", collectionId, entityId);
  for (const [fieldId, field] of collectionFieldMetadata(model).stored) {
    const area = field.storage.kind === "facet" ? entity.facets : entity.attributes;
    if (!isRecord(area) || area[field.storage.name] === undefined) continue;
    assertValueMatchesType(context, field.valueType, area[field.storage.name], `entity "${entityId}" field "${fieldId}"`);
  }
  validateDerivedCollectionFields(context, model, entity, collectionId, entityId);
}

interface RecordPathNode {
  fieldId?: string;
  children: Map<string, RecordPathNode>;
}

/** Validate a closed record item against the paths declared by its collection. */
function validateRecordCollectionItem(
  context: StateAccessContext,
  model: RecordCollectionModel,
  item: JsonRecord,
  collectionId: string,
  entityId: string
): void {
  const root = recordPathMetadata(model);
  validateRecordPathNode(context, model, item, root, `collection "${collectionId}" item "${entityId}"`, true);
  validateDerivedCollectionFields(context, model, item, collectionId, entityId);
}

/** Build the declared closed-record path tree once for an admitted model. */
function recordPathMetadata(model: RecordCollectionModel): RecordPathNode {
  const cached = recordPathMetadataCache.get(model);
  if (cached) return cached;

  const root: RecordPathNode = { children: new Map() };
  for (const [fieldId, field] of collectionFieldMetadata(model).stored) {
    let node = root;
    for (const segment of field.storage.path) {
      const next = node.children.get(segment) ?? { children: new Map<string, RecordPathNode>() };
      node.children.set(segment, next);
      node = next;
    }
    node.fieldId = fieldId;
  }
  if (isFrozenRecordCollectionMetadata(model)) {
    recordPathMetadataCache.set(model, root);
  }
  return root;
}

/** Require every model fragment read by the cached path tree to be immutable. */
function isFrozenRecordCollectionMetadata(model: RecordCollectionModel): boolean {
  return Object.isFrozen(model) &&
    Object.isFrozen(model.fields) &&
    collectionFieldMetadataCache.has(model) &&
    collectionFieldMetadata(model).stored.every(([, field]) =>
      Object.isFrozen(field.storage) && Object.isFrozen(field.storage.path));
}

/** Validate every declared projection at both input and candidate boundaries. */
function validateDerivedCollectionFields(
  context: StateAccessContext,
  model: CollectionModel,
  item: JsonRecord,
  collectionId: string,
  entityId: string
): void {
  for (const [fieldId, field] of collectionFieldMetadata(model).derived) {
    assertValueMatchesType(
      context,
      field.valueType,
      readCollectionField(model, item, fieldId),
      `entity "${entityId}" in collection "${collectionId}" derived field "${fieldId}"`
    );
  }
}

function validateRecordPathNode(
  context: StateAccessContext,
  model: RecordCollectionModel,
  value: unknown,
  node: RecordPathNode,
  label: string,
  root: boolean
): void {
  if (node.fieldId !== undefined) {
    assertValueMatchesType(context, model.fields[node.fieldId].valueType, value, `${label} field "${node.fieldId}"`);
    // A leaf type owns its complete value. Paths below that leaf would create
    // two competing schemas and are rejected by publication.
    if (node.children.size === 0) return;
  }
  if (!isPlainRecord(value)) {
    throw new MechanicsExecutionError("MECHANICS_STATE_SHAPE_INVALID", `${label} must be a closed record`);
  }
  for (const [key, childValue] of Object.entries(value)) {
    const child = node.children.get(key);
    if (!child) {
      if (root && model.stableKey === "id-field" && key === "id") continue;
      throw new MechanicsExecutionError(
        "MECHANICS_ENTITY_FIELD_UNDECLARED",
        `${label} contains undeclared record field "${key}"`
      );
    }
    validateRecordPathNode(context, model, childValue, child, `${label}.${key}`, false);
  }
}

/** Collection facets/attributes are closed records declared by stateModel. */
function assertCollectionAreaFieldsDeclared(
  model: EntityCollectionModel,
  entity: JsonRecord,
  area: "facet" | "attribute",
  collectionId: string,
  entityId: string
): void {
  const areaValue = entity[area === "facet" ? "facets" : "attributes"];
  if (areaValue === undefined) return;
  if (!isPlainRecord(areaValue)) {
    throw new MechanicsExecutionError(
      "MECHANICS_STATE_SHAPE_INVALID",
      `Collection "${collectionId}" entity "${entityId}" has an invalid ${area} record`
    );
  }
  const declaredNames = entityAreaMetadata(model)[area];
  if (Object.keys(areaValue).some((name) => !declaredNames.has(name))) {
    throw new MechanicsExecutionError(
      "MECHANICS_ENTITY_FIELD_UNDECLARED",
      `Collection "${collectionId}" entity contains an undeclared ${area} field`
    );
  }
}

/** Reuse the two closed area name sets derived from one frozen entity model. */
function entityAreaMetadata(model: EntityCollectionModel): EntityAreaMetadata {
  const cached = entityAreaMetadataCache.get(model);
  if (cached) return cached;

  const facet = new Set<string>();
  const attribute = new Set<string>();
  for (const [, field] of collectionFieldMetadata(model).stored) {
    if (field.storage.kind === "facet") facet.add(field.storage.name);
    else if (field.storage.kind === "attribute") attribute.add(field.storage.name);
  }
  const metadata: EntityAreaMetadata = { facet, attribute };
  if (isFrozenEntityCollectionMetadata(model)) {
    entityAreaMetadataCache.set(model, metadata);
  }
  return metadata;
}

/** Require every model fragment read by cached facet/attribute sets to be immutable. */
function isFrozenEntityCollectionMetadata(model: EntityCollectionModel): boolean {
  return Object.isFrozen(model) &&
    Object.isFrozen(model.fields) &&
    collectionFieldMetadataCache.has(model) &&
    collectionFieldMetadata(model).stored.every(([, field]) => Object.isFrozen(field.storage));
}

export function findEntity(context: StateAccessContext, collectionId: string, entityId: string): JsonRecord {
  const match = collectionEntries(context, collectionId).entries.find(([id]) => id === entityId)?.[1];
  if (!match) throw new MechanicsExecutionError("MECHANICS_ENTITY_NOT_FOUND", `Entity "${entityId}" is unavailable`);
  return match;
}

/** Read one declared field without exposing its physical storage shape. */
export function readCollectionField(model: CollectionModel, item: JsonRecord, fieldId: string): unknown {
  const field = model.fields[fieldId];
  if (!field) throw new MechanicsExecutionError("MECHANICS_FIELD_REF_UNKNOWN", `Unknown field "${fieldId}"`);
  if (isDerivedCollectionField(field)) {
    const source = model.fields[field.source.field];
    if (!source || !isStoredCollectionField(source)) {
      throw new MechanicsExecutionError(
        "MECHANICS_DERIVED_FIELD_SOURCE_INVALID",
        `Derived field "${fieldId}" does not reference a directly stored field`
      );
    }
    return readNestedPath(readStoredCollectionField(model, item, source), field.source.path);
  }
  return readStoredCollectionField(model, item, field);
}

/** Read physical state only after semantic publication proved its field model. */
function readStoredCollectionField(
  model: CollectionModel,
  item: JsonRecord,
  field: Extract<LogicalCollectionField, { storage: unknown }>
): unknown {
  if (field.storage.kind === "path") {
    return readNestedPath(item, field.storage.path);
  }
  const areaKey = field.storage.kind === "facet" ? "facets" : "attributes";
  const areaValue = isRecord(item[areaKey]) ? item[areaKey] as JsonRecord : {};
  return areaValue[field.storage.name];
}

/** Extra bounded work performed by one logical field projection. */
export function derivedCollectionFieldReadWork(model: CollectionModel, fieldId: string): number {
  const field = model.fields[fieldId];
  return field && isDerivedCollectionField(field) ? field.source.path.length : 0;
}

/** Backward-compatible entity wrapper that still enforces the requested area. */
export function readEntityField(
  model: CollectionModel,
  entity: JsonRecord,
  area: "facet" | "attribute",
  fieldId: string
): unknown {
  if (model.itemShape === "record") return readCollectionField(model, entity, fieldId);
  const field = model.fields[fieldId];
  if (!field || !collectionFieldBelongsToArea(model, field, area)) {
    throw new MechanicsExecutionError("MECHANICS_FIELD_REF_UNKNOWN", `Field "${fieldId}" is unavailable as ${area}`);
  }
  return readCollectionField(model, entity, fieldId);
}

export function writeEntityField(
  context: StateAccessContext,
  model: CollectionModel,
  entity: JsonRecord,
  area: "facet" | "attribute",
  fieldId: string,
  value: unknown
): void {
  if (model.itemShape === "record") {
    writeCollectionField(context, model, entity, fieldId, value);
    return;
  }
  const field = model.fields[fieldId];
  if (!field || !isStoredCollectionField(field) || field.storage.kind !== area) {
    throw new MechanicsExecutionError("MECHANICS_FIELD_NOT_WRITABLE", `Field "${fieldId}" is not writable as ${area}`);
  }
  setCollectionField(context, model, entity, fieldId, value, false);
}

/** Mutate one declared collection field while preserving its access contract. */
export function writeCollectionField(
  context: StateAccessContext,
  model: CollectionModel,
  item: JsonRecord,
  fieldId: string,
  value: unknown
): void {
  setCollectionField(context, model, item, fieldId, value, false);
}

/**
 * Initialize a declared field on a detached entity before collection insert.
 *
 * Read-only means immutable after creation, not impossible to construct. This
 * narrow API therefore permits a declared read-only field only while the exact
 * entity object is not yet present in its stateModel collection. Ordinary
 * mutation continues through `writeEntityField` and remains access-checked.
 */
export function initializeEntityField(
  context: StateAccessContext,
  model: CollectionModel,
  entity: JsonRecord,
  area: "facet" | "attribute",
  fieldId: string,
  value: unknown
): void {
  if (model.itemShape !== "record") {
    const field = model.fields[fieldId];
    if (!field || !isStoredCollectionField(field) || field.storage.kind !== area) {
      throw new MechanicsExecutionError("MECHANICS_FIELD_REF_UNKNOWN", `Field "${fieldId}" is unavailable as ${area}`);
    }
  }
  initializeCollectionField(context, model, entity, fieldId, value);
}

/** Initialize a field—including read-only—on an item not yet inserted. */
export function initializeCollectionField(
  context: StateAccessContext,
  model: CollectionModel,
  item: JsonRecord,
  fieldId: string,
  value: unknown
): void {
  const collectionId = Object.entries(context.stateModel.collections)
    .find(([, candidate]) => candidate === model)?.[0];
  if (!collectionId) {
    throw new MechanicsExecutionError(
      "MECHANICS_COLLECTION_REF_UNKNOWN",
      "Entity initializer requires a declared collection model"
    );
  }
  if (collectionEntries(context, collectionId).entries.some(([, candidate]) => candidate === item)) {
    throw new MechanicsExecutionError(
      "MECHANICS_FIELD_NOT_INITIALIZABLE",
      `Field "${fieldId}" cannot be initialized after its entity is inserted`
    );
  }
  setCollectionField(context, model, item, fieldId, value, true);
}

function setCollectionField(
  context: StateAccessContext,
  model: CollectionModel,
  item: JsonRecord,
  fieldId: string,
  value: unknown,
  allowReadOnly: boolean
): void {
  if (model.itemShape === "record") {
    const field = model.fields[fieldId];
    if (!field || !isStoredCollectionField(field) || (!allowReadOnly && field.access !== "read-write")) {
      throw new MechanicsExecutionError("MECHANICS_FIELD_NOT_WRITABLE", `Field "${fieldId}" is not writable`);
    }
    assertValueMatchesType(context, field.valueType, value, `field "${fieldId}"`);
    const remove = value === undefined && context.stateModel.types[field.valueType]?.kind === "option";
    writeNestedPath(item, field.storage.path, value, remove);
    return;
  }
  const field = model.fields[fieldId];
  if (!field || !isStoredCollectionField(field) || (!allowReadOnly && field.access !== "read-write")) {
    throw new MechanicsExecutionError("MECHANICS_FIELD_NOT_WRITABLE", `Field "${fieldId}" is not writable`);
  }
  assertValueMatchesType(context, field.valueType, value, `field "${fieldId}"`);
  const remove = value === undefined && context.stateModel.types[field.valueType]?.kind === "option";
  const key = field.storage.kind === "facet" ? "facets" : "attributes";
  const target = isRecord(item[key]) ? item[key] as JsonRecord : {};
  if (remove) delete target[field.storage.name];
  else target[field.storage.name] = structuredClone(value);
  item[key] = target;
}

function readNestedPath(root: unknown, path: ReadonlyArray<string>): unknown {
  let value: unknown = root;
  for (const segment of path) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function isStoredCollectionField(
  field: LogicalCollectionField
): field is Extract<LogicalCollectionField, { storage: unknown }> {
  return "storage" in field;
}

function isDerivedCollectionField(
  field: LogicalCollectionField
): field is Extract<LogicalCollectionField, { source: unknown }> {
  return "source" in field;
}

/**
 * Split immutable field declarations once while retaining every per-value
 * validation. This avoids rebuilding `Object.entries` arrays for each entity.
 */
function collectionFieldMetadata<TModel extends CollectionModel>(
  model: TModel
): CollectionFieldMetadata<TModel> {
  const cached = collectionFieldMetadataCache.get(model) as
    CollectionFieldMetadata<TModel> | undefined;
  if (cached) return cached;

  const stored: Array<readonly [string, StoredLogicalCollectionField]> = [];
  const derived: Array<readonly [string, DerivedLogicalCollectionField]> = [];
  for (const [fieldId, field] of Object.entries(model.fields)) {
    if (isStoredCollectionField(field)) stored.push(Object.freeze([fieldId, field] as const));
    else if (isDerivedCollectionField(field)) derived.push(Object.freeze([fieldId, field] as const));
  }
  const metadata = {
    stored: Object.freeze(stored),
    derived: Object.freeze(derived)
  } as CollectionFieldMetadata<TModel>;
  if (
    Object.isFrozen(model) &&
    Object.isFrozen(model.fields) &&
    Object.values(model.fields).every((field) => Object.isFrozen(field))
  ) {
    collectionFieldMetadataCache.set(model, metadata as CollectionFieldMetadata);
  }
  return metadata;
}

/** Entity projections inherit the facet/attribute area of their stored source. */
function collectionFieldBelongsToArea(
  model: EntityCollectionModel,
  field: LogicalCollectionField,
  area: "facet" | "attribute"
): boolean {
  if (isStoredCollectionField(field)) return field.storage.kind === area;
  const source = model.fields[field.source.field];
  return Boolean(source && isStoredCollectionField(source) && source.storage.kind === area);
}

function writeNestedPath(
  root: JsonRecord,
  path: ReadonlyArray<string>,
  value: unknown,
  remove: boolean
): void {
  let target = root;
  for (const segment of path.slice(0, -1)) {
    if (!isPlainRecord(target[segment])) target[segment] = {};
    target = target[segment] as JsonRecord;
  }
  const leaf = path.at(-1) as string;
  if (remove) delete target[leaf];
  else target[leaf] = structuredClone(value);
}

/**
 * Enforce stateModel value types at the mutation boundary.
 *
 * Publication catches symbol and obvious expression errors, while values from
 * action parameters only exist at runtime. This second check prevents a valid
 * plan from corrupting state with an out-of-range or structurally incompatible
 * parameter. Record values are closed: accepting an undeclared field would
 * bypass both type guarantees and the state model's resource bounds.
 */
export function assertValueMatchesType(
  context: StateAccessContext,
  typeRef: string,
  value: unknown,
  label = "value"
): void {
  validateTypedValue(context, typeRef, value, label, 0);
}

function validateTypedValue(
  context: StateAccessContext,
  typeRef: string,
  value: unknown,
  label: string,
  depth: number
): void {
  if (depth > 64) typeFailure(label, typeRef, "exceeds the maximum nested type depth");
  const type = context.stateModel.types[typeRef];
  if (!type) typeFailure(label, typeRef, "references an unknown type");

  switch (type.kind) {
    case "boolean":
      if (typeof value !== "boolean") typeFailure(label, typeRef, "must be boolean");
      return;
    case "string":
      if (typeof value !== "string") typeFailure(label, typeRef, "must be string");
      if (
        Buffer.byteLength(value, "utf8") >
        Math.min(type.maxUtf8Bytes ?? context.limits.maxStringUtf8Bytes, context.limits.maxStringUtf8Bytes)
      ) {
        typeFailure(label, typeRef, "exceeds the UTF-8 string byte limit");
      }
      return;
    case "integer":
      if (!Number.isSafeInteger(value) || (value as number) < type.minimum || (value as number) > type.maximum) {
        typeFailure(label, typeRef, `must be a safe integer in [${type.minimum}, ${type.maximum}]`);
      }
      return;
    case "finite-number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < type.minimum ||
        value > type.maximum
      ) {
        typeFailure(label, typeRef, `must be a finite number in [${type.minimum}, ${type.maximum}]`);
      }
      return;
    case "decimal": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < Number(type.minimum) || value > Number(type.maximum)) {
        typeFailure(label, typeRef, `must be a finite decimal in [${type.minimum}, ${type.maximum}]`);
      }
      const scaled = (value as number) * 10 ** type.scale;
      const rounded = Math.round(scaled);
      if (Number((value as number).toFixed(type.scale)) !== value || !Number.isSafeInteger(rounded)) {
        typeFailure(label, typeRef, `must have at most ${type.scale} fractional digits within the safe scaled range`);
      }
      return;
    }
    case "enum":
      if (!type.values.some((candidate) => Object.is(candidate, value))) {
        typeFailure(label, typeRef, "must be one of the declared enum values");
      }
      if (typeof value === "string" && Buffer.byteLength(value, "utf8") > context.limits.maxStringUtf8Bytes) {
        typeFailure(label, typeRef, "exceeds the UTF-8 string byte limit");
      }
      return;
    case "json":
      measureBoundedJson(value, {
        maxBytes: Math.min(type.maxUtf8Bytes, context.limits.maxIntermediateValueBytes),
        maxDepth: Math.min(type.maxDepth, context.limits.maxJsonDepth),
        maxNodes: Math.min(type.maxNodes, context.limits.maxJsonNodes),
        maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes
      }, "MECHANICS_VALUE_RESOURCE_LIMIT", context.jsonPrimitiveMeasurements);
      return;
    case "option":
      if (value === null || value === undefined) return;
      validateTypedValue(context, type.itemType, value, label, depth + 1);
      return;
    case "list":
    case "set": {
      if (!Array.isArray(value) || value.length > type.maxItems) {
        typeFailure(label, typeRef, `must be an array with at most ${type.maxItems} items`);
      }
      for (const [index, item] of value.entries()) {
        validateTypedValue(context, type.itemType, item, `${label}[${index}]`, depth + 1);
      }
      if (type.kind === "set") {
        const identities = value.map((item, index) => canonicalJsonIdentity(item, `${label}[${index}]`, depth + 1));
        if (new Set(identities).size !== identities.length) typeFailure(label, typeRef, "must contain unique items");
      }
      return;
    }
    case "map": {
      if (!isPlainRecord(value) || Object.keys(value).length > type.maxProperties) {
        typeFailure(label, typeRef, `must be a map with at most ${type.maxProperties} properties`);
      }
      for (const [key, item] of Object.entries(value)) {
        if (forbiddenSegments.has(key)) typeFailure(label, typeRef, `contains forbidden key "${key}"`);
        if (Buffer.byteLength(key, "utf8") > context.limits.maxStringUtf8Bytes) {
          typeFailure(label, typeRef, "contains an oversized map key");
        }
        validateTypedValue(context, type.valueType, item, `${label}.${key}`, depth + 1);
      }
      return;
    }
    case "record": {
      if (!isPlainRecord(value)) typeFailure(label, typeRef, "must be a record");
      for (const key of Object.keys(value)) {
        if (forbiddenSegments.has(key)) typeFailure(label, typeRef, `contains forbidden key "${key}"`);
        if (type.fields[key] === undefined) typeFailure(label, typeRef, "contains an undeclared field");
      }
      for (const [fieldId, field] of Object.entries(type.fields)) {
        if (value[fieldId] === undefined) {
          if (!field.optional) typeFailure(label, typeRef, `requires field "${fieldId}"`);
          continue;
        }
        validateTypedValue(context, field.typeRef, value[fieldId], `${label}.${fieldId}`, depth + 1);
      }
      return;
    }
  }
}

function canonicalJsonIdentity(value: unknown, label: string, depth: number): string {
  if (depth > 64) throw new MechanicsExecutionError("MECHANICS_VALUE_DEPTH", `${label} exceeds the maximum JSON depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MechanicsExecutionError("MECHANICS_VALUE_TYPE_MISMATCH", `${label} is not finite JSON`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalJsonIdentity(item, `${label}[${index}]`, depth + 1)).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    const entries = Object.keys(value).sort(compareCanonicalIds).map((key) => {
      if (forbiddenSegments.has(key)) {
        throw new MechanicsExecutionError("MECHANICS_VALUE_TYPE_MISMATCH", `${label} contains forbidden key "${key}"`);
      }
      return `${JSON.stringify(key)}:${canonicalJsonIdentity(value[key], `${label}.${key}`, depth + 1)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new MechanicsExecutionError("MECHANICS_VALUE_TYPE_MISMATCH", `${label} is not a JSON value`);
}

/**
 * Stable identity for one already bounded Mechanics value.
 *
 * Set predicates reuse the same canonical equality semantics as persisted
 * typed sets, preventing runtime comparison and state validation from drifting.
 */
export function canonicalMechanicsValueIdentity(value: unknown, label = "Mechanics value"): string {
  return canonicalJsonIdentity(value, label, 0);
}

function isPlainRecord(value: unknown): value is JsonRecord {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function typeFailure(label: string, typeRef: string, detail: string): never {
  throw new MechanicsExecutionError(
    "MECHANICS_VALUE_TYPE_MISMATCH",
    `${label} (${typeRef}) ${detail}`
  );
}
