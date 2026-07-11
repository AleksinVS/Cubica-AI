import type { PlayerFacingContent, GameUiScreenDefinition, GamePlayerUiContent, GameUiComponent, GameUiComponentType } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import type { MetricsSnapshot } from "@/types/game-state";
import { getFallbackActionEntries } from "@/lib/game-content-resolvers";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";
import { useLocale } from "@/components/locale-context";
import type { LocaleStrings } from "@/lib/locale";
import type { GameAssetResolver } from "@/lib/game-asset-resolver";

/**
 * Безопасный рендерер для экранов без манифестного описания.
 *
 * Генерирует GameUiScreenDefinition из convention-ключей в GameState
 * и делегирует рендеринг ManifestRenderer. Таким образом, все экраны
 * рендерятся через единый манифестный путь, а game-agnostic плагин
 * может предоставить кастомный fallbackScreenBuilder.
 *
 * Конвенции:
 * - currentInfo → info-экран (richTextComponent для body, buttonComponent для advance)
 * - currentBoard → board-экран (cardComponent с title/summary, itemTemplate для boardCards)
 * - currentTeamSelection → team selection (itemTemplate для members)
 * - Fallback → каталог действий (itemTemplate по content.actions)
 */
export function SafeModeRenderer({
  content,
  gameState,
  metrics,
  fallbackMetrics,
  gameUi,
  layoutMode,
  screenKey,
  dispatchAction,
  fallbackScreenBuilder,
  onManifestAction,
  isPending,
  sessionId,
  editorPreviewMode = false,
  assetResolver,
}: {
  content: PlayerFacingContent;
  gameState: Record<string, unknown>;
  metrics: MetricsSnapshot;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
  gameUi: GamePlayerUiContent | undefined;
  layoutMode: "leftsidebar" | "topbar";
  /** Best known routed screen key. Fallback screens may not have one. */
  screenKey?: string;
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  /** Game plugin can provide custom builder for fallback screens */
  fallbackScreenBuilder?: (
    gameState: Record<string, unknown>,
    content: PlayerFacingContent,
    layoutMode: "leftsidebar" | "topbar",
    fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
    metrics: MetricsSnapshot,
    onAction: (actionId: string) => void
  ) => GameUiScreenDefinition | null;
  /** Manifest action handler — for fallbackScreenBuilder path via ManifestRenderer */
  onManifestAction?: (command: string, payload: Record<string, unknown>) => void;
  /** Pending server response flag */
  isPending?: boolean;
  /** Current session ID */
  sessionId?: string | null;
  /** Enables editor preview metadata for fallback-rendered screens. */
  editorPreviewMode?: boolean;
  /** Asset ids for manifest screens produced by a generic fallback builder. */
  assetResolver?: GameAssetResolver | null;
}) {
  const t = useLocale();
  const state = gameState;
  const disabled = isPending || !sessionId;
  const previewPointers = buildSafeModePreviewPointers(state, content);

  // 1. Try game-specific builder from plugin → ManifestRenderer
  if (fallbackScreenBuilder) {
    const screen = fallbackScreenBuilder(gameState, content, layoutMode, fallbackMetrics, metrics, (actionId) => dispatchAction(actionId));
    if (screen) {
      return (
        <ManifestRenderer
          screenDefinition={screen}
          metrics={metrics}
          onAction={onManifestAction ?? ((command, payload) => dispatchAction(payload.cardId ? String(payload.cardId) : command))}
          screenKey={screenKey}
          rootRuntimePointer={previewPointers.root}
          layoutMode={layoutMode}
          metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
          gameState={gameState}
          designArtifacts={gameUi?.designArtifacts}
          editorPreviewMode={editorPreviewMode}
          assetResolver={assetResolver}
        />
      );
    }
  }

  // 2. Convention-based генерация GameUiScreenDefinition → ManifestRenderer
  if (state.currentInfo) {
    const screenDef = buildInfoScreenDefinition(state, layoutMode, fallbackMetrics, disabled, t, previewPointers);
    return (
      <ManifestRenderer
        screenDefinition={screenDef}
        metrics={metrics}
        onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
        screenKey={screenKey}
        rootRuntimePointer={previewPointers.root}
        layoutMode={layoutMode}
        metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
        gameState={gameState}
        editorPreviewMode={editorPreviewMode}
        assetResolver={assetResolver}
      />
    );
  }

  if (state.currentBoard) {
    const screenDef = buildBoardScreenDefinition(state, content, layoutMode, fallbackMetrics, disabled, t, previewPointers);
    return (
      <ManifestRenderer
        screenDefinition={screenDef}
        metrics={metrics}
        onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
        screenKey={screenKey}
        rootRuntimePointer={previewPointers.root}
        layoutMode={layoutMode}
        metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
        gameState={gameState}
        editorPreviewMode={editorPreviewMode}
        assetResolver={assetResolver}
      />
    );
  }

  if (state.currentTeamSelection) {
    const screenDef = buildTeamSelectionScreenDefinition(state, layoutMode, fallbackMetrics, disabled, t, previewPointers);
    if (screenDef) {
      return (
        <ManifestRenderer
          screenDefinition={screenDef}
          metrics={metrics}
          onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
          screenKey={screenKey}
          rootRuntimePointer={previewPointers.root}
          layoutMode={layoutMode}
          metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
          gameState={gameState}
          editorPreviewMode={editorPreviewMode}
          assetResolver={assetResolver}
        />
      );
    }
  }

  // 3. Fallback — каталог действий
  const fallbackScreenDef = buildFallbackActionsScreenDefinition(content, layoutMode, fallbackMetrics, t);
  return (
    <ManifestRenderer
      screenDefinition={fallbackScreenDef}
      metrics={metrics}
      onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
      screenKey={screenKey}
      rootRuntimePointer="/actions"
      layoutMode={layoutMode}
      metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
      gameState={gameState}
      editorPreviewMode={editorPreviewMode}
      assetResolver={assetResolver}
    />
  );
}

