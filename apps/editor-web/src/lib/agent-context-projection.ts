/**
 * Scoped context projection for the editor assistant.
 *
 * CopilotKit sends this projection to the agent as user-facing context. The
 * projection deliberately includes selected pointers, summaries and diagnostics
 * instead of whole authoring manifests. Agent output must still become an
 * EditorChangeSet before Cubica applies any durable change.
 */
import type { CubicaAgentContext, CubicaAgentContextSource } from "@cubica/contracts-ai";
import {
  readJsonPointer,
  type DocumentDiagnostic,
  type EditorEntity,
  type EditorEntityFacetKind,
  type EditorEntitySourcePointer,
  type JsonValue
} from "@cubica/editor-engine";

import { EDITOR_AUTHORING_ASSISTANT_ID } from "./agent-assistant-registry";
import type { RoutedEditorDiagnostic } from "./editor-web-adapter";

export interface EditorAgentSelectedPointerContext {
  readonly pointer: string;
  readonly label?: string;
  readonly valueType: string;
  readonly excerpt: JsonValue | string;
  readonly redacted: boolean;
}

export interface EditorAgentSelectedEntityContext {
  readonly entityId: string;
  readonly kind: string;
  readonly label: string;
  readonly primarySource: EditorAgentEntitySourcePointerContext;
  readonly facets: Readonly<Partial<Record<EditorEntityFacetKind, readonly EditorAgentEntitySourcePointerContext[]>>>;
}

export interface EditorAgentEntitySourcePointerContext {
  readonly filePath: string;
  readonly pointer: string;
  readonly documentKind: string;
  readonly channel?: string;
  readonly role?: string;
  readonly label?: string;
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
  readonly selectedEditorEntities: readonly EditorAgentSelectedEntityContext[];
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
  readonly selectedEditorEntities?: readonly EditorEntity[];
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
  // WHY: dedup BEFORE measuring for the `truncated` flag. Callers (e.g. multi-select in the
  // editor UI) can legitimately send the same pointer twice; collapsing duplicates is not a
  // limit-driven truncation and must never flip `limits.truncated` to true on its own
  // (Finding 6 — false-positive truncation reporting).
  const dedupedSelectedPointers = [...new Set(input.selectedPointers)];
  // Track whether any individual pointer's projected value was actually cut down (either by
  // the array/object item caps inside redactAgentContextValue, or by the excerpt character
  // cap below) so the top-level `truncated` signal reflects real data loss, not just the
  // presence of arrays/objects.
  let anyPointerValueTruncated = false;
  const selectedPointers = dedupedSelectedPointers
    .slice(0, maxSelectedPointers)
    .map((pointer) => {
      const built = buildPointerContext(pointer, input.document, maxExcerptLength);
      anyPointerValueTruncated = anyPointerValueTruncated || built.truncated;
      return built.context;
    });
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
  const selectedEditorEntities = (input.selectedEditorEntities ?? [])
    .slice(0, maxSelectedPointers)
    .map(toAgentSelectedEntityContext);

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
    selectedEditorEntities,
    diagnostics,
    previewTraceSummary: input.previewTraceSummary,
    limits: {
      maxSelectedPointers,
      maxDiagnostics,
      maxExcerptLength,
      // WHY: compare the DEDUPED pointer count against the limit — comparing the raw,
      // pre-dedup input length here was the root cause of Finding 6: sending duplicate
      // pointers that fit under the limit once collapsed would still report `truncated: true`
      // even though nothing was actually dropped by a limit.
      truncated:
        dedupedSelectedPointers.length > maxSelectedPointers ||
        (input.selectedEditorEntities?.length ?? 0) > maxSelectedPointers ||
        (input.diagnostics?.length ?? 0) > maxDiagnostics ||
        anyPointerValueTruncated
    }
  };
}

function toAgentSelectedEntityContext(entity: EditorEntity): EditorAgentSelectedEntityContext {
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorAgentEntitySourcePointerContext[]>> = {};
  for (const [facetKind, sources] of Object.entries(entity.facets) as readonly [EditorEntityFacetKind, readonly EditorEntitySourcePointer[]][]) {
    facets[facetKind] = sources.map(toAgentEntitySourcePointerContext);
  }

  return {
    entityId: entity.entityId,
    kind: entity.kind,
    label: truncateText(entity.label, 120),
    primarySource: toAgentEntitySourcePointerContext(entity.primarySource),
    facets
  };
}

