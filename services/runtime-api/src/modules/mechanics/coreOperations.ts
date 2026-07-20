/** Exact implementations of state-model core and protected system operations. */
import { isDeepStrictEqual } from "node:util";
import { charge, chargeEventOutput } from "./budget.ts";
import { compareCanonicalIds } from "./canonicalOrder.ts";
import { MechanicsExecutionError } from "./errors.ts";
import {
  compare,
  evaluateExpression,
  evaluatePredicate,
  evaluateStateReferenceBindings
} from "./expressionEvaluator.ts";
import {
  collectionEntries,
  derivedCollectionFieldReadWork,
  findEntity,
  initializeEntityField,
  isRecord,
  canonicalMechanicsValueIdentity,
  readCollectionField,
  readEndpoint,
  readEntityField,
  removeEndpoint,
  assertValueMatchesType,
  requireMechanicsIdentifier,
  writeEndpoint,
  writeCollectionField,
  writeEntityField
} from "./stateModel.ts";
import type {
  CollectionModel,
  EntitySelection,
  JsonRecord,
  MechanicsExecutionContext,
  Step
} from "./types.ts";

export function executeCoreOperation(step: Step, context: MechanicsExecutionContext): unknown {
  switch (step.op) {
    case "core.assert":
      if (!evaluatePredicate(step.predicate, context)) {
        throw new MechanicsExecutionError(step.errorCode, "Mechanics assertion failed", step.id);
      }
      return true;
    case "core.entities.select":
      return selectEntities(step, context);
    case "core.entities.each": {
      if (context.currentItem !== undefined) {
        throw new MechanicsExecutionError(
          "MECHANICS_EACH_NESTED",
          "Nested bounded entity iteration is not executable",
          step.id
        );
      }
      const selection = requireSelection(context.results.get(step.selection.stepId), step.id);
      const model = context.stateModel.collections[selection.collectionId];
      if (!model) {
        throw new MechanicsExecutionError(
          "MECHANICS_COLLECTION_REF_UNKNOWN",
          `Unknown collection "${selection.collectionId}"`,
          step.id
        );
      }
      if (!context.executeBoundedBody) {
        throw new MechanicsExecutionError(
          "MECHANICS_EACH_EXECUTOR_UNAVAILABLE",
          "Bounded entity iteration requires the transactional step executor",
          step.id
        );
      }
      const ids = [...selection.ids].sort(compareCanonicalIds);
      charge(context, "algorithmWork", canonicalIterationWorkUpperBound(ids.length));
      for (const [iterationIndex, entityId] of ids.entries()) {
        const entity = findEntity(context, selection.collectionId, entityId);
        context.executeBoundedBody(
          step.body,
          { model, entity, id: entityId },
          // The canonical index is collision-free even when entity identifiers
          // themselves contain dots or other safe Mechanics punctuation. The
          // body result still records the affected entity where its operation
          // contract calls for that information.
          `${step.id}[${iterationIndex}]`
        );
      }
      return {
        kind: "entities-each",
        collectionId: selection.collectionId,
        count: ids.length
      };
    }
    case "core.collection.id.allocate":
      return allocateCollectionId(step, context);
    case "core.sequence.next":
      return selectNextSequenceValue(step, context);
    case "core.state.patch":
      for (const patch of step.patches) {
        if (patch.operation === "remove") removeStateReference(context, patch.target);
        else {
          const value = patch.value ? evaluateExpression(patch.value, context) : undefined;
          if (patch.operation === "set") writeStateReference(context, patch.target, value);
          else if (patch.operation === "increment") {
            const current = readStateReference(context, patch.target);
            writeStateReference(context, patch.target, finiteNumber(current) + finiteNumber(value));
          }
          else if (patch.operation === "append") {
            const current = readStateReference(context, patch.target);
            if (!Array.isArray(current)) throw new MechanicsExecutionError("MECHANICS_LIST_REQUIRED", "append target must be a list", step.id);
            writeStateReference(context, patch.target, [...current, structuredClone(value)]);
          }
        }
        charge(context, "writes");
      }
      return true;
    case "core.number.add": {
      const next = finiteNumber(readStateReference(context, step.target)) + finiteNumber(evaluateExpression(step.delta, context));
      if (!Number.isFinite(next)) throw new MechanicsExecutionError("MECHANICS_ARITHMETIC_INVALID", "Addition exceeds finite range", step.id);
      writeStateReference(context, step.target, next);
      charge(context, "writes");
      return next;
    }
    case "core.resource.transfer": {
      const amount = finiteNonnegative(evaluateExpression(step.amount, context));
      const from = step.from.kind === "bank" ? undefined : readResourceEndpoint(step.from, context);
      if (from !== undefined && from < amount) {
        throw new MechanicsExecutionError("MECHANICS_RESOURCE_INSUFFICIENT", "Resource source has insufficient value", step.id);
      }
      if (step.from.kind !== "bank") {
        writeResourceEndpoint(step.from, (from as number) - amount, context);
        charge(context, "writes");
      }
      if (step.to.kind !== "bank") {
        writeResourceEndpoint(step.to, readResourceEndpoint(step.to, context) + amount, context);
        charge(context, "writes");
      }
      return { amount };
    }
    case "core.entities.score":
      return scoreEntities(step, context);
    case "core.ranking.stable":
      return rankScores(step, context);
    case "core.collection.append": {
      const current = readStateReference(context, step.target);
      if (!Array.isArray(current)) throw new MechanicsExecutionError("MECHANICS_LIST_REQUIRED", "collection.append target must be a list", step.id);
      const value = evaluateExpression(step.value, context);
      writeStateReference(context, step.target, [...current, structuredClone(value)]);
      charge(context, "writes");
      return value;
    }
    case "core.entity.create": {
      const entityId = requireMechanicsIdentifier(evaluateExpression(step.entityId, context), "Entity id");
      const collection = collectionEntries(context, step.collection);
      if (collection.entries.some(([id]) => id === entityId)) {
        throw new MechanicsExecutionError("MECHANICS_ENTITY_ALREADY_EXISTS", `Entity "${entityId}" already exists`, step.id);
      }
      if (collection.entries.length >= collection.model.capacity) {
        throw new MechanicsExecutionError("MECHANICS_COLLECTION_CAPACITY", `Collection "${step.collection}" is full`, step.id);
      }
      const entity: JsonRecord = { objectType: step.objectType, facets: {}, attributes: {} };
      for (const [field, expression] of Object.entries(step.facets ?? {})) {
        initializeEntityField(context, collection.model, entity, "facet", field, evaluateExpression(expression, context));
      }
      for (const [field, expression] of Object.entries(step.attributes ?? {})) {
        initializeEntityField(context, collection.model, entity, "attribute", field, evaluateExpression(expression, context));
      }
      if (Array.isArray(collection.raw)) collection.raw.push({ id: entityId, ...entity });
      else collection.raw[entityId] = entity;
      charge(context, "writes");
      return { kind: "entity", collectionId: step.collection, id: entityId };
    }
    case "core.entity.facet.set": {
      const entityId = requireMechanicsIdentifier(evaluateExpression(step.entity.entityId, context), "Entity id");
      const entity = findEntity(context, step.entity.collection, entityId);
      const model = context.stateModel.collections[step.entity.collection];
      writeEntityField(context, model, entity, "facet", step.facet, evaluateExpression(step.value, context, { model, entity, id: entityId }));
      charge(context, "writes");
      return entityId;
    }
    case "core.entity.attributes.patch": {
      const entityId = requireMechanicsIdentifier(evaluateExpression(step.entity.entityId, context), "Entity id");
      const entity = findEntity(context, step.entity.collection, entityId);
      const model = context.stateModel.collections[step.entity.collection];
      for (const patch of step.patches) {
        if (patch.operation === "set-add") {
          const setType = requireDirectWritableSetType(
            context,
            model,
            patch.path,
            step.id
          );
          const current = readEntityField(model, entity, "attribute", patch.path[0]);
          if (!Array.isArray(current)) {
            throw new MechanicsExecutionError(
              "MECHANICS_SET_REQUIRED",
              `Attribute "${patch.path[0]}" must contain its declared set representation`,
              step.id
            );
          }
          const value = evaluateExpression(
            patch.value,
            context,
            { model, entity, id: entityId }
          );
          // Runtime parameters do not exist at publication time. Validate the
          // exact element again before comparing or retaining it.
          assertValueMatchesType(
            context,
            setType.itemType,
            value,
            `set-add value for attribute "${patch.path[0]}"`
          );
          const valueIdentity = canonicalMechanicsValueIdentity(
            value,
            `set-add value for attribute "${patch.path[0]}"`
          );
          let scannedItems = 0;
          const alreadyPresent = current.some((item, index) => {
            scannedItems += 1;
            return canonicalMechanicsValueIdentity(
              item,
              `attribute "${patch.path[0]}"[${index}]`
            ) === valueIdentity;
          });
          // Runtime charges actual visited members; publication reserves the
          // complete maxItems bound, including when this step is inside each.
          charge(context, "algorithmWork", scannedItems);
          if (!alreadyPresent) {
            if (current.length >= setType.maxItems) {
              throw new MechanicsExecutionError(
                "MECHANICS_SET_CAPACITY_EXCEEDED",
                `Attribute "${patch.path[0]}" reached its declared set capacity`,
                step.id
              );
            }
            writeEntityField(
              context,
              model,
              entity,
              "attribute",
              patch.path[0],
              [...current, structuredClone(value)]
            );
          }
          // Count the authored mutation attempt even when idempotence avoids
          // a physical write, matching the static one-write reservation.
          charge(context, "writes");
          continue;
        }
        const current = structuredClone(readEntityField(model, entity, "attribute", patch.path[0]));
        // The schema exposes a closed discriminated union: `remove` has no
        // value at all, while every other operation requires one. Narrowing on
        // the operation keeps runtime aligned with that single schema source.
        const value = patch.operation === "remove"
          ? undefined
          : evaluateExpression(patch.value, context, { model, entity, id: entityId });
        const next = patchNested(current, patch.path.slice(1), patch.operation, value);
        writeEntityField(context, model, entity, "attribute", patch.path[0], next);
        charge(context, "writes");
      }
      return entityId;
    }
    case "core.entities.update": {
      const selection = requireSelection(context.results.get(step.selection.stepId), step.id);
      const model = context.stateModel.collections[selection.collectionId];
      for (const entityId of [...selection.ids].sort(compareCanonicalIds)) {
        const entity = findEntity(context, selection.collectionId, entityId);
        const item = { model, entity, id: entityId };
        for (const [field, expression] of Object.entries(step.facetValues ?? {})) {
          writeEntityField(context, model, entity, "facet", field, evaluateExpression(expression, context, item));
          charge(context, "writes");
        }
        for (const [field, expression] of Object.entries(step.attributeValues ?? {})) {
          writeEntityField(context, model, entity, "attribute", field, evaluateExpression(expression, context, item));
          charge(context, "writes");
        }
        for (const [field, expression] of Object.entries(step.attributeSetRemovals ?? {})) {
          const current = readEntityField(model, entity, "attribute", field);
          if (!Array.isArray(current)) throw new MechanicsExecutionError("MECHANICS_SET_REQUIRED", `Field "${field}" must be a set`, step.id);
          const removal = evaluateExpression(expression, context, item);
          writeEntityField(context, model, entity, "attribute", field, current.filter((value) => !isDeepStrictEqual(value, removal)));
          charge(context, "writes");
        }
      }
      return { updatedIds: selection.ids };
    }
    case "core.event.emit": {
      const event = {
        eventType: step.eventType,
        audience: step.audience,
        summary: evaluateExpression(step.summary, context),
        data: Object.fromEntries(
          Object.entries(step.data ?? {}).map(([key, expression]) => [key, evaluateExpression(expression, context)])
        )
      };
      const payloadType = context.stateModel.events[step.eventType]?.payloadType;
      if (!payloadType) {
        throw new MechanicsExecutionError("MECHANICS_EVENT_REF_UNKNOWN", `Event "${step.eventType}" is not declared`, step.id);
      }
      assertValueMatchesType(context, payloadType, event.data, `event "${step.eventType}" payload`);
      // Reject one oversized event before it is retained in either the
      // protected ledger output or the game-defined journal projection.
      chargeEventOutput(context, event);
      context.events.push(event);
      charge(context, "events");
      const journalReference = context.stateModel.events[step.eventType]?.journalEndpoint;
      // ADR-092: a public event of a game with a public metric catalog receives
      // the whole-transaction metric snapshot after every step runs. The values
      // are not known yet here (later steps may still change metrics), so this
      // step only records the target; the executor fills the block at the end.
      const auditsMetrics =
        step.audience === "public" &&
        context.publicMetrics !== undefined &&
        context.publicMetrics.length > 0;
      let journalIndex: number | undefined;
      if (journalReference) {
        const journal = readStateReference(context, journalReference);
        if (!Array.isArray(journal)) {
          throw new MechanicsExecutionError(
            "MECHANICS_EVENT_JOURNAL_INVALID",
            `Event journal endpoint "${journalReference.endpoint}" must contain a list`,
            step.id
          );
        }
        // The appended entry takes the current end index; appends never reorder
        // earlier entries, so this index stays valid for the end-of-transaction
        // metric-audit pass even if later events append more entries.
        journalIndex = journal.length;
        // Keep game-defined data nested so a generic Presenter never has to
        // guess which arbitrary field names are platform journal metadata.
        // The session store keeps the same full envelope separately.
        writeStateReference(context, journalReference, [
          ...journal,
          {
            eventType: event.eventType,
            audience: event.audience,
            summary: structuredClone(event.summary),
            data: structuredClone(event.data)
          }
        ]);
        charge(context, "writes");
      }
      if (auditsMetrics) {
        (context.metricAuditTargets ??= []).push({
          event,
          ...(journalReference !== undefined && journalIndex !== undefined
            ? { journalReference, journalIndex }
            : {})
        });
      }
      return event;
    }
    case "system.schedule.register": {
      const scheduleId = requireSystemScheduleId(context.createScheduleId(), step.id);
      // Canonical key order makes the protected mutation independent of the
      // source object's insertion order and therefore stable for persistence,
      // command fingerprints and replay. `Object.fromEntries` also creates
      // own data properties for names such as `__proto__`; ordinary indexed
      // assignment would accidentally invoke the legacy prototype setter.
      const params = Object.fromEntries(
        Object.entries(step.params)
          .sort(([left], [right]) => compareCanonicalIds(left, right))
          .map(([name, expression]) => [
            name,
            requireSystemScheduleParam(
              evaluateExpression(expression, context),
              name,
              step.id
            )
          ])
      ) as Record<string, string | number | boolean>;
      context.systemScheduleMutations.push({
        kind: "register",
        scheduleId,
        actionId: requireMechanicsIdentifier(step.actionId, "Scheduled action id"),
        params,
        trigger: structuredClone(step.trigger),
        falsePolicy: step.falsePolicy,
        maxOccurrences: step.maxOccurrences
      });
      charge(context, "writes");
      return { scheduleId };
    }
    case "system.schedule.cancel": {
      const scheduleId = requireSystemScheduleId(
        evaluateExpression(step.scheduleId, context),
        step.id
      );
      context.systemScheduleMutations.push({ kind: "cancel", scheduleId });
      charge(context, "writes");
      return { scheduleId };
    }
    default:
      throw new MechanicsExecutionError("MECHANICS_CORE_OPERATION_UNSUPPORTED", `Unsupported core operation "${step.op}"`, step.id);
  }
}

