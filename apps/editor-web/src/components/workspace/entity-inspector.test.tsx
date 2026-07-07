import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type {
  EditorEntity,
  EditorEntityFacetKind,
  EditorEntityProjectionDocument,
  EditorEntitySourcePointer,
  JsonValue
} from "@cubica/editor-engine";

import { EntityInspector, type InspectorEditableField } from "./entity-inspector";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gamePath = "game.authoring.json";
const uiPath = "ui/web.authoring.json";

function source(
  partial: Partial<EditorEntitySourcePointer> & Pick<EditorEntitySourcePointer, "filePath" | "pointer" | "documentKind">
): EditorEntitySourcePointer {
  return { ...partial };
}

/**
 * A "Карточка выбора"-shaped entity with all three facets: a game meaning facet
 * (`/entities/card/meaning`), a game content facet (`/entities/card/content`),
 * and a web view facet in the UI document. `_label`/`_type` on the primary object
 * drive the header and prototype tag.
 */
function buildEntity(facetKinds: readonly EditorEntityFacetKind[] = ["logic", "content", "view"]): EditorEntity {
  const facets: Partial<Record<EditorEntityFacetKind, readonly EditorEntitySourcePointer[]>> = {};
  if (facetKinds.includes("logic")) {
    facets.logic = [source({ filePath: gamePath, pointer: "/entities/card/meaning", documentKind: "game" })];
  }
  if (facetKinds.includes("content")) {
    facets.content = [source({ filePath: gamePath, pointer: "/entities/card/content", documentKind: "game" })];
  }
  if (facetKinds.includes("view")) {
    facets.view = [source({ filePath: uiPath, pointer: "/view", documentKind: "ui", channel: "web" })];
  }
  return {
    entityId: "card-1",
    kind: "ui-component",
    label: "Карточка выбора",
    primarySource: source({ filePath: gamePath, pointer: "/entities/card", documentKind: "game" }),
    facets,
    diagnostics: []
  };
}

function buildDocuments(): readonly EditorEntityProjectionDocument[] {
  return [
    {
      filePath: gamePath,
      documentKind: "game",
      json: {
        entities: {
          card: {
            _label: "Карточка выбора",
            _type: "choice-card",
            meaning: { rule: "pick-one" },
            content: { title: "Выбор маршрута", variant2: "Южный путь" }
          }
        }
      } as JsonValue
    },
    {
      filePath: uiPath,
      documentKind: "ui",
      channel: "web",
      json: { view: { style: "крупные карточки", image: "card.png" } } as JsonValue
    }
  ];
}

function renderInspector(overrides: Partial<React.ComponentProps<typeof EntityInspector>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const onClose = vi.fn<() => void>();
  const onFieldEdit = vi.fn<(field: InspectorEditableField, rawValue: string) => void>();
  const onOpenFile = vi.fn<(filePath: string) => void>();
  let root: Root | undefined;

  const props: React.ComponentProps<typeof EntityInspector> = {
    entity: buildEntity(),
    documents: buildDocuments(),
    activeChannel: "web",
    currentFilePath: gamePath,
    selectionBounds: undefined,
    changedPointerKeys: new Set<string>(),
    onClose,
    onFieldEdit,
    onOpenFile,
    ...overrides
  };

  return {
    container,
    onClose,
    onFieldEdit,
    onOpenFile,
    mount: () => {
      root = createRoot(container);
      root.render(<EntityInspector {...props} />);
    },
    unmount: () => root?.unmount()
  };
}

