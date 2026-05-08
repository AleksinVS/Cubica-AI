import type { PlayerFacingContent, GameUiScreenDefinition, GamePlayerUiContent, GameUiComponent, GameUiComponentType } from "@cubica/contracts-manifest";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import type { MetricsSnapshot } from "@/types/game-state";
import { getFallbackActionEntries } from "@/lib/game-content-resolvers";
import { ManifestRenderer } from "@/components/manifest/manifest-renderer";

/**
 * Convention state keys that SafeModeRenderer checks for fallback screen generation.
 *
 * Games that want convention-based rendering must provide these keys
 * in their resolveGameState() output. All fields are optional —
 * the renderer checks each key and falls through to the next convention
 * or the action catalog fallback.
 */
interface GameConventionState {
  currentInfo?: {
    id: string;
    title: string;
    body: string;
    advanceActionId?: string;
    advanceLabel?: string;
    [key: string]: unknown;
  };
  currentBoard?: {
    title?: string;
    body?: string;
    [key: string]: unknown;
  };
  canAdvance?: boolean;
  selectedCard?: Record<string, unknown>;
  currentTeamSelection?: {
    id: string;
    title?: string;
    requiredPickCount?: number;
    confirmActionId?: string;
    confirmLabel?: string;
    [key: string]: unknown;
  };
  pickCount?: number;
  boardCards?: Array<{
    cardId: string;
    title: string;
    summary: string;
    selectActionId: string;
    selectLabel?: string;
    [key: string]: unknown;
  }>;
}

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
  dispatchAction,
  fallbackScreenBuilder,
  onManifestAction,
  onJournal,
  onHint,
  isPending,
  sessionId,
}: {
  content: PlayerFacingContent;
  gameState: Record<string, unknown>;
  metrics: MetricsSnapshot;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
  gameUi: GamePlayerUiContent | undefined;
  layoutMode: "leftsidebar" | "topbar";
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  /** Game-плагин может предоставить кастомный builder для fallback-экранов */
  fallbackScreenBuilder?: (
    gameState: Record<string, unknown>,
    content: PlayerFacingContent,
    layoutMode: "leftsidebar" | "topbar",
    fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
    metrics: MetricsSnapshot,
    onAction: (actionId: string) => void
  ) => GameUiScreenDefinition | null;
  /** Manifest action handler — для fallbackScreenBuilder path через ManifestRenderer */
  onManifestAction?: (command: string, payload: Record<string, unknown>) => void;
  /** Callback для кнопки "Журнал ходов" */
  onJournal?: () => void;
  /** Callback для кнопки "Подсказка" */
  onHint?: () => void;
  /** Флаг ожидания ответа сервера */
  isPending?: boolean;
  /** ID текущей сессии */
  sessionId?: string | null;
}) {
  // 1. Попробовать game-specific builder из плагина → ManifestRenderer
  if (fallbackScreenBuilder) {
    const screen = fallbackScreenBuilder(gameState, content, layoutMode, fallbackMetrics, metrics, (actionId) => dispatchAction(actionId));
    if (screen) {
      return (
        <ManifestRenderer
          screenDefinition={screen}
          metrics={metrics}
          onAction={onManifestAction ?? ((command, payload) => dispatchAction(payload.cardId ? String(payload.cardId) : command))}
          layoutMode={layoutMode}
          metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
          gameState={gameState}
          designArtifacts={gameUi?.designArtifacts}
        />
      );
    }
  }

  // 2. Convention-based генерация GameUiScreenDefinition → ManifestRenderer
  const state = gameState;
  const disabled = isPending || !sessionId;

  if (state.currentInfo) {
    const screenDef = buildInfoScreenDefinition(state, layoutMode, fallbackMetrics, disabled);
    return (
      <ManifestRenderer
        screenDefinition={screenDef}
        metrics={metrics}
        onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
        layoutMode={layoutMode}
        metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
        gameState={gameState}
      />
    );
  }

  if (state.currentBoard) {
    const screenDef = buildBoardScreenDefinition(state, content, layoutMode, fallbackMetrics, disabled);
    return (
      <ManifestRenderer
        screenDefinition={screenDef}
        metrics={metrics}
        onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
        layoutMode={layoutMode}
        metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
        gameState={gameState}
      />
    );
  }

  if (state.currentTeamSelection) {
    const screenDef = buildTeamSelectionScreenDefinition(state, layoutMode, fallbackMetrics, disabled);
    if (screenDef) {
      return (
        <ManifestRenderer
          screenDefinition={screenDef}
          metrics={metrics}
          onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
          layoutMode={layoutMode}
          metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
          gameState={gameState}
        />
      );
    }
  }

  // 3. Fallback — каталог действий
  const fallbackScreenDef = buildFallbackActionsScreenDefinition(content, layoutMode, fallbackMetrics, disabled);
  return (
    <ManifestRenderer
      screenDefinition={fallbackScreenDef}
      metrics={metrics}
      onAction={onManifestAction ?? createConventionActionAdapter(dispatchAction)}
      layoutMode={layoutMode}
      metricBackgroundImages={buildMetricBackgroundMap(fallbackMetrics)}
      gameState={gameState}
    />
  );
}

