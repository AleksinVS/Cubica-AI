/**
 * Cross-cutting "semantic entity" helpers for authoring JSON.
 *
 * Several projections (JSON tree, entity projection, graph, semantic
 * diagnostics, prototype extraction) need to agree on the same questions: is a
 * pointer inside `_definitions`, is one pointer an ancestor of another, does a
 * node count as a tree-visible semantic entity, and what human label should it
 * carry. Centralizing these predicates here keeps that agreement in one place
 * and avoids circular imports between the projection modules.
 */
import { compactTitle, isPlainJsonObject, titleFromToken } from "./shared.ts";
import { lastPointerSegmentOrRoot, parseJsonPointer } from "./json-pointer-patch.ts";
import type { JsonObject, JsonValue } from "./types.ts";

/** True when the pointer addresses something under the `_definitions` container. */
export function isDefinitionPointer(pointer: string): boolean {
  const segments = parseJsonPointer(pointer);
  return segments.length >= 2 && segments[0] === "_definitions";
}

/** True when `pointer` equals `ancestorPointer` or lies below it. */
export function isSameOrDescendantPointer(pointer: string, ancestorPointer: string): boolean {
  return ancestorPointer === "" || pointer === ancestorPointer || pointer.startsWith(`${ancestorPointer}/`);
}

/**
 * True when a node should appear as its own entity in the entity tree.
 *
 * The document root is always visible; definition templates never are; any
 * other object counts only when it declares a non-empty `_type` authoring
 * annotation. The `value is JsonObject` narrowing lets callers reuse the guard.
 */
export function isTreeVisibleSemanticEntity(value: JsonValue, pointer: string): value is JsonObject {
  if (!isPlainJsonObject(value) || isDefinitionPointer(pointer)) {
    return false;
  }

  if (pointer === "/root") {
    return true;
  }

  return typeof value._type === "string" && value._type.trim() !== "";
}

/** Resolves a human-facing label for an entity, preferring explicit fields. */
export function resolveEntityTreeLabel(value: JsonObject, pointer: string): string {
  for (const key of ["_label", "title", "name", "id"] as const) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return compactTitle(candidate);
    }
  }

  return pointer === "" ? "Entities" : titleFromToken(lastPointerSegmentOrRoot(pointer));
}