/**
 * Validate the opaque scheduler identity.
 *
 * It intentionally differs from ordinary Mechanics identifiers: a base64url
 * id may begin with `_` or `-`, while its 128-character cap still prevents
 * unbounded protected storage keys.
 */
function requireSystemScheduleId(value: unknown, stepId: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{22,128}$/u.test(value)) {
    throw new MechanicsExecutionError(
      "MECHANICS_SYSTEM_SCHEDULE_ID_INVALID",
      "System schedule id must be a bounded opaque base64url identifier",
      stepId
    );
  }
  return value;
}

/** Deferred system parameters are deliberately limited to durable scalars. */
function requireSystemScheduleParam(
  value: unknown,
  name: string,
  stepId: string
): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new MechanicsExecutionError(
    "MECHANICS_SYSTEM_SCHEDULE_PARAM_INVALID",
    `Scheduled parameter "${name}" must evaluate to a string, finite number, or boolean`,
    stepId
  );
}

/** Allocate a monotonic, collision-free id inside the candidate transaction. */
function allocateCollectionId(
  step: Extract<Step, { op: "core.collection.id.allocate" }>,
  context: MechanicsExecutionContext
): { id: string; sequence: number } {
  const collection = collectionEntries(context, step.collection);
  const usedIds = new Set(collection.entries.map(([id]) => id));
  const bindings = evaluateStateReferenceBindings(step.sequence, context);
  let sequence = finiteSafeInteger(readEndpoint(context, step.sequence, "current", bindings));
  if (sequence < 0) {
    throw new MechanicsExecutionError("MECHANICS_SEQUENCE_INVALID", "Collection id sequence cannot be negative", step.id);
  }
  let id: string;
  do {
    if (sequence >= Number.MAX_SAFE_INTEGER) {
      throw new MechanicsExecutionError("MECHANICS_SEQUENCE_EXHAUSTED", "Collection id sequence is exhausted", step.id);
    }
    sequence += 1;
    id = requireMechanicsIdentifier(`${step.prefix}:${sequence}`, "Allocated entity id");
  } while (usedIds.has(id));
  writeEndpoint(context, step.sequence, sequence, bindings);
  charge(context, "writes");
  return { id, sequence };
}

