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
 *   now builds the entity projection over the PROJECT — the game authoring
 *   document plus every UI-channel authoring document of the game (ADR-057 §4.1
 *   "целостная сущность"; §7 "экраны активного канала"). So this server-side
 *   artifact is built over exactly that same set of documents, with the same
 *   ACTIVE CHANNEL the client derives from the opened UI document, and the
 *   hydration substitutes it as-is. For the cache to stay TRANSPARENT (ADR-057 §5:
 *   a cache hit, a miss, and a from-scratch rebuild must be identical), the key
 *   therefore hashes EVERY document (path + full text) and the active channel; see
 *   {@link computeProjectionArtifactKey}.
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
 *
 * Version history:
 *   - v1: single-document key (one `filePath` + `text`).
 *   - v2: PROJECT key — hashes every projection document (game + all UI channels)
 *     and the active channel (ADR-057 §5, Phase 3.a, closing Phase 2.2b follow-up
 *     B). Old single-doc entries can never be read back under the new key.
 */
export const PROJECT_ARTIFACT_CACHE_FORMAT_VERSION = 2;

/**
 * One authoring document that participates in the project-level entity projection:
 * its repository-relative path and its full current text. The disk layer parses
 * the text (through the per-file snapshot cache) into the projection input.
 */
export interface ProjectionCacheDocument {
  readonly filePath: string;
  readonly text: string;
}

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
 * Computes the project-artifact cache key over ALL projection inputs.
 *
 * KEY INPUTS — the ACTUAL inputs of the project-level projection builder. An input
 * NOT in the key is a cache design error (ADR-057 §5 / editor-preview-first-ux §10
 * "любой вход проекции, не учтённый в ключе, — ошибка"):
 *   - `PROJECT_ARTIFACT_CACHE_FORMAT_VERSION` — this module's disk layout;
 *   - `EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION` — the serialized envelope shape;
 *   - `PROJECTION_LENS_SET_VERSION` — the engine's lens set: a change to WHICH
 *     entities/facets/diagnostics the builder emits must invalidate the artifact;
 *   - EVERY projection document (game authoring + each UI-channel authoring),
 *     as `filePath` + full text, sorted by path so document ORDER never changes
 *     the key (the builder's output is order-independent);
 *   - `activeChannel` — a projection input in its own right: it selects which
 *     channel the `entity-missing-view` diagnostic is evaluated against, so two
 *     opens of the same document set under different active channels are DIFFERENT
 *     artifacts and must not collide.
 * SHA-256 content-addresses the artifact (collision-resistant), so two sessions or
 * branches with identical inputs share one entry.
 *
 * REMAINING GAP AGAINST THE ADR-052 INPUT LIST (documented, invariant §10). The
 * game + all UI authoring documents — the follow-up B gap of Phase 2.2b — are now
 * IN the key. ADR-052 §8 also lists JSON Schema annotations, the field dictionary,
 * manifest source maps, preview/renderer metadata, and project-local plugin
 * metadata. `buildEditorEntityProjection` still reads none of those (only
 * `documents[].json` and `activeChannel`), so hashing them would over-key an
 * artifact that does not depend on them. WHEN the builder starts reading any of
 * them, that input MUST be added here, or the cache would serve a stale projection.
 */
export function computeProjectionArtifactKey(
  documents: readonly ProjectionCacheDocument[],
  activeChannel: string | undefined
): string {
  const hash = createHash("sha256")
    .update("editor-projection-artifact\n")
    .update(`${PROJECT_ARTIFACT_CACHE_FORMAT_VERSION}\n`)
    .update(`${EDITOR_ENTITY_PROJECTION_CACHE_FORMAT_VERSION}\n`)
    .update(`${PROJECTION_LENS_SET_VERSION}\n`)
    .update(`activeChannel:${activeChannel ?? ""}\n`)
    .update(`documentCount:${documents.length}\n`);
  for (const document of [...documents].sort((left, right) => left.filePath.localeCompare(right.filePath))) {
    // Length-prefix path and text so no path/text boundary is ambiguous.
    hash.update(`path:${document.filePath.length}:${document.filePath}\n`);
    hash.update(`text:${document.text.length}:`).update(document.text).update("\n");
  }
  return hash.digest("hex");
}

/**
 * Returns the serialized PROJECT-level projection envelope for `documents` under
 * `activeChannel`, using the disk cache: a hit reads+parses the stored envelope; a
 * miss builds the projection and schedules a DEFERRED, fire-and-forget write so the
 * response is never blocked and a write failure can never break the request.
 *
 * The projection is built over every document (game + UI channels) with `gameId`
 * left undefined, matching the client's `createEditorViewModel` input exactly so
 * the hydrated projection is identical to a client rebuild (the builder's output
 * is independent of document order). The envelope carries `documentHashes`
 * (`hashEditorText` per path, for EVERY document) so the client can verify the
 * cached projection still matches the current text of ALL documents before
 * substituting it.
 */
export async function loadProjectionEnvelopeWithCache(input: {
  readonly documents: readonly ProjectionCacheDocument[];
  readonly activeChannel?: string;
  readonly telemetry?: EditorProjectionCacheTelemetryRecorder;
  readonly cacheEnabled?: boolean;
}): Promise<SerializedEditorEntityProjectionEnvelope> {
  const buildEnvelope = async (): Promise<SerializedEditorEntityProjectionEnvelope> => {
    // Reuse the per-file snapshot cache for each parse (its own Level-2 entry).
    const projectionDocuments = await Promise.all(
      input.documents.map(async (document) => {
        const snapshot = await loadDocumentSnapshotWithCache({
          filePath: document.filePath,
          text: document.text,
          cacheEnabled: input.cacheEnabled
        });
        return { filePath: snapshot.filePath, json: snapshot.json };
      })
    );
    const projection = buildEditorEntityProjection({
      documents: projectionDocuments,
      ...(input.activeChannel !== undefined ? { activeChannel: input.activeChannel } : {})
    });
    const documentHashes: Record<string, string> = {};
    for (const document of input.documents) {
      documentHashes[document.filePath] = hashEditorText(document.text);
    }
    return serializeEditorEntityProjection(projection, { documentHashes });
  };

  if (!(input.cacheEnabled ?? isEditorCacheEnabled())) {
    return buildEnvelope();
  }

  const cacheDir = await resolveEditorCacheDir("projects");
  const key = computeProjectionArtifactKey(input.documents, input.activeChannel);

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
