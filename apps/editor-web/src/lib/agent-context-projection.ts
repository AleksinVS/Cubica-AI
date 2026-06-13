/**
 * Scoped context projection for the editor assistant.
 *
 * CopilotKit sends this projection to the agent as user-facing context. The
 * projection deliberately includes selected pointers, summaries and diagnostics
 * instead of whole authoring manifests. Agent output must still become an
 * EditorChangeSet before Cubica applies any durable change.
 */
import type { CubicaAgentContext, CubicaAgentContextSource } from "@cubica/contracts-ai";
import { readJsonPointer, type DocumentDiagnostic, type JsonValue } from "@cubica/editor-engine";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "./agent-assistant-registry";
import type { RoutedEditorDiagnostic } from "./editor-web-adapter";

export interface EditorAgentSelectedPointerContext {
  readonly pointer: string;
  readonly label?: string;
  readonly valueType: string;
  readonly excerpt: JsonValue | string;
  readonly redacted: boolean;
}

interface EditorAgentContextSource extends CubicaAgentContextSource {
  readonly app: "apps/editor-web";
  readonly sessionId?: string;
  readonly gameId: string;
  readonly activeFilePath: string;
  readonly activeFileVersionHash?: string;
}

export interface EditorAgentContextProjection extends CubicaAgentContext<EditorAgentContextSource> {
  readonly contextVersion: 1;
  readonly agentId: typeof EDITOR_AUTHORING_ASSISTANT_ID;
  readonly source: EditorAgentContextSource;
  readonly selectedPointers: readonly EditorAgentSelectedPointerContext[];
  readonly selectedPreviewEntities: readonly {
    readonly entityId: string;
    readonly label: string;
    readonly semanticRole: string;
    readonly authoringPointer: string;
  }[];
  readonly diagnostics: readonly {
    readonly severity: DocumentDiagnostic["severity"];
    readonly source: string;
    readonly pointer: string;
    readonly message: string;
  }[];
  readonly previewTraceSummary?: {
    readonly traceId: string;
    readonly eventCount: number;
    readonly currentEventLabel?: string;
    readonly selectedEventLabel?: string;
  };
  readonly limits: {
    readonly maxSelectedPointers: number;
    readonly maxDiagnostics: number;
    readonly maxExcerptLength: number;
    readonly truncated: boolean;
  };
}

export interface BuildEditorAgentContextProjectionInput {
  readonly sessionId?: string;
  readonly gameId: string;
  readonly activeFilePath: string;
  readonly activeFileVersionHash?: string;
  readonly document: JsonValue | undefined;
  readonly selectedPointers: readonly string[];
  readonly selectedPreviewEntities?: readonly {
    readonly entityId: string;
    readonly label: string;
    readonly semanticRole: string;
    readonly authoringPointer: string;
  }[];
  readonly diagnostics?: readonly (DocumentDiagnostic | RoutedEditorDiagnostic)[];
  readonly previewTraceSummary?: EditorAgentContextProjection["previewTraceSummary"];
  readonly maxSelectedPointers?: number;
  readonly maxDiagnostics?: number;
  readonly maxExcerptLength?: number;
}

const secretPathPattern = /(^|\/|\.)(secret|secrets|password|token|api[-_]?key|private|credential|authorization)(\/|\.|$)/iu;
const defaultMaxSelectedPointers = 8;
const defaultMaxDiagnostics = 12;
const defaultMaxExcerptLength = 900;

export function buildEditorAgentContextProjection(
  input: BuildEditorAgentContextProjectionInput
): EditorAgentContextProjection {
  const maxSelectedPointers = input.maxSelectedPointers ?? defaultMaxSelectedPointers;
  const maxDiagnostics = input.maxDiagnostics ?? defaultMaxDiagnostics;
  const maxExcerptLength = input.maxExcerptLength ?? defaultMaxExcerptLength;
  const selectedPointers = [...new Set(input.selectedPointers)]
    .slice(0, maxSelectedPointers)
    .map((pointer) => buildPointerContext(pointer, input.document, maxExcerptLength));
  const diagnostics = (input.diagnostics ?? []).slice(0, maxDiagnostics).map((diagnostic) => ({
    severity: diagnostic.severity,
    source: diagnostic.source,
    pointer: diagnostic.pointer,
    message: truncateText(diagnostic.message, 260)
  }));
  const selectedPreviewEntities = (input.selectedPreviewEntities ?? []).slice(0, maxSelectedPointers).map((entity) => ({
    entityId: entity.entityId,
    label: truncateText(entity.label, 120),
    semanticRole: entity.semanticRole,
    authoringPointer: entity.authoringPointer
  }));

  return {
    contextVersion: 1,
    agentId: EDITOR_AUTHORING_ASSISTANT_ID,
    source: {
      app: "apps/editor-web",
      sessionId: input.sessionId,
      gameId: input.gameId,
      activeFilePath: input.activeFilePath,
      activeFileVersionHash: input.activeFileVersionHash
    },
    selectedPointers,
    selectedPreviewEntities,
    diagnostics,
    previewTraceSummary: input.previewTraceSummary,
    limits: {
      maxSelectedPointers,
      maxDiagnostics,
      maxExcerptLength,
      truncated:
        input.selectedPointers.length > maxSelectedPointers ||
        (input.diagnostics?.length ?? 0) > maxDiagnostics ||
        selectedPointers.some((pointer) => typeof pointer.excerpt === "string" && pointer.excerpt.endsWith("..."))
    }
  };
}

export function redactAgentContextValue(value: JsonValue | undefined, path = ""): { readonly value: JsonValue | string; readonly redacted: boolean } {
  if (value === undefined) {
    return { value: "[unavailable]", redacted: false };
  }

  if (isForbiddenAgentContextPath(path)) {
    return { value: "[redacted]", redacted: true };
  }

  if (Array.isArray(value)) {
    let redacted = false;
    const items = value.slice(0, 12).map((item, index) => {
      const child = redactAgentContextValue(item, `${path}/${index}`);
      redacted = redacted || child.redacted;
      return child.value as JsonValue;
    });
    return { value: items, redacted };
  }

  if (isPlainJsonObject(value)) {
    let redacted = false;
    const entries = Object.entries(value)
      .slice(0, 24)
      .map(([key, childValue]) => {
        const child = redactAgentContextValue(childValue, path === "" ? `/${key}` : `${path}/${key}`);
        redacted = redacted || child.redacted;
        return [key, child.value] as const;
      });
    return { value: Object.fromEntries(entries) as JsonValue, redacted };
  }

  return { value, redacted: false };
}

export function isForbiddenAgentContextPath(path: string): boolean {
  return secretPathPattern.test(path);
}

function buildPointerContext(pointer: string, document: JsonValue | undefined, maxExcerptLength: number): EditorAgentSelectedPointerContext {
  const rawValue = document === undefined ? undefined : readJsonPointer(document, pointer);
  const redacted = redactAgentContextValue(rawValue, pointer);
  return {
    pointer,
    valueType: getJsonValueType(rawValue),
    excerpt: truncateJsonValue(redacted.value, maxExcerptLength),
    redacted: redacted.redacted
  };
}

function truncateJsonValue(value: JsonValue | string, maxLength: number): JsonValue | string {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (json.length <= maxLength) {
    return value;
  }

  return `${json.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function getJsonValueType(value: JsonValue | undefined): string {
  if (value === undefined) {
    return "undefined";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function isPlainJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
