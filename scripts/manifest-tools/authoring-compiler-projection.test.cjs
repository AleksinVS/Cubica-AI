const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const Ajv = require("ajv");
const { buildAjv, compileAuthoringText } = require("./authoring-compiler.cjs");

const root = path.resolve(__dirname, "..", "..");
const sourceFile = path.join(root, "docs/architecture/schemas/examples/authoring-v2/minimal-ui.authoring.json");
const job = {
  kind: "ui", gameId: "authoring-v2-fixture", channel: "web", sourceFile,
  outputFile: path.join(root, ".tmp", "projection-test.ui.manifest.json"),
  sourceMapFile: path.join(root, ".tmp", "projection-test.ui.manifest.source-map.json")
};

test("projection descriptor is schema-checked and absent from compiled runtime", () => {
  const document = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
  document._definitions["ui.PromptedButtonPrototype"]._projection = { properties: [
    { id: "caption", facet: "view", path: "/props/caption", label: "Подпись", presentation: "text", expose: ["instance", "prototype"] }
  ] };
  document.root.screens[0].root.children[1]._type = "ui.PromptedButtonPrototype";
  const output = compileAuthoringText(job, JSON.stringify(document), buildAjv());
  assert.equal(output.manifest.screens.intro.root.children[1].props.caption, "Принять решение");
  assert.doesNotMatch(JSON.stringify(output.manifest), /_projection|"caption","facet"/);

  const schema = JSON.parse(fs.readFileSync(path.join(root, "docs/architecture/schemas/manifest-authoring-common.schema.json"), "utf8"));
  const ajv = new Ajv({ strict: true, strictRequired: false });
  ajv.addSchema(schema);
  const validate = ajv.getSchema(`${schema.$id}#/definitions/projectionDescriptor`);
  assert.equal(validate(document._definitions["ui.PromptedButtonPrototype"]._projection), true);
  assert.equal(validate({ properties: [{ id: "x", facet: "view", path: "/props/title", presentation: "text", arbitraryCode: "run()" }] }), false);
});