// --- Action adapter для convention-экранов ---
// Преобразует manifest-команды в прямые dispatchAction вызовы
function createConventionActionAdapter(dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void) {
  return (command: string, payload: Record<string, unknown>) => {
    // Специальные команды панели
    if (command === ManifestAction.SHOW_PANEL) {
      dispatchAction(ManifestAction.SHOW_PANEL, payload);
      return;
    }
    // Advance — извлечь advanceActionId из payload
    if (command === ManifestAction.ADVANCE && payload.advanceActionId) {
      dispatchAction(String(payload.advanceActionId));
      return;
    }
    // RequestServer с actionId
    if (command === ManifestAction.REQUEST_SERVER && payload.actionId) {
      dispatchAction(String(payload.actionId));
      return;
    }
    // RequestServer с cardId — извлечь selectActionId из gameState
    if (command === ManifestAction.REQUEST_SERVER && payload.cardId) {
      // cardId already passed — dispatch as-is, plugin resolves
      dispatchAction(ManifestAction.REQUEST_SERVER, payload);
      return;
    }
    // Fallback — передать команду как actionId
    dispatchAction(command, payload);
  };
}

// --- Builder functions ---

function buildMetricGameVariableComponents(
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  layoutMode: "leftsidebar" | "topbar"
): Array<GameUiComponent> {
  return fallbackMetrics.map((metric) =>
    withPreviewRuntimePointer(
      {
        type: "gameVariableComponent" as GameUiComponentType,
        id: metric.id,
        props: {
          caption: metric.caption,
          description: metric.description,
          backgroundImage: layoutMode === "topbar" ? metric.topbarImage : metric.sidebarImage,
          value: `{{game.state.public.metrics.${metric.id}}}`,
        },
      },
      `/state/public/metrics/${escapeJsonPointerSegment(metric.id)}`
    )
  );
}

