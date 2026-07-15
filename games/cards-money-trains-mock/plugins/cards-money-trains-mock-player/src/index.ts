/**
 * Public entrypoint for the explicitly test-only Cards Money Trains plugin.
 *
 * The plugin registers an engine-independent action projection and one Phaser
 * scene factory. Phaser remains platform-owned and is injected into the scene.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { createCardsMoneyTrainsScene } from "./scene.ts";
import { registerCardsMoneyTrainsPlayer } from "./registration.ts";

export {
  CARDS_MONEY_TRAINS_GAME_ID,
  CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID
} from "./registration.ts";
export { projectBoardSession } from "./board-state.ts";
export { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
export { createCardsMoneyTrainsScene } from "./scene.ts";

/** Register both independent host controls and the Phaser scene. */
export function activate(api: PlayerPluginApi): () => void {
  return registerCardsMoneyTrainsPlayer(api, createCardsMoneyTrainsScene);
}
