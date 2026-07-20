/**
 * Focused tests for the ADR-091 stylesheet publish pipeline.
 *
 * They cover the two properties the pipeline must guarantee: deterministic,
 * content-addressable publication (re-running never changes bytes) and
 * fail-closed token rewriting (unknown ids and baked-in paths are rejected,
 * legal non-token url() forms pass through).
 */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  buildGameStylesheets,
  buildImageIndex,
  createBuildAjv,
  rewriteCssAssetTokens
} = require("./build-game-stylesheets.cjs");

const gameStylesheetsSchemaId = "https://cubica.platform/schemas/game-stylesheets.schema.json";

async function makeFixture() {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "game-stylesheets-test-"));
  const assetsRoot = path.join(rootDir, "games", "fixture-game", "assets");
  await fsp.mkdir(path.join(assetsRoot, "images"), { recursive: true });
  await fsp.mkdir(path.join(assetsRoot, "styles"), { recursive: true });
  await fsp.writeFile(
    path.join(assetsRoot, "images", "mark.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>\n'
  );
  await fsp.writeFile(
    path.join(assetsRoot, "styles", "theme.css"),
    "h1{color:#0b7285}\n.m::before{background-image:url(asset:mark)}\n"
  );
  await fsp.writeFile(path.join(assetsRoot, "assets.json"), JSON.stringify({
    gameId: "fixture-game",
    assets: [
      { id: "mark", file: "images/mark.svg", kind: "image", origin: { type: "authored-in-repo" } }
    ],
    stylesheets: [
      { id: "theme", file: "styles/theme.css", kind: "css", origin: { type: "authored-in-repo" } }
    ]
  }));
  return rootDir;
}

test("publishes deterministic, content-addressable stylesheet artifacts", async () => {
  const rootDir = await makeFixture();
  try {
    const ajv = createBuildAjv();
    await buildGameStylesheets(ajv, "fixture-game", { rootDir });

    const publishedRoot = path.join(rootDir, "games", "fixture-game", "published");
    const metadata = JSON.parse(fs.readFileSync(path.join(publishedRoot, "game-stylesheets.json"), "utf8"));
    assert.equal(metadata.schemaVersion, "1.0");
    assert.equal(metadata.stylesheets.length, 1);
    const entry = metadata.stylesheets[0];
    assert.equal(entry.stylesheetId, "theme");
    assert.equal(entry.gameId, "fixture-game");
    assert.match(entry.filePath, /^published\/theme\.[a-f0-9]{64}\.css$/u);
    assert.match(entry.url, /^\/game-stylesheets\/fixture-game\/theme\/[a-f0-9]{64}\.css$/u);

    const cssPath = path.join(rootDir, "games", "fixture-game", entry.filePath);
    const publishedCss = fs.readFileSync(cssPath);
    // Content addressing: the filename hash equals the CSS bytes' SHA-256.
    assert.equal(entry.contentHash, crypto.createHash("sha256").update(publishedCss).digest("hex"));
    // The asset token was rewritten into a content-addressable image URL.
    assert.match(publishedCss.toString("utf8"), /url\("\/game-assets\/fixture-game\/mark\/[a-f0-9]{64}\.svg"\)/u);

    // Re-running is a no-op: metadata and CSS bytes are byte-identical.
    const metadataBefore = fs.readFileSync(path.join(publishedRoot, "game-stylesheets.json"));
    const cssBefore = fs.readFileSync(cssPath);
    await buildGameStylesheets(ajv, "fixture-game", { rootDir });
    assert.deepEqual(fs.readFileSync(path.join(publishedRoot, "game-stylesheets.json")), metadataBefore);
    assert.deepEqual(fs.readFileSync(cssPath), cssBefore);

    // --check passes on a clean tree and fails once the generat drifts.
    await buildGameStylesheets(ajv, "fixture-game", { rootDir, check: true });
    fs.appendFileSync(cssPath, "/* drift */");
    await assert.rejects(
      () => buildGameStylesheets(ajv, "fixture-game", { rootDir, check: true }),
      /stale/u
    );
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

test("rewriteCssAssetTokens is fail-closed and preserves legal non-token urls", () => {
  const imageIndex = new Map([["mark", "/game-assets/g/mark/abc.svg"]]);

  // All quote styles resolve to the same content-addressable URL.
  for (const source of ["url(asset:mark)", "url('asset:mark')", 'url("asset:mark")']) {
    assert.equal(
      rewriteCssAssetTokens(source, imageIndex, "theme.css"),
      'url("/game-assets/g/mark/abc.svg")'
    );
  }

  // Deterministic: same input, same output.
  const twice = "url(asset:mark) url(asset:mark)";
  assert.equal(
    rewriteCssAssetTokens(twice, imageIndex, "theme.css"),
    rewriteCssAssetTokens(twice, imageIndex, "theme.css")
  );

  // data:, #fragment and var(--...) pass through unchanged.
  const passthrough = "url(data:image/png;base64,AAAA) url(#clip) url(var(--bg))";
  assert.equal(rewriteCssAssetTokens(passthrough, imageIndex, "theme.css"), passthrough);

  // Unknown id and baked-in path both fail closed.
  assert.throws(() => rewriteCssAssetTokens("url(asset:missing)", imageIndex, "theme.css"), /unknown image asset id/u);
  assert.throws(() => rewriteCssAssetTokens('url("/images/x.png")', imageIndex, "theme.css"), /asset:<id> token/u);
});

test("buildImageIndex maps ids to content-addressable urls (matches runtime-api form)", async () => {
  const rootDir = await makeFixture();
  try {
    const assetsRoot = path.join(rootDir, "games", "fixture-game", "assets");
    const index = await buildImageIndex("fixture-game", assetsRoot, [
      { id: "mark", file: "images/mark.svg", kind: "image", origin: { type: "authored-in-repo" } }
    ]);
    const bytes = fs.readFileSync(path.join(assetsRoot, "images", "mark.svg"));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(index.get("mark"), `/game-assets/fixture-game/mark/${sha256}.svg`);
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});

// Guard: the metadata schema is registered under the expected id so runtime-api
// and the publish pipeline validate against the same contract.
test("metadata schema is registered", () => {
  const ajv = createBuildAjv();
  assert.ok(ajv.getSchema(gameStylesheetsSchemaId));
});
