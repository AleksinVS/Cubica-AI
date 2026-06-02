import { describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React, { act, useState } from "react";
import { buildTreeViewModel, createDocumentStore, type JsonValue } from "@cubica/editor-engine";

import { createDefaultCollapsedTreePointers, JsonTreeView } from "./json-tree-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("JsonTreeView", () => {
  it("collapses every non-root expandable branch by default", () => {
    const json: JsonValue = { a: 1, nested: { title: "Hello", child: { enabled: true } } };
    const snapshot = createDocumentStore({ filePath: "tree.json", text: `${JSON.stringify(json, null, 2)}\n` }).snapshot();
    const tree = buildTreeViewModel({ snapshot });

    expect([...createDefaultCollapsedTreePointers(tree)].sort()).toEqual(["/nested", "/nested/child"]);
  });

  it("renders a pointer-complete tree without row JSON actions or technical type badges", async () => {
    const json: JsonValue = { a: 1, nested: { title: "Hello" } };
    const snapshot = createDocumentStore({ filePath: "tree.json", text: `${JSON.stringify(json, null, 2)}\n` }).snapshot();
    const tree = buildTreeViewModel({ snapshot });

    const onSelectPointer = vi.fn<(pointer: string) => void>();
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
          onSelectPointer={(pointer) => {
            onSelectPointer(pointer);
            setSelectedPointer(pointer);
          }}
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
    expect(container.querySelector(".tree-row-actions")).toBeNull();
    expect(container.querySelector(".tree-type")).toBeNull();
    expect(container.textContent).not.toContain("Open in JSON");

    await act(async () => {
      aRow?.querySelector<HTMLButtonElement>(".tree-row-main")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectPointer).toHaveBeenCalledWith("/a");

    await act(async () => {
      root?.unmount();
    });
  });
});