function buildPanelButtonsArea(
  disabled: boolean,
  t: LocaleStrings,
  forwardAction?: { command: string; payload: Record<string, unknown> },
  forwardActionRuntimePointer?: string
): GameUiComponent {
  return {
    type: "areaComponent",
    props: { cssClass: "button-container panel-buttons" },
    children: [
      {
        type: "buttonComponent",
        id: "btn-journal",
        props: { caption: t.journal, variant: "helper" as const, disabled },
        actions: { onClick: { command: ManifestAction.SHOW_PANEL, payload: { panelId: "history" } } },
      },
      {
        type: "buttonComponent",
        id: "btn-hint",
        props: { caption: t.hint, variant: "helper" as const, disabled },
        actions: { onClick: { command: ManifestAction.SHOW_PANEL, payload: { panelId: "hint" } } },
      },
      {
        type: "buttonComponent",
        id: "nav-left",
        props: { caption: t.back, variant: "nav" as const, disabled: true },
      },
      withPreviewRuntimePointer(
        {
          type: "buttonComponent",
          id: "nav-right",
          props: { caption: t.forward, variant: "nav" as const, disabled: disabled || !forwardAction },
          ...(forwardAction ? { actions: { onClick: forwardAction } } : {}),
        },
        forwardActionRuntimePointer
      ),
    ],
  };
}