/** Select the next canonical item while keeping exclusion semantics in IR. */
function selectNextSequenceValue(
  step: Extract<Step, { op: "core.sequence.next" }>,
  context: MechanicsExecutionContext
): string {
  const rawItems = evaluateExpression(step.items, context);
  const current = requireMechanicsIdentifier(evaluateExpression(step.current, context), "Current sequence item");
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new MechanicsExecutionError("MECHANICS_SEQUENCE_INVALID", "Sequence items must be a non-empty list", step.id);
  }
  const items = rawItems.map((value) => requireMechanicsIdentifier(value, "Sequence item"));
  if (new Set(items).size !== items.length || !items.includes(current)) {
    throw new MechanicsExecutionError("MECHANICS_SEQUENCE_INVALID", "Sequence items must be unique and contain the current item", step.id);
  }
  const excludedValues = step.exclude
    ? step.exclude.values.map((value) => evaluateExpression(value, context))
    : [];
  const excluded = (id: string): boolean => {
    if (!step.exclude) return false;
    const model = context.stateModel.collections[step.exclude.collection];
    const entity = findEntity(context, step.exclude.collection, id);
    const value = readCollectionField(model, entity, step.exclude.field);
    return excludedValues.some((candidate) => isDeepStrictEqual(candidate, value));
  };
  const currentIndex = items.indexOf(current);
  for (let offset = 1; offset <= items.length; offset += 1) {
    const candidate = items[(currentIndex + offset) % items.length];
    charge(context, "scannedEntities");
    if (!excluded(candidate)) return candidate;
  }
  throw new MechanicsExecutionError("MECHANICS_SEQUENCE_NO_CANDIDATE", "No eligible sequence item remains", step.id);
}

