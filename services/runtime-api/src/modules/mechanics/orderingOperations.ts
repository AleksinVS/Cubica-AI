/**
 * Universal bounded lexicographic ordering for typed entity selections.
 *
 * The module knows only collections, logical field identifiers, equality
 * joins and named random streams. Game concepts such as turns, vehicles or
 * ownership remain authored data and never enter this implementation.
 */
import { charge } from "./budget.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";
import { requireSelection } from "./coreOperations.ts";
import { MechanicsExecutionError } from "./errors.ts";
import {
  collectionEntries,
  derivedCollectionFieldReadWork,
  isRecord,
  readCollectionField,
  requireMechanicsIdentifier
} from "./stateModel.ts";
import {
  readSessionRandomStream,
  shuffleSessionValues,
  writeSessionRandomStream,
  type SessionRandomStreamsState
} from "../runtime/sessionRandom.ts";
import type {
  CollectionModel,
  EntitySelection,
  JsonRecord,
  MechanicsExecutionContext,
  Step
} from "./types.ts";

type OrderStep = Extract<Step, { op: "core.entities.order" }>;
type OrderKey = OrderStep["keys"][number];
type OrderSource = OrderKey["source"];

interface NumericValue {
  kind: "number";
  /** Fixed-point uses a safe scaled integer; binary64 keeps the exact finite value. */
  value: number;
  representation: "fixed" | "binary64";
  scale: number;
}

interface StringValue {
  kind: "string";
  value: string;
}

interface MissingValue {
  kind: "missing";
}

type OrderedValue = NumericValue | StringValue | MissingValue;

interface PreparedEntity {
  id: string;
  values: Array<OrderedValue>;
}

interface ComparableField {
  kind: "integer" | "decimal" | "finite-number" | "string";
  scale: number;
}

interface CachedCollection {
  model: CollectionModel;
  entries: Array<[string, JsonRecord]>;
  byId: Map<string, JsonRecord>;
}

interface OrderingCaches {
  collections: Map<string, CachedCollection>;
  aggregateGroups: Map<string, Map<string, Array<JsonRecord>>>;
}

/** Execute the one operation owned by the neutral ordering module. */
export function executeOrderingOperation(step: OrderStep, context: MechanicsExecutionContext): unknown {
  let selection: EntitySelection;
  try {
    selection = requireSelection(context.results.get(step.selection.stepId), step.id);
  } catch (error) {
    if (error instanceof MechanicsExecutionError) {
      throw new MechanicsExecutionError(
        "MECHANICS_ORDER_SELECTION_INVALID",
        "Ordering requires a valid unique entity selection",
        step.id
      );
    }
    throw error;
  }
  const selectedCollection = collectionEntries(context, selection.collectionId);
  charge(context, "scannedEntities", selectedCollection.entries.length);
  if (selectedCollection.model.itemShape === "record") {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_SELECTION_INVALID",
      "Entity ordering requires a selection from an entity collection",
      step.id
    );
  }

  const selectedById = new Map(selectedCollection.entries);
  const selected = selection.ids.map((id) => {
    const entity = selectedById.get(id);
    if (!entity) {
      throw new MechanicsExecutionError(
        "MECHANICS_ORDER_SELECTION_INVALID",
        `Selected entity "${id}" is unavailable`,
        step.id
      );
    }
    return [id, entity] as const;
  });

  // Charge a deterministic upper bound before building indexes or sorting.
  // This does not depend on JavaScript's implementation-specific comparator
  // call count and therefore remains stable under replay.
  charge(context, "algorithmWork", orderingWorkUpperBound(
    selection.ids.length,
    step.keys.length,
    step.keys.reduce((sum, key) => {
      if (key.source.kind === "current-field") return sum;
      const related = context.stateModel.collections[key.source.collection];
      const capacity = related?.capacity ?? 0;
      return sum + (key.source.kind === "related-aggregate" ? capacity * 2 : capacity);
    }, 0)
  ) + orderingDerivedReadWorkUpperBound(
    step,
    selection.ids.length,
    context
  ));

  const caches: OrderingCaches = {
    collections: new Map(),
    aggregateGroups: new Map()
  };
  const prepared = selected.map(([id, entity]): PreparedEntity => ({
    id,
    values: step.keys.map((key) =>
      prepareKeyValue(step, key, id, entity, selectedCollection.model, context, caches))
  }));

  // Canonical ID is deliberately the initial complete-tie order. Seeded
  // randomness is applied later to whole equal groups, never in a comparator.
  prepared.sort((left, right) =>
    comparePreparedEntities(left, right, step.keys) || compareCanonicalIds(left.id, right.id));

  const equalGroups = groupCompleteTies(prepared);
  const tieGroups = equalGroups
    .filter((group) => group.length >= 2)
    .map((group) => group.map((entry) => entry.id));

  let ids: Array<string>;
  if (step.tieBreak.kind === "canonical-id") {
    ids = prepared.map((entry) => entry.id);
  } else {
    ids = [];
    if (tieGroups.length === 0) {
      ids.push(...prepared.map((entry) => entry.id));
    } else {
      const streams = requireRandomStreams(context);
      let stream = readSessionRandomStream(streams, step.tieBreak.stream);
      for (const group of equalGroups) {
        const canonicalIds = group.map((entry) => entry.id);
        if (canonicalIds.length < 2) {
          ids.push(...canonicalIds);
          continue;
        }
        const shuffled = shuffleSessionValues(stream, canonicalIds);
        stream = shuffled.random;
        ids.push(...shuffled.values);
      }
      context.random = writeSessionRandomStream(streams, step.tieBreak.stream, stream);
      persistRandom(context);
    }
  }

  charge(context, "resultEntities", selection.ids.length + tieGroups.reduce(
    (sum, group) => sum + group.length,
    0
  ));
  return {
    kind: "entities",
    collectionId: selection.collectionId,
    ids,
    tieGroups
  };
}

