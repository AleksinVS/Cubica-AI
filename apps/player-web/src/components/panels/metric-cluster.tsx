import type {
  GameUiComponent,
  GameUiGameVariableComponentProps
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";
import type { FallbackMetricSpec } from "@/presenter/game-config";
import { resolveMetricValueByAliases } from "@/lib/metric-resolvers";
import { GameVariableComponent } from "@/components/manifest/game-variable-component";

/**
 * Кластер метрик (sidebar или topbar).
 * Рендерит fallback-спецификации метрик через GameVariableComponent.
 */
export function MetricCluster({
  metrics,
  variant,
  layoutMode,
  fallbackMetrics
}: {
  metrics: MetricsSnapshot;
  variant: "sidebar" | "topbar";
  layoutMode?: "leftsidebar" | "topbar";
  fallbackMetrics: ReadonlyArray<FallbackMetricSpec>;
}) {
  return (
    <>
      {fallbackMetrics.map((metric) => (
        <GameVariableComponent
          key={`${variant}-${metric.id}`}
          component={
            {
              type: "gameVariableComponent",
              id: metric.id,
              props: {
                caption: metric.caption,
                description: metric.description,
                value: resolveMetricValueByAliases(metrics, metric.aliases)
              }
            } as GameUiComponent<GameUiGameVariableComponentProps>
          }
          metrics={metrics}
          backgroundImage={variant === "topbar" ? metric.topbarImage : metric.sidebarImage}
          layoutMode={layoutMode ?? (variant === "topbar" ? "topbar" : "leftsidebar")}
        />
      ))}
    </>
  );
}
