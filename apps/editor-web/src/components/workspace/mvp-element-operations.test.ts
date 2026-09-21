import { applyJsonPatch, type JsonObject } from "@cubica/editor-engine";
import { describe, expect, it } from "vitest";

import {
  buildMvpElementAuthorPromptChangeSet,
  buildMvpElementNameChangeSet,
  buildMvpGeometryChangeSet,
  geometrySupport,
  isMvpMetadataOnlyChangeSet,
  resizeMvpRect,
  type MvpResizeAnchor,
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
    const template = { ...author!, jsonPatches: [{ filePath: source.filePath, operations: [
      { op: "add" as const, path: "/_definitions/ui.Example/_promptTemplate", value: "Описание прототипа" }
    ] }] };
    expect(isMvpMetadataOnlyChangeSet(template)).toBe(true);
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

  it("moves from an inherited transform while writing only a local style override", () => {
    const effectiveStyle = { transform: "translate(30px, 5px) rotate(10deg)", color: "blue" };
    const moved = buildMvpGeometryChangeSet(source, { x: 30, y: 5, width: 100, height: 50 },
      { kind: "move", dx: 7, dy: -2 }, effectiveStyle);
    expect(moved?.jsonPatches[0]?.operations.at(-1)).toEqual({ op: "add", path: `${source.pointer}/style`,
      value: { transform: "translate(37px, 3px) rotate(10deg)" } });
  });

  it("resizes from each of eight anchors while fixing the opposite sides", () => {
    const bounds = { x: 10, y: 20, width: 100, height: 80 };
    const expected: Record<MvpResizeAnchor, typeof bounds> = {
      nw: { x: 20, y: 26, width: 90, height: 74 },
      n: { x: 10, y: 26, width: 100, height: 74 },
      ne: { x: 10, y: 26, width: 110, height: 74 },
      e: { x: 10, y: 20, width: 110, height: 80 },
      se: { x: 10, y: 20, width: 110, height: 86 },
      s: { x: 10, y: 20, width: 100, height: 86 },
      sw: { x: 20, y: 20, width: 90, height: 86 },
      w: { x: 20, y: 20, width: 90, height: 80 }
    };
    for (const anchor of Object.keys(expected) as MvpResizeAnchor[]) {
      expect(resizeMvpRect(bounds, 10, 6, anchor), anchor).toEqual(expected[anchor]);
    }
    expect(resizeMvpRect(bounds, 999, 999, "nw")).toEqual({ x: 98, y: 88, width: 12, height: 12 });
  });

  it("persists a west-edge resize as width plus translation, preserving the opposite edge", () => {
    const styled = { ...source, value: { ...source.value, style: { width: 100, height: 80 } } };
    const changed = buildMvpGeometryChangeSet(styled, { x: 10, y: 20, width: 100, height: 80 },
      { kind: "resize", dx: 20, dy: 0, anchor: "w" });
    expect(changed?.jsonPatches[0]?.operations.at(-1)).toMatchObject({ op: "replace", value: {
      width: 80, height: 80, transform: "translate(20px, 0px) rotate(0deg)"
    } });
  });
});
