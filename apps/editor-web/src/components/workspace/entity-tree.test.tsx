import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { TreeViewModel, TreeViewNode } from "@cubica/editor-engine";

import { EntityTree } from "./entity-tree";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Builds one `TreeViewNode` with sane defaults for every field the component
 * does not exercise in these tests, so each fixture only spells out the fields
 * a given test actually cares about (occurrence, diagnostics, grouping role...).
 */
function node(partial: Partial<TreeViewNode> & Pick<TreeViewNode, "id" | "label">): TreeViewNode {
  return {
    entityId: undefined,
    occurrenceKind: "primary",
    pointer: "",
    parentPointer: "",
    kind: "object",
    valueType: "object",
    valuePreview: "",
    childCount: partial.children?.length ?? 0,
    diagnostics: [],
    subtreeDiagnosticCount: 0,
    graphNodeId: undefined,
    actions: { canSetValue: false, readOnly: false },
    children: [],
    ...partial
  };
}

/**
 * A small fixture exercising every state these tests need, WITHOUT going
 * through the full `buildEntityGroupingTreeViewModel` pipeline: the component
 * only ever reads `tree.root`, so a hand-built tree is both simpler and more
 * direct than reverse-engineering an authoring fixture that happens to trigger
 * every projection diagnostic.
 *
 * Shape:
 *   root
 *     screenA (ui-screen, ACTIVE)
 *       cardA (2 warnings)
 *         sharedOcc   — entityId "shared-1", occurrence
 *       cardB
 *         sharedPrimary — entityId "shared-1", primary
 *     screenB (ui-screen, inactive)
 *       logic (screen-logic subgroup)
 *         rule
 */
function buildFixtureTree(): TreeViewModel {
  const sharedOcc = node({ id: "$/screenA/cardA/shared", label: "Shared Button", entityId: "shared-1", occurrenceKind: "occurrence" });
  const cardA = node({
    id: "$/screenA/cardA",
    label: "Card A",
    entityId: "card-a",
    entityKind: "ui-component",
    diagnosticSeverityCounts: { error: 0, warning: 2 },
    children: [sharedOcc]
  });
  const sharedPrimary = node({ id: "$/screenA/cardB/shared", label: "Shared Button", entityId: "shared-1", occurrenceKind: "primary" });
  const cardB = node({ id: "$/screenA/cardB", label: "Card B", entityId: "card-b", entityKind: "ui-component", children: [sharedPrimary] });
  const screenA = node({
    id: "$/screenA",
    label: "Screen A",
    entityId: "screen-a",
    entityKind: "ui-screen",
    isActiveContext: true,
    children: [cardA, cardB]
  });

  const rule = node({ id: "$/screenB/logic/rule", label: "Rule One", entityId: "rule-1", isNonVisual: true });
  const logic = node({
    id: "$/screenB/logic",
    label: "Логика экрана",
    groupingRole: "screen-logic",
    isNonVisual: true,
    valuePreview: "1",
    children: [rule]
  });
  const screenB = node({ id: "$/screenB", label: "Screen B", entityId: "screen-b", entityKind: "ui-screen", children: [logic] });

  const root = node({ id: "$", label: "Screens", parentPointer: undefined, children: [screenA, screenB] });

  return { root, flatNodes: [], nodeByPointer: new Map(), nodesByEntityId: new Map() };
}

function renderEntityTree(overrides: Partial<React.ComponentProps<typeof EntityTree>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onGroupingChange = vi.fn<(next: "byScreen" | "byType") => void>();
  const onSelectEntity = vi.fn<(entityId: string) => void>();
  const tree = buildFixtureTree();
  let root: Root | undefined;

  function Harness() {
    const [grouping, setGrouping] = useState<"byScreen" | "byType">(overrides.grouping ?? "byScreen");
    return (
      <EntityTree
        grouping={grouping}
        onGroupingChange={(next) => {
          onGroupingChange(next);
          setGrouping(next);
        }}
        tree={overrides.tree ?? tree}
        selectedEntityId={overrides.selectedEntityId}
        onSelectEntity={onSelectEntity}
      />
    );
  }

  return { container, onGroupingChange, onSelectEntity, tree, Harness, mount: () => { root = createRoot(container); root?.render(<Harness />); }, unmount: () => root?.unmount() };
}

describe("EntityTree", () => {
  it("switches grouping through the segmented control", async () => {
    const harness = renderEntityTree();
    await act(async () => harness.mount());

    const byTypeTab = [...harness.container.querySelectorAll("button")].find((button) => button.textContent === "По типам");
    expect(byTypeTab).not.toBeUndefined();

    await act(async () => {
      byTypeTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(harness.onGroupingChange).toHaveBeenCalledWith("byType");
    expect(byTypeTab?.className).toContain("is-active");

    await act(async () => harness.unmount());
  });

  it("soft-highlights every occurrence of the selected entity", async () => {
    const harness = renderEntityTree({ selectedEntityId: "shared-1" });
    await act(async () => harness.mount());

    const highlighted = harness.container.querySelectorAll(".tree-row.is-same-entity");
    expect(highlighted).toHaveLength(2);
    expect(harness.container.textContent).toContain("Shared Button");
    expect(harness.container.textContent).toContain("— тот же объект");

    await act(async () => harness.unmount());
  });

  it("filters to a flat, matching result set on search", async () => {
    const harness = renderEntityTree();
    await act(async () => harness.mount());

    expect(harness.container.textContent).toContain("Screen B");

    const searchInput = harness.container.querySelector<HTMLInputElement>('input[aria-label="Search entities"]');
    expect(searchInput).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(searchInput, "Card A");
      searchInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // "Card A" matches the card itself AND its nested child (a search match also
    // carries its ancestor labels for the "type" part of the filter, so a
    // container match pulls its contents along) — but unrelated branches
    // (Screen B, Card B) are filtered out entirely.
    expect(harness.container.textContent).toContain("Card A");
    expect(harness.container.textContent).toContain("Shared Button");
    expect(harness.container.textContent).not.toContain("Screen B");
    expect(harness.container.textContent).not.toContain("Card B");
    expect(harness.container.querySelector(".tree-match-count")?.textContent).toContain("2 matches");

    await act(async () => harness.unmount());
  });

  it("renders a diagnostic severity badge on a node with projection diagnostics", async () => {
    const harness = renderEntityTree();
    await act(async () => harness.mount());

    const badge = harness.container.querySelector(".tree-diagnostics");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("2");

    await act(async () => harness.unmount());
  });

  it("starts the screen-logic subgroup collapsed by default", async () => {
    const harness = renderEntityTree();
    await act(async () => harness.mount());

    // Screen B is an entity row (it has an `entityId`), so clicking its MAIN
    // button would select it, not expand it — expanding a row is always the
    // chevron's job, same as JsonTreeView. Find Screen B's chevron specifically.
    const screenBRow = [...harness.container.querySelectorAll(".tree-row")].find((row) => row.textContent?.includes("Screen B"));
    expect(screenBRow).not.toBeUndefined();
    const toggle = screenBRow?.querySelector(".tree-toggle:not(.tree-toggle-empty)");
    expect(toggle).not.toBeNull();

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Screen B is now expanded: its "Логика экрана" row is visible...
    expect(harness.container.textContent).toContain("Логика экрана");
    // ...but the subgroup itself starts collapsed, so its own child stays hidden.
    expect(harness.container.textContent).not.toContain("Rule One");

    await act(async () => harness.unmount());
  });
});
