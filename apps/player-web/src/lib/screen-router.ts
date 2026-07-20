import type { ScreenRoutingEntry, GamePlayerUiContent } from "@cubica/contracts-manifest";
import type { PlayerLayoutMode } from "@/lib/player-layout-mode";
import { normalizePlayerLayoutMode } from "@/lib/player-layout-mode";

/**
 * Manifest-driven screen router — resolves UI screen key from runtime state.
 *
 * Screen routing priority (which resolver wins):
 *   1. Plugin's resolveScreenKey (game-specific logic in GameConfig)
 *   2. Manifest screenRouting entries (data-driven, this module)
 *   3. activeInfoId disambiguation
 *   4. Direct screenId lookup in uiContent.screens
 *   5. Design-time leftsidebar variant (uiContent.defaultLayoutMode)
 *
 * Layout is a design-time presentation choice (ADR-093): the game developer
 * declares it once in the UI manifest as `defaultLayoutMode`. The router matches
 * a routing entry's `conditions.layoutMode` against that declared value, NOT
 * against any server-side UI state. This is why picking between layout variants
 * of the same runtime screen (for example S1 topbar vs S1_LEFT leftsidebar) no
 * longer depends on `state.public.ui.activeScreen`.
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
 * The design-time layout the game declares (ADR-093). Games that do not declare
 * one are treated as `topbar`, preserving historical behavior.
 */
export function resolveDesignLayoutMode(
  uiContent: GamePlayerUiContent | undefined
): PlayerLayoutMode {
  return normalizePlayerLayoutMode(uiContent?.defaultLayoutMode) ?? "topbar";
}

/**
 * Resolves the UI manifest screen key based on runtime timeline state
 * and routing entries from the manifest.
 */
export function resolveScreenKey(
  screenRouting: ScreenRoutingEntry[] | undefined,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  uiContent: GamePlayerUiContent | undefined
): string | null {
  const designLayoutMode = resolveDesignLayoutMode(uiContent);

  // 1. Try routing entries from manifest
  if (screenRouting && screenRouting.length > 0) {
    for (const entry of screenRouting) {
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId, designLayoutMode)) {
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

  // 4. Design-time leftsidebar variant
  if (designLayoutMode === "leftsidebar") {
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
 *
 * `designLayoutMode` is the design-time layout declared by the UI manifest
 * (ADR-093); the entry's `layoutMode` condition is matched against it so an
 * alternate leftsidebar route cannot steal a normal topbar/info screen that has
 * the same screenId and stepIndex.
 */
function matchesConditions(
  entry: ScreenRoutingEntry,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  designLayoutMode: PlayerLayoutMode
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

  // layoutMode is a design-time selector (ADR-093).
  if (conditions.layoutMode !== undefined && normalizePlayerLayoutMode(conditions.layoutMode) !== designLayoutMode) {
    return false;
  }

  return true;
}

/**
 * Determines layout mode from routing entry (if found) or the design-time
 * default. This is a fallback used only when the selected screen does not
 * declare its own `layoutMode`; the presenter otherwise prefers the screen's
 * declared layout.
 */
export function resolveLayoutModeFromRouting(
  screenRouting: ScreenRoutingEntry[] | undefined,
  screenId: string | null,
  stepIndex: number | null,
  activeInfoId: string | null,
  designLayoutMode: PlayerLayoutMode,
  fallback: PlayerLayoutMode = "topbar"
): PlayerLayoutMode | null {
  if (screenRouting) {
    for (const entry of screenRouting) {
      if (matchesConditions(entry, screenId, stepIndex, activeInfoId, designLayoutMode)) {
        if (entry.conditions.layoutMode) {
          return normalizePlayerLayoutMode(entry.conditions.layoutMode) ?? fallback;
        }
      }
    }
  }

  return designLayoutMode ?? fallback;
}
