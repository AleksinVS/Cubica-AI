"use client";

/**
 * Floating entity inspector (design-spec §3.2, editor-preview-first-ux §4;
 * mockup ЗОНА 4).
 *
 * The "inspector" (инспектор) is a small floating panel that appears next to the
 * currently selected game entity, on top of the preview projection. It shows the
 * whole entity as one object even though the entity is physically split across
 * authoring documents ("фасеты" — facets, one per source manifest):
 *
 *   - header: the entity `_label` (inline-editable when its source is the open
 *     document), a prototype tag from `_type`, and the mockup's "источник ⌗" /
 *     "закрепить 📌" icons (rendered but inert this slice — Phase 4 / dock);
 *   - facet chips: «Смысл» / «Содержание» / «Вид · <канал>», derived from which
 *     facets the entity actually has, with a channel switcher on «Вид»;
 *   - fields grouped by facet, each with a small source badge («игра» /
 *     «UI · <канал>» / «ассет») and a highlight on fields an agent just changed;
 *   - a prompt row pinned to the bottom («✦ Промт…» + «→ В чат сессии»).
 *
 * Data-only: it reads the neutral `EditorEntity` projection plus the authoring
 * documents and reports edits back through callbacks — it owns no authoring data
 * and hardcodes no game/channel/type ids (CLAUDE §10). Same React discipline as
 * `EntityTree` / `PropertyPanel`.
 */
import {
  isPlainJsonObject,
  readJsonPointer,
  type EditorEntity,
  type EditorEntityFacetKind,
  type EditorEntityProjectionDocument,
  type EditorEntitySourcePointer,
  type JsonValue,
  type PreviewRect,
  type ReturnedIntentInput
} from "@cubica/editor-engine";
import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import {
  EntitySourceTextMode,
  type EntitySourceCapture,
  type ReturnedIntentApplyOutcome
} from "@/components/workspace/entity-source-text-mode";

/**
 * The three canonical facet buckets of the mockup / UX doc §2. The engine models
 * a finer 6-kind facet set; the panel folds those into the three chips the mockup
 * shows. Meaning ("Смысл") = game mechanics/logic; Content ("Содержание") =
 * authored content; View ("Вид") = channel UI. The fold is by facet kind + doc
 * kind only, never by game id, so it stays game-agnostic.
 */
type FacetBucketId = "meaning" | "content" | "view";
const facetBucketOfKind: Readonly<Record<EditorEntityFacetKind, FacetBucketId>> = {
  logic: "meaning",
  state: "meaning",
  plugin: "meaning",
  content: "content",
  view: "view",
  design: "view"
};
/** Same iteration order the engine's YAML projection uses, so field order matches. */
const orderedFacetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "state", "view", "design", "plugin"];
const bucketOrder: readonly FacetBucketId[] = ["meaning", "content", "view"];
const bucketLabel: Readonly<Record<FacetBucketId, string>> = { meaning: "Смысл", content: "Содержание", view: "Вид" };

type InspectorValueType = "string" | "number" | "boolean" | "array" | "object" | "null";

/** One significant field of one facet source (the reused "значимые поля" logic). */
interface InspectorFieldRow {
  readonly pointer: string;
  readonly label: string;
  readonly value: JsonValue;
  readonly valueType: InspectorValueType;
  readonly source: EditorEntitySourcePointer;
  readonly badge: string;
  /** The field's source is the OPEN document, so it can be edited in place. */
  readonly editableInDoc: boolean;
  /** The field was touched by the last applied agent ChangeSet (mockup `.hl`). */
  readonly changedByAgent: boolean;
}

/** The minimal field descriptor the edit callback needs to route a value change. */
export interface InspectorEditableField {
  readonly pointer: string;
  readonly value: JsonValue;
  readonly valueType: InspectorValueType;
}

