/**
 * JSON Pointer (RFC 6901) parsing/formatting and JSON Patch (RFC 6902) apply,
 * plus inverse-operation generation for undo.
 *
 * Every authoring edit in the editor engine ultimately becomes a JSON Patch
 * against a plain JSON document, so this module is the low-level write path that
 * higher-level projections and the document store build on. All operations are
 * pure: they never mutate their inputs and return new values instead.
 */
import {
  cloneJsonValue,
  isArrayIndex,
  isPlainJsonObject,
  jsonValuesEqual,
  truncate
} from "./shared.ts";
import type {
  ApplyJsonPatchWithInverseResult,
  EditorDiffSummaryItem,
  JsonObject,
  JsonPatchOperation,
  JsonValue
} from "./types.ts";

/** Encodes one JSON Pointer segment according to RFC 6901 escaping rules. */
export function encodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** Decodes one JSON Pointer segment and rejects malformed escape sequences. */
export function decodeJsonPointerSegment(segment: string): string {
  if (/~(?![01])/u.test(segment)) {
    throw new Error(`Invalid JSON Pointer escape in segment: ${segment}`);
  }

  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Splits a JSON Pointer into decoded path segments. The empty pointer is root. */
export function parseJsonPointer(pointer: string): string[] {
  if (pointer === "") {
    return [];
  }

  if (!pointer.startsWith("/")) {
    throw new Error(`JSON Pointer must be empty or start with "/": ${pointer}`);
  }

  return pointer.slice(1).split("/").map(decodeJsonPointerSegment);
}

/** Builds a JSON Pointer from raw path segments. */
export function buildJsonPointer(segments: readonly string[]): string {
  if (segments.length === 0) {
    return "";
  }

  return `/${segments.map(encodeJsonPointerSegment).join("/")}`;
}

/**
 * Reads a value by JSON Pointer.
 *
 * Missing object keys, out-of-range array indexes, and invalid array tokens
 * return undefined instead of throwing so inspectors can probe optional paths.
 */
export function readJsonPointer(root: JsonValue, pointer: string): JsonValue | undefined {
  let current: JsonValue | undefined = root;

  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!isArrayIndex(segment)) {
        return undefined;
      }

      current = current[Number(segment)];
      continue;
    }

    if (isPlainJsonObject(current)) {
      current = current[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

/** Appends one raw segment to a pointer, re-encoding as needed. */
export function appendPointerSegment(pointer: string, segment: string): string {
  return buildJsonPointer([...parseJsonPointer(pointer), segment]);
}

/** Returns the last decoded segment; throws for the root pointer. */
export function lastPointerSegment(pointer: string): string {
  const segments = parseJsonPointer(pointer);
  const last = segments.at(-1);
  if (last === undefined) {
    throw new Error("Root pointer does not have a last segment.");
  }

  return last;
}

/** Returns the last decoded segment, or `/` for the root pointer. */
export function lastPointerSegmentOrRoot(pointer: string): string {
  if (pointer === "") {
    return "/";
  }

  const segments = parseJsonPointer(pointer);
  return segments[segments.length - 1] ?? "/";
}

/** Returns the parent pointer, or undefined for the root pointer. */
export function parentPointer(pointer: string): string | undefined {
  const segments = parseJsonPointer(pointer);
  if (segments.length === 0) {
    return undefined;
  }

  return buildJsonPointer(segments.slice(0, -1));
}

/** Reads the value at the parent of `pointer`, or undefined if unavailable. */
export function readParentValue(root: JsonValue, pointer: string): JsonValue | undefined {
  const parent = parentPointer(pointer);
  return parent === undefined ? undefined : readJsonPointer(root, parent);
}

/** Encodes a JSON Pointer as a local `#`-prefixed JSON reference string. */
export function pointerToLocalReference(pointer: string): string {
  parseJsonPointer(pointer);
  return pointer === "" ? "#" : `#${pointer}`;
}

/** Decodes a local `#`-prefixed reference back into a JSON Pointer, if valid. */
export function localReferenceToPointer(ref: string): string | undefined {
  if (ref === "#") {
    return "";
  }

  if (!ref.startsWith("#/")) {
    return undefined;
  }

  try {
    return decodeURI(ref.slice(1));
  } catch {
    return ref.slice(1);
  }
}

/** Returns true when the full pointer path exists in the document. */
export function jsonPointerExists(root: JsonValue, pointer: string): boolean {
  let current: JsonValue | undefined = root;
  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!isArrayIndex(segment) || Number(segment) >= current.length) {
        return false;
      }

      current = current[Number(segment)];
      continue;
    }

    if (isPlainJsonObject(current)) {
      if (!Object.hasOwn(current, segment)) {
        return false;
      }

      current = current[segment];
      continue;
    }

    return false;
  }

  return true;
}

