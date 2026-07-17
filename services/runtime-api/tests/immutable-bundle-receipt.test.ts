/** Regression coverage for receipt replay across runtime module upgrades. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { ImmutableGameBundle } from "@cubica/contracts-session";
import { createImmutableBundleContent } from "../src/modules/content/immutableBundle.ts";
import {
  loadImmutableGameBundle,
  loadImmutableGameBundleForReceipt
} from "../src/modules/content/manifestLoader.ts";

test("an integrity-valid historic bundle remains readable for an exact receipt retry", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;

  // Model a real historic bundle whose exact module artifact is no longer in
  // the active registry. Its own content hash remains valid and immutable.
  manifest.mechanics.moduleLock["cubica.core"].artifactHash = `sha256:${"0".repeat(64)}`;
  const immutable = createImmutableBundleContent("simple-choice", manifest);
  const stored: ImmutableGameBundle = {
    ...immutable,
    createdAt: new Date()
  };

  assert.throws(
    () => loadImmutableGameBundle(stored),
    /module|artifact|hash/iu,
    "new commands must not run when their exact executor artifact is unavailable"
  );
  const replayBundle = loadImmutableGameBundleForReceipt(stored);
  assert.equal(replayBundle.bundleHash, stored.bundleHash);
  assert.equal(replayBundle.manifest.meta.id, "simple-choice");
});

test("receipt replay never bypasses immutable bundle integrity", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../../../games/simple-choice/game.manifest.json", import.meta.url),
    "utf8"
  )) as Record<string, any>;
  const immutable = createImmutableBundleContent("simple-choice", manifest);
  const stored: ImmutableGameBundle = {
    ...immutable,
    createdAt: new Date()
  };
  (stored.canonicalBundle as any).manifest.meta.name = "tampered after hashing";

  assert.throws(
    () => loadImmutableGameBundleForReceipt(stored),
    /integrity|canonical bytes/iu
  );
});
