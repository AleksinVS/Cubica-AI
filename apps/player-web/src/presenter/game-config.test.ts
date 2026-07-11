import { describe, expect, it } from "vitest";
import type { PlayerFacingContent } from "@cubica/contracts-manifest";
import { ManifestAction } from "@cubica/contracts-manifest";

import { createDefaultGameConfigData, createDefaultGameConfig } from "./game-config";
import { buildGameConfig } from "./game-config-registry";

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
      state: {
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
    expect(state.content).toEqual({
      choices: [{ id: "accept", actionId: "choice.accept" }],
    });
  });

  it("dispatches explicit actionId from generic requestServer payload", () => {
    const data = createDefaultGameConfigData(simpleChoiceContent);
    const config = createDefaultGameConfig(data);
    const dispatched: Array<{ actionId: string; payload?: Record<string, unknown> }> = [];
    const adapter = config.createManifestActionAdapter(
      simpleChoiceContent,
      {},
      (actionId, payload) => dispatched.push({ actionId, payload }),
      (message) => {
        throw new Error(message);
      }
    );

    adapter(ManifestAction.REQUEST_SERVER, { actionId: "choice.accept" });

    expect(dispatched).toEqual([
      {
        actionId: "choice.accept",
        payload: { actionId: "choice.accept" },
      },
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
});
