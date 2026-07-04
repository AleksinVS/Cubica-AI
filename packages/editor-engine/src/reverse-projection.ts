/**
 * Reverse projection: UI-neutral edit intents back into JSON Patch.
 *
 * The editor UI expresses edits as high-level intents ("set value", "move
 * node", "connect reference", ...). This module converts each intent into safe
 * JSON Patch operations, or returns a diagnostic instead of inventing missing
 * containers or rewriting unrelated authoring data. `moveNode` intentionally
 * targets a layout sidecar so graph-layout gestures can never mutate authoring
 * JSON.
 */
import { isArrayIndex, isPlainJsonObject, makeDiagnostic } from "./shared.ts";
import {
  appendPointerSegment,
  buildJsonPointer,
  lastPointerSegment,
  localReferenceToPointer,
  parentPointer,
  pointerToLocalReference,
  readJsonPointer,
  readParentValue
} from "./json-pointer-patch.ts";
import type { DocumentSnapshot, JsonValue, ReverseProjectIntent, ReverseProjectResult } from "./types.ts";

/**
 * Converts UI-neutral edit intent back into JSON Patch.
 *
 * Unsafe operations return diagnostics instead of inventing missing containers
 * or rewriting unrelated authoring data. `moveNode` intentionally edits only a
 * layout sidecar target so graph layout gestures cannot mutate authoring JSON.
 */
export function reverseProjectIntent(
  snapshot: DocumentSnapshot,
  intent: ReverseProjectIntent
): ReverseProjectResult {
  if (snapshot.json === undefined) {
    return rejectReverseProjection(snapshot, "", "Cannot edit a document with invalid JSON.");
  }

  switch (intent.type) {
    case "setValue":
      return reverseSetValue(snapshot, intent.pointer, intent.value);
    case "moveNode":
      return reverseMoveNode(snapshot, intent.pointer, intent.position);
    case "addCollectionItem":
      return reverseAddCollectionItem(snapshot, intent);
    case "removeCollectionItem":
      return reverseRemoveCollectionItem(snapshot, intent.itemPointer);
    case "connectReference":
      return reverseConnectReference(snapshot, intent.referencePointer, intent.targetPointer);
    case "disconnectReference":
      return reverseDisconnectReference(snapshot, intent.referencePointer, intent.expectedTargetPointer);
  }
}

function reverseSetValue(snapshot: DocumentSnapshot, pointer: string, value: JsonValue): ReverseProjectResult {
  if (pointer === "") {
    return { target: "authoring", operations: [{ op: "replace", path: "", value }] };
  }

  const parent = readParentValue(snapshot.json as JsonValue, pointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, pointer, `Cannot set value because the parent path does not exist.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, pointer);
  const key = lastPointerSegment(pointer);

  if (Array.isArray(parent)) {
    if (current === undefined || !isArrayIndex(key)) {
      return rejectReverseProjection(snapshot, pointer, `Cannot set value because the array item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "replace", path: pointer, value }] };
  }

  if (isPlainJsonObject(parent)) {
    return {
      target: "authoring",
      operations: [{ op: current === undefined ? "add" : "replace", path: pointer, value }]
    };
  }

  return rejectReverseProjection(snapshot, pointer, `Cannot set value below a primitive parent.`);
}

function reverseMoveNode(
  snapshot: DocumentSnapshot,
  pointer: string,
  position: { readonly x: number; readonly y: number }
): ReverseProjectResult {
  if (readJsonPointer(snapshot.json as JsonValue, pointer) === undefined) {
    return rejectReverseProjection(snapshot, pointer, `Cannot move a node that does not exist.`);
  }

  const layoutPointer = buildJsonPointer(["nodes", pointer, "position"]);

  return {
    target: "layout",
    operations: [
      {
        op: "add",
        path: layoutPointer,
        value: { x: position.x, y: position.y }
      }
    ]
  };
}

