"use client";

/**
 * JSON Tree view for ADR-034 editor workspace.
 *
 * The component renders a pointer-complete tree derived from `@cubica/editor-engine`
 * `TreeViewModel`. It intentionally does not own a mutable JSON document state:
 * it only keeps UI state (search query, collapse toggles, temporary edit drafts)
 * while all edits are routed back through callbacks so the authoring JSON
 * remains the single source of truth.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";

import type { JsonValue, TreeViewModel, TreeViewNode } from "@cubica/editor-engine";

type ToggleMode = "toggle" | "collapse" | "expand";

export interface JsonTreeViewProps {
  readonly tree: TreeViewModel;
  readonly selectedPointer: string;
  readonly collapsedPointers: ReadonlySet<string>;
  readonly onCollapsedPointersChange: (next: ReadonlySet<string>) => void;
  readonly onSelectPointer: (pointer: string) => void;
  readonly onRevealPointerInJson: (pointer: string) => void;
  readonly readValue: (pointer: string) => JsonValue | undefined;
  readonly onSetScalarValue: (pointer: string, rawValue: string) => void;
}

/**
 * Creates the default collapsed state for a newly opened tree.
 *
 * The root pointer stays expanded so the user can see the document entry
 * points. Every deeper object or array starts collapsed to keep large
 * manifests navigable on first open.
 */
export function createDefaultCollapsedTreePointers(tree: TreeViewModel): ReadonlySet<string> {
  return new Set(tree.flatNodes.filter((node) => node.pointer !== "" && node.children.length > 0).map((node) => node.pointer));
}

