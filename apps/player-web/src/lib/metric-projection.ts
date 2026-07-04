import type {
  GameManifestComputedMetricDefinition,
  GameManifestMetricDefinition,
  GameMetricView,
  JsonLogicExpression,
  PlayerFacingContent
} from "@cubica/contracts-manifest";
import type { MetricsSnapshot } from "@/types/game-state";

/**
 * Builds player-facing metric values from the game-owned metric catalog.
 *
 * The catalog is still validated by JSON Schema on the manifest boundary. The
 * checks in this file are defensive DTO reads, not a replacement for schema
 * validation: player-web receives JSON over HTTP and must tolerate missing
 * optional fields while rendering fallback states.
 */

type MetricContext = {
  public: Record<string, unknown>;
  content: Record<string, unknown>;
  metrics: MetricsSnapshot;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const contentDataOf = (content: PlayerFacingContent): Record<string, unknown> => {
  const data = content.content?.data;
  return isRecord(data) ? data : {};
};

const isMetricDefinition = (value: unknown): value is GameManifestMetricDefinition => {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.metricId !== "string" || typeof value.label !== "string") {
    return false;
  }
  if (value.kind === "state") {
    return typeof value.statePath === "string";
  }
  if (value.kind === "computed") {
    return isRecord(value.computed) && "expression" in value.computed;
  }
  return false;
};

export const readMetricCatalog = (content: PlayerFacingContent): Array<GameManifestMetricDefinition> => {
  const metrics = contentDataOf(content).metrics;
  return Array.isArray(metrics) ? metrics.filter(isMetricDefinition) : [];
};

const readPath = (source: Record<string, unknown>, path: string): unknown => {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
};

const asExpressionList = (value: JsonLogicExpression | Array<JsonLogicExpression>): Array<JsonLogicExpression> =>
  Array.isArray(value) ? value : [value];

const evaluateMath = (
  operator: "+" | "-" | "*" | "/" | "min" | "max",
  operand: JsonLogicExpression | Array<JsonLogicExpression>,
  context: MetricContext
): number | undefined => {
  const values = asExpressionList(operand)
    .map((entry) => toNumber(evaluateExpression(entry, context)));

  if (values.some((value) => value === undefined)) {
    return undefined;
  }

  const numbers = values as Array<number>;
  if (numbers.length === 0) {
    return undefined;
  }

  switch (operator) {
    case "+":
      return numbers.reduce((total, value) => total + value, 0);
    case "-":
      return numbers.length === 1
        ? -numbers[0]
        : numbers.slice(1).reduce((total, value) => total - value, numbers[0]);
    case "*":
      return numbers.reduce((total, value) => total * value, 1);
    case "/":
      return numbers.slice(1).reduce((total, value) => total / value, numbers[0]);
    case "min":
      return Math.min(...numbers);
    case "max":
      return Math.max(...numbers);
  }
};

const evaluateVar = (
  operand: JsonLogicExpression | Array<JsonLogicExpression>,
  context: MetricContext
): unknown => {
  if (typeof operand === "string") {
    return readPath(context, operand);
  }

  if (Array.isArray(operand) && typeof operand[0] === "string") {
    const value = readPath(context, operand[0]);
    return value === undefined ? operand[1] : value;
  }

  return undefined;
};

function evaluateExpression(expression: JsonLogicExpression, context: MetricContext): unknown {
  if (!isRecord(expression)) {
    return expression;
  }

  const entries = Object.entries(expression);
  if (entries.length !== 1) {
    return undefined;
  }

  const [operator, operand] = entries[0] as [
    string,
    JsonLogicExpression | Array<JsonLogicExpression>
  ];

  switch (operator) {
    case "var":
      return evaluateVar(operand, context);
    case "+":
    case "-":
    case "*":
    case "/":
    case "min":
    case "max":
      return evaluateMath(operator, operand, context);
    default:
      return undefined;
  }
}

const createContext = (
  publicState: Record<string, unknown>,
  contentData: Record<string, unknown>,
  metrics: MetricsSnapshot
): MetricContext => ({
  public: {
    ...publicState,
    metrics
  },
  content: contentData,
  metrics
});

const evaluateComputedMetric = (
  metric: GameManifestComputedMetricDefinition,
  publicState: Record<string, unknown>,
  contentData: Record<string, unknown>,
  metrics: MetricsSnapshot
): unknown => evaluateExpression(metric.computed.expression, createContext(publicState, contentData, metrics));

export function projectMetricsFromContent(
  content: PlayerFacingContent,
  publicState: Record<string, unknown>,
  rawMetrics: MetricsSnapshot
): MetricsSnapshot {
  const projectedMetrics: MetricsSnapshot = { ...rawMetrics };
  const contentData = contentDataOf(content);

  for (const metric of readMetricCatalog(content)) {
    if (metric.kind !== "computed") {
      continue;
    }

    const value = evaluateComputedMetric(metric, publicState, contentData, projectedMetrics);
    if (value !== undefined) {
      projectedMetrics[metric.metricId] = value;
    }
  }

  return projectedMetrics;
}

const formatMetricValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
};

export function projectMetricViewsFromContent(
  content: PlayerFacingContent,
  publicState: Record<string, unknown>,
  metrics: MetricsSnapshot
): Record<string, GameMetricView> {
  const contentData = contentDataOf(content);
  const metricViews: Record<string, GameMetricView> = {};

  for (const metric of readMetricCatalog(content)) {
    const context = createContext(publicState, contentData, metrics);
    const value = metric.kind === "state"
      ? readPath(context, metric.statePath)
      : metrics[metric.metricId] ?? evaluateComputedMetric(metric, publicState, contentData, metrics);

    metricViews[metric.metricId] = {
      metricId: metric.metricId,
      label: metric.label,
      description: metric.description,
      value,
      formattedValue: formatMetricValue(value),
      kind: metric.kind,
      statePath: metric.kind === "state" ? metric.statePath : undefined
    };
  }

  return metricViews;
}
