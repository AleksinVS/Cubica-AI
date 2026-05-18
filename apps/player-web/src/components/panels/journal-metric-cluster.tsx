import type { MetricsSnapshot } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { resolveMetricValueByAliases } from "@/lib/metric-resolvers";
import { JournalVariable } from "@cubica/sdk-shared";

/**
 * Компактный кластер метрик для журнала (только текст, без изображений).
 * Отображает diff значений через JournalVariable (superscript).
 */
export function JournalMetricCluster({
  metrics,
  previousMetrics,
  fallbackMetrics
}: {
  metrics: MetricsSnapshot;
  previousMetrics?: MetricsSnapshot;
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  return (
    <div className="journal-variables-container">
      {fallbackMetrics.map((metric) => {
        const value = resolveMetricValueByAliases(metrics, metric.aliases);
        const previousValue = previousMetrics
          ? resolveMetricValueByAliases(previousMetrics, metric.aliases)
          : undefined;
        return (
          <JournalVariable
            key={`journal-metric-${metric.id}`}
            value={value}
            previousValue={previousValue}
            caption={metric.caption}
          />
        );
      })}
    </div>
  );
}
