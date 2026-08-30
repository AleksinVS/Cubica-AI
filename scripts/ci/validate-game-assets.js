#!/usr/bin/env node
/**
 * Validates game-owned asset registries for ADR-063 (images) and ADR-091 (CSS).
 *
 * JSON Schema owns registry shape. This validator adds repository invariants
 * that JSON Schema cannot express: directory ownership, duplicate ids across
 * images and stylesheets, file existence, orphan detection, path containment,
 * SVG sanitization and the ADR-091 rule that game CSS references images only by
 * `asset:<id>` tokens (never by baked-in paths).
 *
 * Size and count budgets are advisory only (ADR-063 amendment 2026-07-19): PM
 * decided the previous hard limits (512 KB/file, 4 MB/game, 64 assets) are not
 * an objective boundary, so they were downgraded to non-gating warnings. The
 * normative recommendation ("prepare assets economically") lives in ADR-063 and
 * cannot be checked numerically; the constants below are a tunable CI heuristic,
 * not a contract limit, and never fail the build.
 */

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "game-assets.schema.json");

// Advisory (non-gating) heuristics. They only produce warnings; they are NOT a
// normative contract limit (ADR-063 amendment 2026-07-19). Adjust or remove
// freely — the build never fails because of them.
const ADVISORY_FILE_BYTES = 512 * 1024;
const ADVISORY_GAME_BYTES = 4 * 1024 * 1024;

function buildValidator(schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"))) {
  const ajv = new Ajv({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function relative(filePath, base = repoRoot) {
  return path.relative(base, filePath).replace(/\\/g, "/");
}

function collectAssetFiles(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name !== "assets.json" && entry.name !== ".desc.json") {
        result.push(fullPath);
      }
    }
  }
  return result.sort();
}

function validateSvg(svgText, fileLabel) {
  const issues = [];
  const lower = svgText.toLowerCase();
  if (!/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->)*<svg\b/iu.test(svgText)) {
    issues.push(`${fileLabel}: SVG must begin with <svg after declarations/comments`);
  }
  if (!/\sviewbox\s*=/iu.test(svgText)) {
    issues.push(`${fileLabel}: SVG must declare viewBox`);
  }
  for (const forbidden of ["<script", "javascript:", "<foreignobject", "<image", "<iframe", "<embed", "<object"]) {
    if (lower.includes(forbidden)) {
      issues.push(`${fileLabel}: SVG contains forbidden substring ${forbidden}`);
    }
  }
  if (/\son[a-z]+\s*=/iu.test(svgText)) {
    issues.push(`${fileLabel}: SVG contains an event-handler attribute`);
  }

  const hrefPattern = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu;
  for (const match of svgText.matchAll(hrefPattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (!value.startsWith("#")) {
      issues.push(`${fileLabel}: SVG href values must use internal # references`);
    }
  }
  return issues;
}

/**
 * ADR-091: a game CSS source is the single source of truth and must reference
 * images only by `asset:<id>` tokens. The publish/compile step rewrites those
 * tokens into content-addressable channel URLs, so any `url(...)` that already
 * carries a baked-in path (absolute, relative or remote) would bypass the
 * channel and re-introduce the platform leak this ADR removes.
 *
 * Allowed inside url(): `asset:<id>` tokens, inline `data:` URIs, internal
 * `#fragment` references and CSS `var(--...)` custom properties. Everything else
 * is rejected.
 */