type ScoreEntry = {
  entityId: string;
  baseValue: number;
  relatedValue: number;
  score: number;
  relatedItems: Array<{ entityId: string; value: number }>;
};

/** Aggregate one declared numeric base and bounded related entity values. */
function scoreEntities(
  step: Extract<Step, { op: "core.entities.score" }>,
  context: MechanicsExecutionContext
): { kind: "scores"; entries: Array<ScoreEntry> } {
  const entityBindings = evaluateStateReferenceBindings(step.entities, context);
  const entities = readEndpoint(context, step.entities, "current", entityBindings);
  if (!isRecord(entities)) {
    throw new MechanicsExecutionError("MECHANICS_SCORE_ENTITIES_INVALID", "Scored entities must be a declared record", step.id);
  }
  const entityIds = step.entityIds.map((value) =>
    requireMechanicsIdentifier(evaluateExpression(value, context), "Scored entity id")
  );
  if (new Set(entityIds).size !== entityIds.length) {
    throw new MechanicsExecutionError("MECHANICS_SCORE_ENTITY_DUPLICATE", "Scored entity ids must be unique", step.id);
  }

  const relatedByOwner = new Map<string, Array<{ entityId: string; value: number }>>();
  for (const source of step.relatedSources) {
    const collection = collectionEntries(context, source.collection);
    for (const [entityId, entity] of [...collection.entries]
      .sort(([left], [right]) => compareCanonicalIds(left, right))) {
      charge(context, "scannedEntities");
      const ownerId = requireMechanicsIdentifier(
        readCollectionField(collection.model, entity, source.ownerField),
        "Related entity owner"
      );
      if (!entityIds.includes(ownerId)) continue;
      const value = finiteSafeInteger(readCollectionField(collection.model, entity, source.valueField));
      relatedByOwner.set(ownerId, [...(relatedByOwner.get(ownerId) ?? []), { entityId, value }]);
    }
  }

  const entries = entityIds.map((entityId): ScoreEntry => {
    const entity = isRecord(entities[entityId]) ? entities[entityId] as JsonRecord : undefined;
    if (!entity) {
      throw new MechanicsExecutionError("MECHANICS_SCORE_ENTITY_UNKNOWN", "A scored entity is unavailable", step.id);
    }
    const baseValue = finiteSafeInteger(entity[step.baseField]);
    const relatedItems = relatedByOwner.get(entityId) ?? [];
    const relatedValue = relatedItems.reduce((sum, item) => safeIntegerSum(sum, item.value, step.id), 0);
    return {
      entityId,
      baseValue,
      relatedValue,
      score: safeIntegerSum(baseValue, relatedValue, step.id),
      relatedItems
    };
  });
  charge(context, "resultEntities", entries.length);
  return { kind: "scores", entries };
}

