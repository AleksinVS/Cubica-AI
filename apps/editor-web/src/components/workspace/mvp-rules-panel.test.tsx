import React, { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorEntity, EditorEntityProjectionDocument, JsonObject } from "@cubica/editor-engine";

import { MvpRulesPanel } from "./mvp-rules-panel.tsx";
import { buildMvpRuleChangeSet, projectMvpRuleEntities, ruleEntities } from "./mvp-rules-panel-helpers.ts";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

const entity: EditorEntity = {
  entityId: "game-root:demo",
  kind: "game-root",
  label: "Демо-игра",
  primarySource: { filePath: "game.authoring.json", pointer: "/root", documentKind: "game" },
  facets: {},
  diagnostics: []
};

function documentWithPrompt(prompt: string): EditorEntityProjectionDocument {
  return {
    filePath: "game.authoring.json",
    documentKind: "game",
    json: { root: { _label: "Демо-игра", _prompt: { status: "confirmed", raw: prompt, normalized: prompt, source: "user", language: "ru", updatedAt: "2026-09-19T00:00:00.000Z" } } }
  };
}

function uiDocument(text: string): EditorEntityProjectionDocument {
  return { filePath: "ui/web.authoring.json", documentKind: "ui", json: { root: { _label: text } } };
}

function render(element: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

async function rerender(element: ReactElement): Promise<void> {
  await act(async () => {
    root?.render(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setTextareaValue(text: string): void {
  act(() => {
    const textarea = container?.querySelector("#mvp-rules-text");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("rule textarea was not rendered");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe("MvpRulesPanel helper", () => {
  it("projects newly authored rules from the real logic/rules path", () => {
    const rules = projectMvpRuleEntities([{
      filePath: "game.authoring.json", documentKind: "game",
      json: { root: { logic: { rules: [{ id: "new-rule", _type: "game.Rule", _label: "Новое правило", _semantics: "Описание" }] } } }
    }]);
    expect(ruleEntities(rules)).toEqual([expect.objectContaining({
      label: "Новое правило",
      primarySource: expect.objectContaining({ pointer: "/root/logic/rules/0" })
    })]);
    expect(ruleEntities([{ ...rules[0]!, primarySource: { ...rules[0]!.primarySource, pointer: "/root/rules/0" } }])).toEqual([]);
  });

  it("builds confirmed canonical metadata with a normalized text", () => {
    const source: JsonObject = { _label: "Демо-игра" };
    const changeSet = buildMvpRuleChangeSet(
      { filePath: "game.authoring.json", pointer: "/root", value: source },
      " Игрок выбирает карту. ",
      "2026-09-19T12:00:00.000Z"
    );
    const operation = changeSet?.jsonPatches[0]?.operations[1];
    expect(operation).toMatchObject({
      op: "add",
      path: "/root/_prompt",
      value: {
        status: "confirmed",
        raw: "Игрок выбирает карту.",
        normalized: "Игрок выбирает карту.",
        source: "user",
        language: "ru",
        updatedAt: "2026-09-19T12:00:00.000Z"
      }
    });
  });

  it("removes an existing prompt and creates no empty record", () => {
    const withPrompt: JsonObject = { _prompt: { raw: "Старое", status: "confirmed" } };
    expect(buildMvpRuleChangeSet({ filePath: "game.json", pointer: "/root", value: withPrompt }, " ", "2026-09-19T00:00:00.000Z")?.jsonPatches[0]?.operations[1]).toEqual({ op: "remove", path: "/root/_prompt" });
    expect(buildMvpRuleChangeSet({ filePath: "game.json", pointer: "/root", value: {} }, " ", "2026-09-19T00:00:00.000Z")).toBeUndefined();
  });
});

describe("MvpRulesPanel", () => {
  it("shows a prepared candidate and does not mutate source before apply", () => {
    const documents = [documentWithPrompt("Текущее правило")];
    const onApply = vi.fn().mockResolvedValue(true);
    render(
      <MvpRulesPanel
        entities={[entity]}
        documents={documents}
        onSelectEntity={vi.fn()}
        onApply={onApply}
        preparedDocuments={[{ filePath: "game.authoring.json", text: JSON.stringify({ root: { _prompt: { raw: "Подготовленное правило" } } }) }]}
      />
    );
    expect(container?.textContent).toContain("Подготовленное правило");
    setTextareaValue("Новое правило");
    expect(onApply).not.toHaveBeenCalled();
    expect((documents[0]?.json as JsonObject).root).toMatchObject({ _prompt: { raw: "Текущее правило" } });
  });

  it("blocks apply after the source changes during a dirty draft until reload", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const first = [documentWithPrompt("До")];
    const next = [documentWithPrompt("После")];
    const props = { entities: [entity], onSelectEntity: vi.fn(), onApply };
    render(<MvpRulesPanel {...props} documents={first} />);
    setTextareaValue("Черновик");
    await rerender(<MvpRulesPanel {...props} documents={next} />);
    expect(container?.textContent).toContain("Правило изменилось после начала черновика");
    const save = container?.querySelector("button") && [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Сохранить"));
    expect(save).toBeDefined();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    act(() => (save as HTMLButtonElement).click());
    expect(onApply).not.toHaveBeenCalled();
    const reload = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Перезагрузить"));
    expect(reload).toBeDefined();
    act(() => (reload as HTMLButtonElement).click());
    expect((container?.querySelector("#mvp-rules-text") as HTMLTextAreaElement).value).toBe("После");
  });

  it("follows a clean external update before building a later patch", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const props = { entities: [entity], onSelectEntity: vi.fn(), onApply };
    render(<MvpRulesPanel {...props} documents={[documentWithPrompt("До")]} />);
    await rerender(<MvpRulesPanel {...props} documents={[documentWithPrompt("После")]} />);
    expect((container?.querySelector("#mvp-rules-text") as HTMLTextAreaElement).value).toBe("После");
    setTextareaValue("Новое правило");
    const save = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Сохранить"));
    act(() => (save as HTMLButtonElement).click());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      jsonPatches: [expect.objectContaining({ operations: expect.arrayContaining([expect.objectContaining({ op: "test", value: expect.objectContaining({ _prompt: expect.objectContaining({ raw: "После" }) }) })]) })]
    }));
  });

  it("keeps a dirty rule draft through an unrelated UI document update", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    const props = { entities: [entity], onSelectEntity: vi.fn(), onApply };
    render(<MvpRulesPanel {...props} documents={[documentWithPrompt("До"), uiDocument("one")]} />);
    setTextareaValue("Черновик");
    await rerender(<MvpRulesPanel {...props} documents={[documentWithPrompt("До"), uiDocument("two")]} />);
    expect((container?.querySelector("#mvp-rules-text") as HTMLTextAreaElement).value).toBe("Черновик");
    const save = [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Сохранить"));
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it("rebases after a successful save so a consecutive edit is applicable", async () => {
    const onApply = vi.fn().mockResolvedValue(true);
    render(<MvpRulesPanel entities={[entity]} documents={[documentWithPrompt("До")]} onSelectEntity={vi.fn()} onApply={onApply} />);
    setTextareaValue("Первое");
    const save = () => [...(container?.querySelectorAll("button") ?? [])].find((button) => button.textContent?.includes("Сохранить")) as HTMLButtonElement;
    await act(async () => save().click());
    setTextareaValue("Второе");
    await act(async () => save().click());
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(container?.textContent).not.toContain("Правило изменилось после начала черновика");
  });

  it("shows an empty prepared textarea when the candidate removes its description", () => {
    render(
      <MvpRulesPanel
        entities={[entity]}
        documents={[documentWithPrompt("Текущее")]} 
        onSelectEntity={vi.fn()}
        onApply={vi.fn().mockResolvedValue(true)}
        preparedDocuments={[{ filePath: "game.authoring.json", text: JSON.stringify({ root: {} }) }]}
      />
    );
    const candidate = container?.querySelector("[data-testid='mvp-rules-candidate']") as HTMLTextAreaElement | null;
    expect(candidate).not.toBeNull();
    expect(candidate?.value).toBe("");
  });
});
