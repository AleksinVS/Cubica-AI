/**
 * Deterministic regression tests for the fail-closed affected-test policy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FULL_SUITE_IDS, GIT_DIFF_FILTER, selectAffected } from "./select-affected-tests.mjs";

test("git discovery includes deleted paths", () => {
  assert.match(GIT_DIFF_FILTER, /D/u);
});

test("selects only player checks for an isolated player implementation change", () => {
  assert.deepEqual(selectAffected(["apps/player-web/src/app/page.tsx"]), {
    paths: ["apps/player-web/src/app/page.tsx"],
    suiteIds: ["canonical", "e2e:player"],
    fullFallback: false,
    fallbackPaths: []
  });
});

test("combines independent portal and editor checks in stable order", () => {
  assert.deepEqual(
    selectAffected([
      "services/portal-backend/src/rules.js",
      "apps/editor-web/src/app/page.tsx"
    ]).suiteIds,
    ["canonical", "portal", "e2e:editor", "e2e:portal"]
  );
});

test("uses the full fallback for unknown paths", () => {
  const selection = selectAffected(["services/future-service/index.ts"]);
  assert.equal(selection.fullFallback, true);
  assert.deepEqual(selection.suiteIds, FULL_SUITE_IDS);
});

test("selects the narrow mock game and provenance gate", () => {
  for (const changedPath of [
    "games/cards-money-trains-mock/tests/mock-package.test.mjs",
    "games/cards-money-trains-mock/asset-provenance.json"
  ]) {
    assert.deepEqual(selectAffected([changedPath]), {
      paths: [changedPath],
      suiteIds: ["games:cmt-mock"],
      fullFallback: false,
      fallbackPaths: []
    });
  }
});

for (const criticalPath of [
  "package-lock.json",
  "apps/player-web/package.json",
  ".github/workflows/ci.yml",
  "playwright.config.ts",
  "scripts/ci/select-affected-tests.mjs",
  "docs/architecture/schemas/game.schema.json",
  "scripts/manifest-tools/generate-contracts-types.cjs",
  "packages/contracts/runtime/src/index.ts",
  "packages/view-protocol/src/index.ts",
  "apps/player-web/src/auth/session.ts",
  "services/runtime-api/src/security/policy.ts"
]) {
  test(`uses the full fallback for critical path: ${criticalPath}`, () => {
    const selection = selectAffected([criticalPath]);
    assert.equal(selection.fullFallback, true);
    assert.deepEqual(selection.suiteIds, FULL_SUITE_IDS);
  });
}

test("deduplicates and normalizes paths", () => {
  const selection = selectAffected([
    "./apps/player-web/src/app/page.tsx",
    "apps\\player-web\\src\\app\\page.tsx"
  ]);
  assert.deepEqual(selection.paths, ["apps/player-web/src/app/page.tsx"]);
});

test("selects no checks when there are no changed paths", () => {
  assert.deepEqual(selectAffected([]), {
    paths: [],
    suiteIds: [],
    fullFallback: false,
    fallbackPaths: []
  });
});
