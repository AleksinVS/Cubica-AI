/**
 * Pure aggregation helpers for the «Проверки» (Checks) sidebar tab.
 *
 * This module turns the several diagnostic streams the editor already collects
 * (schema/syntax/semantic, reverse-projection, AI, workflow, plugin, and the
 * entity-projection identity checks) into ONE flat, deduplicated, severity-sorted
 * list of {@link WorkspaceCheckItem} rows — the model behind the Checks tab
 * (design-spec §3.5; editor-preview-first-ux §9.6; ADR-057 §4.12).
 *
 * It is deliberately game-agnostic and side-effect free: no game ids, no
 * hardcoded manifest shapes, only generic diagnostic `source`/`code` strings. The
 * controller wires the live streams in; the panel renders the returned rows. Both
 * navigation (pointer → entity → field) and the deterministic quick fixes are
 * driven off the resolved-entity metadata computed here.
 *
 * Terminology: a "diagnostic" is a single validation finding (severity + message
 * + a JSON Pointer into an authoring document); an "entity" is the editor's
 * cross-document projection of one authored object (a screen, a card, an action).
 */
import type {
  DiagnosticSeverity,
  EditorEntity,
  EditorEntityProjection,
  EditorEntityProjectionDocument,
  EditorEntityProjectionDiagnostic,
  JsonValue
} from "@cubica/editor-engine";
import { isPlainJsonObject } from "@cubica/editor-engine";

import type { RoutedEditorDiagnostic } from "@/lib/editor-web-adapter";

/**
 * Severity buckets the Checks tab groups by. The engine only emits
 * `error`/`warning` today (see `DiagnosticSeverity`), but the registry (design-spec
 * §4) reserves `info` for softer notices, so the model carries it forward and the
 * panel simply omits empty groups.
 */
export type WorkspaceCheckSeverity = "error" | "warning" | "info";

/**
 * Deterministic quick-fix kinds the Checks tab can prepare as a ChangeSet:
 * - `create-view`: a game entity that requires a view has none in the active
 *   channel → add the missing UI facet (`buildAddViewFacetChangeSet`).
 * - `fill-label`: a tree-visible entity is missing a non-empty `_label` → fill a
 *   derived default so the manifest stops being blocked (Вариант А,
 *   `buildFillEntityLabelChangeSet`). Repeated `fill-label` rows also power the
 *   group-level «Исправить все» bulk fix.
 */
export type WorkspaceCheckQuickFix = "create-view" | "fill-label";

/**
 * One row in the Checks tab: a single diagnostic, enriched with the entity it
 * points at (when one resolves) so the row can show the entity `_label`, navigate
 * to it, and offer a deterministic quick fix.
 */
export interface WorkspaceCheckItem {
  /** Stable identity for React keys and test lookups. */
  readonly id: string;
  readonly severity: WorkspaceCheckSeverity;
  readonly message: string;
  /** Raw diagnostic source (e.g. "schema", "plugin", "projection"). */
  readonly source: string;
  /** Stable diagnostic code from the registry, when present. */
  readonly code?: string;
  /** Channel the finding was evaluated for; explicit metadata, never message parsing. */
  readonly channel?: string;
  /** Short Russian facet/source badge shown on the row (mockup: «смысл», «сценарий»). */
  readonly badge: string;
  /** File the diagnostic points into (active document when unspecified). */
  readonly filePath?: string;
  readonly pointer: string;
  /** Projection entity id the diagnostic resolves to, when any. */
  readonly entityId?: string;
  /** `_label` of the resolved entity, shown next to the message. */
  readonly entityLabel?: string;
  /** A prepared, deterministic quick fix, when the diagnostic admits one. */
  readonly quickFix?: WorkspaceCheckQuickFix;
}

/** Grouped, severity-ordered view of the check list for the panel. */
export interface WorkspaceCheckGroup {
  readonly severity: WorkspaceCheckSeverity;
  readonly items: readonly WorkspaceCheckItem[];
}

/** Per-severity + total counts for the status-bar counter and activity-bar badge. */
export interface WorkspaceCheckCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly total: number;
}

/** Render order for the severity groups (most severe first). */
const SEVERITY_ORDER: readonly WorkspaceCheckSeverity[] = ["error", "warning", "info"];

/**
 * Facet/source badge by diagnostic code — the domain flavour shown on each row.
 * «смысл» = identity/semantic checks; «сценарий» = flow reachability, etc. Keyed
 * on generic registry codes only (never on a concrete game).
 */
const BADGE_BY_CODE: Readonly<Record<string, string>> = {
  "entity-missing-view": "смысл",
  "entity-missing-label": "смысл",
  "entity-view-orphan": "смысл",
  "unresolved-view-link": "смысл",
  "unresolved-action-link": "смысл",
  "ambiguous-view-link": "смысл",
  "unresolved-source-pointer": "смысл",
  "stale-source-hash": "смысл",
  "hidden-technical-field": "смысл",
  "scenario-dead-end": "сценарий",
  "scenario-unreachable": "сценарий",
  "fixture-stale": "фикстура",
  "fixture-unknown-ref": "фикстура",
  "intent-stale": "интент",
  "prompt-stale": "промт",
  "asset-orphan": "ассет"
};

