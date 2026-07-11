import type {
  GameUiPanelDefinition,
  GameUiScreenDefinition,
  GameUiDesignArtifactRef,
  PlayerFacingContent
} from "@cubica/contracts-manifest";
import type { GameSession, MetricsSnapshot } from "@/types/game-state";
import type { GameAssetResolver } from "@/lib/game-asset-resolver";
import { UiComponentNode } from "./ui-component-node";
import { screenRootRuntimePointer } from "./preview-metadata";

/**
 * Ограниченный рендерер, управляемый манифестом.
 * Рендерит экран из данных UI-манифеста,
 * связывая значения метрик из снимка сессии и направляя
 * действия кнопок/карточек в стандартный путь dispatch.
 */
export function ManifestRenderer({
  screenDefinition,
  metrics,
  onAction,
  screenKey,
  rootRuntimePointer,
  layoutMode: layoutModeProp = "topbar",
  metricBackgroundImages,
  gameState,
  designArtifacts,
  editorPreviewMode = false,
  content,
  session,
  onBoardAction,
  assetResolver,
}: {
  screenDefinition: GameUiScreenDefinition | GameUiPanelDefinition;
  metrics: MetricsSnapshot;
  onAction: (command: string, payload: Record<string, unknown>) => void;
  screenKey?: string;
  /**
   * Root runtime JSON Pointer used by editor preview metadata.
   *
   * Normal UI-manifest screens use /screens/{screenKey}/root. Runtime-built
   * fallback screens may point to the gameplay object that produced them, for
   * example /content/data/infos/0, so the editor can map the preview selection
   * back through the existing source map.
   */
  rootRuntimePointer?: string;
  layoutMode?: "leftsidebar" | "topbar";
  metricBackgroundImages?: Record<string, string>;
  /** Полное состояние игры для разрешения выражений и itemTemplate. */
  gameState?: Record<string, unknown>;
  /** Registry дизайн-артефактов для visualMode="image". */
  designArtifacts?: Record<string, GameUiDesignArtifactRef>;
  /** Enables generic runtime pointer metadata for the editor preview bridge. */
  editorPreviewMode?: boolean;
  /** Content and session are required only by interactive plugin surfaces. */
  content?: PlayerFacingContent;
  session?: GameSession;
  /** Async runtime action path used by canvas and its DOM alternative. */
  onBoardAction?: (actionId: string, params?: Record<string, unknown>) => Promise<void>;
  /** Optional game asset index; `asset:` references fail closed while absent. */
  assetResolver?: GameAssetResolver | null;
}) {
  // Layout from screen definition takes priority over prop
  const layoutMode =
    screenDefinition.layoutMode && screenDefinition.layoutMode !== "auto"
      ? screenDefinition.layoutMode
      : layoutModeProp;

  return (
    <div className={`game-renderer game-renderer--${layoutMode}`}>
      <UiComponentNode
        component={screenDefinition.root}
        metrics={metrics}
        onAction={onAction}
        screenKey={screenKey}
        layoutMode={layoutMode}
        metricBackgroundImages={metricBackgroundImages}
        gameState={gameState}
        parentVisualMode={screenDefinition.root.visualMode}
        designArtifacts={designArtifacts}
        editorPreviewMode={editorPreviewMode}
        runtimePointer={rootRuntimePointer ?? screenRootRuntimePointer(screenKey)}
        content={content}
        session={session}
        onBoardAction={onBoardAction}
        assetResolver={assetResolver}
      />
    </div>
  );
}
