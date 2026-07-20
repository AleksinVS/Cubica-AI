/**
 * Security regression tests for immutable state-model metadata caches.
 *
 * The runtime may reuse lookup structures derived from a deeply frozen game
 * model, but it must never reuse a verdict about mutable session state. These
 * neutral fixtures validate that boundary without depending on any one game.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { StateModel } from "@cubica/contracts-manifest";

import { RUNTIME_BUDGETS } from "../src/modules/mechanics/budget.ts";
import { assertStateMatchesModel } from "../src/modules/mechanics/stateModel.ts";

type JsonRecord = Record<string, unknown>;

/** Mirror production admission's deep freeze for the small JSON test model. */
function deepFreezeJson<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeJson(child, seen);
  }
  return Object.freeze(value);
}

function createFrozenStateModel(): StateModel {
  return deepFreezeJson({
    types: {
      "core.boolean": { kind: "boolean" },
      "core.integer": { kind: "integer", minimum: 0, maximum: 100 },
      "core.string": { kind: "string" }
    },
    endpoints: {
      counter: {
        audienceRef: "public",
        storage: { root: "public", segments: ["counter"] },
        valueType: "core.integer",
        access: "read-write"
      }
    },
    collections: {
      entities: {
        audienceRef: "public",
        storage: { root: "public", segments: ["entities"] },
        capacity: 8,
        stableKey: "map-key",
        itemTypes: ["fixture.piece"],
        fields: {
          active: {
            storage: { kind: "facet", name: "active" },
            valueType: "core.boolean",
            access: "read-write"
          },
          score: {
            storage: { kind: "attribute", name: "score" },
            valueType: "core.integer",
            access: "read-write"
          }
        }
      },
      records: {
        itemShape: "record",
        audienceRef: "public",
        storage: { root: "public", segments: ["records"] },
        capacity: 8,
        stableKey: "map-key",
        fields: {
          score: {
            storage: { kind: "path", path: ["metrics", "score"] },
            valueType: "core.integer",
            access: "read-write"
          },
          status: {
            storage: { kind: "path", path: ["status"] },
            valueType: "core.string",
            access: "read-only"
          }
        }
      }
    },
    events: {}
  } satisfies StateModel);
}

function createState(): JsonRecord {
  return {
    public: {
      counter: 1,
      entities: {
        alpha: {
          objectType: "fixture.piece",
          facets: { active: true },
          attributes: { score: 3 }
        }
      },
      records: {
        alpha: {
          metrics: { score: 3 },
          status: "ready"
        }
      }
    },
    secret: {},
    players: {}
  };
}

test("frozen model metadata never caches a session-state validation result", () => {
  const stateModel = createFrozenStateModel();
  const state = createState();
  const context = {
    stateModel,
    state,
    preActionState: state,
    params: {},
    actor: { sessionRole: "facilitator" as const },
    limits: RUNTIME_BUDGETS["turn-based-standard-v1"]
  };

  assert.doesNotThrow(() => assertStateMatchesModel(context));

  // The second call reuses model metadata but must inspect the changed endpoint.
  (state.public as JsonRecord).counter = "invalid";
  assert.throws(
    () => assertStateMatchesModel(context),
    { code: "MECHANICS_VALUE_TYPE_MISMATCH" }
  );
  (state.public as JsonRecord).counter = 1;

  // Closed entity areas remain checked after their declared-name sets are cached.
  const entity = (((state.public as JsonRecord).entities as JsonRecord).alpha as JsonRecord);
  (entity.attributes as JsonRecord).undeclared = true;
  assert.throws(
    () => assertStateMatchesModel(context),
    { code: "MECHANICS_ENTITY_FIELD_UNDECLARED" }
  );
  delete (entity.attributes as JsonRecord).undeclared;

  // Closed record paths likewise remain checked after their path tree is cached.
  const record = (((state.public as JsonRecord).records as JsonRecord).alpha as JsonRecord);
  (record.metrics as JsonRecord).undeclared = true;
  assert.throws(
    () => assertStateMatchesModel(context),
    { code: "MECHANICS_ENTITY_FIELD_UNDECLARED" }
  );
});
