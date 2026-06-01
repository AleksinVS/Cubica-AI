/**
 * Server-side persistence for editor preview playthrough traces.
 *
 * A playthrough trace is a temporary debugging record: timeline events plus
 * runtime snapshots captured while the author tests the game in preview. It is
 * stored under `.tmp/editor-playthroughs` and must never become manifest data.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  JsonValue,
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot
} from "@cubica/editor-engine";

import { EditorRepositoryError } from "./editor-repository";

export interface PersistedPreviewTraceDocument {
  readonly version: 1;
  readonly traceId: string;
  readonly gameId?: string;
  readonly editorSessionId?: string;
  readonly runtimeSessionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly events: readonly PreviewPlaythroughEvent[];
  readonly snapshots: readonly PreviewPlaythroughSnapshot[];
}

export interface PreviewTraceUpdateInput {
  readonly repoRoot?: string;
  readonly traceId: string;
  readonly gameId?: string;
  readonly editorSessionId?: string;
  readonly runtimeSessionId?: string;
  readonly event?: PreviewPlaythroughEvent;
  readonly snapshot?: PreviewPlaythroughSnapshot;
  readonly truncateAfterSequence?: number;
}

const safeTraceIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$/u;

export async function updatePreviewTraceDocument(
  input: PreviewTraceUpdateInput
): Promise<PersistedPreviewTraceDocument> {
  validateTraceId(input.traceId);
  validateOptionalSegment(input.gameId, "gameId");
  validateOptionalSegment(input.editorSessionId, "editorSessionId");
  validateOptionalSegment(input.runtimeSessionId, "runtimeSessionId");
  if (input.truncateAfterSequence !== undefined) {
    assertNonNegativeInteger(input.truncateAfterSequence, "truncateAfterSequence");
  }

  if ((input.event === undefined) !== (input.snapshot === undefined)) {
    throw new EditorRepositoryError("Preview trace updates must include event and snapshot together.", 400);
  }
  if (input.event !== undefined && !isPreviewTraceEvent(input.event)) {
    throw new EditorRepositoryError("Preview trace event is invalid.", 400);
  }
  if (input.snapshot !== undefined && !isPreviewTraceSnapshot(input.snapshot)) {
    throw new EditorRepositoryError("Preview trace snapshot is invalid.", 400);
  }
  if (input.event !== undefined && input.snapshot !== undefined && input.event.sequence !== input.snapshot.eventSequence) {
    throw new EditorRepositoryError("Preview trace event and snapshot sequences must match.", 400);
  }

  const filePath = previewTraceDocumentPath(input.repoRoot ?? process.cwd(), input.traceId);
  const existing = await readPreviewTraceDocument(filePath, input);
  const cutoff = input.truncateAfterSequence;
  const retainedEvents = cutoff === undefined
    ? existing.events
    : existing.events.filter((event) => event.sequence <= cutoff);
  const retainedSnapshots = cutoff === undefined
    ? existing.snapshots
    : existing.snapshots.filter((snapshot) => snapshot.eventSequence <= cutoff);

  const nextEvents = input.event === undefined
    ? retainedEvents
    : [
        ...retainedEvents.filter((event) => event.sequence !== input.event?.sequence),
        input.event
      ];
  const nextSnapshots = input.snapshot === undefined
    ? retainedSnapshots
    : [
        ...retainedSnapshots.filter((snapshot) => snapshot.eventSequence !== input.snapshot?.eventSequence),
        input.snapshot
      ];
  const now = new Date().toISOString();
  const nextDocument: PersistedPreviewTraceDocument = {
    version: 1,
    traceId: input.traceId,
    gameId: input.gameId ?? existing.gameId,
    editorSessionId: input.editorSessionId ?? existing.editorSessionId,
    runtimeSessionId: input.runtimeSessionId ?? existing.runtimeSessionId,
    createdAt: existing.createdAt,
    updatedAt: now,
    events: sortEvents(nextEvents),
    snapshots: sortSnapshots(nextSnapshots)
  };

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(nextDocument, null, 2)}\n`, "utf8");
  return nextDocument;
}

export function previewTraceDocumentPath(repoRoot: string, traceId: string): string {
  validateTraceId(traceId);
  return path.join(repoRoot, ".tmp", "editor-playthroughs", `${traceId}.json`);
}

async function readPreviewTraceDocument(
  filePath: string,
  input: PreviewTraceUpdateInput
): Promise<PersistedPreviewTraceDocument> {
  const text = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (isMissingFileError(error)) {
      const now = new Date().toISOString();
      return JSON.stringify({
        version: 1,
        traceId: input.traceId,
        gameId: input.gameId,
        editorSessionId: input.editorSessionId,
        runtimeSessionId: input.runtimeSessionId,
        createdAt: now,
        updatedAt: now,
        events: [],
        snapshots: []
      });
    }

    throw error;
  });
  const parsed = JSON.parse(text) as Partial<PersistedPreviewTraceDocument>;
  if (
    parsed.version !== 1 ||
    parsed.traceId !== input.traceId ||
    typeof parsed.createdAt !== "string" ||
    typeof parsed.updatedAt !== "string" ||
    !Array.isArray(parsed.events) ||
    !Array.isArray(parsed.snapshots)
  ) {
    throw new EditorRepositoryError("Preview trace document is invalid.", 500);
  }

  return {
    version: 1,
    traceId: parsed.traceId,
    gameId: typeof parsed.gameId === "string" ? parsed.gameId : undefined,
    editorSessionId: typeof parsed.editorSessionId === "string" ? parsed.editorSessionId : undefined,
    runtimeSessionId: typeof parsed.runtimeSessionId === "string" ? parsed.runtimeSessionId : undefined,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    events: parsed.events.filter(isPreviewTraceEvent).sort((left, right) => left.sequence - right.sequence),
    snapshots: parsed.snapshots.filter(isPreviewTraceSnapshot).sort((left, right) => left.eventSequence - right.eventSequence)
  };
}

function sortEvents(events: readonly PreviewPlaythroughEvent[]): readonly PreviewPlaythroughEvent[] {
  return [...events].sort((left, right) => left.sequence - right.sequence);
}

function sortSnapshots(snapshots: readonly PreviewPlaythroughSnapshot[]): readonly PreviewPlaythroughSnapshot[] {
  return [...snapshots].sort((left, right) => left.eventSequence - right.eventSequence);
}

function isPreviewTraceEvent(value: unknown): value is PreviewPlaythroughEvent {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    typeof value.timestamp === "string" &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    (value.payload === undefined || isJsonValue(value.payload))
  );
}

function isPreviewTraceSnapshot(value: unknown): value is PreviewPlaythroughSnapshot {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.eventSequence === "number" &&
    Number.isSafeInteger(value.eventSequence) &&
    value.eventSequence >= 0 &&
    isJsonValue(value.state)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isPlainRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function validateTraceId(traceId: string): void {
  if (!safeTraceIdPattern.test(traceId) || traceId.includes("..")) {
    throw new EditorRepositoryError("Preview trace id must be a safe file segment.", 400);
  }
}

function validateOptionalSegment(value: string | undefined, label: string): void {
  if (value !== undefined && (!safeTraceIdPattern.test(value) || value.includes(".."))) {
    throw new EditorRepositoryError(`${label} must be a safe trace segment.`, 400);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new EditorRepositoryError(`${label} must be a non-negative integer.`, 400);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "ENOENT";
}
