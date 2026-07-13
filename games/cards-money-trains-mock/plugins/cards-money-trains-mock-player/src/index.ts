/**
 * Public entrypoint for the explicitly test-only Cards Money Trains plugin.
 *
 * The plugin registers an engine-independent action projection and one Phaser
 * scene factory. Phaser remains platform-owned and is injected into the scene.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
import { createCardsMoneyTrainsScene } from "./scene.ts";

export const CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains-mock";
export const CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-mock-player";

export { projectBoardSession } from "./board-state.ts";
export { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";
export { createCardsMoneyTrainsScene } from "./scene.ts";

/** Register both independent host controls and the Phaser scene. */
export function activate(api: PlayerPluginApi): () => void {
  // Feature detection preserves API 2.0 compatibility with a cached older
  // host, where the scene callback remains the deliberately limited fallback.
  const disposeActions = api.registerAccessibleBoardActionsProvider?.(
    CARDS_MONEY_TRAINS_GAME_ID,
    provideCardsMoneyTrainsAccessibleBoardActions
  ) ?? (() => {});
  const disposeScene = api.registerPhaserSceneFactory(
    CARDS_MONEY_TRAINS_GAME_ID,
    createCardsMoneyTrainsScene
  );

  return () => {
    // Registrations are ownership-aware; reverse disposal is safe during hot
    // preview replacement and keeps both contributions scoped to this bundle.
    disposeScene();
    disposeActions();
  };
}
