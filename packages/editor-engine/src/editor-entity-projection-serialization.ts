/**
 * JSON-safe (de)serialization of an `EditorEntityProjection` for the Level-2 disk
 * warm-start cache of PROJECT artifacts (ADR-057 §4.13 "Уровень 2 — проектные
 * артефакты"; editor-preview-first-ux §10; design-spec §2.6).
 *
 * WHAT THIS IS. The editor entity projection (ADR-052) is an in-memory index
 * over authoring documents: entities + their source facets + cross-file
 * diagnostics, plus two DERIVED lookup Maps (`entityById`,
 * `entitiesBySourcePointer`). Rebuilding it on every editor open costs ~44 ms for
 * a heavy game (profiling baseline §9.8). To reuse it across loads it must survive
 * a round-trip through disk as plain JSON and then hydrate the client on open
 * (warm start). The only non-JSON parts are the two Maps, and both are a pure
 * function of `entities`, so serialization stores just the flat data
 * (entities/diagnostics/sourceHashes/gameId) and revival rebuilds the Maps with
 * {@link reindexEditorEntityProjection} — the exact helper the builder itself
 * uses, so a revived projection is byte-for-byte equal to a freshly built one.
 *
 * INVARIANTS (ADR-057 §5). This module is framework-agnostic and has NO Node.js
 * dependencies (no `node:*`, no filesystem): the disk I/O lives in the editor-web
 * server library, and the REVIVE runs in the browser during client hydration. The
 * cache is one-shot and NEVER a source of truth: `reviveEditorEntityProjection`
 * is STRICT — any format-version mismatch, lens-set-version mismatch, missing
 * field, or wrong-shaped payload returns `null`, which the caller treats as a
 * silent miss and rebuilds. Bumping {@link EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION}
 * — or the engine bumping `PROJECTION_LENS_SET_VERSION` — invalidates every
 * previously written entry, because an old-shaped file can never be read back.
 */
import { PROJECTION_LENS_SET_VERSION, reindexEditorEntityProjection } from "./entity-projection.ts";
import type {
  EditorEntityDocumentKind,
  EditorEntityFacetKind,
  EditorEntityKind,
  EditorEntity,
  EditorEntityProjection,
  EditorEntityProjectionDiagnostic,
  EditorEntityProjectionDiagnosticCode,
  EditorEntitySourcePointer
} from "./types.ts";

/**
 * Version of the serialized projection envelope. Bump this whenever the payload
 * shape changes in a way that makes previously cached files wrong. It is part of
 * every disk-cache key AND checked on revive, so a stale-shaped file is never
 * read.
 */
export const EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION = 1;

/**
 * JSON-safe body of a serialized projection. Mirrors `EditorEntityProjection`
 * WITHOUT its two derived Map indexes — those are rebuilt on revive from
 * `entities`, so storing them would only bloat the file and risk divergence.
 */
export interface SerializedEditorEntityProjection {
  readonly projectionVersion: 1;
  /** JSON has no `undefined`; an absent `gameId` is simply omitted. */
  readonly gameId?: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly entities: readonly EditorEntity[];
  readonly diagnostics: readonly EditorEntityProjectionDiagnostic[];
}

/** Versioned envelope written to disk / sent to the client; the versions guard a strict revive. */
export interface SerializedEditorEntityProjectionEnvelope {
  readonly formatVersion: number;
  /**
   * The engine's `PROJECTION_LENS_SET_VERSION` baked into the artifact. A change
   * to the lens set can change what entities/facets/diagnostics the builder emits,
   * so a mismatch here MUST invalidate the cached projection (ADR-057 §5: "любой
   * вход проекции, не учтённый в ключе, — ошибка"). It is both mixed into the disk
   * key and re-checked on revive.
   */
  readonly lensSetVersion: number;
  /** Optional editor-engine build identifier, informational only. */
  readonly engineVersion?: string;
  /**
   * Source-text hashes (`hashEditorText`) per document path, attached by the
   * disk-cache PRODUCER (editor-web server) so the CONSUMER (client hydration) can
   * verify the cached projection still matches the current document texts before
   * substituting it. `reviveEditorEntityProjection` ignores this field — it is a
   * consumer-side consistency aid, not part of the projection.
   */
  readonly documentHashes?: Readonly<Record<string, string>>;
  readonly payload: SerializedEditorEntityProjection;
}

