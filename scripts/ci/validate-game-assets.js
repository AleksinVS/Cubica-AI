#!/usr/bin/env node
/**
 * Validates game-owned image registries and SVG safety for ADR-063.
 *
 * JSON Schema owns registry shape. This validator adds repository invariants
 * that JSON Schema cannot express: directory ownership, duplicate ids, file
 * existence/size, orphan detection, path containment and SVG sanitization.
 */

const fs = require("node:fs");
const path = require("node:path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const repoRoot = path.resolve(__dirname, "..", "..");
const schemaPath = path.join(repoRoot, "docs", "architecture", "schemas", "game-assets.schema.json");
const MAX_FILE_BYTES = 512 * 1024;
const MAX_GAME_BYTES = 4 * 1024 * 1024;

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

function validateGameAssetDirectory(gameDir, validateSchema = buildValidator()) {
  const gameId = path.basename(gameDir);
  const assetsRoot = path.join(gameDir, "assets");
  const registryPath = path.join(assetsRoot, "assets.json");
  const issues = [];

  if (!fs.existsSync(registryPath)) {
    return { enrolled: false, gameId, issues };
  }

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    return {
      enrolled: true,
      gameId,
      issues: [`${relative(registryPath)}: invalid JSON: ${error.message}`]
    };
  }

  if (!validateSchema(registry)) {
    issues.push(
      `${relative(registryPath)}: schema validation failed: ${(validateSchema.errors || [])
        .map((error) => `${error.instancePath || "/"} ${error.message}`)
        .join("; ")}`
    );
    return { enrolled: true, gameId, issues };
  }

  if (registry.gameId !== gameId) {
    issues.push(`${relative(registryPath)}: gameId must equal directory name "${gameId}"`);
  }

  const seenIds = new Set();
  const registeredFiles = new Set();
  let totalBytes = 0;
  for (const asset of registry.assets) {
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
    if (size > MAX_FILE_BYTES) {
      issues.push(`${relative(resolved)}: file size ${size} exceeds ${MAX_FILE_BYTES} bytes`);
    }
    if (path.extname(resolved).toLowerCase() === ".svg") {
      issues.push(...validateSvg(fs.readFileSync(resolved, "utf8"), relative(resolved)));
    }
  }

  if (totalBytes > MAX_GAME_BYTES) {
    issues.push(`${relative(assetsRoot)}: total registered size ${totalBytes} exceeds ${MAX_GAME_BYTES} bytes`);
  }

  for (const filePath of collectAssetFiles(assetsRoot)) {
    const assetRelativePath = relative(filePath, assetsRoot);
    if (!registeredFiles.has(assetRelativePath)) {
      issues.push(`${relative(filePath)}: orphan file is not listed in assets.json`);
    }
  }

  return { enrolled: true, gameId, issues };
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
  MAX_FILE_BYTES,
  MAX_GAME_BYTES,
  buildValidator,
  collectAssetFiles,
  validateGameAssetDirectory,
  validateGamesRoot,
  validateSvg
};
