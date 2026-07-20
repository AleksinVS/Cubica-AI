/** Unit tests for repository asset invariants and SVG sanitization. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  ADVISORY_FILE_BYTES,
  buildValidator,
  validateCssSource,
  validateGameAssetDirectory,
  validateSvg
} = require("./validate-game-assets.js");

const repoRoot = path.resolve(__dirname, "..", "..");
const tempRoot = path.join(repoRoot, ".tmp", "game-assets-validator-tests");
let fixtureCounter = 0;

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function fixture(options = {}) {
  const gameId = `test-game-${fixtureCounter++}`;
  const gameDir = path.join(tempRoot, gameId);
  const assetsDir = path.join(gameDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const file = options.file ?? "board.svg";
  const content = options.content ?? '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';
  fs.mkdirSync(path.dirname(path.join(assetsDir, file)), { recursive: true });
  fs.writeFileSync(path.join(assetsDir, file), content);
  const registry = options.registry ?? {
    gameId,
    assets: [{ id: "board", file, kind: "image", origin: { type: "authored-in-repo" } }]
  };
  fs.writeFileSync(path.join(assetsDir, "assets.json"), JSON.stringify(registry));
  return { gameDir, assetsDir, registry };
}

test("accepts a valid registered SVG catalog", () => {
  const { gameDir } = fixture();
  assert.deepEqual(validateGameAssetDirectory(gameDir, buildValidator()).issues, []);
});

test("reports duplicate ids, game id mismatch, missing files and orphans", () => {
  const created = fixture();
  const registry = {
    gameId: "wrong-game",
    assets: [
      ...created.registry.assets,
      { id: "board", file: "missing.png", kind: "image", origin: { type: "authored-in-repo" } }
    ]
  };
  fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify(registry));
  fs.writeFileSync(path.join(created.assetsDir, "orphan.png"), "orphan");
  const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
  assert.match(issues, /gameId must equal directory name/u);
  assert.match(issues, /duplicate asset id/u);
  assert.match(issues, /does not exist/u);
  assert.match(issues, /orphan file/u);
});

test("reports the per-file size as a non-gating advisory warning", () => {
  const created = fixture({ file: "large.png", content: Buffer.alloc(ADVISORY_FILE_BYTES + 1) });
  const result = validateGameAssetDirectory(created.gameDir, buildValidator());
  // Size is advisory (ADR-063 amendment): it warns but never fails the build.
  assert.deepEqual(result.issues, []);
  assert.match(result.warnings.join("\n"), /file size/u);
});

test("reports the distinct total game size as a non-gating advisory warning", () => {
  const created = fixture({ file: "asset-0.png", content: Buffer.alloc(500 * 1024) });
  const assets = [];
  for (let index = 0; index < 9; index += 1) {
    const file = `asset-${index}.png`;
    fs.writeFileSync(path.join(created.assetsDir, file), Buffer.alloc(500 * 1024));
    assets.push({ id: `asset-${index}`, file, kind: "image", origin: { type: "authored-in-repo" } });
  }
  fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify({
    gameId: path.basename(created.gameDir),
    assets
  }));
  const result = validateGameAssetDirectory(created.gameDir, buildValidator());
  assert.deepEqual(result.issues, []);
  assert.match(result.warnings.join("\n"), /total registered size/u);
});

test("accepts a game CSS stylesheet asset that references images by token", () => {
  const created = fixture();
  const cssBody = ".board { background-image: url(asset:board-guinea); color: #fff; }";
  fs.mkdirSync(path.join(created.assetsDir, "styles"), { recursive: true });
  fs.writeFileSync(path.join(created.assetsDir, "styles", "game.css"), cssBody);
  fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify({
    gameId: path.basename(created.gameDir),
    assets: created.registry.assets,
    stylesheets: [
      { id: "game-styles", file: "styles/game.css", kind: "css", origin: { type: "authored-in-repo" } }
    ]
  }));
  assert.deepEqual(validateGameAssetDirectory(created.gameDir, buildValidator()).issues, []);
});

test("rejects a game CSS stylesheet that bakes in an image path instead of a token", () => {
  const created = fixture();
  const cssBody = '.board { background-image: url("/images/arctic-background.png"); }';
  fs.mkdirSync(path.join(created.assetsDir, "styles"), { recursive: true });
  fs.writeFileSync(path.join(created.assetsDir, "styles", "game.css"), cssBody);
  fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify({
    gameId: path.basename(created.gameDir),
    assets: created.registry.assets,
    stylesheets: [
      { id: "game-styles", file: "styles/game.css", kind: "css", origin: { type: "authored-in-repo" } }
    ]
  }));
  const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
  assert.match(issues, /must reference a game asset by token/u);
});

test("rejects a stylesheet id that collides with an image id", () => {
  const created = fixture();
  fs.mkdirSync(path.join(created.assetsDir, "styles"), { recursive: true });
  fs.writeFileSync(path.join(created.assetsDir, "styles", "game.css"), ".board { color: #fff; }");
  fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify({
    gameId: path.basename(created.gameDir),
    assets: created.registry.assets,
    stylesheets: [
      { id: "board", file: "styles/game.css", kind: "css", origin: { type: "authored-in-repo" } }
    ]
  }));
  const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
  assert.match(issues, /duplicate asset id/u);
});

for (const [name, css, expected] of [
  ["asset token", ".a{background:url(asset:board-guinea)}", null],
  ["data uri", ".a{background:url(data:image/png;base64,AAAA)}", null],
  ["internal fragment", ".a{clip-path:url(#clip)}", null],
  ["css var", ".a{background:url(var(--bg))}", null],
  ["absolute path", '.a{background:url("/images/x.png")}', /by token/u],
  ["relative path", ".a{background:url(./x.png)}", /by token/u],
  ["remote url", ".a{background:url(https://example.com/x.png)}", /by token/u]
]) {
  test(`CSS url() rule: ${name}`, () => {
    const issues = validateCssSource(css, "fixture.css");
    if (expected === null) {
      assert.deepEqual(issues, []);
    } else {
      assert.match(issues.join("\n"), expected);
    }
  });
}

for (const unsafeFile of ["../secret.svg", "/absolute.svg"]) {
  test(`rejects unsafe registry traversal path: ${unsafeFile}`, () => {
    const created = fixture();
    fs.writeFileSync(path.join(created.assetsDir, "assets.json"), JSON.stringify({
      gameId: path.basename(created.gameDir),
      assets: [{ id: "escape", file: unsafeFile, kind: "image", origin: { type: "authored-in-repo" } }]
    }));
    const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
    assert.match(issues, /schema validation failed/u);
  });
}

for (const [name, svg, expected] of [
  ["root", "<g></g>", /begin with <svg/u],
  ["viewBox", "<svg></svg>", /viewBox/u],
  ["script", '<svg viewBox="0 0 1 1"><script/></svg>', /<script/u],
  ["javascript", '<svg viewBox="0 0 1 1"><a href="javascript:x"/></svg>', /javascript:/u],
  ["foreignObject", '<svg viewBox="0 0 1 1"><foreignObject/></svg>', /foreignobject/u],
  ["image", '<svg viewBox="0 0 1 1"><image/></svg>', /<image/u],
  ["iframe", '<svg viewBox="0 0 1 1"><iframe/></svg>', /<iframe/u],
  ["embed", '<svg viewBox="0 0 1 1"><embed/></svg>', /<embed/u],
  ["object", '<svg viewBox="0 0 1 1"><object/></svg>', /<object/u],
  ["event", '<svg viewBox="0 0 1 1" onclick="x"></svg>', /event-handler/u],
  ["href", '<svg viewBox="0 0 1 1"><use href="https://example.com/a"/></svg>', /internal #/u]
]) {
  test(`rejects unsafe SVG rule: ${name}`, () => {
    assert.match(validateSvg(svg, "fixture.svg").join("\n"), expected);
  });
}

test("allows XML declarations, comments and internal fragment hrefs", () => {
  const svg = '<?xml version="1.0"?><!-- safe --><svg viewBox="0 0 1 1"><use href="#shape"/></svg>';
  assert.deepEqual(validateSvg(svg, "fixture.svg"), []);
});
