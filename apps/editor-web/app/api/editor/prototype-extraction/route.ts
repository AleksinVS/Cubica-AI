/**
 * Plans an ADR-050 prototype extraction proposal for the active authoring file.
 *
 * The route is read-only: it builds and validates a proposal, but never writes
 * generated manifests and never applies the returned EditorChangeSet. The
 * editor must still dry-run, approve and apply through the normal ChangeSet
 * flow.
 */
import type { JsonObject, PrototypeExtractionClassification } from "@cubica/editor-engine";

import { planPrototypeExtractionForEditor } from "@/lib/compiler-workflow";
import { configuredEditorProjectRoot } from "@/lib/editor-project-root";
import { EditorRepositoryError } from "@/lib/editor-repository";
import { repoRootForSession } from "@/lib/editor-session-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly gameId: string;
      readonly filePath: string;
      readonly text: string;
      readonly sourcePointers: readonly unknown[];
      readonly definitionType: string;
      readonly definitionSemantics: string;
      readonly promptTemplate: unknown;
      readonly classification: PrototypeExtractionClassification;
      readonly knownVariantKeys: readonly unknown[];
      readonly sessionId: string;
    }>;

    if (typeof body.gameId !== "string" || typeof body.filePath !== "string" || typeof body.text !== "string") {
      throw new EditorRepositoryError("Prototype extraction requests require gameId, filePath, and text.", 400);
    }

    const { repoRoot } = await repoRootForSession(body.sessionId, body.gameId);
    return Response.json(
      await planPrototypeExtractionForEditor({
        gameId: body.gameId,
        filePath: body.filePath,
        text: body.text,
        sourcePointers: stringArrayOrUndefined(body.sourcePointers),
        definitionType: typeof body.definitionType === "string" ? body.definitionType : undefined,
        definitionSemantics: typeof body.definitionSemantics === "string" ? body.definitionSemantics : undefined,
        promptTemplate: isJsonObject(body.promptTemplate) ? body.promptTemplate : undefined,
        classification: acceptedClassificationOrUndefined(body.classification),
        knownVariantKeys: stringArrayOrUndefined(body.knownVariantKeys),
        repoRoot: repoRoot ?? configuredEditorProjectRoot()
      })
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function stringArrayOrUndefined(value: readonly unknown[] | undefined): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return strings.length === 0 ? undefined : strings;
}

function acceptedClassificationOrUndefined(
  value: PrototypeExtractionClassification | undefined
): "game-level" | "candidate-for-platform" | undefined {
  return value === "game-level" || value === "candidate-for-platform" ? value : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected prototype extraction planning failure." }, { status: 500 });
}
