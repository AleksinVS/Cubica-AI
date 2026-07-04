#!/usr/bin/env node
/**
 * Validates game-agnostic architecture invariants that are cheap to check in CI.
 *
 * The script is intentionally narrow: it does not prove all architecture rules,
 * but it blocks the regressions found in TSK-20260521:
 * - player-web page must not always pass Antarctica config;
 * - game-specific journal UI must not return to generic player-web code;
 * - local Antarctica UI commands must not return as game manifest actions;
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

const assertFileAbsent = (relativePath, reason) => {
  if (fs.existsSync(path.join(repoRoot, relativePath))) {
    throw new Error(`${relativePath} must not exist: ${reason}`);
  }
};

const assertManifestActionAbsent = (relativePath, actionId, reason) => {
  const manifest = JSON.parse(read(relativePath));
  if (manifest.actions && Object.prototype.hasOwnProperty.call(manifest.actions, actionId)) {
    throw new Error(`${relativePath} must not contain action "${actionId}": ${reason}`);
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

assertFileAbsent(
  "apps/player-web/src/components/panels/journal-renderer.tsx",
  "journal UI must be game-defined in a UI manifest panel, not a platform React component"
);

assertFileAbsent(
  "apps/player-web/src/components/panels/hint-renderer.tsx",
  "hint UI must be game-defined in a UI manifest panel, not a platform React component"
);

for (const actionId of ["showHint", "showTopBar", "showScreenWithLeftSideBar"]) {
  assertManifestActionAbsent(
    "games/antarctica/game.manifest.json",
    actionId,
    "local UI commands must live in the UI manifest/Presenter state, not in game logic"
  );
}

// ADR-055: the generic player-web renderer and layout lib must not carry
// game-specific signals — no hardcoded button ids, no branching on a game's CSS
// class name, and no mapping of natural-language captions to behavior. Which
// control carries which action is declared in the UI manifest instead.
for (const forbidden of ["nav-right", "btn-advance", "btn-finish", "info-screen-shell"]) {
  assertNotContains(
    "apps/player-web/src/components/manifest/ui-component-node.tsx",
    forbidden,
    "generic renderer must not hardcode game-specific button ids or CSS class names (ADR-055)"
  );
}

for (const forbidden of ["журнал", "подсказ"]) {
  assertNotContains(
    "apps/player-web/src/lib/layout-helpers.ts",
    forbidden,
    "generic renderer must not map natural-language captions to button behavior (ADR-055)"
  );
}

// ADR-055: the generic layout helper must not know a game's structural CSS class
// names. Which topbar modifier an area needs is declared in the UI manifest
// (props.topbarCssClass); the helper only applies it, it does not map class names.
for (const forbidden of [
  "game-variables-container",
  "main-content-area",
  "cards-container",
  "board-header",
  "board-title",
  "sidebar-decoration"
]) {
  assertNotContains(
    "apps/player-web/src/lib/layout-helpers.ts",
    forbidden,
    "generic layout helper must not branch on a game's structural CSS class names (ADR-055)"
  );
}

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
