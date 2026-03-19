import assert from "node:assert/strict";
import { test } from "node:test";

import { ManifestValidationError } from "../src/modules/errors.ts";
import { validateGameManifest } from "../src/modules/content/manifestValidation.ts";

const validManifest = {
  meta: {
    id: "antarctica",
    version: "1.0.0",
    name: "Antarctica",
    description: "Demo game",
    author: "Cubica",
    schemaVersion: "1.1"
  },
  config: {
    players: { min: 1, max: 1 },
    settings: { mode: "singleplayer", locale: "ru-RU" }
  },
  state: {
    public: {
      timeline: { line: "main", stepIndex: 0, stageId: "stage_intro", screenId: "S1" },
      log: [],
      flags: { cards: {} }
    }
  },
  actions: {
    showHint: { handlerType: "script", function: "showHint" }
  }
};

test("validateGameManifest accepts a well-formed manifest", () => {
  const manifest = validateGameManifest(validManifest) as typeof validManifest;

  assert.equal(manifest.meta.id, "antarctica");
  assert.equal(manifest.state.public.timeline.stageId, "stage_intro");
});

test("validateGameManifest rejects a manifest without required fields", () => {
  assert.throws(
    () =>
      validateGameManifest({
        ...validManifest,
        meta: {
          ...validManifest.meta,
          name: ""
        }
      }),
    ManifestValidationError
  );
});
