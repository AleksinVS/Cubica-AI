/**
 * Pure helper functions used by the editor workspace.
 *
 * These are side-effect-free utilities (plus a few trace-persistence `fetch`
 * wrappers) that were previously declared at module scope in
 * `editor-workspace.tsx`: AI patch target building, diff humanisation, graph
 * layout geometry, Monaco model/marker/URI mapping, preview trace transforms,
 * pointer/URL utilities, and the status-bar sync label. They import the
 * canonical `isPlainJsonObject` from `@cubica/editor-engine` — the last local
 * duplicate of that predicate has been removed (LEGACY-0018).
 */
import {
  appendPreviewPlaythroughEvent,
  buildPreviewTraceRestorePlan,
  createPreviewPlaythroughTrace,
  isPlainJsonObject,
  readJsonPointer,
  type EditorDiffSummaryItem,
  type JsonValue,
  type PreviewEntityDescriptor,
  type PreviewPlaythroughSnapshot,
  type PreviewPlaythroughTrace,
  type TextRange
} from "@cubica/editor-engine";

import { localAuthoringSchemas } from "@/lib/editor-json-schema";
import type { EditorViewNode, RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";
import type { PlayerPreviewSessionSnapshotMessage } from "@/lib/preview-message-adapter";

import {
  embeddedFilePath,
  semanticNodeColumnSpacing,
  semanticNodeRowsPerColumn,
  semanticNodeRowSpacing
} from "./constants.ts";
import type {
  CurrentDocument,
  EditorLayoutDocumentBody,
  EditorPluginValidationResult,
  EditorWorkflowResponse,
  MonacoApi,
  MonacoMarker,
  MonacoModel,
  MonacoRange
} from "./types.ts";

/** Trims a prompt into a bounded prototype-semantics description string. */
export function prototypeSemanticsFromPrompt(prompt: string | undefined): string | undefined {
  const trimmed = prompt?.trim();
  if (trimmed === undefined || trimmed === "") {
    return undefined;
  }

  return trimmed.length <= 240 ? trimmed : trimmed.slice(0, 237).trimEnd() + "...";
}

/**
 * Builds AI patch target contexts from selected preview entities, restricted to
 * the currently active authoring file and de-duplicated by pointer.
 */
export function buildAiPatchTargetContexts(
  entities: readonly PreviewEntityDescriptor[],
  gameId: string,
  activeFilePath: string,
  document: JsonValue
): readonly {
  readonly filePath: string;
  readonly pointer: string;
  readonly label?: string;
  readonly value: JsonValue;
}[] {
  const seen = new Set<string>();
  const targets: {
    readonly filePath: string;
    readonly pointer: string;
    readonly label?: string;
    readonly value: JsonValue;
  }[] = [];

  for (const entity of entities) {
    const sourceFile = typeof entity.metadata?.sourceFile === "string" ? entity.metadata.sourceFile : undefined;
    const sourceFilePath = sourceFile === undefined ? activeFilePath : toRepositoryAuthoringFilePath(sourceFile, gameId);
    if (sourceFilePath !== undefined && sourceFilePath !== activeFilePath) {
      continue;
    }

    const key = `${activeFilePath}${entity.authoringPointer}`;
    if (seen.has(key)) {
      continue;
    }

    const value = readJsonPointer(document, entity.authoringPointer);
    if (value === undefined) {
      continue;
    }

    seen.add(key);
    targets.push({
      filePath: activeFilePath,
      pointer: entity.authoringPointer,
      label: entity.label,
      value
    });
  }

  return targets;
}

/** Builds the single AI patch target for the currently selected graph node. */
export function buildSelectedNodeAiPatchTargetContext(
  activeFilePath: string,
  selectedNode: EditorViewNode | undefined,
  selectedValue: JsonValue | undefined
): ReturnType<typeof buildAiPatchTargetContexts> {
  if (selectedNode === undefined || selectedNode.pointer === "" || selectedValue === undefined) {
    return [];
  }

  return [
    {
      filePath: activeFilePath,
      pointer: selectedNode.pointer,
      label: selectedNode.semanticTitle,
      value: selectedValue
    }
  ];
}

/** Renders a diff summary item as a short human-readable sentence. */
export function humanizeDiffSummaryItem(item: EditorDiffSummaryItem, nodes: readonly EditorViewNode[]): string {
  const node = findNodeForPointer(nodes, item.pointer);
  const label = node?.semanticTitle ?? (item.pointer || "/");
  if (item.operation === "add") {
    return `added ${label}`;
  }

  if (item.operation === "remove") {
    return `removed ${label}`;
  }

  return `changed ${label}`;
}

/** Computes an (x, y) canvas position for a node at a given depth/slot. */
export function getNodePosition(depthX: number, slot: number): { x: number; y: number } {
  const column = Math.floor(slot / semanticNodeRowsPerColumn);
  const row = slot % semanticNodeRowsPerColumn;
  return {
    x: depthX + column * semanticNodeColumnSpacing,
    y: row * semanticNodeRowSpacing
  };
}

/** Depth of a node in the graph, derived from its JSON pointer segments. */
export function getNodeDepth(node: EditorViewNode): number {
  return node.pointer === "" ? 0 : node.pointer.split("/").length - 1;
}

/** An empty editor layout document body. */
export function createEmptyEditorLayout(): EditorLayoutDocumentBody {
  return {
    version: 1,
    nodes: {}
  };
}

/** Extracts the node id → position map from a layout document body. */
export function positionsFromLayout(layout: EditorLayoutDocumentBody): ReadonlyMap<string, { readonly x: number; readonly y: number }> {
  const positions = new Map<string, { readonly x: number; readonly y: number }>();
  for (const [nodeId, node] of Object.entries(layout.nodes)) {
    if (node.position !== undefined) {
      positions.set(nodeId, node.position);
    }
  }

  return positions;
}

/** Configures Monaco's JSON language service with the local authoring schemas. */
export function configureMonacoJson(monaco: MonacoApi, modelUri: string, schemaId: string | undefined) {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    enableSchemaRequest: false,
    schemas: localAuthoringSchemas.map((item) => ({
      uri: item.uri,
      fileMatch: item.uri === schemaId ? [modelUri] : [],
      schema: item.schema
    }))
  });
}

