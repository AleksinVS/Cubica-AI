import { describe, expect, it } from "vitest";

import {
  isPlayerPreviewEntitiesMessage,
  isPlayerPreviewSessionSnapshotMessage,
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

  it("accepts only bounded player preview session snapshot messages", () => {
    expect(
      isPlayerPreviewSessionSnapshotMessage({
        source: "cubica-player-web",
        type: "previewSessionSnapshot",
        version: 2,
        sessionId: "session-1",
        gameId: "example",
        sessionVersion: {
          sessionId: "session-1",
          stateVersion: 2,
          lastEventSequence: 2
        },
        state: { public: { timeline: { stepIndex: 2 } } },
        action: {
          actionId: "advance",
          params: { source: "test" },
          timestamp: "2026-06-01T00:00:00.000Z"
        }
      })
    ).toBe(true);

    expect(
      isPlayerPreviewSessionSnapshotMessage({
        source: "cubica-player-web",
        type: "previewSessionSnapshot",
        version: 2,
        sessionId: "session-1",
        sessionVersion: {
          sessionId: "session-1",
          stateVersion: -1,
          lastEventSequence: 0
        },
        state: {}
      })
    ).toBe(false);
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

  it("reconstructs the exact authoring pointer under a verbatim subtree, without touching non-verbatim ancestors", () => {
    // A large literal subtree (e.g. authored polygon vertices) is published as
    // one recorded entry plus a `verbatimSubtrees` marker, instead of one
    // entry per vertex — see authoring-compiler.cjs's `isPositionalMatch`.
    const verbatimMap: PreviewSelectionSourceMap = {
      generatedFile: "games/example/game.manifest.json",
      sourceFile: "games/example/authoring/game.authoring.json",
      mappings: {
        "/networkModels": [
          { file: "games/example/authoring/game.authoring.json", pointer: "/root/networkModels" }
        ]
      },
      verbatimSubtrees: ["/networkModels"]
    };

    // A pointer several levels below the sole recorded entry is reconstructed
    // exactly (the recorded pointer plus the walked-past relative path), not
    // just resolved to the container's own pointer.
    expect(mapGeneratedPointerToAuthoring(verbatimMap, "/networkModels/main/regions/0/polygon/1/x")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/networkModels/main/regions/0/polygon/1/x"
    });

    // Querying the anchor pointer itself is unaffected (empty suffix).
    expect(mapGeneratedPointerToAuthoring(verbatimMap, "/networkModels")).toEqual({
      file: "games/example/authoring/game.authoring.json",
      pointer: "/root/networkModels"
    });

    // The pre-existing `sourceMap` fixture above has no `verbatimSubtrees` at
    // all, so an ancestor match there must keep returning the ancestor's own
    // pointer unchanged — appending would fabricate a pointer that was never
    // recorded. This is the identical-match (rule 1) case, and it must never
    // be confused with the verbatim (rule 2) one exercised above.
    expect(mapGeneratedPointerToAuthoring(sourceMap, "/screens/S1/root/somethingElse")).toEqual({
      file: "games/example/authoring/ui/web.authoring.json",
      pointer: "/root/screens/0/root"
    });
  });
});
