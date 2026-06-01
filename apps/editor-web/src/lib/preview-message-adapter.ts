/**
 * Browser-side adapter for messages sent by the player preview iframe.
 *
 * The preview iframe cannot share DOM directly with the editor when it runs on
 * another origin. This module keeps the message protocol small and maps runtime
 * JSON Pointers back to authoring JSON Pointers through sidecar source maps.
 */
import type { PreviewEntityDescriptor, PreviewRect } from "@cubica/editor-engine";

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
}

export interface PlayerPreviewEntityMessage {
  readonly entityId: string;
  readonly runtimePointer: string;
  readonly label?: string;
  readonly semanticRole?: string;
  readonly layer?: string;
  readonly zIndex?: number;
  readonly renderOrder?: number;
  readonly bounds: PreviewRect;
  readonly visible?: boolean;
  readonly selectable?: boolean;
}

export interface PlayerPreviewEntitiesMessage {
  readonly source: "cubica-player-web";
  readonly type: "previewEntities";
  readonly version: 1;
  readonly entities: readonly PlayerPreviewEntityMessage[];
}

export interface PlayerPreviewSessionSnapshotMessage {
  readonly source: "cubica-player-web";
  readonly type: "previewSessionSnapshot";
  readonly version: 1;
  readonly sessionId: string;
  readonly gameId?: string;
  readonly sessionVersion: PreviewSessionStateVersion;
  readonly state: Record<string, unknown>;
  readonly action?: {
    readonly actionId: string;
    readonly payload?: Record<string, unknown>;
    readonly timestamp: string;
  };
}

export interface PreviewDescriptorMappingResult {
  readonly descriptors: readonly PreviewEntityDescriptor[];
  readonly unresolved: readonly PlayerPreviewEntityMessage[];
}

export function isPlayerPreviewEntitiesMessage(value: unknown): value is PlayerPreviewEntitiesMessage {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    value.source === "cubica-player-web" &&
    value.type === "previewEntities" &&
    value.version === 1 &&
    Array.isArray(value.entities)
  );
}

export function isPlayerPreviewSessionSnapshotMessage(value: unknown): value is PlayerPreviewSessionSnapshotMessage {
  if (!isPlainRecord(value) || value.source !== "cubica-player-web" || value.type !== "previewSessionSnapshot") {
    return false;
  }

  if (value.version !== 1 || typeof value.sessionId !== "string" || !isPlainRecord(value.state)) {
    return false;
  }

  if (!isSessionStateVersion(value.sessionVersion)) {
    return false;
  }

  if (value.action !== undefined) {
    if (!isPlainRecord(value.action) || typeof value.action.actionId !== "string" || typeof value.action.timestamp !== "string") {
      return false;
    }
    if (value.action.payload !== undefined && !isPlainRecord(value.action.payload)) {
      return false;
    }
  }

  return value.gameId === undefined || typeof value.gameId === "string";
}

export function mapPlayerPreviewEntitiesToAuthoringDescriptors(
  entities: readonly PlayerPreviewEntityMessage[],
  sourceMaps: readonly PreviewSelectionSourceMap[],
  options: {
    readonly currentAuthoringFile?: string;
    readonly gameId?: string;
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
        sourceFile: source.file
      }
    });
  }

  return { descriptors, unresolved };
}

export function findAuthoringSourceForRuntimePointer(
  sourceMaps: readonly PreviewSelectionSourceMap[],
  runtimePointer: string,
  options: {
    readonly currentAuthoringFile?: string;
    readonly gameId?: string;
  } = {}
): PreviewSourceMapping | undefined {
  for (const sourceMap of sourceMaps) {
    const source = mapGeneratedPointerToAuthoring(sourceMap, runtimePointer);
    if (source === undefined) {
      continue;
    }

    if (
      options.currentAuthoringFile === undefined ||
      sourceFileMatchesAuthoringFile(source.file, options.currentAuthoringFile, options.gameId)
    ) {
      return source;
    }
  }

  for (const sourceMap of sourceMaps) {
    const source = mapGeneratedPointerToAuthoring(sourceMap, runtimePointer);
    if (source !== undefined) {
      return source;
    }
  }

  return undefined;
}

export function mapGeneratedPointerToAuthoring(
  sourceMap: PreviewSelectionSourceMap,
  generatedPointer: string
): PreviewSourceMapping | undefined {
  let pointer = normalizeGeneratedPointer(generatedPointer);

  for (;;) {
    const sources = sourceMap.mappings[pointer];
    if (sources !== undefined && sources.length > 0) {
      return sources[0];
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
