import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import {
  buildEditorEntityYamlProjection,
  hashEditorText,
  interpretReturnedIntent,
  type EditorEntity,
  type EditorEntityProjectionDocument,
  type JsonValue,
  type ReturnedIntentInput
} from "@cubica/editor-engine";

import { EntityInspector } from "./entity-inspector";
import type { EntitySourceCapture, ReturnedIntentApplyOutcome } from "./entity-source-text-mode";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gamePath = "game.authoring.json";
const uiPath = "ui/web.authoring.json";

function buildEntity(): EditorEntity {
  return {
    entityId: "card-1",
    kind: "ui-component",
    label: "Карточка выбора",
    primarySource: { filePath: gamePath, pointer: "/entities/card", documentKind: "game" },
    facets: {
      logic: [{ filePath: gamePath, pointer: "/entities/card/meaning", documentKind: "game" }],
      content: [{ filePath: gamePath, pointer: "/entities/card/content", documentKind: "game" }],
      view: [{ filePath: uiPath, pointer: "/view", documentKind: "ui", channel: "web" }]
    },
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

/**
 * A live authoring text store (filePath -> text) that mirrors the controller's
 * "живой DocumentStore": capture reads it at open time, apply re-reads it, so a
 * mutation between the two surfaces the prompt-stale path.
 */
function makeLiveStore(documents: readonly EditorEntityProjectionDocument[]): Map<string, string> {
  const store = new Map<string, string>();
  for (const document of documents) {
    store.set(document.filePath, `${JSON.stringify(document.json, null, 2)}\n`);
  }
  return store;
}

function entityFilePaths(entity: EditorEntity): readonly string[] {
  const paths = new Set<string>([entity.primarySource.filePath]);
  for (const facetSources of Object.values(entity.facets)) {
    for (const facetSource of facetSources ?? []) {
      paths.add(facetSource.filePath);
    }
  }
  return [...paths];
}

function hashesOf(entity: EditorEntity, store: Map<string, string>): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const filePath of entityFilePaths(entity)) {
    const text = store.get(filePath);
    if (text !== undefined) {
      hashes[filePath] = hashEditorText(text);
    }
  }
  return hashes;
}

/**
 * Real capture + real interpreter wiring backed by the mutable store, so tests
 * exercise the genuine `buildEditorEntityYamlProjection` / `interpretReturnedIntent`
 * core (design-spec §6 "используйте реальный interpret").
 */
function makeCallbacks(entity: EditorEntity, documents: readonly EditorEntityProjectionDocument[], store: Map<string, string>) {
  const capture = (target: EditorEntity): EntitySourceCapture => {
    const projection = buildEditorEntityYamlProjection({ entity: target, documents });
    return {
      entityId: target.entityId,
      projectionYaml: projection.text,
      facetSourceMap: projection.facetSourceMap,
      sourceHashes: hashesOf(target, store)
    };
  };
  const apply = (input: ReturnedIntentInput): ReturnedIntentApplyOutcome => {
    const result = interpretReturnedIntent(input, { currentSourceHashes: hashesOf(entity, store) });
    const stale = result.stale === true;
    return {
      path: result.path,
      stale,
      report: stale ? [] : result.report,
      applied: result.path === "deterministic" && result.changeSet !== null,
      forwarded: result.path === "agent",
      message: undefined
    };
  };
  return { capture, apply };
}

function mountInspector(overrides: Partial<React.ComponentProps<typeof EntityInspector>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const entity = buildEntity();
  const documents = buildDocuments();
  const store = makeLiveStore(documents);
  const { capture, apply } = makeCallbacks(entity, documents, store);

  const props: React.ComponentProps<typeof EntityInspector> = {
    entity,
    documents,
    activeChannel: "web",
    currentFilePath: gamePath,
    selectionBounds: undefined,
    changedPointerKeys: new Set<string>(),
    onClose: () => {},
    onFieldEdit: () => {},
    onOpenFile: () => {},
    onCaptureEntitySource: capture,
    onApplyReturnedIntent: apply,
    ...overrides
  };

  let root: Root | undefined;
  return {
    container,
    store,
    mount: () => {
      root = createRoot(container);
      root.render(<EntityInspector {...props} />);
    },
    unmount: () => root?.unmount()
  };
}

