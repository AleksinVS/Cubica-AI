/**
 * Browser-side adapter for messages sent by the player preview iframe.
 *
 * The preview iframe cannot share DOM directly with the editor when it runs on
 * another origin. This module keeps the message protocol small and maps runtime
 * JSON Pointers back to authoring JSON Pointers through sidecar source maps.
 */
import type { PreviewEntityDescriptor } from "@cubica/editor-engine";
import { validatePlayerPreviewEntitiesMessage, type PlayerPreviewEntitiesMessage as CanonicalPreviewEntitiesMessage } from "@cubica/contracts-session";

interface PreviewSessionStateVersion {
  readonly sessionId: string;
  readonly stateVersion: number;
  readonly lastEventSequence: number;
}

export interface PreviewSourceMapping {
  readonly file: string;
  readonly pointer: string;
}

export interface PreviewSelectionSourceMap {
  readonly generatedFile: string;
  readonly sourceFile: string;
  readonly mappings: Record<string, readonly PreviewSourceMapping[]>;
  /**
   * Sorted generated JSON Pointers whose entire subtree was omitted from
   * `mappings` because it is a position-for-position verbatim copy of an
   * ancestor's authoring subtree (e.g. thousands of authored polygon vertices
   * collapsing to one entry at their containing array). See
   * `mapGeneratedPointerToAuthoring` below for how this is used. Optional so a
   * source map produced before this field existed (or read before a rebuild)
   * still works — it then behaves exactly as before: every pointer resolves
   * to its nearest recorded ancestor's own pointer, just less precisely.
   */
  readonly verbatimSubtrees?: readonly string[];
}

export type PlayerPreviewEntitiesMessage = CanonicalPreviewEntitiesMessage;
export type PlayerPreviewEntityMessage = CanonicalPreviewEntitiesMessage["entities"][number];

export interface PreviewSourceSnapshot {
  readonly revision?: string;
  readonly maps: readonly PreviewSelectionSourceMap[];
}

export interface PlayerPreviewSessionSnapshotMessage {
  readonly source: "cubica-player-web";
  readonly type: "previewSessionSnapshot";
  /** Version 2 removes the obsolete action `payload` alias in favour of `params`. */
  readonly version: 2;
  readonly sessionId: string;
  readonly gameId?: string;
  readonly sessionVersion: PreviewSessionStateVersion;
  readonly state: Record<string, unknown>;
  readonly action?: {
    readonly actionId: string;
    /** Canonical bounded parameters submitted with the published Game Intent. */
    readonly params?: Record<string, unknown>;
    readonly timestamp: string;
  };
}

export interface PlayerPreviewRestoreResultMessage {
  readonly source: "cubica-player-web";
  readonly type: "previewRestoreResult";
  readonly version: 1;
  readonly requestId: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly sessionVersion?: PreviewSessionStateVersion;
}

export interface PlayerPreviewBridgeReadyMessage {
  readonly source: "cubica-player-web";
  readonly type: "previewBridgeReady";
  readonly version: 1;
}

export interface PreviewDescriptorMappingResult {
  readonly descriptors: readonly PreviewEntityDescriptor[];
  readonly unresolved: readonly PlayerPreviewEntityMessage[];
}

export function isPlayerPreviewEntitiesMessage(value: unknown): value is PlayerPreviewEntitiesMessage {
  return validatePlayerPreviewEntitiesMessage(value);
}

export function isPlayerPreviewSessionSnapshotMessage(value: unknown): value is PlayerPreviewSessionSnapshotMessage {
  if (!isPlainRecord(value) || value.source !== "cubica-player-web" || value.type !== "previewSessionSnapshot") {
    return false;
  }

  if (value.version !== 2 || typeof value.sessionId !== "string" || !isPlainRecord(value.state)) {
    return false;
  }

  if (!isSessionStateVersion(value.sessionVersion)) {
    return false;
  }

  if (value.action !== undefined) {
    if (!isPlainRecord(value.action) || typeof value.action.actionId !== "string" || typeof value.action.timestamp !== "string") {
      return false;
    }
    if (value.action.params !== undefined && !isPlainRecord(value.action.params)) {
      return false;
    }
  }

  return value.gameId === undefined || typeof value.gameId === "string";
}

