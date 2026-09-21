import { describe, expect, it } from "vitest";
import { hashEditorText, interpretReturnedIntent, type EditorEntityProjectionDocument, type JsonObject, type PreviewEntityDescriptor } from "@cubica/editor-engine";
import { captureMvpSemanticSource, mvpProvenFacets } from "./mvp-bound-text-capture";
import { mapPlayerPreviewEntitiesToAuthoringDescriptors, type PreviewSelectionSourceMap } from "@/lib/preview-message-adapter";

const uiPath = "ui/web.authoring.json";
const gamePath = "game.authoring.json";
const ui = { _manifestType: "ui", _definitions: { "ui.BoundTitle": {
  _label: "Заголовок", _semantics: "Показывает заголовок этапа.", type: "richTextComponent",
  _projection: { properties: [
    { id: "contentTitle", facet: "content", path: "/title", reference: { facet: "content", path: "/title" }, label: "Заголовок этапа", presentation: "text" },
    { id: "color", facet: "view", path: "/style/color", label: "Цвет", presentation: "choice" }
  ] }, style: { color: "синий" }
} }, root: { item: { id: "ui-title", _type: "ui.BoundTitle", _label: "Первый", type: "richTextComponent", props: { html: "{{window.title}}" } } } };
const game = { _manifestType: "game", _definitions: {}, root: { content: { data: { windows: [{ id: "w", title: "Корпорация Антарктика" }] } } } };
const documents: EditorEntityProjectionDocument[] = [
  { filePath: uiPath, documentKind: "ui", json: ui as unknown as JsonObject },
  { filePath: gamePath, documentKind: "game", json: game }
];
const liveTexts = new Map([[uiPath, JSON.stringify(ui)], [gamePath, JSON.stringify(game)]]);
const source = { filePath: uiPath, pointer: "/root/item", value: ui.root.item as unknown as JsonObject };
const descriptor: PreviewEntityDescriptor = {
  entityId: "preview-title", authoringPointer: source.pointer, runtimePointer: "/screens/S1/root/children/0", visible: true,
  label: "Title", semanticRole: "ui-component", bounds: { x: 0, y: 0, width: 10, height: 10 },
  metadata: { sourceFile: "games/neutral/authoring/ui/web.authoring.json", displayText: "Корпорация Антарктика",
    contentOwnerSourceFile: "games/neutral/authoring/game.authoring.json", contentOwnerSourcePointer: "/root/content/data/windows/0",
    textBinding: { prop: "html", expression: "{{window.title}}", contentSourceFile: "games/neutral/authoring/game.authoring.json",
      contentSourcePointer: "/root/content/data/windows/0/title" } }
};

