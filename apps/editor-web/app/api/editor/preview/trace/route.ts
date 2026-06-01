/**
 * Persists editor preview timeline trace updates.
 *
 * The browser sends one runtime snapshot at a time. This route writes the
 * tooling-only trace under `.tmp/editor-playthroughs` so a long debugging
 * session is not held only in React state.
 */
import type {
  PreviewPlaythroughEvent,
  PreviewPlaythroughSnapshot
} from "@cubica/editor-engine";

import { EditorRepositoryError } from "@/lib/editor-repository";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { updatePreviewTraceDocument } from "@/lib/preview-trace-store";

export const runtime = "nodejs";

interface PreviewTraceUpdateBody {
  readonly traceId?: string;
  readonly gameId?: string;
  readonly editorSessionId?: string;
  readonly runtimeSessionId?: string;
  readonly event?: PreviewPlaythroughEvent;
  readonly snapshot?: PreviewPlaythroughSnapshot;
  readonly truncateAfterSequence?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewTraceUpdateBody;
    assertPreviewTraceUpdateBody(body);

    const document = await updatePreviewTraceDocument({
      repoRoot: configuredEditorProjectRoot(),
      traceId: body.traceId,
      gameId: body.gameId,
      editorSessionId: body.editorSessionId,
      runtimeSessionId: body.runtimeSessionId,
      event: body.event,
      snapshot: body.snapshot,
      truncateAfterSequence: body.truncateAfterSequence
    });

    return Response.json({
      ok: true,
      trace: {
        traceId: document.traceId,
        gameId: document.gameId,
        editorSessionId: document.editorSessionId,
        runtimeSessionId: document.runtimeSessionId,
        eventCount: document.events.length,
        snapshotCount: document.snapshots.length,
        updatedAt: document.updatedAt
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function assertPreviewTraceUpdateBody(
  body: PreviewTraceUpdateBody
): asserts body is Required<Pick<PreviewTraceUpdateBody, "traceId">> & PreviewTraceUpdateBody {
  if (typeof body.traceId !== "string" || body.traceId.trim() === "") {
    throw new EditorRepositoryError("Preview trace update requires traceId.", 400);
  }
  if (body.truncateAfterSequence !== undefined && !isNonNegativeInteger(body.truncateAfterSequence)) {
    throw new EditorRepositoryError("Preview trace truncateAfterSequence must be a non-negative integer.", 400);
  }
  if ((body.event === undefined) !== (body.snapshot === undefined)) {
    throw new EditorRepositoryError("Preview trace update must include event and snapshot together.", 400);
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected preview trace persistence failure." }, { status: 500 });
}
