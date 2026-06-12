/**
 * Public API for trusted project-local player-web plugins.
 *
 * A plugin should import from this facade instead of importing private
 * player-web modules such as presenter registries or low-level content helpers.
 * That keeps the plugin boundary explicit while the final bundle handoff from
 * ADR-039 is implemented.
 */

import type { GameConfigData, ResolverFactory } from "@/presenter/game-config";
import { ManifestAction } from "@cubica/contracts-manifest";
import { registerGameConfigData, registerGameResolvers } from "@/presenter/game-config-registry";

export type {
  FallbackMetricSpec,
  GameConfig,
  GameConfigData,
  GameConfigResolvers,
  ResolverFactory
} from "@/presenter/game-config";
export type { GameSession, RuntimeUiState } from "@/types/game-state";
export type {
  ActionEntry,
  SessionSnapshot
} from "@/lib/game-content-resolvers";

export {
  getFallbackActionEntries,
  readCanAdvance,
  readCardFlags,
  readCardObjects,
  readScreenId,
  readSelectedCardId,
  readStepIndex,
  readTeamFlags,
  readTeamSelection,
  resolveGameContent
} from "@/lib/game-content-resolvers";
export { createManifestActionAdapter } from "@/lib/manifest-action-adapter";
export { ManifestAction };

/**
 * Capability object passed to a project-local player plugin during activation.
 *
 * Capability object means an explicit set of functions the platform allows the
 * plugin to call. The plugin does not receive direct access to internal
 * registries and can only register documented contribution points.
 */
export interface PlayerPluginApi {
  registerGameConfigData(data: GameConfigData): void;
  registerGameConfigFactory<TGameState, TUiContent>(
    gameId: string,
    factory: ResolverFactory<TGameState, TUiContent>
  ): void;
}

/**
 * Runtime instance used by the current static composition root.
 *
 * The object intentionally stays tiny: ADR-039 will replace static imports with
 * session-scoped plugin bundles, but the contribution shape should remain the
 * same for migrated project-local plugins.
 */
export const playerPluginApi: PlayerPluginApi = {
  registerGameConfigData(data) {
    registerGameConfigData(data);
  },
  registerGameConfigFactory(gameId, factory) {
    registerGameResolvers(gameId, factory as ResolverFactory);
  }
};
