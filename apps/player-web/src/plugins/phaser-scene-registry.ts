/**
 * Session-safe registries for game-owned Phaser scene factories and their
 * engine-independent accessible action projections.
 *
 * Phaser itself belongs to player-web and is injected into a project-local
 * plugin. A plugin registers only a scene factory, so it cannot pull a second
 * engine version into its bundle or reach player-web internals. Registrations
 * return an ownership-aware disposer: an older preview bundle cannot remove a
 * newer bundle's factory when React tears the older bundle down.
 */

import type { PlayerFacingContent } from "@cubica/contracts-manifest";

import type { GameSession } from "@/types/game-state";
import type { GameAssetResolver } from "@/lib/game-asset-resolver";

/** One complete board action exposed outside the visual canvas. */
export interface AccessibleBoardAction {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly actionId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
}

/** Player-facing session data supplied to both the scene and DOM controls. */
export type InteractiveBoardSessionSnapshot = GameSession;

/**
 * Projects server-authorized field actions without loading Phaser.
 *
 * The provider may only translate the player-facing snapshot into labels,
 * parameters and disabled reasons. Runtime remains the authority that decides
 * whether the action is legal when it is submitted.
 */
export type AccessibleBoardActionsProvider = (
  session: InteractiveBoardSessionSnapshot
) => readonly AccessibleBoardAction[];

/** Capabilities available to a game-owned scene factory. */
export interface PhaserSceneContext {
  /** Platform-owned Phaser module. Game plugins must not import Phaser. */
  readonly Phaser: typeof import("phaser");
  /** Stable scene identifier declared by the UI manifest component. */
  readonly sceneId: string;
  /** Player-facing content; secret runtime state is never exposed here. */
  readonly content: PlayerFacingContent;
  /** Authoritative snapshot at mount time. */
  readonly session: InteractiveBoardSessionSnapshot;
  /** Game-owned image URLs resolved by stable asset id, never repository path. */
  readonly assets: GameAssetResolver;
  /** True while Presenter is waiting for the previous authoritative snapshot. */
  readonly isInteractionPending: () => boolean;
  /** Dispatches through the normal runtime path and rejects on refusal. */
  readonly dispatchAction: (
    actionId: string,
    params?: Record<string, unknown>
  ) => Promise<void>;
}

/** Scene plus lifecycle callbacks owned by the registering game plugin. */
export interface InteractiveBoardSceneHandle {
  /** Must be an instance of the injected `context.Phaser.Scene`. */
  readonly scene: unknown;
  /** Applies a newer authoritative snapshot without recreating the canvas. */
  updateSession(session: InteractiveBoardSessionSnapshot): void;
  /** Releases plugin-owned listeners and transient scene resources. */
  destroy(): void;
  /** Return the world to the complete, bounded overview. */
  fitToView?(): void;
  /** Apply a relative camera zoom; values above one zoom in. */
  zoomBy?(factor: number): void;
  /**
   * Returns complete actions for keyboard and assistive-technology users.
   *
   * The host renders these as ordinary buttons. The game plugin derives them
   * from the same public projection used for visual highlights, keeping the
   * generic renderer free of game-specific node, road, or vehicle rules.
   *
   * @deprecated Register an `AccessibleBoardActionsProvider` so DOM controls
   * remain available when Phaser cannot initialize. Kept for API 2.0 bundles.
   */
  getAccessibleActions?(
    session: InteractiveBoardSessionSnapshot
  ): readonly AccessibleBoardAction[];
}

export type PhaserSceneFactory = (
  context: PhaserSceneContext
) => InteractiveBoardSceneHandle;

type Registration = {
  readonly token: symbol;
  readonly factory: PhaserSceneFactory;
};

type AccessibleActionsRegistration = {
  readonly token: symbol;
  readonly provider: AccessibleBoardActionsProvider;
};

const registry = new Map<string, Registration>();
const accessibleActionsRegistry = new Map<string, AccessibleActionsRegistration>();

/** Registers one factory and returns a disposer scoped to this registration. */
export function registerPhaserSceneFactory(
  gameId: string,
  factory: PhaserSceneFactory
): () => void {
  const token = Symbol(gameId);
  registry.set(gameId, { token, factory });

  return () => {
    if (registry.get(gameId)?.token === token) {
      registry.delete(gameId);
    }
  };
}

/** Resolves the active scene factory for a game, if its plugin contributed one. */
export function resolvePhaserSceneFactory(
  gameId: string
): PhaserSceneFactory | undefined {
  return registry.get(gameId)?.factory;
}

/**
 * Registers a pure DOM-action projection independently from the Phaser scene.
 *
 * Ownership-aware disposal mirrors scene registration so an older preview
 * bundle cannot remove a newer provider during hot reload.
 */
export function registerAccessibleBoardActionsProvider(
  gameId: string,
  provider: AccessibleBoardActionsProvider
): () => void {
  const token = Symbol(gameId);
  accessibleActionsRegistry.set(gameId, { token, provider });

  return () => {
    if (accessibleActionsRegistry.get(gameId)?.token === token) {
      accessibleActionsRegistry.delete(gameId);
    }
  };
}

/** Resolves the action provider that remains usable when Phaser cannot start. */
export function resolveAccessibleBoardActionsProvider(
  gameId: string
): AccessibleBoardActionsProvider | undefined {
  return accessibleActionsRegistry.get(gameId)?.provider;
}
