/**
 * Engine-independent registration of test-only Cards Money Trains contributions.
 *
 * The entrypoint injects the Phaser scene factory. Keeping registration
 * separate lets ordinary Node tests verify API compatibility without loading
 * the browser-only plugin facade as an executable module.
 */

import type {
  PhaserSceneFactory,
  PlayerPluginApi
} from "@cubica/player-web/plugin-api";

import { provideCardsMoneyTrainsAccessibleBoardActions } from "./accessible-actions.ts";

export const CARDS_MONEY_TRAINS_GAME_ID = "cards-money-trains-mock";
export const CARDS_MONEY_TRAINS_PLAYER_PLUGIN_ID = "cards-money-trains-mock-player";

/** Register the DOM projection and the injected visual scene as one lifetime. */
export function registerCardsMoneyTrainsPlayer(
  api: PlayerPluginApi,
  sceneFactory: PhaserSceneFactory
): () => void {
  const disposeActions = api.registerAccessibleBoardActionsProvider?.(
    CARDS_MONEY_TRAINS_GAME_ID,
    provideCardsMoneyTrainsAccessibleBoardActions
  ) ?? (() => {});
  const disposeScene = api.registerPhaserSceneFactory(
    CARDS_MONEY_TRAINS_GAME_ID,
    sceneFactory
  );

  return () => {
    disposeScene();
    disposeActions();
  };
}
