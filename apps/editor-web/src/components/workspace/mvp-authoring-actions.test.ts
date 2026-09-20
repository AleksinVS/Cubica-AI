import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  dryRunMultiDocumentChangeSet,
  buildEditorEntityYamlProjection,
  readJsonPointer,
  type EditorChangeSet,
  type EditorEntityProjectionDocument,
  type JsonObject,
  type JsonValue
} from "@cubica/editor-engine";
import { getSharedAuthoringSchemaRegistry, schemaIdForAuthoringDocument } from "@/lib/editor-json-schema";
import { validateAuthoringForEditor } from "@/lib/compiler-workflow";
import { buildMvpCreateItem, buildMvpSavePrototype, combineMvpDraftChanges, mvpPrototypeEntries, mvpSourceEntity, splitMvpDraftLabelHeader } from "./mvp-authoring-actions";
import { projectMvpRuleEntities, ruleEntities } from "./mvp-rules-panel-helpers";

const root = path.join(process.cwd(), "..", "..", "games", "simple-choice", "authoring");
const gamePath = "game.authoring.json";
const uiPath = "ui/web.authoring.json";

async function realDocuments(): Promise<EditorEntityProjectionDocument[]> {
  const [gameText, uiText] = await Promise.all([
    readFile(path.join(root, gamePath), "utf8"), readFile(path.join(root, uiPath), "utf8")
  ]);
  return [
    { filePath: gamePath, documentKind: "game", json: JSON.parse(gameText) as JsonValue },
    { filePath: uiPath, documentKind: "ui", channel: "web", json: JSON.parse(uiText) as JsonValue }
  ];
}

function dryRun(changeSet: EditorChangeSet, documents: readonly EditorEntityProjectionDocument[]) {
  return dryRunMultiDocumentChangeSet({
    changeSet,
    documentTextByPath: new Map(documents.map((document) => [document.filePath, JSON.stringify(document.json)])),
    schemaRegistry: getSharedAuthoringSchemaRegistry(),
    resolveSchemaId: (filePath) => schemaIdForAuthoringDocument(filePath, undefined),
    includeSemanticDiagnostics: true
  });
}

