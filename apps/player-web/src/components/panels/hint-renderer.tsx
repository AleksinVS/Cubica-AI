import { useRef } from "react";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import type { MetricsSnapshot, RuntimeLogEntry } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { MetricCluster } from "./metric-cluster";
import { PanelButtonRow } from "./panel-button-row";

/**
 * Рендерит overlay с подсказкой (hint).
 */
export function HintRenderer({
  content,
  metrics,
  log,
  onJournal,
  onHint,
  onClose,
  fallbackMetrics
}: {
  content: PlayerFacingContent;
  metrics: MetricsSnapshot;
  log: Array<RuntimeLogEntry>;
  onJournal: () => void;
  onHint: () => void;
  onClose?: () => void;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  const latestEntry = log[log.length - 1] ?? null;
  const hintText =
    (typeof latestEntry?.payload === "string" ? latestEntry.payload : null) ||
    content.description ||
    "Подсказка пока не загружена";
  const contentRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (contentRef.current && !contentRef.current.contains(e.target as Node)) {
      onClose?.();
    }
  };

  return (
    <div className="game-renderer">
      <div className="game-screen main-screen topbar-screen-shell hint-screen" onClick={handleOverlayClick}>
        <div className="additional-background" />
        <div className="game-area game-variables-container topbar-variables-container">
          <MetricCluster metrics={metrics} variant="topbar" fallbackMetrics={fallbackMetrics} />
        </div>
        <div className="game-area main-content-area topbar-main-content" ref={contentRef}>
          <div className="cards-container topbar-cards-container hint-cards">
            <div className="hint-area" />
            <p className="hint-text">{hintText}</p>
          </div>
        </div>
        <PanelButtonRow onJournal={onJournal} onHint={onHint} layoutMode="topbar" />
      </div>
    </div>
  );
}
