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
  GameUiWorkspaceSlot,
  GameUiDesignArtifactRef,
  PlayerFacingContent,
} from "@cubica/contracts-manifest";
import type { GameSession, MetricsSnapshot } from "@/types/game-state";
import type { TransportRoadPreviewResponse } from "@cubica/contracts-session";
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
import type { PlayerLayoutMode } from "@/lib/player-layout-mode";

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

type WorkspaceAreaProps = GameUiAreaComponentProps & {
  /** Semantic position declared by the schema for a map-first root area. */
  readonly workspaceSlot?: GameUiWorkspaceSlot;
};

type MapFirstPanelSlot = Extract<GameUiWorkspaceSlot, "primary-panel" | "context-panel">;

type MapFirstPanelPresentation = {
  /** Stable DOM id connected to the external toggle through aria-controls. */
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly ref: React.RefCallback<HTMLDivElement>;
};

const MAP_FIRST_PANEL_LABELS: Readonly<Record<MapFirstPanelSlot, string>> = {
  "primary-panel": "Обзор",
  "context-panel": "Контекст"
};

/**
 * Own the transient state of map-first drawers in the browser presentation.
 *
 * The runtime snapshot deliberately does not store whether a facilitator has
 * opened a drawer: it is a short-lived display preference, not a game rule.
 * Only one drawer can be open at a time, which keeps the map usable at every
 * supported width and gives keyboard users one predictable Escape target.
 */
