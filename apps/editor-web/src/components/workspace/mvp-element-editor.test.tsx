import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { EditorEntity, PreviewEntityDescriptor } from "@cubica/editor-engine";

import { MvpElementEditor, mvpElementDraftKey, type MvpElementDraft } from "./mvp-element-editor";
import type { EntitySourceCapture } from "./entity-source-text-mode";
import { MVP_PROMPT_SEPARATOR, serializeMvpPromptDocument } from "./mvp-prompt-document";
import type { MvpElementSource } from "./mvp-element-operations";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  if (Element.prototype.hasPointerCapture === undefined) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", { configurable: true, value: () => false });
  }
});

const entity: EditorEntity = {
  entityId: "button-1", kind: "ui-component", label: "Ответ",
  primarySource: { filePath: "ui/web.authoring.json", pointer: "/root/screens/0/root/children/0", documentKind: "ui", channel: "web" },
  facets: {}, diagnostics: []
};
const source: MvpElementSource = { filePath: entity.primarySource.filePath, pointer: entity.primarySource.pointer,
  value: { _type: "ui.Component", _label: "Ответ", type: "button", _prompt: { status: "draft", raw: "Понятный выбор", source: "user", language: "ru", updatedAt: "2026-09-19T00:00:00.000Z" } } };
const capture = { entityId: entity.entityId, projectionYaml: "type: button\nlabel: Ответ", facetSourceMap: { lines: [] }, sourceHashes: {} };

function contentCapture(pointer: string, title: string): EntitySourceCapture {
  const filePath = "game.authoring.json";
  return {
    ...capture,
    projectionYaml: `Текст заголовка: ${JSON.stringify(title)}`,
    semantic: {
      text: title,
      facetSourceMap: { lines: [] },
      diagnostics: [],
      properties: [{ id: "title", label: "Текст заголовка", facet: "content", presentation: "text", value: title,
        sourceValue: title, owner: { filePath, pointer: `${pointer}/title` },
        writeTarget: { filePath, pointer: `${pointer}/title`, operation: "replace", parentObjects: [] },
        inherited: false, scope: "shared" }]
    }
  };
}

function setTextarea(textarea: HTMLTextAreaElement | null, text: string) {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, text);
  textarea?.dispatchEvent(new Event("input", { bubbles: true }));
}

function saveButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>("[aria-label='Сохранить элемент']");
}

function textArea(container: HTMLElement) {
  return container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Единый текст элемента']");
}

function baseProps(onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }))) {
  return { source, entity, label: "Ответ", onClose: vi.fn(), onCapture: vi.fn(() => capture), onSave };
}

