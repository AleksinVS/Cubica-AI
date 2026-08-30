import type { GameUiLayoutMode } from "@cubica/contracts-manifest";

/**
 * Runtime layout modes understood by the shared web player.
 *
 * JSON Schema remains the source of truth for serialized UI manifests. This
 * small client alias describes only resolved modes: `auto` is removed by the
 * Presenter before rendering, while `map-first` activates the spatial
 * workspace accepted in ADR-080.
 */
export type PlayerLayoutMode = Exclude<GameUiLayoutMode, "auto">;

/** Map authoring/runtime aliases to the bounded modes owned by player-web. */
export function normalizePlayerLayoutMode(value: unknown): PlayerLayoutMode | undefined {
  if (value === "leftsidebar" || value === "left-sidebar") {
    return "leftsidebar";
  }
  if (value === "topbar" || value === "map-first") {
    return value;
  }
  return undefined;
}
