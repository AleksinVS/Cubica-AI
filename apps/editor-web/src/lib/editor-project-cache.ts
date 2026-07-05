/**
 * Level-2 disk warm-start cache for the PROJECT-level editor entity projection
 * (ADR-057 §4.13 "Уровень 2 — проектные артефакты"; editor-preview-first-ux §10;
 * design-spec §2.6).
 *
 * WHAT THIS IS. The server-side half of the projection warm-start cache. It stores
 * one serialized `EditorEntityProjection` (ADR-052) per authoring document on disk
 * under `.tmp/editor-cache/projects/<key>.json`, keyed by a summary hash of every
 * input the projection depends on. On open, the file route ships the serialized
 * envelope to the client, which revives it and hydrates its first view model
 * instead of rebuilding the projection from scratch (~44 ms for a heavy game;
 * profiling baseline §9.8). The serialization/revival lives framework-agnostic in
 * editor-engine; this module is the Node-only disk layer and reuses the shared
 * atomic-write / swallow-read / cache-dir primitives from `editor-file-cache`
 * (no duplicated disk code).
 *
 * WHAT THE ARTIFACT IS BUILT OVER (and the key it implies).
 *   The editor's live client (`createEditorViewModel` in `editor-web-adapter`)
 *   builds the entity projection over the SINGLE authoring document it currently
 *   has open — the editor workspace never passes sibling documents. For the cache
 *   to stay TRANSPARENT (ADR-057 §5: a cache hit, a miss, and a from-scratch
 *   rebuild must be identical), this server-side artifact is therefore also built
 *   over exactly that one opened document, and the hydration substitutes it as-is.
 *   See {@link computeProjectionArtifactKey} for the precise key inputs and the
 *   documented gap against the full ADR-052 input list.
 *
 * INVARIANTS (ADR-057 §5, editor-preview-first-ux §10).
 *   - One-shot: never a source of truth, never an input to compilation/runtime.
 *   - Any mismatch / missing / corrupt file → SILENT miss and a normal rebuild.
 *   - Content-addressed, so the cache is independent of the Git worktree.
 *   - Files live only under `.tmp/` (outside Git); deleting any is safe, and the
 *     recursive `garbageCollectEditorCache` walk already sweeps `projects/` under
 *     the same total-size limit as the per-file entries.
 */
import { createHash } from "node:crypto";

import {
  PROJECTION_LENS_SET_VERSION,
  EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION,
  buildEditorEntityProjection,
  hashEditorText,
  serializeEditorEntityProjection,
  type SerializedEditorEntityProjectionEnvelope
} from "@cubica/editor-engine";

import {
  isEditorCacheEnabled,
  loadDocumentSnapshotWithCache,
  readCacheTextEntry,
  resolveEditorCacheDir,
  writeCacheTextEntryAtomic
} from "./editor-file-cache";

/**
 * Bumping this invalidates every previously written project-artifact entry. It is
 * mixed into the key alongside the engine's serialization format and lens-set
 * versions, so a change to this disk layout can never read back a stale file.
 */
export const PROJECT_ARTIFACT_CACHE_FORMAT_VERSION = 1;

/**
 * Level-2 hit/miss + duration telemetry for one projection load (design-spec §5),
 * mirroring the per-file and Level-3 compile telemetry shapes. `hitReadMs` is the
 * time to read+parse a cached envelope on a hit; `missBuildMs` is the time to
 * build the projection on a miss. (The client-side REVIVE cost is not visible to
 * the server and is measured separately if needed.)
 */
export interface EditorProjectionCacheTelemetry {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly hitReadMs: number;
  readonly missBuildMs: number;
}

export interface EditorProjectionCacheTelemetryRecorder {
  recordHit(ms: number): void;
  recordMiss(ms: number): void;
  snapshot(): EditorProjectionCacheTelemetry;
}

export function createEditorProjectionCacheTelemetry(): EditorProjectionCacheTelemetryRecorder {
  let cacheHits = 0;
  let cacheMisses = 0;
  let hitReadMs = 0;
  let missBuildMs = 0;
  const round = (ms: number): number => Math.round(ms * 1000) / 1000;

  return {
    recordHit(ms) {
      cacheHits += 1;
      hitReadMs += ms;
    },
    recordMiss(ms) {
      cacheMisses += 1;
      missBuildMs += ms;
    },
    snapshot() {
      return { cacheHits, cacheMisses, hitReadMs: round(hitReadMs), missBuildMs: round(missBuildMs) };
    }
  };
}