describe("MVP semantic capture from proven preview metadata", () => {
  it("edits exact content owner while preserving the UI expression and hashing both files", () => {
    const capture = captureMvpSemanticSource({ source, mode: "instance", documents, liveTexts, descriptor, gameId: "neutral", contextKey: "scene-1" })!;
    expect(capture.projectionYaml).toContain('Заголовок этапа: "Корпорация Антарктика"');
    expect(capture.projectionYaml).not.toContain("{{window.title}}");
    expect(capture.sourceHashes).toEqual({ [uiPath]: hashEditorText(liveTexts.get(uiPath)!), [gamePath]: hashEditorText(liveTexts.get(gamePath)!) });
    const changed = capture.projectionYaml.replace("Корпорация Антарктика", "Новый заголовок");
    const result = interpretReturnedIntent({ ...capture, returnedText: changed });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches).toEqual([{ filePath: gamePath, operations: [{ op: "replace", path: "/root/content/data/windows/0/title", value: "Новый заголовок" }] }]);
  });

  it("refuses an unresolved owner instead of matching display text or an id", () => {
    const unresolved = { ...descriptor, metadata: { ...descriptor.metadata,
      contentOwnerSourcePointer: "/root/content/data/windows/9",
      textBinding: { prop: "html", expression: "{{window.title}}", contentSourceFile: "games/neutral/authoring/game.authoring.json",
        contentSourcePointer: "/root/content/data/windows/9/title" } } } as PreviewEntityDescriptor;
    expect(mvpProvenFacets(unresolved, documents, "neutral")).toEqual([]);
    const capture = captureMvpSemanticSource({ source, mode: "instance", documents, liveTexts, descriptor: unresolved, gameId: "neutral", contextKey: "scene-1" })!;
    expect(capture.projectionYaml).not.toContain("Корпорация Антарктика");
    expect(capture.semantic.properties.some((property) => property.scope === "shared")).toBe(false);
  });

  it("does not infer a writable content instance from the parent of a bound leaf", () => {
    const leafOnly = structuredClone(descriptor);
    delete (leafOnly.metadata as Record<string, unknown>).contentOwnerSourceFile;
    delete (leafOnly.metadata as Record<string, unknown>).contentOwnerSourcePointer;
    expect(mvpProvenFacets(leafOnly, documents, "neutral")).toEqual([]);
  });

  it("captures an inherited bound title through player object origin and exact source maps", () => {
    const inheritedGame = { _manifestType: "game", _definitions: { "content.Window": { title: "Корпорация Антарктика" } },
      root: { content: { data: { windows: [{ id: "w", _type: "content.Window" }, { id: "other", _type: "content.Window" }] } } } };
    const inheritedDocuments: EditorEntityProjectionDocument[] = [
      documents[0], { filePath: gamePath, documentKind: "game", json: inheritedGame }
    ];
    const maps: PreviewSelectionSourceMap[] = [
      { generatedFile: "games/neutral/ui/web/ui.manifest.json", sourceFile: "games/neutral/authoring/ui/web.authoring.json",
        mappings: { "/screens/S1/root/children/0": [{ file: "games/neutral/authoring/ui/web.authoring.json", pointer: "/root/item" }] } },
      { generatedFile: "games/neutral/game.manifest.json", sourceFile: "games/neutral/authoring/game.authoring.json",
        mappings: {
          "/content/data/windows/0": [{ file: "games/neutral/authoring/game.authoring.json", pointer: "/root/content/data/windows/0" }],
          "/content/data/windows/0/title": [{ file: "games/neutral/authoring/game.authoring.json", pointer: "/root/content/data/windows/0/title" }]
        } }
    ];
    const playerEntity = { entityId: "preview-title", runtimePointer: "/screens/S1/root/children/0",
      contentRuntimePointer: "/content/data/windows/0", label: "Title", semanticRole: "ui-component",
      bounds: { x: 0, y: 0, width: 10, height: 10 }, textBinding: { prop: "html" as const, expression: "{{window.title}}",
        contentRuntimePointer: "/content/data/windows/0/title" } };
    const mapped = mapPlayerPreviewEntitiesToAuthoringDescriptors([playerEntity], maps,
      { gameId: "neutral", currentAuthoringFile: uiPath });
    expect(mapped.unresolved).toEqual([]);
    expect(mapped.descriptors[0]?.metadata).toMatchObject({ contentOwnerSourcePointer: "/root/content/data/windows/0" });
    const capture = captureMvpSemanticSource({ source, mode: "instance", documents: inheritedDocuments,
      liveTexts: new Map([[uiPath, JSON.stringify(ui)], [gamePath, JSON.stringify(inheritedGame)]]),
      descriptor: mapped.descriptors[0], gameId: "neutral", contextKey: "scene-inherited" })!;
    expect(capture.projectionYaml).toContain('Заголовок этапа: "Корпорация Антарктика"');
    expect(capture.projectionYaml).not.toContain("{{window.title}}");
    const change = interpretReturnedIntent({ ...capture, returnedText: capture.projectionYaml.replace("Корпорация Антарктика", "Новая глава") });
    expect(change.path).toBe("deterministic");
    expect(change.changeSet?.jsonPatches).toEqual([{ filePath: gamePath,
      operations: [{ op: "add", path: "/root/content/data/windows/0/title", value: "Новая глава" }] }]);
  });

  it("shows inherited prototype values without the opening instance's local override", () => {
    const prototypeSource = { filePath: uiPath, pointer: "/_definitions/ui.BoundTitle", value: ui._definitions["ui.BoundTitle"] as unknown as JsonObject };
    const capture = captureMvpSemanticSource({ source: prototypeSource, mode: "prototype", documents, liveTexts, gameId: "neutral", contextKey: "prototype-1" })!;
    expect(capture.projectionYaml).toContain('Цвет: "синий"');
    expect(capture.projectionYaml).not.toContain("Корпорация Антарктика");
  });
});
