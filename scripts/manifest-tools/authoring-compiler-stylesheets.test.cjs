/**
 * Compiler passthrough test for the ADR-091 game-owned stylesheets block.
 *
 * The authoring compiler must carry a UI manifest's top-level `stylesheets`
 * array (asset:<id> references) verbatim into the generated runtime manifest,
 * and `--check` must detect drift if the generated file falls out of sync. This
 * proves both without depending on a specific game fixture.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  buildAjv,
  compileAuthoringText,
  compareGenerated
} = require("./authoring-compiler.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const ajv = buildAjv();
const job = {
  kind: "ui",
  gameId: "styled-fixture",
  channel: "web",
  sourceFile: path.join(repoRoot, ".tmp", "styled-fixture.authoring.json"),
  outputFile: path.join(repoRoot, ".tmp", "styled-fixture.ui.manifest.json"),
  sourceMapFile: path.join(repoRoot, ".tmp", "styled-fixture.ui.manifest.source-map.json")
};

function styledAuthoring() {
  return {
    _schemaVersion: "2.0",
    _manifestType: "ui",
    _channel: "web",
    _definitions: {},
    root: {
      _type: "ui.Manifest",
      _label: "Styled fixture manifest",
      meta: {
        id: "styled.fixture.web",
        version: "1.0.0",
        game_id: "styled-fixture"
      },
      entry_point: "intro",
      stylesheets: ["asset:theme", "asset:extra"],
      screens: [
        {
          id: "intro",
          _type: "ui.Screen",
          _label: "Intro screen",
          title: "Intro",
          layout_mode: "topbar",
          root: {
            _type: "ui.Component",
            _label: "Intro root",
            type: "screenComponent",
            children: [
              {
                _type: "ui.Component",
                _label: "Body",
                id: "body",
                type: "richTextComponent",
                props: { html: "<h1>Intro</h1>" }
              }
            ]
          }
        }
      ]
    }
  };
}

test("carries the top-level stylesheets block into the runtime manifest", () => {
  const output = compileAuthoringText(job, JSON.stringify(styledAuthoring()), ajv);
  assert.deepEqual(output.manifest.stylesheets, ["asset:theme", "asset:extra"]);
});

test("--check style comparison detects stylesheet drift", () => {
  const output = compileAuthoringText(job, JSON.stringify(styledAuthoring()), ajv);
  const tempFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "stylesheet-compile-")),
    "ui.manifest.json"
  );
  try {
    fs.writeFileSync(tempFile, `${JSON.stringify(output.manifest, null, 2)}\n`, "utf8");
    // In sync: no drift.
    assert.equal(compareGenerated(tempFile, output.manifest), null);

    // Drop the stylesheets block on disk to simulate a stale generated file.
    const drifted = { ...output.manifest };
    delete drifted.stylesheets;
    fs.writeFileSync(tempFile, `${JSON.stringify(drifted, null, 2)}\n`, "utf8");
    assert.match(compareGenerated(tempFile, output.manifest), /stale/u);
  } finally {
    fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });
  }
});