/** Stable Monaco model URI for the currently open document. */
export function toMonacoModelUri(document: CurrentDocument): string {
  if (document.source === "embedded") {
    return `file:///cubica/editor/${embeddedFilePath}`;
  }

  return `file:///cubica/games/${encodeURIComponent(document.gameId)}/authoring/${document.filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/** Maps a routed diagnostic to a Monaco marker. */
export function toMonacoMarker(monaco: MonacoApi, model: MonacoModel, diagnostic: RoutedEditorDiagnostic): MonacoMarker {
  const range = diagnostic.range === undefined ? fallbackMarkerRange(model) : toMonacoRange(diagnostic.range);

  return {
    ...range,
    severity: diagnostic.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
    message: `${diagnostic.label}: ${diagnostic.message}`,
    source: diagnostic.source
  };
}

/** Converts an editor-engine text range into a Monaco range. */
export function toMonacoRange(range: TextRange): MonacoRange {
  return {
    startLineNumber: range.start.line,
    startColumn: range.start.column,
    endLineNumber: range.end.line,
    endColumn: Math.max(range.end.column, range.start.column + 1)
  };
}

/** Marker range used when a diagnostic has no associated text range. */
export function fallbackMarkerRange(model: MonacoModel): MonacoRange {
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: Math.max(2, model.getLineMaxColumn(1))
  };
}

/**
 * Inserts or replaces the runtime snapshot for one preview event in a trace,
 * keyed by the runtime `lastEventSequence`.
 */
export function upsertRuntimeSnapshotInTrace(
  trace: PreviewPlaythroughTrace,
  message: PlayerPreviewSessionSnapshotMessage
): PreviewPlaythroughTrace {
  const sequence = message.sessionVersion.lastEventSequence;
  const action = message.action;
  const baseTrace = createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId ?? message.gameId,
    events: trace.events.filter((event) => event.sequence !== sequence),
    snapshots: trace.snapshots.filter((snapshot) => snapshot.eventSequence !== sequence)
  });

  return appendPreviewPlaythroughEvent(
    baseTrace,
    {
      id: `runtime:${message.sessionId}:${sequence}`,
      sequence,
      timestamp: action?.timestamp ?? new Date().toISOString(),
      kind: action === undefined ? "system" : "action",
      label: action?.actionId ?? (sequence === 0 ? "Initial runtime state" : `Runtime state ${sequence}`),
      payload: {
        sessionId: message.sessionId,
        sessionVersion: {
          stateVersion: message.sessionVersion.stateVersion,
          lastEventSequence: message.sessionVersion.lastEventSequence
        },
        action: action === undefined
          ? undefined
          : {
              actionId: action.actionId,
              payload: action.payload ?? {},
              timestamp: action.timestamp
            }
      } as unknown as JsonValue
    },
    message.state as unknown as JsonValue
  );
}

/** Drops all trace events and snapshots after the given sequence. */
export function truncatePreviewTrace(trace: PreviewPlaythroughTrace, targetSequence: number): PreviewPlaythroughTrace {
  return createPreviewPlaythroughTrace({
    traceId: trace.traceId,
    gameId: trace.gameId,
    events: trace.events.filter((event) => event.sequence <= targetSequence),
    snapshots: trace.snapshots.filter((snapshot) => snapshot.eventSequence <= targetSequence)
  });
}

/** Reads the runtime version stored on a trace event, validating its shape. */
export function readRuntimeEventVersion(
  trace: PreviewPlaythroughTrace,
  targetSequence: number
): { readonly stateVersion: number; readonly lastEventSequence: number } | undefined {
  const payload = trace.events.find((event) => event.sequence === targetSequence)?.payload;
  if (!isPlainJsonObject(payload)) {
    return undefined;
  }

  const sessionVersion = payload.sessionVersion;
  if (!isPlainJsonObject(sessionVersion)) {
    return undefined;
  }

  const stateVersion = sessionVersion.stateVersion;
  const lastEventSequence = sessionVersion.lastEventSequence;
  if (
    typeof stateVersion !== "number" ||
    typeof lastEventSequence !== "number" ||
    !Number.isSafeInteger(stateVersion) ||
    !Number.isSafeInteger(lastEventSequence) ||
    stateVersion < 0 ||
    lastEventSequence < 0
  ) {
    return undefined;
  }

  return { stateVersion, lastEventSequence };
}

/**
 * Preview freshness on the PLAYTHROUGH axis (ADR-057 §4.8, §4.12;
 * editor-preview-first-ux §9.6). It answers "does the on-screen preview reflect
 * the author's current edits?" and is orthogonal to the document undo axis.
 *
 *  - `unprepared` — no preview is prepared yet, so freshness is not meaningful.
 *  - `fresh`      — the preview reflects the current (applied) edits.
 *  - `stale`      — there are VALID (compilable) edits not yet applied to the
 *                   preview (diagnostic code `preview-stale`).
 *  - `blocked`    — compilation is broken; the preview shows the last valid
 *                   render and cannot update (diagnostic code `preview-blocked`).
 */
export type PreviewFreshness = "unprepared" | "fresh" | "stale" | "blocked";

/**
 * Derives {@link PreviewFreshness} from the signals the editor already tracks:
 * whether a preview is prepared, whether compilation is blocked by errors, and
 * whether the buffer/saved content has moved past what the preview was applied
 * at. "Blocked" wins over "stale" because a broken compile hides any valid edit.
 */
export function derivePreviewFreshness(input: {
  readonly previewPrepared: boolean;
  readonly compileBlocked: boolean;
  readonly hasUnappliedEdits: boolean;
}): PreviewFreshness {
  if (!input.previewPrepared) {
    return "unprepared";
  }
  if (input.compileBlocked) {
    return "blocked";
  }
  return input.hasUnappliedEdits ? "stale" : "fresh";
}

/**
 * Maps a freshness value to its status-bar presentation: the registry diagnostic
 * code (design-spec §4), a plain-language Russian label (the domain vocabulary
 * of the mockup), and a colour tone for the marker dot.
 */
export function describePreviewFreshness(freshness: PreviewFreshness): {
  readonly code: "preview-stale" | "preview-blocked" | undefined;
  readonly label: string;
  readonly tone: "ok" | "warn" | "err" | "muted";
} {
  switch (freshness) {
    case "fresh":
      return { code: undefined, label: "предпросмотр актуален", tone: "ok" };
    case "stale":
      return { code: "preview-stale", label: "предпросмотр отстаёт", tone: "warn" };
    case "blocked":
      return { code: "preview-blocked", label: "предпросмотр заблокирован ошибками", tone: "err" };
    case "unprepared":
    default:
      return { code: undefined, label: "предпросмотр не подготовлен", tone: "muted" };
  }
}

/**
 * Whether "Превью" should offer the manual "Применить" action (design-spec
 * §3.3). Offered only in "preview" mode, only when the preview lags VALID edits
 * ("stale"), and only when the apply pipeline is idle. Gates both the stale
 * plate's visibility and its button. Drives the "плашка отстаёт" acceptance.
 */
export function shouldOfferPreviewApply(input: {
  readonly editorMode: "design" | "preview";
  readonly freshness: PreviewFreshness;
  readonly workflowBusy: boolean;
}): boolean {
  return input.editorMode === "preview" && input.freshness === "stale" && !input.workflowBusy;
}

/**
 * Whether "Дизайн" should auto-apply edits to the preview (design-spec §3.3).
 * Fires only in "design" mode when the preview lags VALID edits; the debounce
 * lives in the effect. Drives the "авто-применение в Дизайне" acceptance.
 */
export function shouldAutoApplyPreview(input: {
  readonly editorMode: "design" | "preview";
  readonly freshness: PreviewFreshness;
}): boolean {
  return input.editorMode === "design" && input.freshness === "stale";
}

/**
 * One rung of the preview recovery ladder (editor-preview-first-ux §9.2). When
 * edits are applied to a running playthrough, the editor tries to keep the
 * author as close as possible to where they were, degrading gracefully:
 *
 *  1. `current-step`     — the current step has a snapshot: restore straight to it.
 *  2. `nearest-snapshot` — no exact snapshot: restore the nearest earlier one and
 *                          note how many events would need replay.
 *  3. `step-start`       — only the run's first snapshot is available: go there.
 *  4. `restart`          — nothing restorable: restart the playthrough.
 *
 * Each rung carries a plain-language message so the UI never silently loses the
 * author's position. `restart` is always the terminal rung.
 */
export type PreviewRecoveryRung =
  | {
      readonly kind: "current-step" | "nearest-snapshot" | "step-start";
      readonly sequence: number;
      readonly snapshotState: JsonValue;
      readonly version: { readonly stateVersion: number; readonly lastEventSequence: number };
      readonly replayCount: number;
      readonly message: string;
    }
  | { readonly kind: "restart"; readonly message: string };

/**
 * Plans the ordered recovery ladder for repositioning a preview after edits are
 * applied, using only the pre-apply trace (snapshots + event versions). It is a
 * pure function so the rung selection and messages are directly testable; the
 * controller walks the rungs, attempting a runtime restore per restorable rung
 * and stopping at the first that succeeds (or the terminal `restart`).
 */
export function planPreviewRecoveryLadder(
  trace: PreviewPlaythroughTrace,
  targetSequence: number | undefined
): readonly PreviewRecoveryRung[] {
  const rungs: PreviewRecoveryRung[] = [];
  const target = targetSequence;
  const versionFor = (sequence: number): { readonly stateVersion: number; readonly lastEventSequence: number } =>
    readRuntimeEventVersion(trace, sequence) ?? { stateVersion: sequence, lastEventSequence: sequence };
  const eventsBetween = (fromExclusive: number, toInclusive: number): number =>
    trace.events.filter((event) => event.sequence > fromExclusive && event.sequence <= toInclusive).length;

  const exact: PreviewPlaythroughSnapshot | undefined =
    target === undefined ? undefined : trace.snapshots.find((snapshot) => snapshot.eventSequence === target);
  if (exact !== undefined && target !== undefined) {
    rungs.push({
      kind: "current-step",
      sequence: target,
      snapshotState: exact.state,
      version: versionFor(target),
      replayCount: 0,
      message: `Состояние совместимо — вернулись на текущий шаг (T${target}).`
    });
  }

  const nearest = target === undefined ? undefined : buildPreviewTraceRestorePlan(trace, target).snapshot;
  if (nearest !== undefined && target !== undefined && nearest.eventSequence !== target) {
    const replayCount = eventsBetween(nearest.eventSequence, target);
    rungs.push({
      kind: "nearest-snapshot",
      sequence: nearest.eventSequence,
      snapshotState: nearest.state,
      version: versionFor(nearest.eventSequence),
      replayCount,
      message: `Точного снимка шага нет — вернулись к ближайшему снимку (T${nearest.eventSequence}); ${replayCount} событий после него нужно повторить.`
    });
  }

  const first = trace.snapshots[0];
  if (
    first !== undefined &&
    first.eventSequence !== target &&
    (nearest === undefined || first.eventSequence !== nearest.eventSequence)
  ) {
    rungs.push({
      kind: "step-start",
      sequence: first.eventSequence,
      snapshotState: first.state,
      version: versionFor(first.eventSequence),
      replayCount: 0,
      message: `Состояние несовместимо — вернулись к началу шага (T${first.eventSequence}).`
    });
  }

  rungs.push({
    kind: "restart",
    message: "Состояние несовместимо — перезапустили прохождение с начала."
  });

  return rungs;
}

/** Persists a single trace event + snapshot to the editor preview trace store. */
export async function persistPreviewTraceSnapshot(
  trace: PreviewPlaythroughTrace,
  message: PlayerPreviewSessionSnapshotMessage,
  editorSessionId: string | undefined
): Promise<void> {
  const sequence = message.sessionVersion.lastEventSequence;
  const event = trace.events.find((candidate) => candidate.sequence === sequence);
  const snapshot = trace.snapshots.find((candidate) => candidate.eventSequence === sequence);
  if (event === undefined || snapshot === undefined) {
    return;
  }

  await postPreviewTraceUpdate({
    traceId: trace.traceId,
    gameId: trace.gameId ?? message.gameId,
    editorSessionId,
    runtimeSessionId: message.sessionId,
    event,
    snapshot
  });
}

/** Persists a trace truncation (after rollback) to the preview trace store. */
export async function persistPreviewTraceTruncation(
  trace: PreviewPlaythroughTrace,
  runtimeSessionId: string,
  editorSessionId: string | undefined,
  targetSequence: number
): Promise<void> {
  await postPreviewTraceUpdate({
    traceId: trace.traceId,
    gameId: trace.gameId,
    editorSessionId,
    runtimeSessionId,
    truncateAfterSequence: targetSequence
  });
}

async function postPreviewTraceUpdate(body: {
  readonly traceId: string;
  readonly gameId?: string;
  readonly editorSessionId?: string;
  readonly runtimeSessionId?: string;
  readonly event?: unknown;
  readonly snapshot?: unknown;
  readonly truncateAfterSequence?: number;
}): Promise<void> {
  const response = await fetch("/api/editor/preview/trace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { readonly error?: string };
    throw new Error(payload.error ?? `Preview trace update failed with HTTP ${response.status}.`);
  }
}

/** Reads the `sessionId` query parameter from a preview player URL. */
export function readSessionIdFromPreviewUrl(value: string): string | undefined {
  try {
    return new URL(value).searchParams.get("sessionId") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Adds restore-sequence + nonce query params to force a preview iframe reload. */
export function addPreviewReloadNonce(value: string, targetSequence: number): string {
  try {
    const url = new URL(value);
    url.searchParams.set("restoreSequence", String(targetSequence));
    url.searchParams.set("restoreNonce", String(Date.now()));
    return url.toString();
  } catch {
    return value;
  }
}

/** Safely extracts the origin of a URL, or `undefined` when it is invalid. */
export function safeUrlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/** Maps an absolute preview source file path to a repository authoring path. */
export function toRepositoryAuthoringFilePath(sourceFile: string, gameId: string): string | undefined {
  const normalized = sourceFile.replaceAll("\\", "/");
  const marker = `games/${gameId}/authoring/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  return normalized.slice(markerIndex + marker.length);
}

