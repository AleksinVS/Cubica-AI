import { describe, expect, it } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";

import {
  projectMetricViewsFromContent,
  projectMetricsFromContent,
  readMetricCatalog
} from "./metric-projection";

const content: PlayerFacingContent = {
  gameId: "metric-fixture",
  version: "1.0.0",
  name: "Metric Fixture",
  description: "Metric projection fixture",
  locale: "ru-RU",
  playerConfig: { min: 1, max: 1 },
  actions: [],
  mockups: [],
  content: {
    data: {
      rules: {
        dayLimit: 60
      },
      metrics: [
        {
          metricId: "time",
          label: "Прошло дней",
          kind: "state",
          statePath: "public.metrics.time"
        },
        {
          metricId: "remainingDays",
          label: "Осталось дней",
          description: "Сколько игровых дней осталось до предельного срока.",
          kind: "computed",
          computed: {
            expression: {
              "-": [
                { var: "content.rules.dayLimit" },
                { var: "public.metrics.time" }
              ]
            }
          }
        },
        {
          metricId: "pro",
          label: "Знания",
          kind: "state",
          statePath: "public.metrics.pro"
        }
      ]
    }
  }
};

describe("metric projection", () => {
  it("reads the game-owned metric catalog from player-facing content", () => {
    expect(readMetricCatalog(content).map((metric) => metric.metricId)).toEqual([
      "time",
      "remainingDays",
      "pro"
    ]);
  });

  it("computes remainingDays without writing it into authoritative state", () => {
    const publicState = { metrics: { time: 12, pro: 5 } };
    const projectedMetrics = projectMetricsFromContent(content, publicState, publicState.metrics);

    expect(projectedMetrics).toEqual({
      time: 12,
      pro: 5,
      remainingDays: 48
    });
    expect(publicState.metrics).toEqual({ time: 12, pro: 5 });
  });

  it("projects metricViews with labels and descriptions from the catalog", () => {
    const publicState = { metrics: { time: 7, pro: 3 } };
    const projectedMetrics = projectMetricsFromContent(content, publicState, publicState.metrics);
    const metricViews = projectMetricViewsFromContent(content, publicState, projectedMetrics);

    expect(metricViews.remainingDays).toMatchObject({
      metricId: "remainingDays",
      label: "Осталось дней",
      description: "Сколько игровых дней осталось до предельного срока.",
      value: 53,
      formattedValue: "53",
      kind: "computed"
    });
    expect(metricViews.pro).toMatchObject({
      metricId: "pro",
      label: "Знания",
      value: 3,
      formattedValue: "3",
      kind: "state",
      statePath: "public.metrics.pro"
    });
  });
});
