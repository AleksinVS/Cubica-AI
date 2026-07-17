/**
 * Deterministic Mechanics runtime budgets and bounded JSON measurement.
 *
 * HTTP body limits protect only one transport hop. Mechanics also accepts
 * values from stored state and module results, so every memory/output boundary
 * is measured again here in UTF-8 JSON bytes before it can be retained or
 * committed. Wall-clock time is intentionally absent from replay semantics.
 */
import { MechanicsExecutionError } from "./errors.ts";
import type {
  MechanicsExecutionContext,
  MechanicsRuntimeCost,
  MechanicsRuntimeLimits
} from "./types.ts";

const KIB = 1024;
const MIB = 1024 * KIB;

/**
 * Hard recursion ceiling shared by value expressions and predicates.
 *
 * Node counters bound total work, while this separate limit bounds JavaScript
 * call-stack depth for adversarially nested—but otherwise schema-valid—trees.
 */
export const MAX_EXPRESSION_PREDICATE_DEPTH = 64;

export function assertEvaluationDepth(depth: number): void {
  if (depth > MAX_EXPRESSION_PREDICATE_DEPTH) {
    throw new MechanicsExecutionError(
      "MECHANICS_RUNTIME_BUDGET_EXCEEDED",
      "expression/predicate depth budget exceeded"
    );
  }
}

export const RUNTIME_BUDGETS: Record<string, MechanicsRuntimeLimits> = {
  "turn-based-standard-v1": {
    steps: 512,
    expressionNodes: 32_768,
    algorithmWork: 10_000_000,
    scannedEntities: 65_536,
    resultEntities: 16_384,
    writes: 65_536,
    events: 2_048,
    intermediateBytes: 2 * MIB,
    eventBytes: 2 * MIB,
    auditBytes: 2 * MIB,
    maxJsonDepth: 32,
    maxJsonNodes: 32_768,
    maxInputParamNodes: 32_768,
    maxCandidateStateNodes: 1_000_000,
    maxEventNodes: 65_536,
    maxStringUtf8Bytes: 16 * KIB,
    maxIntermediateValueBytes: 256 * KIB,
    maxInputParamsBytes: 256 * KIB,
    maxCandidateStateBytes: 8 * MIB,
    maxSingleEventBytes: 256 * KIB
  },
  "turn-based-large-v1": {
    steps: 512,
    expressionNodes: 131_072,
    algorithmWork: 40_000_000,
    scannedEntities: 262_144,
    resultEntities: 65_536,
    writes: 262_144,
    events: 8_192,
    intermediateBytes: 8 * MIB,
    eventBytes: 8 * MIB,
    auditBytes: 8 * MIB,
    maxJsonDepth: 32,
    maxJsonNodes: 131_072,
    maxInputParamNodes: 131_072,
    maxCandidateStateNodes: 4_000_000,
    maxEventNodes: 262_144,
    maxStringUtf8Bytes: 64 * KIB,
    maxIntermediateValueBytes: 1 * MIB,
    maxInputParamsBytes: 1 * MIB,
    maxCandidateStateBytes: 32 * MIB,
    maxSingleEventBytes: 1 * MIB
  }
};

export function charge(
  context: MechanicsExecutionContext,
  counter: keyof MechanicsRuntimeCost,
  amount = 1
): void {
  context.cost[counter] += amount;
  if (context.cost[counter] > context.limits[counter]) {
    throw new MechanicsExecutionError(
      "MECHANICS_RUNTIME_BUDGET_EXCEEDED",
      `${counter} budget exceeded`
    );
  }
}

export interface JsonResourceLimits {
  maxBytes: number;
  maxDepth: number;
  maxNodes: number;
  maxStringUtf8Bytes: number;
  allowUndefined?: boolean;
}

export interface JsonResourceUsage {
  bytes: number;
  nodes: number;
  depth: number;
}

/**
 * Measure a JSON value without first allocating its complete serialization.
 *
 * Object order does not change serialized size, but keys are still visited in
 * stable order so an invalid value always fails at the same logical place.
 * Messages never include the offending value or key and are therefore safe to
 * map into a public rejection.
 */
