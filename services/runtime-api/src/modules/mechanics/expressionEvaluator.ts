/** Pure evaluation of schema-validated Mechanics IR values and predicates. */
import { isDeepStrictEqual } from "node:util";
import {
  assertEvaluationDepth,
  charge,
  chargeIntermediateValue,
  measureBoundedJson
} from "./budget.ts";
import { MechanicsExecutionError } from "./errors.ts";
import {
  collectionEntries,
  findEntity,
  isRecord,
  readCollectionField,
  readEndpoint,
  readEntityField,
  requireMechanicsIdentifier,
  canonicalMechanicsValueIdentity,
  derivedCollectionFieldReadWork,
  type ResolvedStateBindings
} from "./stateModel.ts";
import type {
  CollectionModel,
  JsonRecord,
  MechanicsExecutionContext,
  MechanicsItemScope,
  Predicate,
  ValueExpression
} from "./types.ts";

export type ItemScope = MechanicsItemScope;

type StateReferenceWithBindings = {
  endpoint: string;
  bindings?: Record<string, ValueExpression>;
};

/** Evaluate dynamic StateRef storage keys before entering the state layer. */
export function evaluateStateReferenceBindings(
  reference: StateReferenceWithBindings,
  context: MechanicsExecutionContext,
  item?: ItemScope,
  depth = 0
): ResolvedStateBindings {
  const bindings: ResolvedStateBindings = {};
  for (const [name, expression] of Object.entries(reference.bindings ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0)) {
    bindings[name] = requireMechanicsIdentifier(
      evaluateExpression(expression, context, item, depth),
      `State binding "${name}"`
    );
  }
  return bindings;
}

export function evaluateExpression(
  expression: ValueExpression,
  context: MechanicsExecutionContext,
  item?: ItemScope,
  depth = 0
): unknown {
  assertEvaluationDepth(depth);
  charge(context, "expressionNodes");
  // Most operations evaluate expressions without an explicit item argument.
  // A bounded `core.entities.each` body installs its trusted item on the
  // executor context, while operations such as `core.entities.update` pass a
  // more specific inner item and therefore intentionally shadow that binding.
  const scopedItem = item ?? context.currentItem;
  const value = evaluateExpressionValue(expression, context, scopedItem, depth);
  // Parameters, stored state and module results can bypass the HTTP body that
  // originally created them. Charge every materialized expression result so
  // repeated reads of large values cannot create unaccounted runtime work.
  chargeIntermediateValue(context, value);
  return value;
}

function evaluateExpressionValue(
  expression: ValueExpression,
  context: MechanicsExecutionContext,
  item: ItemScope | undefined,
  depth: number
): unknown {
  switch (expression.op) {
    case "value.literal": return structuredClone(expression.value);
    case "value.param": return context.params[expression.name];
    case "value.actor": return context.actor.actorPlayerId;
    case "value.state": {
      const reference = expression.ref as StateReferenceWithBindings;
      return readEndpoint(
        context,
        reference,
        expression.readFrom ?? "current",
        evaluateStateReferenceBindings(reference, context, item, depth + 1)
      );
    }
    case "value.entity": {
      const entityExpression = expression as unknown as {
        entity: { collection: string; entityId: ValueExpression };
        field: string;
      };
      const entityId = requireMechanicsIdentifier(
        evaluateExpression(entityExpression.entity.entityId, context, item, depth + 1),
        "Entity expression id"
      );
      const entity = findEntity(context, entityExpression.entity.collection, entityId);
      const model = context.stateModel.collections[entityExpression.entity.collection];
      if (!model) {
        throw new MechanicsExecutionError(
          "MECHANICS_COLLECTION_REF_UNKNOWN",
          `Unknown collection "${entityExpression.entity.collection}"`
        );
      }
      charge(context, "algorithmWork", derivedCollectionFieldReadWork(model, entityExpression.field));
      return readCollectionField(model, entity, entityExpression.field);
    }
    case "value.result": {
      let value = context.results.get(expression.stepId);
      if (value === undefined) throw new MechanicsExecutionError("MECHANICS_RESULT_REF_UNKNOWN", `Unknown result "${expression.stepId}"`);
      for (const segment of expression.path ?? []) {
        if (!isRecord(value) && !Array.isArray(value)) return undefined;
        value = (value as JsonRecord)[segment];
      }
      return value;
    }
    case "value.item":
      if (!item) throw new MechanicsExecutionError("MECHANICS_ITEM_SCOPE_INVALID", "value.item requires an entity scope");
      return expression.area === "identity"
        ? item.id
        : readEntityField(item.model, item.entity, expression.area, expression.field);
    case "value.coalesce":
      for (const candidate of expression.items) {
        const value = evaluateExpression(candidate, context, item, depth + 1);
        if (value !== null && value !== undefined) return value;
      }
      return null;
    case "number.add":
    case "number.subtract":
    case "number.multiply":
    case "number.divide":
    case "number.modulo":
    case "number.min":
    case "number.max":
      return evaluateArithmetic(
        expression.op,
        expression.items.map((part) => requireNumber(evaluateExpression(part, context, item, depth + 1)))
      );
    default:
      throw new MechanicsExecutionError("MECHANICS_EXPRESSION_UNSUPPORTED", `Unsupported expression "${String((expression as { op: string }).op)}"`);
  }
}

