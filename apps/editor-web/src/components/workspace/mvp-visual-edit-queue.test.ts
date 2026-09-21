import { applyJsonPatch, readJsonPointer, type EditorChangeSet, type JsonObject, type JsonValue } from "@cubica/editor-engine";
import { describe, expect, it } from "vitest";

import { createMvpVisualEditQueue } from "./mvp-visual-edit-queue";

const filePath = "ui/web.authoring.json";
const sourcePath = "/root/items/0";

function documents(source: JsonObject): ReadonlyMap<string, string> {
  return new Map([[filePath, `${JSON.stringify({ root: { items: [source] } })}\n`]]);
}

function sourceFrom(documentsByPath: ReadonlyMap<string, string>): JsonObject {
  return readJsonPointer(JSON.parse(documentsByPath.get(filePath) as string) as JsonValue, sourcePath) as JsonObject;
}

function edit(id: string, base: ReadonlyMap<string, string>, field: string, value: JsonValue): EditorChangeSet {
  const source = sourceFrom(base);
  return {
    id,
    summary: id,
    jsonPatches: [{ filePath, operations: [
      { op: "test", path: sourcePath, value: source },
      { op: Object.hasOwn(source, field) ? "replace" : "add", path: `${sourcePath}/${field}`, value }
    ] }]
  };
}

function apply(request: NonNullable<ReturnType<ReturnType<typeof createMvpVisualEditQueue>["next"]>>): ReadonlyMap<string, string> {
  const root = JSON.parse(request.baseDocuments.get(filePath) as string) as JsonValue;
  const after = applyJsonPatch(root, request.changeSet.jsonPatches[0]?.operations ?? []);
  return new Map([[filePath, `${JSON.stringify(after)}\n`]]);
}

const initial = documents({ _id: "button-1", _type: "ui.Component", type: "button", _label: "Old", text: "Yes" });