/** Chooses an empty array or object when auto-creating a missing container. */
function buildMissingContainer(remainingSegments: readonly string[]): JsonValue {
  const next = remainingSegments[0];
  return next !== undefined && (next === "-" || isArrayIndex(next)) ? [] : {};
}

/** Applies add, replace, remove, and test JSON Patch operations without mutating input. */
export function applyJsonPatch(root: JsonValue, operations: readonly JsonPatchOperation[]): JsonValue {
  return operations.reduce<JsonValue>((current, operation) => applySinglePatch(current, operation), root);
}

/**
 * Applies a JSON Patch sequence and returns inverse operations for undo.
 *
 * The helper is stricter than the low-level patch applier: it validates every
 * operation against the current intermediate document and supports `test`
 * guards so AI-generated patches cannot silently apply to stale data.
 */
export function applyJsonPatchWithInverse(
  root: JsonValue,
  operations: readonly JsonPatchOperation[]
): ApplyJsonPatchWithInverseResult {
  let current = root;
  const inverseOperations: JsonPatchOperation[] = [];
  const diffSummary: Omit<EditorDiffSummaryItem, "filePath">[] = [];

  for (const operation of operations) {
    assertJsonPatchOperationCanApply(current, operation);

    if (operation.op === "test") {
      current = applySinglePatch(current, operation);
      continue;
    }

    const actualPath = actualMutationPath(current, operation);
    const existedBefore = jsonPointerExists(current, actualPath);
    const before = existedBefore ? cloneJsonValue(readJsonPointer(current, actualPath) as JsonValue) : undefined;
    // WHY: an `add` whose parent is an array has INSERTION semantics — it shifts
    // every existing element from the target index onward one slot to the right
    // (see `applyToArrayParent`, which uses `splice(index, 0, value)`). That is
    // fundamentally different from an object-member `add`, which overwrites a key
    // in place. The array-vs-object distinction must be evaluated against the
    // PRE-mutation parent (before `applySinglePatch` runs below), because after
    // the insertion the shifted element no longer sits at the target index.
    // This flag also covers the append token `-` (parent is still the array).
    const targetsArrayInsertion =
      operation.op === "add" && Array.isArray(readParentValue(current, operation.path));
    current = applySinglePatch(current, operation);
    const existsAfter = jsonPointerExists(current, actualPath);
    const after = existsAfter ? cloneJsonValue(readJsonPointer(current, actualPath) as JsonValue) : undefined;

    inverseOperations.unshift(
      inverseOperationForMutation(operation, actualPath, existedBefore, before, targetsArrayInsertion)
    );
    diffSummary.push({
      pointer: actualPath,
      operation: operation.op,
      before,
      after,
      description: describePatchOperation(operation.op, actualPath, before, after)
    });
  }

  return {
    value: current,
    inverseOperations,
    diffSummary
  };
}

function applySinglePatch(root: JsonValue, operation: JsonPatchOperation): JsonValue {
  const segments = parseJsonPointer(operation.path);

  if (segments.length === 0) {
    if (operation.op === "test") {
      assertJsonValuesEqual(root, operation.value, operation.path);
      return root;
    }

    if (operation.op === "remove") {
      throw new Error("Removing the document root is not supported by editor-engine.");
    }

    return operation.value;
  }

  const parentSegments = segments.slice(0, -1);
  const key = segments[segments.length - 1];

  if (key === undefined) {
    throw new Error(`Invalid JSON Patch path: ${operation.path}`);
  }

  return updateAtPath(root, parentSegments, (parent) => applyToParent(parent, key, operation));
}

