"use client";

/**
 * Grouped entity tree panel (design-spec §3.1, editor-preview-first-ux §7).
 *
 * Renders whichever of the two groupings the controller built with
 * `buildEntityGroupingTreeViewModel` (ADR-057 §4.6) — "По экранам" (an
 * outliner: screens of the active channel, active one auto-expanded, a
 * collapsed "Логика экрана" subgroup for bound non-visual entities) or "По
 * типам" (an inventory: prototypes, each holding its instances with a
 * location breadcrumb). This component only RENDERS the `tree` prop; switching
 * the segmented control just asks the controller (`onGroupingChange`) for the
 * other one, which owns persisting the choice.
 *
 * One entity ("сущность") can surface at several nodes — a "вхождение"
 * (occurrence, the same object shown again, never a copy). Selecting any of
 * them highlights every node sharing its `entityId` (soft background,
 * `is-same-entity`); occurrence rows are marked in italic ("— тот же объект").
 *
 * Framework-agnostic data, React-only rendering — same discipline as
 * `JsonTreeView`: reads `TreeViewModel`/`TreeViewNode`, owns no authoring data.
 */
import React, { useMemo, useState, type KeyboardEvent } from "react";

import type { EntityTreeGrouping, TreeViewModel, TreeViewNode } from "@cubica/editor-engine";

export interface EntityTreeProps {
  readonly grouping: EntityTreeGrouping;
  readonly onGroupingChange: (next: EntityTreeGrouping) => void;
  readonly tree: TreeViewModel;
  /** Entity id to soft-highlight (every occurrence), or `undefined` for none. */
  readonly selectedEntityId: string | undefined;
  readonly onSelectEntity: (entityId: string) => void;
}

/** One flattened row: the node, its nesting depth, and its ancestor LABELS (used only for search breadcrumbs — the normal nested view shows hierarchy through indentation instead). */
interface EntityTreeRow {
  readonly node: TreeViewNode;
  readonly depth: number;
  readonly ancestorLabels: readonly string[];
}

/** Walks the tree in pre-order; `stopAtCollapsed` skips a collapsed node's children (nested view), `undefined` always descends (flat search view). The synthetic true root (depth 0) is walked but never emitted as a row. */
function flattenRows(
  root: TreeViewNode,
  stopAtCollapsed: ((node: TreeViewNode, depth: number) => boolean) | undefined
): readonly EntityTreeRow[] {
  const rows: EntityTreeRow[] = [];
  const visit = (node: TreeViewNode, depth: number, ancestorLabels: readonly string[]) => {
    if (depth > 0) {
      rows.push({ node, depth, ancestorLabels });
    }
    if (depth > 0 && stopAtCollapsed?.(node, depth) === true) {
      return;
    }
    const nextAncestors = depth === 0 ? ancestorLabels : [...ancestorLabels, node.label];
    for (const child of node.children) {
      visit(child, depth + 1, nextAncestors);
    }
  };
  visit(root, 0, []);
  return rows;
}

/**
 * Default collapse rule (design-spec §3.1, mockup): "Логика экрана" always
 * starts collapsed; every top-level screen other than the active one starts
 * collapsed too (mockup: inactive "▸", active "▾" with children visible).
 * Everything else (byType inventory, active screen's own children) starts
 * expanded. Driven only by generic node fields, so this stays game-agnostic.
 */
function isCollapsedByDefault(node: TreeViewNode, depth: number): boolean {
  if (node.groupingRole === "screen-logic") {
    return true;
  }
  return depth === 1 && node.entityKind === "ui-screen" && node.isActiveContext !== true;
}