function prepareKeyValue(
  step: OrderStep,
  key: OrderKey,
  currentId: string,
  currentEntity: JsonRecord,
  currentCollection: CollectionModel,
  context: MechanicsExecutionContext,
  caches: OrderingCaches
): OrderedValue {
  const source = key.source;
  let value: OrderedValue;
  if (source.kind === "current-field") {
    value = orderedFieldValue(
      readCollectionField(currentCollection, currentEntity, source.field),
      comparableField(context, currentCollection, source.field, step.id),
      step.id
    );
  } else if (source.kind === "related-field") {
    value = relatedFieldValue(step, source, currentEntity, currentCollection, context, caches);
  } else {
    value = relatedAggregateValue(
      step,
      source,
      currentId,
      currentEntity,
      currentCollection,
      context,
      caches
    );
  }
  if (value.kind === "missing" && key.missing === "error") {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_VALUE_MISSING",
      "An ordering key required a value that is absent",
      step.id
    );
  }
  return value;
}

function relatedFieldValue(
  step: OrderStep,
  source: Extract<OrderSource, { kind: "related-field" }>,
  currentEntity: JsonRecord,
  currentCollection: CollectionModel,
  context: MechanicsExecutionContext,
  caches: OrderingCaches
): OrderedValue {
  const reference = readCollectionField(currentCollection, currentEntity, source.referenceField);
  if (reference === null || reference === undefined) return { kind: "missing" };
  let relatedId: string;
  try {
    relatedId = requireMechanicsIdentifier(reference, "Related entity reference");
  } catch {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_REFERENCE_INVALID",
      "Related entity reference is not a stable identifier",
      step.id
    );
  }
  const related = cachedCollection(context, source.collection, caches);
  const entity = related.byId.get(relatedId);
  if (!entity) return { kind: "missing" };
  return orderedFieldValue(
    readCollectionField(related.model, entity, source.field),
    comparableField(context, related.model, source.field, step.id),
    step.id
  );
}

function relatedAggregateValue(
  step: OrderStep,
  source: Extract<OrderSource, { kind: "related-aggregate" }>,
  currentId: string,
  currentEntity: JsonRecord,
  currentCollection: CollectionModel,
  context: MechanicsExecutionContext,
  caches: OrderingCaches
): OrderedValue {
  const currentJoin = source.join.current.kind === "stable-id"
    ? currentId
    : readCollectionField(currentCollection, currentEntity, source.join.current.field);
  const related = cachedCollection(context, source.collection, caches);
  const groups = aggregateGroups(
    source.collection,
    source.join.relatedField,
    related,
    context,
    caches
  );
  const currentJoinKey = joinKey(currentJoin);
  const matches = currentJoinKey === undefined ? [] : groups.get(currentJoinKey) ?? [];
  if (source.aggregate === "count") {
    return { kind: "number", value: matches.length, representation: "fixed", scale: 0 };
  }

  const descriptor = comparableField(context, related.model, source.valueField, step.id, true);
  const values = matches.map((entity) =>
    orderedFieldValue(readCollectionField(related.model, entity, source.valueField), descriptor, step.id));
  if (values.some((value) => value.kind === "missing")) return { kind: "missing" };
  const numeric = values as Array<NumericValue>;
  if (source.aggregate === "sum") {
    if (descriptor.kind === "finite-number") {
      throw new MechanicsExecutionError(
        "MECHANICS_ORDER_FINITE_SUM_UNSUPPORTED",
        "Finite binary64 ordering values cannot be summed deterministically",
        step.id
      );
    }
    return {
      kind: "number",
      representation: "fixed",
      scale: descriptor.scale,
      value: numeric.reduce((sum, value) => safeScaledSum(sum, value.value, step.id), 0)
    };
  }
  if (numeric.length === 0) return { kind: "missing" };
  return numeric.reduce((selected, value) => {
    return source.aggregate === "min"
      ? value.value < selected.value ? value : selected
      : value.value > selected.value ? value : selected;
  });
}

