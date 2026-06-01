import { useRef } from "react";
import type { MetricsSnapshot, RuntimeLogEntry } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";
import { PanelButtonRow } from "./panel-button-row";
import { JournalMetricCluster } from "./journal-metric-cluster";

/**
 * Определяет, является ли запись лога выбором карточки.
 */
function isCardLogEntry(entry: RuntimeLogEntry): boolean {
  const hasVisibleCardText = Boolean(entry.frontText || entry.backText);
  const isCardEntry = entry.displayMode === "card" || entry.entityType === "card";
  const hasNeutralCardPayload = Boolean(entry.cardId && ((entry as Record<string, unknown>).summary || entry.backText));

  // The journal is player-facing: show card choices with visible card text, and
  // keep backend/system events or bare "continue" advances out of the panel.
  return isCardEntry || hasVisibleCardText || hasNeutralCardPayload;
}

/**
 * Извлекает cardId из записи лога.
 */
function resolveCardId(entry: RuntimeLogEntry): string | null {
  const explicit = (entry as Record<string, unknown>).cardId as string | undefined;
  if (explicit) return explicit;
  return null;
}

/**
 * Находит текст исходной и перевернутой карточки для записи журнала.
 */
function resolveCardTexts(
  entry: RuntimeLogEntry,
  gameState?: Record<string, unknown>,
  content?: PlayerFacingContent
): { frontText: string; backText: string } | null {
  const cardId = resolveCardId(entry);
  if (!cardId) return null;

  const boardCards = (gameState?.boardCards ?? []) as Array<
    Record<string, unknown> & { cardId: string; summary?: string; backText?: string }
  >;
  const manifestContent = (content as unknown as Record<string, unknown>)?.content as
    | Record<string, unknown>
    | undefined;
  const contentCards = (manifestContent?.data as Record<string, unknown>)?.cards as
    | Array<Record<string, unknown> & { cardId: string; summary?: string; backText?: string }>
    | undefined;

  const card = boardCards.find((c) => c.cardId === cardId) ?? contentCards?.find((c) => c.cardId === cardId);

  const frontText = entry.frontText ?? card?.summary ?? "";
  const backText = entry.backText ?? (entry as Record<string, unknown>).summary as string | undefined ?? (card?.backText as string | undefined) ?? "";

  // Allow rendering when either text is available or the card was resolved
  if (!frontText && !backText && !card) return null;

  return { frontText, backText };
}

/**
 * Рендерит overlay журнала ходов (history).
 * Показывает только выборы карточек: front text слева, back text справа,
 * а под ними метрики с изменениями (superscript diff).
 */
export function JournalRenderer({
  metrics,
  log,
  onJournal,
  onHint,
  onClose,
  fallbackMetrics,
  gameState,
  content
}: {
  metrics: MetricsSnapshot;
  log: Array<RuntimeLogEntry>;
  onJournal: () => void;
  onHint: () => void;
  onClose?: () => void;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
  gameState?: Record<string, unknown>;
  content?: PlayerFacingContent;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose?.();
    }
  };

  const cardEntries = log
    .filter(isCardLogEntry)
    .map((entry) => {
      const texts = resolveCardTexts(entry, gameState, content);
      if (!texts) return null;
      return {
        frontText: texts.frontText,
        backText: texts.backText,
        metricsBefore: (entry as Record<string, unknown>).metricsBefore as MetricsSnapshot | undefined,
        metricsAfter: (entry as Record<string, unknown>).metricsAfter as MetricsSnapshot | undefined,
        metricChanges: (entry as Record<string, unknown>).metricChanges as Array<{ metricId: string; delta: number }> | undefined,
        at: entry.at ?? ""
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div className="game-renderer">
      <div className="game-screen main-screen journal-screen" onClick={handleOverlayClick}>
        <div className="journal-main-content">
          <div className="journal-container" ref={containerRef}>
            <h1 className="heading-h1">Журнал ходов</h1>
            {cardEntries.length === 0 ? (
              <div className="journal-empty-state">
                <div className="journal-empty-card">Пока нет записей о выбранных карточках.</div>
              </div>
            ) : (
              <div className="journal-entries-list">
                {cardEntries.map((entry, index) => (
                  <article key={`journal-card-${index}`} className="game-card journal-entry-card">
                    <div className="journal-entry-columns">
                      <div className="journal-entry-front">
                        <div className="journal-entry-label">Исходная карточка</div>
                        <div className="journal-entry-text">{entry.frontText}</div>
                      </div>
                      <div className="journal-entry-divider" />
                      <div className="journal-entry-back">
                        <div className="journal-entry-label">Результат</div>
                        <div className="journal-entry-text">{entry.backText}</div>
                      </div>
                    </div>
                    <div className="journal-entry-metrics">
                      <JournalMetricCluster
                        metrics={entry.metricsAfter ?? metrics}
                        previousMetrics={entry.metricsBefore}
                        fallbackMetrics={fallbackMetrics}
                      />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
          <PanelButtonRow onJournal={onJournal} onHint={onHint} layoutMode="topbar" showArrows={false} />
        </div>
      </div>
    </div>
  );
}
