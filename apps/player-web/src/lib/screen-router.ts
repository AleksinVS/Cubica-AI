import type { ScreenRoutingEntry, GamePlayerUiContent } from "@cubica/contracts-manifest";

/**
 * Manifest-driven screen router — resolves UI screen key from runtime state.
 *
 * Screen routing priority (which resolver wins):
 *   1. Plugin's resolveScreenKey (game-specific logic in GameConfig)
 *   2. Manifest screenRouting entries (data-driven, this module)
 *   3. activeInfoId disambiguation
 *   4. Direct screenId lookup in uiContent.screens
 *   5. runtimeUi.activeScreen override (maps "left-sidebar" → leftsidebar layout)
 *
 * When a game plugin provides resolveScreenKey, the GamePresenter calls it
 * directly. When the plugin omits resolveScreenKey, the GamePresenter calls
 * resolveScreenKey from this module, using the screenRouting data from the
 * UI manifest. This makes screen routing fully data-driven for games that
 * don't need custom routing logic.
 *
 * @see GamePresenter.playerState (current routing call site)
 * @see GameConfigResolvers.resolveScreenKey (plugin override)
 */

/**
 * Resolves the UI manifest screen key based on runtime state
 * and routing entries from the manifest.
 */
export function resolveScreenKey(
  screenRouting: ScreenRoutingEntry[] | undefined,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  runtimeUi: { activeScreen?: string },
  uiContent: GamePlayerUiContent | undefined
): string | null {
  // 1. Try routing entries from manifest
  if (screenRouting && screenRouting.length > 0) {
    for (const entry of screenRouting) {
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId, runtimeUi)) {
        // Check that the target screen exists in the manifest
        if (uiContent?.screens[entry.screenKey]) {
          return entry.screenKey;
        }
      }
    }
  }

  // 2. Info screen disambiguation
  if (activeInfoId && uiContent?.screens[activeInfoId]) {
    return activeInfoId;
  }

  // 3. Direct screenId lookup
  if (screenId && uiContent?.screens[screenId]) {
    return screenId;
  }

  // 4. Layout override via runtimeUi
  if (runtimeUi.activeScreen === "left-sidebar") {
    // Check for a left-sidebar variant screen
    const leftScreenKey = findLeftSidebarScreen(uiContent);
    if (leftScreenKey) {
      return leftScreenKey;
    }
  }

  return null;
}

/**
 * Finds a left-sidebar variant screen key in the UI manifest.
 * Checks common naming patterns: S1_LEFT, {screenId}_LEFT.
 */
function findLeftSidebarScreen(uiContent: GamePlayerUiContent | undefined): string | null {
  if (!uiContent) return null;
  // Check for a generic left-sidebar variant
  if (uiContent.screens["S1_LEFT"]) return "S1_LEFT";
  return null;
}

/**
 * Checks whether routing entry conditions match the current state.
 */
function matchesConditions(
  entry: ScreenRoutingEntry,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  runtimeUi: { activeScreen?: string } = {}
): boolean {
  const { conditions } = entry;

  // screenId must match (if specified)
  if (conditions.screenId !== undefined && conditions.screenId !== screenId) {
    return false;
  }

  // stepIndex — exact match (if specified)
  if (conditions.stepIndex !== undefined && conditions.stepIndex !== stepIndex) {
    return false;
  }

  // stepIndexRange — range match (if specified)
  if (conditions.stepIndexRange !== undefined) {
    if (stepIndex === null) {
      return false;
    }
    if (stepIndex < conditions.stepIndexRange.from || stepIndex >= conditions.stepIndexRange.to) {
      return false;
    }
  }

  // activeInfoId — must match if specified
  if (conditions.activeInfoId !== undefined && conditions.activeInfoId !== activeInfoId) {
    return false;
  }

  // layoutMode is a runtime UI selector. Without this check, an alternate
  // left-sidebar route can steal a normal topbar/info screen that has the same
  // screenId and stepIndex.
  if (conditions.layoutMode !== undefined && conditions.layoutMode !== normalizeActiveScreen(runtimeUi.activeScreen)) {
    return false;
  }

  return true;
}

function normalizeActiveScreen(activeScreen: string | undefined): "leftsidebar" | "topbar" | undefined {
  if (activeScreen === "left-sidebar" || activeScreen === "leftsidebar") {
    return "leftsidebar";
  }
  if (activeScreen === "topbar") {
    return "topbar";
  }
  return undefined;
}

/**
 * Determines layout mode from routing entry (if found)
 * or runtimeUi.activeScreen.
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
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId, runtimeUi)) {
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

  return fallback;
}
