import type { MetricsSnapshot } from "@/types/game-state";
import { resolveExpression } from "@/lib/expression-resolver";

/**
 * Разрешает выражение привязки метрики, например "{{game.state.public.metrics.score}}",
 * против снимка метрик.
 *
 * Делегирует к контекстному expression resolver для поддержки
 * расширенных выражений (path binding, context binding, fallbacks).
 */
export function resolveMetricBinding(expression: string, metrics: MetricsSnapshot): string {
  const result = resolveExpression(expression, { public: { metrics: metrics } });
  // resolveExpression returns "" for missing paths; preserve "—" contract
  return result === "" ? "—" : result;
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