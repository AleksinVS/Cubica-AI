import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertReadyPreviewSourceManifest
} from "./preview-source.mjs";

const toolsRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolsRoot, "../../..");
const gameRoot = path.resolve(toolsRoot, "..");
const helperPath = path.join(toolsRoot, "prepare-local-preview.mjs");
const manifestPath = path.join(gameRoot, "game.manifest.json");

test("preview copies the ready manifest byte-for-byte without changing source", () => {
  const sourceBytesBefore = readFileSync(manifestPath);
  const output = execFileSync(process.execPath, [helperPath, "--no-register"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  const result = JSON.parse(output);
  const previewManifestPath = path.join(
    result.contentRoot,
    "games",
    "cards-money-trains",
    "game.manifest.json"
  );

  assert.deepEqual(readFileSync(previewManifestPath), sourceBytesBefore);
  assert.deepEqual(readFileSync(manifestPath), sourceBytesBefore);
  const copiedManifest = JSON.parse(readFileSync(previewManifestPath, "utf8"));
  assert.equal(copiedManifest.config.runtimeReady, true);
  assert.equal(Object.hasOwn(copiedManifest.config, "runtimeBlockers"), false);
});

test("preview source validation fails closed for not-ready and blockered sources", () => {
  const trackedManifestBefore = readFileSync(manifestPath);
  const candidates = [
    { config: { runtimeReady: false } },
    { config: { runtimeReady: true, runtimeBlockers: [] } },
    { config: { runtimeReady: true, runtimeBlockers: ["unfinished gate"] } }
  ];

  for (const candidate of candidates) {
    const before = structuredClone(candidate);
    assert.throws(() => assertReadyPreviewSourceManifest(candidate), /preview requires/iu);
    assert.deepEqual(candidate, before);
  }
  assert.deepEqual(readFileSync(manifestPath), trackedManifestBefore);
});
