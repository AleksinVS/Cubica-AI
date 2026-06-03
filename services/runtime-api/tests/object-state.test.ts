import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  GameManifestActionDefinition,
  GameManifestObjectModelMap
} from "@cubica/contracts-manifest";
import type { RuntimeActionContext } from "@cubica/contracts-runtime";

import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";
import { createDeterministicHandler } from "../src/modules/runtime/deterministicHandlers.ts";

const objectModels = {
  "token.choice": {
    collection: "tokens",
    idField: "id",
    scope: "session",
    facets: {
      face: {
        initial: "front",
        values: ["front", "back"]
      },
      availability: {
        initial: "available",
        values: ["available", "locked"]
      }
    },
    view: {
      facets: {
        "face.front": { summaryFrom: "summary", visualState: "default" },
        "face.back": { summaryFrom: "backText", visualState: "resolved" },
        "availability.locked": { interactive: false, visualState: "locked" }
      }
    }
  },
  "resource.supply": {
    collection: "resources",
    idField: "id",
    scope: "session",
    facets: {
      availability: {
        initial: "available",
        values: ["available", "spent"]
      }
    }
  }
} satisfies GameManifestObjectModelMap;

const makeContext = (
  action: GameManifestActionDefinition,
  state: Record<string, unknown>
): RuntimeActionContext<any> => ({
  sessionId: "session-objects",
  gameId: "object-fixture",
  actionId: "object.resolve",
  state,
  now: new Date("2026-06-03T00:00:00.000Z"),
  manifestAction: {
    actionId: "object.resolve",
    handlerType: "manifest-data",
    raw: action as unknown as Record<string, unknown>
  }
});

test("deterministicHandler applies object guards and object effects across collections", async () => {
  const action = {
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "object-fixture.resolve",
    deterministic: {
      guard: {
        object: {
          visibility: "public",
          collection: "tokens",
          objectId: "choice-1",
          objectType: "token.choice",
          facets: {
            face: "front",
            availability: "available"
          }
        }
      },
      effects: [
        {
          op: "object.state.set",
          visibility: "public",
          collection: "tokens",
          objectId: "choice-1",
          facet: "face",
          value: "back"
        },
        {
          op: "object.attribute.patch",
          visibility: "public",
          collection: "tokens",
          objectId: "choice-1",
          patches: [
            { op: "replace", path: "/selectedBy", value: "player-web" },
            { op: "increment", path: "/uses", value: 1 }
          ]
        },
        {
          op: "object.create",
          visibility: "public",
          collection: "resources",
          objectId: "supply-1",
          objectType: "resource.supply",
          facets: {
            availability: "available"
          },
          attributes: {
            title: "Supply",
            amount: 1
          }
        }
      ]
    }
  } satisfies GameManifestActionDefinition;

  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    objectModels
  });
  const result = await handler(makeContext(action, {
    public: {
      objects: {
        tokens: {
          "choice-1": {
            objectType: "token.choice",
            facets: {
              face: "front",
              availability: "available"
            },
            attributes: {
              uses: 0
            }
          }
        },
        resources: {}
      },
      log: []
    },
    secret: {}
  }));

  assert.ok(result.ok, `Action failed: ${result.error?.message}`);
  const nextState = result.delta?.state as any;
  assert.equal(nextState.public.objects.tokens["choice-1"].facets.face, "back");
  assert.equal(nextState.public.objects.tokens["choice-1"].attributes.selectedBy, "player-web");
  assert.equal(nextState.public.objects.tokens["choice-1"].attributes.uses, 1);
  assert.equal(nextState.public.objects.resources["supply-1"].objectType, "resource.supply");
  assert.equal(nextState.public.objects.resources["supply-1"].attributes.amount, 1);
  assert.equal(result.effects?.filter((effect) => String(effect.value).startsWith("object.")).length, 3);
});

test("deterministicHandler rejects invalid object facet values without returning a state delta", async () => {
  const action = {
    handlerType: "manifest-data",
    capabilityFamily: "runtime.server",
    capability: "object-fixture.invalid",
    deterministic: {
      effects: [
        { op: "metric.add", metricId: "score", delta: 5 },
        {
          op: "object.state.set",
          visibility: "public",
          collection: "tokens",
          objectId: "choice-1",
          facet: "face",
          value: "sideways"
        }
      ]
    }
  } satisfies GameManifestActionDefinition;
  const state = {
    public: {
      metrics: { score: 0 },
      objects: {
        tokens: {
          "choice-1": {
            objectType: "token.choice",
            facets: { face: "front", availability: "available" },
            attributes: {}
          }
        }
      },
      log: []
    }
  };
  const handler = createDeterministicHandler("runtime.server", {
    mode: "manifest-action",
    objectModels
  });

  const result = await handler(makeContext(action, state));

  assert.equal(result.ok, false);
  assert.equal(result.delta, undefined);
  assert.equal((state.public.metrics as { score: number }).score, 0);
  assert.match(result.error?.message ?? "", /does not allow value/);
});

test("validateGameManifest accepts object models and object effects", () => {
  const manifest = validateGameManifest({
    meta: {
      id: "object-fixture",
      version: "1.0.0",
      name: "Object Fixture",
      description: "Object state schema fixture",
      schemaVersion: "1.1"
    },
    config: {
      players: { min: 1, max: 1 },
      settings: { mode: "singleplayer", locale: "en-US" }
    },
    objectModels,
    state: {
      public: {
        objects: {
          tokens: {
            "choice-1": {
              objectType: "token.choice",
              facets: { face: "front", availability: "available" },
              attributes: {}
            }
          }
        }
      }
    },
    actions: {
      "object.resolve": {
        handlerType: "manifest-data",
        deterministic: {
          guard: {
            object: {
              collection: "tokens",
              objectId: "choice-1",
              facets: { face: "front" }
            }
          },
          effects: [
            {
              op: "object.create",
              visibility: "public",
              collection: "resources",
              objectId: "supply-1",
              objectType: "resource.supply",
              attributes: { title: "Supply" }
            }
          ]
        }
      }
    }
  });

  assert.equal(manifest.objectModels?.["token.choice"].collection, "tokens");
});

test("validateGameManifest rejects unsupported player-scoped object models", () => {
  assert.throws(
    () =>
      validateGameManifest({
        meta: {
          id: "object-fixture",
          version: "1.0.0",
          name: "Object Fixture",
          description: "Object state schema fixture",
          schemaVersion: "1.1"
        },
        config: {
          players: { min: 1, max: 1 },
          settings: { mode: "singleplayer", locale: "en-US" }
        },
        objectModels: {
          "token.choice": {
            collection: "tokens",
            scope: "player",
            facets: {
              face: {
                initial: "front",
                values: ["front"]
              }
            }
          }
        },
        state: { public: {} },
        actions: {}
      }),
    /Schema validation failed/
  );
});