/** Stable descending rank over an already-computed neutral score table. */
function rankScores(
  step: Extract<Step, { op: "core.ranking.stable" }>,
  context: MechanicsExecutionContext
): { groups: JsonRecord } {
  const raw = evaluateExpression(step.scores, context);
  if (!isRecord(raw) || raw.kind !== "scores" || !Array.isArray(raw.entries)) {
    throw new MechanicsExecutionError("MECHANICS_SCORE_RESULT_INVALID", "Stable ranking requires a score result", step.id);
  }
  const byId = new Map<string, ScoreEntry>();
  for (const candidate of raw.entries) {
    if (!isScoreEntry(candidate) || byId.has(candidate.entityId)) {
      throw new MechanicsExecutionError("MECHANICS_SCORE_RESULT_INVALID", "Score result contains an invalid or duplicate entry", step.id);
    }
    byId.set(candidate.entityId, candidate);
  }
  const groups: JsonRecord = {};
  for (const group of step.groups) {
    if (groups[group.id] !== undefined) {
      throw new MechanicsExecutionError("MECHANICS_RANKING_GROUP_DUPLICATE", "Ranking group ids must be unique", step.id);
    }
    const ids = group.entityIds.map((value) =>
      requireMechanicsIdentifier(evaluateExpression(value, context), "Ranked entity id")
    );
    if (new Set(ids).size !== ids.length) {
      throw new MechanicsExecutionError("MECHANICS_RANKING_ENTITY_DUPLICATE", "Ranking group entity ids must be unique", step.id);
    }
    const sorted = ids.map((id) => {
      const entry = byId.get(id);
      if (!entry) throw new MechanicsExecutionError("MECHANICS_RANKING_ENTITY_UNKNOWN", "A ranked entity has no score", step.id);
      return entry;
    }).sort((left, right) => right.score - left.score || compareCanonicalIds(left.entityId, right.entityId));
    let previousScore: number | undefined;
    let previousRank = 0;
    const standings = sorted.map((entry, index) => {
      const rank = entry.score === previousScore ? previousRank : index + 1;
      previousScore = entry.score;
      previousRank = rank;
      return { ...structuredClone(entry), rank };
    });
    const winningScore = standings[0]?.score;
    const winners = standings.filter((entry) => entry.score === winningScore).map((entry) => entry.entityId);
    groups[group.id] = { standings, winners, tiedForFirst: winners.length > 1 };
  }
  return { groups };
}