export function evaluatePredicate(
  predicate: Predicate,
  context: MechanicsExecutionContext,
  item?: ItemScope,
  depth = 0
): boolean {
  assertEvaluationDepth(depth);
  charge(context, "expressionNodes");
  const scopedItem = item ?? context.currentItem;
  switch (predicate.op) {
    case "predicate.constant": return predicate.value;
    case "predicate.all": return predicate.items.every((part) => evaluatePredicate(part, context, scopedItem, depth + 1));
    case "predicate.any": return predicate.items.some((part) => evaluatePredicate(part, context, scopedItem, depth + 1));
    case "predicate.not": return !evaluatePredicate(predicate.item, context, scopedItem, depth + 1);
    case "predicate.compare":
      return compare(
        evaluateExpression(predicate.left, context, scopedItem, depth + 1),
        evaluateExpression(predicate.right, context, scopedItem, depth + 1),
        predicate.operator
      );
    case "predicate.exists": {
      const value = evaluateExpression(predicate.value, context, scopedItem, depth + 1);
      return (value !== undefined && value !== null) === predicate.exists;
    }
    case "predicate.actor.active":
      return context.actor.actorPlayerId !== undefined && context.actor.actorPlayerId === context.actor.activePlayerId;
    case "predicate.turn.phase":
      return isDeepStrictEqual(
        readRuntimeTurnPhase(context),
        evaluateExpression(predicate.phase, context, scopedItem, depth + 1)
      );
    case "predicate.entity.matches": {
      const entityId = requireMechanicsIdentifier(
        evaluateExpression(predicate.entity.entityId, context, scopedItem, depth + 1),
        "Predicate entity id"
      );
      const entity = findEntity(context, predicate.entity.collection, entityId);
      const collection = context.stateModel.collections[predicate.entity.collection];
      if (predicate.objectType !== undefined && entity.objectType !== predicate.objectType) return false;
      return matchesFields(predicate.facets, "facet", collection, entity, context, depth) &&
        matchesFields(predicate.attributes, "attribute", collection, entity, context, depth);
    }
    case "predicate.collection.count": {
      const source = new Map(collectionEntries(context, predicate.collection).entries);
      const expected = evaluateExpression(predicate.equals, context, scopedItem, depth + 1);
      const minimum = requireNumber(evaluateExpression(predicate.countAtLeast, context, scopedItem, depth + 1));
      if (!Number.isSafeInteger(minimum) || minimum < 0) {
        throw new MechanicsExecutionError("MECHANICS_COUNT_INVALID", "Collection count minimum must be a non-negative safe integer");
      }
      const ids = predicate.ids.map((id) => requireMechanicsIdentifier(
        evaluateExpression(id, context, scopedItem, depth + 1),
        "Collection entity id"
      ));
      const count = ids.filter((id) => {
        let value: unknown = source.get(id);
        for (const segment of predicate.field) value = isRecord(value) ? value[segment] : undefined;
        return isDeepStrictEqual(value, expected);
      }).length;
      return count >= minimum;
    }
    case "predicate.set.disjoint": {
      const left = requireBoundedRuntimeSet(
        evaluateExpression(predicate.left, context, scopedItem, depth + 1),
        "left set",
        context
      );
      const right = requireBoundedRuntimeSet(
        evaluateExpression(predicate.right, context, scopedItem, depth + 1),
        "right set",
        context
      );
      if (left.itemClass !== undefined &&
          right.itemClass !== undefined &&
          left.itemClass !== right.itemClass) {
        throw new MechanicsExecutionError(
          "MECHANICS_SET_TYPE_MISMATCH",
          "Set disjoint operands must contain the same runtime item class"
        );
      }
      const leftIdentities = new Set(left.identities);
      return right.identities.every((identity) => !leftIdentities.has(identity));
    }
    default:
      throw new MechanicsExecutionError("MECHANICS_PREDICATE_UNSUPPORTED", `Unsupported predicate "${String((predicate as { op: string }).op)}"`);
  }
}

