import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { GameConfigData } from "@/presenter/game-config";
import { createDefaultGameConfigData } from "@/presenter/game-config";
import { ANTARCTICA_GAME_CONFIG_DATA } from "@/presenter/antarctica-config-data";

/**
 * Server-side game config data resolver.
 *
 * This module is intentionally placed in the plugin layer: generic app/page.tsx
 * asks for config by player-facing content, while known complex games can keep
 * their custom serializable defaults without hard-coding them in the page.
 */
const pluginConfigData = new Map<string, GameConfigData>([
  ["antarctica", ANTARCTICA_GAME_CONFIG_DATA],
]);

export function resolveGameConfigData(content: PlayerFacingContent): GameConfigData {
  return pluginConfigData.get(content.gameId) ?? createDefaultGameConfigData(content);
}