function isScoreEntry(value: unknown): value is ScoreEntry {
  return isRecord(value) && typeof value.entityId === "string" && Number.isSafeInteger(value.baseValue) &&
    Number.isSafeInteger(value.relatedValue) && Number.isSafeInteger(value.score) && Array.isArray(value.relatedItems);
}

function finiteSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new MechanicsExecutionError("MECHANICS_INTEGER_REQUIRED", "Expected a safe integer");
  }
  return value as number;
}

function safeIntegerSum(left: number, right: number, stepId: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new MechanicsExecutionError("MECHANICS_ARITHMETIC_INVALID", "Score aggregation exceeds the safe integer range", stepId);
  }
  return sum;
}

function selectEntities(step: Extract<Step, { op: "core.entities.select" }>, context: MechanicsExecutionContext): EntitySelection {
  const collection = collectionEntries(context, step.selector.collection);
  const within = step.selector.within
    ? new Set(requireSelection(context.results.get(step.selector.within.stepId), step.id).ids)
    : undefined;
  const ids: Array<string> = [];
  for (const [id, entity] of collection.entries.sort(([left], [right]) => compareCanonicalIds(left, right))) {
    if (within && !within.has(id)) continue;
    charge(context, "scannedEntities");
    if (step.selector.objectTypes && !step.selector.objectTypes.includes(String(entity.objectType))) continue;
    const item = { model: collection.model, entity, id };
    if (!matchesExactFields(step.selector.facets, "facet", item, context)) continue;
    if (!matchesAttributeConditions(step.selector.attributes, item, context)) continue;
    ids.push(id);
    charge(context, "resultEntities");
    if (ids.length > step.selector.cardinality.max) {
      throw new MechanicsExecutionError("MECHANICS_CARDINALITY_MAX", "Entity selection exceeded its declared maximum", step.id);
    }
  }
  if (ids.length < step.selector.cardinality.min) {
    throw new MechanicsExecutionError("MECHANICS_CARDINALITY_MIN", "Entity selection did not meet its declared minimum", step.id);
  }
  return { kind: "entities", collectionId: step.selector.collection, ids };
}

function matchesExactFields(
  fields: Record<string, import("./types.ts").ValueExpression> | undefined,
  area: "facet" | "attribute",
  item: { model: import("./types.ts").CollectionModel; entity: JsonRecord; id: string },
  context: MechanicsExecutionContext
): boolean {
  return Object.entries(fields ?? {}).every(([field, expression]) => {
    charge(context, "algorithmWork", derivedCollectionFieldReadWork(item.model, field));
    return isDeepStrictEqual(
      readEntityField(item.model, item.entity, area, field),
      evaluateExpression(expression, context, item)
    );
  });
}

