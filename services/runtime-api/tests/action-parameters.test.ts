/**
 * Contract checks for the canonical Game Intent parameter envelope.
 *
 * Browser commands always contain `params`. An action with no author-declared
 * parameter schema therefore accepts the closed empty object, while any field
 * still fails closed. Published manifests normally receive the equivalent
 * strict JSON Schema from the compiler; this test protects the runtime seam
 * used by hand-built neutral fixtures as well.
 */

import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020Lib from "ajv/dist/2020.js";
import type { RuntimeManifestActionDefinition } from "@cubica/contracts-runtime";

import { RequestValidationError } from "../src/modules/errors.ts";
import { validateActionParameters } from "../src/modules/runtime/actionParameters.ts";

const actionWithoutParams = {
  actionId: "fixture.no-params",
  capability: "fixture.no-params",
  definitionHash: `sha256:${"0".repeat(64)}`,
  binding: { kind: "mechanics-plan", planRef: "fixture.no-params" }
} as RuntimeManifestActionDefinition;

test("an action without paramsSchema accepts the canonical empty params object", () => {
  assert.deepEqual(validateActionParameters(actionWithoutParams, {}), {});
  assert.deepEqual(validateActionParameters(actionWithoutParams, undefined), {});
});

test("an action without paramsSchema rejects every caller-supplied field", () => {
  assert.throws(
    () => validateActionParameters(actionWithoutParams, { unexpected: true }),
    (error) => error instanceof RequestValidationError && /does not accept params/u.test(error.message)
  );
});

test("the strict 2020-12 validator accepts the declared Cubica reference annotation", () => {
  const action = {
    ...actionWithoutParams,
    actionId: "fixture.reference",
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        objectId: {
          type: "string",
          maxLength: 128,
          "x-cubica-ref": {
            kind: "object",
            collection: "fixtures",
            visibility: "public"
          }
        }
      },
      required: ["objectId"]
    }
  } as RuntimeManifestActionDefinition;

  assert.deepEqual(validateActionParameters(action, { objectId: "fixture-1" }), {
    objectId: "fixture-1"
  });
});

test("the strict 2020-12 validator rejects every unregistered schema keyword", () => {
  const action = {
    ...actionWithoutParams,
    actionId: "fixture.unknown-keyword",
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      "x-legacy-extension": true
    }
  } as RuntimeManifestActionDefinition;

  assert.throws(
    () => validateActionParameters(action, {}),
    /strict mode: unknown keyword: "x-legacy-extension"/u
  );
});

test("reference-subset validators reuse one compilation for an equivalent sorted selection", async () => {
  type AjvPrototype = { compile: (schema: unknown) => unknown };
  const Ajv2020 = ((Ajv2020Lib as unknown as { default?: Function }).default ??
    Ajv2020Lib) as unknown as { prototype: AjvPrototype };
  const originalCompile = Ajv2020.prototype.compile;
  let compileCalls = 0;
  Ajv2020.prototype.compile = function (schema: unknown): unknown {
    compileCalls += 1;
    return originalCompile.call(this, schema);
  };

  try {
    // A query string creates an isolated module instance so this test counts
    // only compilations caused by its calls, independent of earlier tests.
    const moduleUrl = new URL("../src/modules/runtime/actionParameters.ts", import.meta.url);
    moduleUrl.searchParams.set("subset-cache-test", "1");
    const { validateActionReferenceParameterSubset } = await import(moduleUrl.href);
    const definition = referenceSubsetAction();
    const params = { originId: "origin", destinationId: "destination" };

    assert.deepEqual(validateActionReferenceParameterSubset(
      definition,
      params,
      ["originId", "destinationId"],
      { requiredVisibility: "public" }
    ), params);
    assert.deepEqual(validateActionReferenceParameterSubset(
      definition,
      params,
      ["destinationId", "originId"],
      { requiredVisibility: "public" }
    ), params);

    assert.equal(
      compileCalls,
      1,
      "parameter order must not cause AJV to compile the same preview contract again"
    );
  } finally {
    Ajv2020.prototype.compile = originalCompile;
  }
});

function referenceSubsetAction(): RuntimeManifestActionDefinition {
  const reference = (collection: string) => ({
    type: "string",
    maxLength: 128,
    "x-cubica-ref": {
      kind: "object",
      collection,
      visibility: "public"
    }
  });
  return {
    ...actionWithoutParams,
    actionId: "fixture.preview",
    paramsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        originId: reference("origins"),
        destinationId: reference("destinations")
      },
      required: ["originId", "destinationId"]
    }
  } as RuntimeManifestActionDefinition;
}