function validateCssSource(cssText, fileLabel) {
  const issues = [];
  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/giu;
  for (const match of cssText.matchAll(urlPattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw === "") continue;
    const isAssetToken = /^asset:[a-z0-9][a-z0-9-]{0,63}$/u.test(raw);
    const isDataUri = /^data:/iu.test(raw);
    const isFragment = raw.startsWith("#");
    const isCssVar = /^var\(/iu.test(raw);
    if (!isAssetToken && !isDataUri && !isFragment && !isCssVar) {
      issues.push(
        `${fileLabel}: CSS url("${raw}") must reference a game asset by token (asset:<id>), not a baked-in path (ADR-091)`
      );
    }
  }
  return issues;
}

function validateGameAssetDirectory(gameDir, validateSchema = buildValidator()) {
  const gameId = path.basename(gameDir);
  const assetsRoot = path.join(gameDir, "assets");
  const registryPath = path.join(assetsRoot, "assets.json");
  const issues = [];
  const warnings = [];

  if (!fs.existsSync(registryPath)) {
    return { enrolled: false, gameId, issues, warnings };
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return {
      enrolled: true,
      gameId,
      issues: [`${relative(registryPath)}: invalid JSON: ${error.message}`],
      warnings
    };
  }

  if (!validateSchema(registry)) {
    issues.push(
      `${relative(registryPath)}: schema validation failed: ${(validateSchema.errors || [])
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ")}`
    );
    return { enrolled: true, gameId, issues, warnings };
  }

  if (registry.gameId !== gameId) {
    issues.push(`${relative(registryPath)}: gameId must equal directory name "${gameId}"`);
  }

  const seenIds = new Set();
  const registeredFiles = new Set();
  let totalBytes = 0;

  // Both sections share one asset-id namespace and one file tree, so they are
  // validated with the same containment/existence/duplicate rules; only the
  // per-kind content check differs (SVG sanitization vs CSS asset tokens).
  const imageEntries = registry.assets.map((asset) => ({ asset, kind: "image" }));
  const cssEntries = (registry.stylesheets || []).map((asset) => ({ asset, kind: "css" }));

  for (const { asset, kind } of [...imageEntries, ...cssEntries]) {
    if (seenIds.has(asset.id)) {
      issues.push(`${relative(registryPath)}: duplicate asset id "${asset.id}"`);
    }
    seenIds.add(asset.id);

    if (asset.file.includes("..") || asset.file.startsWith("/")) {
      issues.push(`${relative(registryPath)}: asset file "${asset.file}" must stay relative without ..`);
      continue;
    }

    const resolved = path.resolve(assetsRoot, asset.file);
    if (resolved === assetsRoot || !resolved.startsWith(`${assetsRoot}${path.sep}`)) {
      issues.push(`${relative(registryPath)}: asset file "${asset.file}" escapes the assets directory`);
      continue;
    }
    registeredFiles.add(relative(resolved, assetsRoot));

    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      issues.push(`${relative(registryPath)}: asset file "${asset.file}" does not exist`);
      continue;
    }

    const size = fs.statSync(resolved).size;
    totalBytes += size;
    if (size > ADVISORY_FILE_BYTES) {
      warnings.push(
        `${relative(resolved)}: file size ${size} bytes is large; consider compression/webp (advisory, ADR-063)`
      );
    }

    if (kind === "image" && path.extname(resolved).toLowerCase() === ".svg") {
      issues.push(...validateSvg(fs.readFileSync(resolved, "utf8"), relative(resolved)));
    }
    if (kind === "css") {
      issues.push(...validateCssSource(fs.readFileSync(resolved, "utf8"), relative(resolved)));
    }
  }

  if (totalBytes > ADVISORY_GAME_BYTES) {
    warnings.push(
      `${relative(assetsRoot)}: total registered size ${totalBytes} bytes is large; prune duplicates/unused files (advisory, ADR-063)`
    );
  }

  for (const filePath of collectAssetFiles(assetsRoot)) {
    const assetRelativePath = relative(filePath, assetsRoot);
    if (!registeredFiles.has(assetRelativePath)) {
      issues.push(`${relative(filePath)}: orphan file is not listed in assets.json`);
    }
  }

  return { enrolled: true, gameId, issues, warnings };
}

function validateGamesRoot(gamesRoot = path.join(repoRoot, "games")) {
  const validateSchema = buildValidator();
  const results = [];
  if (!fs.existsSync(gamesRoot)) return results;
  for (const entry of fs.readdirSync(gamesRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(gamesRoot, entry.name, "assets"))) {
      results.push(validateGameAssetDirectory(path.join(gamesRoot, entry.name), validateSchema));
    }
  }
  return results.sort((left, right) => left.gameId.localeCompare(right.gameId));
}

function main() {
  const results = validateGamesRoot();
  const warnings = results.flatMap((result) => result.warnings || []);
  if (warnings.length > 0) {
    console.warn(`validate-game-assets: ${warnings.length} advisory warning(s)\n- ${warnings.join("\n- ")}`);
  }
  const issues = results.flatMap((result) => result.issues);
  if (issues.length > 0) {
    console.error(`validate-game-assets: FAILED\n- ${issues.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  const enrolled = results.filter((result) => result.enrolled).length;
  const skippedLegacy = results.length - enrolled;
  console.log(`validate-game-assets: OK (${enrolled} registries, ${skippedLegacy} unregistered legacy directories skipped)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  ADVISORY_FILE_BYTES,
  ADVISORY_GAME_BYTES,
  buildValidator,
  collectAssetFiles,
  validateCssSource,
  validateGameAssetDirectory,
  validateGamesRoot,
  validateSvg
};
