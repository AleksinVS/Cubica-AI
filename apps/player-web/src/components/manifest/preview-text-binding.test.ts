import { describe, expect, it } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { withPreviewContentOrigin } from "@/lib/preview-content-origin";
import { resolvePreviewMetricBinding, resolvePreviewTextBinding, resolvePreviewTextBindingEvidence } from "./preview-text-binding";

function content(data: Record<string, unknown>): PlayerFacingContent {
  return {
    gameId: "neutral-preview",
    version: "1.0.0",
    name: "Neutral preview",
    description: "Binding test",
    locale: "en-US",
    playerConfig: { min: 1, max: 1 },
    actions: [],
    mockups: [],
    content: { data }
  };
}

describe("producer-supplied preview provenance", () => {
  it("uses the exact selected object's origin even when another object has the same id and text", () => {
    const selected = withPreviewContentOrigin({ id: "intro", title: "Opening" }, {
      runtimePointer: "/content/data/infos/1", fields: ["title"]
    });
    expect(resolvePreviewTextBinding({
      props: { html: "{{currentInfo.title}}" },
      gameState: { currentInfo: selected },
      content: content({ infos: [{ id: "intro", title: "Opening" }, selected] })
    })).toEqual({ prop: "html", expression: "{{currentInfo.title}}",
      contentRuntimePointer: "/content/data/infos/1/title" });
    expect(resolvePreviewTextBindingEvidence({
      props: { html: "{{currentInfo.title}}" },
      gameState: { currentInfo: selected },
      content: content({ infos: [{ id: "intro", title: "Opening" }, selected] })
    })).toEqual({
      textBinding: { prop: "html", expression: "{{currentInfo.title}}",
        contentRuntimePointer: "/content/data/infos/1/title" },
      contentRuntimePointer: "/content/data/infos/1"
    });
  });

  it("never upgrades an equal, transformed, or unmarked value into a writable source", () => {
    const source = content({ infos: [{ id: "intro", title: "Opening" }] });
    const binding = { props: { html: "{{currentInfo.title}}" }, content: source };
    expect(resolvePreviewTextBinding({ ...binding, gameState: { currentInfo: { id: "intro", title: "Opening" } } }))
      .toEqual({ prop: "html", expression: "{{currentInfo.title}}" });
    expect(resolvePreviewTextBindingEvidence({ ...binding, gameState: { currentInfo: { id: "intro", title: "Opening" } } }))
      .toEqual({ textBinding: { prop: "html", expression: "{{currentInfo.title}}" } });
    const transformed = withPreviewContentOrigin({ title: "Opening" }, {
      runtimePointer: "/content/data/infos/0", fields: ["body"]
    });
    expect(resolvePreviewTextBinding({ ...binding, gameState: { currentInfo: transformed } }))
      .toEqual({ prop: "html", expression: "{{currentInfo.title}}" });
    const selected = withPreviewContentOrigin({ title: "Opening" }, {
      runtimePointer: "/content/data/infos/0", fields: ["title"]
    });
    expect(resolvePreviewTextBinding({ ...binding, gameState: { currentInfo: selected },
      props: { html: "<h1>{{currentInfo.title}}</h1>" } }))
      .toEqual({ prop: "html", expression: "<h1>{{currentInfo.title}}</h1>" });
    expect(resolvePreviewTextBinding({ ...binding, gameState: { currentInfo: selected },
      props: { html: "{{currentInfo.title || 'Fallback'}}" } }))
      .toEqual({ prop: "html", expression: "{{currentInfo.title || 'Fallback'}}" });
  });

  it("uses the local itemTemplate object rather than a same-named global binding", () => {
    const item = withPreviewContentOrigin({ cardId: "c1", summary: "Same" }, {
      runtimePointer: "/content/data/cards/3", fields: ["summary"]
    });
    expect(resolvePreviewTextBinding({
      props: { text: "{{card.summary}}" },
      content: content({ cards: [{ cardId: "c1", summary: "Same" }, item] }),
      gameState: { card: { cardId: "c1", summary: "Same" } },
      localContext: { card: item }
    })?.contentRuntimePointer).toBe("/content/data/cards/3/summary");
  });

  it("identifies a computed rule owner without claiming its result is writable", () => {
    const result = resolvePreviewMetricBinding({ metricId: "days" }, content({ metrics: [{
      metricId: "days", kind: "computed", computed: { expression: { "-": [8, 1] } }
    }] }));
    expect(result).toEqual({
      prop: "value", expression: "{{metrics.days}}", metricId: "days",
      metricRuntimePointer: "/content/data/metrics/0",
      ruleRuntimePointer: "/content/data/metrics/0/computed/expression"
    });
    expect(resolvePreviewMetricBinding({ metricId: "days" }, content({ metrics: [
      { metricId: "days" }, { metricId: "days" }
    ] }))).toBeUndefined();
    expect(resolvePreviewMetricBinding({ metricId: "days", value: "{{metrics.other}}" },
      content({ metrics: [{ metricId: "days", kind: "computed", computed: { expression: 7 } }] })))
      .toEqual({ prop: "value", expression: "{{metrics.other}}" });
  });
});
