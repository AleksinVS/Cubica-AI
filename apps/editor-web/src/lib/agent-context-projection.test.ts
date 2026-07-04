import { describe, expect, it } from "vitest";

import { buildEditorAgentContextProjection, isForbiddenAgentContextPath } from "./agent-context-projection";

describe("editor agent context projection", () => {
  it("projects only selected pointers instead of whole authoring documents", () => {
    const projection = buildEditorAgentContextProjection({
      sessionId: "session-1",
      gameId: "demo",
      activeFilePath: "game.authoring.json",
      activeFileVersionHash: "hash-1",
      document: {
        root: {
          title: "Visible title",
          untouched: "This field should not be sent because it is not selected."
        }
      },
      selectedPointers: ["/root/title"],
      diagnostics: []
    });

    expect(projection.source).toMatchObject({
      sessionId: "session-1",
      gameId: "demo",
      activeFilePath: "game.authoring.json"
    });
    expect(projection.selectedPointers).toEqual([
      {
        pointer: "/root/title",
        valueType: "string",
        excerpt: "Visible title",
        redacted: false
      }
    ]);
    expect(JSON.stringify(projection)).not.toContain("untouched");
  });

  it("redacts secret-like paths inside selected values", () => {
    const projection = buildEditorAgentContextProjection({
      gameId: "demo",
      activeFilePath: "game.authoring.json",
      document: {
        root: {
          public: "allowed",
          state: {
            secret: {
              token: "should-not-leak"
            }
          }
        }
      },
      selectedPointers: ["/root"],
      diagnostics: []
    });

    expect(projection.selectedPointers[0]?.redacted).toBe(true);
    expect(JSON.stringify(projection)).toContain("[redacted]");
    expect(JSON.stringify(projection)).not.toContain("should-not-leak");
  });

  it("limits diagnostics and long excerpts", () => {
    const projection = buildEditorAgentContextProjection({
      gameId: "demo",
      activeFilePath: "game.authoring.json",
      document: { root: { title: "A".repeat(100) } },
      selectedPointers: ["/root/title"],
      diagnostics: [
        { severity: "error", source: "schema", pointer: "/a", message: "one" },
        { severity: "warning", source: "semantic", pointer: "/b", message: "two" }
      ],
      maxDiagnostics: 1,
      maxExcerptLength: 16
    });

    expect(projection.diagnostics).toHaveLength(1);
    expect(projection.selectedPointers[0]?.excerpt).toBe("AAAAAAAAAAAAA...");
    expect(projection.limits.truncated).toBe(true);
  });

  it("projects selected editor entities as source pointers for AI context", () => {
    const projection = buildEditorAgentContextProjection({
      gameId: "demo",
      activeFilePath: "game.authoring.json",
      document: {
        root: {
          logic: {
            flows: [
              {
                steps: [
                  {
                    id: "main.start",
                    body: "This body is not selected and must not leak through entity metadata."
                  }
                ]
              }
            ]
          }
        }
      },
      selectedPointers: [],
      selectedEditorEntities: [
        {
          entityId: "game-step:main.start",
          kind: "game-step",
          label: "Start step",
          primarySource: {
            filePath: "game.authoring.json",
            pointer: "/root/logic/flows/0/steps/0",
            documentKind: "game",
            role: "step"
          },
          facets: {
            view: [
              {
                filePath: "ui/web.authoring.json",
                pointer: "/root/screens/0",
                documentKind: "ui",
                channel: "web",
                role: "screen",
                label: "Intro screen"
              }
            ]
          },
          diagnostics: []
        }
      ],
      diagnostics: []
    });

    expect(projection.selectedEditorEntities).toEqual([
      {
        entityId: "game-step:main.start",
        kind: "game-step",
        label: "Start step",
        primarySource: {
          filePath: "game.authoring.json",
          pointer: "/root/logic/flows/0/steps/0",
          documentKind: "game",
          role: "step"
        },
        facets: {
          view: [
            {
              filePath: "ui/web.authoring.json",
              pointer: "/root/screens/0",
              documentKind: "ui",
              channel: "web",
              role: "screen",
              label: "Intro screen"
            }
          ]
        }
      }
    ]);
    expect(JSON.stringify(projection)).not.toContain("This body is not selected");
  });

  it("recognizes forbidden context paths", () => {
    expect(isForbiddenAgentContextPath("/root/state/secret")).toBe(true);
    expect(isForbiddenAgentContextPath("/root/public/title")).toBe(false);
  });

  // Regression coverage for Finding 6 (false/silent truncation reporting).
  describe("limits.truncated accuracy (Finding 6)", () => {
    it("does not report truncation when duplicate pointers collapse under the limit", () => {
      // Three references to the SAME pointer dedup down to one, which is well within the
      // default `maxSelectedPointers` cap. Before the fix, `truncated` compared the raw
      // (pre-dedup) input length against the cap and could false-positive here.
      const projection = buildEditorAgentContextProjection({
        gameId: "demo",
        activeFilePath: "game.authoring.json",
        document: { root: { title: "Visible title" } },
        selectedPointers: ["/root/title", "/root/title", "/root/title"],
        diagnostics: []
      });

      expect(projection.selectedPointers).toHaveLength(1);
      expect(projection.limits.truncated).toBe(false);
    });

    it("reports truncation when the number of unique pointers genuinely exceeds the limit", () => {
      const projection = buildEditorAgentContextProjection({
        gameId: "demo",
        activeFilePath: "game.authoring.json",
        document: { root: { a: "1", b: "2", c: "3", d: "4" } },
        selectedPointers: ["/root/a", "/root/b", "/root/c", "/root/d"],
        diagnostics: [],
        maxSelectedPointers: 2
      });

      expect(projection.selectedPointers).toHaveLength(2);
      expect(projection.limits.truncated).toBe(true);
    });

    it("reports truncation when an array value is cut down by the item cap", () => {
      const items = Array.from({ length: 20 }, (_, index) => `item-${index}`);
      const projection = buildEditorAgentContextProjection({
        gameId: "demo",
        activeFilePath: "game.authoring.json",
        document: { root: { list: items } },
        selectedPointers: ["/root/list"],
        diagnostics: []
      });

      // The sliced excerpt (12 of 20 items) comfortably fits under the default excerpt
      // character cap, so the ONLY reason this can report truncation is the array item cap
      // applied inside redactAgentContextValue -- this is exactly the previously-silent site
      // called out in Finding 6.
      expect(JSON.stringify(projection.selectedPointers[0]?.excerpt).length).toBeLessThan(900);
      expect(projection.limits.truncated).toBe(true);
    });

    it("reports truncation when an object's keys are cut down by the key cap", () => {
      const manyKeys = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key${index}`, index]));
      const projection = buildEditorAgentContextProjection({
        gameId: "demo",
        activeFilePath: "game.authoring.json",
        document: { root: manyKeys },
        selectedPointers: ["/root"],
        diagnostics: []
      });

      expect(projection.limits.truncated).toBe(true);
    });
  });
});