function matchesAttributeConditions(
  fields: Extract<Step, { op: "core.entities.select" }>["selector"]["attributes"],
  item: { model: import("./types.ts").CollectionModel; entity: JsonRecord; id: string },
  context: MechanicsExecutionContext
): boolean {
  return Object.entries(fields ?? {}).every(([field, condition]) => {
    charge(context, "algorithmWork", derivedCollectionFieldReadWork(item.model, field));
    const current = readEntityField(item.model, item.entity, "attribute", field);
    if ("operator" in condition) {
      const expected = evaluateExpression(condition.value, context, item);
      if (condition.operator === "contains") return Array.isArray(current) && current.some((value) => isDeepStrictEqual(value, expected));
      if (condition.operator === "notContains") return Array.isArray(current) && current.every((value) => !isDeepStrictEqual(value, expected));
      if (condition.operator === "isEmpty") return Array.isArray(current) && current.length === 0;
      if (condition.operator === "notEmpty") return Array.isArray(current) && current.length > 0;
      return compare(current, expected, condition.operator);
    }
    return isDeepStrictEqual(current, evaluateExpression(condition, context, item));
  });
}

/**
 * Validate a protected result produced by `core.entities.select`.
 *
 * Ordering is a separate Mechanics module, but it consumes the same typed
 * selection contract as core updates. Keeping the runtime guard here avoids
 * two subtly different definitions of a trusted selection result.
 */
export function requireSelection(value: unknown, stepId: string): EntitySelection {
  if (!isRecord(value) || value.kind !== "entities" || typeof value.collectionId !== "string" ||
      !Array.isArray(value.ids) || !value.ids.every((id) => typeof id === "string") ||
      new Set(value.ids).size !== value.ids.length) {
    throw new MechanicsExecutionError("MECHANICS_RESULT_TYPE_MISMATCH", "Expected an entity selection", stepId);
  }
  return value as unknown as EntitySelection;
}

/** Runtime counterpart of the publication sort-work upper bound. */
function canonicalIterationWorkUpperBound(selectionSize: number): number {
  if (selectionSize <= 1) return selectionSize;
  return selectionSize * Math.ceil(Math.log2(selectionSize)) + selectionSize;
}

