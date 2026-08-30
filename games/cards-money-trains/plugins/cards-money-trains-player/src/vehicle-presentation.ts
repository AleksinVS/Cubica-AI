/**
 * Pure presentation helpers for confirmed public vehicle state.
 *
 * Keeping the durable wagon glyph outside Phaser makes it testable without
 * constructing a canvas or duplicating any gameplay rule in the browser.
 */

import type { BoardVehicleView } from "./board-state.ts";

/** Keep a loaded wagon visibly distinct after its short cargo animation ends. */
export const vehicleGlyph = (vehicle: BoardVehicleView): string =>
  vehicle.kind === "locomotive" ? "◆" : vehicle.cargoId ? "▣" : "■";
