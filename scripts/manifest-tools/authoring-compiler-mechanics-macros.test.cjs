/**
 * Focused neutral tests for authoring-only Mechanics macro lowering.
 *
 * The fixture intentionally has no game-specific terms: it proves structured
 * substitution, stable ids/source origins, exact module locks and rejection of
 * every authoring construct that must not leak into immutable runtime IR.
 */

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  CompileError,
  lowerMechanicsAuthoring,
  publishMechanics
} = require("./authoring-compiler.cjs");
const { recommendedModuleLockForOperations } = require("./mechanics-modules.cjs");
const { validateMechanicsSchema } = require("./mechanics-validator.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const sourceFile = path.join(repoRoot, ".tmp", "neutral-mechanics.authoring.json");
const HASH = `sha256:${"0".repeat(64)}`;

function stateModel() {
  return {
    types: {
      "core.string": { kind: "string" }
    },
    endpoints: {},
    collections: {
      items: {
        audienceRef: "public",
        storage: { root: "public", segments: ["items"] },
        capacity: 16,
        stableKey: "map-key",
        itemTypes: ["neutral.item"],
        fields: {
          owner: {
            storage: { kind: "attribute", name: "owner" },
            valueType: "core.string",
            access: "read-write"
          }
        }
      }
    },
    events: {}
  };
}

function selectStep(id) {
  return {
    id,
    kind: "query",
    op: "core.entities.select",
    selector: {
      collection: "items",
      cardinality: { min: 0, max: 16 }
    }
  };
}

function authoringMechanics() {
  return {
    apiVersion: "cubica.dev/mechanics/v1alpha1",
    budgetProfile: "turn-based-standard-v1",
    stateModel: stateModel(),
    macros: {
      "neutral.select-owned": {
        inputs: {
          owner: { kind: "value-expression" }
        },
        steps: [
          {
            id: "owned",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "items",
              attributes: {
                owner: { "$macroInput": "owner" }
              },
              cardinality: { min: 0, max: 16 }
            }
          },
          {
            id: "bounded",
            kind: "query",
            op: "core.entities.select",
            selector: {
              collection: "items",
              within: { op: "value.result", stepId: "owned" },
              cardinality: { min: 0, max: 8 }
            }
          }
        ]
      }
    },
    plans: {
      inspect: {
        transaction: {
          steps: [
            {
              id: "pick",
              kind: "macro",
              macro: "neutral.select-owned",
              args: {
                owner: { op: "value.actor" }
              }
            }
          ]
        }
      }
    }
  };
}

function expectCompileError(mutator, message) {
  const source = authoringMechanics();
  mutator(source);
  assert.throws(
    () => lowerMechanicsAuthoring(source, sourceFile),
    (error) => {
      assert.ok(error instanceof CompileError);
      assert.match(error.rawMessage, message);
      return true;
    }
  );
}

test("lowers a typed macro deterministically and rewrites its internal result ids", () => {
  const first = lowerMechanicsAuthoring(authoringMechanics(), sourceFile);
  const second = lowerMechanicsAuthoring(authoringMechanics(), sourceFile);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.mechanics.plans.inspect.transaction.steps.map((step) => step.id),
    ["pick.owned", "pick.bounded"]
  );
  assert.equal(
    first.mechanics.plans.inspect.transaction.steps[1].selector.within.stepId,
    "pick.owned"
  );
  assert.deepEqual(Object.keys(first.mechanics.moduleLock), ["cubica.core"]);
  assert.equal(Object.prototype.hasOwnProperty.call(first.mechanics, "macros"), false);

  const publishedShape = structuredClone(first.mechanics);
  publishedShape.plans.inspect.planHash = HASH;
  assert.equal(validateMechanicsSchema(publishedShape).valid, true);
});

test("publishes hashes only after lowering and maps each expanded step to invocation and template", () => {
  function publish() {
    const manifest = {
      mechanics: authoringMechanics(),
      actions: {
        inspect: {
          binding: { kind: "mechanics-plan", planRef: "inspect" }
        }
      },
      objectModels: {},
      networkModels: {}
    };
    const mappings = {};
    publishMechanics(manifest, mappings, { mappings: {} }, sourceFile);
    return { manifest, mappings };
  }

  const first = publish();
  const second = publish();
  assert.equal(first.manifest.mechanics.plans.inspect.planHash, second.manifest.mechanics.plans.inspect.planHash);
  assert.equal(first.manifest.actions.inspect.definitionHash, second.manifest.actions.inspect.definitionHash);
  assert.match(first.manifest.mechanics.plans.inspect.planHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    first.mappings["/mechanics/plans/inspect/transaction/steps/0"].map((source) => source.pointer),
    [
      "/root/mechanics/plans/inspect/transaction/steps/0",
      "/root/mechanics/macros/neutral.select-owned/steps/0"
    ]
  );
});

test("derives a dependency-closed exact lock in stable registry order", () => {
  const lock = recommendedModuleLockForOperations(["random.dice.roll"]);
  assert.deepEqual(Object.keys(lock), ["cubica.core", "cubica.random"]);
});

test("rejects an unknown macro", () => {
  expectCompileError(
    (source) => { source.plans.inspect.transaction.steps[0].macro = "neutral.missing"; },
    /Unknown Mechanics macro/
  );
});

test("rejects an unknown placeholder input", () => {
  expectCompileError(
    (source) => { source.macros["neutral.select-owned"].steps[0].selector.attributes.owner.$macroInput = "missing"; },
    /references unknown input/
  );
});

test("rejects an unknown invocation argument", () => {
  expectCompileError(
    (source) => { source.plans.inspect.transaction.steps[0].args.extra = null; },
    /received unknown argument/
  );
});

test("rejects a missing invocation argument", () => {
  expectCompileError(
    (source) => { delete source.plans.inspect.transaction.steps[0].args.owner; },
    /is missing argument/
  );
});

test("rejects an argument that violates its declared runtime schema", () => {
  expectCompileError(
    (source) => { source.plans.inspect.transaction.steps[0].args.owner = "actor"; },
    /is not a valid value-expression/
  );
});

test("rejects duplicate ids introduced by expansion", () => {
  expectCompileError(
    (source) => { source.plans.inspect.transaction.steps.push(selectStep("pick.owned")); },
    /duplicate step id "pick\.owned"/
  );
});

test("rejects compiler-owned plan hashes in authoring", () => {
  expectCompileError(
    (source) => { source.plans.inspect.planHash = HASH; },
    /Mechanics authoring schema validation failed/
  );
});

test("rejects source module locks, including locks unused by final operations", () => {
  expectCompileError(
    (source) => { source.moduleLock = recommendedModuleLockForOperations(["random.dice.roll"]); },
    /Mechanics authoring schema validation failed/
  );
});

test("rejects unused macro inputs", () => {
  expectCompileError(
    (source) => { source.macros["neutral.select-owned"].inputs.unused = { kind: "json" }; },
    /declares unused input/
  );
});

test("rejects recursive macro definitions before expansion", () => {
  expectCompileError(
    (source) => {
      source.macros["neutral.a"] = {
        inputs: {},
        steps: [{ id: "b", kind: "macro", macro: "neutral.b", args: {} }]
      };
      source.macros["neutral.b"] = {
        inputs: {},
        steps: [{ id: "a", kind: "macro", macro: "neutral.a", args: {} }]
      };
    },
    /Recursive Mechanics macro call/
  );
});