function patchNested(current: unknown, path: Array<string>, operation: string, value: unknown): unknown {
  if (path.length === 0) {
    if (operation === "remove") return undefined;
    if (operation === "set") return structuredClone(value);
    if (operation === "increment") return finiteNumber(current) + finiteNumber(value);
    if (operation === "append") {
      if (!Array.isArray(current)) throw new MechanicsExecutionError("MECHANICS_LIST_REQUIRED", "append target must be a list");
      return [...current, structuredClone(value)];
    }
  }
  const root = isRecord(current) ? current : {};
  let cursor = root;
  for (const segment of path.slice(0, -1)) {
    if (!isRecord(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment] as JsonRecord;
  }
  const key = path.at(-1) as string;
  if (operation === "remove") delete cursor[key];
  else if (operation === "set") cursor[key] = structuredClone(value);
  else if (operation === "increment") cursor[key] = finiteNumber(cursor[key]) + finiteNumber(value);
  else if (operation === "append") {
    if (!Array.isArray(cursor[key])) throw new MechanicsExecutionError("MECHANICS_LIST_REQUIRED", "append target must be a list");
    cursor[key] = [...cursor[key] as Array<unknown>, structuredClone(value)];
  }
  return root;
}

/**
 * Resolve the narrow schema-backed target of `set-add`.
 *
 * The operation deliberately accepts one logical attribute rather than an
 * arbitrary JSON path. This keeps type, access and capacity entirely owned by
 * the published state model and prevents a nested broad-JSON escape hatch.
 */
function requireDirectWritableSetType(
  context: MechanicsExecutionContext,
  model: CollectionModel,
  path: ReadonlyArray<string>,
  stepId: string
): Extract<
  MechanicsExecutionContext["stateModel"]["types"][string],
  { kind: "list" | "set" }
> & { kind: "set" } {
  if (path.length !== 1 || model.itemShape === "record") {
    throw new MechanicsExecutionError(
      "MECHANICS_SET_TARGET_INVALID",
      "set-add requires one direct entity attribute",
      stepId
    );
  }
  const field = model.fields[path[0]];
  if (
    !field ||
    !("storage" in field) ||
    field.storage.kind !== "attribute" ||
    field.access !== "read-write"
  ) {
    throw new MechanicsExecutionError(
      "MECHANICS_FIELD_NOT_WRITABLE",
      `Attribute "${path[0]}" is not a directly stored writable field`,
      stepId
    );
  }
  const type = context.stateModel.types[field.valueType];
  if (!type || type.kind !== "set") {
    throw new MechanicsExecutionError(
      "MECHANICS_SET_REQUIRED",
      `Attribute "${path[0]}" must have declared set type`,
      stepId
    );
  }
  // The generated contract intentionally shares one structural variant for
  // list and set (`kind: "list" | "set"`). The runtime check above narrows
  // that schema-backed variant to the set-only view needed by this operation;
  // no independent imperative data shape is introduced here.
  return type as typeof type & { kind: "set" };
}

type StateReference = {
  endpoint: string;
  bindings?: Record<string, import("./types.ts").ValueExpression>;
};

function readStateReference(context: MechanicsExecutionContext, reference: StateReference): unknown {
  return readEndpoint(
    context,
    reference,
    "current",
    evaluateStateReferenceBindings(reference, context)
  );
}

function writeStateReference(
  context: MechanicsExecutionContext,
  reference: StateReference,
  value: unknown
): void {
  writeEndpoint(context, reference, value, evaluateStateReferenceBindings(reference, context));
}

function removeStateReference(context: MechanicsExecutionContext, reference: StateReference): void {
  removeEndpoint(context, reference, evaluateStateReferenceBindings(reference, context));
}

/**
 * Read a declared public metric value by its dot path (ADR-092).
 *
 * The platform never hard-codes metric names: it walks the game-declared
 * `statePath` (for example `public.metrics.time`) generically. A missing or
 * non-finite value reads as 0 so a partially initialized metric still yields a
 * well-formed snapshot instead of failing the whole action.
 */
function readMetricNumberAtPath(state: unknown, statePath: string): number {
  let current: unknown = state;
  for (const segment of statePath.split(".")) {
    if (!isRecord(current)) return 0;
    current = current[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

/**
 * Attach ADR-092 public-metric deltas to the transaction's public events.
 *
 * Called by the executor once every step has run, so both the pre-action snapshot
 * (`context.preActionState`) and the committed candidate state (`context.state`)
 * are stable. All recorded public events share one block (the whole-transaction
 * delta), and any in-state journal entry an event appended receives an identical
 * copy so the player-facing journal can render metric rows. No-op when the game
 * declares no public metric catalog or no public event was recorded.
 */
export function applyTransactionMetricAudit(context: MechanicsExecutionContext): void {
  const targets = context.metricAuditTargets;
  const publicMetrics = context.publicMetrics;
  if (!targets || targets.length === 0 || !publicMetrics || publicMetrics.length === 0) {
    return;
  }

  const metricChanges = publicMetrics.map((metric) => ({
    metricId: metric.metricId,
    before: readMetricNumberAtPath(context.preActionState, metric.statePath),
    after: readMetricNumberAtPath(context.state, metric.statePath)
  }));

  for (const target of targets) {
    target.event.metricChanges = metricChanges;
    if (target.journalReference === undefined || target.journalIndex === undefined) {
      continue;
    }
    // The journal array read here is the live candidate array (no more writes
    // follow), so mutating the recorded entry in place enriches the durable
    // state the player projection reads.
    const journal = readStateReference(context, target.journalReference);
    if (!Array.isArray(journal)) {
      continue;
    }
    const entry = journal[target.journalIndex];
    if (isRecord(entry)) {
      entry.metricChanges = structuredClone(metricChanges);
    }
  }
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new MechanicsExecutionError("MECHANICS_NUMBER_REQUIRED", "Expected a finite number");
  return value;
}

function finiteNonnegative(value: unknown): number {
  const number = finiteNumber(value);
  if (number < 0) throw new MechanicsExecutionError("MECHANICS_NONNEGATIVE_REQUIRED", "Expected a non-negative number");
  return number;
}

type ResourceEndpoint = Extract<Step, { op: "core.resource.transfer" }>["from"];

function readResourceEndpoint(endpoint: Exclude<ResourceEndpoint, { kind: "bank" }>, context: MechanicsExecutionContext): number {
  if (endpoint.kind === "state") return finiteNumber(readStateReference(context, endpoint.target));
  const entityId = requireMechanicsIdentifier(evaluateExpression(endpoint.entity.entityId, context), "Resource entity id");
  const entity = findEntity(context, endpoint.entity.collection, entityId);
  const model = context.stateModel.collections[endpoint.entity.collection];
  return finiteNumber(readCollectionField(model, entity, endpoint.field));
}

function writeResourceEndpoint(
  endpoint: Exclude<ResourceEndpoint, { kind: "bank" }>,
  value: number,
  context: MechanicsExecutionContext
): void {
  if (endpoint.kind === "state") {
    writeStateReference(context, endpoint.target, value);
    return;
  }
  const entityId = requireMechanicsIdentifier(evaluateExpression(endpoint.entity.entityId, context), "Resource entity id");
  const entity = findEntity(context, endpoint.entity.collection, entityId);
  const model = context.stateModel.collections[endpoint.entity.collection];
  writeCollectionField(context, model, entity, endpoint.field, finiteNumber(value));
}
