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
 *
 * It also owns the ADR-091 global-style boundary: the platform global stylesheet
 * (apps/player-web/app/globals.css) must not carry game-owned styling. See
 * findGlobalStyleGameLeaks and ENFORCE_GLOBAL_STYLE_BOUNDARY below.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// ADR-091 global-style boundary enforcement flag.
//
// The three detectors in findGlobalStyleGameLeaks are the automatable signals of
// game-owned styling leaking back into the platform global stylesheet.
//
// Mechanism (recorded in ADR-091): the guard originally shipped DISABLED behind
// this flag, reporting the outstanding Antarctica leaks as a non-gating summary
// so it could not be forgotten and gave TSK-20260719 block R3 a live checklist.
// R3 has now moved the Antarctica styling into the game CSS channel
// (games/antarctica/assets/styles/antarctica.css) and emptied globals.css of
// game-owned styling, so the flag is flipped to `true`: the three detectors are
// hard failures that block any future regression. The detector logic is also
// exercised on synthetic data by scripts/ci/validate-game-agnostic.test.js.
const ENFORCE_GLOBAL_STYLE_BOUNDARY = true;

const GLOBAL_STYLESHEET = "apps/player-web/app/globals.css";

/**
 * Emoji / decorative-pictograph detector. Game chrome (for example the
 * Antarctica penguins) belongs in the game's own CSS, never in globals.css.
 */
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/**
 * Recursively collect DOM-id candidates declared by every game's UI manifest.
 *
 * These ids (button/component ids like "btn-journal", "nav-left") are the ids a
 * game's own stylesheet may target with `#id` selectors. The platform global
 * stylesheet must never target them, so we forbid `#<id>` selectors for exactly
 * this set. Manifest meta ids (which contain dots, e.g. "antarctica.ui.web") are
 * excluded because they are not usable as CSS id selectors.
 */
function collectGameManifestComponentIds(gamesRoot = path.join(repoRoot, "games")) {
  const ids = new Set();
  const cssIdSafe = /^[a-zA-Z][\w-]*$/u;

  const collectFromNode = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) collectFromNode(item);
      return;
    }
    if (node && typeof node === "object") {
      if (typeof node.id === "string" && cssIdSafe.test(node.id)) {
        ids.add(node.id);
      }
      for (const value of Object.values(node)) collectFromNode(value);
    }
  };

  if (!fs.existsSync(gamesRoot)) return ids;
  for (const gameEntry of fs.readdirSync(gamesRoot, { withFileTypes: true })) {
    if (!gameEntry.isDirectory()) continue;
    const uiRoot = path.join(gamesRoot, gameEntry.name, "ui");
    if (!fs.existsSync(uiRoot)) continue;
    for (const channelEntry of fs.readdirSync(uiRoot, { withFileTypes: true })) {
      if (!channelEntry.isDirectory()) continue;
      const manifestPath = path.join(uiRoot, channelEntry.name, "ui.manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        collectFromNode(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
      } catch {
        // A malformed manifest is caught by other checks; ignore it here.
      }
    }
  }
  return ids;
}

/**
 * Detect game-owned styling that has leaked into a platform stylesheet.
 *
 * Returns a list of human-readable violation messages for three signals:
 *   1. `url(...)` with a baked-in absolute path (e.g. url("/images/...")): game
 *      images must be delivered by the ADR-063/091 channel, not referenced by
 *      absolute path from platform CSS.
 *   2. Decorative emoji (game chrome).
 *   3. `#<id>` selectors whose ids are declared by a game UI manifest component.
 */
function findGlobalStyleGameLeaks(cssText, forbiddenIds = new Set()) {
  const leaks = [];

  const urlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/giu;
  const absoluteUrls = new Set();
  for (const match of cssText.matchAll(urlPattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw.startsWith("/") || /^https?:/iu.test(raw)) {
      absoluteUrls.add(raw);
    }
  }
  for (const raw of [...absoluteUrls].sort()) {
    leaks.push(`global stylesheet references a baked-in asset path url("${raw}"); use the game CSS channel (ADR-091)`);
  }

  if (EMOJI_PATTERN.test(cssText)) {
    leaks.push("global stylesheet contains decorative emoji; game chrome belongs in the game CSS channel (ADR-091)");
  }

  for (const id of [...forbiddenIds].sort()) {
    const selector = new RegExp(`#${id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\w-])`, "u");
    if (selector.test(cssText)) {
      leaks.push(`global stylesheet targets game-owned component id selector #${id}; move it to the game CSS channel (ADR-091)`);
    }
  }

  return leaks;
}

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

/**
 * ADR-091 global-style boundary check.
 *
 * When enforcement is enabled (post-R3), any detected leak fails the build. Until
 * then it prints a non-gating summary so the boundary is visible and R3 has a
 * live checklist without turning the canonical contour red.
 */
function checkGlobalStyleBoundary() {
  const cssText = read(GLOBAL_STYLESHEET);
  const forbiddenIds = collectGameManifestComponentIds();
  const leaks = findGlobalStyleGameLeaks(cssText, forbiddenIds);
  if (leaks.length === 0) {
    return;
  }
  if (ENFORCE_GLOBAL_STYLE_BOUNDARY) {
    throw new Error(
      `${GLOBAL_STYLESHEET} carries game-owned styling (ADR-091):\n- ${leaks.join("\n- ")}`
    );
  }
  console.warn(
    `validate-game-agnostic: ADR-091 global-style boundary is NOT yet enforced ` +
      `(ENFORCE_GLOBAL_STYLE_BOUNDARY=false; flip to true in TSK-20260719 block R3).\n` +
      `${leaks.length} outstanding game-style leak(s) in ${GLOBAL_STYLESHEET}:\n- ${leaks.join("\n- ")}`
  );
}

function main() {
  requireFile("games/simple-choice/game.manifest.json");
  requireFile("games/simple-choice/ui/web/ui.manifest.json");
  requireFile("games/simple-choice/.desc.json");
  requireFile("games/simple-choice/ui/web/.desc.json");

  assertNotContains(
    "apps/player-web/app/page.tsx",
    "ANTARCTICA_GAME_CONFIG_DATA",
    "page.tsx must select config by loaded content, not hard-code Antarctica"
  );

  // ARC-003 (TSK-20260719-antarctica-remediation, block R5): the shared
  // entry point used to default a bare "/" request to "antarctica"
  // (`params?.gameId || "antarctica"`), which is exactly the hardcoded-game-id
  // violation CLAUDE.md rule 10 forbids in platform layers. A missing
  // `?gameId=` must render a generic error instead of guessing a game. Guard
  // against any concrete game id literal (not just "antarctica") creeping
  // back into this file by checking every directory under games/.
  const gamesDir = path.join(repoRoot, "games");
  const gameIds = fs
    .readdirSync(gamesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const gameId of gameIds) {
    assertNotContains(
      "apps/player-web/app/page.tsx",
      gameId,
      "the shared entry point must not hard-code a default/fallback gameId for any game (ARC-003)"
    );
  }

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

  // ADR-091 global-style boundary (gated by ENFORCE_GLOBAL_STYLE_BOUNDARY).
  checkGlobalStyleBoundary();

  console.log("validate-game-agnostic: OK");
}

if (require.main === module) {
  main();
}

module.exports = {
  ENFORCE_GLOBAL_STYLE_BOUNDARY,
  EMOJI_PATTERN,
  collectGameManifestComponentIds,
  findGlobalStyleGameLeaks,
  checkGlobalStyleBoundary,
  main
};
