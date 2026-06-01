import { describe, expect, it } from "vitest";

import {
  isPlayerPreviewEntitiesMessage,
  mapGeneratedPointerToAuthoring,
  mapPlayerPreviewEntitiesToAuthoringDescriptors,
  sourceFileMatchesAuthoringFile,
  type PreviewSelectionSourceMap
} from "./preview-message-adapter";

const sourceMap: PreviewSelectionSourceMap = {
  generatedFile: "games/example/ui/web/ui.manifest.json",
  sourceFile: "games/example/authoring/ui/web.authoring.json",
  mappings: {
    "/screens/S1/root": [
      {
        file: "games/example/authoring/ui/web.authoring.json",
        pointer: "/root/screens/0/root"
      }
    ],
    "/screens/S1/root/children/0": [
      {
        file: "games/example/authoring/ui/web.authoring.json",
        pointer: "/root/screens/0/root/children/0"
      }
    ]
  }
};

describe("preview message adapter", () => {
  it("accepts only versioned player preview entity messages", () => {
    expect(
      isPlayerPreviewEntitiesMessage({
        source: "cubica-player-web",
        type: "previewEntities",
        version: 1,
        entities: []
      })
    ).toBe(true);

    expect(isPlayerPreviewEntitiesMessage({ source: "other", type: "previewEntities", version: 1, entities: [] })).toBe(false);
  });

  it("maps runtime pointers to authoring pointers through source maps", () => {
    expect(mapGeneratedPointerToAuthoring(sourceMap, "/screens/S1/root/children/0/props/caption")).toEqual({
      file: "games/example/authoring/ui/web.authoring.json",
      pointer: "/root/screens/0/root/children/0"
    });

    const result = mapPlayerPreviewEntitiesToAuthoringDescriptors(
      [
        {
          entityId: "metric",
          runtimePointer: "/screens/S1/root/children/0",
          label: "Metric",
          semanticRole: "gameVariableComponent",
          bounds: { x: 10, y: 20, width: 100, height: 50 }
        },
        {
          entityId: "unknown",
          runtimePointer: "/screens/S2/root",
          bounds: { x: 0, y: 0, width: 10, height: 10 }
        }
      ],
      [sourceMap],
      { currentAuthoringFile: "ui/web.authoring.json", gameId: "example" }
    );

    expect(result.descriptors).toEqual([
      expect.objectContaining({
        entityId: "metric",
        runtimePointer: "/screens/S1/root/children/0",
        authoringPointer: "/root/screens/0/root/children/0",
        label: "Metric"
      })
    ]);
    expect(result.unresolved.map((entity) => entity.entityId)).toEqual(["unknown"]);
  });

  it("matches repository-relative and authoring-relative file names", () => {
    expect(sourceFileMatchesAuthoringFile("games/example/authoring/ui/web.authoring.json", "ui/web.authoring.json", "example")).toBe(true);
    expect(sourceFileMatchesAuthoringFile("games/example/authoring/game.authoring.json", "ui/web.authoring.json", "example")).toBe(false);
  });
});
