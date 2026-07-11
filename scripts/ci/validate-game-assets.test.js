/** Unit tests for repository asset invariants and SVG sanitization. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  MAX_FILE_BYTES,
  buildValidator,
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

test("enforces the per-file byte limit", () => {
  const created = fixture({ file: "large.png", content: Buffer.alloc(MAX_FILE_BYTES + 1) });
  const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
  assert.match(issues, /file size/u);
});

test("enforces the distinct total game byte limit", () => {
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
  const issues = validateGameAssetDirectory(created.gameDir, buildValidator()).issues.join("\n");
  assert.match(issues, /total registered size/u);
});

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
