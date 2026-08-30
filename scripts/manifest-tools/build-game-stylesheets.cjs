#!/usr/bin/env node
/**
 * Builds immutable, content-addressable game-owned stylesheets (ADR-091).
 *
 * Background terms:
 * - SSOT (single source of truth): the editable CSS a game author writes. It
 *   lives in `games/<id>/assets/styles/*.css` and references images only by
 *   `asset:<id>` tokens (never baked-in paths) — see ADR-091 / validateCssSource.
 * - generated artifact (генерат): the published CSS this script writes. It is a
 *   copy of the source with every `asset:<id>` token rewritten into the
 *   content-addressable channel URL of that image, named by the SHA-256 of its
 *   own bytes. It is written ONLY by this pipeline and must never be hand-edited
 *   (ADR-063 immutability invariant).
 *
 * The pipeline mirrors `build-player-web-plugin-bundles.cjs`: it validates the
 * asset registry with JSON Schema (AJV), rewrites tokens deterministically,
 * writes content-addressed files plus a metadata index into
 * `games/<id>/published/`, and supports a `--check` mode that fails on any drift
 * (used by verify:manifest-authoring). Re-running without changes is a no-op:
 * identical inputs always produce byte-identical outputs.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const AjvLib = require("ajv");
const Ajv = AjvLib.default || AjvLib;
const addFormatsLib = require("ajv-formats");
const addFormats = addFormatsLib.default || addFormatsLib;

const repoRoot = path.resolve(__dirname, "..", "..");
const schemasRoot = path.join(repoRoot, "docs", "architecture", "schemas");
const gameAssetsSchema = readJson(path.join(schemasRoot, "game-assets.schema.json"));
const stylesheetsMetaSchema = readJson(path.join(schemasRoot, "game-stylesheets.schema.json"));
const gameAssetsSchemaId = "https://cubica.platform/schemas/game-assets.v1.json";
const stylesheetsMetaSchemaId = "https://cubica.platform/schemas/game-stylesheets.schema.json";

// Image content-types this channel serves. Kept in sync with runtime-api's
// GAME_ASSET_CONTENT_TYPES so a token can only point at a real image extension.
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "webp", "svg"]);
// An `asset:<id>` token, matching the registry id pattern and the resolver's
// ASSET_REFERENCE_PATTERN so source, publish and runtime agree on one grammar.
const ASSET_TOKEN_PATTERN = /^asset:([a-z0-9][a-z0-9-]{0,63})$/u;

function parseArgs(argv) {
  const options = { check: false, quiet: false, games: [] };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--quiet") {
      options.quiet = true;
    } else if (arg === "--game") {
      const gameId = argv[index + 1];
      if (!gameId) {
        throw new Error("--game requires a game id.");
      }
      options.games.push(gameId);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Builds an Ajv instance with both channel schemas registered (ADR-025 strict). */
function createBuildAjv() {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  ajv.addSchema(gameAssetsSchema, gameAssetsSchemaId);
  ajv.addSchema(stylesheetsMetaSchema, stylesheetsMetaSchemaId);
  return ajv;
}

async function main() {
  const options = parseArgs(process.argv);
  const ajv = createBuildAjv();

  const gameIds = options.games.length > 0 ? options.games : await discoverGamesWithStylesheets(repoRoot);
  const updated = [];
  for (const gameId of gameIds) {
    const result = await buildGameStylesheets(ajv, gameId, options);
    updated.push(...result);
  }

  if (!options.quiet) {
    console.log(updated.length > 0
      ? `build-game-stylesheets: OK (${updated.join(", ")})`
      : "build-game-stylesheets: OK (no game-owned stylesheets)");
  }
}

