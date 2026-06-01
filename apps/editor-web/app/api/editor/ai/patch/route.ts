/**
 * Creates a bounded ChangeSet from a preview AI prompt.
 *
 * The route receives only scoped target context, not whole authoring manifests.
 * That keeps large files out of the prompt boundary and lets the browser run
 * the final dry-run/validation gate before automatic apply.
 */
import { type EditorPatchIntent } from "@cubica/editor-engine";

import { planAiChangeSet, type AiPatchTargetContext } from "@/lib/ai-change-planner";
import { EditorRepositoryError } from "@/lib/editor-repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<{
      readonly intent: EditorPatchIntent;
      readonly targets: readonly AiPatchTargetContext[];
    }>;

    if (!isPatchIntent(body.intent) || !Array.isArray(body.targets) || !body.targets.every(isTargetContext)) {
      throw new EditorRepositoryError("AI patch requests require an intent and scoped target contexts.", 400);
    }

    return Response.json(planAiChangeSet({ intent: body.intent, targets: body.targets }));
  } catch (error) {
    return errorResponse(error);
  }
}

function isPatchIntent(value: unknown): value is EditorPatchIntent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<EditorPatchIntent>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.prompt === "string" &&
    typeof candidate.activeFilePath === "string" &&
    Array.isArray(candidate.targetPointers) &&
    candidate.targetPointers.every((pointer) => typeof pointer === "string") &&
    typeof candidate.createdAt === "string"
  );
}

function isTargetContext(value: unknown): value is AiPatchTargetContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<AiPatchTargetContext>;
  return typeof candidate.filePath === "string" && typeof candidate.pointer === "string" && candidate.value !== undefined;
}

function errorResponse(error: unknown): Response {
  if (error instanceof EditorRepositoryError) {
    return Response.json({ error: error.message }, { status: error.statusCode });
  }

  return Response.json({ error: error instanceof Error ? error.message : "Unexpected AI patch planner failure." }, { status: 500 });
}
