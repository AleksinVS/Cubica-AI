#!/usr/bin/env node
/**
 * Validates game-agnostic architecture invariants that are cheap to check in CI.
 *
 * The script is intentionally narrow: it does not prove all architecture rules,
 * but it blocks the regressions found in TSK-20260521:
 * - player-web page must not always pass Antarctica config;
 * - generic journal must not filter by Antarctica action prefixes;
 * - scaffolded plugins must not contain no-op routing/layout resolvers;
 * - a second game fixture must exist for multi-game verification.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const requireFile = (relativePath) => {
  if (!fs.existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
};

const assertNotContains = (relativePath, forbidden, reason) => {
  const text = read(relativePath);
  if (text.includes(forbidden)) {
    throw new Error(`${relativePath} contains forbidden text "${forbidden}": ${reason}`);
  }
};

requireFile("games/simple-choice/game.manifest.json");
requireFile("games/simple-choice/ui/web/ui.manifest.json");
requireFile("games/simple-choice/.desc.json");
requireFile("games/simple-choice/ui/web/.desc.json");

assertNotContains(
  "apps/player-web/app/page.tsx",
  "ANTARCTICA_GAME_CONFIG_DATA",
  "page.tsx must select config by loaded content, not hard-code Antarctica"
);

assertNotContains(
  "apps/player-web/src/components/panels/journal-renderer.tsx",
  "opening.card.",
  "generic journal must use neutral log metadata"
);

assertNotContains(
  "apps/player-web/src/components/panels/journal-renderer.tsx",
  "opening-card-resolution",
  "generic journal must use neutral log metadata"
);

assertNotContains(
  "scripts/dev/scaffold-game.js",
  "resolveScreenKey(screenId",
  "scaffold must not generate no-op screen resolvers"
);

assertNotContains(
  "scripts/dev/scaffold-game.js",
  "resolveLayoutMode(screenKey",
  "scaffold must not generate no-op layout resolvers"
);

console.log("validate-game-agnostic: OK");
