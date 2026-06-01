/**
 * Generic preview metadata for editor inspection.
 *
 * These attributes are emitted only when the player is opened in editor preview
 * mode. They describe rendered runtime UI objects without exposing authoring
 * fields or importing editor packages into player-web.
 */
import type { HTMLAttributes } from "react";
import type { GameUiComponent, GameUiComponentProps } from "@cubica/contracts-manifest";

export type PreviewElementAttributes = HTMLAttributes<HTMLElement> & {
  readonly "data-preview-entity-id"?: string;
  readonly "data-preview-runtime-pointer"?: string;
  readonly "data-preview-label"?: string;
  readonly "data-preview-semantic-role"?: string;
  readonly "data-preview-layer"?: string;
};

export function createPreviewElementAttributes(input: {
  readonly enabled?: boolean;
  readonly component: GameUiComponent;
  readonly runtimePointer: string | undefined;
  readonly layer?: string;
}): PreviewElementAttributes {
  if (input.enabled !== true || input.runtimePointer === undefined) {
    return {};
  }

  return {
    "data-preview-entity-id": buildPreviewEntityId(input.component, input.runtimePointer),
    "data-preview-runtime-pointer": input.runtimePointer,
    "data-preview-label": resolvePreviewLabel(input.component),
    "data-preview-semantic-role": input.component.type,
    "data-preview-layer": input.layer
  };
}

export function childRuntimePointer(parentPointer: string | undefined, childIndex: number): string | undefined {
  return parentPointer === undefined ? undefined : `${parentPointer}/children/${childIndex}`;
}

export function screenRootRuntimePointer(screenKey: string | undefined): string | undefined {
  return screenKey === undefined ? undefined : `/screens/${escapeJsonPointerSegment(screenKey)}/root`;
}

function buildPreviewEntityId(component: GameUiComponent, runtimePointer: string): string {
  return `${component.type}:${component.id ?? runtimePointer}`;
}

function resolvePreviewLabel(component: GameUiComponent): string {
  const props = component.props as GameUiComponentProps & {
    readonly caption?: string;
    readonly title?: string;
    readonly summary?: string;
    readonly text?: string;
    readonly alt?: string;
    readonly html?: string;
    readonly cssClass?: string;
  };

  return (
    component.id ??
    compactLabel(props.caption) ??
    compactLabel(props.title) ??
    compactLabel(props.summary) ??
    compactLabel(props.text) ??
    compactLabel(props.alt) ??
    compactLabel(props.cssClass) ??
    component.type
  );
}

function compactLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const compacted = value.replace(/\s+/gu, " ").trim();
  if (compacted === "") {
    return undefined;
  }

  return compacted.length <= 80 ? compacted : `${compacted.slice(0, 77)}...`;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