/** Fallback badge by raw diagnostic source when no code-specific badge exists. */
const BADGE_BY_SOURCE: Readonly<Record<string, string>> = {
  schema: "схема",
  syntax: "синтаксис",
  semantic: "смысл",
  projection: "смысл",
  plugin: "плагин",
  "plugin-contribution": "плагин",
  "change-set": "правка",
  "ai-planner": "агент",
  reverse: "правка"
};

/** Picks the short Russian badge for a diagnostic from its code, else its source. */
function badgeFor(source: string, code: string | undefined): string {
  if (code !== undefined && BADGE_BY_CODE[code] !== undefined) {
    return BADGE_BY_CODE[code];
  }
  return BADGE_BY_SOURCE[source] ?? source;
}

/** Parent JSON Pointer, or `undefined` at the document root. */
function parentPointerOf(pointer: string): string | undefined {
  if (pointer === "") {
    return undefined;
  }
  const index = pointer.lastIndexOf("/");
  return index <= 0 ? "" : pointer.slice(0, index);
}

/**
 * Finds the nearest projection entity whose source pointer is at or above the
 * given pointer in the given file. Walking up the pointer means a diagnostic deep
 * inside an entity (e.g. on one of its fields) still resolves to that entity, so
 * the row can label and navigate to it (§9.6 "указатель → сущность").
 */
export function resolveEntityForPointer(
  projection: EditorEntityProjection,
  filePath: string,
  pointer: string
): EditorEntity | undefined {
  let current: string | undefined = pointer;
  while (current !== undefined) {
    const matches = projection.entitiesBySourcePointer.get(`${filePath}#${current}`);
    if (matches !== undefined && matches.length > 0) {
      return matches[0];
    }
    current = parentPointerOf(current);
  }
  return undefined;
}

/** Normalises any diagnostic severity string into a Checks bucket. */
function toCheckSeverity(severity: DiagnosticSeverity | string): WorkspaceCheckSeverity {
  return severity === "error" || severity === "warning" ? severity : "info";
}

/**
 * Finds channels where the current add-view operation has a proven target.
 * The operation currently writes to `/root/children`; other channel shapes are
 * deliberately excluded until their schema exposes an explicit container.
 */
export function collectKnownViewCreationChannels(
  documents: readonly EditorEntityProjectionDocument[]
): readonly string[] {
  const channels = new Set<string>();
  for (const document of documents) {
    if (document.documentKind !== "ui" || document.channel === undefined) continue;
    const json = document.json;
    if (!isPlainJsonObject(json)) continue;
    // The package's recursive JSON union can retain its readonly-array branch
    // across the workspace declaration boundary even after the shared predicate
    // succeeds. The narrow structural view is safe here because the runtime
    // guard above has already excluded arrays, primitives and null.
    const root = (json as { readonly root?: JsonValue }).root;
    if (!isPlainJsonObject(root)) continue;
    if (Array.isArray(root.children)) channels.add(document.channel);
  }
  return [...channels];
}

interface AggregateWorkspaceChecksInput {
  /** Schema/syntax/semantic + reverse + AI + workflow diagnostics (already merged on the view model). */
  readonly routedDiagnostics: readonly RoutedEditorDiagnostic[];
  /** Plugin-validation diagnostics (may overlap workflow — deduplicated here). */
  readonly pluginDiagnostics: readonly RoutedEditorDiagnostic[];
  /** Entity-projection identity/link diagnostics (`entity-missing-view`, …). */
  readonly projectionDiagnostics: readonly EditorEntityProjectionDiagnostic[];
  /** The projection, used to resolve a diagnostic pointer to an entity + `_label`. */
  readonly projection: EditorEntityProjection;
  /** Active document path, used when a routed diagnostic omits its `filePath`. */
  readonly activeFilePath: string;
  /** Channel used to build projection diagnostics such as `entity-missing-view`. */
  readonly activeChannel?: string;
  /** Channels whose UI document has a schema-known insertion container. */
  readonly viewCreationChannels?: readonly string[];
}

/**
 * Aggregates every diagnostic stream into one deduplicated, severity-sorted list
 * of Checks rows. Deduplication keys on severity+source+file+pointer+message so a
 * plugin finding surfaced twice (workflow + plugin streams) appears once.
 */