function comparableField(
  context: MechanicsExecutionContext,
  collection: CollectionModel,
  fieldId: string,
  stepId: string,
  numericOnly = false
): ComparableField {
  const field = collection.fields[fieldId];
  if (!field) {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED",
      `Ordering field "${fieldId}" is not declared`,
      stepId
    );
  }
  let type = context.stateModel.types[field.valueType];
  if (type?.kind === "option") type = context.stateModel.types[type.itemType];
  if (type?.kind === "integer") return { kind: "integer", scale: 0 };
  if (type?.kind === "decimal") return { kind: "decimal", scale: type.scale };
  if (type?.kind === "finite-number") return { kind: "finite-number", scale: 0 };
  if (!numericOnly && type?.kind === "string") return { kind: "string", scale: 0 };
  throw new MechanicsExecutionError(
    "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED",
    `Ordering field "${fieldId}" must use an integer, decimal, finite-number, or string type`,
    stepId
  );
}

function orderedFieldValue(value: unknown, descriptor: ComparableField, stepId: string): OrderedValue {
  if (value === null || value === undefined) return { kind: "missing" };
  if (descriptor.kind === "string") {
    if (typeof value !== "string") {
      throw new MechanicsExecutionError(
        "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED",
        "Ordering field does not match its declared string type",
        stepId
      );
    }
    return { kind: "string", value };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED",
      "Ordering field does not match its declared numeric type",
      stepId
    );
  }
  if (descriptor.kind === "integer") {
    if (!Number.isSafeInteger(value)) {
      throw new MechanicsExecutionError("MECHANICS_ORDER_DECIMAL_OVERFLOW", "Integer key is unsafe", stepId);
    }
    return { kind: "number", value, representation: "fixed", scale: 0 };
  }
  if (descriptor.kind === "finite-number") {
    return {
      kind: "number",
      value: Object.is(value, -0) ? 0 : value,
      representation: "binary64",
      scale: 0
    };
  }
  const factor = 10 ** descriptor.scale;
  const scaled = Math.round(value * factor);
  if (!Number.isSafeInteger(scaled) || Number(value.toFixed(descriptor.scale)) !== value) {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_DECIMAL_OVERFLOW",
      "Decimal key cannot be represented as a safe fixed-point integer",
      stepId
    );
  }
  return { kind: "number", value: scaled, representation: "fixed", scale: descriptor.scale };
}

