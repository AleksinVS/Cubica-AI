/**
 * Public entrypoint for the Cards Money Trains player-web plugin.
 *
 * The plugin registers one Phaser scene factory and returns its scoped
 * disposer. Phaser remains platform-owned and is injected into the factory.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { createCardsMoneyTrainsScene } from "./scene";

export const CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains";
export const CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-player";

export { projectBoardSession } from "./board-state";
export { createCardsMoneyTrainsScene } from "./scene";

/** Register the game-owned scene and return the registration disposer. */
export function activate(api: PlayerPluginApi): () => void {
  return api.registerPhaserSceneFactory(CARDS_MONEY_TRAINS_GAME_ID, createCardsMoneyTrainsScene);
}