/** Matches `_label`, diagnostics, and (for search only) ancestor labels — the entity's type/prototype name lives on its enclosing header, not on the node itself (design-spec §3.1: "фильтр по _label/типу/диагностикам"). */
function matchesQuery(row: EntityTreeRow, query: string): boolean {
  const diagnosticWords = row.node.diagnosticSeverityCounts !== undefined ? " diagnostic предупреждение ошибка" : "";
  const haystack = `${row.node.label}${diagnosticWords} ${row.ancestorLabels.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

export function EntityTree({ grouping, onGroupingChange, tree, selectedEntityId, onSelectEntity }: EntityTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // Explicit user overrides of the default collapse rule, keyed by node id.
  // Re-seeded (cleared) when `grouping` changes: the two groupings use disjoint
  // node-id namespaces, so a map built for one never matches the other's ids —
  // clearing it lets the newly-shown grouping fall back to its own defaults.
  const [collapseOverrides, setCollapseOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [seededGrouping, setSeededGrouping] = useState(grouping);
  if (seededGrouping !== grouping) {
    setSeededGrouping(grouping);
    setCollapseOverrides(new Map());
  }

  function isNodeCollapsed(node: TreeViewNode, depth: number): boolean {
    return collapseOverrides.get(node.id) ?? isCollapsedByDefault(node, depth);
  }

  function toggleCollapsed(node: TreeViewNode, depth: number) {
    const next = new Map(collapseOverrides);
    next.set(node.id, !isNodeCollapsed(node, depth));
    setCollapseOverrides(next);
  }

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query !== "";

  const visibleRows = useMemo(() => {
    if (isSearching) {
      return flattenRows(tree.root, undefined)
        .filter((row) => row.node.entityId !== undefined)
        .filter((row) => matchesQuery(row, query));
    }
    return flattenRows(tree.root, (node, depth) => isNodeCollapsed(node, depth));
  }, [isSearching, query, tree.root, collapseOverrides]);

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || !isSearching) {
      return;
    }
    const first = visibleRows[0];
    if (first?.node.entityId !== undefined) {
      onSelectEntity(first.node.entityId);
    }
  }

  function renderRow(row: EntityTreeRow) {
    const { node, depth } = row;
    const hasChildren = node.children.length > 0;
    const collapsed = !isSearching && hasChildren && isNodeCollapsed(node, depth);
    const isHeader = node.entityId === undefined;
    const isOccurrence = node.occurrenceKind === "occurrence";
    const isSameEntity = node.entityId !== undefined && node.entityId === selectedEntityId;
    const isProtoHeader = node.groupingRole === "prototype";
    const crumb = node.locationBreadcrumb ?? (isSearching ? row.ancestorLabels : undefined);

    return (
      <div
        className={`tree-row${isSameEntity ? " is-same-entity" : ""}`}
        data-entity-tree-node-id={node.id}
        key={node.id}
        role="treeitem"
        aria-selected={isSameEntity}
        aria-expanded={hasChildren && !isSearching ? !collapsed : undefined}
      >
        <button
          type="button"
          className="tree-row-main"
          style={{ paddingLeft: `${depth * 14 + 2}px` }}
          onClick={() => {
            if (isHeader) {
              if (!isSearching) {
                toggleCollapsed(node, depth);
              }
              return;
            }
            onSelectEntity(node.entityId as string);
          }}
        >
          {!isSearching && hasChildren ? (
            <span
              className="tree-toggle"
              aria-label={collapsed ? "Expand" : "Collapse"}
              onClick={(event) => {
                event.stopPropagation();
                toggleCollapsed(node, depth);
              }}
            >
              {collapsed ? "▸" : "▾"}
            </span>
          ) : (
            <span className="tree-toggle tree-toggle-empty" aria-hidden="true">
              •
            </span>
          )}
          {isProtoHeader ? <span className="tree-count entity-tree-tag-proto">Прототип</span> : null}
          <span className={`tree-label${isOccurrence ? " entity-tree-label-occurrence" : ""}`}>
            {node.isActiveContext === true ? <strong>{node.label}</strong> : node.label}
            {isOccurrence ? " — тот же объект ↗" : ""}
          </span>
          {node.isNonVisual === true && !isProtoHeader ? <span className="tree-count">невизуальный</span> : null}
          {crumb !== undefined && crumb.length > 0 ? <span className="tree-count">{crumb.join(" › ")} ›</span> : null}
          {isProtoHeader || node.groupingRole === "screen-logic" ? (
            <span className="tree-count">
              {node.isNonVisual === true && isProtoHeader ? `${node.valuePreview} · невизуальный` : node.valuePreview}
            </span>
          ) : null}
          {node.diagnosticSeverityCounts !== undefined ? (
            <span className="tree-diagnostics">
              {node.diagnosticSeverityCounts.error + node.diagnosticSeverityCounts.warning}
            </span>
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <section className="tree-panel entity-tree-panel" aria-label="Entity tree">
      <div className="tree-heading">
        <strong>Entities</strong>
        <input
          aria-label="Search entities"
          placeholder="Search name, type, diagnostic…"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        {isSearching ? <span className="tree-match-count">{visibleRows.length} matches</span> : null}
      </div>
      <div className="surface-tabs entity-tree-grouping-tabs" role="tablist" aria-label="Entity tree grouping">
        <button
          type="button"
          role="tab"
          className={grouping === "byScreen" ? "is-active" : ""}
          aria-selected={grouping === "byScreen"}
          onClick={() => onGroupingChange("byScreen")}
        >
          По экранам
        </button>
        <button
          type="button"
          role="tab"
          className={grouping === "byType" ? "is-active" : ""}
          aria-selected={grouping === "byType"}
          onClick={() => onGroupingChange("byType")}
        >
          По типам
        </button>
      </div>
      <div className="tree-list" role="tree" aria-label="Entity tree rows">
        {visibleRows.length === 0 ? (
          <p className="entity-tree-empty">{isSearching ? "No matches." : "Nothing to show yet."}</p>
        ) : (
          visibleRows.map((row) => renderRow(row))
        )}
      </div>
    </section>
  );
}
