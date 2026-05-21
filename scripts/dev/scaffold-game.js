#!/usr/bin/env node
/**
 * Game Scaffold Generator
 *
 * Generates the plugin boilerplate for a new game from its manifest data.
 * This automates the mechanical parts of adding a new game, ensuring
 * consistent structure across all game plugins.
 *
 * Usage:
 *   node scripts/dev/scaffold-game.js <gameId>
 *
 * The gameId must match a directory under games/ with a game.manifest.json.
 * Generated files are written to apps/player-web/src/plugins/<gameId>/.
 *
 * A plugin is optional. Use this script only when manifest-driven routing and
 * the default player config are not enough for a game-specific state adapter.
 * The generated plugin intentionally omits no-op screen and layout resolvers so
 * it does not disable data-driven routing from the UI manifest.
 */

const fs = require("fs");
const path = require("path");

const gameId = process.argv[2];
if (!gameId) {
  console.error("Usage: node scaffold-game.js <gameId>");
  process.exit(1);
}

const gameDir = path.join(process.cwd(), "games", gameId);
const manifestPath = path.join(gameDir, "game.manifest.json");
const pluginDir = path.join(process.cwd(), "apps", "player-web", "src", "plugins", gameId);

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  console.error(`Make sure games/${gameId}/game.manifest.json exists.`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const gameName = manifest.meta?.name || gameId;
const locale = manifest.config?.settings?.locale || "en-US";
const typeName = toPascalCase(gameId);

console.log(`Scaffolding plugin for: ${gameName} (${gameId})`);
console.log(`Locale: ${locale}`);
console.log(`Output: ${pluginDir}/`);

// Ensure plugin directory exists
fs.mkdirSync(pluginDir, { recursive: true });

// --- contracts.ts ---
const contractsContent = `import type { ActionEntry } from "@/lib/game-content-resolvers";

/**
 * ${gameName} — game-specific state and content contracts.
 *
 * These types define the shape of the resolved game state that
 * SafeModeRenderer and the action adapter consume at runtime.
 * Modify these interfaces to match the game's actual state shape.
 */

export interface ${typeName}GameState {
  /** Add game-specific state fields here. */
  currentInfo: Record<string, unknown> | null;
  currentBoard: Record<string, unknown> | null;
  canAdvance: boolean;
  fallbackActions: Array<ActionEntry>;
  // Add more fields as needed for the game's state resolution
}

/**
 * Game-specific content structure.
 * Matches the shape stored in manifest.content.<gameId>.
 */
export interface ${typeName}Content {
  // Define content shape based on game.manifest.json content.<gameId>
  [key: string]: unknown;
}
`;

// --- state-resolvers.ts ---
const stateResolversContent = `/**
 * ${gameName}-specific state resolvers.
 *
 * These functions transform raw session state into the game-specific
 * ${typeName}GameState that the plugin's resolveGameState produces.
 */

import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { ${typeName}Content } from "./contracts";
import type { SessionSnapshot } from "@/lib/game-content-resolvers";
import {
  resolveGameContent,
  readCanAdvance as readCanAdvanceGeneric,
  getFallbackActionEntries,
} from "@/lib/game-content-resolvers";

/**
 * Extracts game-specific content from PlayerFacingContent.
 */
export function resolve${typeName}Content(content: PlayerFacingContent): ${typeName}Content | null {
  return resolveGameContent(content) as ${typeName}Content | null;
}

/**
 * Reads canAdvance from the session snapshot.
 * Proxy to the generic utility for convenience.
 */
export function readCanAdvance(session: SessionSnapshot | null): boolean {
  return readCanAdvanceGeneric(session);
}

export { getFallbackActionEntries };
`;

// --- register.ts ---
const registerContent = `import { registerGameResolvers } from "@/presenter/game-config-registry";
import type { GameConfigData, GameConfig, ResolverFactory } from "@/presenter/game-config";
import type { ${typeName}GameState } from "./contracts";
import type { GamePlayerUiContent } from "@cubica/contracts-manifest";
import {
  resolve${typeName}Content,
  readCanAdvance,
  getFallbackActionEntries,
} from "./state-resolvers";
import { createManifestActionAdapter } from "@/lib/manifest-action-adapter";

/**
 * Resolver factory for ${gameName}.
 *
 * Creates a full GameConfig with working this-references from serializable data.
 */
const create${typeName}Config: ResolverFactory<${typeName}GameState, GamePlayerUiContent> = (
  data: GameConfigData
): GameConfig<${typeName}GameState, GamePlayerUiContent> => {
  const topbarScreenKeys = new Set(data.topbarScreenKeys);

  return {
    gameId: data.gameId,
    playerId: data.playerId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys,
    metricBackgroundImages: data.metricBackgroundImages,

    resolveGameState(content, session) {
      const gameContent = resolve${typeName}Content(content);
      const canAdvance = readCanAdvance(session);
      const fallbackActions = getFallbackActionEntries(content);

      return {
        currentInfo: null,
        currentBoard: null,
        canAdvance,
        fallbackActions,
      };
    },

    createManifestActionAdapter(content, gameState, dispatchAction, onError) {
      return createManifestActionAdapter({
        gameContent: resolve${typeName}Content(content),
        dispatchAction,
        onError,
      });
    },
  };
};

/**
 * Registers the ${gameName} resolver factory in the global registry.
 * Runs as a side-effect on module import.
 */
registerGameResolvers(
  "${gameId}",
  create${typeName}Config as unknown as import("@/presenter/game-config").ResolverFactory
);
`;

// --- Write files ---
const files = {
  ".desc.json": JSON.stringify({
    summary: `Optional player-web plugin scaffold for ${gameName}. Keep this directory limited to game-specific resolvers that cannot be expressed in manifests.`,
    owner: "player-web"
  }, null, 2) + "\n",
  "contracts.ts": contractsContent,
  "state-resolvers.ts": stateResolversContent,
  "register.ts": registerContent,
};

for (const [filename, content] of Object.entries(files)) {
  const filePath = path.join(pluginDir, filename);
  if (fs.existsSync(filePath)) {
    console.warn(`  SKIP (already exists): ${filePath}`);
  } else {
    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`  WROTE: ${filePath}`);
  }
}

// --- Remind about manual steps ---
console.log("");
console.log("=== Validation checklist ===");
console.log(`1. Register the plugin only if custom resolvers are really needed:`);
console.log(`   import "@/plugins/${gameId}/register";`);
console.log(`2. Keep resolveScreenKey/resolveLayoutMode omitted unless the game cannot use screen_routing.`);
console.log(`3. Ensure games/${gameId}/ui/web/ui.manifest.json contains screens and screen_routing for the default path.`);
console.log(`4. Run: node scripts/dev/generate-structure.js`);
console.log(`5. Run: npm run verify:canonical`);

function toPascalCase(str) {
  return str
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
