/**
 * @fileoverview Экспорт всех компонентов viewer-web-base.
 *
 * Компоненты:
 * - ManifestLoader — загрузка игровых манифестов (GameManifest, UIManifest)
 * - StateManager — управление состоянием игры
 * - ActionRouter — маршрутизация и обработка действий
 */

// ─────────────────────────────────────────────────────────────────────────────
// ManifestLoader (Загрузчик манифестов)
// ─────────────────────────────────────────────────────────────────────────────

export {
  ManifestLoader,
  useManifestLoader,
  useManifestContext,
  clearManifestCache,
  invalidateManifest,
  type ManifestLoaderStatus,
  type ManifestLoaderResult,
  type ManifestLoaderProps,
} from './ManifestLoader';

// ─────────────────────────────────────────────────────────────────────────────
// StateManager (Менеджер состояния)
// ─────────────────────────────────────────────────────────────────────────────

export {
  StateManager,
  useStateManager,
  useStateContext,
  createStateManager,
  type StateManagerResult,
  type StateManagerProps,
} from './StateManager';

// ─────────────────────────────────────────────────────────────────────────────
// ActionRouter (Маршрутизатор действий)
// ─────────────────────────────────────────────────────────────────────────────

export {
  ActionRouter,
  useActionRouter,
  useActionRouterContext,
  createActionRouter,
  type ActionRouterResult,
  type ActionRouterProps,
  type CreateActionRouterOptions,
} from './ActionRouter';