function buildInfoScreenDefinition(
  state: Record<string, unknown>,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean,
  t: LocaleStrings,
  previewPointers: SafeModePreviewPointers = {}
): GameUiScreenDefinition {
  const info = state.currentInfo as Record<string, unknown> | undefined;
  const advanceActionId = info?.advanceActionId as string | undefined;
  const infoTitle = info?.title as string | undefined;
  const infoBody = info?.body as string | undefined;

  const shellCssClass = layoutMode === "leftsidebar"
    ? "leftsidebar-screen"
    : "info-screen-shell";

  const children: Array<GameUiComponent> = [
    // Metrics area
    {
      type: "areaComponent",
      props: { cssClass: `game-variables-container${layoutMode === "topbar" ? " topbar-variables-container" : ""}` },
      children: buildMetricGameVariableComponents(fallbackMetrics, layoutMode),
    },
    // Main content area
    {
      type: "areaComponent",
      props: { cssClass: `main-content-area${layoutMode === "topbar" ? " topbar-main-content" : ""}` },
      children: [
        // Info content area
        {
          type: "areaComponent",
          props: { cssClass: "info-content" },
          children: [
            {
              type: "areaComponent",
              props: { cssClass: "info-event-card" },
              children: [
                { type: "areaComponent", props: { cssClass: "info-event-illustration" } },
                {
                  type: "areaComponent",
                  props: { cssClass: "info-event-text" },
                  children: [
                    ...(infoTitle ? [{
                      ...withPreviewRuntimePointer(
                        {
                          type: "richTextComponent" as GameUiComponentType,
                          id: "info-title",
                          props: { html: infoTitle, cssClass: "fallback-card-head" },
                        },
                        previewPointers.title
                      ),
                    }] : []),
                    ...(infoBody ? [{
                      ...withPreviewRuntimePointer(
                        {
                          type: "richTextComponent" as GameUiComponentType,
                          id: "info-body",
                          props: { html: infoBody, cssClass: "fallback-copy" },
                        },
                        previewPointers.body
                      ),
                    }] : []),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    // Panel buttons. "Вперед" получает то же действие, которое раньше
    // показывалось отдельной кнопкой "Продолжить".
    buildPanelButtonsArea(
      disabled,
      t,
      advanceActionId
        ? { command: ManifestAction.ADVANCE, payload: { advanceActionId } }
        : undefined,
      previewPointers.forwardAction
    ),
  ];

  return {
    type: "screen",
    title: infoTitle ?? t.information,
    layoutMode,
    root: withPreviewRuntimePointer(
      {
        type: "screenComponent",
        props: { cssClass: shellCssClass },
        children,
      },
      previewPointers.root
    ),
  };
}

function buildBoardScreenDefinition(
  state: Record<string, unknown>,
  content: PlayerFacingContent,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean,
  t: LocaleStrings,
  previewPointers: SafeModePreviewPointers = {}
): GameUiScreenDefinition {
  const board = state.currentBoard as Record<string, unknown> | undefined;
  const canAdvance = state.canAdvance === true;

  // Board header
  const boardHeaderChildren: Array<GameUiComponent> = [];
  if (board?.title) {
    boardHeaderChildren.push({
      ...withPreviewRuntimePointer(
        {
          type: "cardComponent",
          id: "board-title",
          props: { text: board.title as string },
        },
        previewPointers.title
      ),
    });
  }
  if (board?.body) {
    boardHeaderChildren.push({
      ...withPreviewRuntimePointer(
        {
          type: "richTextComponent",
          id: "board-body",
          props: { html: board.body as string, cssClass: "fallback-copy" },
        },
        previewPointers.body
      ),
    });
  }

  // Cards — using itemTemplate for boardCards
  const cardsArea: GameUiComponent = {
    type: "areaComponent",
    props: { cssClass: "cards-container topbar-cards-container" },
    itemTemplate: {
      collection: "{{boardCards}}",
      itemKey: "card",
    },
    children: [
      {
        type: "cardComponent",
        props: {
          title: "{{card.title}}",
          summary: "{{card.summary}}",
          backText: "{{card.backText}}",
          selectLabel: "{{card.selectLabel}}",
          visualState: "default",
        },
        actions: {
          onClick: { command: ManifestAction.REQUEST_SERVER, payload: { actionId: "{{card.selectActionId}}" } },
        },
      },
    ],
  };

  const selectedCard = state.selectedCard as Record<string, unknown> | undefined;
  const selectedCardAdvanceActionId =
    canAdvance && selectedCard
      ? selectedCard.advanceActionId as string | undefined
      : undefined;

  return {
    type: "screen",
    title: (board?.title as string) ?? content.name,
    layoutMode,
    root: withPreviewRuntimePointer(
      {
        type: "screenComponent",
        props: { cssClass: "game-screen topbar-screen-shell" },
        children: [
          // Metrics
          {
            type: "areaComponent",
            props: { cssClass: "game-variables-container topbar-variables-container" },
            children: buildMetricGameVariableComponents(fallbackMetrics, "topbar"),
          },
          // Main content
          {
            type: "areaComponent",
            props: { cssClass: "game-area main-content-area topbar-main-content" },
            children: [
              // Board header
              ...(boardHeaderChildren.length > 0 ? [{
                type: "areaComponent" as GameUiComponentType,
                props: { cssClass: "game-area topbar-board-header" },
                children: boardHeaderChildren,
              }] : []),
              // Cards
              cardsArea,
            ],
          },
          // Panel buttons. "Вперед" активируется тем же canAdvance-состоянием,
          // при котором раньше появлялась отдельная кнопка "Продолжить".
          buildPanelButtonsArea(
            disabled,
            t,
            selectedCardAdvanceActionId
              ? { command: ManifestAction.ADVANCE, payload: { advanceActionId: selectedCardAdvanceActionId } }
              : undefined,
            previewPointers.forwardAction
          ),
        ],
      },
      previewPointers.root
    ),
  };
}

function buildTeamSelectionScreenDefinition(
  state: Record<string, unknown>,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean,
  t: LocaleStrings,
  previewPointers: SafeModePreviewPointers = {}
): GameUiScreenDefinition | null {
  const teamSelection = state.currentTeamSelection as Record<string, unknown> | undefined;
  if (!teamSelection) return null;

  const pickCount = (state.pickCount ?? 0) as number;
  const requiredPickCount = (teamSelection.requiredPickCount ?? 0) as number;

  return {
    type: "screen",
    title: (teamSelection.title as string) ?? t.teamSelection,
    layoutMode,
    root: withPreviewRuntimePointer({
      type: "screenComponent",
      props: { cssClass: layoutMode === "leftsidebar" ? "leftsidebar-screen" : "info-screen-shell" },
      children: [
        // Metrics
        {
          type: "areaComponent",
          props: { cssClass: `game-variables-container${layoutMode === "topbar" ? " topbar-variables-container" : ""}` },
          children: buildMetricGameVariableComponents(fallbackMetrics, layoutMode),
        },
        // Main content
        {
          type: "areaComponent",
          props: { cssClass: `main-content-area${layoutMode === "topbar" ? " topbar-main-content" : ""}` },
          children: [
            // Members (itemTemplate)
            {
              type: "areaComponent",
              props: { cssClass: "cards-container team-cards-container" },
              itemTemplate: {
                collection: "{{currentTeamSelection.members}}",
                itemKey: "member",
              },
              children: [
                {
                  type: "cardComponent",
                  props: {
                    title: "{{member.name}}",
                    summary: "{{member.summary}}",
                    selectLabel: "{{member.selectLabel}}",
                  },
                  actions: {
                    onClick: { command: ManifestAction.REQUEST_SERVER, payload: { actionId: "{{member.selectActionId}}" } },
                  },
                },
              ],
            },
            // Summary + confirm
            {
              type: "areaComponent",
              props: { cssClass: "bottom-controls-container team-controls" },
              children: [
                {
                  ...withPreviewRuntimePointer(
                    {
                      type: "cardComponent",
                      props: {
                        text: (teamSelection.title as string) ?? "",
                        chips: [
                          `team-selection: ${teamSelection.id as string}`,
                          `picked: ${pickCount}/${requiredPickCount}`,
                        ],
                      },
                    },
                    previewPointers.title
                  ),
                },
                withPreviewRuntimePointer(
                  {
                    type: "buttonComponent",
                    props: {
                      caption: (teamSelection.confirmLabel as string) ?? t.confirm,
                      variant: "action" as const,
                      disabled: disabled || pickCount !== requiredPickCount,
                    },
                    actions: {
                      onClick: { command: ManifestAction.REQUEST_SERVER, payload: { actionId: teamSelection.confirmActionId as string } },
                    },
                  },
                  previewPointers.forwardAction
                ),
              ],
            },
          ],
        },
        // Panel buttons
        buildPanelButtonsArea(disabled, t),
      ],
    }, previewPointers.root),
  };
}

function buildFallbackActionsScreenDefinition(
  content: PlayerFacingContent,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  t: LocaleStrings
): GameUiScreenDefinition {
  const actions = getFallbackActionEntries(content);

  return {
    type: "screen",
    title: content.name,
    layoutMode,
    root: {
      type: "screenComponent",
      props: { cssClass: layoutMode === "topbar" ? "topbar-screen-shell" : "leftsidebar-screen" },
      children: [
        // Metrics
        {
          type: "areaComponent",
          props: { cssClass: `game-variables-container${layoutMode === "topbar" ? " topbar-variables-container" : ""}` },
          children: buildMetricGameVariableComponents(fallbackMetrics, layoutMode),
        },
        // Action cards area
        {
          type: "areaComponent",
          props: { cssClass: `cards-container${layoutMode === "topbar" ? " topbar-cards-container" : ""} action-cards-container` },
          children: actions.map((action) => ({
            type: "cardComponent" as GameUiComponentType,
            id: `action-${action.actionId}`,
            props: {
              title: action.displayName,
              chips: [
                "action",
                ...(action.capabilityFamily ? [action.capabilityFamily] : []),
              ],
              text: t.fallbackNotice,
            },
            actions: {
              onClick: { command: ManifestAction.REQUEST_SERVER, payload: { actionId: action.actionId } },
            },
          })),
        },
        // Game info
        {
          type: "areaComponent",
          props: { cssClass: "bottom-controls-container team-controls" },
          children: [
            {
              type: "cardComponent",
              props: {
                text: content.name,
                chips: [
                  `players: ${content.playerConfig.min}-${content.playerConfig.max}`,
                  `locale: ${content.locale}`,
                ],
              },
            },
          ],
        },
      ],
    },
  };
}

function buildMetricBackgroundMap(fallbackMetrics: ReadonlyArray<FallbackMetricSpec>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const metric of fallbackMetrics) {
    map[metric.id] = metric.topbarImage;
  }
  return map;
}

interface SafeModePreviewPointers {
  readonly root?: string;
  readonly title?: string;
  readonly body?: string;
  readonly forwardAction?: string;
}

type PreviewRuntimePointerComponent = GameUiComponent & {
  /**
   * Runtime-only editor preview pointer. It is never serialized into
   * authoring manifests; it only helps the preview bridge map fallback UI
   * elements back to gameplay content through the existing source map.
   */
  readonly previewRuntimePointer?: string;
};

function withPreviewRuntimePointer(component: GameUiComponent, pointer: string | undefined): GameUiComponent {
  if (pointer === undefined) {
    return component;
  }

  return {
    ...component,
    previewRuntimePointer: pointer,
  } as PreviewRuntimePointerComponent;
}

function buildSafeModePreviewPointers(
  state: Record<string, unknown>,
  content: PlayerFacingContent
): SafeModePreviewPointers {
  const currentInfo = asRecord(state.currentInfo);
  if (currentInfo !== undefined) {
    const root = findContentDataItemPointer(content, ["infos", "infoEntries"], currentInfo);
    return {
      root,
      title: childDataPointer(root, "title"),
      body: childDataPointer(root, "body"),
      forwardAction: actionRuntimePointer(readString(currentInfo.advanceActionId)),
    };
  }

  const currentBoard = asRecord(state.currentBoard);
  if (currentBoard !== undefined) {
    const root = findContentDataItemPointer(content, ["boards"], currentBoard);
    const selectedCard = asRecord(state.selectedCard);
    return {
      root,
      title: childDataPointer(root, "title"),
      body: childDataPointer(root, "body"),
      forwardAction: actionRuntimePointer(readString(selectedCard?.advanceActionId)),
    };
  }

  const currentTeamSelection = asRecord(state.currentTeamSelection);
  if (currentTeamSelection !== undefined) {
    const root = findContentDataItemPointer(content, ["teamSelections"], currentTeamSelection);
    return {
      root,
      title: childDataPointer(root, "title"),
      forwardAction: actionRuntimePointer(readString(currentTeamSelection.confirmActionId)),
    };
  }

  return {};
}

function findContentDataItemPointer(
  content: PlayerFacingContent,
  collectionNames: readonly string[],
  expected: Record<string, unknown>
): string | undefined {
  const data = asRecord(asRecord(content.content)?.data);
  if (data === undefined) {
    return undefined;
  }

  for (const collectionName of collectionNames) {
    const collection = data[collectionName];
    if (!Array.isArray(collection)) {
      continue;
    }

    const index = collection.findIndex((candidate) => itemMatchesExpected(candidate, expected));
    if (index !== -1) {
      return `/content/data/${escapeJsonPointerSegment(collectionName)}/${index}`;
    }
  }

  return undefined;
}

function itemMatchesExpected(candidate: unknown, expected: Record<string, unknown>): boolean {
  const item = asRecord(candidate);
  if (item === undefined) {
    return false;
  }

  const expectedId = readItemId(expected);
  if (expectedId !== undefined && readItemId(item) === expectedId) {
    return true;
  }

  const expectedStepIndex = readNumber(expected.stepIndex);
  const expectedScreenId = readString(expected.screenId);
  return (
    expectedStepIndex !== undefined &&
    expectedScreenId !== undefined &&
    readNumber(item.stepIndex) === expectedStepIndex &&
    readString(item.screenId) === expectedScreenId
  );
}

function readItemId(record: Record<string, unknown>): string | undefined {
  return readString(record.id) ?? readString(record.cardId);
}

function childDataPointer(root: string | undefined, fieldName: string): string | undefined {
  return root === undefined ? undefined : `${root}/${escapeJsonPointerSegment(fieldName)}`;
}

function actionRuntimePointer(actionId: string | undefined): string | undefined {
  return actionId === undefined ? undefined : `/actions/${escapeJsonPointerSegment(actionId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
