/**
 * Small, dependency-free helpers shared across editor-engine modules.
 *
 * This module deliberately contains only leaf utilities: JSON value predicates,
 * structural equality/clone, token/title formatting, a diagnostic factory, and a
 * text hash. Keeping them here (and importing them where needed) avoids
 * duplicating the same helper in several modules and prevents circular imports,
 * because nothing here imports any other editor-engine module except the pure
 * type contracts.
 *
 * `isPlainJsonObject` is the single canonical implementation for the whole
 * package (LEGACY-0018): it is exported so editor-web and other modules reuse it
 * instead of re-declaring their own copies.
 */
import type {
  AuthoringGraphNode,
  DiagnosticSeverity,
  DiagnosticSource,
  DocumentDiagnostic,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  TextRange
} from "./types.ts";

/** Narrows a JSON value to a plain object (not an array, not null). */
export function isPlainJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows a JSON value to a non-null scalar (string, number, or boolean). */
export function isScalar(value: JsonValue | undefined): value is Exclude<JsonPrimitive, null> {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Returns true when a pointer segment is a canonical, non-negative array index. */
export function isArrayIndex(segment: string): boolean {
  return /^(0|[1-9]\d*)$/u.test(segment);
}

/** Deep-clones a JSON value via JSON round-trip (all editor values are JSON-safe). */
export function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Structural deep equality for JSON values, order-insensitive for object keys. */
export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((item, index) => jsonValuesEqual(item, right[index] as JsonValue));
  }

  if (isPlainJsonObject(left) || isPlainJsonObject(right)) {
    if (!isPlainJsonObject(left) || !isPlainJsonObject(right)) {
      return false;
    }

    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
      return false;
    }

    return leftKeys.every((key) => jsonValuesEqual(left[key] as JsonValue, right[key] as JsonValue));
  }

  return false;
}

/**
 * Normalizes a raw token into lowercase space-separated words.
 *
 * Splits camelCase, replaces punctuation with spaces, and lowercases so that
 * heuristic matching is stable across `screenId`, `screen-id`, `Screen Id`.
 */
export function normalizeToken(value: string | undefined): string {
  return (value ?? "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Turns a raw key/token into a Title Cased human-facing label. */
export function titleFromToken(value: string): string {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[_-]+/gu, " ")
    .trim();

  if (normalized === "") {
    return value;
  }

  return normalized
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Trims a title and caps it at 72 characters for compact display. */
export function compactTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 72) {
    return trimmed;
  }

  return `${trimmed.slice(0, 69)}...`;
}

/** Collapses whitespace and caps a summary string at 140 characters. */
export function compactSummary(value: string): string {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  if (trimmed.length <= 140) {
    return trimmed;
  }

  return `${trimmed.slice(0, 137)}...`;
}

/** Returns the last dotted segment of a `_type` value, e.g. `a.b.c` -> `c`. */
export function shortTypeName(value: string): string {
  const parts = value.split(".");
  return parts[parts.length - 1] ?? value;
}

/** Truncates a string to `maxLength`, appending an ellipsis when it overflows. */
export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** Maps a JSON value to the graph/tree value-type discriminator. */
export function getJsonValueType(value: JsonValue): AuthoringGraphNode["valueType"] {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value as AuthoringGraphNode["valueType"];
}

/** Builds a normalized document diagnostic, defaulting severity to `error`. */
export function makeDiagnostic(input: {
  readonly severity?: DiagnosticSeverity;
  readonly source: DiagnosticSource;
  readonly pointer: string;
  readonly message: string;
  /** Optional stable registry code (design-spec §4), e.g. `fixture-stale`. */
  readonly code?: string;
  readonly range?: TextRange;
}): DocumentDiagnostic {
  return {
    severity: input.severity ?? "error",
    source: input.source,
    pointer: input.pointer,
    message: input.message,
    code: input.code,
    range: input.range,
    line: input.range?.start.line,
    column: input.range?.start.column
  };
}

/**
 * Small deterministic text hash for session journals.
 *
 * This is not a security primitive; it only lets the editor check that undo is
 * being applied to the text state the journal step expects.
 */
export function hashEditorText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}