async function buildGameStylesheets(ajv, gameId, options) {
  assertSafeId(gameId, "game id");
  // `rootDir` is a test seam: production always uses the repository root, but a
  // focused test can point the same pipeline at a temporary fixture tree.
  const rootDir = options.rootDir ?? repoRoot;
  const gameRoot = path.join(rootDir, "games", gameId);
  const assetsRoot = path.join(gameRoot, "assets");
  const registryPath = path.join(assetsRoot, "assets.json");
  const publishedRoot = path.join(gameRoot, "published");
  const metadataPath = path.join(publishedRoot, "game-stylesheets.json");

  if (!fs.existsSync(registryPath)) {
    if (options.check && fs.existsSync(metadataPath)) {
      throw new Error(`${relative(metadataPath)} exists, but ${gameId} has no assets registry.`);
    }
    return [];
  }

  const registry = readJson(registryPath);
  validateJson(ajv, gameAssetsSchemaId, registry, registryPath);
  if (registry.gameId !== gameId) {
    throw new Error(`${relative(registryPath)} gameId must match ${gameId}.`);
  }

  const stylesheets = Array.isArray(registry.stylesheets) ? registry.stylesheets : [];
  if (stylesheets.length === 0) {
    if (options.check && fs.existsSync(metadataPath)) {
      throw new Error(`${relative(metadataPath)} exists, but ${gameId} declares no stylesheets.`);
    }
    return [];
  }

  // Map every image asset id to its content-addressable channel URL, computed
  // exactly like runtime-api so a rewritten token resolves to the same file the
  // server will serve. Rewriting here (not at request time) keeps the published
  // CSS immutable and cacheable (ADR-091 rejected runtime rewriting).
  const imageIndex = await buildImageIndex(gameId, assetsRoot, registry.assets || []);

  // Sort by id so the metadata array and stale-file cleanup are deterministic.
  const orderedStylesheets = [...stylesheets].sort((left, right) => left.id.localeCompare(right.id));
  const artifacts = [];
  for (const stylesheet of orderedStylesheets) {
    const sourcePath = resolveInside(assetsRoot, stylesheet.file, `stylesheet "${stylesheet.id}" file`);
    const sourceCss = await fsp.readFile(sourcePath, "utf8");
    const publishedCss = rewriteCssAssetTokens(sourceCss, imageIndex, relative(sourcePath));
    const bytes = Buffer.from(publishedCss, "utf8");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const integrity = `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
    const filename = `${stylesheet.id}.${contentHash}.css`;
    artifacts.push({
      stylesheetId: stylesheet.id,
      gameId,
      contentHash,
      integrity,
      filePath: `published/${filename}`,
      url: `/game-stylesheets/${gameId}/${stylesheet.id}/${contentHash}.css`,
      bytes
    });
  }

  const metadata = {
    $schema: "../../../docs/architecture/schemas/game-stylesheets.schema.json",
    schemaVersion: "1.0",
    stylesheets: artifacts.map(({ bytes: _bytes, ...entry }) => entry)
  };
  validateJson(ajv, stylesheetsMetaSchemaId, metadata, metadataPath);

  if (options.check) {
    assertGeneratedFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    for (const artifact of artifacts) {
      assertGeneratedFile(path.join(gameRoot, artifact.filePath), artifact.bytes);
    }
    return artifacts.map((artifact) => `${gameId}/${artifact.stylesheetId}`);
  }

  await fsp.mkdir(publishedRoot, { recursive: true });
  await fsp.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  const currentFilenames = new Set(artifacts.map((artifact) => path.basename(artifact.filePath)));
  for (const artifact of artifacts) {
    await fsp.writeFile(path.join(gameRoot, artifact.filePath), artifact.bytes);
    await removeStaleStylesheets(publishedRoot, artifact.stylesheetId, currentFilenames);
  }
  return artifacts.map((artifact) => `${gameId}/${artifact.stylesheetId}`);
}

/** Content-addressable URL map for image assets, matching runtime-api exactly. */
async function buildImageIndex(gameId, assetsRoot, imageAssets) {
  const index = new Map();
  for (const asset of imageAssets) {
    const extension = path.extname(asset.file).slice(1).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Image asset "${asset.id}" has unsupported extension ".${extension}".`);
    }
    const filePath = resolveInside(assetsRoot, asset.file, `image asset "${asset.id}" file`);
    const bytes = await fsp.readFile(filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    index.set(asset.id, `/game-assets/${gameId}/${asset.id}/${sha256}.${extension}`);
  }
  return index;
}