function MapFirstScreenShell({
  className,
  style,
  previewAttributes,
  availablePanels,
  children
}: {
  readonly className: string;
  readonly style: React.CSSProperties | undefined;
  readonly previewAttributes: React.HTMLAttributes<HTMLElement>;
  readonly availablePanels: readonly MapFirstPanelSlot[];
  readonly children: (
    panels: Readonly<Partial<Record<MapFirstPanelSlot, MapFirstPanelPresentation>>>
  ) => React.ReactNode;
}) {
  const instanceId = React.useId().replaceAll(":", "");
  const [openPanel, setOpenPanel] = React.useState<MapFirstPanelSlot | null>(null);
  const panelElements = React.useRef<Partial<Record<MapFirstPanelSlot, HTMLDivElement | null>>>({});
  const toggleElements = React.useRef<Partial<Record<MapFirstPanelSlot, HTMLButtonElement | null>>>({});
  const availablePanelKey = availablePanels.join("|");

  // Focus the opened region so Escape and the following Tab press start from
  // the newly revealed content instead of an unrelated control over the map.
  React.useEffect(() => {
    if (openPanel && availablePanelKey.split("|").includes(openPanel)) {
      panelElements.current[openPanel]?.focus();
    }
  }, [availablePanelKey, openPanel]);

  const closePanel = React.useCallback((slot: MapFirstPanelSlot) => {
    setOpenPanel(null);
    toggleElements.current[slot]?.focus();
  }, []);

  const presentations: Partial<Record<MapFirstPanelSlot, MapFirstPanelPresentation>> = {};
  for (const slot of availablePanels) {
    presentations[slot] = {
      id: `map-first-${instanceId}-${slot}`,
      label: MAP_FIRST_PANEL_LABELS[slot],
      open: openPanel === slot,
      ref: (element) => {
        panelElements.current[slot] = element;
      }
    };
  }

  return (
    <div
      {...previewAttributes}
      className={className}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape" && openPanel) {
          event.preventDefault();
          event.stopPropagation();
          closePanel(openPanel);
        }
      }}
    >
      {children(presentations)}
      {availablePanels.length > 0 ? (
        <div className="map-first-panel-toggles" role="group" aria-label="Панели игрового поля">
          {availablePanels.map((slot) => {
            const presentation = presentations[slot]!;
            return (
              <button
                key={slot}
                ref={(element) => {
                  toggleElements.current[slot] = element;
                }}
                type="button"
                className="map-first-panel-toggle"
                aria-controls={presentation.id}
                aria-expanded={presentation.open}
                aria-label={`${presentation.open ? "Закрыть" : "Открыть"} панель «${presentation.label}»`}
                onClick={() => {
                  if (presentation.open) {
                    closePanel(slot);
                  } else {
                    setOpenPanel(slot);
                  }
                }}
              >
                {presentation.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Add only platform-owned workspace classes.
 *
 * Game-authored CSS remains decorative. Placement is derived exclusively from
 * the bounded `workspaceSlot` contract, so the renderer never needs a game id
 * or a product-specific class name.
 */
function mapFirstAreaAttributes(
  props: WorkspaceAreaProps,
  layoutMode: PlayerLayoutMode | undefined
): { className: string; contentClassName?: string; workspaceSlot?: GameUiWorkspaceSlot } {
  const cssClass = resolveAreaCssClass(props.cssClass, layoutMode, props.topbarCssClass);
  if (layoutMode !== "map-first" || !props.workspaceSlot) {
    return { className: cssClass };
  }

  return {
    // The platform-owned outer element controls placement and sizing. Keeping
    // authored classes on the inner content element prevents historical card
    // and sidebar layouts from turning a drawer back into a fixed column.
    className: appendClassName("map-first-slot", `map-first-slot--${props.workspaceSlot}`),
    contentClassName: cssClass,
    workspaceSlot: props.workspaceSlot
  };
}

function resolveMapFirstPanelSlot(component: GameUiComponent): MapFirstPanelSlot | undefined {
  if (component.type !== "areaComponent") {
    return undefined;
  }

  const slot = (component.props as WorkspaceAreaProps | undefined)?.workspaceSlot;
  return slot === "primary-panel" || slot === "context-panel" ? slot : undefined;
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
  content,
  session,
  onBoardAction,
  onBoardRoadPreview,
  assetResolver,
  isPending = false,
  mapFirstPanel,
}: {
  component: GameUiComponent;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  layoutMode?: PlayerLayoutMode;
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
  /** Read-only route calculation; it never confirms or pays for construction. */
  onBoardRoadPreview?: (
    actionId: string,
    params: Record<string, unknown>
  ) => Promise<TransportRoadPreviewResponse>;
  /** Resolves documented `asset:<id>` image properties without exposing paths. */
  assetResolver?: GameAssetResolver | null;
  /** Shared presenter lock while one server action is in flight. */
  isPending?: boolean;
  /** Presentation state supplied only to a direct map-first drawer area. */
  mapFirstPanel?: MapFirstPanelPresentation;
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

  // WHY (ADR-055 + reference parity): a structural container (areaComponent or
  // screenComponent) may declare `actions.onClick` to behave as a dismissible
  // backdrop — a click on the container's OWN empty area runs the command, while
  // clicks on its children (cards, buttons, text) do not. The `target ===
  // currentTarget` guard is exactly this backdrop semantic: it fires only when the
  // click landed on the container element itself, not on a descendant. This mirrors
  // a modal backdrop (the Antarctica journal/hint panels close on an empty-space
  // click, matching the reference Bootstrap modal's `data-dismiss` backdrop) with no
  // game specifics in the generic renderer: the command (e.g. `closePanel`) is
  // declared in the UI manifest. Interactive controls must be buttonComponents,
  // whose own onClick already stops at the button.
  const backdropAction = component.actions?.onClick;
  const handleBackdropClick = backdropAction?.command
    ? (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
          onAction(backdropAction.command, backdropAction.payload ?? {});
        }
      }
    : undefined;

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
                  onBoardRoadPreview={onBoardRoadPreview}
                  assetResolver={assetResolver}
                  isPending={isPending}
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
      const props = componentProps as WorkspaceAreaProps;
      const areaAttributes = mapFirstAreaAttributes(props, layoutMode);
      const cssClass = component.type === "areaComponent"
        ? areaAttributes.className
        : (props as GameUiScreenComponentProps).cssClass ?? "";
      const areaBgImage = isImageMode && resolvedDesignImage ? resolvedDesignImage : undefined;

      if (component.type === "areaComponent" && areaAttributes.workspaceSlot) {
        return (
          <div
            {...previewAttributes}
            ref={mapFirstPanel?.ref}
            id={mapFirstPanel?.id}
            className={`game-area ${cssClass}`}
            data-workspace-slot={areaAttributes.workspaceSlot}
            data-panel-open={mapFirstPanel ? String(mapFirstPanel.open) : undefined}
            hidden={mapFirstPanel ? !mapFirstPanel.open : undefined}
            role={mapFirstPanel ? "region" : undefined}
            aria-label={mapFirstPanel?.label}
            tabIndex={mapFirstPanel ? -1 : undefined}
          >
            <div
              className={appendClassName(areaAttributes.contentClassName, "map-first-slot-content")}
              style={areaBgImage ? { backgroundImage: `url(${areaBgImage})` } : undefined}
            >
              {itemContent}
            </div>
          </div>
        );
      }

      return (
        <div
          {...previewAttributes}
          className={component.type === "areaComponent" ? `game-area ${cssClass}` : `game-screen ${cssClass}`}
          data-workspace-slot={component.type === "areaComponent" ? areaAttributes.workspaceSlot : undefined}
          style={areaBgImage ? { backgroundImage: `url(${areaBgImage})` } : undefined}
          onClick={handleBackdropClick}
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
            : appendClassName(props.cssClass, "map-first-screen");
      // visualMode="image": use design mockup as background
      const declaredBackgroundImage = isImageMode && resolvedDesignImage
        ? resolvedDesignImage
        : props.backgroundImage;
      const bgImage = resolveGameAssetReference(declaredBackgroundImage, assetResolver);

      const renderChild = (
        child: GameUiComponent,
        index: number,
        panel?: MapFirstPanelPresentation
      ) => (
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
          onBoardRoadPreview={onBoardRoadPreview}
          assetResolver={assetResolver}
          isPending={isPending}
          mapFirstPanel={panel}
        />
      );

      if (layoutMode === "map-first") {
        const availablePanels = Array.from(new Set(
          children
            .map(resolveMapFirstPanelSlot)
            .filter((slot): slot is MapFirstPanelSlot => slot !== undefined)
        ));

        return (
          <MapFirstScreenShell
            className={`game-screen ${cssClass}`}
            style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
            previewAttributes={previewAttributes}
            availablePanels={availablePanels}
          >
            {(panels) =>
              children.map((child, index) => {
                const slot = resolveMapFirstPanelSlot(child);
                return renderChild(child, index, slot ? panels[slot] : undefined);
              })
            }
          </MapFirstScreenShell>
        );
      }

      return (
        <div
          {...previewAttributes}
          className={`game-screen ${cssClass}`}
          style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}
          onClick={handleBackdropClick}
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
          {children.map((child, index) => renderChild(child, index))}
        </div>
      );
    }

    case "areaComponent": {
      const props = componentProps as WorkspaceAreaProps;
      const areaAttributes = mapFirstAreaAttributes(props, layoutMode);
      // visualMode="image": use design mockup as background for area
      const areaBgImage = isImageMode && resolvedDesignImage ? resolvedDesignImage : undefined;

      if (areaAttributes.workspaceSlot) {
        return (
          <div
            {...previewAttributes}
            ref={mapFirstPanel?.ref}
            id={mapFirstPanel?.id}
            className={`game-area ${areaAttributes.className}`}
            data-workspace-slot={areaAttributes.workspaceSlot}
            data-panel-open={mapFirstPanel ? String(mapFirstPanel.open) : undefined}
            hidden={mapFirstPanel ? !mapFirstPanel.open : undefined}
            role={mapFirstPanel ? "region" : undefined}
            aria-label={mapFirstPanel?.label}
            tabIndex={mapFirstPanel ? -1 : undefined}
          >
            <div
              className={appendClassName(areaAttributes.contentClassName, "map-first-slot-content")}
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
                  onBoardRoadPreview={onBoardRoadPreview}
                  assetResolver={assetResolver}
                  isPending={isPending}
                />
              ))}
            </div>
          </div>
        );
      }

      return (
        <div
          {...previewAttributes}
          className={`game-area ${areaAttributes.className}`}
          data-workspace-slot={areaAttributes.workspaceSlot}
          style={areaBgImage ? { backgroundImage: `url(${areaBgImage})` } : undefined}
          onClick={handleBackdropClick}
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
              onBoardRoadPreview={onBoardRoadPreview}
              assetResolver={assetResolver}
              isPending={isPending}
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
          assetResolver={assetResolver}
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
          session={session}
          isPending={isPending}
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
          assetResolver={assetResolver}
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
          previewTransportRoad={onBoardRoadPreview}
          isPending={isPending}
          layoutMode={layoutMode}
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
