import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorEntity, PreviewEntityDescriptor } from "@cubica/editor-engine";

import { MvpElementEditor } from "./mvp-element-editor";
import type { MvpElementSource } from "./mvp-element-operations";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entity: EditorEntity = {
  entityId: "button-1",
  kind: "ui-component",
  label: "Ответ",
  primarySource: { filePath: "ui/web.authoring.json", pointer: "/root/screens/0/root/children/0", documentKind: "ui", channel: "web" },
  facets: {},
  diagnostics: []
};
const source: MvpElementSource = { filePath: entity.primarySource.filePath, pointer: entity.primarySource.pointer,
  value: { _type: "ui.Component", _label: "Ответ", type: "button", _prompt: { status: "draft", raw: "Понятный выбор", source: "user", language: "ru", updatedAt: "2026-09-19T00:00:00.000Z" } } };

describe("MvpElementEditor", () => {
  it("keeps three independent drafts and refuses to save after the source changes", async () => {
    const onDirect = vi.fn(async () => true);
    const onPrompt = vi.fn(async () => true);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root | undefined;
    const props = {
      entity, label: "Ответ", onClose: vi.fn(), onDirect, onPrompt,
      onCapture: vi.fn(() => ({ entityId: entity.entityId, projectionYaml: "label: Ответ", facetSourceMap: { lines: [] }, sourceHashes: {} })),
      onApplyYaml: vi.fn(async () => ({ path: "deterministic" as const, stale: false, report: [], applied: false, forwarded: false }))
    };
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} source={source} />); });
    expect([...container.querySelectorAll("section h3")].map((item) => item.textContent)).toEqual([
      "Разовая правка", "Авторское описание", "Структурированный текст"
    ]);
    const oneOff = container.querySelector<HTMLTextAreaElement>("[aria-label='Разовая правка элемента']");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(oneOff, "Сделай кнопку крупнее");
      oneOff?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector<HTMLTextAreaElement>("[aria-label='Авторское описание элемента']")?.value).toBe("Понятный выбор");
    expect(container.querySelector<HTMLTextAreaElement>("[aria-label='Структурированный текст элемента']")?.value).toBe("label: Ответ");
    await act(async () => { root?.render(<MvpElementEditor {...props} source={{ ...source, value: { ...source.value, _label: "Изменено извне" } }} />); });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Сохранить описание")?.click(); });
    expect(onDirect).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Источник изменился");
    await act(async () => root?.unmount());
  });

  it("keeps the selected layer identity when two layers have the same label", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const layers = ["first", "second"].map(entityId => ({ entityId, label: "Ответ" } as PreviewEntityDescriptor));
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<MvpElementEditor label="Ответ" selectedLayerId="second" layers={layers}
        onClose={vi.fn()} onDirect={vi.fn()} onPrompt={vi.fn()} onCapture={vi.fn()} onApplyYaml={vi.fn()} />);
    });
    expect(container.querySelector<HTMLSelectElement>("[aria-label='Выбрать слой']")?.value).toBe("second");
    await act(async () => root?.unmount()); container.remove();
  });

  it("shows a clear unmapped-node state on a narrow viewport", async () => {
    const container = document.createElement("div");
    container.style.width = "320px";
    document.body.appendChild(container);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(container);
      root.render(<MvpElementEditor label="Неполный элемент" onClose={vi.fn()} onDirect={vi.fn()} onPrompt={vi.fn()}
        onCapture={vi.fn()} onApplyYaml={vi.fn()} />);
    });
    expect(container.querySelector("[aria-label='Редактор элемента']")).not.toBeNull();
    expect(container.textContent).toContain("нет точного редактируемого источника");
    await act(async () => root?.unmount());
  });

  it("accepts a second metadata save after the first server result rerenders the source", async () => {
    const onDirect = vi.fn(async (changeSet: { readonly jsonPatches: readonly { readonly operations: readonly { readonly op: string; readonly path: string; readonly value?: unknown }[] }[] }) => {
      const write = changeSet.jsonPatches[0]?.operations.at(-1);
      if (write?.op === "replace" || write?.op === "add") setSourceFromWrite?.(write.path.endsWith("/_prompt") ? "_prompt" : "_label", write.value);
      return true;
    });
    let setSourceFromWrite: ((field: "_label" | "_prompt", value: unknown) => void) | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    function Harness() {
      const [current, setCurrent] = useState(source);
      setSourceFromWrite = (field, value) => setCurrent((prior) => ({ ...prior, value: { ...prior.value, [field]: value as string } }));
      return <MvpElementEditor source={current} entity={entity} label="Ответ" onClose={vi.fn()} onDirect={onDirect}
        onPrompt={vi.fn()} onCapture={vi.fn(() => undefined)} onApplyYaml={vi.fn()} />;
    }
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<Harness />); });
    const name = container.querySelector<HTMLInputElement>("[aria-label='Название элемента']");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(name, "Новое имя");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Сохранить")?.click(); });
    const author = container.querySelector<HTMLTextAreaElement>("[aria-label='Авторское описание элемента']");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(author, "Новый замысел");
      author?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Сохранить описание")?.click(); });
    expect(onDirect).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Источник изменился");
    await act(async () => root?.unmount());
  });
});
