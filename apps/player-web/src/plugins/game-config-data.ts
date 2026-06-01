import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { GameConfigData } from "@/presenter/game-config";
import { createDefaultGameConfigData } from "@/presenter/game-config";

/**
 * Server-side game config data resolver.
 *
 * Production plugin config now arrives through PlayerFacingContent plugin
 * bundle references and is registered in the browser through PlayerPluginApi.
 * The Server Component therefore starts from manifest-derived defaults; complex
 * games replace them after their published or preview bundle activates.
 */
export function resolveGameConfigData(content: PlayerFacingContent): GameConfigData {
  return createDefaultGameConfigData(content);
}
