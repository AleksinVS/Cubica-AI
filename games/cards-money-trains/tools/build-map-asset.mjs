#!/usr/bin/env node
/**
 * Build the delivery map used by the Cards Money Trains player.
 *
 * The delivery texture is derived from the author's clean board — the map
 * with countries, printed station icons and half-stop marks, but without any
 * railway. The transport network is not part of the picture: roads open,
 * close and get split during a session, so the player draws all of them from
 * runtime-owned data, in the author's own rails-and-sleepers style (see
 * `plugins/cards-money-trains-player/src/author-network-style.ts`). Earlier
 * this tool baked the author's initial-network image instead; that made the
 * ten initial roads immutable pixels, which had to be painted over whenever
 * their state changed. This is game-owned asset preparation and does not add
 * game semantics to the shared player.
 *
 * `asset-provenance.json` is a registry (a list of records), not a single
 * flat record: it also tracks author source materials that this tool never
 * touches (the vector map first-source and its calibration raster). This
 * tool therefore updates only its own registry entry, identified by
 * PROVENANCE_ENTRY_ID, and leaves every other entry and the registry's
 * top-level fields (schema reference, location notice, etc.) exactly as
 * they were — the same way it previously preserved unrelated top-level keys
 * with an object spread.
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
const SOURCE_PATH = path.join(REPO_ROOT, "draft", "trains", "Игровая Карта.png");
const TARGET_PATH = path.join(GAME_ROOT, "assets", "images", "guinea-map.webp");
const PROVENANCE_PATH = path.join(GAME_ROOT, "asset-provenance.json");
// Stable id of this tool's own record inside the asset-provenance.json
// registry (see docs/architecture/schemas/asset-provenance.schema.json).
const PROVENANCE_ENTRY_ID = "board-guinea-optimized";
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
const entryIndex = currentProvenance.entries.findIndex(
  (entry) => entry.id === PROVENANCE_ENTRY_ID
);
if (entryIndex === -1) {
  throw new Error(
    `asset-provenance.json has no entry with id "${PROVENANCE_ENTRY_ID}"; ` +
      "the registry entry must exist before this tool can refresh it."
  );
}
const currentEntry = currentProvenance.entries[entryIndex];
// Only the fields this tool actually derives are replaced. "rights" is a
// human decision (recorded by the PM, not by this build step) and must be
// carried over unchanged, together with the entry's own id/path/root/kind.
const nextEntry = {
  ...currentEntry,
  contentType: "image/webp",
  width: deliveryMetadata.width,
  height: deliveryMetadata.height,
  byteSize: deliveryBytes.byteLength,
  sha256: sha256(deliveryBytes),
  derivedFrom: {
    source: {
      path: "draft/trains/Игровая Карта.png",
      root: "repo",
      contentType: "image/png",
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      byteSize: sourceBytes.byteLength,
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
  }
};
const nextEntries = [...currentProvenance.entries];
nextEntries[entryIndex] = nextEntry;
const nextProvenance = { ...currentProvenance, entries: nextEntries };
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