export function measureBoundedJson(
  value: unknown,
  limits: JsonResourceLimits,
  code = "MECHANICS_VALUE_RESOURCE_LIMIT"
): JsonResourceUsage {
  const ancestors = new Set<object>();
  let nodes = 0;
  let deepest = 0;
  let bytes = 0;

  const addBytes = (amount: number): void => {
    bytes += amount;
    if (bytes > limits.maxBytes) resourceFailure(code, "serialized JSON exceeds the byte limit");
  };

  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    deepest = Math.max(deepest, depth);
    if (nodes > limits.maxNodes) resourceFailure(code, "JSON node limit exceeded");
    if (depth > limits.maxDepth) resourceFailure(code, "JSON depth limit exceeded");

    if (current === undefined && limits.allowUndefined) {
      // Undefined is a valid internal Option<T> sentinel, but it is never
      // accepted inside an array/object or persisted as JSON.
      addBytes(0);
      return;
    }
    if (current === null || typeof current === "boolean") {
      addBytes(current === null ? 4 : current ? 4 : 5);
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER) {
        resourceFailure(code, "number is outside the deterministic JSON range");
      }
      addBytes(Buffer.byteLength(JSON.stringify(current), "utf8"));
      return;
    }
    if (typeof current === "string") {
      if (Buffer.byteLength(current, "utf8") > limits.maxStringUtf8Bytes) {
        resourceFailure(code, "string exceeds the UTF-8 byte limit");
      }
      addBytes(Buffer.byteLength(JSON.stringify(current), "utf8"));
      return;
    }
    if (Array.isArray(current)) {
      withAncestor(current, ancestors, code, () => {
        addBytes(2 + Math.max(0, current.length - 1));
        for (const item of current) {
          if (item === undefined) resourceFailure(code, "array contains a non-JSON value");
          visit(item, depth + 1);
        }
      });
      return;
    }
    if (isPlainJsonRecord(current)) {
      withAncestor(current, ancestors, code, () => {
        const keys = Object.keys(current).sort();
        addBytes(2 + Math.max(0, keys.length - 1));
        for (const key of keys) {
          if (Buffer.byteLength(key, "utf8") > limits.maxStringUtf8Bytes) {
            resourceFailure(code, "object key exceeds the UTF-8 byte limit");
          }
          const item = current[key];
          if (item === undefined) resourceFailure(code, "object contains a non-JSON value");
          addBytes(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
          visit(item, depth + 1);
        }
      });
      return;
    }
    resourceFailure(code, "value cannot be represented as JSON");
  };

  visit(value, 0);
  return { bytes, nodes, depth: deepest };
}

/** Charge one expression/step result before retaining or copying it. */
export function chargeIntermediateValue(
  context: MechanicsExecutionContext,
  value: unknown
): JsonResourceUsage {
  const usage = measureBoundedJson(value, {
    maxBytes: context.limits.maxIntermediateValueBytes,
    maxDepth: context.limits.maxJsonDepth,
    maxNodes: context.limits.maxJsonNodes,
    maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes,
    allowUndefined: true
  }, "MECHANICS_INTERMEDIATE_VALUE_LIMIT");
  charge(context, "intermediateBytes", usage.bytes);
  return usage;
}

/** Validate and charge an event before adding it to the output array. */
export function chargeEventOutput(
  context: MechanicsExecutionContext,
  event: unknown
): JsonResourceUsage {
  const usage = measureBoundedJson(event, {
    maxBytes: context.limits.maxSingleEventBytes,
    maxDepth: context.limits.maxJsonDepth,
    maxNodes: context.limits.maxEventNodes,
    maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes
  }, "MECHANICS_EVENT_SIZE_LIMIT");
  // Include the surrounding array brackets once and one comma for every
  // later item, so the aggregate counter equals the serialized event array.
  charge(context, "eventBytes", usage.bytes + (context.events.length === 0 ? 2 : 1));
  return usage;
}

/** Charge one audit record before retaining it in the transaction output. */
export function chargeAuditOutput(context: MechanicsExecutionContext, entry: unknown): JsonResourceUsage {
  const framingBytes = context.audit.length === 0 ? 2 : 1;
  const remaining = context.limits.auditBytes - context.cost.auditBytes - framingBytes;
  const usage = measureBoundedJson(entry, {
    maxBytes: Math.max(0, remaining),
    maxDepth: context.limits.maxJsonDepth,
    maxNodes: context.limits.maxJsonNodes,
    maxStringUtf8Bytes: context.limits.maxStringUtf8Bytes
  }, "MECHANICS_AUDIT_OUTPUT_LIMIT");
  charge(context, "auditBytes", usage.bytes + framingBytes);
  return usage;
}

/**
 * Bound input/candidate snapshots before any transaction callback can commit.
 * The public projector can only remove fields, so the same candidate cap also
 * bounds the state portion of the public action response.
 */
export function assertMechanicsStateWithinBudget(
  value: unknown,
  limits: MechanicsRuntimeLimits,
  boundary: "input" | "candidate"
): JsonResourceUsage {
  return measureBoundedJson(value, {
    maxBytes: limits.maxCandidateStateBytes,
    maxDepth: limits.maxJsonDepth,
    maxNodes: limits.maxCandidateStateNodes,
    maxStringUtf8Bytes: limits.maxStringUtf8Bytes
  }, boundary === "input" ? "MECHANICS_INPUT_STATE_LIMIT" : "MECHANICS_CANDIDATE_STATE_LIMIT");
}

/** Direct executor callers receive the same parameter protection as HTTP. */
export function assertMechanicsParamsWithinBudget(
  value: unknown,
  limits: MechanicsRuntimeLimits
): JsonResourceUsage {
  return measureBoundedJson(value, {
    maxBytes: limits.maxInputParamsBytes,
    maxDepth: limits.maxJsonDepth,
    maxNodes: limits.maxInputParamNodes,
    maxStringUtf8Bytes: limits.maxStringUtf8Bytes
  }, "MECHANICS_INPUT_PARAMS_LIMIT");
}

function withAncestor<T extends object>(
  value: T,
  ancestors: Set<object>,
  code: string,
  visit: () => void
): void {
  if (ancestors.has(value)) resourceFailure(code, "cyclic JSON is not allowed");
  ancestors.add(value);
  try {
    visit();
  } finally {
    ancestors.delete(value);
  }
}

function isPlainJsonRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resourceFailure(code: string, message: string): never {
  throw new MechanicsExecutionError(code, message);
}