describe("MVP visual edit queue", () => {
  it("keeps B visible over a late A acknowledgement and rebases B against confirmed A", () => {
    const queue = createMvpVisualEditQueue("session:scene", initial);
    queue.enqueue(edit("A", initial, "_label", "New"));
    const first = queue.next();
    expect(first?.operationId).toBe("A");
    expect(queue.next()).toBe(first);
    queue.enqueue(edit("B", queue.projectedDocuments, "text", "No"));
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _label: "New", text: "No" });
    queue.acknowledge("A", apply(first!));
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _label: "New", text: "No" });
    const second = queue.next();
    expect(second?.operationId).toBe("B");
    expect(sourceFrom(apply(second!))).toMatchObject({ _label: "New", text: "No" });
    expect(second?.changeSet.id).toBe("B");
  });

  it("preserves independent B after A rejection, while retaining a dependent draft as conflict", () => {
    const queue = createMvpVisualEditQueue("session:scene", initial);
    queue.enqueue(edit("A", initial, "_label", "New"));
    queue.next();
    queue.enqueue(edit("B", queue.projectedDocuments, "text", "No"));
    queue.enqueue(edit("C", queue.projectedDocuments, "_label", "Newest"));
    queue.reject("A", "server rejected A");
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _label: "Old", text: "No" });
    expect(queue.entries.map(({ operationId, status }) => [operationId, status])).toEqual([
      ["A", "rejected"], ["B", "queued"], ["C", "conflict"]
    ]);
    expect(queue.entries[2]?.changeSet.id).toBe("C");
    expect(queue.next()?.operationId).toBe("B");
  });

  it("rebases an independent external change but conflicts on a changed read or target identity", () => {
    const queue = createMvpVisualEditQueue("session:scene", initial);
    queue.enqueue(edit("A", initial, "text", "No"));
    queue.updateConfirmedDocuments(documents({ ...sourceFrom(initial), _label: "External" }));
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _label: "External", text: "No" });
    expect(queue.next()?.operationId).toBe("A");

    const target = createMvpVisualEditQueue("session:scene", initial);
    target.enqueue(edit("B", initial, "text", "No"));
    target.updateConfirmedDocuments(documents({ ...sourceFrom(initial), _id: "replacement" }));
    expect(target.entries[0]?.status).toBe("conflict");
    expect(target.next()).toBeUndefined();

    const dependency = createMvpVisualEditQueue("session:scene", initial);
    dependency.enqueue(edit("C", initial, "text", "No"));
    dependency.updateConfirmedDocuments(documents({ ...sourceFrom(initial), text: "Maybe" }));
    expect(dependency.entries[0]?.status).toBe("conflict");
    dependency.updateConfirmedDocuments(initial);
    expect(dependency.entries[0]?.status).toBe("conflict");
    expect(dependency.retryConflict("C")).toBe(true);
    expect(dependency.entries[0]?.status).toBe("queued");
  });

  it("treats a whole style write atomically and rejects nonvisual structural writes", () => {
    const styleBase = documents({ ...sourceFrom(initial), style: { width: 100, transform: "translate(0px, 0px) rotate(0deg)" } });
    const queue = createMvpVisualEditQueue("session:scene", styleBase);
    queue.enqueue(edit("geometry", styleBase, "style", { width: 120, transform: "translate(5px, 0px) rotate(0deg)" }));
    queue.updateConfirmedDocuments(documents({ ...sourceFrom(styleBase), style: { width: 100, transform: "translate(0px, 0px) rotate(0deg)", color: "red" } }));
    expect(queue.entries[0]?.status).toBe("conflict");
    const remove: EditorChangeSet = { id: "remove", summary: "remove", jsonPatches: [{ filePath, operations: [
      { op: "remove", path: `${sourcePath}/text` }
    ] }] };
    expect(() => queue.enqueue(remove)).toThrow(/scalar or style/u);
  });

  it("creates only empty props/style parents and detects a changed or missing parent", () => {
    const noProps = documents({ _id: "button-1", _type: "ui.Component", type: "button" });
    const createProps: EditorChangeSet = { id: "parent", summary: "parent", jsonPatches: [{ filePath, operations: [
      { op: "test", path: sourcePath, value: sourceFrom(noProps) },
      { op: "add", path: `${sourcePath}/props`, value: {} }
    ] }] };
    const queue = createMvpVisualEditQueue("session:scene", noProps);
    queue.enqueue(createProps);
    expect(sourceFrom(queue.projectedDocuments).props).toEqual({});
    queue.updateConfirmedDocuments(documents({ ...sourceFrom(noProps), props: { caption: "Other" } }));
    expect(queue.entries[0]?.status).toBe("conflict");
    expect(queue.next()).toBeUndefined();

    const removedParent = createMvpVisualEditQueue("session:scene", noProps);
    removedParent.enqueue(createProps);
    removedParent.updateConfirmedDocuments(new Map([[filePath, '{"root":{"items":[]}}\n']]));
    expect(removedParent.entries[0]?.status).toBe("conflict");

    const createStyle = { ...createProps, id: "style", jsonPatches: [{ filePath, operations: [
      { op: "test" as const, path: sourcePath, value: sourceFrom(noProps) },
      { op: "add" as const, path: `${sourcePath}/style`, value: {} }
    ] }] };
    expect(() => createMvpVisualEditQueue("session:scene", noProps).enqueue(createStyle)).not.toThrow();
    const invalid = { ...createProps, id: "bad", jsonPatches: [{ filePath, operations: [
      { op: "test" as const, path: sourcePath, value: sourceFrom(noProps) },
      { op: "add" as const, path: `${sourcePath}/props`, value: { caption: "X" } }
    ] }] };
    expect(() => createMvpVisualEditQueue("session:scene", noProps).enqueue(invalid)).toThrow(/scalar or style/u);
  });

  it("keeps a child edit dependent on a newly created props parent", () => {
    const noProps = documents({ _id: "button-1", _type: "ui.Component", type: "button" });
    const createProps: EditorChangeSet = { id: "parent", summary: "parent", jsonPatches: [{ filePath, operations: [
      { op: "test", path: sourcePath, value: sourceFrom(noProps) },
      { op: "add", path: `${sourcePath}/props`, value: {} }
    ] }] };
    const child = (base: ReadonlyMap<string, string>): EditorChangeSet => ({ id: "child", summary: "child", jsonPatches: [{ filePath, operations: [
      { op: "test", path: sourcePath, value: sourceFrom(base) },
      { op: "add", path: `${sourcePath}/props/caption`, value: "Hello" }
    ] }] });
    const accepted = createMvpVisualEditQueue("session:scene", noProps);
    accepted.enqueue(createProps);
    const parentRequest = accepted.next();
    accepted.enqueue(child(accepted.projectedDocuments));
    accepted.acknowledge("parent", apply(parentRequest!));
    expect(accepted.next()?.operationId).toBe("child");

    const rejected = createMvpVisualEditQueue("session:scene", noProps);
    rejected.enqueue(createProps);
    rejected.next();
    rejected.enqueue(child(rejected.projectedDocuments));
    rejected.reject("parent");
    expect(rejected.entries[1]?.status).toBe("conflict");
    expect(rejected.next()).toBeUndefined();
  });

  it("records absent type and inheritance dependencies when narrowing a source test", () => {
    const base = documents({ _id: "button-1", text: "Old" });
    for (const changed of ([{ _type: "ui.Component" }, { type: "button" }, { _extends: "ui.Base" }] as JsonObject[])) {
      const queue = createMvpVisualEditQueue("session:scene", base);
      queue.enqueue(edit("text", base, "text", "New"));
      queue.updateConfirmedDocuments(documents({ ...sourceFrom(base), ...changed }));
      expect(queue.entries[0]?.status, JSON.stringify(changed)).toBe("conflict");
      expect(queue.next()).toBeUndefined();
    }
  });

  it("conflicts when inherited defaults change before an instance geometry write", () => {
    const instance = { _id: "button-1", _type: "ui.Base", type: "button" };
    const withDefinitions = (width: number) => new Map([[filePath, `${JSON.stringify({
      _definitions: { "ui.Base": { style: { width } } }, root: { items: [instance] }
    })}\n`]]);
    const base = withDefinitions(100);
    const queue = createMvpVisualEditQueue("session:scene", base);
    queue.enqueue(edit("geometry", base, "style", { width: 120 }));
    queue.updateConfirmedDocuments(withDefinitions(110));
    expect(queue.entries[0]?.status).toBe("conflict");
    expect(queue.entries[0]?.reason).toContain("/_definitions");
    expect(queue.next()).toBeUndefined();
  });

  it("isolates scene projections and old acknowledgements while retaining drafts and statuses", () => {
    const queue = createMvpVisualEditQueue("session:scene-a", initial);
    queue.enqueue(edit("A", initial, "text", "No"));
    const request = queue.next();
    const other = documents({ _id: "scene-b", text: "Other" });
    queue.setContext("session:scene-b", other);
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _id: "scene-b", text: "Other" });
    expect(queue.pending).toHaveLength(0);
    expect(queue.next()).toBeUndefined();
    queue.enqueue(edit("B", other, "text", "Changed"));
    const second = queue.next();
    expect(second?.operationId).toBe("B");
    expect(queue.next()).toBe(second);
    expect(queue.pending.map((entry) => entry.operationId)).toEqual(["B"]);
    queue.setContext("session:scene-a", initial);
    expect(queue.next()).toBe(request);
    queue.setContext("session:scene-b", other);
    expect(queue.next()).toBe(second);
    queue.acknowledge("A", apply(request!));
    expect(sourceFrom(queue.projectedDocuments)).toMatchObject({ _id: "scene-b", text: "Changed" });
    expect(queue.next()).toBe(second);
    expect(queue.entries[0]?.status).toBe("confirmed");
    queue.acknowledge("B", apply(second!));
    queue.setContext("session:scene-a", apply(request!));
    expect(sourceFrom(queue.projectedDocuments).text).toBe("No");
  });

  it("does not send a draft from an inactive context and allows an explicit dismissal", () => {
    const queue = createMvpVisualEditQueue("session:scene-a", initial);
    queue.enqueue(edit("A", initial, "text", "No"));
    const other = documents({ _id: "scene-b", text: "Other" });
    queue.setContext("session:scene-b", other);
    expect(queue.next()).toBeUndefined();
    queue.dismiss("A");
    expect(queue.entries[0]).toMatchObject({ operationId: "A", status: "rejected", reason: "Draft dismissed" });
    queue.setContext("session:scene-a", initial);
    expect(sourceFrom(queue.projectedDocuments).text).toBe("Yes");
  });
});