// --- Action adapter для convention-экранов ---
// Преобразует manifest-команды в прямые dispatchAction вызовы
function createConventionActionAdapter(dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void) {
  return (command: string, payload: Record<string, unknown>) => {
    // Специальные команды панели
    if (command === "showHistory") {
      dispatchAction("showHistory");
      return;
    }
    if (command === "showHint") {
      dispatchAction("showHint");
      return;
    }
    // Advance — извлечь advanceActionId из payload
    if (command === "advance" && payload.advanceActionId) {
      dispatchAction(String(payload.advanceActionId));
      return;
    }
    // RequestServer с actionId
    if (command === "requestServer" && payload.actionId) {
      dispatchAction(String(payload.actionId));
      return;
    }
    // RequestServer с cardId — извлечь selectActionId из gameState
    if (command === "requestServer" && payload.cardId) {
      // cardId уже передан — диспетчеризуем как есть, плагин резолвит
      dispatchAction("requestServer", payload);
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
  return fallbackMetrics.map((metric) => ({
    type: "gameVariableComponent" as GameUiComponentType,
    id: metric.id,
    props: {
      caption: metric.caption,
      description: metric.description,
      backgroundImage: layoutMode === "topbar" ? metric.topbarImage : metric.sidebarImage,
      value: `{{game.state.public.metrics.${metric.id}}}`,
    },
  }));
}

function buildPanelButtonsArea(
  layoutMode: "leftsidebar" | "topbar",
  disabled: boolean
): GameUiComponent {
  return {
    type: "areaComponent",
    props: { cssClass: "button-container panel-buttons" },
    children: [
      {
        type: "buttonComponent",
        id: "btn-journal",
        props: { caption: "журнал ходов", variant: "helper" as const, disabled },
        actions: { onClick: { command: "showHistory", payload: {} } },
      },
      {
        type: "buttonComponent",
        id: "btn-hint",
        props: { caption: "подсказка", variant: "helper" as const, disabled },
        actions: { onClick: { command: "showHint", payload: {} } },
      },
      {
        type: "buttonComponent",
        id: "nav-left",
        props: { caption: "Назад", variant: "nav" as const, disabled: true },
      },
      {
        type: "buttonComponent",
        id: "nav-right",
        props: { caption: "Вперед", variant: "nav" as const, disabled: true },
      },
    ],
  };
}

function buildInfoScreenDefinition(
  state: Record<string, unknown>,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean
): GameUiScreenDefinition {
  const info = state.currentInfo as Record<string, unknown> | undefined;
  const advanceActionId = info?.advanceActionId as string | undefined;
  const advanceLabel = info?.advanceLabel as string | undefined;
  const infoTitle = info?.title as string | undefined;
  const infoBody = info?.body as string | undefined;
  const infoId = info?.id as string | undefined;
  const infoStepIndex = info?.stepIndex as number | undefined;

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
                      type: "richTextComponent" as GameUiComponentType,
                      id: "info-title",
                      props: { html: infoTitle, cssClass: "fallback-card-head" },
                    }] : []),
                    ...(infoBody ? [{
                      type: "richTextComponent" as GameUiComponentType,
                      id: "info-body",
                      props: { html: infoBody, cssClass: "fallback-copy" },
                    }] : []),
                  ],
                },
              ],
            },
          ],
        },
        // Advance button
        ...(advanceActionId ? [{
          type: "areaComponent" as GameUiComponentType,
          props: { cssClass: "bottom-controls-container info-bottom-controls" },
          children: [
            {
              type: "buttonComponent" as GameUiComponentType,
              id: "btn-advance",
              props: { caption: advanceLabel ?? "Продолжить", variant: "action" as const, disabled },
              actions: { onClick: { command: "advance", payload: { advanceActionId } } },
            },
          ],
        }] : []),
      ],
    },
    // Panel buttons
    buildPanelButtonsArea(layoutMode, disabled),
  ];

  return {
    type: "screen",
    title: infoTitle ?? "Информация",
    layoutMode,
    root: {
      type: "screenComponent",
      props: { cssClass: shellCssClass },
      children,
    },
  };
}

