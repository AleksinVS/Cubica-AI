/**
 * Public entrypoint for the Estate Race player-web field.
 *
 * The platform injects Phaser and owns its lifecycle. This game-local module
 * registers only a renderer/input adapter and never mutates balances, turns or
 * ownership optimistically.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { provideEstateRaceAccessibleBoardActions } from "./accessible-actions.ts";
import { createEstateRaceScene } from "./scene.ts";

export const ESTATE_RACE_GAME_ID = "estate-race";
export const ESTATE_RACE_PLAYER_PLUGIN_ID = "estate-race-player";

export { projectEstateRaceSession } from "./board-state.ts";
export { provideEstateRaceAccessibleBoardActions } from "./accessible-actions.ts";
export { createEstateRaceScene } from "./scene.ts";

/** Register both independent host controls and the Phaser scene. */
export function activate(api: PlayerPluginApi): () => void {
  // Optional chaining keeps a newly published API 2.0 bundle loadable by an
  // older API 2.0 host. Such a host falls back to the deprecated scene callback.
  const disposeActions = api.registerAccessibleBoardActionsProvider?.(
    ESTATE_RACE_GAME_ID,
    provideEstateRaceAccessibleBoardActions
  ) ?? (() => {});
  const disposeScene = api.registerPhaserSceneFactory(ESTATE_RACE_GAME_ID, createEstateRaceScene);

  return () => {
    // Dispose in reverse registration order so neither contribution from an
    // older preview bundle can remove a newer bundle's registration.
    disposeScene();
    disposeActions();
  };
}