describe("MVP authoring actions", () => {
  it("adds rules, pages and elements through real Simple Choice document dry-runs", async () => {
    const documents = await realDocuments();
    const rule = buildMvpCreateItem("rule", documents);
    expect(rule.ok).toBe(true);
    if (!rule.ok) return;
    expect(rule.source.pointer).toBe("/root/logic/rules/0");
    const ruleRun = dryRun(rule.changeSet, documents);
    expect(ruleRun.ok, JSON.stringify(ruleRun.diagnostics)).toBe(true);
    const createdRules = ruleEntities(projectMvpRuleEntities([{
      ...documents[0]!, json: JSON.parse(ruleRun.afterTextByPath.get(gamePath)!) as JsonValue
    }]));
    expect(createdRules).toEqual([expect.objectContaining({ entityId: rule.entityId, primarySource: { filePath: gamePath, pointer: rule.source.pointer, documentKind: "game" } })]);
    const gameValidation = await validateAuthoringForEditor({
      gameId: "simple-choice", filePath: gamePath, text: ruleRun.afterTextByPath.get(gamePath)!, repoRoot: path.join(root, "..", "..", "..")
    });
    expect(gameValidation.ok, JSON.stringify(gameValidation.diagnostics)).toBe(true);

    const page = buildMvpCreateItem("page", documents);
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.source.pointer).toBe("/root/screens/2");
    const pageRun = dryRun(page.changeSet, documents);
    expect(pageRun.ok, JSON.stringify(pageRun.diagnostics)).toBe(true);
    const pageValidation = await validateAuthoringForEditor({
      gameId: "simple-choice", filePath: uiPath, text: pageRun.afterTextByPath.get(uiPath)!, repoRoot: path.join(root, "..", "..", "..")
    });
    expect(pageValidation.ok, JSON.stringify(pageValidation.diagnostics)).toBe(true);

    const element = buildMvpCreateItem("element", documents, { filePath: uiPath, pointer: "/root/screens/1" });
    expect(element.ok).toBe(true);
    if (!element.ok) return;
    expect(element.source.pointer).toBe("/root/screens/1/root/children/2");
    const elementRun = dryRun(element.changeSet, documents);
    expect(elementRun.ok, JSON.stringify(elementRun.diagnostics)).toBe(true);
    const elementValidation = await validateAuthoringForEditor({
      gameId: "simple-choice", filePath: uiPath, text: elementRun.afterTextByPath.get(uiPath)!, repoRoot: path.join(root, "..", "..", "..")
    });
    expect(elementValidation.ok, JSON.stringify(elementValidation.diagnostics)).toBe(true);
    expect(buildMvpCreateItem("element", documents, { filePath: uiPath, pointer: "/root/screens/99" })).toMatchObject({ ok: false });
  }, 60_000);

  it("saves only the selected subtree and assigns new internal ids when reused", async () => {
    const documents = await realDocuments();
    const ui = documents[1]!;
    const pointer = "/root/screens/0/root/children/1/children/1";
    const original = readJsonPointer(ui.json!, pointer) as JsonObject;
    const selected = JSON.parse(JSON.stringify(original)) as Record<string, JsonValue>;
    selected.props = { ...(selected.props as JsonObject), targetId: "choice-card", sourceId: selected.id, externalId: "choice.accept", actionId: "choice-card" };
    selected.gameEntityId = "choice-card";
    const editedUi = JSON.parse(JSON.stringify(ui.json)) as Record<string, JsonValue>;
    const node = readJsonPointer(editedUi, pointer) as Record<string, JsonValue>;
    node.props = selected.props;
    node.gameEntityId = selected.gameEntityId;
    const editedDocs = [documents[0]!, { ...ui, json: editedUi }];
    const source = { filePath: uiPath, pointer, value: selected };
    const saved = buildMvpSavePrototype(source, editedDocs);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.changeSet.jsonPatches).toHaveLength(1);
    expect(saved.changeSet.jsonPatches[0]?.filePath).toBe(uiPath);
    expect(saved.changeSet.jsonPatches[0]?.operations.map((operation) => operation.op)).toEqual(["test", "add"]);
    const savedRun = dryRun(saved.changeSet, editedDocs);
    expect(savedRun.ok, JSON.stringify(savedRun.diagnostics)).toBe(true);
    const afterSave = JSON.parse(savedRun.afterTextByPath.get(uiPath)!) as JsonObject;
    expect(readJsonPointer(afterSave, pointer)).toEqual(selected);
    const definition = readJsonPointer(afterSave, saved.source.pointer) as JsonObject;
    expect(definition.id).toBeUndefined();
    expect(definition.gameEntityId).toBeUndefined();
    expect((definition.props as JsonObject).targetId).toBe("choice-card");
    expect(mvpPrototypeEntries([{ ...ui, json: afterSave }])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: saved.source.pointer.slice("/_definitions/".length) })
    ]));

    const inserted = buildMvpCreateItem(
      `prototype:${saved.source.pointer.slice("/_definitions/".length)}`,
      [documents[0]!, { ...ui, json: afterSave }],
      { filePath: uiPath, pointer: "/root/screens/0" }
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const insertedRun = dryRun(inserted.changeSet, [documents[0]!, { ...ui, json: afterSave }]);
    expect(insertedRun.ok, JSON.stringify(insertedRun.diagnostics)).toBe(true);
    const afterInsert = JSON.parse(insertedRun.afterTextByPath.get(uiPath)!) as JsonObject;
    const copy = readJsonPointer(afterInsert, inserted.source.pointer) as JsonObject;
    const child = (copy.children as JsonObject[])[0]!;
    expect(copy.id).not.toBe(selected.id);
    expect(child.id).not.toBe("choice-card");
    expect((copy.props as JsonObject).targetId).toBe(child.id);
    expect((copy.props as JsonObject).sourceId).toBe(copy.id);
    expect((copy.props as JsonObject).externalId).toBe("choice.accept");
    expect((copy.props as JsonObject).actionId).toBe("choice-card");
    expect(copy.gameEntityId).toBeUndefined();
    expect(readJsonPointer(afterInsert, pointer)).toEqual(selected);

    const withoutDefinitions = JSON.parse(JSON.stringify(editedUi)) as Record<string, JsonValue>;
    delete withoutDefinitions._definitions;
    const firstDefinition = buildMvpSavePrototype(source, [documents[0]!, { ...ui, json: withoutDefinitions }]);
    expect(firstDefinition.ok).toBe(true);
    if (firstDefinition.ok) {
      expect(firstDefinition.changeSet.jsonPatches[0]?.operations[1]?.path).toBe("/_definitions");
      const firstRun = dryRun(firstDefinition.changeSet, [documents[0]!, { ...ui, json: withoutDefinitions }]);
      expect(firstRun.ok, JSON.stringify(firstRun.diagnostics)).toBe(true);
    }
  });

  it("rejects stale source capture and prevents a metadata/YAML field collision", async () => {
    const documents = await realDocuments();
    const pointer = "/root/screens/0/root/children/1/children/0";
    const value = readJsonPointer(documents[1]!.json!, pointer) as JsonObject;
    const stale = { ...value, _label: "Earlier label" };
    expect(buildMvpSavePrototype({ filePath: uiPath, pointer, value: stale }, documents)).toMatchObject({ ok: false });
    const source = { filePath: uiPath, pointer, value };
    const structured: EditorChangeSet = { id: "yaml", summary: "YAML", jsonPatches: [{ filePath: uiPath, operations: [
      { op: "replace", path: `${pointer}/_prompt`, value: { raw: "YAML" } }
    ] }] };
    const metadata: EditorChangeSet = { id: "meta", summary: "Metadata", jsonPatches: [{ filePath: uiPath, operations: [
      { op: "test", path: pointer, value }, { op: "add", path: `${pointer}/_prompt`, value: { raw: "Author" } }
    ] }] };
    expect(combineMvpDraftChanges(source, structured, metadata)).toBeUndefined();
    const safeStructured: EditorChangeSet = { id: "text", summary: "Text", jsonPatches: [{ filePath: uiPath, operations: [
      { op: "replace", path: `${pointer}/props/html`, value: "<p>Новое значение</p>" }
    ] }] };
    const safeMetadata: EditorChangeSet = { id: "prompt", summary: "Prompt", jsonPatches: [{ filePath: uiPath, operations: [
      { op: "test", path: pointer, value },
      { op: "add", path: `${pointer}/_prompt`, value: { status: "draft", raw: "Авторский замысел", source: "user", language: "ru", updatedAt: "2026-09-20T00:00:00.000Z" } }
    ] }] };
    const combined = combineMvpDraftChanges(source, safeStructured, safeMetadata);
    expect(combined).toBeDefined();
    const combinedRun = dryRun(combined!, documents);
    expect(combinedRun.ok, JSON.stringify(combinedRun.diagnostics)).toBe(true);
    const combinedNode = readJsonPointer(JSON.parse(combinedRun.afterTextByPath.get(uiPath)!) as JsonValue, pointer) as JsonObject;
    expect((combinedNode.props as JsonObject).html).toBe("<p>Новое значение</p>");
    expect((combinedNode._prompt as JsonObject).raw).toBe("Авторский замысел");
    expect(mvpSourceEntity(source, "ui")).toMatchObject({
      primarySource: { filePath: uiPath, pointer }, facets: { view: [{ filePath: uiPath, pointer }] }
    });
    const yaml = buildEditorEntityYamlProjection({ entity: mvpSourceEntity(source, "ui"), documents });
    expect(yaml.facetSourceMap.lines.filter((line) => line.pointer !== undefined)
      .every((line) => line.pointer === pointer || line.pointer?.startsWith(`${pointer}/`))).toBe(true);
    expect(yaml.facetSourceMap.lines.some((line) => line.pointer === pointer)).toBe(true);
    expect(splitMvpDraftLabelHeader('_label: "Новое имя"\nСущность: старая')).toEqual({ label: "Новое имя", returnedText: "Сущность: старая" });
    expect(splitMvpDraftLabelHeader('_label: ""\nСущность: старая')).toMatchObject({ error: expect.any(String) });
  });

  it("lists and instantiates inherited Antarctica UI prototypes with child overrides", async () => {
    const text = await readFile(path.join(process.cwd(), "..", "..", "games", "antarctica", "authoring", uiPath), "utf8");
    const ui = { filePath: uiPath, documentKind: "ui" as const, channel: "web", json: JSON.parse(text) as JsonValue };
    const definitionType = "ui.AntarcticaTopbarRemainingDaysMetric";
    expect(mvpPrototypeEntries([ui])).toContainEqual({ id: definitionType, label: "Topbar-метрика remainingDays Antarctica" });
    const created = buildMvpCreateItem(`prototype:${definitionType}`, [ui], { filePath: uiPath, pointer: "/root/screens/0" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const operation = created.changeSet.jsonPatches[0]?.operations.at(-1);
    const node = operation !== undefined && "value" in operation ? operation.value as JsonObject : undefined;
    expect(node).toBeDefined();
    if (node === undefined) return;
    expect(node.type).toBe("gameVariableComponent");
    expect((node.props as JsonObject).metricId).toBe("remainingDays");
    expect((node.props as JsonObject).backgroundImage).toBe("asset:top-sidebar-days-top");
    expect(node.id).not.toBe("remainingDays");
    expect(dryRun(created.changeSet, [ui]).ok).toBe(true);

    const broken = JSON.parse(text) as Record<string, JsonValue>;
    const definitions = broken._definitions as Record<string, JsonValue>;
    definitions[definitionType] = { ...(definitions[definitionType] as JsonObject), _extends: "ui.MissingMetricBadge" };
    const brokenUi = { ...ui, json: broken };
    expect(mvpPrototypeEntries([brokenUi]).some((entry) => entry.id === definitionType)).toBe(false);
    expect(buildMvpCreateItem(`prototype:${definitionType}`, [brokenUi], { filePath: uiPath, pointer: "/root/screens/0" })).toMatchObject({ ok: false });
    definitions[definitionType] = { ...(definitions[definitionType] as JsonObject), _extends: definitionType };
    expect(mvpPrototypeEntries([brokenUi]).some((entry) => entry.id === definitionType)).toBe(false);
  });
});
