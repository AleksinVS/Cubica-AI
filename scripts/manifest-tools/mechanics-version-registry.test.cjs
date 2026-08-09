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
  MODULE_REGISTRY,
  PRE_DUAL_RANDOM_PROVIDER_BLOCKED_ARTIFACTS,
  PRE_DYNAMIC_SCORE_BLOCKED_ARTIFACTS,
  PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS,
  PRE_LOGARITHMIC_RANDOM_ADVANCE_BLOCKED_ARTIFACTS,
  PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS,
  PRE_RANDOM_STREAM_SNAPSHOT_BLOCKED_ARTIFACTS,
  PRE_RECORD_MAP_ORDER_BLOCKED_ARTIFACTS,
  SHARED_KERNEL_VERSION,
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

test("current exact modules pin the live server-random provider", () => {
  assert.equal(SHARED_KERNEL_VERSION, "mechanics-shared-kernel-v12");
  assert.equal(MODULE_REGISTRY.get("cubica.core").moduleVersion, "1.6.0");
  assert.equal(MODULE_REGISTRY.get("cubica.core").behaviorVersion, "mechanics-core-v1alpha1-9");
  assert.equal(MODULE_REGISTRY.get("cubica.random").moduleVersion, "1.1.1");
  assert.equal(MODULE_REGISTRY.get("cubica.ordering").moduleVersion, "1.3.0");
  assert.equal(MODULE_REGISTRY.get("cubica.ordering").behaviorVersion, "mechanics-ordering-v6");
  assert.deepEqual(
    ["cubica.random", "cubica.system", "cubica.deck", "cubica.graph", "cubica.relations"]
      .map((moduleId) => {
        const descriptor = MODULE_REGISTRY.get(moduleId);
        return [moduleId, descriptor.moduleVersion, descriptor.behaviorVersion];
      }),
    [
      ["cubica.random", "1.1.1", "mechanics-random-v1alpha1-6"],
      ["cubica.system", "1.0.6", "mechanics-system-v1alpha1-2"],
      ["cubica.deck", "1.3.1", "mechanics-deck-v1alpha1-9"],
      ["cubica.graph", "2.4.1", "mechanics-region-graph-v1alpha1-10"],
      ["cubica.relations", "1.0.6", "mechanics-relation-v1alpha1-3"]
    ]
  );
  assert.equal(
    MODULE_REGISTRY.get("cubica.random").algorithmVersions.randomProvider,
    "server-crypto-random-v1"
  );
  assert.equal(
    MODULE_REGISTRY.get("cubica.deck").algorithmVersions.shuffle,
    "fisher-yates-server-crypto-random-v1"
  );
});

test("the exact pre-record-map-order module set remains archive-only", () => {
  assert.deepEqual(
    PRE_RECORD_MAP_ORDER_BLOCKED_ARTIFACTS.map(({ moduleId, moduleVersion }) => [moduleId, moduleVersion]),
    [
      ["cubica.core", "1.5.0"],
      ["cubica.random", "1.1.0"],
      ["cubica.ordering", "1.2.0"],
      ["cubica.system", "1.0.5"],
      ["cubica.deck", "1.3.0"],
      ["cubica.graph", "2.4.0"],
      ["cubica.relations", "1.0.5"]
    ]
  );
  for (const identity of PRE_RECORD_MAP_ORDER_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(resolved.reason, /pre-record-map-order executable corpus is unavailable/u);
    assert.deepEqual(
      MODULE_REGISTRY.get(identity.moduleId).algorithmVersions,
      identity.algorithmVersions,
      `${identity.moduleId} keeps its algorithm identity across the v12 corpus change`
    );
  }
});

test("the region graph module draws no random value at all", () => {
  // Version 2 of the region path algorithm decides a route by geometry, so this
  // module stopped using the random provider (ADR-100 § 4.6). Both the missing
  // algorithm identity and the missing dependency are asserted, because either
  // one left behind would claim a capability the module no longer has.
  const graph = MODULE_REGISTRY.get("cubica.graph");
  assert.equal(graph.algorithmVersions.regionPath, "region-segment-minimum-v3");
  assert.equal(graph.algorithmVersions.randomTieBreak, undefined);
  assert.deepEqual(graph.dependencies, []);
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

test("the exact pre-logarithmic-random module set remains archive-only", () => {
  for (const identity of PRE_LOGARITHMIC_RANDOM_ADVANCE_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(
      resolved.reason,
      /pre-logarithmic-random-advance executable corpus is unavailable/u
    );
  }
});

test("the exact seed-counter stream module set remains archive-only", () => {
  assert.equal(
    PRE_RANDOM_STREAM_SNAPSHOT_BLOCKED_ARTIFACTS.length,
    7,
    "the archived corpus must retain every module affected by the shared kernel"
  );
  for (const identity of PRE_RANDOM_STREAM_SNAPSHOT_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(
      resolved.reason,
      /pre-random-stream-snapshot executable corpus is unavailable/u
    );
  }
});

test("the exact snapshot-only provider module set remains archive-only", () => {
  assert.deepEqual(
    PRE_DUAL_RANDOM_PROVIDER_BLOCKED_ARTIFACTS.map(({ moduleId }) => moduleId),
    [
      "cubica.core",
      "cubica.random",
      "cubica.ordering",
      "cubica.deck",
      "cubica.graph",
      "cubica.relations"
    ],
    "the archive must retain every exact v9 identity materialized in a bundle"
  );
  for (const identity of PRE_DUAL_RANDOM_PROVIDER_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(
      resolved.reason,
      /snapshot-only random-provider corpus is unavailable/u
    );
  }
});

test("the exact pre-dynamic-score module set remains archive-only", () => {
  assert.equal(
    PRE_DYNAMIC_SCORE_BLOCKED_ARTIFACTS.length,
    7,
    "the archived corpus must retain every module affected by the shared kernel"
  );
  for (const identity of PRE_DYNAMIC_SCORE_BLOCKED_ARTIFACTS) {
    const resolved = MECHANICS_ARTIFACT_REGISTRY.resolve(identity);
    assert.equal(resolved.state, "blocked");
    assert.match(
      resolved.reason,
      /pre-dynamic-score executable corpus is unavailable/u
    );
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
