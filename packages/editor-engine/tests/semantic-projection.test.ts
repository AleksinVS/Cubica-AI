import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyJsonPatch, buildSemanticEntityProjection, interpretReturnedIntent, type EditorEntityProjectionDocument, type JsonObject } from "../src/index.ts";

const uiPath = "neutral/ui.authoring.json";
const gamePath = "neutral/game.authoring.json";
const prototype = {
  _label: "Индикатор",
  _semantics: "Показывает значение и заголовок.",
  _projection: { properties: [
    { id: "title", facet: "view", path: "/props/title", label: "Заголовок", presentation: "text" },
    { id: "color", facet: "view", path: "/props/style/color", label: "Цвет", presentation: "choice" },
    { id: "children", facet: "view", path: "/children/0/props/text", label: "Дочерний текст", presentation: "text" }
  ] },
  props: { title: "Базовый", style: { color: "синий", weight: "bold" } },
  children: [{ props: { text: "исходный" } }]
};
function neutralDocs(instance: JsonObject = { _type: "ui.ChildBadge", _label: "Первый", props: {} }): EditorEntityProjectionDocument[] {
  return [{ filePath: uiPath, documentKind: "ui", json: {
    _definitions: {
      "ui.BaseBadge": prototype,
      "ui.ChildBadge": { _extends: "ui.BaseBadge", _semantics: "Уточнённый индикатор.", _projection: { properties: [{ id: "title", facet: "view", path: "/props/title", label: "Название", presentation: "text" }] } }
    }, root: { item: instance }
  } }];
}
const target = { filePath: uiPath, pointer: "/root/item" };