/** Finds the nearest graph node at or above a pointer (walking up parents). */
export function findNodeForPointer(nodes: readonly EditorViewNode[], pointer: string): EditorViewNode | undefined {
  let current: string | undefined = pointer;

  while (current !== undefined) {
    const node = nodes.find((candidate) => candidate.pointer === current);
    if (node !== undefined) {
      return node;
    }

    current = parentPointer(current);
  }

  return undefined;
}

/** Returns the parent JSON pointer, or `undefined` for the root pointer. */
export function parentPointer(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }

  const lastSlashIndex = pointer.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "" : pointer.slice(0, lastSlashIndex);
}

/** Clamps a number into the inclusive [minimum, maximum] range. */
export function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Counts non-visual semantic entities (actions, conditions, state, ...). */
export function summarizeNonVisualEntities(nodes: readonly EditorViewNode[]): readonly { readonly role: string; readonly count: number }[] {
  const targetRoles: readonly EditorViewNode["semanticRole"][] = ["action", "condition", "state", "metric", "asset", "reference"];
  return targetRoles
    .map((role) => ({
      role,
      count: nodes.filter((node) => node.semanticRole === role).length
    }))
    .filter((item) => item.count > 0);
}

/** Server-side-only diagnostics that must not be surfaced in the local editor. */
export function filterServerOnlyDiagnostics(diagnostics: readonly RoutedEditorDiagnostic[]): readonly RoutedEditorDiagnostic[] {
  return diagnostics.filter(
    (diagnostic) => diagnostic.source !== "syntax" && diagnostic.source !== "schema" && diagnostic.source !== "semantic"
  );
}

