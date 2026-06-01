import { describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React, { act, useState } from "react";
import { buildTreeViewModel, createDocumentStore, readJsonPointer, type JsonValue } from "@cubica/editor-engine";

import { createDefaultCollapsedTreePointers, JsonTreeView } from "./json-tree-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("JsonTreeView", () => {
  it("collapses every non-root expandable branch by default", () => {
    const json: JsonValue = { a: 1, nested: { title: "Hello", child: { enabled: true } } };
    const snapshot = createDocumentStore({ filePath: "tree.json", text: `${JSON.stringify(json, null, 2)}\n` }).snapshot();
    const tree = buildTreeViewModel({ snapshot });

    expect([...createDefaultCollapsedTreePointers(tree)].sort()).toEqual(["/nested", "/nested/child"]);
  });

  it("renders a pointer-complete tree and supports scalar edit callback", async () => {
    const json: JsonValue = { a: 1, nested: { title: "Hello" } };
    const snapshot = createDocumentStore({ filePath: "tree.json", text: `${JSON.stringify(json, null, 2)}\n` }).snapshot();
    const tree = buildTreeViewModel({ snapshot });

    const onSetScalarValue = vi.fn<(pointer: string, rawValue: string) => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | undefined;

    function Harness() {
      const [collapsedPointers, setCollapsedPointers] = useState<ReadonlySet<string>>(() => new Set());
      const [selectedPointer, setSelectedPointer] = useState("");

      return (
        <JsonTreeView
          tree={tree}
          selectedPointer={selectedPointer}
          collapsedPointers={collapsedPointers}
          onCollapsedPointersChange={setCollapsedPointers}
          onSelectPointer={setSelectedPointer}
          onRevealPointerInJson={setSelectedPointer}
          readValue={(pointer) => (snapshot.json === undefined ? undefined : readJsonPointer(snapshot.json, pointer))}
          onSetScalarValue={onSetScalarValue}
        />
      );
    }

    await act(async () => {
      root = createRoot(container);
      root.render(<Harness />);
    });

    expect(container.querySelector("[data-tree-pointer=\"/a\"]")).not.toBeNull();

    const aRow = container.querySelector<HTMLElement>("[data-tree-pointer=\"/a\"]");
    expect(aRow).not.toBeNull();

    // First button in the row is the main row button; action buttons are in `.tree-row-actions`.
    const editAction = aRow?.querySelector<HTMLDivElement>(".tree-row-actions button");
    expect(editAction?.textContent).toBe("Edit");

    await act(async () => {
      editAction?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inlineInput = container.querySelector<HTMLInputElement>(".tree-inline-edit input");
    expect(inlineInput).not.toBeNull();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(inlineInput, "2");
      inlineInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const applyButton = container.querySelector<HTMLButtonElement>(".tree-inline-edit button");
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSetScalarValue).toHaveBeenCalledWith("/a", "2");

    await act(async () => {
      root?.unmount();
    });
  });
});