describe("MvpElementEditor", () => {
  it("separates drafts for different proven content owners behind one UI source", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const drafts = new Map<string, MvpElementDraft>();
    const firstCapture = contentCapture("/root/content/data/infos/0", "Первая сцена");
    const secondCapture = contentCapture("/root/content/data/infos/1", "Вторая сцена");
    const firstKey = mvpElementDraftKey(source, firstCapture, false)!;
    const secondKey = mvpElementDraftKey(source, secondCapture, false)!;
    expect(firstKey).not.toBe(secondKey);
    let currentCapture = firstCapture;
    const props = { ...baseProps(), drafts, onCapture: () => currentCapture };
    const root = createRoot(container);
    await act(async () => root.render(<MvpElementEditor {...props} key={firstKey} draftKey={firstKey} contextKey="scene:first" />));
    const edited = serializeMvpPromptDocument(["", "Понятный выбор", 'Текст заголовка: "Черновик первой сцены"']);
    await act(async () => setTextarea(textArea(container), edited));
    currentCapture = secondCapture;
    await act(async () => root.render(<MvpElementEditor {...props} key={secondKey} draftKey={secondKey} contextKey="scene:second" />));
    expect(textArea(container)?.value).toContain('Текст заголовка: "Вторая сцена"');
    expect(textArea(container)?.value).not.toContain("Черновик первой сцены");
    currentCapture = firstCapture;
    await act(async () => root.render(<MvpElementEditor {...props} key={firstKey} draftKey={firstKey} contextKey="scene:first" />));
    expect(textArea(container)?.value).toBe(edited);
    await act(async () => root.unmount()); container.remove();
  });

  it("retires a pending candidate draft once fresh projection contains its accepted text", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const drafts = new Map<string, MvpElementDraft>();
    let currentCapture = contentCapture("/root/content/data/infos/0", "До правки");
    const draftKey = mvpElementDraftKey(source, currentCapture, false)!;
    const onSave = vi.fn(async () => ({ ok: true, pending: true, message: "Кандидат подготовлен." }));
    const props = { ...baseProps(onSave), drafts, draftKey, onCapture: () => currentCapture };
    const root = createRoot(container);
    await act(async () => root.render(<MvpElementEditor {...props} contextKey="scene:before" />));
    const accepted = serializeMvpPromptDocument(["", "Понятный выбор", 'Текст заголовка: "После правки"']);
    await act(async () => setTextarea(textArea(container), accepted));
    await act(async () => saveButton(container)?.click());
    expect(drafts.size).toBe(1);
    currentCapture = contentCapture("/root/content/data/infos/0", "После правки");
    await act(async () => root.render(<MvpElementEditor {...props} contextKey="scene:accepted" />));
    expect(textArea(container)?.value).toBe(accepted);
    expect(drafts.size).toBe(0);
    expect(container.querySelector("[role='status']")?.textContent).not.toContain("Контекст прототипа или экземпляра изменился");
    await act(async () => root.unmount()); container.remove();
  });

  it("restores an unsaved source draft after rebuilding clears selection", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const drafts = new Map<string, MvpElementDraft>();
    const props = baseProps();
    const root = createRoot(container);
    await act(async () => root.render(<MvpElementEditor {...props} drafts={drafts} />));
    expect(drafts.size).toBe(0);
    const raw = `Незавершённый запрос\n${textArea(container)?.value}`;
    await act(async () => setTextarea(textArea(container), raw));
    await act(async () => root.render(null));
    await act(async () => root.render(<MvpElementEditor {...props} drafts={drafts} />));
    expect(textArea(container)?.value).toBe(raw);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Закрыть редактор элемента']")?.click());
    expect(drafts.size).toBe(0);
    await act(async () => root.unmount()); container.remove();
  });

  it("uses the semantic projection without injecting a technical label header", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<MvpElementEditor {...baseProps()} />));
    expect(textArea(container)?.value).toContain("type: button\nlabel: Ответ");
    expect(textArea(container)?.value).not.toContain("_label:");
    await act(async () => root.unmount()); container.remove();
  });
  it("sends all three edited sections in one save call", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const props = baseProps(onSave);
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} />); });
    const textarea = textArea(container);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(textarea?.value).toContain(`\n${MVP_PROMPT_SEPARATOR}\n`);
    const draft = serializeMvpPromptDocument(["Сделай кнопку синей", "Объясни выбор", "_label: \"Новый ответ\"\ntype: button"]);
    await act(async () => setTextarea(textarea, draft));
    await act(async () => saveButton(container)?.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ source, capture, oneOff: "Сделай кнопку синей", authorIntent: "Объясни выбор", yaml: "_label: \"Новый ответ\"\ntype: button" });
    expect(textarea?.value).toBe(draft);
    await act(async () => root?.unmount()); container.remove();
  });

  it("keeps malformed raw drafts and reports the exact separator count without saving", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...baseProps(onSave)} />); });
    const textarea = textArea(container);
    for (const [raw, count] of [
      ["Совсем без разделителей", 0],
      [`Первый\n${MVP_PROMPT_SEPARATOR}\nВторой`, 1],
      [`Первый\n======================\nВторой`, 0],
      [serializeMvpPromptDocument(["A", "B", "C"]) + `\n${MVP_PROMPT_SEPARATOR}\nD`, 3]
    ] as const) {
      await act(async () => setTextarea(textarea, raw));
      await act(async () => saveButton(container)?.click());
      expect(textarea?.value).toBe(raw);
      expect(container.querySelector("[role='status']")?.textContent).toContain(`Количество разделителей: ${count}`);
    }
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => root?.unmount()); container.remove();
  });

  it("blocks a stale edited draft but follows an external reload while pristine", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const props = baseProps(onSave);
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} />); });
    const reloaded = { ...source, value: { ...source.value, _label: "Ответ после загрузки" } };
    await act(async () => { root?.render(<MvpElementEditor {...props} source={reloaded} />); });
    expect(textArea(container)?.value).toContain("label: Ответ");
    const draft = serializeMvpPromptDocument(["Мой несохранённый текст", "Замысел", "yaml: true"]);
    await act(async () => setTextarea(textArea(container), draft));
    const changedAgain = { ...reloaded, value: { ...reloaded.value, _label: "Изменено другим автором" } };
    await act(async () => { root?.render(<MvpElementEditor {...props} source={changedAgain} />); });
    await act(async () => saveButton(container)?.click());
    expect(onSave).not.toHaveBeenCalled();
    expect(textArea(container)?.value).toBe(draft);
    expect(container.querySelector("[role='status']")?.textContent).toContain("Элемент изменился");
    await act(async () => root?.unmount()); container.remove();
  });

  it("re-captures a clean draft when context changes, then saves edits against the new context", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    let currentCapture = capture;
    const onCapture = vi.fn(() => currentCapture);
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const props = { ...baseProps(onSave), onCapture };
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} contextKey="instance:one" />); });
    currentCapture = { ...capture, projectionYaml: "type: button\nlabel: Другой контекст" };
    await act(async () => { root?.render(<MvpElementEditor {...props} contextKey="instance:two" />); });
    expect(textArea(container)?.value).toContain("label: Другой контекст");
    const edited = serializeMvpPromptDocument(["", "Новый замысел", "type: button\nlabel: Другой контекст"]);
    await act(async () => setTextarea(textArea(container), edited));
    await act(async () => saveButton(container)?.click());
    expect(onSave).toHaveBeenCalledWith({ source, capture: currentCapture, oneOff: "", authorIntent: "Новый замысел", yaml: "type: button\nlabel: Другой контекст" });
    expect(container.querySelector("[role='status']")?.textContent).not.toContain("Контекст прототипа или экземпляра изменился");
    await act(async () => root?.unmount()); container.remove();
  });

  it("rebases after a successful metadata save so a second save is accepted", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const onSave = vi.fn(async ({ source: current, authorIntent }: { source: MvpElementSource; authorIntent: string }) => {
      setSource?.({ ...current, value: { ...current.value, _prompt: { status: "draft", raw: authorIntent, source: "user", language: "ru", updatedAt: "2026-09-20T00:00:00.000Z" } } });
      return { ok: true, message: "Сохранено." };
    });
    let setSource: ((next: MvpElementSource) => void) | undefined;
    function Harness() {
      const [current, update] = useState(source);
      setSource = update;
      return <MvpElementEditor {...baseProps(onSave)} source={current} />;
    }
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<Harness />); });
    await act(async () => setTextarea(textArea(container), serializeMvpPromptDocument(["", "Первый замысел", "yaml: true"])));
    await act(async () => saveButton(container)?.click());
    await act(async () => setTextarea(textArea(container), serializeMvpPromptDocument(["", "Второй замысел", "yaml: true"])));
    await act(async () => saveButton(container)?.click());
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0].authorIntent).toBe("Второй замысел");
    expect(container.querySelector("[role='status']")?.textContent).not.toContain("Элемент изменился");
    await act(async () => root?.unmount()); container.remove();
  });

  it("opens template save on a long hold without performing a normal save", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.appendChild(container);
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const onSavePrototype = vi.fn(async () => ({ ok: true, message: "Шаблон сохранён." }));
    let root: Root | undefined;
    try {
      await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...baseProps(onSave)} onSavePrototype={onSavePrototype} />); });
      const button = saveButton(container);
      await act(async () => {
        button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        vi.advanceTimersByTime(550);
        button?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
        button?.click();
      });
      expect(onSave).not.toHaveBeenCalled();
      const template = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Сохранить как шаблон");
      expect(template).toBeDefined();
      await act(async () => template?.click());
      expect(onSavePrototype).toHaveBeenCalledWith(source);
    } finally {
      await act(async () => root?.unmount()); container.remove(); vi.useRealTimers();
    }
  });

  it("enters prototype editing from the instance layer menu and returns without deleting the draft", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const onEditPrototype = vi.fn();
    const onReturnToInstance = vi.fn();
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...baseProps()} onEditPrototype={onEditPrototype} />); });
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Слои: Ответ']")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("[role='option']")].find((item) => item.textContent === "Редактировать прототип")?.click());
    expect(onEditPrototype).toHaveBeenCalledTimes(1);
    await act(async () => root?.render(<MvpElementEditor {...baseProps()} editingPrototype={{ name: "Кнопка действия", affectedCount: 3, overriddenCount: 1 }} onReturnToInstance={onReturnToInstance} />));
    expect(container.textContent).toContain("Прототип: Кнопка действия");
    expect(container.textContent).toContain("Затронет наследников: 3");
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Вернуться к экземпляру']")?.click());
    expect(onReturnToInstance).toHaveBeenCalledTimes(1);
    await act(async () => root?.unmount()); container.remove();
  });

  it("loads prototype static text as author intent and labels the long-hold action as a new prototype", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div"); document.body.appendChild(container);
    const prototypeSource: MvpElementSource = { ...source, value: { ...source.value, _prompt: { status: "draft", raw: "instance intent", source: "user", language: "ru", updatedAt: "2026-09-19T00:00:00.000Z" }, _promptTemplate: { raw: "fallback template", staticText: "prototype intent", language: "ru" } } };
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const onSavePrototype = vi.fn(async () => ({ ok: true, message: "Новый прототип сохранён." }));
    let root: Root | undefined;
    try {
      await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...baseProps(onSave)} source={prototypeSource} editingPrototype={{ name: "Кнопка", affectedCount: 2 }} onSavePrototype={onSavePrototype} />); });
      expect(textArea(container)?.value).toContain("prototype intent");
      expect(textArea(container)?.value).not.toContain("instance intent");
      const button = saveButton(container);
      await act(async () => {
        button?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
        vi.advanceTimersByTime(550);
        button?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
        button?.click();
      });
      const template = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Сохранить как новый прототип");
      expect(template).toBeDefined();
      await act(async () => template?.click());
      expect(onSavePrototype).toHaveBeenCalledWith(prototypeSource);
    } finally {
      await act(async () => root?.unmount()); container.remove(); vi.useRealTimers();
    }
  });

  it("switches cleanly from instance intent to prototype intent before editing", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const transitionSource: MvpElementSource = { ...source, value: { ...source.value, _promptTemplate: { raw: "prototype fallback", staticText: "prototype intent", language: "ru" } } };
    const onSave = vi.fn(async () => ({ ok: true, message: "Сохранено." }));
    const props = { ...baseProps(onSave), source: transitionSource };
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} contextKey="instance:button" />); });
    expect(textArea(container)?.value).toContain("Понятный выбор");
    await act(async () => { root?.render(<MvpElementEditor {...props} editingPrototype={{ name: "Кнопка", affectedCount: 1 }} contextKey="prototype:button" />); });
    expect(textArea(container)?.value).toContain("prototype intent");
    expect(textArea(container)?.value).not.toContain("Понятный выбор");
    await act(async () => setTextarea(textArea(container), serializeMvpPromptDocument(["", "Прототипный замысел", "type: button"])));
    await act(async () => saveButton(container)?.click());
    expect(onSave).toHaveBeenCalledWith({ source: transitionSource, capture, oneOff: "", authorIntent: "Прототипный замысел", yaml: "type: button" });
    await act(async () => root?.unmount()); container.remove();
  });

  it("preserves an edited draft and reports a stale context when the source stays unchanged", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const drafts = new Map<string, MvpElementDraft>();
    const props = baseProps();
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...props} drafts={drafts} contextKey="instance:one" />); });
    const draft = serializeMvpPromptDocument(["Мой черновик", "Замысел", "type: button"]);
    await act(async () => setTextarea(textArea(container), draft));
    await act(async () => { root?.render(<MvpElementEditor {...props} drafts={drafts} contextKey="prototype:button" />); });
    expect(textArea(container)?.value).toBe(draft);
    expect(container.querySelector("[role='status']")?.textContent).toContain("Контекст прототипа или экземпляра изменился");
    await act(async () => root?.unmount()); container.remove();
  });

  it("uses layer identities despite duplicate labels and exposes page/game scope choices", async () => {
    const container = document.createElement("div"); document.body.appendChild(container);
    const layers = ["first", "second"].map((entityId) => ({ entityId, label: "Ответ" } as PreviewEntityDescriptor));
    const onSelectLayer = vi.fn();
    const onSelectScope = vi.fn();
    let root: Root | undefined;
    await act(async () => { root = createRoot(container); root.render(<MvpElementEditor {...baseProps()} layers={layers} selectedLayerId="second"
      layerPoint={{ x: 32, y: 48 }} onSelectLayer={onSelectLayer} onSelectScope={onSelectScope} />); });
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Слои: Ответ']")?.click());
    const options = [...container.querySelectorAll<HTMLButtonElement>("[role='option']")];
    expect(options.slice(0, 2).map((item) => item.textContent)).toEqual(["Ответ", "Ответ"]);
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    await act(async () => options[0]?.click());
    expect(onSelectLayer).toHaveBeenCalledWith(layers[0], { x: 32, y: 48 }, layers);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Слои: Ответ']")?.click());
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>("[role='option']")].find((item) => item.textContent === "Игра")?.click());
    expect(onSelectScope).toHaveBeenCalledWith("game", { x: 32, y: 48 });
    await act(async () => root?.unmount()); container.remove();
  });
});