describe("ADR-108 semantic projection", () => {
  it("prints one section per facet, preserves exact scalar source mapping, and keeps one-field text compact", () => {
    const docs = neutralDocs();
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs });
    expect(projection.text).toContain('Элемент:\n  Название элемента: "Первый"');
    expect(projection.text).toContain('  Название: "Базовый"');
    const colorLine = projection.facetSourceMap.lines.find((line) => line.pointer === "/root/item/props/style/color")!;
    const printed = projection.text.trimEnd().split("\n")[colorLine.line];
    expect(printed.slice(colorLine.valueStart)).toBe('"синий"');
    const single: EditorEntityProjectionDocument[] = [{ filePath: uiPath, documentKind: "ui", json: {
      _definitions: { "ui.Single": { _projection: { properties: [{ id: "title", facet: "view", path: "/title", presentation: "text", label: "Заголовок" }] }, title: "Один" } },
      root: { item: { _type: "ui.Single" } }
    } }];
    expect(buildSemanticEntityProjection({ mode: "instance", target, documents: single }).text).toBe('Заголовок: "Один"\n');
  });

  it("coalesces interleaved explicit groups and quotes unsafe or duplicate YAML keys without redirecting edits", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    const base = (json._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    delete ((json._definitions as JsonObject)["ui.ChildBadge"] as Record<string, unknown>)._projection;
    (base._projection as { properties: JsonObject[] }).properties = [
      { id: "title", facet: "view", path: "/props/title", label: "Текст: главный", group: "Данные: основные", presentation: "text" },
      { id: "color", facet: "view", path: "/props/style/color", label: "Цвет", group: "Вид", presentation: "choice" },
      { id: "children", facet: "view", path: "/children/0/props/text", label: "Текст: главный", group: "Данные: основные", presentation: "text" }
    ];
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...docs[0], json }] });
    expect(projection.text.match(/"Данные: основные":/gu)).toHaveLength(1);
    expect(projection.text).toContain('  "Текст: главный": "исходный"');
    expect(projection.text).toContain('  "Текст: главный (2)": "Базовый"');
    expect(projection.text).toContain('Вид:\n  Цвет: "синий"');
    const returnedText = projection.text.replace('"Текст: главный (2)": "Базовый"', '"Текст: главный (2)": "Новый"');
    const result = interpretReturnedIntent({ projectionYaml: projection.text, returnedText,
      facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches[0].operations).toEqual([{ op: "add", path: "/root/item/props/title", value: "Новый" }]);
  });

  it("leaves a mixed-facet group header neutral while retaining exact facet and write target on each field", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    delete ((json._definitions as JsonObject)["ui.ChildBadge"] as Record<string, unknown>)._projection;
    const base = (json._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    const properties = (base._projection as { properties: JsonObject[] }).properties;
    properties[0] = { id: "title", facet: "view", path: "/props/title", label: "Заголовок UI", group: "Общее", presentation: "text" };
    properties.push({ id: "contentTitle", facet: "content", path: "/title", label: "Заголовок содержания", group: "Общее", presentation: "text" });
    const game: EditorEntityProjectionDocument = { filePath: gamePath, documentKind: "game", json: { root: { content: { entries: [{ title: "Первый этап" }] } } } };
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...docs[0], json }, game],
      facets: [{ kind: "content", filePath: gamePath, pointer: "/root/content/entries/0" }] });
    expect(projection.text.match(/^Общее:$/gmu)).toHaveLength(1);
    const header = projection.facetSourceMap.lines.find((line) => line.kind === "facet" && projection.text.split("\n")[line.line] === "Общее:")!;
    expect(header.facetKind).toBeUndefined();
    expect(projection.facetSourceMap.lines.find((line) => line.pointer === "/root/item/props/title")?.facetKind).toBe("view");
    expect(projection.facetSourceMap.lines.find((line) => line.pointer === "/root/content/entries/0/title")?.facetKind).toBe("content");
    const result = interpretReturnedIntent({ projectionYaml: projection.text,
      returnedText: projection.text.replace('Заголовок содержания: "Первый этап"', 'Заголовок содержания: "Второй этап"'),
      facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches).toEqual([{ filePath: gamePath,
      operations: [{ op: "replace", path: "/root/content/entries/0/title", value: "Второй этап" }] }]);
  });

  it("keeps actual newlines escaped in one scalar so editing it preserves the exact string and target", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    const base = (json._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    (base.props as Record<string, unknown>).title = "Первая строка\nВторая строка";
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...docs[0], json }] });
    expect(projection.text).toContain('Название: "Первая строка\\nВторая строка"');
    const returnedText = projection.text.replace('Первая строка\\nВторая строка', 'Первая строка\\nТретья строка');
    const result = interpretReturnedIntent({ projectionYaml: projection.text, returnedText,
      facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches[0].operations).toEqual([{ op: "add", path: "/root/item/props/title", value: "Первая строка\nТретья строка" }]);
  });

  it("merges descriptor identity and values, then writes an inherited nested value only to the local instance", () => {
    const docs = neutralDocs();
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs });
    expect(projection.properties.filter((property) => property.id === "title")).toHaveLength(1);
    expect(projection.properties.find((property) => property.id === "title")).toMatchObject({ label: "Название", value: "Базовый", inherited: true, writeTarget: { operation: "add", parentObjects: [] } });
    const color = projection.properties.find((property) => property.id === "color")!;
    expect(color).toMatchObject({ value: "синий", inherited: true, writeTarget: { operation: "add", parentObjects: ["/root/item/props/style"] } });
    expect(projection.text).not.toContain("_type");
    expect(projection.text).not.toContain("/root/item");
    const returnedText = projection.text.replace('Цвет: "синий"', 'Цвет: "зелёный"');
    const result = interpretReturnedIntent({ projectionYaml: projection.text, returnedText, facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches[0].operations).toEqual([
      { op: "add", path: "/root/item/props/style", value: {} },
      { op: "add", path: "/root/item/props/style/color", value: "зелёный" }
    ]);
    const after = applyJsonPatch(docs[0].json!, result.changeSet!.jsonPatches[0].operations) as JsonObject;
    expect((after.root as JsonObject).item).toMatchObject({ props: { style: { color: "зелёный" } } });
    expect((after._definitions as JsonObject)["ui.BaseBadge"]).toEqual(prototype);
  });

  it("uses prototype values in explicit prototype mode and exposes a reset target only for local overrides", () => {
    const docs = neutralDocs({ _type: "ui.ChildBadge", _label: "Первый", props: { title: "Местный" } });
    const instance = buildSemanticEntityProjection({ mode: "instance", target, documents: docs });
    expect(instance.properties.find((property) => property.id === "title")?.resetTarget).toEqual({ filePath: uiPath, pointer: "/root/item/props/title" });
    const definition = buildSemanticEntityProjection({ mode: "prototype", target: { filePath: uiPath, pointer: "/_definitions/ui.ChildBadge" }, documents: docs });
    expect(definition.properties.find((property) => property.id === "title")?.value).toBe("Базовый");
    expect(definition.properties.find((property) => property.id === "title")?.resetTarget).toBeUndefined();
    expect(definition.definitionType).toBe("ui.ChildBadge");
  });

  it("does not let a child reuse a property id to silently redirect its write target", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    const child = (json._definitions as JsonObject)["ui.ChildBadge"] as JsonObject;
    (child._projection as { properties: JsonObject[] }).properties[0] = { id: "title", facet: "view", path: "/props/style/color", label: "Подмена", presentation: "text" };
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...docs[0], json }] });
    expect(projection.properties.find((property) => property.id === "title")?.writeTarget.pointer).toBe("/root/item/props/title");
    expect(projection.diagnostics).toContain("Projection property title changes its facet or field identity in ui.ChildBadge.");
  });

  it("skips an invalid stale descriptor without losing its validated parent", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    const child = (json._definitions as JsonObject)["ui.ChildBadge"] as JsonObject;
    (child as Record<string, unknown>)._projection = { properties: [{ id: "title", facet: "view", path: "/props/title", presentation: "text", expose: null }] };
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...docs[0], json }] });
    expect(projection.properties.find((property) => property.id === "title")?.value).toBe("Базовый");
    expect(projection.diagnostics).toContain("Invalid projection descriptor in ui.ChildBadge.");
  });

  it("routes a JSON object pasted into a scalar property to the agent", () => {
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: neutralDocs() });
    const returnedText = projection.text.replace('Цвет: "синий"', 'Цвет: {"unexpected":true}');
    expect(interpretReturnedIntent({ projectionYaml: projection.text, returnedText, facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" }).path).toBe("agent");
  });

  it("never resurrects an inherited array member after a local array replacement", () => {
    const docs = neutralDocs({ _type: "ui.ChildBadge", _label: "Первый", children: [] });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs });
    expect(projection.properties.some((property) => property.id === "children")).toBe(false);
  });

  it("uses meaningful scalar fallback without dumping ids, structure, or expression bindings", () => {
    const docs: EditorEntityProjectionDocument[] = [{ filePath: uiPath, documentKind: "ui", json: { root: { item: { id: "x", _type: "ui.Unknown", _label: "Без прототипа", title: "Видимый", text: "{{game.secret}}", nested: { anything: "hidden" } } } } }];
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs });
    expect(projection.text).toContain('Название элемента: "Без прототипа"');
    expect(projection.text).toContain('Title: "Видимый"');
    expect(projection.text).not.toContain("game.secret");
    expect(projection.text).not.toContain("anything");
    expect(projection.text).not.toContain("id:");
  });

  it("renders a supported subtraction from the actual AST and routes changed rule prose to the agent", () => {
    const game: JsonObject = { _definitions: { "game.Rules": { _projection: { properties: [
      { id: "dayLimit", facet: "logic", path: "/content/data/rules/dayLimit", label: "установленной продолжительности игры", presentation: "quantity" }
    ] } } }, root: { content: { data: { metrics: [
      { metricId: "time", label: "Прошло дней" },
      { metricId: "remainingDays", computed: { expression: { "-": [{ var: "content.rules.dayLimit" }, { var: "public.metrics.time" }] } } }
    ] } } } };
    const docs = neutralDocs(); docs.push({ filePath: gamePath, documentKind: "game", json: game });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs,
      facets: [{ kind: "state", filePath: gamePath, pointer: "/root/content/data/metrics/1" }],
      fieldDictionary: [{ key: "dayLimit", label: "Поддельное имя" }] });
    expect(projection.properties.find((property) => property.id === "rule")?.value).toBeUndefined();
    const withRule = structuredClone(docs[0].json!) as JsonObject;
    const definition = ((withRule._definitions as JsonObject)["ui.BaseBadge"] as JsonObject);
    (definition._projection as { properties: JsonObject[] }).properties.push({ id: "rule", facet: "state", path: "/computed", reference: { facet: "state", path: "/computed" }, label: "Правило вычисления", presentation: "rule" });
    docs[0] = { ...docs[0], json: withRule };
    const result = buildSemanticEntityProjection({ mode: "instance", target, documents: docs,
      facets: [{ kind: "state", filePath: gamePath, pointer: "/root/content/data/metrics/1" }],
      fieldDictionary: [{ key: "dayLimit", label: "Поддельное имя" }] });
    expect(result.text).toContain("Из значения «установленной продолжительности игры» вычесть значение «Прошло дней».");
    expect(result.text).not.toContain("content.rules.dayLimit");
    const returnedText = result.text.replace("вычесть значение", "прибавить значение");
    expect(interpretReturnedIntent({ projectionYaml: result.text, returnedText, facetSourceMap: result.facetSourceMap, sourceHashes: {}, entityId: "item" }).path).toBe("agent");
  });

  it("handles Antarctica's real remainingDays subtraction without inventing a lower bound", () => {
    const file = fileURLToPath(new URL("../../../games/antarctica/authoring/game.authoring.json", import.meta.url));
    const json = JSON.parse(readFileSync(file, "utf8")) as JsonObject;
    const game: EditorEntityProjectionDocument = { filePath: "antarctica/game.authoring.json", documentKind: "game", json };
    const metrics = (((json.root as JsonObject).content as JsonObject).data as JsonObject).metrics as JsonObject[];
    const index = metrics.findIndex((metric) => metric.metricId === "remainingDays");
    expect(index).toBeGreaterThanOrEqual(0);
    const ui = neutralDocs()[0];
    const uiJson = structuredClone(ui.json!) as JsonObject;
    ((((uiJson._definitions as JsonObject)["ui.BaseBadge"] as JsonObject)._projection as { properties: JsonObject[] }).properties).push({ id: "rule", facet: "state", path: "/computed", reference: { facet: "state", path: "/computed" }, label: "Правило вычисления", presentation: "rule" });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: [{ ...ui, json: uiJson }, game], facets: [{ kind: "state", filePath: game.filePath, pointer: `/root/content/data/metrics/${index}` }] });
    expect(projection.text).toContain("Из значения «Продолжительность игры» вычесть значение «Прошло дней».");
    expect(projection.text).not.toContain("не меньше нуля");
  });

  it("does not mislabel an unqualified or foreign rule variable from a colliding metric id", () => {
    const docs = neutralDocs();
    const json = structuredClone(docs[0].json!) as JsonObject;
    const definition = (json._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    (definition._projection as { properties: JsonObject[] }).properties.push({ id: "rule", facet: "state", path: "/computed", label: "Правило", presentation: "rule" });
    docs[0] = { ...docs[0], json };
    docs.push({ filePath: gamePath, documentKind: "game", json: { root: { content: { data: { metrics: [
      { metricId: "time", label: "Прошло дней", computed: { expression: { "-": [{ var: "foreign.metrics.time" }, 1] } } }
    ] } } } } });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs,
      facets: [{ kind: "state", filePath: gamePath, pointer: "/root/content/data/metrics/0" }],
      fieldDictionary: [{ key: "time", label: "Ложная подпись" }] });
    expect(projection.text).toContain("Правило требует проверки агентом.");
    expect(projection.text).not.toContain("Прошло дней");
    expect(projection.text).not.toContain("Ложная подпись");
  });

  it("edits proven content title at its owner without changing the UI binding", () => {
    const docs = neutralDocs({ _type: "ui.ChildBadge", _label: "Первый", props: { title: "{{content.title}}" } });
    const uiJson = structuredClone(docs[0].json!) as JsonObject;
    const definition = (uiJson._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    (definition._projection as { properties: JsonObject[] }).properties.push({ id: "contentTitle", facet: "content", path: "/title", reference: { facet: "content", path: "/title" }, label: "Заголовок этапа", presentation: "text" });
    docs[0] = { ...docs[0], json: uiJson };
    docs.push({ filePath: gamePath, documentKind: "game", json: { root: { content: { entries: [{ title: "Корпорация Антарктика" }] } } } });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs,
      facets: [{ kind: "content", filePath: gamePath, pointer: "/root/content/entries/0" }] });
    const title = projection.properties.find((property) => property.id === "contentTitle")!;
    expect(title).toMatchObject({ value: "Корпорация Антарктика", scope: "shared", writeTarget: { filePath: gamePath, pointer: "/root/content/entries/0/title", operation: "replace" } });
    const returnedText = projection.text.replace('Заголовок этапа: "Корпорация Антарктика"', 'Заголовок этапа: "Новый заголовок"');
    const result = interpretReturnedIntent({ projectionYaml: projection.text, returnedText, facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    expect(result.changeSet?.jsonPatches).toEqual([{ filePath: gamePath, operations: [{ op: "replace", path: "/root/content/entries/0/title", value: "Новый заголовок" }] }]);
    expect(((docs[0].json as JsonObject).root as JsonObject).item).toMatchObject({ props: { title: "{{content.title}}" } });
  });

  it("writes an inherited content title to the proven content instance, leaving its prototype and peers intact", () => {
    const docs = neutralDocs();
    const uiJson = structuredClone(docs[0].json!) as JsonObject;
    const definition = (uiJson._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    (definition._projection as { properties: JsonObject[] }).properties.push({ id: "contentTitle", facet: "content", path: "/title", label: "Заголовок этапа", presentation: "text" });
    docs[0] = { ...docs[0], json: uiJson };
    const content = { _definitions: { "content.Window": { title: "Общий заголовок" } }, root: { content: { data: { windows: [
      { id: "first", _type: "content.Window" }, { id: "second", _type: "content.Window" }
    ] } } } };
    docs.push({ filePath: gamePath, documentKind: "game", json: content });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs,
      facets: [{ kind: "content", filePath: gamePath, pointer: "/root/content/data/windows/0" }] });
    const title = projection.properties.find((property) => property.id === "contentTitle")!;
    expect(title).toMatchObject({ value: "Общий заголовок", inherited: true,
      owner: { filePath: gamePath, pointer: "/_definitions/content.Window/title" },
      writeTarget: { filePath: gamePath, pointer: "/root/content/data/windows/0/title", operation: "add" } });
    const result = interpretReturnedIntent({ projectionYaml: projection.text,
      returnedText: projection.text.replace('Заголовок этапа: "Общий заголовок"', 'Заголовок этапа: "Частный заголовок"'),
      facetSourceMap: projection.facetSourceMap, sourceHashes: {}, entityId: "item" });
    expect(result.path).toBe("deterministic");
    const after = applyJsonPatch(content, result.changeSet!.jsonPatches[0].operations) as JsonObject;
    const data = (((after.root as JsonObject).content as JsonObject).data as JsonObject).windows as JsonObject[];
    expect(data[0].title).toBe("Частный заголовок");
    expect(data[1].title).toBeUndefined();
    expect(((after._definitions as JsonObject)["content.Window"] as JsonObject).title).toBe("Общий заголовок");
  });

  it("never exposes an unsupported expression as a claimed rule", () => {
    const docs = neutralDocs();
    const uiJson = structuredClone(docs[0].json!) as JsonObject;
    const definition = (uiJson._definitions as JsonObject)["ui.BaseBadge"] as JsonObject;
    (definition._projection as { properties: JsonObject[] }).properties.push({ id: "rule", facet: "state", path: "/computed", reference: { facet: "state", path: "/computed" }, label: "Правило вычисления", presentation: "rule" });
    docs[0] = { ...docs[0], json: uiJson };
    docs.push({ filePath: gamePath, documentKind: "game", json: { root: { metric: { computed: { expression: { customExtension: [1, 2] } } } } } });
    const projection = buildSemanticEntityProjection({ mode: "instance", target, documents: docs, facets: [{ kind: "state", filePath: gamePath, pointer: "/root/metric" }] });
    expect(projection.text).toContain("Правило требует проверки агентом.");
    expect(projection.text).not.toContain("customExtension");
    expect(projection.properties.find((property) => property.id === "rule")?.sourceValue).toEqual({ expression: { customExtension: [1, 2] } });
  });
});