/** Sets a controlled textarea's value the way React expects (native setter + input). */
function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickSourceIcon(container: HTMLElement) {
  const icon = container.querySelector<HTMLButtonElement>('button[aria-label="Текстовый режим источника"]');
  icon?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("EntitySourceTextMode (via inspector «источник»)", () => {
  it("opens the text mode and shows the entity projection + hash badge", async () => {
    const harness = mountInspector();
    await act(async () => harness.mount());
    await act(async () => clickSourceIcon(harness.container));

    const textarea = harness.container.querySelector<HTMLTextAreaElement>(".entity-source-textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain("Выбор маршрута");
    expect(harness.container.querySelector(".entity-source-hash-badge")?.textContent).toContain("захвачен");

    await act(async () => harness.unmount());
  });

  it("deterministic value edit → applied bucket with the target pointer", async () => {
    const harness = mountInspector();
    await act(async () => harness.mount());
    await act(async () => clickSourceIcon(harness.container));

    const textarea = harness.container.querySelector<HTMLTextAreaElement>(".entity-source-textarea");
    expect(textarea).not.toBeNull();
    const edited = (textarea?.value ?? "").replace("Выбор маршрута", "Новый заголовок");
    await act(async () => setTextareaValue(textarea as HTMLTextAreaElement, edited));
    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>(".entity-source-apply")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const appliedBucket = harness.container.querySelector(".entity-source-bucket.is-applied");
    expect(appliedBucket).not.toBeNull();
    expect(appliedBucket?.textContent).toContain("Новый заголовок");
    expect(appliedBucket?.textContent).toContain("/entities/card/content/title");

    await act(async () => harness.unmount());
  });

  it("unrecognized free-form line → agent path shows the unrecognized bucket", async () => {
    const harness = mountInspector();
    await act(async () => harness.mount());
    await act(async () => clickSourceIcon(harness.container));

    const textarea = harness.container.querySelector<HTMLTextAreaElement>(".entity-source-textarea");
    const edited = `${textarea?.value ?? ""}\nсделай карточки крупнее и добавь анимацию`;
    await act(async () => setTextareaValue(textarea as HTMLTextAreaElement, edited));
    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>(".entity-source-apply")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const unrecognized = harness.container.querySelector(".entity-source-bucket.is-unrecognized");
    expect(unrecognized).not.toBeNull();
    expect(unrecognized?.textContent).toContain("анимацию");

    await act(async () => harness.unmount());
  });

  it("stale source hashes → stale plaque, nothing applied", async () => {
    const harness = mountInspector();
    await act(async () => harness.mount());
    await act(async () => clickSourceIcon(harness.container));

    // Mutate the live active document AFTER capture so the fresh hash diverges.
    harness.store.set(gamePath, `${harness.store.get(gamePath) ?? ""}\n// external edit`);

    const textarea = harness.container.querySelector<HTMLTextAreaElement>(".entity-source-textarea");
    const edited = (textarea?.value ?? "").replace("Выбор маршрута", "Иное");
    await act(async () => setTextareaValue(textarea as HTMLTextAreaElement, edited));
    await act(async () => {
      harness.container.querySelector<HTMLButtonElement>(".entity-source-apply")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(harness.container.querySelector(".entity-source-stale")).not.toBeNull();
    expect(harness.container.querySelector(".entity-source-bucket")).toBeNull();

    await act(async () => harness.unmount());
  });

  it("keeps the «источник» icon inert when no capture/apply callbacks are provided", async () => {
    const harness = mountInspector({ onCaptureEntitySource: undefined, onApplyReturnedIntent: undefined });
    await act(async () => harness.mount());

    const icon = harness.container.querySelector<HTMLButtonElement>('button[aria-label="Текстовый режим источника"]');
    expect(icon?.disabled).toBe(true);

    await act(async () => harness.unmount());
  });
});