function updateAtPath(
  value: JsonValue,
  segments: readonly string[],
  update: (target: JsonValue) => JsonValue
): JsonValue {
  if (segments.length === 0) {
    return update(value);
  }

  const [head, ...tail] = segments;

  if (head === undefined) {
    return update(value);
  }

  if (Array.isArray(value)) {
    if (!isArrayIndex(head) || Number(head) >= value.length) {
      throw new Error(`JSON Patch path does not exist: ${buildJsonPointer(segments)}`);
    }

    const index = Number(head);
    const copy = [...value];
    copy[index] = updateAtPath(copy[index] as JsonValue, tail, update);
    return copy;
  }

  if (isPlainJsonObject(value)) {
    if (!Object.hasOwn(value, head)) {
      const nextChild = buildMissingContainer(tail);
      return {
        ...value,
        [head]: updateAtPath(nextChild, tail, update)
      };
    }

    return {
      ...value,
      [head]: updateAtPath(value[head] as JsonValue, tail, update)
    };
  }

  throw new Error(`JSON Patch path crosses a primitive value: ${buildJsonPointer(segments)}`);
}

function applyToParent(parent: JsonValue, key: string, operation: JsonPatchOperation): JsonValue {
  if (Array.isArray(parent)) {
    return applyToArrayParent(parent, key, operation);
  }

  if (isPlainJsonObject(parent)) {
    return applyToObjectParent(parent, key, operation);
  }

  throw new Error(`JSON Patch target parent is not a container: ${operation.path}`);
}

function applyToArrayParent(parent: readonly JsonValue[], key: string, operation: JsonPatchOperation): JsonValue {
  const copy = [...parent];

  if (operation.op === "add") {
    const index = key === "-" ? copy.length : Number(key);
    if (!Number.isInteger(index) || index < 0 || index > copy.length) {
      throw new Error(`Invalid array add index: ${key}`);
    }

    copy.splice(index, 0, operation.value);
    return copy;
  }

  if (!isArrayIndex(key) || Number(key) >= copy.length) {
    throw new Error(`Array path does not exist: ${key}`);
  }

  const index = Number(key);
  if (operation.op === "test") {
    assertJsonValuesEqual(copy[index] as JsonValue, operation.value, operation.path);
    return parent;
  }

  if (operation.op === "replace") {
    copy[index] = operation.value;
    return copy;
  }

  copy.splice(index, 1);
  return copy;
}

function applyToObjectParent(parent: JsonObject, key: string, operation: JsonPatchOperation): JsonValue {
  if (operation.op === "add") {
    return { ...parent, [key]: operation.value };
  }

  if (!Object.hasOwn(parent, key)) {
    throw new Error(`Object path does not exist: ${key}`);
  }

  if (operation.op === "test") {
    assertJsonValuesEqual(parent[key] as JsonValue, operation.value, operation.path);
    return parent;
  }

  if (operation.op === "replace") {
    return { ...parent, [key]: operation.value };
  }

  const { [key]: _removed, ...rest } = parent;
  return rest;
}