function toAgentEntitySourcePointerContext(source: EditorEntitySourcePointer): EditorAgentEntitySourcePointerContext {
  return {
    filePath: source.filePath,
    pointer: source.pointer,
    documentKind: source.documentKind,
    channel: source.channel,
    role: source.role,
    label: source.label === undefined ? undefined : truncateText(source.label, 120)
  };
}

export function redactAgentContextValue(
  value: JsonValue | undefined,
  path = ""
): { readonly value: JsonValue | string; readonly redacted: boolean; readonly truncated: boolean } {
  if (value === undefined) {
    return { value: "[unavailable]", redacted: false, truncated: false };
  }

  if (isForbiddenAgentContextPath(path)) {
    return { value: "[redacted]", redacted: true, truncated: false };
  }

  if (Array.isArray(value)) {
    let redacted = false;
    // WHY: `slice(0, 12)` below silently drops elements once the array is larger than the
    // cap. Finding 6 flagged this as a SILENT truncation (no signal was ever raised). Compute
    // the "did we actually drop anything" fact up front from the true length, then bubble it
    // (and any truncation from nested values) up to the caller via `limits.truncated`.
    let truncated = value.length > 12;
    const items = value.slice(0, 12).map((item, index) => {
      const child = redactAgentContextValue(item, `${path}/${index}`);
      redacted = redacted || child.redacted;
      truncated = truncated || child.truncated;
      return child.value as JsonValue;
    });
    return { value: items, redacted, truncated };
  }

  if (isPlainJsonObject(value)) {
    let redacted = false;
    const allEntries = Object.entries(value);
    // WHY: same silent-truncation risk as arrays above, but for object keys — the `slice(0,
    // 24)` cap must be reflected in `truncated` whenever the object actually has more keys
    // than the cap allows.
    let truncated = allEntries.length > 24;
    const entries = allEntries.slice(0, 24).map(([key, childValue]) => {
      const child = redactAgentContextValue(childValue, path === "" ? `/${key}` : `${path}/${key}`);
      redacted = redacted || child.redacted;
      truncated = truncated || child.truncated;
      return [key, child.value] as const;
    });
    return { value: Object.fromEntries(entries) as JsonValue, redacted, truncated };
  }

  return { value, redacted: false, truncated: false };
}

export function isForbiddenAgentContextPath(path: string): boolean {
  return secretPathPattern.test(path);
}

function buildPointerContext(
  pointer: string,
  document: JsonValue | undefined,
  maxExcerptLength: number
): { readonly context: EditorAgentSelectedPointerContext; readonly truncated: boolean } {
  const rawValue = document === undefined ? undefined : readJsonPointer(document, pointer);
  const redacted = redactAgentContextValue(rawValue, pointer);
  const excerpt = truncateJsonValue(redacted.value, maxExcerptLength);
  return {
    context: {
      pointer,
      valueType: getJsonValueType(rawValue),
      excerpt: excerpt.value,
      redacted: redacted.redacted
    },
    // WHY: a pointer's projected value can be truncated in two independent places — the
    // array/object item caps applied inside redactAgentContextValue, or the excerpt character
    // cap applied here. Either one means real data was dropped, so the caller needs the
    // combined signal (not just a heuristic string-endswith check on the final excerpt, which
    // could false-negative for nested truncation hidden inside the JSON before stringifying,
    // or false-positive for a legitimate value that happens to end in "...").
    truncated: redacted.truncated || excerpt.truncated
  };
}

function truncateJsonValue(value: JsonValue | string, maxLength: number): { readonly value: JsonValue | string; readonly truncated: boolean } {
  const json = typeof value === "string" ? value : JSON.stringify(value);
  if (json.length <= maxLength) {
    return { value, truncated: false };
  }

  return { value: `${json.slice(0, Math.max(0, maxLength - 3))}...`, truncated: true };
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
