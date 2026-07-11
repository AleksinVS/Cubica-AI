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
import {
  registerPhaserSceneFactory,
  type PhaserSceneFactory
} from "@/plugins/phaser-scene-registry";

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
export type {
  AccessibleBoardAction,
  InteractiveBoardSceneHandle,
  InteractiveBoardSessionSnapshot,
  PhaserSceneContext,
  PhaserSceneFactory
} from "@/plugins/phaser-scene-registry";
export type { GameAssetResolver } from "@/lib/game-asset-resolver";

// Generic session-state accessors only. Game-specific readers (team flags,
// card objects, team selection, selected card id) intentionally do NOT live
// here anymore — per ADR-055 §5 they moved into the owning game plugin
// (games/antarctica/plugins/antarctica-player/src/state-resolvers.ts). The
// platform exposes readPublicState/readSecretState so plugins can read their
// own state buckets and cast to their own state types.
export {
  getFallbackActionEntries,
  readCanAdvance,
  readPublicState,
  readScreenId,
  readSecretState,
  readStepIndex,
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
  /**
   * Registers a game-owned scene while player-web retains Phaser ownership.
   * The returned function removes only this exact registration.
   */
  registerPhaserSceneFactory(
    gameId: string,
    factory: PhaserSceneFactory
  ): () => void;
}

/**
 * Runtime instance used by the current static composition root.
 *
 * The object intentionally stays tiny: ADR-039 will replace static imports with
 * session-scoped plugin bundles, but the contribution shape should remain the
 * same for migrated project-local plugins.
 */
export function createScopedPlayerPluginApi(
  collectDisposer?: (dispose: () => void) => void
): PlayerPluginApi {
  return {
    registerGameConfigData(data) {
      registerGameConfigData(data);
    },
    registerGameConfigFactory(gameId, factory) {
      registerGameResolvers(gameId, factory as ResolverFactory);
    },
    registerPhaserSceneFactory(gameId, factory) {
      const dispose = registerPhaserSceneFactory(gameId, factory);
      collectDisposer?.(dispose);
      return dispose;
    }
  };
}

/** Default unscoped facade retained for direct/static plugin activation. */
export const playerPluginApi: PlayerPluginApi = createScopedPlayerPluginApi();