/** Serializes a projection into a versioned, JSON-safe envelope. Pure and deterministic. */
export function serializeEditorEntityProjection(
  projection: EditorEntityProjection,
  options: {
    readonly engineVersion?: string;
    readonly documentHashes?: Readonly<Record<string, string>>;
  } = {}
): SerializedEditorEntityProjectionEnvelope {
  const payload: SerializedEditorEntityProjection = {
    projectionVersion: projection.projectionVersion,
    ...(projection.gameId !== undefined ? { gameId: projection.gameId } : {}),
    sourceHashes: projection.sourceHashes,
    entities: projection.entities,
    diagnostics: projection.diagnostics
  };

  return {
    formatVersion: EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
    lensSetVersion: PROJECTION_LENS_SET_VERSION,
    ...(options.engineVersion !== undefined ? { engineVersion: options.engineVersion } : {}),
    ...(options.documentHashes !== undefined ? { documentHashes: options.documentHashes } : {}),
    payload
  };
}

/**
 * Strictly revives a projection from an unknown parsed value.
 *
 * Returns `null` on ANY mismatch (wrong/absent format version, wrong lens-set
 * version, non-object, missing or wrong-typed payload fields). Returning `null` —
 * never throwing — is what keeps the cache one-shot: a foreign, older, or corrupt
 * file simply becomes a rebuild. On success the two Map indexes are reconstructed
 * from `entities` via {@link reindexEditorEntityProjection}.
 */
export function reviveEditorEntityProjection(value: unknown): EditorEntityProjection | null {
  // Keep the cache boundary fail-closed even if this function is handed a
  // foreign object rather than JSON.parse output. In particular, never call
  // reindex until every nested source pointer and diagnostic is known-good.
  try {
    if (!isSerializedEditorEntityProjectionEnvelope(value)) {
      return null;
    }

    return reindexEditorEntityProjection({
      projectionVersion: 1,
      gameId: getOwnOptional(value.payload, "gameId") as string | undefined,
      sourceHashes: value.payload.sourceHashes,
      entities: value.payload.entities,
      diagnostics: value.payload.diagnostics
    });
  } catch {
    // A cache entry is untrusted input. Any unexpected shape/accessor failure
    // remains a silent miss instead of escaping into editor hydration.
    return null;
  }
}

const editorEntityDocumentKinds: readonly EditorEntityDocumentKind[] = ["game", "ui", "design", "plugin", "unknown"];
const editorEntityKinds: readonly EditorEntityKind[] = [
  "game-root",
  "game-flow",
  "game-step",
  "game-action",
  "content-block",
  "state-model",
  "metric",
  "ui-root",
  "ui-screen",
  "ui-component",
  "design-artifact",
  "plugin-contribution",
  "unknown"
];
const editorEntityFacetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "state", "view", "design", "plugin"];
const editorEntityProjectionDiagnosticCodes: readonly EditorEntityProjectionDiagnosticCode[] = [
  "stale-source-hash",
  "unresolved-source-pointer",
  "unresolved-action-link",
  "unresolved-mechanics-plan",
  "unresolved-view-link",
  "ambiguous-view-link",
  "hidden-technical-field",
  "entity-view-orphan",
  "entity-missing-view"
];

