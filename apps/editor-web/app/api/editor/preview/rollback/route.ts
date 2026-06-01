/**
 * Restores an editor preview runtime session to a previously captured snapshot.
 *
 * The browser editor calls this route instead of runtime-api directly. Keeping
 * the proxy server-side preserves the existing local runtime URL boundary and
 * keeps rollback scoped to editor preview sessions.
 */
import { EditorRepositoryError } from "@/lib/editor-repository";

export const runtime = "nodejs";

const runtimeApiUrl = process.env.RUNTIME_API_URL ?? "http://127.0.0.1:3001";

interface RestorePreviewBody {
  readonly gameId?: string;
  readonly sessionId?: string;
  readonly state?: Record<string, unknown>;
  readonly version?: {
    readonly stateVersion?: number;
    readonly lastEventSequence?: number;
  };
  readonly targetEventSequence?: number;
}

interface ValidRestorePreviewBody {
  readonly gameId: string;
  readonly sessionId: string;
  readonly state: Record<string, unknown>;
  readonly version: {
    readonly stateVersion: number;
    readonly lastEventSequence: number;
  };
  readonly targetEventSequence?: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RestorePreviewBody;
    assertRestorePreviewBody(body);

    const restoreResponse = await fetch(new URL(`/sessions/${encodeURIComponent(body.sessionId)}/preview-restore`, runtimeApiUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        state: body.state,
        version: {
          stateVersion: body.version.stateVersion,
          lastEventSequence: body.version.lastEventSequence
        },
        targetEventSequence: body.targetEventSequence,
        reason: "editor-preview-rollback"
      }),
      signal: AbortSignal.timeout(2500)
    });

    const payload = (await restoreResponse.json().catch(() => ({}))) as Record<string, unknown>;
    if (!restoreResponse.ok) {
      const message = typeof payload.error === "string"
        ? payload.error
        : `runtime-api preview restore returned HTTP ${restoreResponse.status}.`;
      return Response.json({ ok: false, error: message }, { status: restoreResponse.status });
    }

    return Response.json({
      ok: true,
      gameId: body.gameId,
      targetEventSequence: body.targetEventSequence,
      session: payload
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function assertRestorePreviewBody(body: RestorePreviewBody): asserts body is ValidRestorePreviewBody {
  if (typeof body.gameId !== "string" || body.gameId.trim() === "") {
    throw new EditorRepositoryError("Preview rollback requests require gameId.", 400);
  }
  if (typeof body.sessionId !== "string" || body.sessionId.trim() === "") {
    throw new EditorRepositoryError("Preview rollback requests require sessionId.", 400);
  }
  if (!isPlainRecord(body.state)) {
    throw new EditorRepositoryError("Preview rollback requests require a runtime state snapshot.", 400);
  }
  const version = body.version;
  if (!isPlainRecord(version)) {
    throw new EditorRepositoryError("Preview rollback requests require a runtime state version.", 400);
  }
  if (!isNonNegativeInteger(version.stateVersion) || !isNonNegativeInteger(version.lastEventSequence)) {
    throw new EditorRepositoryError("Preview rollback version fields must be non-negative integers.", 400);
  }
  if (body.targetEventSequence !== undefined && !isNonNegativeInteger(body.targetEventSequence)) {
    throw new EditorRepositoryError("Preview rollback targetEventSequence must be a non-negative integer.", 400);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected editor preview rollback failure." }, { status: 500 });
}
