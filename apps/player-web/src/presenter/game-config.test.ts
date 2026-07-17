import { describe, expect, it } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";

import { createDefaultGameConfigData, createDefaultGameConfig } from "./game-config";
import { buildGameConfig } from "./game-config-registry";
import { resolveExpressions } from "@/lib/expression-resolver";
import { createManifestActionAdapter } from "@/lib/manifest-action-adapter";

const simpleChoiceContent: PlayerFacingContent = {
  gameId: "simple-choice",
  version: "1.0.0",
  name: "Simple Choice",
  description: "Test fixture",
  locale: "en-US",
  playerConfig: { min: 1, max: 1 },
  actions: [
    {
      actionId: "choice.accept",
      displayName: "Accept",
      capabilityFamily: "runtime.server",
      capability: "simple-choice.choice.accept",
    },
  ],
  mockups: [],
  content: {
    data: {
      choices: [{ id: "accept", actionId: "choice.accept" }],
    },
  },
  ui: {
    id: "simple-choice.ui.web",
    version: "1.0.0",
    gameId: "simple-choice",
    entryPoint: "intro",
    screens: {
      intro: {
        type: "screen",
        title: "Intro",
        layoutMode: "topbar",
        root: { type: "screenComponent", props: {}, children: [] },
      },
    },
    metricSpecs: [
      {
        id: "score",
        caption: "Score",
        value: "{{game.state.public.metrics.score}}",
        aliases: ["points"],
      },
    ],
  },
};

