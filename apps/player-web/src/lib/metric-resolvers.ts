import type { GamePlayerUiContent } from "@cubica/contracts-manifest";
import type { MetricsSnapshot, RuntimeUiState } from "@/types/game-state";
import { appendClassName } from "@/lib/classname-utils";

/**
 * Разрешает выражение привязки метрики, например "{{game.state.public.metrics.score}}",
 * против снимка метрик.
 */
export function resolveMetricBinding(expression: string, metrics: MetricsSnapshot): string {
  const match = expression.match(/^\{\{game\.state\.public\.metrics\.(\w+)\}\}$/);
  if (!match) {
    return expression;
  }
  const metricId = match[1];
  const value = metrics[metricId];
  return formatValue(value);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Ищет значение метрики по массиву алиасов.
 */
export function resolveMetricValueByAliases(metrics: MetricsSnapshot, aliases: Array<string>): string {
  for (const alias of aliases) {
    if (alias in metrics) {
      return formatValue(metrics[alias]);
    }
  }
  return "—";
}