export function JsonTreeView({
  tree,
  selectedPointer,
  collapsedPointers,
  onCollapsedPointersChange,
  onSelectPointer,
  onRevealPointerInJson,
  readValue,
  onSetScalarValue
}: JsonTreeViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingPointer, setEditingPointer] = useState<string | undefined>(undefined);
  const [draftScalarValue, setDraftScalarValue] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  const visiblePointers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === "") {
      return undefined;
    }

    const matchedPointers = tree.flatNodes
      .filter((node) => matchesSearch(node, query))
      .map((node) => node.pointer);

    const included = new Set<string>();
    for (const pointer of matchedPointers) {
      included.add(pointer);
      for (const ancestor of ancestorPointers(pointer)) {
        included.add(ancestor);
      }
    }

    included.add("");
    return included;
  }, [searchQuery, tree.flatNodes]);

  const flattenedNodes = useMemo(() => {
    const rows: { readonly node: TreeViewNode; readonly depth: number }[] = [];

    const visit = (node: TreeViewNode, depth: number, ancestorsCollapsed: boolean) => {
      const included = visiblePointers === undefined || visiblePointers.has(node.pointer);
      if (included) {
        rows.push({ node, depth });
      }

      const collapseGate = visiblePointers === undefined ? collapsedPointers.has(node.pointer) : false;
      const nextCollapsed = ancestorsCollapsed || collapseGate;

      for (const child of node.children) {
        if (nextCollapsed) {
          continue;
        }
        visit(child, depth + 1, nextCollapsed);
      }
    };

    visit(tree.root, 0, false);
    return rows;
  }, [collapsedPointers, tree.root, visiblePointers]);

  const matchCount = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query === "") {
      return 0;
    }

    return tree.flatNodes.filter((node) => matchesSearch(node, query)).length;
  }, [searchQuery, tree.flatNodes]);

  useEffect(() => {
    if (listRef.current === null) {
      return;
    }

    const selector = `[data-tree-pointer="${cssEscape(selectedPointer)}"]`;
    const target = listRef.current.querySelector<HTMLElement>(selector);
    if (target === null) {
      return;
    }

    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
  }, [selectedPointer, flattenedNodes.length]);

  function toggleCollapsed(pointer: string, mode: ToggleMode = "toggle") {
    if (pointer === "") {
      return;
    }

    const next = new Set(collapsedPointers);
    const shouldCollapse = mode === "toggle" ? !next.has(pointer) : mode === "collapse";

    if (shouldCollapse) {
      next.add(pointer);
    } else {
      next.delete(pointer);
    }

    onCollapsedPointersChange(next);
  }

  function beginScalarEdit(pointer: string) {
    const current = readValue(pointer);
    if (current === undefined || Array.isArray(current) || (typeof current === "object" && current !== null)) {
      return;
    }

    setEditingPointer(pointer);
    setDraftScalarValue(current === null ? "null" : String(current));
  }

  function cancelScalarEdit() {
    setEditingPointer(undefined);
    setDraftScalarValue("");
  }

  function applyScalarEdit(pointer: string) {
    onSetScalarValue(pointer, draftScalarValue);
    cancelScalarEdit();
  }

  return (
    <section className="tree-panel" aria-label="Authoring JSON tree">
      <div className="tree-heading">
        <strong>Tree</strong>
        <input
          aria-label="Search tree"
          placeholder="Search key/value/type/id/title"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {searchQuery.trim() !== "" ? <span className="tree-match-count">{matchCount} matches</span> : null}
        <span className="tree-meta">{tree.flatNodes.length} nodes</span>
      </div>

      <div className="tree-list" ref={listRef} role="tree" aria-label="JSON tree rows">
        {flattenedNodes.map(({ node, depth }) => {
          const isSelected = node.pointer === selectedPointer;
          const isExpandable = node.children.length > 0;
          const isCollapsed = collapsedPointers.has(node.pointer);
          const indentStyle = { paddingLeft: `${depth * 14 + 10}px` };
          const hasDiagnostics = node.subtreeDiagnosticCount > 0;
          const isEditing = editingPointer === node.pointer;

          return (
            <div
              className={`tree-row ${isSelected ? "is-selected" : ""}`}
              data-tree-pointer={node.pointer}
              key={node.id}
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={isExpandable ? !isCollapsed : undefined}
            >
              <button
                type="button"
                className="tree-row-main"
                style={indentStyle}
                onClick={() => onSelectPointer(node.pointer)}
                title={node.pointer === "" ? "/" : node.pointer}
              >
                {isExpandable ? (
                  <span
                    className="tree-toggle"
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCollapsed(node.pointer);
                    }}
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                ) : (
                  <span className="tree-toggle tree-toggle-empty" aria-hidden="true">
                    •
                  </span>
                )}

                <span className="tree-label">{node.label}</span>
                <span className="tree-preview">{node.valuePreview}</span>
                <span className="tree-type">{node.valueType}</span>
                {node.childCount > 0 ? <span className="tree-count">{node.childCount}</span> : null}
                {hasDiagnostics ? <span className="tree-diagnostics">{node.subtreeDiagnosticCount}</span> : null}
              </button>

              <div className="tree-row-actions">
                {node.actions.canSetValue ? (
                  <button type="button" onClick={() => beginScalarEdit(node.pointer)} disabled={isEditing}>
                    Edit
                  </button>
                ) : null}
                <button type="button" onClick={() => onRevealPointerInJson(node.pointer)}>
                  Open in JSON
                </button>
              </div>

              {isEditing ? (
                <div className="tree-inline-edit" aria-label="Scalar edit">
                  <input
                    value={draftScalarValue}
                    onChange={(event) => setDraftScalarValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        cancelScalarEdit();
                      }
                      if (event.key === "Enter") {
                        applyScalarEdit(node.pointer);
                      }
                    }}
                    autoFocus
                  />
                  <button type="button" onClick={() => applyScalarEdit(node.pointer)}>
                    Apply
                  </button>
                  <button type="button" onClick={cancelScalarEdit}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function matchesSearch(node: TreeViewNode, query: string): boolean {
  const haystack = `${node.label} ${node.valuePreview} ${node.valueType} ${node.kind} ${node.pointer}`.toLowerCase();
  return haystack.includes(query);
}

function ancestorPointers(pointer: string): readonly string[] {
  if (pointer === "") {
    return [];
  }

  const segments = pointer.split("/").slice(1);
  const ancestors: string[] = [];
  for (let i = 0; i < segments.length - 1; i += 1) {
    ancestors.push(`/${segments.slice(0, i + 1).join("/")}`);
  }
  ancestors.push("");
  return ancestors;
}

function cssEscape(value: string): string {
  // Minimal CSS selector escaping for pointer attribute values.
  // We do not need full `CSS.escape` support here; we only need to prevent
  // quotes and backslashes from breaking the selector.
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
