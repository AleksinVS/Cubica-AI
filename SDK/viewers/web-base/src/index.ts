/**
 * @fileoverview Точка входа для @cubica/viewer-web-base.
 *
 * Этот пакет предоставляет базовые компоненты и утилиты для создания
 * веб-viewer игр на платформе Cubica.
 *
 * Основные экспорты:
 * - Типы: GameManifest, UIManifest, ViewerConfig, GameState
 * - Компоненты: ManifestLoader, StateManager, ActionRouter
 * - Утилиты: createViewer, validateManifest
 *
 * @example
 * ```tsx
 * import { ManifestLoader, StateManager, ActionRouter } from '@cubica/viewer-web-base';
 * import type { GameManifest, ViewerConfig } from '@cubica/viewer-web-base';
 *
 * const config: ViewerConfig = {
 *   gameManifestUrl: '/games/my-game/manifest.json',
 *   mode: 'online'
 * };
 *
 * function MyGameViewer() {
 *   return (
 *     <ManifestLoader config={config}>
 *       {({ gameManifest, uiManifest }) => (
 *         <StateManager initialState={gameManifest.initialState}>
 *           {({ state, dispatch }) => (
 *             <ActionRouter state={state} dispatch={dispatch}>
 *               {/* Render UI based on uiManifest *\/}
 *             </ActionRouter>
 *           )}
 *         </StateManager>
 *       )}
 *     </ManifestLoader>
 *   );
 * }
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types (Типы и интерфейсы)
// ─────────────────────────────────────────────────────────────────────────────

export type {
  // Game Manifest types
  GameManifest,
  GameManifestMeta,
  GameVariable,
  GameScene,
  // UI Manifest types
  UIManifest,
  UIScreen,
  UIComponent,
  // Viewer configuration
  ViewerConfig,
  // Game state
  GameState,
  // Manifest loading
  ManifestLoadResult,
  ManifestLoaderOptions,
  // Action routing
  ActionContext,
  ActionResult,
  ActionHandler,
  ActionHandlerRegistry,
  // State management
  StateSubscriber,
  IStateManager,
  // Re-exports from SDK
  ViewCommand,
  ViewResponse,
  ViewAction,
  ActionDispatcher,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Components (Компоненты)
// ─────────────────────────────────────────────────────────────────────────────

export { ManifestLoader, useManifestLoader } from './components/ManifestLoader';
export { StateManager, useStateManager, createStateManager } from './components/StateManager';
export { ActionRouter, useActionRouter, createActionRouter } from './components/ActionRouter';

// ─────────────────────────────────────────────────────────────────────────────
// Components barrel export (Все компоненты из одного места)
// ─────────────────────────────────────────────────────────────────────────────

export * from './components';