function reverseAddCollectionItem(
  snapshot: DocumentSnapshot,
  intent: Extract<ReverseProjectIntent, { readonly type: "addCollectionItem" }>
): ReverseProjectResult {
  const collection = readJsonPointer(snapshot.json as JsonValue, intent.collectionPointer);
  if (collection === undefined) {
    return rejectReverseProjection(snapshot, intent.collectionPointer, `Cannot add item because collection is missing.`);
  }

  if (Array.isArray(collection)) {
    if (intent.key !== undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Array collection items cannot use object keys.`);
    }

    const index = intent.index ?? "end";
    if (index === "end") {
      return {
        target: "authoring",
        operations: [{ op: "add", path: appendPointerSegment(intent.collectionPointer, "-"), value: intent.value }]
      };
    }

    if (!Number.isInteger(index) || index < 0 || index > collection.length) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Array insertion index is out of range.`);
    }

    return {
      target: "authoring",
      operations: [
        {
          op: "add",
          path: appendPointerSegment(intent.collectionPointer, String(index)),
          value: intent.value
        }
      ]
    };
  }

  if (isPlainJsonObject(collection)) {
    if (intent.index !== undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Object collection items cannot use indexes.`);
    }

    if (intent.key === undefined) {
      return rejectReverseProjection(snapshot, intent.collectionPointer, `Object collection insert requires a key.`);
    }

    if (Object.hasOwn(collection, intent.key)) {
      return rejectReverseProjection(snapshot, appendPointerSegment(intent.collectionPointer, intent.key), `Collection key already exists.`);
    }

    return {
      target: "authoring",
      operations: [
        {
          op: "add",
          path: appendPointerSegment(intent.collectionPointer, intent.key),
          value: intent.value
        }
      ]
    };
  }

  return rejectReverseProjection(snapshot, intent.collectionPointer, `Cannot add item to a primitive value.`);
}

function reverseRemoveCollectionItem(snapshot: DocumentSnapshot, itemPointer: string): ReverseProjectResult {
  if (itemPointer === "") {
    return rejectReverseProjection(snapshot, itemPointer, `Removing the document root is not a safe collection edit.`);
  }

  const parent = readParentValue(snapshot.json as JsonValue, itemPointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, itemPointer, `Cannot remove item because the parent path does not exist.`);
  }

  const key = lastPointerSegment(itemPointer);
  if (Array.isArray(parent)) {
    if (!isArrayIndex(key) || Number(key) >= parent.length) {
      return rejectReverseProjection(snapshot, itemPointer, `Array item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "remove", path: itemPointer }] };
  }

  if (isPlainJsonObject(parent)) {
    if (!Object.hasOwn(parent, key)) {
      return rejectReverseProjection(snapshot, itemPointer, `Object item does not exist.`);
    }

    return { target: "authoring", operations: [{ op: "remove", path: itemPointer }] };
  }

  return rejectReverseProjection(snapshot, itemPointer, `Cannot remove an item below a primitive parent.`);
}

function reverseConnectReference(
  snapshot: DocumentSnapshot,
  referencePointer: string,
  targetPointer: string
): ReverseProjectResult {
  if (readJsonPointer(snapshot.json as JsonValue, targetPointer) === undefined) {
    return rejectReverseProjection(snapshot, targetPointer, `Cannot connect reference to a missing target.`);
  }

  const parent = readParentValue(snapshot.json as JsonValue, referencePointer);
  if (parent === undefined) {
    return rejectReverseProjection(snapshot, referencePointer, `Cannot connect reference because the field parent is missing.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, referencePointer);
  if (current !== undefined && current !== null && typeof current !== "string") {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field must be a string or null before connecting.`);
  }

  const refValue = pointerToLocalReference(targetPointer);
  if (current === refValue) {
    return { target: "authoring", operations: [] };
  }

  if (current === undefined && !isPlainJsonObject(parent)) {
    return rejectReverseProjection(snapshot, referencePointer, `Missing reference fields can only be added to objects.`);
  }

  return {
    target: "authoring",
    operations: [{ op: current === undefined ? "add" : "replace", path: referencePointer, value: refValue }]
  };
}

function reverseDisconnectReference(
  snapshot: DocumentSnapshot,
  referencePointer: string,
  expectedTargetPointer: string | undefined
): ReverseProjectResult {
  const parent = readParentValue(snapshot.json as JsonValue, referencePointer);
  if (!isPlainJsonObject(parent)) {
    return rejectReverseProjection(snapshot, referencePointer, `Reference fields can only be disconnected from objects.`);
  }

  const current = readJsonPointer(snapshot.json as JsonValue, referencePointer);
  if (typeof current !== "string") {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field is not a string.`);
  }

  const currentTargetPointer = localReferenceToPointer(current);
  if (currentTargetPointer === undefined) {
    return rejectReverseProjection(snapshot, referencePointer, `Only local reference fields can be disconnected safely.`);
  }

  if (expectedTargetPointer !== undefined && currentTargetPointer !== expectedTargetPointer) {
    return rejectReverseProjection(snapshot, referencePointer, `Reference field points to a different target.`);
  }

  return { target: "authoring", operations: [{ op: "remove", path: referencePointer }] };
}

function rejectReverseProjection(snapshot: DocumentSnapshot, pointer: string, message: string): ReverseProjectResult {
  return {
    target: "rejected",
    operations: [],
    diagnostics: [
      makeDiagnostic({
        source: "reverse-projection",
        pointer,
        message,
        range: snapshot.locationMap.get(pointer) ?? snapshot.locationMap.get(parentPointer(pointer) ?? "")
      })
    ]
  };
}