function comparePreparedEntities(left: PreparedEntity, right: PreparedEntity, keys: OrderStep["keys"]): number {
  for (let index = 0; index < keys.length; index += 1) {
    const comparison = compareOrderedValues(left.values[index], right.values[index], keys[index]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareOrderedValues(left: OrderedValue, right: OrderedValue, key: OrderKey): number {
  if (left.kind === "missing" || right.kind === "missing") {
    if (left.kind === right.kind) return 0;
    const missingFirst = key.missing === "first";
    return left.kind === "missing"
      ? missingFirst ? -1 : 1
      : missingFirst ? 1 : -1;
  }
  let comparison: number;
  if (left.kind === "string" && right.kind === "string") {
    comparison = compareCanonicalIds(left.value, right.value);
  } else if (
    left.kind === "number" &&
    right.kind === "number" &&
    left.representation === right.representation &&
    left.scale === right.scale
  ) {
    comparison = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  } else {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_FIELD_TYPE_UNSUPPORTED",
      "Ordering key produced incompatible values"
    );
  }
  return key.direction === "ascending" ? comparison : -comparison;
}

function groupCompleteTies(prepared: ReadonlyArray<PreparedEntity>): Array<Array<PreparedEntity>> {
  const groups: Array<Array<PreparedEntity>> = [];
  for (const entity of prepared) {
    const previous = groups.at(-1);
    if (previous && equalPreparedValues(previous[0].values, entity.values)) previous.push(entity);
    else groups.push([entity]);
  }
  return groups;
}

function equalPreparedValues(left: ReadonlyArray<OrderedValue>, right: ReadonlyArray<OrderedValue>): boolean {
  return left.length === right.length && left.every((value, index) => {
    const candidate = right[index];
    if (value.kind !== candidate.kind) return false;
    if (value.kind === "missing") return true;
    if (value.kind === "string" && candidate.kind === "string") return value.value === candidate.value;
    return value.kind === "number" && candidate.kind === "number" &&
      value.representation === candidate.representation &&
      value.scale === candidate.scale &&
      value.value === candidate.value;
  });
}

function safeScaledSum(left: number, right: number, stepId: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new MechanicsExecutionError(
      "MECHANICS_ORDER_DECIMAL_OVERFLOW",
      "Numeric aggregate exceeds the safe fixed-point range",
      stepId
    );
  }
  return result;
}

function orderingWorkUpperBound(selectionSize: number, keyCount: number, relatedCapacity: number): number {
  const sortDepth = selectionSize <= 1 ? 0 : Math.ceil(Math.log2(selectionSize));
  const work = selectionSize * keyCount +
    relatedCapacity +
    selectionSize * keyCount * sortDepth +
    selectionSize * keyCount +
    selectionSize;
  return Number.isSafeInteger(work) ? work : Number.MAX_SAFE_INTEGER;
}

/**
 * Conservatively account for every bounded nested projection an ordering key
 * may read. Related aggregate values can be revisited for each selected join
 * key, so the safe upper bound multiplies selected and related cardinalities.
 */
function orderingDerivedReadWorkUpperBound(
  step: OrderStep,
  selectionSize: number,
  context: MechanicsExecutionContext
): number {
  const selectedCollection = context.stateModel.collections[
    requireSelection(context.results.get(step.selection.stepId), step.id).collectionId
  ];
  let work = 0;
  for (const key of step.keys) {
    const source = key.source;
    if (source.kind === "current-field") {
      work += selectionSize * derivedCollectionFieldReadWork(selectedCollection, source.field);
      continue;
    }
    const related = context.stateModel.collections[source.collection];
    if (!related) continue;
    if (source.kind === "related-field") {
      work += selectionSize * (
        derivedCollectionFieldReadWork(selectedCollection, source.referenceField) +
        derivedCollectionFieldReadWork(related, source.field)
      );
      continue;
    }
    if (source.join.current.kind === "field") {
      work += selectionSize *
        derivedCollectionFieldReadWork(selectedCollection, source.join.current.field);
    }
    work += related.capacity *
      derivedCollectionFieldReadWork(related, source.join.relatedField);
    if (source.aggregate !== "count") {
      work += selectionSize * related.capacity *
        derivedCollectionFieldReadWork(related, source.valueField);
    }
  }
  return Number.isSafeInteger(work) ? work : Number.MAX_SAFE_INTEGER;
}

function cachedCollection(
  context: MechanicsExecutionContext,
  collectionId: string,
  caches: OrderingCaches
): CachedCollection {
  const cached = caches.collections.get(collectionId);
  if (cached) return cached;
  const collection = collectionEntries(context, collectionId);
  const created = {
    model: collection.model,
    entries: collection.entries,
    byId: new Map(collection.entries)
  };
  caches.collections.set(collectionId, created);
  charge(context, "scannedEntities", collection.entries.length);
  return created;
}

function aggregateGroups(
  collectionId: string,
  relatedField: string,
  related: CachedCollection,
  context: MechanicsExecutionContext,
  caches: OrderingCaches
): Map<string, Array<JsonRecord>> {
  const identity = `${collectionId}\u0000${relatedField}`;
  const cached = caches.aggregateGroups.get(identity);
  if (cached) return cached;
  const groups = new Map<string, Array<JsonRecord>>();
  for (const [, entity] of related.entries) {
    const key = joinKey(readCollectionField(related.model, entity, relatedField));
    if (key === undefined) continue;
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }
  charge(context, "scannedEntities", related.entries.length);
  caches.aggregateGroups.set(identity, groups);
  return groups;
}

/** Preserve primitive type identity so `"1"` never joins numeric `1`. */
function joinKey(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "boolean") return `boolean:${value ? "1" : "0"}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `number:${Object.is(value, -0) ? "0" : String(value)}`;
  }
  throw new MechanicsExecutionError(
    "MECHANICS_ORDER_REFERENCE_INVALID",
    "Ordering joins require a declared scalar value"
  );
}

function requireRandomStreams(context: MechanicsExecutionContext): SessionRandomStreamsState {
  if (context.random) return context.random;
  const secret = isRecord(context.state.secret) ? context.state.secret : undefined;
  if (!secret || !isRecord(secret.random)) {
    throw new MechanicsExecutionError("MECHANICS_RANDOM_STATE_MISSING", "Runtime random state is not initialized");
  }
  context.random = secret.random as unknown as SessionRandomStreamsState;
  return context.random;
}

function persistRandom(context: MechanicsExecutionContext): void {
  if (!context.random) return;
  if (!isRecord(context.state.secret)) context.state.secret = {};
  (context.state.secret as JsonRecord).random = context.random;
}
