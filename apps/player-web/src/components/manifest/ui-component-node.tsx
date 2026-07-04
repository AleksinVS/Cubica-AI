import React from "react";
import type {
  GameUiComponent,
  GameUiAreaComponentProps,
  GameUiButtonComponentProps,
  GameUiCardComponentProps,
  GameUiGameVariableComponentProps,
  GameUiScreenComponentProps,
  GameUiRichTextComponentProps,
  GameUiImageComponentProps,
  GameUiDesignArtifactRef,
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import { appendClassName } from "@/lib/classname-utils";
import { resolveAreaCssClass } from "@/lib/layout-helpers";
import { resolveExpressions } from "@/lib/expression-resolver";
import { GameVariableComponent } from "./game-variable-component";
import { CardComponent } from "./card-component";
import { ButtonComponent } from "./button-component";
import { RichTextComponent } from "./rich-text-component";
import { ImageComponent } from "./image-component";
import {
  childRuntimePointer,
  createPreviewElementAttributes
} from "./preview-metadata";

const FORWARD_NAV_BUTTON_ID = "nav-right";
const ADVANCE_BUTTON_IDS = new Set(["btn-advance", "btn-finish"]);

type PreviewRuntimePointerComponent = GameUiComponent & {
  /**
   * Runtime-only override for editor preview mapping.
   *
   * This field is intentionally not part of the serialized UI manifest schema.
   * SafeModeRenderer builds some screens from gameplay state, not from
   * /screens/* UI nodes, and uses this override to keep preview selections
   * linked to the gameplay content that generated the visible element.
   */
  readonly previewRuntimePointer?: string;
};

/**
 * Переносит явное действие продолжения на стрелку "Вперед".
 *
 * UI-манифесты старого вида могут содержать отдельную кнопку "Продолжить"
 * рядом со стрелками навигации. Runtime-смысл у нее тот же: выполнить
 * следующий action (серверное игровое действие). Чтобы экран переходил
 * через навигационную стрелку, рендерер убирает отдельную кнопку и назначает
 * ее действие на nav-right.
 */
function moveAdvanceActionToForwardNavigation(children: Array<GameUiComponent>): Array<GameUiComponent> {
  const advanceIndex = children.findIndex(
    (child) => child.type === "buttonComponent" && child.id && ADVANCE_BUTTON_IDS.has(child.id) && child.actions?.onClick
  );
  const forwardIndex = children.findIndex(
    (child) => child.type === "buttonComponent" && child.id === FORWARD_NAV_BUTTON_ID
  );

  if (advanceIndex === -1 || forwardIndex === -1) {
    return children;
  }

  const advanceButton = children[advanceIndex];
  const advanceProps = (advanceButton.props ?? {}) as GameUiButtonComponentProps;

  return children.flatMap((child, index) => {
    if (index === advanceIndex) {
      return [];
    }

    if (index === forwardIndex) {
      const forwardProps = (child.props ?? {}) as GameUiButtonComponentProps;
      // WHY: only propagate `disabled` when the original advance action
      // explicitly declared one. Previously this always wrote
      // `disabled: advanceProps.disabled === true`, which forces
      // `disabled: false` onto the merged nav-right button whenever the
      // advance action had no `disabled` field at all — silently
      // overwriting any `disabled` the forward-nav button already had
      // (e.g. from a manifest-declared "not yet allowed to advance" rule)
      // with a hardcoded `false`. Spreading `forwardProps` first and only
      // adding `disabled` when it was explicitly set on the advance action
      // preserves the forward button's own disabled state in all other
      // cases.
      const mergedProps: GameUiButtonComponentProps = { ...forwardProps };
      if (typeof advanceProps.disabled === "boolean") {
        mergedProps.disabled = advanceProps.disabled;
      }
      return [{
        ...child,
        props: mergedProps,
        actions: advanceButton.actions,
      }];
    }

    return [child];
  });
}

/**
 * Резолвит designImageRef против designArtifacts registry.
 * Возвращает URL изображения или undefined, если референс не найден.
 */
function resolveDesignImage(
  designImageRef: string | undefined,
  designArtifacts: Record<string, GameUiDesignArtifactRef> | undefined
): string | undefined {
  if (!designImageRef || !designArtifacts) return undefined;
  const artifact = designArtifacts[designImageRef];
  if (!artifact) return undefined;
  return artifact.sourceRef?.file;
}

/**
 * Рекурсивно рендерит дерево UI-компонентов из манифеста.
 * Поддерживает: screenComponent, areaComponent, gameVariableComponent,
 * cardComponent, buttonComponent, richTextComponent, imageComponent.
 *
 * visualMode определяет способ рендеринга:
 * - "style" (default): CSS-классы и inline-стили
 * - "image": дизайн-макет как background-image через designImageRef
 * - "auto": image если designImageRef доступен, иначе style
 *
 * При наличии itemTemplate итерирует по коллекции из gameState,
 * создавая локальный контекст для каждого элемента.
 */
export function UiComponentNode({
  component,
  metrics,
  onAction,
  screenKey,
  layoutMode,
  metricBackgroundImages,
  gameState,
  localContext,
  parentVisualMode,
  designArtifacts,
  editorPreviewMode = false,
  runtimePointer,
}: {
  component: GameUiComponent;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: "leftsidebar" | "topbar";
  metricBackgroundImages?: Record<string, string>;
  /** Полное состояние игры для разрешения выражений и itemTemplate. */
  gameState?: Record<string, unknown>;
  /** Локальный контекст для itemTemplate (переменные текущего элемента). */
  localContext?: Record<string, unknown>;
  /** Унаследованный визуальный режим от родителя. */
  parentVisualMode?: "image" | "style" | "auto";
  /** Registry дизайн-артефактов для разрешения designImageRef при visualMode="image". */
  designArtifacts?: Record<string, GameUiDesignArtifactRef>;
  /** Enables runtime pointer metadata for editor preview inspection. */
  editorPreviewMode?: boolean;
  /** Runtime JSON Pointer for the current component in the generated UI manifest. */
  runtimePointer?: string;
}) {
  if (component.if) {
    const condition = resolveExpressions(component.if, gameState ?? {}, localContext);
    if (!isTruthyCondition(condition)) {
      return null;
    }
  }

  const children = moveAdvanceActionToForwardNavigation(component.children ?? []);
  const effectiveVisualMode = component.visualMode ?? parentVisualMode ?? "auto";
  const componentRuntimePointer = resolvePreviewRuntimePointer(component, runtimePointer);
  const previewAttributes = createPreviewElementAttributes({
    enabled: editorPreviewMode,
    component,
    runtimePointer: componentRuntimePointer,
    layer: screenKey
  });

  // visualMode resolution: "auto" → "image" if designImageRef available, else "style"
  const resolvedDesignImage = resolveDesignImage(component.designImageRef, designArtifacts);
  const isImageMode = effectiveVisualMode === "image" || (effectiveVisualMode === "auto" && !!resolvedDesignImage);

  // itemTemplate: итерация по коллекции с локальным контекстом
  if (component.itemTemplate && gameState) {
    const collection = resolveExpressions(
      component.itemTemplate.collection,
      gameState,
      localContext
    );
    const items = Array.isArray(collection) ? collection : [];
    const itemKey = component.itemTemplate.itemKey;

    const itemContent = (
      <>
        {items.map((item, index) => {
          // Фильтрация: пропустить элементы, не проходящие filter-выражение
          if (component.itemTemplate!.filter) {
            const filterResult = resolveExpressions(
              component.itemTemplate!.filter,
              gameState,
              { ...localContext, [itemKey]: item }
            );
            if (!filterResult) return null;
          }

          const itemLocalContext: Record<string, unknown> = {
            ...localContext,
            [itemKey]: item,
          };

          return (
            <React.Fragment key={`${component.id ?? "item"}-${index}`}>
              {children.map((child, childIndex) => (
                <UiComponentNode
                  key={childIndex}
                  component={child}
                  metrics={metrics}
                  onAction={onAction}
                  screenKey={screenKey}
                  layoutMode={layoutMode}
                  metricBackgroundImages={metricBackgroundImages}
                  gameState={gameState}
                  localContext={itemLocalContext}
                  parentVisualMode={effectiveVisualMode}
                  designArtifacts={designArtifacts}
                  editorPreviewMode={editorPreviewMode}
                  runtimePointer={childRuntimePointer(componentRuntimePointer, childIndex)}
                />
              ))}
            </React.Fragment>
          );
        })}
      </>
    );

    // Если itemTemplate находится на areaComponent или screenComponent,
    // обернуть результат в контейнерный div с CSS-классом.
    // Для других типов компонентов — вернуть как фрагмент без обёртки.
    if (component.type === "areaComponent" || component.type === "screenComponent") {
      const props = component.props as GameUiAreaComponentProps;
      const cssClass = component.type === "areaComponent"
        ? resolveAreaCssClass(props.cssClass, screenKey, layoutMode)
        : (props as GameUiScreenComponentProps).cssClass ?? "";
      const areaBgImage = isImageMode && resolvedDesignImage ? resolvedDesignImage : undefined;
      return (
        <div
          {...previewAttributes}
          className={component.type === "areaComponent" ? `game-area ${cssClass}` : `game-screen ${cssClass}`}
          style={areaBgImage ? { backgroundImage: `url(${areaBgImage})` } : undefined}
        >
          {itemContent}
        </div>
      );
    }

    return itemContent;
  }

  switch (component.type) {
    case "screenComponent": {
      const props = component.props as GameUiScreenComponentProps;
      const cssClass =
        layoutMode === "topbar"
          ? appendClassName(props.cssClass, "topbar-screen-shell")
          : layoutMode === "leftsidebar"
            ? appendClassName(props.cssClass, "leftsidebar-screen")
            : props.cssClass ?? "";
      // visualMode="image": use design mockup as background
      const bgImage = isImageMode && resolvedDesignImage
        ? resolvedDesignImage
        : props.backgroundImage;
      return (
        <div
          {...previewAttributes}
          className={`game-screen ${cssClass}`}
          style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
        >
          {(cssClass.includes("topbar-screen-shell") || cssClass.includes("info-screen-shell")) && (
            <div className="additional-background" />
          )}
          {children.map((child, index) => (
            <UiComponentNode
              key={index}
              component={child}
              metrics={metrics}
              onAction={onAction}
              screenKey={screenKey}
              layoutMode={layoutMode}
              metricBackgroundImages={metricBackgroundImages}
              gameState={gameState}
              localContext={localContext}
              parentVisualMode={effectiveVisualMode}
              designArtifacts={designArtifacts}
              editorPreviewMode={editorPreviewMode}
              runtimePointer={childRuntimePointer(componentRuntimePointer, index)}
            />
          ))}
        </div>
      );
    }

    case "areaComponent": {
      const props = component.props as GameUiAreaComponentProps;
      // visualMode="image": use design mockup as background for area
      const areaBgImage = isImageMode && resolvedDesignImage ? resolvedDesignImage : undefined;
      return (
        <div
          {...previewAttributes}
          className={`game-area ${resolveAreaCssClass(props.cssClass, screenKey, layoutMode)}`}
          style={areaBgImage ? { backgroundImage: `url(${areaBgImage})` } : undefined}
        >
          {children.map((child, index) => (
            <UiComponentNode
              key={index}
              component={child}
              metrics={metrics}
              onAction={onAction}
              screenKey={screenKey}
              layoutMode={layoutMode}
              metricBackgroundImages={metricBackgroundImages}
              gameState={gameState}
              localContext={localContext}
              parentVisualMode={effectiveVisualMode}
              designArtifacts={designArtifacts}
              editorPreviewMode={editorPreviewMode}
              runtimePointer={childRuntimePointer(componentRuntimePointer, index)}
            />
          ))}
        </div>
      );
    }

    case "gameVariableComponent": {
      const props = component.props as GameUiGameVariableComponentProps;
      return (
        <GameVariableComponent
          component={component as GameUiComponent<GameUiGameVariableComponentProps>}
          metrics={metrics}
          gameState={gameState}
          backgroundImage={props.backgroundImage}
          layoutMode={layoutMode}
          metricBackgroundImages={metricBackgroundImages}
          previewAttributes={previewAttributes}
        />
      );
    }

    case "cardComponent": {
      return (
        <CardComponent
          component={component as GameUiComponent<GameUiCardComponentProps>}
          onAction={onAction}
          localContext={localContext}
          gameState={gameState}
          previewAttributes={previewAttributes}
        />
      );
    }

    case "buttonComponent": {
      return (
        <ButtonComponent
          component={component as GameUiComponent<GameUiButtonComponentProps>}
          onAction={onAction}
          layoutMode={layoutMode}
          localContext={localContext}
          gameState={gameState}
          previewAttributes={previewAttributes}
        />
      );
    }

    case "richTextComponent": {
      return (
        <RichTextComponent
          component={component as GameUiComponent<GameUiRichTextComponentProps>}
          localContext={localContext}
          gameState={gameState}
          previewAttributes={previewAttributes}
        />
      );
    }

    case "imageComponent": {
      return (
        <ImageComponent
          component={component as GameUiComponent<GameUiImageComponentProps>}
          localContext={localContext}
          gameState={gameState}
          previewAttributes={previewAttributes}
        />
      );
    }

    default:
      // Неизвестный тип компонента — пропускаем, не бросаем ошибку
      return null;
  }
}

function isTruthyCondition(value: unknown): boolean {
  if (value === false || value === null || value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "false" && normalized !== "0";
  }
  return true;
}

function resolvePreviewRuntimePointer(component: GameUiComponent, fallback: string | undefined): string | undefined {
  const override = (component as PreviewRuntimePointerComponent).previewRuntimePointer;
  return typeof override === "string" && override.trim() !== "" ? override : fallback;
}
