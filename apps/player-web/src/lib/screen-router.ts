import type { ScreenRoutingEntry, GamePlayerUiContent } from "@cubica/contracts-manifest";

/**
 * Manifest-driven screen router — resolves UI screen key from runtime state.
 *
 * Screen routing priority (which resolver wins):
 *   1. Plugin's resolveScreenKey (game-specific logic in GameConfig)
 *   2. Manifest screenRouting entries (data-driven, this module)
 *   3. Direct screenId lookup in uiContent.screens
 *   4. activeInfoId disambiguation
 *   5. runtimeUi.activeScreen override
 *
 * Currently (Antarctica), the plugin's resolveScreenKey always wins because
 * GamePresenter calls it directly. This module provides a data-driven
 * alternative for future games that don't need custom routing logic.
 * When a game opts into manifest-driven routing, GamePresenter should call
 * resolveScreenKey (this module) instead of the plugin method.
 *
 * @see GamePresenter.playerState (current routing call site)
 * @see GameConfigResolvers.resolveScreenKey (plugin override)
 */

/**
 * Разрешает ключ экрана UI-манифеста на основе состояния runtime
 * и таблицы маршрутизации из манифеста.
 */
export function resolveScreenKey(
  screenRouting: ScreenRoutingEntry[] | undefined,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  runtimeUi: { activeScreen?: string },
  uiContent: GamePlayerUiContent | undefined
): string | null {
  // 1. Попробовать routing entries из манифеста
  if (screenRouting && screenRouting.length > 0) {
    for (const entry of screenRouting) {
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId)) {
        // Проверить, что целевой экран существует в манифесте
        if (uiContent?.screens[entry.screenKey]) {
          return entry.screenKey;
        }
      }
    }
  }

  // 2. Direct screenId lookup
  if (screenId && uiContent?.screens[screenId]) {
    return screenId;
  }

  // 3. Info screen disambiguation
  if (activeInfoId && uiContent?.screens[activeInfoId]) {
    return activeInfoId;
  }

  // 4. Layout override через runtimeUi
  if (runtimeUi.activeScreen === "left-sidebar" && uiContent?.screens["S1_LEFT"]) {
    return "S1_LEFT";
  }

  return null;
}

/**
 * Проверяет, совпадают ли условия routing entry с текущим состоянием.
 */
function matchesConditions(
  entry: ScreenRoutingEntry,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null
): boolean {
  const { conditions } = entry;

  // screenId должен совпадать (если указан)
  if (conditions.screenId !== undefined && conditions.screenId !== screenId) {
    return false;
  }

  // stepIndex — точное совпадение (если указан)
  if (conditions.stepIndex !== undefined && conditions.stepIndex !== stepIndex) {
    return false;
  }

  // stepIndexRange — диапазон (если указан)
  if (conditions.stepIndexRange !== undefined) {
    if (stepIndex === null) {
      return false;
    }
    if (stepIndex < conditions.stepIndexRange.from || stepIndex >= conditions.stepIndexRange.to) {
      return false;
    }
  }

  // activeInfoId — если указан, должен совпадать
  if (conditions.activeInfoId !== undefined && conditions.activeInfoId !== activeInfoId) {
    return false;
  }

  return true;
}

/**
 * Определяет layout mode на основе routing entry (если найдено)
 * или runtimeUi.activeScreen.
 */
export function resolveLayoutModeFromRouting(
  screenRouting: ScreenRoutingEntry[] | undefined,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  runtimeUi: { activeScreen?: string },
  fallback: "leftsidebar" | "topbar" = "topbar"
): "leftsidebar" | "topbar" | null {
  if (screenRouting) {
    for (const entry of screenRouting) {
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId)) {
        if (entry.conditions.layoutMode) {
          return entry.conditions.layoutMode;
        }
      }
    }
  }

  // Fallback: runtimeUi.activeScreen
  if (runtimeUi.activeScreen === "left-sidebar") {
    return "leftsidebar";
  }
  if (runtimeUi.activeScreen === "topbar") {
    return "topbar";
  }

  return null;
}