export function aggregateWorkspaceChecks(input: AggregateWorkspaceChecksInput): readonly WorkspaceCheckItem[] {
  const items: WorkspaceCheckItem[] = [];
  const seen = new Set<string>();

  const pushRouted = (diagnostic: RoutedEditorDiagnostic) => {
    const filePath = diagnostic.filePath ?? input.activeFilePath;
    const key = `${diagnostic.severity}|${diagnostic.source}|${filePath}|${diagnostic.pointer}|${diagnostic.message}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const entity = resolveEntityForPointer(input.projection, filePath, diagnostic.pointer);
    // Missing/empty `_label` (schema.ts semantic check) → the deterministic
    // «fill-label» quick fix (Вариант А). Detected declaratively by the stable
    // registry code `entity-missing-label` (schema.ts) — no message-string match
    // and no per-game logic (TSK-20260708 follow-up).
    const isMissingLabel = diagnostic.code === "entity-missing-label";
    items.push({
      id: `check-${items.length}`,
      severity: toCheckSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source,
      code: diagnostic.code,
      ...(diagnostic.code === "entity-missing-view" && input.activeChannel !== undefined
        ? { channel: input.activeChannel }
        : {}),
      badge: badgeFor(diagnostic.source, diagnostic.code),
      filePath,
      pointer: diagnostic.pointer,
      entityId: entity?.entityId,
      entityLabel: entity?.label,
      quickFix: isMissingLabel && entity !== undefined ? "fill-label" : undefined
    });
  };

  for (const diagnostic of input.routedDiagnostics) {
    pushRouted(diagnostic);
  }
  for (const diagnostic of input.pluginDiagnostics) {
    pushRouted(diagnostic);
  }

  for (const diagnostic of input.projectionDiagnostics) {
    const filePath = diagnostic.source.filePath;
    const pointer = diagnostic.source.pointer;
    const key = `${diagnostic.severity}|projection|${filePath}|${pointer}|${diagnostic.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const entity = resolveEntityForPointer(input.projection, filePath, pointer);
    items.push({
      id: `check-${items.length}`,
      severity: toCheckSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: "projection",
      code: diagnostic.code,
      ...(diagnostic.code === "entity-missing-view" && input.activeChannel !== undefined
        ? { channel: input.activeChannel }
        : {}),
      badge: badgeFor("projection", diagnostic.code),
      filePath,
      pointer,
      entityId: entity?.entityId,
      entityLabel: diagnostic.source.label ?? entity?.label,
      // The ONLY deterministic quick fix in this slice: a game entity that
      // requires a view but has none in the active channel → «Создать вид»
      // (reuses `buildAddViewFacetChangeSet`; design-spec §3.5).
      // Adding into a guessed `/root/children` container can corrupt a channel
      // document whose schema uses another shape. Offer the action only when the
      // caller has positively identified a writable container for this channel.
      quickFix:
        diagnostic.code === "entity-missing-view" &&
        entity !== undefined &&
        input.activeChannel !== undefined &&
        input.viewCreationChannels?.includes(input.activeChannel)
          ? "create-view"
          : undefined
    });
  }

  return items;
}

export interface WorkspaceChannelDiagnosticNavigation {
  readonly previewChannel: "telegram";
  readonly entityId: string;
  readonly callout: { readonly entityId: string; readonly label: string };
}

/**
 * Maps a channel diagnostic to UI navigation using stable code/channel fields.
 * Messages are intentionally ignored: translated or reworded diagnostics must
 * still open the same renderer and entity inspector.
 */
export function channelDiagnosticNavigation(
  item: WorkspaceCheckItem
): WorkspaceChannelDiagnosticNavigation | undefined {
  if (item.code !== "entity-missing-view" || item.channel !== "telegram" || item.entityId === undefined) {
    return undefined;
  }
  return {
    previewChannel: "telegram",
    entityId: item.entityId,
    callout: { entityId: item.entityId, label: item.entityLabel ?? "Выбранная сущность" }
  };
}

/** Groups checks by severity in render order, dropping empty groups. */
export function groupChecksBySeverity(checks: readonly WorkspaceCheckItem[]): readonly WorkspaceCheckGroup[] {
  return SEVERITY_ORDER.map((severity) => ({
    severity,
    items: checks.filter((item) => item.severity === severity)
  })).filter((group) => group.items.length > 0);
}

/** Per-severity + total counts for the status bar counter and activity-bar badge. */
export function summarizeCheckCounts(checks: readonly WorkspaceCheckItem[]): WorkspaceCheckCounts {
  let error = 0;
  let warning = 0;
  let info = 0;
  for (const item of checks) {
    if (item.severity === "error") {
      error += 1;
    } else if (item.severity === "warning") {
      warning += 1;
    } else {
      info += 1;
    }
  }
  return { error, warning, info, total: checks.length };
}

/** Human-readable Russian severity label for the group heading. */
export function checkSeverityLabel(severity: WorkspaceCheckSeverity): string {
  if (severity === "error") {
    return "Ошибки";
  }
  if (severity === "warning") {
    return "Предупреждения";
  }
  return "Замечания";
}