export interface EntityInspectorProps {
  /** Resolved selected entity, or `undefined` to render nothing (just the layer). */
  readonly entity: EditorEntity | undefined;
  /** Authoring documents paired with the projection (to read field values). */
  readonly documents: readonly EditorEntityProjectionDocument[];
  /** Open document's preview channel; the default channel shown on the «Вид» chip. */
  readonly activeChannel: string | undefined;
  /** File path of the OPEN authoring document (fields from it are editable). */
  readonly currentFilePath: string;
  /** Selection bounds in preview coordinates, for the free-quadrant placement. */
  readonly selectionBounds: PreviewRect | undefined;
  /** `"<filePath>#<pointer>"` keys the last agent apply changed (for `.hl`). */
  readonly changedPointerKeys: ReadonlySet<string>;
  readonly onClose: () => void;
  /** Applies an edit to a field whose source is the open document. */
  readonly onFieldEdit: (field: InspectorEditableField, rawValue: string) => void;
  /** Opens another authoring document (cross-document read-only affordance). */
  readonly onOpenFile: (filePath: string) => void;
  /**
   * Captures the entity's prompt-projection text + facet source map + source
   * hashes for the text mode («источник», Phase 4.2). When omitted the «⌗» icon
   * stays inert (single-entity mode only; there is no multi-select in this UI).
   */
  readonly onCaptureEntitySource?: (entity: EditorEntity) => EntitySourceCapture | undefined;
  /** Runs an edited returned intent through the interpreter → shared pipeline. */
  readonly onApplyReturnedIntent?: (input: ReturnedIntentInput) => ReturnedIntentApplyOutcome;
  /**
   * Refactor affordances (Phase 6.2b, design-spec §3.2). When a callback is
   * omitted its control is hidden (for example the embedded fallback, which has no
   * worktree to persist sibling facets into, and the unit harness). «создать вид»
   * adds the missing UI facet; «Переименовать»/«Удалить» open the dangerous
   * refactor dialogs, which the controller gates behind an approval envelope.
   */
  readonly onCreateView?: (entity: EditorEntity) => void;
  readonly onRequestRename?: (entity: EditorEntity) => void;
  readonly onRequestDelete?: (entity: EditorEntity) => void;
}

const panelWidthPx = 340;
const placementGapPx = 12;
const placementMarginPx = 12;