function assertJsonPatchOperationCanApply(root: JsonValue, operation: JsonPatchOperation): void {
  const segments = parseJsonPointer(operation.path);
  if (segments.length === 0) {
    if (operation.op === "remove") {
      throw new Error("Removing the document root is not supported by editor-engine.");
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(root, operation.value, operation.path);
    }

    return;
  }

  const parent = readParentValue(root, operation.path);
  if (parent === undefined) {
    throw new Error(`JSON Patch parent path does not exist: ${parentPointer(operation.path) ?? "/"}`);
  }

  const key = lastPointerSegment(operation.path);
  if (Array.isArray(parent)) {
    if (operation.op === "add") {
      if (key === "-") {
        return;
      }

      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) {
        throw new Error(`Invalid array add index: ${key}`);
      }

      return;
    }

    if (!isArrayIndex(key) || Number(key) >= parent.length) {
      throw new Error(`Array path does not exist: ${key}`);
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(parent[Number(key)] as JsonValue, operation.value, operation.path);
    }

    return;
  }

  if (isPlainJsonObject(parent)) {
    if (operation.op === "add") {
      return;
    }

    if (!Object.hasOwn(parent, key)) {
      throw new Error(`Object path does not exist: ${key}`);
    }

    if (operation.op === "test") {
      assertJsonValuesEqual(parent[key] as JsonValue, operation.value, operation.path);
    }

    return;
  }

  throw new Error(`JSON Patch target parent is not a container: ${operation.path}`);
}

function actualMutationPath(root: JsonValue, operation: Exclude<JsonPatchOperation, { readonly op: "test" }>): string {
  if (operation.op === "add" && operation.path !== "") {
    const key = lastPointerSegment(operation.path);
    if (key === "-") {
      const parent = readParentValue(root, operation.path);
      if (Array.isArray(parent)) {
        return appendPointerSegment(parentPointer(operation.path) ?? "", String(parent.length));
      }
    }
  }

  return operation.path;
}

function inverseOperationForMutation(
  operation: Exclude<JsonPatchOperation, { readonly op: "test" }>,
  actualPath: string,
  existedBefore: boolean,
  before: JsonValue | undefined,
  // True when this `add` targets a position inside an array (numeric index or
  // the `-` append token), evaluated against the pre-mutation document.
  targetsArrayInsertion: boolean
): JsonPatchOperation {
  if (operation.op === "add") {
    // WHY: array `add` is an INSERTION that shifts existing elements right, so it
    // never overwrites a value — even when `existedBefore` is true, that element
    // is still present (just moved to index+1). Undoing it therefore always means
    // removing the freshly inserted slot; a `replace` here would clobber the
    // shifted-along element and leave a duplicate (e.g. ["a","b","c"] + add
    // /arr/1="X" -> ["a","X","b","c"]; a bad `replace /arr/1` would yield
    // ["a","b","b","c"] instead of restoring ["a","b","c"]).
    if (targetsArrayInsertion) {
      return { op: "remove", path: actualPath };
    }

    // Object-member `add` keeps overwrite semantics: restore the prior value if
    // the key already existed, otherwise remove the newly added key.
    return existedBefore && before !== undefined
      ? { op: "replace", path: actualPath, value: before }
      : { op: "remove", path: actualPath };
  }

  if (operation.op === "replace") {
    if (before === undefined) {
      throw new Error(`Cannot build inverse replace without previous value: ${actualPath}`);
    }

    return { op: "replace", path: actualPath, value: before };
  }

  if (before === undefined) {
    throw new Error(`Cannot build inverse remove without previous value: ${actualPath}`);
  }

  return { op: "add", path: actualPath, value: before };
}

function assertJsonValuesEqual(left: JsonValue, right: JsonValue, pointer: string): void {
  if (!jsonValuesEqual(left, right)) {
    throw new Error(`JSON Patch test failed at ${pointer || "/"}.`);
  }
}

function describePatchOperation(
  operation: Exclude<JsonPatchOperation["op"], "test">,
  pointer: string,
  before: JsonValue | undefined,
  after: JsonValue | undefined
): string {
  const target = pointer || "/";
  if (operation === "add") {
    return `Added ${previewDiffValue(after)} at ${target}`;
  }

  if (operation === "remove") {
    return `Removed ${previewDiffValue(before)} from ${target}`;
  }

  return `Changed ${target} from ${previewDiffValue(before)} to ${previewDiffValue(after)}`;
}

function previewDiffValue(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "missing value";
  }

  if (typeof value === "string") {
    return JSON.stringify(truncate(value, 80));
  }

  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }

  if (isPlainJsonObject(value)) {
    return `{${Object.keys(value).length} keys}`;
  }

  return String(value);
}
