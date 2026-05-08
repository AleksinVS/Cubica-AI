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
 * After running this script, you must:
 * 1. Add `import "@/plugins/<gameId>/register";` to apps/player-web/src/plugins/register-games.ts
 * 2. Create a Server Component that provides GameConfigData for the new game
 * 3. Implement game-specific state resolution logic in state-resolvers.ts
 * 4. Add UI manifest screens for the game
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

export interface ${capitalize(gameId)}GameState {
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
export interface ${capitalize(gameId)}Content {
  // Define content shape based on game.manifest.json content.<gameId>
  [key: string]: unknown;
}
`;

// --- state-resolvers.ts ---
const stateResolversContent = `/**
 * ${gameName}-specific state resolvers.
 *
 * These functions transform raw session state into the game-specific
 * ${capitalize(gameId)}GameState that the plugin's resolveGameState produces.
 */

import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { ${capitalize(gameId)}Content } from "./contracts";
import type { SessionSnapshot } from "@/lib/game-content-resolvers";
import {
  resolveGameContent,
  readPublicState,
  readCanAdvance as readCanAdvanceGeneric,
  getFallbackActionEntries,
} from "@/lib/game-content-resolvers";

/**
 * Extracts game-specific content from PlayerFacingContent.
 */
export function resolve${capitalize(gameId)}Content(content: PlayerFacingContent): ${capitalize(gameId)}Content | null {
  return resolveGameContent(content) as ${capitalize(gameId)}Content | null;
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
import type { ${capitalize(gameId)}GameState } from "./contracts";
import type { GamePlayerUiContent } from "@cubica/contracts-manifest";
import {
  resolve${capitalize(gameId)}Content,
  readCanAdvance,
  getFallbackActionEntries,
} from "./state-resolvers";
import { createManifestActionAdapter } from "@/lib/manifest-action-adapter";

/**
 * Resolver factory for ${gameName}.
 *
 * Creates a full GameConfig with working this-references from serializable data.
 */
const create${capitalize(gameId)}Config: ResolverFactory<${capitalize(gameId)}GameState, GamePlayerUiContent> = (
  data: GameConfigData
): GameConfig<${capitalize(gameId)}GameState, GamePlayerUiContent> => {
  const topbarScreenKeys = new Set(data.topbarScreenKeys);

  return {
    gameId: data.gameId,
    playerId: data.playerId,
    storageKey: data.storageKey,
    fallbackMetrics: data.fallbackMetrics,
    topbarScreenKeys,
    metricBackgroundImages: data.metricBackgroundImages,

    resolveScreenKey(screenId, stepIndex, infoId, runtimeUi, gameUi) {
      // Use data-driven routing from manifest screenRouting entries.
      // Override this method only if the game needs custom routing logic.
      return null;
    },

    resolveLayoutMode(screenKey, runtimeUi, gameState) {
      // Use data-driven layout from manifest screenRouting entries.
      // Override this method only if the game needs custom layout logic.
      if (runtimeUi.activeScreen === "topbar") {
        return "topbar";
      }
      if (runtimeUi.activeScreen === "left-sidebar") {
        return "leftsidebar";
      }
      return "topbar";
    },

    resolveGameState(content, session) {
      const publicState = session?.state?.public as Record<string, unknown> | undefined;
      const gameContent = resolve${capitalize(gameId)}Content(content);
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
        gameContent: resolve${capitalize(gameId)}Content(content),
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
  create${capitalize(gameId)}Config as unknown as import("@/presenter/game-config").ResolverFactory
);
`;

// --- Write files ---
const files = {
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
console.log("=== Manual steps required ===");
console.log(`1. Add to apps/player-web/src/plugins/register-games.ts:`);
console.log(`   import "@/plugins/${gameId}/register";`);
console.log(`2. Create a Server Component that provides GameConfigData for "${gameId}"`);
console.log(`3. Implement game-specific state resolution in state-resolvers.ts`);
console.log(`4. Add UI manifest screens at games/${gameId}/ui/web/ui.manifest.json`);
console.log(`5. Update the Server Component to pass metricSpecs from the UI manifest`);

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}