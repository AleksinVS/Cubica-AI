/**
 * Public entrypoint for the Estate Race player-web field.
 *
 * The platform injects Phaser and owns its lifecycle. This game-local module
 * registers only a renderer/input adapter and never mutates balances, turns or
 * ownership optimistically.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { createEstateRaceScene } from "./scene";

export const ESTATE_RACE_GAME_ID = "estate-race";
export const ESTATE_RACE_PLAYER_PLUGIN_ID = "estate-race-player";

export { projectEstateRaceSession } from "./board-state";
export { createEstateRaceScene } from "./scene";

/** Register this game's scene and return its narrowly scoped disposer. */
export function activate(api: PlayerPluginApi): () => void {
  return api.registerPhaserSceneFactory(ESTATE_RACE_GAME_ID, createEstateRaceScene);
}