function buildBoardScreenDefinition(
  state: Record<string, unknown>,
  content: PlayerFacingContent,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean
): GameUiScreenDefinition {
  const board = state.currentBoard as Record<string, unknown> | undefined;
  const canAdvance = state.canAdvance === true;

  // Board header
  const boardHeaderChildren: Array<GameUiComponent> = [];
  if (board?.title) {
    boardHeaderChildren.push({
      type: "cardComponent",
      id: "board-title",
      props: { text: board.title as string },
    });
  }
  if (board?.body) {
    boardHeaderChildren.push({
      type: "richTextComponent",
      id: "board-body",
      props: { html: board.body as string, cssClass: "fallback-copy" },
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
          selectLabel: "{{card.selectLabel}}",
          visualState: "default",
        },
        actions: {
          onClick: { command: "requestServer", payload: { actionId: "{{card.selectActionId}}" } },
        },
      },
    ],
  };

  // Advance button (when card is selected and can advance)
  const advanceArea: GameUiComponent[] = [];
  if (canAdvance && state.selectedCard) {
    advanceArea.push({
      type: "areaComponent",
      props: { cssClass: "info-bottom-controls" },
      children: [
        {
          type: "buttonComponent",
          id: "btn-advance",
          props: {
            caption: ((state.selectedCard as Record<string, unknown>)?.advanceLabel as string) ?? "Продолжить",
            variant: "action" as const,
            disabled,
          },
          actions: {
            onClick: {
              command: "advance",
              payload: { advanceActionId: (state.selectedCard as Record<string, unknown>)?.advanceActionId },
            },
          },
        },
      ],
    });
  }

  return {
    type: "screen",
    title: (board?.title as string) ?? content.name,
    layoutMode,
    root: {
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
            // Advance
            ...advanceArea,
          ],
        },
        // Panel buttons
        buildPanelButtonsArea("topbar", disabled),
      ],
    },
  };
}

function buildTeamSelectionScreenDefinition(
  state: Record<string, unknown>,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean
): GameUiScreenDefinition | null {
  const teamSelection = state.currentTeamSelection as Record<string, unknown> | undefined;
  if (!teamSelection) return null;

  const pickCount = (state.pickCount ?? 0) as number;
  const requiredPickCount = (teamSelection.requiredPickCount ?? 0) as number;

  return {
    type: "screen",
    title: (teamSelection.title as string) ?? "Выбор команды",
    layoutMode,
    root: {
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
                    onClick: { command: "requestServer", payload: { actionId: "{{member.selectActionId}}" } },
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
                  type: "cardComponent",
                  props: {
                    text: (teamSelection.title as string) ?? "",
                    chips: [
                      `team-selection: ${teamSelection.id as string}`,
                      `picked: ${pickCount}/${requiredPickCount}`,
                    ],
                  },
                },
                {
                  type: "buttonComponent",
                  props: {
                    caption: (teamSelection.confirmLabel as string) ?? "Подтвердить",
                    variant: "action" as const,
                    disabled: disabled || pickCount !== requiredPickCount,
                  },
                  actions: {
                    onClick: { command: "requestServer", payload: { actionId: teamSelection.confirmActionId as string } },
                  },
                },
              ],
            },
          ],
        },
        // Panel buttons
        buildPanelButtonsArea(layoutMode, disabled),
      ],
    },
  };
}

function buildFallbackActionsScreenDefinition(
  content: PlayerFacingContent,
  layoutMode: "leftsidebar" | "topbar",
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>,
  disabled: boolean
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
              text: "Экран еще не описан в UI manifest, поэтому доступен безопасный runtime fallback.",
            },
            actions: {
              onClick: { command: "requestServer", payload: { actionId: action.actionId } },
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