describe("EntityInspector", () => {
  it("renders a facet chip per facet the entity has", async () => {
    const harness = renderInspector();
    await act(async () => harness.mount());

    const chips = [...harness.container.querySelectorAll(".entity-inspector-chip")].map((chip) => chip.textContent ?? "");
    expect(chips.some((text) => text.includes("Смысл"))).toBe(true);
    expect(chips.some((text) => text.includes("Содержание"))).toBe(true);
    expect(chips.some((text) => text.includes("Вид"))).toBe(true);
    expect(harness.container.textContent).toContain("web");
    // Prototype tag from `_type`.
    expect(harness.container.textContent).toContain("Прототип: choice-card");

    await act(async () => harness.unmount());
  });

  it("omits the Вид chip for a non-visual entity (no view facet, no missing-view diagnostic)", async () => {
    const harness = renderInspector({ entity: buildEntity(["logic"]) });
    await act(async () => harness.mount());

    const chips = [...harness.container.querySelectorAll(".entity-inspector-chip")].map((chip) => chip.textContent ?? "");
    expect(chips.some((text) => text.includes("Смысл"))).toBe(true);
    expect(chips.some((text) => text.includes("Вид"))).toBe(false);
    expect(harness.container.textContent).not.toContain("создать вид");

    await act(async () => harness.unmount());
  });

  it("shows a source badge per field by document kind (игра / UI · web / ассет)", async () => {
    const harness = renderInspector();
    await act(async () => harness.mount());

    const badges = [...harness.container.querySelectorAll(".entity-inspector-row-src")].map((node) => node.textContent ?? "");
    expect(badges.some((text) => text === "игра")).toBe(true); // content field from game manifest
    expect(badges.some((text) => text === "UI · web")).toBe(true); // view field from ui manifest
    expect(badges.some((text) => text === "ассет")).toBe(true); // image value -> asset override

    await act(async () => harness.unmount());
  });

  it("highlights a field the last agent apply changed", async () => {
    const harness = renderInspector({
      changedPointerKeys: new Set<string>([`${gamePath}#/entities/card/content/variant2`])
    });
    await act(async () => harness.mount());

    const highlighted = harness.container.querySelector(".entity-inspector-row.hl");
    expect(highlighted).not.toBeNull();
    expect(highlighted?.textContent).toContain("variant2");
    expect(highlighted?.textContent).toContain("изменено агентом");

    await act(async () => harness.unmount());
  });

  it("makes a cross-document field read-only with an open-file affordance", async () => {
    // The open document is the game manifest, so the view facet (ui document) is
    // cross-document: read-only value + an «↗ open file» button (never written here).
    const harness = renderInspector({ currentFilePath: gamePath });
    await act(async () => harness.mount());

    const viewRow = [...harness.container.querySelectorAll(".entity-inspector-row")].find((row) =>
      row.textContent?.includes("style")
    );
    expect(viewRow).not.toBeUndefined();
    const input = viewRow?.querySelector<HTMLInputElement>("input.entity-inspector-row-value");
    expect(input?.disabled).toBe(true);
    const openButton = viewRow?.querySelector<HTMLButtonElement>("button.entity-inspector-open-file");
    expect(openButton).not.toBeNull();

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(harness.onOpenFile).toHaveBeenCalledWith(uiPath);

    await act(async () => harness.unmount());
  });

  it("activates the «создать вид» chip for an entity that requires a view but has none", async () => {
    // A logic-only entity carrying the `entity-missing-view` diagnostic: the «Вид»
    // chip becomes an ENABLED "создать вид" warning that calls onCreateView.
    const missingView: EditorEntity = {
      ...buildEntity(["logic"]),
      diagnostics: [
        {
          severity: "warning",
          code: "entity-missing-view",
          message: "Тип требует отображения, вида в канале нет.",
          source: source({ filePath: gamePath, pointer: "/entities/card", documentKind: "game" })
        }
      ]
    };
    const onCreateView = vi.fn<(entity: EditorEntity) => void>();
    const harness = renderInspector({ entity: missingView, onCreateView });
    await act(async () => harness.mount());

    const chip = harness.container.querySelector<HTMLButtonElement>('[data-testid="entity-inspector-create-view"]');
    expect(chip).not.toBeNull();
    expect(chip?.disabled).toBe(false);
    expect(chip?.textContent).toContain("создать вид");

    await act(async () => chip?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onCreateView).toHaveBeenCalledTimes(1);

    await act(async () => harness.unmount());
  });

  it("renders «Переименовать» / «Удалить» actions that call their handlers", async () => {
    const onRequestRename = vi.fn<(entity: EditorEntity) => void>();
    const onRequestDelete = vi.fn<(entity: EditorEntity) => void>();
    const harness = renderInspector({ onRequestRename, onRequestDelete });
    await act(async () => harness.mount());

    const rename = harness.container.querySelector<HTMLButtonElement>('[data-testid="entity-inspector-rename"]');
    const remove = harness.container.querySelector<HTMLButtonElement>('[data-testid="entity-inspector-delete"]');
    expect(rename?.textContent).toBe("Переименовать");
    expect(remove?.textContent).toBe("Удалить");

    await act(async () => rename?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => remove?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRequestRename).toHaveBeenCalledTimes(1);
    expect(onRequestDelete).toHaveBeenCalledTimes(1);

    await act(async () => harness.unmount());
  });

  // Asset-reference widget (Phase 9.2; design-spec §3.6). The UI view facet's
  // `image: "card.png"` is an asset-reference; opening the UI document makes it
  // editable, so the pick/upload/generate widget renders on that field.
  it("renders the asset-reference widget on an editable media field and routes «выбрать»", async () => {
    const onBeginAssetPick = vi.fn<(field: InspectorEditableField & { readonly label: string }) => void>();
    const onUploadAsset = vi.fn<(files: FileList) => void>();
    const harness = renderInspector({ currentFilePath: uiPath, onBeginAssetPick, onUploadAsset });
    await act(async () => harness.mount());

    const widget = harness.container.querySelector('[data-testid="asset-reference-widget"]');
    expect(widget).not.toBeNull();

    const select = harness.container.querySelector<HTMLButtonElement>('[data-testid="asset-widget-select"]');
    expect(select?.textContent).toBe("выбрать");
    await act(async () => select?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onBeginAssetPick).toHaveBeenCalledTimes(1);
    // The routed field carries the pointer + label of the media field.
    expect(onBeginAssetPick.mock.calls[0]?.[0]?.label).toBe("image");

    await act(async () => harness.unmount());
  });

  it("keeps «сгенерировать» disabled because no generation backend is connected", async () => {
    const onBeginAssetPick = vi.fn<(field: InspectorEditableField & { readonly label: string }) => void>();
    const harness = renderInspector({ currentFilePath: uiPath, onBeginAssetPick });
    await act(async () => harness.mount());

    const generate = harness.container.querySelector<HTMLButtonElement>('[data-testid="asset-widget-generate"]');
    expect(generate?.disabled).toBe(true);
    expect(generate?.textContent).toBe("сгенерировать");

    await act(async () => harness.unmount());
  });
});
