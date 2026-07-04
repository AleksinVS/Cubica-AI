/**
 * Local baseline planner for AI-assisted editor prompts.
 *
 * A production agent will eventually call an external model, but the editor
 * still needs a deterministic, testable contract today: prompt in, bounded
 * ChangeSet out, no full-manifest rewrite. This planner intentionally handles
 * only simple text/label edits and rejects ambiguous prompts with diagnostics.
 */
import {
  buildJsonPointer,
  parseJsonPointer,
  readJsonPointer,
  type DocumentDiagnostic,
  type EditorChangeSet,
  type EditorPatchIntent,
  type JsonPatchOperation,
  type JsonValue
} from "@cubica/editor-engine";

export interface AiPatchTargetContext {
  readonly filePath: string;
  readonly pointer: string;
  readonly label?: string;
  readonly value: JsonValue;
}

export interface PlanAiChangeSetInput {
  readonly intent: EditorPatchIntent;
  readonly targets: readonly AiPatchTargetContext[];
  readonly now?: string;
}

export type PlanAiChangeSetResult =
  | {
      readonly ok: true;
      readonly changeSet: EditorChangeSet;
      readonly diagnostics: readonly DocumentDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly changeSet?: undefined;
      readonly diagnostics: readonly DocumentDiagnostic[];
    };

const textKeywords = ["text", "caption", "label", "текст", "надпись", "подпись"];
const labelKeywords = ["_label", "label", "title", "name", "название", "имя", "синоним", "переименуй", "назови"];

export function planAiChangeSet(input: PlanAiChangeSetInput): PlanAiChangeSetResult {
  const prompt = input.intent.prompt.trim();
  const requestedText = extractRequestedText(prompt);
  if (requestedText === undefined) {
    return rejectPlanner(
      "ai-planner",
      "",
      "Prompt is ambiguous for the local baseline planner. Use quotes or a phrase like: текст на \"Далее\"."
    );
  }

  const operationsByFile = new Map<string, JsonPatchOperation[]>();
  const diagnostics: DocumentDiagnostic[] = [];
  for (const target of input.targets) {
    const editTarget = chooseTextEditTarget(target, prompt);
    if (editTarget === undefined) {
      diagnostics.push(
        makePlannerDiagnostic(
          target.pointer,
          `No editable text or _label field was found for ${target.label ?? target.pointer}.`
        )
      );
      continue;
    }

    if (editTarget.before === requestedText) {
      diagnostics.push(makePlannerDiagnostic(editTarget.pointer, "Requested value is already applied."));
      continue;
    }

    const operations = operationsByFile.get(target.filePath) ?? [];
    if (editTarget.exists) {
      operations.push({ op: "test", path: editTarget.pointer, value: editTarget.before as JsonValue });
      operations.push({ op: "replace", path: editTarget.pointer, value: requestedText });
    } else {
      operations.push({ op: "add", path: editTarget.pointer, value: requestedText });
    }

    operationsByFile.set(target.filePath, operations);
  }

  const jsonPatches = [...operationsByFile.entries()].map(([filePath, operations]) => ({ filePath, operations }));
  if (jsonPatches.length === 0) {
    return {
      ok: false,
      diagnostics: diagnostics.length > 0 ? diagnostics : [makePlannerDiagnostic("", "Planner produced no JSON Patch operations.")]
    };
  }

  return {
    ok: true,
    changeSet: {
      id: `ai-change-${Date.parse(input.now ?? new Date().toISOString()) || Date.now()}`,
      intentId: input.intent.id,
      summary: `Изменить текст на "${requestedText}"`,
      jsonPatches,
      textPatches: [],
      fileCreates: [],
      fileDeletes: [],
      fileRenames: []
    },
    diagnostics
  };
}

function chooseTextEditTarget(
  target: AiPatchTargetContext,
  prompt: string
): { readonly pointer: string; readonly exists: boolean; readonly before: JsonValue | undefined } | undefined {
  if (!isJsonObject(target.value)) {
    return { pointer: target.pointer, exists: true, before: target.value };
  }

  const promptLower = prompt.toLocaleLowerCase("ru-RU");
  const preferredRelativePointers = labelKeywords.some((keyword) => promptLower.includes(keyword))
    ? ["_label", "title", "name", "props/text", "text", "body"]
    : textKeywords.some((keyword) => promptLower.includes(keyword))
      ? ["props/text", "text", "title", "body", "_label", "name"]
      : ["props/text", "text", "_label", "title", "name", "body"];

  for (const relativePointer of preferredRelativePointers) {
    const relative = `/${relativePointer}`;
    const before = readJsonPointer(target.value, relative);
    if (typeof before === "string") {
      return {
        pointer: joinJsonPointer(target.pointer, relativePointer.split("/")),
        exists: true,
        before
      };
    }
  }

  const fallbackField = labelKeywords.some((keyword) => promptLower.includes(keyword)) ? "_label" : "text";
  const fallbackPointer = joinJsonPointer(target.pointer, [fallbackField]);
  // WHY (Finding 7b): the loop above only matches candidates whose CURRENT value is a string.
  // A field can still exist at the fallback pointer with a non-string value (number, boolean,
  // object, array, or null) — e.g. `text` authored as a localization object instead of a
  // plain string. Treating that as `exists: false` would make the caller emit a bare JSON
  // Patch "add", which silently overwrites the existing non-string value with no guard. Read
  // the raw value at the fallback pointer (any type) so a genuinely existing field is guarded
  // with a "test" + "replace" pair, matching how the string-match branch above is guarded.
  const fallbackExistingValue = readJsonPointer(target.value, `/${fallbackField}`);
  if (fallbackExistingValue !== undefined) {
    return {
      pointer: fallbackPointer,
      exists: true,
      before: fallbackExistingValue
    };
  }

  return {
    pointer: fallbackPointer,
    exists: false,
    before: undefined
  };
}

function extractRequestedText(prompt: string): string | undefined {
  const quoted = /["“«']([^"”»']{1,160})["”»']/u.exec(prompt);
  if (quoted?.[1] !== undefined && quoted[1].trim() !== "") {
    return quoted[1].trim();
  }

  const colonText = /(?:текст|надпись|подпись|название|имя|синоним|label|title)\s*:\s*(.{1,160})$/iu.exec(prompt);
  if (colonText?.[1] !== undefined) {
    return cleanupRequestedText(colonText[1]);
  }

  const trailingText = /(?:текст|надпись|подпись|название|имя|синоним|переименуй|назови|label|title)[\s\S]{0,40}\s(?:на|в|to)\s+(.{1,160})$/iu.exec(
    prompt
  );
  if (trailingText?.[1] !== undefined) {
    return cleanupRequestedText(trailingText[1]);
  }

  return undefined;
}

function cleanupRequestedText(value: string): string | undefined {
  const cleaned = value.trim().replace(/[.!?。]+$/u, "").trim();
  return cleaned === "" ? undefined : cleaned;
}

function joinJsonPointer(parent: string, segments: readonly string[]): string {
  return buildJsonPointer([...parseJsonPointer(parent), ...segments]);
}

function rejectPlanner(source: string, pointer: string, message: string): PlanAiChangeSetResult {
  return {
    ok: false,
    diagnostics: [
      {
        severity: "error",
        source,
        pointer,
        message
      }
    ]
  };
}

function makePlannerDiagnostic(pointer: string, message: string): DocumentDiagnostic {
  return {
    severity: "error",
    source: "ai-planner",
    pointer,
    message
  };
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