function isSerializedEditorEntityProjectionEnvelope(
  value: unknown
): value is SerializedEditorEntityProjectionEnvelope {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["formatVersion", "lensSetVersion", "payload"], ["engineVersion", "documentHashes"]) ||
    value.formatVersion !== EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION ||
    value.lensSetVersion !== PROJECTION_LENS_SET_VERSION ||
    (getOwnOptional(value, "engineVersion") !== undefined && typeof getOwnOptional(value, "engineVersion") !== "string") ||
    (getOwnOptional(value, "documentHashes") !== undefined && !isStringMap(getOwnOptional(value, "documentHashes")))
  ) {
    return false;
  }

  const payload = value.payload;
  if (
    !isRecord(payload) ||
    !hasExactKeys(payload, ["projectionVersion", "sourceHashes", "entities", "diagnostics"], ["gameId"]) ||
    payload.projectionVersion !== 1 ||
    (getOwnOptional(payload, "gameId") !== undefined && typeof getOwnOptional(payload, "gameId") !== "string") ||
    !isStringMap(payload.sourceHashes) ||
    !Array.isArray(payload.entities) ||
    !payload.entities.every(isEditorEntity)
  ) {
    return false;
  }

  if (new Set(payload.entities.map((entity) => entity.entityId)).size !== payload.entities.length) {
    return false;
  }

  return Array.isArray(payload.diagnostics) && payload.diagnostics.every(isEditorEntityProjectionDiagnostic);
}

function isEditorEntity(value: unknown): value is EditorEntity {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["entityId", "kind", "label", "primarySource", "facets", "diagnostics"]) ||
    typeof value.entityId !== "string" ||
    !isEditorEntityKind(value.kind) ||
    typeof value.label !== "string" ||
    !isEditorEntitySourcePointer(value.primarySource) ||
    !isEditorEntityFacets(value.facets) ||
    !Array.isArray(value.diagnostics)
  ) {
    return false;
  }

  return value.diagnostics.every(isEditorEntityProjectionDiagnostic);
}

function isEditorEntityFacets(value: unknown): value is EditorEntity["facets"] {
  if (!isRecord(value) || !hasExactKeys(value, [], editorEntityFacetKinds)) {
    return false;
  }

  return Object.values(value).every((sources) => Array.isArray(sources) && sources.every(isEditorEntitySourcePointer));
}

function isEditorEntityProjectionDiagnostic(value: unknown): value is EditorEntityProjectionDiagnostic {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["severity", "code", "message", "source"], ["target"]) &&
    (value.severity === "error" || value.severity === "warning") &&
    isEditorEntityProjectionDiagnosticCode(value.code) &&
    typeof value.message === "string" &&
    isEditorEntitySourcePointer(value.source) &&
    (getOwnOptional(value, "target") === undefined || isEditorEntitySourcePointer(getOwnOptional(value, "target")))
  );
}

function isEditorEntitySourcePointer(value: unknown): value is EditorEntitySourcePointer {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["filePath", "pointer", "documentKind"], ["channel", "label", "role"]) &&
    typeof value.filePath === "string" &&
    typeof value.pointer === "string" &&
    isEditorEntityDocumentKind(value.documentKind) &&
    (getOwnOptional(value, "channel") === undefined || typeof getOwnOptional(value, "channel") === "string") &&
    (getOwnOptional(value, "label") === undefined || typeof getOwnOptional(value, "label") === "string") &&
    (getOwnOptional(value, "role") === undefined || typeof getOwnOptional(value, "role") === "string")
  );
}

function isStringMap(value: unknown): value is Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    return false;
  }

  for (const key in value) {
    if (!hasOwn(value, key)) {
      return false;
    }
  }
  return Object.values(value).every((candidate) => typeof candidate === "string");
}

function isEditorEntityDocumentKind(value: unknown): value is EditorEntityDocumentKind {
  return typeof value === "string" && editorEntityDocumentKinds.includes(value as EditorEntityDocumentKind);
}

function isEditorEntityKind(value: unknown): value is EditorEntityKind {
  return typeof value === "string" && editorEntityKinds.includes(value as EditorEntityKind);
}

function isEditorEntityProjectionDiagnosticCode(value: unknown): value is EditorEntityProjectionDiagnosticCode {
  return (
    typeof value === "string" &&
    editorEntityProjectionDiagnosticCodes.includes(value as EditorEntityProjectionDiagnosticCode)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => hasOwn(value, key)) &&
    optional.every((key) => !(key in value) || hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function getOwnOptional(value: object, key: string): unknown {
  return hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}