export function isPlayerPreviewRestoreResultMessage(value: unknown): value is PlayerPreviewRestoreResultMessage {
  const baseIsValid = (
    isPlainRecord(value) &&
    value.source === "cubica-player-web" &&
    value.type === "previewRestoreResult" &&
    value.version === 1 &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 128 &&
    typeof value.ok === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
  if (!baseIsValid) {
    return false;
  }
  return value.sessionVersion === undefined || isSessionStateVersion(value.sessionVersion);
}

export function isPlayerPreviewBridgeReadyMessage(value: unknown): value is PlayerPreviewBridgeReadyMessage {
  return (
    isPlainRecord(value) &&
    value.source === "cubica-player-web" &&
    value.type === "previewBridgeReady" &&
    value.version === 1
  );
}

export function mapPlayerPreviewEntitiesToAuthoringDescriptors(
  entities: readonly PlayerPreviewEntityMessage[],
  sourceMaps: readonly PreviewSelectionSourceMap[],
  options: {
    readonly currentAuthoringFile?: string;
    readonly gameId?: string;
    readonly context?: PlayerPreviewEntitiesMessage["context"];
  } = {}
): PreviewDescriptorMappingResult {
  const descriptors: PreviewEntityDescriptor[] = [];
  const unresolved: PlayerPreviewEntityMessage[] = [];

  for (const entity of entities) {
    const source = findAuthoringSourceForRuntimePointer(sourceMaps, entity.runtimePointer, options);
    if (source === undefined) {
      unresolved.push(entity);
      continue;
    }
    const boundSource = entity.textBinding?.contentRuntimePointer === undefined ? undefined :
      findAuthoringSourceForRuntimePointer(sourceMaps, entity.textBinding.contentRuntimePointer, options);
    const contentOwnerSource = entity.contentRuntimePointer === undefined ? undefined :
      findAuthoringSourceForRuntimePointer(sourceMaps, entity.contentRuntimePointer, options);
    const metricSource = entity.textBinding?.metricRuntimePointer === undefined ? undefined :
      findAuthoringSourceForRuntimePointer(sourceMaps, entity.textBinding.metricRuntimePointer, options);
    const ruleSource = entity.textBinding?.ruleRuntimePointer === undefined ? undefined :
      findAuthoringSourceForRuntimePointer(sourceMaps, entity.textBinding.ruleRuntimePointer, options);

    descriptors.push({
      entityId: entity.entityId,
      runtimePointer: entity.runtimePointer,
      authoringPointer: source.pointer,
      label: entity.label ?? source.pointer,
      semanticRole: entity.semanticRole ?? "preview-entity",
      layer: entity.layer,
      zIndex: entity.zIndex,
      renderOrder: entity.renderOrder,
      bounds: entity.bounds,
      visible: entity.visible ?? true,
      selectable: entity.selectable ?? true,
      metadata: {
        sourceFile: source.file,
        ...(options.context === undefined ? {} : { previewContext: options.context }),
        ...(contentOwnerSource === undefined ? {} : { contentOwnerSourceFile: contentOwnerSource.file, contentOwnerSourcePointer: contentOwnerSource.pointer }),
        ...(entity.contentRuntimePointer === undefined ? {} : { contentRuntimePointer: entity.contentRuntimePointer }),
        ...(entity.displayText === undefined ? {} : { displayText: entity.displayText }),
        ...(entity.textBinding === undefined ? {} : { textBinding: {
          prop: entity.textBinding.prop,
          ...(entity.textBinding.contentRuntimePointer === undefined ? {} : { contentRuntimePointer: entity.textBinding.contentRuntimePointer }),
          expression: entity.textBinding.expression,
          ...(metricSource === undefined ? {} : { metricSourceFile: metricSource.file, metricSourcePointer: metricSource.pointer }),
          ...(ruleSource === undefined ? {} : { ruleSourceFile: ruleSource.file, ruleSourcePointer: ruleSource.pointer }),
          ...(boundSource === undefined ? {} : { contentSourceFile: boundSource.file, contentSourcePointer: boundSource.pointer })
        } })
      }
    });
  }

  return { descriptors, unresolved };
}

/** A revision is accepted only with the source maps committed for that same compile. */
export function mapPlayerPreviewEntitiesForSourceSnapshot(
  message: PlayerPreviewEntitiesMessage,
  snapshot: PreviewSourceSnapshot,
  options: { readonly currentAuthoringFile?: string; readonly gameId?: string } = {}
): PreviewDescriptorMappingResult | undefined {
  if (snapshot.revision === undefined || message.context.compileRevision === "unverified" ||
      message.context.compileRevision !== snapshot.revision) return undefined;
  return mapPlayerPreviewEntitiesToAuthoringDescriptors(message.entities, snapshot.maps, { ...options, context: message.context });
}

export function findAuthoringSourceForRuntimePointer(
  sourceMaps: readonly PreviewSelectionSourceMap[],
  runtimePointer: string,
  options: {
    readonly currentAuthoringFile?: string;
    readonly gameId?: string;
  } = {}
): PreviewSourceMapping | undefined {
  // The open game document has a root mapping too. A more specific UI mapping
  // must win, or clicking any rendered component selects the whole game.
  let pointer: string | undefined = normalizeGeneratedPointer(runtimePointer);
  while (pointer !== undefined) {
    const anchor = pointer;
    const matching = sourceMaps.filter(sourceMap => (sourceMap.mappings[anchor]?.length ?? 0) > 0);
    const preferred = matching.find(sourceMap => options.currentAuthoringFile !== undefined &&
      sourceFileMatchesAuthoringFile(sourceMap.mappings[anchor][0].file, options.currentAuthoringFile, options.gameId)) ?? matching[0];
    if (preferred !== undefined) return mapGeneratedPointerToAuthoring(preferred, runtimePointer);
    pointer = parentPointer(pointer);
  }
  return undefined;
}

export function mapGeneratedPointerToAuthoring(
  sourceMap: PreviewSelectionSourceMap,
  generatedPointer: string
): PreviewSourceMapping | undefined {
  const originalPointer = normalizeGeneratedPointer(generatedPointer);
  let pointer = originalPointer;

  for (;;) {
    const sources = sourceMap.mappings[pointer];
    if (sources !== undefined && sources.length > 0) {
      const source = sources[0];
      // The compiler omits an entry for two reasons (see the source map's
      // `verbatimSubtrees` doc comment and authoring-compiler.cjs's
      // `isPositionalMatch`): this pointer's source is byte-identical to
      // `pointer`'s (nothing to append — `source` IS the answer), or its
      // whole subtree is copied verbatim from `pointer`'s subtree, in which
      // case `pointer` is listed here and the exact source is recovered by
      // appending the remaining generated-pointer path — the same suffix we
      // walked past on the way here — to `source`'s own pointer. Appending
      // that suffix for an *identical* match (not listed) would fabricate a
      // pointer that does not exist, which is exactly why this must check
      // membership rather than always appending.
      if (sourceMap.verbatimSubtrees?.includes(pointer)) {
        return {
          file: source.file,
          pointer: source.pointer + originalPointer.slice(pointer.length)
        };
      }
      return source;
    }

    const parent = parentPointer(pointer);
    if (parent === undefined) {
      return undefined;
    }

    pointer = parent;
  }
}

export function sourceFileMatchesAuthoringFile(sourceFile: string, currentAuthoringFile: string, gameId?: string): boolean {
  const source = normalizePath(sourceFile);
  const current = normalizePath(currentAuthoringFile);
  const gameScoped = gameId === undefined ? undefined : `games/${gameId}/authoring/${current}`;

  return source === current || source.endsWith(`/${current}`) || (gameScoped !== undefined && source === gameScoped);
}

function normalizeGeneratedPointer(pointer: string): string {
  if (pointer === "" || pointer.startsWith("/")) {
    return pointer;
  }

  return `/${pointer}`;
}

function parentPointer(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }

  const lastSlashIndex = pointer.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "" : pointer.slice(0, lastSlashIndex);
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSessionStateVersion(value: unknown): value is PreviewSessionStateVersion {
  if (!isPlainRecord(value)) {
    return false;
  }
  const stateVersion = value.stateVersion;
  const lastEventSequence = value.lastEventSequence;

  return (
    typeof value.sessionId === "string" &&
    typeof stateVersion === "number" &&
    Number.isSafeInteger(stateVersion) &&
    stateVersion >= 0 &&
    typeof lastEventSequence === "number" &&
    Number.isSafeInteger(lastEventSequence) &&
    lastEventSequence >= 0
  );
}
