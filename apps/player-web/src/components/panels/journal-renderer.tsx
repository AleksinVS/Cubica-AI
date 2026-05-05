import { useRef } from "react";
import type { MetricsSnapshot, RuntimeLogEntry } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { PanelButtonRow } from "./panel-button-row";
import { JournalMetricCluster } from "./journal-metric-cluster";

/**
 * Преобразует запись лога runtime в пользовательскую запись журнала.
 *
 * Записи поступают по двум путям:
 * - Из манифеста (deterministic handlers): имеют kind и summary.
 * - Из runtime UI (buildTransition): имеют actionId, capability, capabilityFamily, at.
 *
 * Журнал показывает только игровые события и пропускает чистые UI-взаимодействия.
 */
function mapToJournalEntry(entry: RuntimeLogEntry): { title: string; subtitle: string; time: string } | null {
  const kind = (entry as Record<string, unknown>).kind as string | undefined;
  const summary = (entry as Record<string, unknown>).summary as string | undefined;
  const isManifestDriven = !!(kind && summary);

  if (!isManifestDriven) {
    if (
      entry.capabilityFamily === "ui.panel" ||
      entry.capabilityFamily === "ui.screen" ||
      entry.capabilityFamily === "runtime.server" ||
      entry.actionId === "requestServer"
    ) {
      return null;
    }
  }

  if (isManifestDriven) {
    let typeLabel = "";
    if (kind === "opening-card-advance") {
      typeLabel = "Карточка";
    } else if (kind === "opening-info-advance") {
      typeLabel = "Инфо";
    } else if (kind === "team-selection") {
      typeLabel = "Команда";
    } else if (kind === "board-advance") {
      typeLabel = "Доска";
    } else {
      typeLabel = kind.replace(/-/g, " ").replace(/_/g, " ");
    }

    const cardIdMatch = summary.match(/Карточка\s*(\d+)/);
    const infoIdMatch = summary.match(/i\d+(?:_\d+)?/);
    if (cardIdMatch) {
      return { title: `${typeLabel} ${cardIdMatch[1]}`, subtitle: summary, time: "" };
    }
    if (infoIdMatch) {
      return { title: `${typeLabel} ${infoIdMatch[0]}`, subtitle: summary, time: "" };
    }

    return { title: typeLabel, subtitle: summary, time: "" };
  }

  const actionId = entry.actionId ?? "unknown";
  let title = actionId;
  if (actionId.startsWith("opening.card.")) {
    const cardId = actionId.replace("opening.card.", "").replace(".advance", "");
    title = `Карточка ${cardId}`;
  } else if (actionId.startsWith("opening.info.")) {
    const infoId = actionId.replace("opening.info.", "").replace(".advance", "");
    title = `Инфо ${infoId}`;
  } else if (actionId.startsWith("opening.team.")) {
    title = "Команда";
  } else if (actionId === "showHistory") {
    title = "Журнал";
  } else if (actionId === "showHint") {
    title = "Подсказка";
  } else if (actionId.includes(".")) {
    const parts = actionId.split(".");
    title = parts[parts.length - 1].replace(/_/g, " ");
  }

  const capability = entry.capability ?? entry.capabilityFamily ?? "";
  const subtitle =
    typeof entry.payload === "string" && entry.payload.length > 0
      ? entry.payload
      : capability;

  let time = "";
  if (entry.at) {
    try {
      const date = new Date(entry.at);
      time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    } catch {
      time = "";
    }
  }

  return { title, subtitle, time };
}

/**
 * Рендерит overlay журнала ходов (history).
 */
export function JournalRenderer({
  metrics,
  log,
  onJournal,
  onHint,
  onClose,
  fallbackMetrics
}: {
  metrics: MetricsSnapshot;
  log: Array<RuntimeLogEntry>;
  onJournal: () => void;
  onHint: () => void;
  onClose?: () => void;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      onClose?.();
    }
  };

  const journalEntries = log
    .map((entry) => mapToJournalEntry(entry))
    .filter((entry): entry is { title: string; subtitle: string; time: string } => entry !== null);

  const MOCK_ENTRIES: Array<{ text: string }> = [
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" },
    { text: "Но на айсберге пингвины были как в крепости, большинство хищников не могли до них добраться, кроме того, айсберг служил надежным убежищем от зимних ледяных штормов благодаря своим размерам и наличию" }
  ];

  const sourceEntries = journalEntries.length > 0 ? journalEntries : MOCK_ENTRIES;
  const displayEntries: Array<{ text: string } | { title: string; subtitle: string; time: string }> = sourceEntries.slice(0, 4);
  while (displayEntries.length < 4) {
    displayEntries.push(MOCK_ENTRIES[displayEntries.length % MOCK_ENTRIES.length]);
  }
  const firstHalf = displayEntries.slice(0, 2);
  const secondHalf = displayEntries.slice(2, 4);

  return (
    <div className="game-renderer">
      <div className="game-screen main-screen journal-screen" onClick={handleOverlayClick}>
        <div className="journal-main-content">
          <div className="journal-container" ref={containerRef}>
            <h1 className="heading-h1">Журнал ходов</h1>
            <div className="journal-entries">
              {firstHalf.map((entry, entryIndex) => (
                <article key={`journal-entry-${entryIndex}`} className="game-card journal-entry-card">
                  {"text" in entry ? entry.text : entry.subtitle || entry.title}
                </article>
              ))}
            </div>
            <div className="journal-variables-container">
              <JournalMetricCluster metrics={metrics} fallbackMetrics={fallbackMetrics} />
            </div>
          </div>
          <div className="journal-container">
            <div className="journal-entries">
              {secondHalf.map((entry, entryIndex) => (
                <article key={`journal-entry-second-${entryIndex}`} className="game-card journal-entry-card">
                  {"text" in entry ? entry.text : entry.subtitle || entry.title}
                </article>
              ))}
            </div>
            <div className="journal-variables-container">
              <JournalMetricCluster metrics={metrics} fallbackMetrics={fallbackMetrics} />
            </div>
          </div>
          <PanelButtonRow onJournal={onJournal} onHint={onHint} layoutMode="topbar" showArrows={false} />
        </div>
      </div>
    </div>
  );
}