export function EntityInspector({
  entity,
  documents,
  activeChannel,
  currentFilePath,
  selectionBounds,
  changedPointerKeys,
  onClose,
  onFieldEdit,
  onOpenFile,
  onCaptureEntitySource,
  onApplyReturnedIntent,
  onCreateView,
  onRequestRename,
  onRequestDelete
}: EntityInspectorProps) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ readonly w: number; readonly h: number }>({ w: 0, h: 0 });

  // Text mode («источник»): the immutable capture is held here while the mode is
  // open (`null` = form mode). Opening/refreshing re-captures from the live docs.
  // The mode is single-entity by definition (design-spec §3.2); switching entities
  // reuses the window, so the capture is reset when the entity id changes.
  const [sourceCapture, setSourceCapture] = useState<EntitySourceCapture | null>(null);
  const [sourceModeEntityId, setSourceModeEntityId] = useState<string | undefined>(entity?.entityId);
  if (sourceModeEntityId !== entity?.entityId) {
    setSourceModeEntityId(entity?.entityId);
    setSourceCapture(null);
  }
  const sourceModeAvailable = onCaptureEntitySource !== undefined && onApplyReturnedIntent !== undefined;

  const documentsByPath = new Map(documents.map((document) => [document.filePath, document]));
  const viewSources = entity === undefined ? [] : [...(entity.facets.view ?? []), ...(entity.facets.design ?? [])];
  const viewChannels = uniqueChannels(viewSources);
  const defaultChannel = activeChannel !== undefined && viewChannels.includes(activeChannel) ? activeChannel : viewChannels[0];

  // Which view channel the panel shows. Re-seeded to the default whenever a
  // DIFFERENT entity is selected (the "переключение сущности переиспользует окно"
  // rule keeps one panel instance, so channel state is reset here, not by
  // remount — same derived-state pattern as EntityTree's grouping seed).
  const [displayChannel, setDisplayChannel] = useState<string | undefined>(defaultChannel);
  const [seededEntityId, setSeededEntityId] = useState<string | undefined>(entity?.entityId);
  if (seededEntityId !== entity?.entityId) {
    setSeededEntityId(entity?.entityId);
    setDisplayChannel(defaultChannel);
  }
  const effectiveChannel = displayChannel ?? defaultChannel;

  // Measure the layer (it fills the preview stage) so the free-quadrant placement
  // knows whether the panel fits to the right/left of the selection.
  useLayoutEffect(() => {
    if (layerRef.current !== null) {
      setContainerSize({ w: layerRef.current.clientWidth, h: layerRef.current.clientHeight });
    }
  }, [selectionBounds, entity?.entityId]);

  // Esc closes the panel (design-spec §3.2), only while one is shown.
  useEffect(() => {
    if (entity === undefined) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [entity, onClose]);

  if (entity === undefined) {
    // Still render the (empty) layer so it can be measured before a selection
    // exists; it is pointer-events:none, so it never blocks the preview.
    return <div ref={layerRef} className="entity-inspector-layer" aria-hidden="true" />;
  }

  const primaryObject = readObject(documentsByPath, entity.primarySource.filePath, entity.primarySource.pointer);
  const prototypeType = typeof primaryObject?._type === "string" ? primaryObject._type : undefined;
  const labelEditable = entity.primarySource.filePath === currentFilePath && typeof primaryObject?._label === "string";
  // `entity-missing-view` (Phase 1.5) means "type requires a view but has none":
  // the «Вид» chip becomes a "создать вид" warning; a truly non-visual entity has
  // neither a view facet nor this diagnostic, so it gets no «Вид» chip at all.
  const requiresView = entity.diagnostics.some((diagnostic) => diagnostic.code === "entity-missing-view");

  const isChanged = (filePath: string, pointer: string): boolean => {
    const prefix = `${filePath}#`;
    for (const changed of changedPointerKeys) {
      if (changed.startsWith(prefix) && pointersRelated(pointer, changed.slice(prefix.length))) {
        return true;
      }
    }
    return false;
  };

  const buckets = bucketOrder.map((bucketId) => ({
    bucketId,
    rows: collectBucketRows(entity, documentsByPath, bucketId, effectiveChannel, currentFilePath, isChanged)
  }));
  const rowsOf = (bucketId: FacetBucketId) => buckets.find((bucket) => bucket.bucketId === bucketId)?.rows ?? [];

  const commitLabel = (nextLabel: string) => {
    if (nextLabel !== entity.label) {
      onFieldEdit({ pointer: joinPointer(entity.primarySource.pointer, "_label"), value: entity.label, valueType: "string" }, nextLabel);
    }
  };

  // Captures the entity's projection (text + facet source map + source hashes) and
  // enters/refreshes the text mode. A capture that fails (no projectable facets)
  // leaves the form untouched.
  const captureSource = () => {
    const capture = onCaptureEntitySource?.(entity);
    if (capture !== undefined) {
      setSourceCapture(capture ?? null);
    }
  };
  const sourceModeOpen = sourceCapture !== null;

  return (
    <div ref={layerRef} className="entity-inspector-layer">
      <section className="entity-inspector" aria-label="Entity inspector" style={computePanelStyle(selectionBounds, containerSize)}>
        <header className="entity-inspector-head">
          {labelEditable ? (
            <input
              className="entity-inspector-title-input"
              aria-label="Entity label"
              defaultValue={entity.label}
              key={entity.entityId}
              onBlur={(event) => commitLabel(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
          ) : (
            <strong className="entity-inspector-title">{entity.label}</strong>
          )}
          {prototypeType !== undefined ? <span className="entity-inspector-proto">Прототип: {prototypeType}</span> : null}
          <span className="entity-inspector-icons">
            {/* Entity refactor actions (Phase 6.2b): both open a dialog the
                controller gates behind the ADR-047 approval envelope. Rendered only
                when the controller supplies the handler (hidden in the embedded
                fallback / unit harness). */}
            {onRequestRename !== undefined ? (
              <button
                type="button"
                className="entity-inspector-refactor"
                data-testid="entity-inspector-rename"
                title="Переименовать id"
                aria-label="Rename entity id"
                onClick={() => onRequestRename(entity)}
              >
                Переименовать
              </button>
            ) : null}
            {onRequestDelete !== undefined ? (
              <button
                type="button"
                className="entity-inspector-refactor entity-inspector-refactor-danger"
                data-testid="entity-inspector-delete"
                title="Удалить сущность"
                aria-label="Delete entity"
                onClick={() => onRequestDelete(entity)}
              >
                Удалить
              </button>
            ) : null}
            {/* «источник»: toggles the editable prompt-projection text mode (Phase 4.2).
                Dock is still deferred. Inert only when the controller passes no
                capture/apply callbacks (e.g. the unit harness). */}
            <button
              type="button"
              className={sourceModeOpen ? "is-active" : undefined}
              disabled={!sourceModeAvailable}
              aria-pressed={sourceModeOpen}
              title={sourceModeAvailable ? "Текстовый режим «источник»" : "Текстовый режим «источник» — недоступен"}
              aria-label="Source text mode"
              onClick={() => (sourceModeOpen ? setSourceCapture(null) : captureSource())}
            >
              ⌗
            </button>
            <button type="button" disabled title="Закрепить в док — скоро" aria-label="Pin to dock (coming soon)">
              📌
            </button>
            <button type="button" className="entity-inspector-close" onClick={onClose} aria-label="Close entity inspector">
              ✕
            </button>
          </span>
        </header>

        {sourceModeOpen && sourceCapture !== null && onApplyReturnedIntent !== undefined ? (
          <EntitySourceTextMode
            capture={sourceCapture}
            onRecapture={captureSource}
            onApply={onApplyReturnedIntent}
            onExit={() => setSourceCapture(null)}
          />
        ) : (
          <>
        <div className="entity-inspector-chips">
          {rowsOf("meaning").length > 0 ? <span className="entity-inspector-chip">{bucketLabel.meaning}</span> : null}
          {rowsOf("content").length > 0 ? <span className="entity-inspector-chip">{bucketLabel.content}</span> : null}
          {viewSources.length > 0 ? (
            <span className="entity-inspector-chip is-active">
              {bucketLabel.view} ·{" "}
              {viewChannels.length > 1 ? (
                <select aria-label="View channel" value={effectiveChannel ?? ""} onChange={(event) => setDisplayChannel(event.target.value)}>
                  {viewChannels.map((channel) => (
                    <option key={channel} value={channel}>
                      {channel}
                    </option>
                  ))}
                </select>
              ) : (
                <span>{effectiveChannel ?? "—"} ▾</span>
              )}
            </span>
          ) : requiresView ? (
            // «создать вид» (Phase 6.2b): adds the missing UI facet for this game
            // entity in the active channel. Enabled once the controller supplies a
            // handler; otherwise it stays an inert warning chip.
            <button
              type="button"
              className="entity-inspector-chip is-warning"
              data-testid="entity-inspector-create-view"
              disabled={onCreateView === undefined}
              title={onCreateView !== undefined ? "Создать вид в активном канале" : "Создание вида — недоступно"}
              onClick={onCreateView !== undefined ? () => onCreateView(entity) : undefined}
            >
              создать вид
            </button>
          ) : null}
        </div>

        <div className="entity-inspector-fields">
          {buckets.every((bucket) => bucket.rows.length === 0) ? (
            <p className="entity-inspector-empty">Нет значимых полей.</p>
          ) : (
            buckets
              .filter((bucket) => bucket.rows.length > 0)
              .map((bucket) => (
                <section key={bucket.bucketId} className="entity-inspector-group" aria-label={bucketLabel[bucket.bucketId]}>
                  <div className="entity-inspector-group-title">
                    {bucketLabel[bucket.bucketId]}
                    {bucket.bucketId === "view" && effectiveChannel !== undefined ? ` · ${effectiveChannel}` : ""}
                  </div>
                  {bucket.rows.map((row) => (
                    <FieldRow key={`${row.source.filePath}#${row.pointer}`} row={row} onFieldEdit={onFieldEdit} onOpenFile={onOpenFile} />
                  ))}
                </section>
              ))
          )}
        </div>

        {/* Prompt row (mockup): the element-scoped prompt. Interpreting the returned
            intent is Phase 4, and there is no trivial focus-session-chat API, so the
            escalation button is inert with a "скоро" hint. */}
        <div className="entity-inspector-prompt">
          <input aria-label="Element prompt" placeholder="✦ Промт для этого элемента…" />
          <button type="button" disabled title="Эскалация в чат сессии — скоро">
            → В чат сессии
          </button>
        </div>
          </>
        )}
      </section>
    </div>
  );
}

function FieldRow({
  row,
  onFieldEdit,
  onOpenFile
}: {
  readonly row: InspectorFieldRow;
  readonly onFieldEdit: (field: InspectorEditableField, rawValue: string) => void;
  readonly onOpenFile: (filePath: string) => void;
}) {
  return (
    <div className={`entity-inspector-row${row.changedByAgent ? " hl" : ""}`}>
      <span className="entity-inspector-row-label">{row.label}</span>
      <FieldControl row={row} onFieldEdit={onFieldEdit} />
      <span className="entity-inspector-row-src" title={`${row.source.filePath}#${row.pointer}`}>
        {row.badge}
        {row.changedByAgent ? " · изменено агентом" : ""}
      </span>
      {row.editableInDoc ? null : (
        <button
          type="button"
          className="entity-inspector-open-file"
          title={`Открыть ${row.source.filePath} для правки`}
          onClick={() => onOpenFile(row.source.filePath)}
        >
          ↗
        </button>
      )}
    </div>
  );
}

/**
 * The editable control for one field. Scalars from the OPEN document get a live
 * input (committed on blur / Enter); a field from another document is read-only
 * (this slice never writes an unopened file — the row's «↗» opens it instead),
 * and containers show a compact read-only summary.
 */
function FieldControl({
  row,
  onFieldEdit
}: {
  readonly row: InspectorFieldRow;
  readonly onFieldEdit: (field: InspectorEditableField, rawValue: string) => void;
}): ReactNode {
  const field: InspectorEditableField = { pointer: row.pointer, value: row.value, valueType: row.valueType };
  const disabled = !row.editableInDoc;
  const resetKey = `${row.pointer}:${String(row.value)}`;

  if (row.valueType === "boolean") {
    return (
      <input
        type="checkbox"
        className="entity-inspector-row-value"
        defaultChecked={row.value === true}
        disabled={disabled}
        key={resetKey}
        onChange={(event) => onFieldEdit(field, event.target.checked ? "true" : "false")}
      />
    );
  }

  if (row.valueType === "array" || row.valueType === "object" || row.valueType === "null") {
    return <span className="entity-inspector-row-value is-summary">{summarizeValue(row.value)}</span>;
  }

  return (
    <input
      className="entity-inspector-row-value"
      type={row.valueType === "number" ? "number" : "text"}
      defaultValue={String(row.value)}
      disabled={disabled}
      key={resetKey}
      onBlur={(event) => {
        if (event.currentTarget.value !== String(row.value)) {
          onFieldEdit(field, event.currentTarget.value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

// --- pure helpers -----------------------------------------------------------

/** Reads and returns the object at a source pointer, or `undefined` if not an object. */
function readObject(
  documentsByPath: ReadonlyMap<string, EditorEntityProjectionDocument>,
  filePath: string,
  pointer: string
): { readonly [key: string]: JsonValue } | undefined {
  const document = documentsByPath.get(filePath);
  if (document?.json === undefined) {
    return undefined;
  }
  const value = readJsonPointer(document.json, pointer);
  return isPlainJsonObject(value) ? value : undefined;
}

function uniqueChannels(sources: readonly EditorEntitySourcePointer[]): readonly string[] {
  const channels: string[] = [];
  for (const source of sources) {
    if (source.channel !== undefined && !channels.includes(source.channel)) {
      channels.push(source.channel);
    }
  }
  return channels;
}

/**
 * The significant fields of one facet bucket, reusing the projection's own
 * "meaningful fields" rule (skip technical `_`-prefixed / `$schema` keys — the
 * exact predicate `buildEditorEntityYamlProjection` applies). Fields are read
 * straight from the authoring documents, so the list is never invented here.
 */
function collectBucketRows(
  entity: EditorEntity,
  documentsByPath: ReadonlyMap<string, EditorEntityProjectionDocument>,
  bucketId: FacetBucketId,
  displayChannel: string | undefined,
  currentFilePath: string,
  isChanged: (filePath: string, pointer: string) => boolean
): readonly InspectorFieldRow[] {
  const rows: InspectorFieldRow[] = [];
  const seen = new Set<string>();

  for (const facetKind of orderedFacetKinds) {
    if (facetBucketOfKind[facetKind] !== bucketId) {
      continue;
    }
    for (const source of entity.facets[facetKind] ?? []) {
      // In the view bucket only show the channel selected on the chip; channel-less
      // sources (design tokens) always show.
      if (bucketId === "view" && source.channel !== undefined && source.channel !== displayChannel) {
        continue;
      }
      const object = readObject(documentsByPath, source.filePath, source.pointer);
      if (object === undefined) {
        continue;
      }
      for (const [key, value] of Object.entries(object)) {
        if (isTechnicalKey(key)) {
          continue;
        }
        const pointer = joinPointer(source.pointer, key);
        const dedupeKey = `${source.filePath}#${pointer}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        rows.push({
          pointer,
          label: key,
          value,
          valueType: valueTypeOf(value),
          source,
          badge: sourceBadge(source, value),
          editableInDoc: source.filePath === currentFilePath,
          changedByAgent: isChanged(source.filePath, pointer)
        });
      }
    }
  }

  return rows;
}

/** Source badge by document kind, with an «ассет» override for asset-like values. */
function sourceBadge(source: EditorEntitySourcePointer, value: JsonValue): string {
  if (looksLikeAsset(value)) {
    return "ассет";
  }
  switch (source.documentKind) {
    case "game":
      return "игра";
    case "ui":
      return `UI · ${source.channel ?? "web"}`;
    case "design":
      return "дизайн";
    case "plugin":
      return "плагин";
    default:
      return source.documentKind;
  }
}

/** Content-based asset hint ("тип поля"): a string value pointing at a media file. */
function looksLikeAsset(value: JsonValue): boolean {
  return typeof value === "string" && /\.(png|jpe?g|svg|webp|gif|avif|mp3|wav|ogg|mp4|webm)$/i.test(value);
}

function isTechnicalKey(key: string): boolean {
  return key === "$schema" || key.startsWith("_");
}

/** Two JSON Pointers are "related" when one is an ancestor of (or equal to) the other. */
function pointersRelated(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function joinPointer(parent: string, key: string): string {
  const encoded = key.replaceAll("~", "~0").replaceAll("/", "~1");
  return parent === "" ? `/${encoded}` : `${parent}/${encoded}`;
}

function valueTypeOf(value: JsonValue): InspectorValueType {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    return "object";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "string";
}

function summarizeValue(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `${value.length} элем.`;
  }
  if (isPlainJsonObject(value)) {
    return `${Object.keys(value).length} полей`;
  }
  return "—";
}

/**
 * Simplified free-quadrant placement (design-spec §3.2): prefer the space to the
 * right of the selection, then the left, then below — so the panel never covers
 * the selected element. Falls back to the top-left corner when there is no
 * selection rect (a non-visual entity picked from the tree).
 */
function computePanelStyle(bounds: PreviewRect | undefined, container: { readonly w: number; readonly h: number }): CSSProperties {
  if (bounds === undefined || container.w === 0) {
    return { left: placementMarginPx, top: placementMarginPx };
  }
  const rightSpace = container.w - (bounds.x + bounds.width);
  const leftSpace = bounds.x;
  const maxTop = Math.max(placementMarginPx, container.h - 80);

  if (rightSpace >= panelWidthPx + placementGapPx) {
    return { left: bounds.x + bounds.width + placementGapPx, top: clamp(bounds.y, placementMarginPx, maxTop) };
  }
  if (leftSpace >= panelWidthPx + placementGapPx) {
    return { left: Math.max(placementMarginPx, bounds.x - panelWidthPx - placementGapPx), top: clamp(bounds.y, placementMarginPx, maxTop) };
  }
  return {
    left: clamp(bounds.x, placementMarginPx, Math.max(placementMarginPx, container.w - panelWidthPx - placementMarginPx)),
    top: bounds.y + bounds.height + placementGapPx
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
