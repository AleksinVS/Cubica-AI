/**
 * Neutral proofs for exact multiversion Mechanics registry behavior.
 *
 * The synthetic available versions below are test-only trusted descriptors;
 * they prove registry semantics without claiming that an unavailable
 * production source snapshot exists.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const {
  createMechanicsArtifactRegistry
} = require("./mechanics-version-registry.cjs");
const {
  HISTORICAL_BLOCKED_LOCKS,
  MECHANICS_ARTIFACT_REGISTRY,
  PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS,
  PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS,
  SHARED_VALIDATION_DEPENDENCIES,
  hashMechanicsCorpus,
  hashModuleArtifact
} = require("./mechanics-modules.cjs");

const hash = (character) => `sha256:${character.repeat(64)}`;

function available(moduleVersion, artifactHash, profile) {
  return {
    moduleId: "neutral.counter",
    moduleVersion,
    artifactHash,
    algorithmVersions: {},
    operations: ["neutral.counter.add"],
    state: "available",
    validationProfileId: `validation-${profile}`,
    executorProfileId: `executor-${profile}`
  };
}

test("two exact available versions resolve simultaneously with no hash fallback", () => {
  const registry = createMechanicsArtifactRegistry([
    available("1.0.0", hash("1"), "v1"),
    available("2.0.0", hash("2"), "v2")
  ]);
  assert.equal(registry.resolve(available("1.0.0", hash("1"), "v1")).state, "available");
  assert.equal(registry.resolve(available("2.0.0", hash("2"), "v2")).state, "available");
  assert.equal(
    registry.resolve({
      moduleId: "neutral.counter",
      moduleVersion: "1.0.0",
      artifactHash: hash("2"),
      algorithmVersions: {}
    }).state,
    "missing"
  );
});

test("an older available package reaches its selected validator profile before current validation", () => {
  const registry = createMechanicsArtifactRegistry([
    available("1.0.0", hash("1"), "historic"),
    available("2.0.0", hash("2"), "current")
  ]);
  const historicalPackage = {
    mechanics: {
      apiVersion: "neutral/mechanics/v1",
      moduleLock: {
        counter: {
          moduleId: "neutral.counter",
          moduleVersion: "1.0.0",
          artifactHash: hash("1"),
          algorithmVersions: {}
        }
      },
      // A current validator must not inspect this historic-only payload before
      // the exact module set selects `validation-historic`.
      historicPayload: { acceptedOnlyBy: "historic" }
    }
  };
  const selected = registry.resolveSet(historicalPackage.mechanics.moduleLock);
  assert.equal(selected.state, "available");
  const validators = new Map([
    ["validation-historic", (value) => value.mechanics.historicPayload.acceptedOnlyBy === "historic"],
    ["validation-current", () => false]
  ]);
  assert.equal(validators.get(selected.validationProfileId)(historicalPackage), true);
});

test("registry distinguishes blocked and missing exact artifacts", () => {
  const registry = createMechanicsArtifactRegistry([{
    moduleId: "neutral.counter",
    moduleVersion: "1.0.0",
    artifactHash: hash("3"),
    algorithmVersions: {},
    state: "blocked",
    reason: "test snapshot intentionally disabled"
  }]);
  assert.equal(registry.resolve({
    moduleId: "neutral.counter",
    moduleVersion: "1.0.0",
    artifactHash: hash("3"),
    algorithmVersions: {}
  }).state, "blocked");
  assert.equal(registry.resolve({
    moduleId: "neutral.counter",
    moduleVersion: "1.0.0",
    artifactHash: hash("4"),
    algorithmVersions: {}
  }).state, "missing");
});

test("executor profile exposes trusted ownership beyond the session allow-list", () => {
  const registry = createMechanicsArtifactRegistry([
    {
      ...available("1.0.0", hash("5"), "shared"),
      moduleId: "neutral.counter",
      operations: ["neutral.counter.add"]
    },
    {
      ...available("1.0.0", hash("6"), "shared"),
      moduleId: "neutral.deck",
      operations: ["neutral.deck.draw"]
    }
  ]);
  const selected = registry.resolveSet({
    counter: {
      moduleId: "neutral.counter",
      moduleVersion: "1.0.0",
      artifactHash: hash("5"),
      algorithmVersions: {}
    }
  });
  assert.equal(selected.state, "available");
  assert.equal(selected.operationModules.get("neutral.counter.add"), "neutral.counter");
  assert.equal(selected.operationModules.get("neutral.deck.draw"), "neutral.deck");
  assert.deepEqual([...selected.modules.keys()], ["neutral.counter"]);
});

test("registry rejects conflicting operation owners inside one executor profile", () => {
  assert.throws(
    () => createMechanicsArtifactRegistry([
      {
        ...available("1.0.0", hash("7"), "shared"),
        moduleId: "neutral.left",
        operations: ["neutral.shared.run"]
      },
      {
        ...available("1.0.0", hash("8"), "shared"),
        moduleId: "neutral.right",
        operations: ["neutral.shared.run"]
      }
    ]),
    /assigns operation "neutral\.shared\.run" to both/u
  );
});

test("changing one separate module-owned runtime corpus leaves an unrelated artifact unchanged", () => {
  const sharedKernel = {
    version: "neutral-kernel-v1",
    artifactHash: mechanicsSha256({ abi: "neutral-v1" })
  };
  const leftDescriptor = { moduleId: "neutral.left", moduleVersion: "1.0.0" };
  const rightDescriptor = { moduleId: "neutral.right", moduleVersion: "1.0.0" };
  const leftBefore = hashMechanicsCorpus([{ name: "left.ts", bytes: "before" }]);
  const leftAfter = hashMechanicsCorpus([{ name: "left.ts", bytes: "after" }]);
  const right = hashMechanicsCorpus([{ name: "right.ts", bytes: "stable" }]);

  assert.notEqual(
    hashModuleArtifact(leftDescriptor, leftBefore, sharedKernel),
    hashModuleArtifact(leftDescriptor, leftAfter, sharedKernel)
  );
  assert.equal(
    hashModuleArtifact(rightDescriptor, right, sharedKernel),
    hashModuleArtifact(rightDescriptor, right, sharedKernel)
  );
});

test("changing the shared trusted validation corpus invalidates every dependent module artifact", () => {
  const descriptor = { moduleId: "neutral.left", moduleVersion: "1.0.0" };
  const moduleCorpus = hashMechanicsCorpus([{ name: "left.ts", bytes: "stable" }]);
  const before = {
    version: "neutral-kernel-v1",
    artifactHash: mechanicsSha256({ schema: "before" })
  };
  const after = {
    version: "neutral-kernel-v1",
    artifactHash: mechanicsSha256({ schema: "after" })
  };
  assert.notEqual(
    hashModuleArtifact(descriptor, moduleCorpus, before),
    hashModuleArtifact(descriptor, moduleCorpus, after)
  );
});

test("shared validation identity pins exact validator dependency versions", () => {
  assert.deepEqual(SHARED_VALIDATION_DEPENDENCIES, {
    ajv: "8.20.0",
    "ajv-errors": "3.0.0",
    "ajv-formats": "3.0.1"
  });
});

test("pre-registry production locks are known but blocked without a frozen executor", () => {
  for (const [moduleId, artifactHash] of Object.entries(HISTORICAL_BLOCKED_LOCKS)) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve({
      moduleId,
      moduleVersion: "1.0.0",
      artifactHash,
      algorithmVersions: moduleId === "cubica.random"
        ? { randomStreams: "xoshiro128ss-streams-v1" }
        : moduleId === "cubica.deck"
          ? { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
          : moduleId === "cubica.graph"
            ? {
                regionPath: "region-segment-minimum-v1",
                randomTieBreak: "xoshiro128ss-streams-v1"
              }
            : {}
    });
    assert.equal(resolved.state, "blocked");
  }
});

test("the exact pre-finite-number module set is recognised only as archive history", () => {
  for (const identity of PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(resolved.reason, /pre-finite-number executable corpus is unavailable/u);
  }
});

test("the exact pre-parameterized-deck module set remains archive-only", () => {
  for (const identity of PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(
      resolved.reason,
      /pre-parameterized-deck executable corpus is unavailable/u
    );
  }
});