/**
 * Rewrites every `url(asset:<id>)` into the image's content-addressable URL.
 *
 * data: URIs, internal `#fragment` references and `var(--...)` custom properties
 * pass through unchanged (they are legal per ADR-091). Any other url() is a
 * baked-in path that validateCssSource already rejects at commit time; here we
 * still fail closed rather than emit an unresolved reference.
 */
function rewriteCssAssetTokens(cssText, imageIndex, fileLabel) {
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gu;
  return cssText.replace(urlPattern, (match, doubleQuoted, singleQuoted, bare) => {
    const raw = (doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
    if (raw === "") {
      return match;
    }
    const tokenMatch = ASSET_TOKEN_PATTERN.exec(raw);
    if (tokenMatch === null) {
      if (/^data:/iu.test(raw) || raw.startsWith("#") || /^var\(/iu.test(raw)) {
        return match;
      }
      throw new Error(
        `${fileLabel}: CSS url("${raw}") must be an asset:<id> token (ADR-091); baked-in paths are not published.`
      );
    }
    const assetId = tokenMatch[1];
    const url = imageIndex.get(assetId);
    if (url === undefined) {
      throw new Error(`${fileLabel}: CSS references unknown image asset id "${assetId}" (asset:${assetId}).`);
    }
    return `url("${url}")`;
  });
}

async function discoverGamesWithStylesheets(rootDir = repoRoot) {
  const gamesRoot = path.join(rootDir, "games");
  const entries = await fsp.readdir(gamesRoot, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });
  const gameIds = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const registryPath = path.join(gamesRoot, entry.name, "assets", "assets.json");
    if (!fs.existsSync(registryPath)) {
      continue;
    }
    let registry;
    try {
      registry = readJson(registryPath);
    } catch {
      // Malformed registries are reported by the dedicated validator; skip here.
      continue;
    }
    if (Array.isArray(registry.stylesheets) && registry.stylesheets.length > 0) {
      gameIds.push(entry.name);
    }
  }
  return gameIds.sort();
}

async function removeStaleStylesheets(publishedRoot, stylesheetId, currentFilenames) {
  const entries = await fsp.readdir(publishedRoot, { withFileTypes: true }).catch((error) => {
    if (isMissingFileError(error)) {
      return [];
    }
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (
      entry.name.startsWith(`${stylesheetId}.`) &&
      entry.name.endsWith(".css") &&
      !currentFilenames.has(entry.name)
    ) {
      await fsp.unlink(path.join(publishedRoot, entry.name));
    }
  }
}

function validateJson(ajv, schemaId, value, filePath) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    throw new Error(`Schema is not registered: ${schemaId}`);
  }
  if (!validate(value)) {
    const details = (validate.errors || [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`${relative(filePath)} failed schema validation: ${details}`);
  }
}

function assertGeneratedFile(filePath, expected) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${relative(filePath)} is missing. Run node scripts/manifest-tools/build-game-stylesheets.cjs.`);
  }
  const actual = fs.readFileSync(filePath);
  const expectedBuffer = Buffer.isBuffer(expected) ? expected : Buffer.from(expected, "utf8");
  if (!actual.equals(expectedBuffer)) {
    throw new Error(`${relative(filePath)} is stale. Run node scripts/manifest-tools/build-game-stylesheets.cjs.`);
  }
}

/** Resolves a registry-relative path and proves it stays inside assetsRoot. */
function resolveInside(assetsRoot, relativeFilePath, label) {
  if (
    path.isAbsolute(relativeFilePath) ||
    relativeFilePath.includes("\0") ||
    relativeFilePath.includes("..")
  ) {
    throw new Error(`${label} must be a safe relative path.`);
  }
  const resolved = path.resolve(assetsRoot, relativeFilePath);
  if (resolved === assetsRoot || !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the game's assets directory.`);
  }
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertSafeId(value, label) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
}

function relative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

module.exports = {
  buildGameStylesheets,
  buildImageIndex,
  createBuildAjv,
  rewriteCssAssetTokens,
  discoverGamesWithStylesheets,
  parseArgs
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`build-game-stylesheets: ${error.message}`);
    process.exit(1);
  });
}
