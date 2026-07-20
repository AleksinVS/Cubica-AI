/**
 * Closed, high-contrast ownership palette for Cards Money Trains markers.
 *
 * Color IDs come from the game's bounded setup parameter. Keeping the mapping
 * inside the game plugin avoids leaking this game's visual vocabulary into the
 * generic Player host. Unknown or historic IDs use the vehicle-kind fallback.
 */

const TEAM_MARKER_COLORS = {
  cobalt: "#2256a5",
  orange: "#a94f16",
  emerald: "#126b4c",
  magenta: "#9b286d",
  cyan: "#116b80",
  amber: "#8a5a00",
  violet: "#6139ad",
  lime: "#587417",
  rose: "#a9334b",
  navy: "#263b68",
  coral: "#a94332",
  charcoal: "#353535"
} as const;

/** Resolve one bounded setup color without trusting arbitrary CSS from state. */
export function teamMarkerColor(
  colorId: string | undefined,
  fallback: string
): string {
  return colorId && Object.prototype.hasOwnProperty.call(TEAM_MARKER_COLORS, colorId)
    ? TEAM_MARKER_COLORS[colorId as keyof typeof TEAM_MARKER_COLORS]
    : fallback;
}

/** Exposed only to focused tests that prove every accepted setup id is mapped. */
export const TEAM_MARKER_COLOR_IDS = Object.freeze(Object.keys(TEAM_MARKER_COLORS));
