import { describe, expect, it } from "vitest";
import type { EditorEntityProjectionDocument } from "@cubica/editor-engine";

import { collectEntityTypeOptions } from "./entity-create-options";

/**
 * Unit tests for the «+» create-menu option source (Phase 6.2a, part B). They
 * assert the options are read DECLARATIVELY — prototypes from `_definitions`,
 * types from instance `_type` values — with `_requiresView` driving the visual
 * mark, and no hardcoded type list (the fixture uses arbitrary game-agnostic keys).
 */
describe("collectEntityTypeOptions", () => {
  const documents: readonly EditorEntityProjectionDocument[] = [
    {
      filePath: "game.authoring.json",
      documentKind: "game",
      json: {
        _definitions: {
          "core.metric": { _semantics: "A metric" },
          "ui.MetricBar": { _requiresView: { channels: ["web"] } }
        },
        root: { content: { hp: { id: "hp", _type: "core.metric" }, timer: { id: "t", _type: "core.timer" } } }
      }
    },
    {
      filePath: "ui/web.authoring.json",
      documentKind: "ui",
      channel: "web",
      json: { _channel: "web", root: { children: [{ id: "hp", _type: "ui.MetricBar", gameEntityId: "hp" }] } }
    }
  ];

  it("lists prototypes and bare types with visuality resolved for the channel", () => {
    const options = collectEntityTypeOptions({ documents, channel: "web" });
    const byKey = new Map(options.map((option) => [option.key, option]));

    expect(byKey.get("ui.MetricBar")).toMatchObject({ kind: "prototype", isVisual: true });
    expect(byKey.get("core.metric")).toMatchObject({ kind: "prototype", isVisual: false });
    // `core.timer` is only used as an instance `_type` (no definition) → a bare type.
    expect(byKey.get("core.timer")).toMatchObject({ kind: "type", isVisual: false });
  });

  it("treats a channel-scoped view as non-visual for a different channel", () => {
    const options = collectEntityTypeOptions({ documents, channel: "telegram" });
    expect(options.find((option) => option.key === "ui.MetricBar")?.isVisual).toBe(false);
  });
});
