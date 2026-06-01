/**
 * Public entrypoint for the Antarctica player-web plugin.
 *
 * The platform calls activate() with a small capability object. The plugin then
 * registers its contribution points without importing player-web internals.
 */

import type { PlayerPluginApi } from "@cubica/player-web/plugin-api";

import { ANTARCTICA_GAME_CONFIG_DATA } from "./config-data";
import { createAntarcticaConfig } from "./register";

export { ANTARCTICA_GAME_CONFIG_DATA } from "./config-data";
export { createAntarcticaConfig } from "./register";
export * from "./contracts";
export * from "./state-resolvers";

export const ANTARCTICA_PLAYER_PLUGIN_ID = "antarctica-player";

export function activate(api: PlayerPluginApi): void {
  api.registerGameConfigData(ANTARCTICA_GAME_CONFIG_DATA);
  api.registerGameConfigFactory(ANTARCTICA_GAME_CONFIG_DATA.gameId, createAntarcticaConfig);
}