/**
 * Computes the project-artifact cache key.
 *
 * KEY INPUTS — the ACTUAL inputs of the projection builder today. An input NOT in
 * the key is a cache design error (ADR-057 §5 "любой вход проекции, не учтённый в
 * ключе, — ошибка"):
 *   - `PROJECT_ARTIFACT_CACHE_FORMAT_VERSION` — this module's disk layout;
 *   - `EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION` — the serialized envelope shape;
 *   - `PROJECTION_LENS_SET_VERSION` — the engine's lens set: a change to WHICH
 *     entities/facets/diagnostics the builder emits must invalidate the artifact;
 *   - `filePath` + the full document text — the only content the projection of a
 *     single opened document depends on.
 * SHA-256 content-addresses the artifact (collision-resistant), so two sessions or
 * branches with identical text share one entry.
 *
 * GAP AGAINST THE ADR-052 INPUT LIST (documented so a future input is added to the
 * key, invariant §10). ADR-052 §8 lists the FULL projection input set: the game
 * authoring manifest, ALL of a game's UI authoring manifests, JSON Schema
 * annotations, the field dictionary, manifest source maps, preview/renderer
 * metadata, and project-local plugin metadata. TODAY the builder
 * (`buildEditorEntityProjection`) reads ONLY the `documents[].json` it is handed
 * — and the editor workspace hands it a SINGLE opened document — so none of the
 * other listed inputs, and no sibling UI file, is a builder input yet; hashing
 * them would be over-keying an artifact that does not depend on them. WHEN the
 * client is upgraded to a true project-level (game + UI) projection, the sibling
 * UI document texts — and any of the schema/dictionary/source-map/design-artifact/
 * plugin-metadata inputs the builder then reads — MUST be added here, or the cache
 * would silently serve a stale projection.
 */
export function computeProjectionArtifactKey(filePath: string, text: string): string {
  return createHash("sha256")
    .update("editor-projection-artifact\n")
    .update(`${PROJECT_ARTIFACT_CACHE_FORMAT_VERSION}\n`)
    .update(`${EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION}\n`)
    .update(`${PROJECTION_LENS_SET_VERSION}\n`)
    .update(`${filePath}\n`)
    .update(text)
    .digest("hex");
}

/**
 * Returns the serialized projection envelope for `{ filePath, text }`, using the
 * disk cache: a hit reads+parses the stored envelope; a miss builds the projection
 * and schedules a DEFERRED, fire-and-forget write so the response is never blocked
 * and a write failure can never break the request.
 *
 * The projection is built over the single opened document with `gameId` left
 * undefined, matching the client's `createEditorViewModel` input exactly so the
 * hydrated projection is identical to a client rebuild. The envelope carries
 * `documentHashes` (`hashEditorText` per path) so the client can verify the
 * cached projection still matches the current text before substituting it.
 */
export async function loadProjectionEnvelopeWithCache(input: {
  readonly filePath: string;
  readonly text: string;
  readonly telemetry?: EditorProjectionCacheTelemetryRecorder;
  readonly cacheEnabled?: boolean;
}): Promise<SerializedEditorEntityProjectionEnvelope> {
  const buildEnvelope = async (): Promise<SerializedEditorEntityProjectionEnvelope> => {
    // Reuse the per-file snapshot cache for the parse (its own Level-2 entry).
    const snapshot = await loadDocumentSnapshotWithCache({
      filePath: input.filePath,
      text: input.text,
      cacheEnabled: input.cacheEnabled
    });
    const projection = buildEditorEntityProjection({
      documents: [{ filePath: snapshot.filePath, json: snapshot.json }]
    });
    return serializeEditorEntityProjection(projection, {
      documentHashes: { [snapshot.filePath]: hashEditorText(input.text) }
    });
  };

  if (!(input.cacheEnabled ?? isEditorCacheEnabled())) {
    return buildEnvelope();
  }

  const cacheDir = await resolveEditorCacheDir("projects");
  const key = computeProjectionArtifactKey(input.filePath, input.text);

  const readStart = performance.now();
  const cachedText = await readCacheTextEntry(cacheDir, key);
  if (cachedText !== null) {
    try {
      const parsed = JSON.parse(cachedText) as SerializedEditorEntityProjectionEnvelope;
      input.telemetry?.recordHit(performance.now() - readStart);
      return parsed;
    } catch {
      // Corrupt file → treat as a miss and rebuild (one-shot cache).
    }
  }

  const buildStart = performance.now();
  const envelope = await buildEnvelope();
  input.telemetry?.recordMiss(performance.now() - buildStart);

  // Deferred write: do not await, and swallow errors — the cache is one-shot.
  void writeCacheTextEntryAtomic(cacheDir, key, `${JSON.stringify(envelope)}\n`).catch(() => undefined);
  return envelope;
}
