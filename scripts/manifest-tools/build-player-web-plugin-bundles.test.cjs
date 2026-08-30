/** Integrity regression coverage for generated published plugin bundles. */
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const AjvLib = require("ajv");

const Ajv = AjvLib.default || AjvLib;

const repoRoot = path.resolve(__dirname, "..", "..");

test("every published player-web plugin reference authenticates its artifact bytes", () => {
  const metadataPaths = findMetadataFiles(path.join(repoRoot, "games"));
  assert.ok(metadataPaths.length > 0, "expected at least one published plugin metadata fixture");

  for (const metadataPath of metadataPaths) {
    const gameRoot = path.dirname(path.dirname(metadataPath));
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    for (const bundle of metadata.bundles) {
      assert.match(bundle.integrity, /^sha256-[A-Za-z0-9+/]{43}=$/u);
      const bytes = fs.readFileSync(path.join(gameRoot, bundle.filePath));
      assert.equal(
        bundle.contentHash,
        createHash("sha256").update(bytes).digest("hex"),
        `${bundle.gameId}/${bundle.pluginId} contentHash`
      );
      assert.equal(
        bundle.integrity,
        `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
        `${bundle.gameId}/${bundle.pluginId} integrity`
      );
    }
  }
});

test("the published bundle schema rejects a non-SHA-256-length integrity value", () => {
  const metadataPaths = findMetadataFiles(path.join(repoRoot, "games"));
  assert.ok(metadataPaths.length > 0, "expected at least one published plugin metadata fixture");
  const metadata = JSON.parse(fs.readFileSync(metadataPaths[0], "utf8"));
  const schema = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "docs", "architecture", "schemas", "player-web-plugin-bundles.schema.json"),
    "utf8"
  ));
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);

  assert.equal(validate(metadata), true, JSON.stringify(validate.errors));
  const malformed = structuredClone(metadata);
  malformed.bundles[0].integrity = "sha256-YQ==";
  assert.equal(validate(malformed), false, "schema must reject base64 that is not one complete SHA-256 digest");
});

function findMetadataFiles(gamesRoot) {
  return fs.readdirSync(gamesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(gamesRoot, entry.name, "published", "player-web-plugin-bundles.json"))
    .filter((filePath) => fs.existsSync(filePath));
}
