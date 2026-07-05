/**
 * Layout and identifier constants for the editor workspace.
 *
 * These values were previously module-level constants inside
 * `editor-workspace.tsx`. They cover the fixed file identifiers used for the
 * embedded sample and Monaco marker ownership, the geometry used to lay out the
 * semantic React Flow graph, and the min/default/max sidebar widths used by the
 * resizable panels. Centralising them keeps the graph projection, the layout
 * hook, and the presentational panels in agreement on the same numbers.
 */
import { Position } from "@xyflow/react";

import type { SemanticFlowNode } from "./types.ts";

/** Virtual file path used when the editor falls back to the embedded sample. */
export const embeddedFilePath = "embedded-sample.game.authoring.json";

/** Marker owner key used when pushing diagnostics into the Monaco editor. */
export const editorMarkerOwner = "cubica-editor";

export const semanticNodeWidth = 250;
export const semanticNodeHeight = 132;
export const semanticHandleSize = 9;
export const semanticNodeRowsPerColumn = 8;
export const semanticNodeRowSpacing = 168;
export const semanticNodeColumnSpacing = 300;
export const semanticNodeDepthSpacing = 80;

export const defaultLeftSidebarWidth = 340;
export const defaultJsonSidebarWidth = 520;
export const leftSidebarWidthMin = 260;
export const leftSidebarWidthMax = 560;
export const jsonSidebarWidthMin = 360;
export const jsonSidebarWidthMax = 760;

/**
 * How long (ms) the inspect overlay stays in temporary "play" pass-through mode
 * after an Alt-assisted preview gesture, in case the parent window misses the
 * Alt keyup while focus is inside the preview iframe.
 */
export const temporaryPlayPassthroughMs = 900;

/** Fixed source/target handle geometry shared by every semantic graph node. */
export const semanticNodeHandles: NonNullable<SemanticFlowNode["handles"]> = [
  {
    type: "target",
    position: Position.Left,
    x: 0,
    y: (semanticNodeHeight - semanticHandleSize) / 2,
    width: semanticHandleSize,
    height: semanticHandleSize
  },
  {
    type: "source",
    position: Position.Right,
    x: semanticNodeWidth - semanticHandleSize,
    y: (semanticNodeHeight - semanticHandleSize) / 2,
    width: semanticHandleSize,
    height: semanticHandleSize
  }
];