/** Extracts plugin-validation diagnostics from a plugin validation result. */
export function diagnosticsFromPluginValidation(
  pluginValidation: EditorPluginValidationResult | undefined
): readonly RoutedEditorDiagnostic[] {
  return pluginValidation?.diagnostics ?? [];
}

/** Extracts plugin diagnostics from a workflow response body. */
export function pluginDiagnosticsFromWorkflowResponse(result: EditorWorkflowResponse): readonly RoutedEditorDiagnostic[] {
  return result.pluginValidation?.diagnostics ?? (result.diagnostics ?? []).filter(isPluginDiagnostic);
}

/** True when a diagnostic originates from plugin schema/validation. */
export function isPluginDiagnostic(diagnostic: RoutedEditorDiagnostic): boolean {
  return diagnostic.source === "plugin-schema" || diagnostic.source === "plugin-validation";
}

/** Derives the short status label shown in the editor status strip. */
export function getSyncLabel(input: {
  readonly loadState: "loading" | "ready" | "fallback" | "error";
  readonly saveState: "idle" | "saving" | "saved" | "error" | "conflict";
  readonly isDirty: boolean;
  readonly hasBlockingDiagnostics: boolean;
  readonly currentDocument: CurrentDocument;
  readonly statusMessage: string;
}): string {
  if (input.loadState === "loading") {
    return "Loading";
  }

  if (input.loadState === "fallback") {
    return "Sample fallback";
  }

  if (input.saveState === "saving") {
    return "Saving";
  }

  if (input.saveState === "conflict") {
    return "Conflict";
  }

  if (input.saveState === "error" || input.loadState === "error") {
    return "Error";
  }

  if (input.hasBlockingDiagnostics) {
    return "Blocked";
  }

  if (input.isDirty) {
    return "Dirty";
  }

  if (input.saveState === "saved") {
    return "Saved";
  }

  return input.currentDocument.source === "repository" ? "Clean" : input.statusMessage;
}
