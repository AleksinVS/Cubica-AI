/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced by scripts/manifest-tools/generate-contracts-types.cjs from the
 * canonical OpenAPI component in docs/architecture/runtime-api-openapi.yaml (ADR-025, ADR-056).
 * JSON Schema is the single source of truth; regenerate with:
 *   node scripts/manifest-tools/generate-contracts-types.cjs --job=editor-prototype-preview-response
 *
 * CI (scripts/ci/validate-contracts-schema-parity.js) fails if this file
 * drifts from the schema. Type/field changes must be made in the schema.
 */

/**
 * Описание UI-компонента в декларативном формате Hybrid SDUI.
 *
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "uiComponent".
 */
export type UiComponent = {
  [k: string]: unknown;
} & {
  /**
   * Тип компонента: стандартный (screenComponent, buttonComponent и др.) или кастомный (widget:inventory, extension:rpg-stats).
   */
  type: UiComponentType | string;
  /**
   * Optional stable identifier of this component instance.
   */
  id?: string;
  /**
   * Optional conditional rendering expression evaluated by the presenter.
   */
  if?: string;
  /**
   * Component-specific properties, may include data bindings like {{state.public.hp}}.
   */
  props?: {
    workspaceSlot?: WorkspaceSlot;
  };
  style?: UiStyle;
  actions?: UiActions;
  /**
   * Optional reference to a layout entry that describes visual design for this component. DEPRECATED: Use design_artifact_id.
   */
  layout_id?: string;
  /**
   * ID дизайн-артефакта из секции design_artifacts.registry, описывающего визуальный дизайн этого компонента.
   */
  design_artifact_id?: string;
  /**
   * Optional identifier of a UI-level controller in the UI library.
   */
  controller_id?: string;
  children?: UiComponent[];
  designImageRef?: string;
  itemTemplate?: UiItemTemplate;
  visualMode?: "image" | "style" | "auto";
};
/**
 * Стандартные типы UI-компонентов платформы Cubica. Viewer должен поддерживать все перечисленные типы.
 *
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "uiComponentType".
 */
export type UiComponentType =
  | "screenComponent"
  | "areaComponent"
  | "cardComponent"
  | "gameVariableComponent"
  | "buttonComponent"
  | "textComponent"
  | "richTextComponent"
  | "inputComponent"
  | "imageComponent"
  | "helperComponent"
  | "interactiveBoardSurface";
/**
 * Semantic placement owned by the generic map-first workspace. Games select a role; the player decides its physical position and stacking.
 *
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "workspaceSlot".
 */
export type WorkspaceSlot =
  "board" | "status" | "primary-panel" | "context-panel" | "action-tray" | "floating-controls" | "overlay";

export interface EditorPrototypePreviewResponse {
  component: UiComponent;
}
/**
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "uiStyle".
 */
export interface UiStyle {
  width?: string | number;
  height?: string | number;
  padding?: string | number;
  margin?: string | number;
  background?: string;
  color?: string;
  fontSize?: string | number;
  fontWeight?: string | number;
  border?: string;
  borderRadius?: string | number;
  gap?: string | number;
  flex?: number | string;
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  justifyContent?: string;
  alignItems?: string;
  [k: string]: unknown;
}
/**
 * UI-level event handlers mapping events like 'onClick' to Presenter commands or explicit runtime action requests.
 *
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "uiActions".
 */
export interface UiActions {
  /**
   * This interface was referenced by `UiActions`'s JSON-Schema definition
   * via the `patternProperty` "^on[A-Z][a-zA-Z]+$".
   */
  [k: string]: {
    /**
     * Identifier of the command to send to the Presenter, for example showPanel, closePanel, advance or requestServer.
     */
    command: string;
    /**
     * Optional JSON payload with parameters for this invocation.
     */
    payload?: {};
  };
}
/**
 * Declarative collection iteration for manifest-rendered components.
 *
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "uiItemTemplate".
 */
export interface UiItemTemplate {
  collection: string;
  filter?: string;
  itemKey: string;
}
/**
 * This interface was referenced by `EditorPrototypePreviewResponse`'s JSON-Schema
 * via the `definition` "interactiveBoardSurfaceProps".
 */
export interface InteractiveBoardSurfaceProps {
  sceneId: string;
  /**
   * Ширина логической координатной плоскости сцены, а не физического canvas или окна браузера. Клиент обязан ограничивать размер поверхности вывода независимо от этого значения.
   */
  designWidth?: number;
  /**
   * Высота логической координатной плоскости сцены, а не физического canvas или окна браузера. Клиент обязан ограничивать размер поверхности вывода независимо от этого значения.
   */
  designHeight?: number;
  accessibleLabel?: string;
  interactions?: {
    modeActionId?: string;
    selectActionId?: string;
  };
}