describe("default game config", () => {
  it("builds serializable data from player-facing content", () => {
    const data = createDefaultGameConfigData(simpleChoiceContent);

    expect(data.gameId).toBe("simple-choice");
    expect(data.storageKey).toBe("cubica-simple-choice-session-id");
    expect(data.fallbackMetrics).toEqual([
      {
        id: "score",
        caption: "Score",
        description: undefined,
        aliases: ["points"],
        sidebarImage: "",
        topbarImage: "",
      },
    ]);
    expect(data.topbarScreenKeys).toEqual(["intro"]);
    expect(data.themeBackgroundImage).toBeUndefined();
  });

  it("uses default resolvers when no plugin is registered", () => {
    const data = createDefaultGameConfigData(simpleChoiceContent);
    const config = buildGameConfig(data);

    expect(config.gameId).toBe("simple-choice");
    expect(config.resolveScreenKey).toBeUndefined();

    const state = config.resolveGameState(simpleChoiceContent, {
      sessionId: "s1",
      gameId: "simple-choice",
      version: { sessionId: "s1", stateVersion: 1, lastEventSequence: 0 },
      actionAvailability: [],
      state: {
        players: {
          p1: { metrics: { cash: 900, position: 0 } },
          p2: { metrics: { cash: 900, position: 0 } },
        },
        public: {
          metrics: { score: 0 },
          choice: { outcome: "pending" },
        },
        secret: {},
      },
    });

    expect(state.public).toEqual({
      metrics: { score: 0 },
      choice: { outcome: "pending" },
    });
    expect(state.players).toEqual({
      p1: { metrics: { cash: 900, position: 0 } },
      p2: { metrics: { cash: 900, position: 0 } },
    });
    expect(resolveExpressions(
      "Игрок 1: {{game.state.players.p1.metrics.cash}} монет",
      state
    )).toBe("Игрок 1: 900 монет");
    expect(state.content).toEqual({
      choices: [{ id: "accept", actionId: "choice.accept" }],
    });
  });

  it("dispatches explicit actionId from generic requestServer payload", () => {
    const dispatched: Array<{ actionId: string; payload?: Record<string, unknown> }> = [];
    const adapter = createManifestActionAdapter({
      dispatchAction: (actionId, payload) => dispatched.push({ actionId, payload }),
      onError: (message) => {
        throw new Error(message);
      }
    });

    adapter(ManifestAction.REQUEST_SERVER, { actionId: "choice.accept" });

    expect(dispatched).toEqual([
      {
        actionId: "choice.accept",
        payload: {},
      },
    ]);
  });

  it("passes flat schema-validated params from published requestServer metadata", () => {
    const dispatched: Array<{ actionId: string; payload?: Record<string, unknown> }> = [];
    const adapter = createManifestActionAdapter({
      dispatchAction: (actionId, payload) => dispatched.push({ actionId, payload }),
      onError: (message) => {
        throw new Error(message);
      }
    });

    adapter(ManifestAction.REQUEST_SERVER, {
      actionId: "property.buy",
      cellId: "cell-02"
    });

    expect(dispatched).toEqual([
      {
        actionId: "property.buy",
        payload: { cellId: "cell-02" }
      }
    ]);
  });

  it("rejects the removed nested payload.params action format", () => {
    const dispatched: Array<{ actionId: string; payload?: Record<string, unknown> }> = [];
    const errors: string[] = [];
    const adapter = createManifestActionAdapter({
      dispatchAction: (actionId, payload) => dispatched.push({ actionId, payload }),
      onError: (message) => errors.push(message)
    });

    adapter(ManifestAction.REQUEST_SERVER, {
      actionId: "property.buy",
      params: { cellId: "cell-02" }
    });

    expect(dispatched).toEqual([]);
    expect(errors).toEqual([
      "Manifest command \"requestServer\" uses the removed nested payload.params format; publish action parameters beside actionId."
    ]);
  });

  it("projects gameplay object state into UI-ready object views", () => {
    const data = createDefaultGameConfigData(simpleChoiceContent);
    const config = createDefaultGameConfig(data);
    const content: PlayerFacingContent = {
      ...simpleChoiceContent,
      objectModels: {
        "choice.card": {
          collection: "choices",
          idField: "id",
          scope: "session",
          facets: {
            face: {
              initial: "front",
              values: ["front", "back"],
            },
            availability: {
              initial: "available",
              values: ["available", "locked", "hidden"],
            },
          },
          view: {
            facets: {
              "face.front": { summaryFrom: "summary", visualState: "default" },
              "face.back": { summaryFrom: "backText", visualState: "resolved" },
              "availability.locked": { interactive: false, visualState: "locked" },
              "availability.hidden": { visible: false },
            },
          },
        },
      },
      content: {
        data: {
          choices: [
            {
              id: "accept",
              title: "Take the clear path",
              summary: "Front text",
              backText: "Back text",
              actionId: "choice.accept",
            },
            {
              id: "hidden",
              title: "Hidden choice",
              summary: "Should not render",
              actionId: "choice.hidden",
            },
          ],
        },
      },
    };

    const state = config.resolveGameState(content, {
      sessionId: "s1",
      gameId: "simple-choice",
      version: { sessionId: "s1", stateVersion: 1, lastEventSequence: 0 },
      actionAvailability: [],
      state: {
        public: {
          objects: {
            choices: {
              accept: {
                objectType: "choice.card",
                facets: { face: "back", availability: "locked" },
                attributes: {},
              },
              hidden: {
                objectType: "choice.card",
                facets: { face: "front", availability: "hidden" },
                attributes: {},
              },
            },
          },
        },
        secret: {},
      },
    }) as Record<string, unknown>;

    const objectViews = state.objectViews as { choices: Array<Record<string, unknown>> };
    expect(objectViews.choices).toHaveLength(1);
    expect(objectViews.choices[0]).toMatchObject({
      objectId: "accept",
      title: "Take the clear path",
      summary: "Back text",
      actionId: "choice.accept",
      visualState: "locked",
      interactive: false,
    });
  });

  it("does not derive a gameplay action from legacy object-view mappings", () => {
    const data = createDefaultGameConfigData(simpleChoiceContent);
    const config = createDefaultGameConfig(data);
    const content = {
      ...simpleChoiceContent,
      objectModels: {
        "choice.card": {
          collection: "choices",
          idField: "id",
          scope: "session",
          facets: {
            availability: {
              initial: "available",
              values: ["available"],
            },
          },
          view: {
            facets: {
              "availability.available": {
                // These two legacy forms deliberately bypass TypeScript so the
                // regression test continues to prove the runtime trust boundary
                // after the generated contract removes `actionIdFrom`.
                actionIdFrom: "attributes.nextActionId",
                fields: { actionId: "attributes.nextActionId" },
                titleFrom: "attributes.title",
              },
            },
          },
        },
      },
      content: {
        data: {
          choices: [{
            id: "accept",
            actionId: "choice.accept",
          }],
        },
      },
    } as unknown as PlayerFacingContent;

    const state = config.resolveGameState(content, {
      sessionId: "s1",
      gameId: "simple-choice",
      version: { sessionId: "s1", stateVersion: 1, lastEventSequence: 0 },
      actionAvailability: [],
      state: {
        public: {
          objects: {
            choices: {
              accept: {
                objectType: "choice.card",
                facets: { availability: "available" },
                attributes: {
                  nextActionId: "choice.unpublished",
                  title: "Projected title",
                },
              },
            },
          },
        },
        secret: {},
      },
    }) as Record<string, unknown>;

    const objectViews = state.objectViews as { choices: Array<Record<string, unknown>> };
    expect(objectViews.choices[0]).toMatchObject({
      actionId: "choice.accept",
      title: "Projected title",
    });
    expect(objectViews.choices[0]?.actionId).not.toBe("choice.unpublished");
  });
});
