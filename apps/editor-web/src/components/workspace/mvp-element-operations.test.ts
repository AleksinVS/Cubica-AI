import { applyJsonPatch, type JsonObject } from "@cubica/editor-engine";
import { describe, expect, it } from "vitest";

import {
  buildMvpElementAuthorPromptChangeSet,
  buildMvpElementNameChangeSet,
  buildMvpGeometryChangeSet,
  geometrySupport,
  isMvpMetadataOnlyChangeSet,
  type MvpElementSource
} from "./mvp-element-operations";

const source: MvpElementSource = {
  filePath: "ui/web.authoring.json",
  pointer: "/root/screens/0/root/children/0",
  value: { _type: "ui.Component", _label: "Ответ", type: "button", props: { text: "Да" } }
};

function apply(sourceValue: JsonObject, changeSet: NonNullable<ReturnType<typeof buildMvpElementNameChangeSet>>) {
  return applyJsonPatch({ root: { screens: [{ root: { children: [sourceValue] } }] } }, changeSet.jsonPatches[0]?.operations ?? []);
}

describe("MVP element source mutations", () => {
  it("guards a direct name change against a stale sibling object", () => {
    const changeSet = buildMvpElementNameChangeSet(source, "Новый ответ");
    expect(changeSet).toBeDefined();
    expect(apply(source.value, changeSet as NonNullable<typeof changeSet>)).toMatchObject({ root: { screens: [{ root: { children: [{ _label: "Новый ответ" }] } }] } });
    expect(() => apply({ ...source.value, props: { text: "Изменено другим редактором" } }, changeSet as NonNullable<typeof changeSet>)).toThrow();
    expect(isMvpMetadataOnlyChangeSet(changeSet as NonNullable<typeof changeSet>)).toBe(true);
  });

  it("persists canonical author metadata and makes layout writes rebuild-eligible", () => {
    const author = buildMvpElementAuthorPromptChangeSet(source, "Показывай простой выбор");
    expect(author?.jsonPatches[0]?.operations.at(-1)).toMatchObject({
      op: "add", value: { status: "draft", raw: "Показывай простой выбор", source: "user", language: "ru" }
    });
    expect(isMvpMetadataOnlyChangeSet(author as NonNullable<typeof author>)).toBe(true);
    const moved = buildMvpGeometryChangeSet(source, { x: 20, y: 30, width: 120, height: 40 }, { kind: "move", dx: 13, dy: -2 });
    expect(moved?.jsonPatches[0]?.operations.at(-1)).toMatchObject({
      op: "add", value: { transform: "translate(13px, -2px) rotate(0deg)" }
    });
    expect(isMvpMetadataOnlyChangeSet(moved as NonNullable<typeof moved>)).toBe(false);
  });

  it("refuses unsupported units and separate canvas surfaces instead of corrupting geometry", () => {
    const fractional = { ...source, value: { ...source.value, style: { width: "50%" } } };
    expect(geometrySupport(fractional)).toMatch(/пиксели/u);
    expect(buildMvpGeometryChangeSet(fractional, { x: 0, y: 0, width: 100, height: 50 }, { kind: "resize", dx: 20, dy: 10 })).toBeUndefined();
    expect(geometrySupport({ ...source, value: { ...source.value, type: "interactiveBoardSurface" } })).toMatch(/отдельно/u);
  });
});
