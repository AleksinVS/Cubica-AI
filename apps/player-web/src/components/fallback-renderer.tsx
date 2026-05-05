import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type {
  GamePlayerBoardCard
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import type {
  resolveCurrentBoard,
  resolveCurrentInfoEntry,
  resolveCurrentTeamSelectionScene,
  resolveBoardCards,
  readCardFlags,
  readTeamFlags,
  readCanAdvance,
  readSelectedCardId,
  readTeamSelection
} from "@/lib/game-content-resolvers";
import type { ActionEntry } from "@/lib/game-content-resolvers";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { RichText } from "@/components/manifest/rich-text";
import { MetricCluster } from "@/components/panels/metric-cluster";
import { PanelButtonRow } from "@/components/panels/panel-button-row";

export function FallbackRenderer({
  content,
  runtimeApiUrl,
  sessionId,
  isPending,
  metrics,
  currentInfo,
  currentBoard,
  currentTeamSelection,
  cardFlags,
  selectedCardId,
  selectedCard,
  boardCards,
  teamFlags,
  selectedMemberIds,
  pickCount,
  canAdvance,
  fallbackActions,
  dispatchAction,
  layoutMode,
  onJournal,
  onHint,
  fallbackMetrics
}: {
  content: PlayerFacingContent;
  runtimeApiUrl: string;
  sessionId: string | null;
  isPending: boolean;
  metrics: MetricsSnapshot;
  currentInfo: ReturnType<typeof resolveCurrentInfoEntry>;
  currentBoard: ReturnType<typeof resolveCurrentBoard>;
  currentTeamSelection: ReturnType<typeof resolveCurrentTeamSelectionScene>;
  cardFlags: ReturnType<typeof readCardFlags>;
  selectedCardId: string | null;
  selectedCard: ReturnType<typeof resolveBoardCards>[number] | null;
  boardCards: ReturnType<typeof resolveBoardCards>;
  teamFlags: ReturnType<typeof readTeamFlags>;
  selectedMemberIds: Array<string>;
  pickCount: number;
  canAdvance: boolean;
  fallbackActions: Array<ActionEntry>;
  dispatchAction: (actionId: string, payload?: Record<string, unknown>) => void;
  layoutMode?: "leftsidebar" | "topbar";
  onJournal?: () => void;
  onHint?: () => void;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  // Compute shell class from layoutMode, falling back to topbar for initial state
  // (matching draft screen_s1 topbar composition by default)
  const shellClassName = currentBoard
    ? "game-screen topbar-screen-shell"
    : layoutMode === "leftsidebar"
      ? "game-screen leftsidebar-screen"
      : currentInfo
        ? "game-screen info-screen-shell"
        : "game-screen topbar-screen-shell";

  const rendererClassName = `game-renderer fallback-renderer game-renderer--${layoutMode}`;

  return (
    <div className={rendererClassName}>
      <div className={shellClassName} style={{ backgroundImage: "url(/images/arctic-background.png)" }}>
        <div className="additional-background" />
        {currentBoard ? (
            <>
              <div className="game-area game-variables-container topbar-variables-container">
                <MetricCluster metrics={metrics} variant="topbar" fallbackMetrics={fallbackMetrics} />
              </div>
              <div className="game-area main-content-area topbar-main-content">
                <div className="game-area topbar-board-header">
                  <article className="game-card">
                    <p className="game-card-text">{currentBoard.title}</p>
                    {currentBoard.body ? <RichText className="fallback-copy" html={currentBoard.body} /> : null}
                  </article>
                </div>

                <div className="game-area cards-container topbar-cards-container">
                  {boardCards.map((card) => {
                    const cardState = cardFlags[card.cardId] ?? {};
                    const isLocked = cardState.locked === true;
                    const isSelected = cardState.selected === true || selectedCardId === card.cardId;
                    const isResolved = cardState.resolved === true;
                    const isDisabled = isPending || !sessionId || isLocked || isSelected;

                    return (
                      <article
                        key={card.cardId}
                        className={`game-card fallback-card${isSelected ? " fallback-card-selected" : ""}${
                          isLocked ? " fallback-card-locked" : ""
                        }`}
                        onClick={() => !isDisabled && dispatchAction(card.selectActionId)}
                        onKeyDown={(e) => {
                          if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            dispatchAction(card.selectActionId);
                          }
                        }}
                        role="button"
                        tabIndex={isDisabled ? -1 : 0}
                        aria-disabled={isDisabled}
                        aria-label={card.selectLabel ?? "Выбрать"}
                      >
                        <div className="fallback-card-head">
                          <strong>{card.title}</strong>
                          <span className="chip">#{card.cardId}</span>
                        </div>
                        <p className="game-card-text">{card.summary}</p>
                        <div className="fallback-card-meta">
                          {isSelected ? <span className="chip">selected</span> : null}
                          {isResolved ? <span className="chip">resolved</span> : null}
                          {isLocked ? <span className="chip">locked</span> : null}
                        </div>
                        {/* Visually hidden but accessible - card itself is primary interaction target */}
                        <button
                          className="action-button"
                          type="button"
                          onClick={() => dispatchAction(card.selectActionId)}
                          disabled={isDisabled}
                          tabIndex={-1}
                        >
                          {card.selectLabel ?? "Выбрать"}
                        </button>
                      </article>
                    );
                  })}
                </div>

                {selectedCard && selectedCard.advanceActionId && canAdvance ? (
                  <div className="game-area info-bottom-controls">
                    <button
                      className="action-button game-button"
                      type="button"
                      onClick={() => dispatchAction(selectedCard.advanceActionId!)}
                      disabled={isPending || !sessionId}
                    >
                      {selectedCard.advanceLabel ?? "Продолжить"}
                    </button>
                  </div>
                ) : null}
              </div>
              {/* Panel buttons for topbar board screen - placed in grid row 3 */}
              <div className="button-container panel-buttons">
                <button id="btn-journal" className="button-helper" type="button" onClick={() => dispatchAction("showHistory")} disabled={isPending || !sessionId} style={{ backgroundImage: "url(/images/jurnal-hodov.png)", backgroundSize: "cover" }}>
                  журнал ходов
                </button>
                <button id="btn-hint" className="button-helper" type="button" onClick={() => dispatchAction("showHint")} disabled={isPending || !sessionId} style={{ backgroundImage: "url(/images/podskazka.png)", backgroundSize: "cover" }}>
                  подсказка
                </button>
                <button id="nav-left" className="button-helper-arrow" type="button" disabled style={{ backgroundImage: "url(/images/arrow-left.png)", backgroundSize: "contain" }}>
                  Назад
                </button>
                <button id="nav-right" className="button-helper-arrow" type="button" disabled style={{ backgroundImage: "url(/images/arrow-right.png)", backgroundSize: "contain" }}>
                  Вперед
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={`game-area game-variables-container${layoutMode === "topbar" ? " topbar-variables-container" : ""}`}>
                <MetricCluster metrics={metrics} variant={layoutMode === "topbar" ? "topbar" : "sidebar"} fallbackMetrics={fallbackMetrics} />
              </div>
              <div className={`game-area main-content-area${layoutMode === "topbar" ? " topbar-main-content" : ""}`}>
                {currentInfo ? (
                  <>
                    <div className="game-area info-content">
                      <article className="info-event-card">
                        <div className="info-event-illustration" />
                        <div className="info-event-text">
                          <article className="game-card">
                            <p className="game-card-text">{currentInfo.title}</p>
                          </article>
                          <RichText className="fallback-copy" html={currentInfo.body} />
                          <div className="fallback-card-meta">
                            <span className="chip">info: {currentInfo.id}</span>
                            <span className="chip">step: {currentInfo.stepIndex}</span>
                          </div>
                        </div>
                      </article>
                    </div>
                    <div className="game-area bottom-controls-container info-bottom-controls">
                      <button
                        className="action-button game-button"
                        type="button"
                        onClick={() => dispatchAction(currentInfo.advanceActionId)}
                        disabled={isPending || !sessionId}
                      >
                        {currentInfo.advanceLabel ?? "Продолжить"}
                      </button>
                    </div>
                  </>
                ) : currentTeamSelection ? (
                  <>
                    <div className="game-area cards-container team-cards-container">
                      {currentTeamSelection.members.map((member) => {
                        const flags = teamFlags[member.memberId] ?? {};
                        const isSelected = flags.selected === true || selectedMemberIds.includes(member.memberId);
                        const isPickLimitReached = pickCount >= currentTeamSelection.requiredPickCount;

                        return (
                          <article
                            key={member.memberId}
                            className={`game-card fallback-card${isSelected ? " fallback-card-selected" : ""}`}
                          >
                            <div className="fallback-card-head">
                              <strong>{member.name}</strong>
                              <span className="chip">#{member.memberId}</span>
                            </div>
                            <p className="game-card-text">{member.summary}</p>
                            <div className="fallback-card-meta">
                              {isSelected ? <span className="chip">selected</span> : null}
                              {isPickLimitReached && !isSelected ? <span className="chip">limit reached</span> : null}
                            </div>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(member.selectActionId)}
                              disabled={isPending || !sessionId || isSelected || isPickLimitReached}
                            >
                              {member.selectLabel ?? "Выбрать"}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                    <div className="game-area bottom-controls-container team-controls">
                      <article className="game-card fallback-summary-card">
                        <p className="game-card-text">{currentTeamSelection.title}</p>
                        <RichText className="fallback-copy" html={currentTeamSelection.body} />
                        <div className="fallback-card-meta">
                          <span className="chip">team-selection: {currentTeamSelection.id}</span>
                          <span className="chip">
                            picked: {pickCount}/{currentTeamSelection.requiredPickCount}
                          </span>
                        </div>
                      </article>
                      <button
                        className="action-button game-button"
                        type="button"
                        onClick={() => dispatchAction(currentTeamSelection.confirmActionId)}
                        disabled={isPending || !sessionId || pickCount !== currentTeamSelection.requiredPickCount}
                      >
                        {currentTeamSelection.confirmLabel ?? "Подтвердить"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`game-area cards-container${layoutMode === "topbar" ? " topbar-cards-container" : ""} action-cards-container`}>
                      {fallbackActions.length > 0 ? (
                        fallbackActions.map((action) => (
                          <article key={action.actionId} className="game-card fallback-card">
                            <div className="fallback-card-head">
                              <strong>{action.displayName}</strong>
                              <span className="chip">action</span>
                            </div>
                            <p className="game-card-text">
                              Экран еще не описан в UI manifest, поэтому доступен безопасный runtime fallback.
                            </p>
                            <div className="fallback-card-meta">
                              <span className="chip">Fallback action catalog</span>
                              {action.capabilityFamily ? <span className="chip">{action.capabilityFamily}</span> : null}
                            </div>
                            <button
                              className="action-button"
                              type="button"
                              onClick={() => dispatchAction(action.actionId)}
                              disabled={isPending || !sessionId}
                            >
                              Открыть
                            </button>
                          </article>
                        ))
                      ) : (
                        <article className="game-card fallback-summary-card">
                          <p className="game-card-text">Fallback action catalog</p>
                          <p className="fallback-copy">
                            Экран еще не сопоставлен с manifest. Runtime state продолжает работать, но для этой сцены
                            нет явных карточек действий.
                          </p>
                        </article>
                      )}
                    </div>
                    <div className="game-area bottom-controls-container team-controls">
                      <article className="game-card fallback-summary-card">
                        <p className="game-card-text">{content.name}</p>
                        <p className="fallback-copy">
                          {content.description}
                        </p>
                        <div className="fallback-card-meta">
                          <span className="chip">runtime: {runtimeApiUrl}</span>
                          <span className="chip">players: {content.playerConfig.min}-{content.playerConfig.max}</span>
                          <span className="chip">locale: {content.locale}</span>
                        </div>
                      </article>
                    </div>
                  </>
                )}
              </div>
              {layoutMode === "leftsidebar" && (
                <div className="game-area button-container panel-buttons">
                  <PanelButtonRow onJournal={onJournal ?? (() => {})} onHint={onHint ?? (() => {})} layoutMode="leftsidebar" />
                </div>
              )}
            </>
          )}
      </div>
    </div>
  );
}