function requireBoundedRuntimeSet(
  value: unknown,
  label: string,
  context: MechanicsExecutionContext
): {
  identities: Array<string>;
  itemClass?: RuntimeSetItemClass;
} {
  if (!Array.isArray(value) || value.length > context.limits.resultEntities) {
    throw new MechanicsExecutionError(
      "MECHANICS_SET_REQUIRED",
      `${label} must be a bounded set representation`
    );
  }
  const usage = measureBoundedJson(value, {
    maxBytes: context.limits.maxIntermediateValueBytes,
    maxDepth: context.limits.maxJsonDepth,
    maxNodes: context.limits.maxJsonNodes,
    maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes
  }, "MECHANICS_SET_REQUIRED");
  // Measuring the JSON and computing canonical set identities are two
  // separate bounded traversals. Charge both so a caller cannot obtain
  // unmetered canonicalization work by repeating a set predicate.
  charge(context, "algorithmWork", usage.nodes);
  const identities = value.map((item, index) =>
    canonicalMechanicsValueIdentity(item, `${label}[${index}]`));
  charge(context, "algorithmWork", usage.nodes);
  if (new Set(identities).size !== identities.length) {
    throw new MechanicsExecutionError(
      "MECHANICS_SET_DUPLICATE",
      `${label} must contain unique items`
    );
  }
  const itemClasses = new Set(value.map(runtimeSetItemClass));
  if (itemClasses.size > 1) {
    throw new MechanicsExecutionError(
      "MECHANICS_SET_TYPE_MISMATCH",
      `${label} must contain one runtime item class`
    );
  }
  return {
    identities,
    itemClass: itemClasses.values().next().value
  };
}

/**
 * Coarse runtime evidence for the statically proven set item type.
 *
 * JavaScript values do not retain their JSON Schema type reference, so this
 * defensive check distinguishes primitive classes and the two structural JSON
 * classes without trying to reconstruct optional record fields. The semantic
 * checker remains the authoritative full type proof; this guard merely makes a
 * corrupted direct-runtime call fail closed instead of comparing unlike data.
 */
type RuntimeSetItemClass =
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "record";

function runtimeSetItemClass(value: unknown): RuntimeSetItemClass {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (isRecord(value)) return "record";
  if (typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string") {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    return "string";
  }
  throw new MechanicsExecutionError(
    "MECHANICS_SET_TYPE_MISMATCH",
    "Set items must be finite JSON values with a stable runtime item class"
  );
}

/** Turn state is runtime-owned platform state, not a game-declared endpoint. */
function readRuntimeTurnPhase(context: MechanicsExecutionContext): unknown {
  const publicState = isRecord(context.state.public) ? context.state.public : undefined;
  const turn = publicState && isRecord(publicState.turn) ? publicState.turn : undefined;
  return turn?.phase;
}

export function compare(left: unknown, right: unknown, operator: string): boolean {
  if (operator === "eq") return isDeepStrictEqual(left, right);
  if (operator === "ne") return !isDeepStrictEqual(left, right);
  if ((typeof left !== "number" && typeof left !== "string") || typeof right !== typeof left) return false;
  const comparableRight = right as number | string;
  if (operator === "gt") return left > comparableRight;
  if (operator === "gte") return left >= comparableRight;
  if (operator === "lt") return left < comparableRight;
  if (operator === "lte") return left <= comparableRight;
  throw new MechanicsExecutionError("MECHANICS_COMPARE_UNSUPPORTED", `Unsupported comparison "${operator}"`);
}

function matchesFields(
  values: Record<string, ValueExpression> | undefined,
  area: "facet" | "attribute",
  model: CollectionModel,
  entity: JsonRecord,
  context: MechanicsExecutionContext,
  predicateDepth: number
): boolean {
  return Object.entries(values ?? {}).every(([fieldId, expression]) =>
    isDeepStrictEqual(
      readEntityField(model, entity, area, fieldId),
      evaluateExpression(expression, context, { model, entity, id: "" }, predicateDepth + 1)
    )
  );
}

function evaluateArithmetic(operation: string, values: Array<number>): number {
  const [first, ...rest] = values;
  const result = operation === "number.add" ? values.reduce((sum, value) => sum + value, 0)
    : operation === "number.subtract" ? rest.reduce((value, part) => value - part, first)
      : operation === "number.multiply" ? values.reduce((value, part) => value * part, 1)
        : operation === "number.divide" ? rest.reduce((value, part) => value / part, first)
          : operation === "number.modulo" ? rest.reduce((value, part) => value % part, first)
            : operation === "number.min" ? Math.min(...values)
              : Math.max(...values);
  if (!Number.isFinite(result)) throw new MechanicsExecutionError("MECHANICS_ARITHMETIC_INVALID", "Arithmetic produced a non-finite number");
  return result;
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MechanicsExecutionError("MECHANICS_NUMBER_REQUIRED", "Expression must produce a finite number");
  }
  return value;
}
