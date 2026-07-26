#!/usr/bin/env node
/**
 * Build the delivery map used by the Cards Money Trains player.
 *
 * The initial railway is permanent game content, so the delivery texture is
 * derived from the author's initial-network PNG. Baking only that immutable
 * layer keeps one GPU texture and exact visual alignment; Phaser still renders
 * new roads and every changing state above it. This is game-owned asset
 * preparation and does not add game semantics to the shared player.
 */

import { createHash } from "node:crypto";
import {
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const TOOL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = path.resolve(TOOL_ROOT, "..");
const REPO_ROOT = path.resolve(GAME_ROOT, "..", "..");
const SOURCE_PATH = path.join(REPO_ROOT, "draft", "trains", "Начальная транспортная сеть.png");
const TARGET_PATH = path.join(GAME_ROOT, "assets", "images", "guinea-map.webp");
const PROVENANCE_PATH = path.join(GAME_ROOT, "asset-provenance.json");
const CHECK = process.argv.slice(2).includes("--check");
const UNKNOWN_ARGS = process.argv.slice(2).filter((argument) => argument !== "--check");
if (UNKNOWN_ARGS.length > 0) {
  throw new Error(`Unknown argument: ${UNKNOWN_ARGS[0]}`);
}

const sourceBytes = readFileSync(SOURCE_PATH);
const sourceMetadata = await sharp(sourceBytes).metadata();
if (sourceMetadata.width !== 5079 || sourceMetadata.height !== 3627) {
  throw new Error(
    `Unexpected source dimensions: ${sourceMetadata.width}x${sourceMetadata.height}.`
  );
}

const deliveryBytes = await sharp(sourceBytes)
  .resize({
    width: 2560,
    height: 1829,
    fit: "inside",
    withoutEnlargement: true
  })
  .webp({
    quality: 84,
    effort: 6,
    smartSubsample: true
  })
  .toBuffer();
const deliveryMetadata = await sharp(deliveryBytes).metadata();
const currentProvenance = JSON.parse(readFileSync(PROVENANCE_PATH, "utf8"));
const nextProvenance = {
  ...currentProvenance,
  delivery: {
    mimeType: "image/webp",
    width: deliveryMetadata.width,
    height: deliveryMetadata.height,
    byteSize: deliveryBytes.byteLength,
    sha256: sha256(deliveryBytes)
  },
  source: {
    path: "draft/trains/Начальная транспортная сеть.png",
    mimeType: "image/png",
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    sha256: sha256(sourceBytes)
  },
  transform: {
    tool: "sharp",
    toolVersion: sharp.versions.sharp,
    format: "webp",
    maxWidth: 2560,
    maxHeight: 1829,
    fit: "inside",
    quality: 84,
    effort: 6,
    smartSubsample: true
  }
};
const provenanceBytes = Buffer.from(`${JSON.stringify(nextProvenance, null, 2)}\n`);

if (CHECK) {
  assertEqual(TARGET_PATH, deliveryBytes);
  assertEqual(PROVENANCE_PATH, provenanceBytes);
  console.log("build-map-asset: OK (delivery asset and provenance are current)");
  process.exit(0);
}

writeAtomically(TARGET_PATH, deliveryBytes);
writeAtomically(PROVENANCE_PATH, provenanceBytes);
console.log(
  `build-map-asset: OK (${deliveryMetadata.width}x${deliveryMetadata.height}, `
  + `${deliveryBytes.byteLength} bytes)`
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertEqual(filePath, expectedBytes) {
  const actualBytes = readFileSync(filePath);
  if (!actualBytes.equals(expectedBytes)) {
    throw new Error(`${path.relative(REPO_ROOT, filePath)} is stale.`);
  }
}

function writeAtomically(filePath, bytes) {
  const stat = statSync(filePath);
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporaryPath, bytes, { flag: "wx", mode: stat.mode });
  renameSync(temporaryPath, filePath);
}
