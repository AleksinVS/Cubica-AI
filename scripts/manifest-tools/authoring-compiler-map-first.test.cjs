/**
 * Focused semantic compiler tests for the declarative map-first workspace.
 *
 * JSON Schema validates local field shapes. This suite proves the one
 * relationship draft-07 cannot express: a map-first screen has exactly one
 * direct `board` zone even when every individual zone is otherwise valid.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  CompileError,
  buildAjv,
  compileAuthoringText
} = require("./authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const ajv = buildAjv();
const job = {
  kind: "ui",
  gameId: "neutral-workspace",
  channel: "web",
  sourceFile: path.join(repoRoot, ".tmp", "neutral-workspace.authoring.json"),
  outputFile: path.join(repoRoot, ".tmp", "neutral-workspace.ui.manifest.json"),
  sourceMapFile: path.join(repoRoot, ".tmp", "neutral-workspace.ui.manifest.source-map.json")
};

function semanticEntity(id, label, value) {
  return {
    id,
    _type: "ui.Component",
    _label: label,
    ...value
  };
}

function mapFirstAuthoring() {
  return {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    _definitions: {},
    root: {
      _type: "ui.Manifest",
      _label: "Neutral workspace manifest",
      meta: {
        id: "neutral.workspace.web",
        version: "1.0.0",
        game_id: "neutral-workspace"
      },
      entry_point: "workspace",
      screens: [
        {
          id: "workspace",
          _type: "ui.Screen",
          _label: "Spatial workspace",
          title: "Neutral workspace",
          layout_mode: "map-first",
          root: semanticEntity("workspace.root", "Workspace root", {
            type: "screenComponent",
            children: [
              semanticEntity("workspace.board", "Spatial board", {
                type: "areaComponent",
                props: { workspaceSlot: "board" }
              }),
              semanticEntity("workspace.status", "Workspace status", {
                type: "areaComponent",
                props: { workspaceSlot: "status" }
              })
            ]
          })
        }
      ]
    }
  };
}

test("compiles a neutral map-first screen with exactly one direct board zone", () => {
  const output = compileAuthoringText(job, JSON.stringify(mapFirstAuthoring()), ajv);
  assert.equal(output.manifest.screens.workspace.layout_mode, "map-first");
  assert.equal(
    output.manifest.screens.workspace.root.children[0].props.workspaceSlot,
    "board"
  );
});

test("rejects two otherwise valid direct board zones", () => {
  const authoring = mapFirstAuthoring();
  authoring.root.screens[0].root.children[1].props.workspaceSlot = "board";

  assert.throws(
    () => compileAuthoringText(job, JSON.stringify(authoring), ajv),
    (error) => {
      assert.ok(error instanceof CompileError);
      assert.match(error.rawMessage, /exactly one direct board zone; found 2/);
      assert.equal(error.pointer, "/root/screens/0/root/children");
      return true;
    }
  );
});

test("rejects a workspace slot nested below a direct authoring zone", () => {
  const authoring = mapFirstAuthoring();
  authoring.root.screens[0].root.children[1].children = [
    semanticEntity("workspace.status.nested", "Nested area", {
      type: "areaComponent",
      props: { workspaceSlot: "overlay" }
    })
  ];

  assert.throws(
    () => compileAuthoringText(job, JSON.stringify(authoring), ajv),
    (error) => {
      assert.ok(error instanceof CompileError);
      assert.match(error.rawMessage, /Authoring schema validation failed/);
      return true;
    }
  );
});
