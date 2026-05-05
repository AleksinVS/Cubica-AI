import type { MetricsSnapshot } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { resolveMetricValueByAliases } from "@/lib/metric-resolvers";

/**
 * Компактный кластер метрик для журнала (только текст, без изображений).
 */
export function JournalMetricCluster({
  metrics,
  fallbackMetrics
}: {
  metrics: MetricsSnapshot;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  return (
    <>
      {fallbackMetrics.map((metric) => {
        const value = resolveMetricValueByAliases(metrics, metric.aliases);
        return (
          <div key={`journal-metric-${metric.id}`} className="journal-variable-component">
            <div className="journal-variable__row">
              <span className="journal-variable__value">{value}</span>
            </div>
            <span className="journal-variable__caption">{metric.caption}</span>
          </div>
        );
      })}
    </>
  );
}
