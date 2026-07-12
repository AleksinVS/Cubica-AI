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
  GameUiInteractiveBoardSurfaceProps,
  GameUiDesignArtifactRef,
  PlayerFacingContent,
} from "@cubica/contracts-manifest";
import type { GameSession, MetricsSnapshot } from "@/types/game-state";
import { appendClassName } from "@/lib/classname-utils";
import { resolveAreaCssClass } from "@/lib/layout-helpers";
import { resolveExpressions } from "@/lib/expression-resolver";
import {
  resolveGameAssetReference,
  type GameAssetResolver
} from "@/lib/game-asset-resolver";
import { GameVariableComponent } from "./game-variable-component";
import { CardComponent } from "./card-component";
import { ButtonComponent } from "./button-component";
import { RichTextComponent } from "./rich-text-component";
import { ImageComponent } from "./image-component";
import {
  InteractiveBoardSurface
} from "@/components/interactive-board-surface";
import {
  childRuntimePointer,
  createPreviewElementAttributes
} from "./preview-metadata";

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
  content,
  session,
  onBoardAction,
  assetResolver,
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
  /** Player-facing content passed only to plugin-owned interactive surfaces. */
  content?: PlayerFacingContent;
  /** Authoritative snapshot passed only to plugin-owned interactive surfaces. */
  session?: GameSession;
  /** Async runtime path whose rejection lets a scene roll back its preview. */
  onBoardAction?: (actionId: string, params?: Record<string, unknown>) => Promise<void>;
  /** Resolves documented `asset:<id>` image properties without exposing paths. */
  assetResolver?: GameAssetResolver | null;
}) {
  if (component.if) {
    const condition = resolveExpressions(component.if, gameState ?? {}, localContext);
    if (!isTruthyCondition(condition)) {
      return null;
    }
  }

  // WHY (ADR-055): the generic renderer no longer rewrites the component tree
  // by game-specific button ids. Which control carries the "advance" action is
  // declared directly in the UI manifest (the forward-nav button owns the
  // action), so the renderer just renders the declared children as-is.
  const children = component.children ?? [];
  // `props` is optional for ordinary UI components in ui-manifest.schema.json.
  // Keep the renderer aligned with that declarative contract: structural
  // containers without visual options are valid and behave like empty props.
  const componentProps = component.props ?? {};
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
                  content={content}
                  session={session}
                  onBoardAction={onBoardAction}
                  assetResolver={assetResolver}
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
      const props = componentProps as GameUiAreaComponentProps;
      const cssClass = component.type === "areaComponent"
        ? resolveAreaCssClass(props.cssClass, layoutMode, props.topbarCssClass)
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
      const props = componentProps as GameUiScreenComponentProps;
      const cssClass =
        layoutMode === "topbar"
          ? appendClassName(props.cssClass, "topbar-screen-shell")
          : layoutMode === "leftsidebar"
            ? appendClassName(props.cssClass, "leftsidebar-screen")
            : props.cssClass ?? "";
      // visualMode="image": use design mockup as background
      const declaredBackgroundImage = isImageMode && resolvedDesignImage
        ? resolvedDesignImage
        : props.backgroundImage;
      const bgImage = resolveGameAssetReference(declaredBackgroundImage, assetResolver);
      return (
        <div
          {...previewAttributes}
          className={`game-screen ${cssClass}`}
          style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
        >
          {/*
            WHY (ADR-055): render the decorative background layer from generic,
            declarative signals only — the layout mode (topbar) which the
            platform itself owns, or the manifest's `decorativeBackground` prop —
            instead of branching on a game-authored CSS class name, which made
            the renderer know one specific game.
          */}
          {(layoutMode === "topbar" || props.decorativeBackground === true) && (
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
              content={content}
              session={session}
              onBoardAction={onBoardAction}
              assetResolver={assetResolver}
            />
          ))}
        </div>
      );
    }

    case "areaComponent": {
      const props = componentProps as GameUiAreaComponentProps;
      // visualMode="image": use design mockup as background for area
      const areaBgImage = isImageMode && resolvedDesignImage ? resolvedDesignImage : undefined;
      return (
        <div
          {...previewAttributes}
          className={`game-area ${resolveAreaCssClass(props.cssClass, layoutMode, props.topbarCssClass)}`}
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
              content={content}
              session={session}
              onBoardAction={onBoardAction}
              assetResolver={assetResolver}
            />
          ))}
        </div>
      );
    }

    case "gameVariableComponent": {
      const props = componentProps as GameUiGameVariableComponentProps;
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

    case "interactiveBoardSurface": {
      if (!content || !session || !onBoardAction || !assetResolver) {
        return <p role="alert">Интерактивное поле не подключено к игровой сессии.</p>;
      }

      return (
        <InteractiveBoardSurface
          gameId={content.gameId}
          content={content}
          session={session}
          assets={assetResolver}
          manifestProps={component.props as GameUiInteractiveBoardSurfaceProps}
          dispatchAction={onBoardAction}
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
