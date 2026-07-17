/**
 * Exact platform module registry for Mechanics IR v1alpha1.
 *
 * A module lock is an allow-list, not a version range. The artifact hash is
 * derived from the complete public descriptor, including the operation set and
 * behavior version, so authoring cannot silently select a similarly named
 * implementation.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { mechanicsSha256 } = require("./mechanics-canonicalize.cjs");
const { validateOperationCatalogSchema } = require("./mechanics-validator.cjs");

/**
 * Maximum number of independently persisted random-stream counters.
 *
 * Publication and runtime deliberately import this one value: otherwise a
 * bundle could pass the static checker and later fail only after enough named
 * streams had been used in a live session.
 */
const MAX_SESSION_RANDOM_STREAMS = 2_048;

const repoRoot = path.resolve(__dirname, "..", "..");
const operationCatalogPath = path.join(
  repoRoot,
  "docs",
  "architecture",
  "schemas",
  "mechanics-operation-catalog.json"
);
const OPERATION_CATALOG = JSON.parse(fs.readFileSync(operationCatalogPath, "utf8"));
const operationCatalogValidation = validateOperationCatalogSchema(OPERATION_CATALOG);
if (!operationCatalogValidation.valid) {
  throw new Error(`Invalid Mechanics operation catalog: ${operationCatalogValidation.errors
    .map((error) => `${error.pointer || "/"} ${error.message}`)
    .join("; ")}`);
}
const EXECUTION_CORPUS_FILES = Object.freeze([
  "docs/architecture/schemas/mechanics-operation-catalog.json",
  "docs/architecture/schemas/mechanics-operation-catalog.schema.json",
  "docs/architecture/schemas/mechanics-plan.schema.json",
  "scripts/manifest-tools/mechanics-canonicalize.cjs",
  "scripts/manifest-tools/mechanics-checker.cjs",
  "scripts/manifest-tools/mechanics-modules.cjs",
  "scripts/manifest-tools/mechanics-validator.cjs",
  "services/runtime-api/src/modules/mechanics/budget.ts",
  "services/runtime-api/src/modules/mechanics/canonicalOrder.ts",
  "services/runtime-api/src/modules/mechanics/coreOperations.ts",
  "services/runtime-api/src/modules/mechanics/domainOperations.ts",
  "services/runtime-api/src/modules/mechanics/errors.ts",
  "services/runtime-api/src/modules/mechanics/expressionEvaluator.ts",
  "services/runtime-api/src/modules/mechanics/index.ts",
  "services/runtime-api/src/modules/mechanics/mechanicsExecutor.ts",
  "services/runtime-api/src/modules/mechanics/operationRegistry.ts",
  "services/runtime-api/src/modules/mechanics/stateModel.ts",
  "services/runtime-api/src/modules/mechanics/types.ts",
  "services/runtime-api/src/modules/runtime/regionRoadPlanner.ts",
  "services/runtime-api/src/modules/runtime/sessionRandom.ts",
  "services/runtime-api/src/modules/runtime/transportRoadPreview.ts"
]);

/**
 * Hash exact named bytes with unambiguous length framing.
 *
 * The pure helper is exported so a unit test can prove that even a one-byte
 * executable-source change invalidates every module artifact identity.
 */
function hashMechanicsCorpus(entries) {
  const hash = crypto.createHash("sha256");
  for (const entry of [...entries].sort((left, right) =>
    Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")))) {
    const name = Buffer.from(entry.name, "utf8");
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    hash.update(Buffer.from(`${name.byteLength}:`, "ascii"));
    hash.update(name);
    hash.update(Buffer.from(`:${bytes.byteLength}:`, "ascii"));
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

const EXECUTION_CORPUS_HASH = hashMechanicsCorpus(EXECUTION_CORPUS_FILES.map((name) => ({
  name,
  bytes: fs.readFileSync(path.join(repoRoot, name))
})));

/** Bind a public module descriptor to the exact shared executable corpus. */
function hashModuleArtifact(descriptor, executionCorpusHash) {
  return mechanicsSha256({ descriptor, executionCorpusHash });
}

const rawDescriptors = [
  {
    moduleId: "cubica.core",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-core-v1alpha1-2",
    dependencies: [],
    operations: [
      "core.assert",
      "core.entities.select",
      "core.collection.id.allocate",
      "core.sequence.next",
      "core.state.patch",
      "core.number.add",
      "core.resource.transfer",
      "core.collection.append",
      "core.entity.create",
      "core.entity.facet.set",
      "core.entity.attributes.patch",
      "core.entities.update",
      "core.event.emit",
      "core.entities.score",
      "core.ranking.stable",
      "turn.phase.select"
    ],
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.random",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-random-v1alpha1-3",
    dependencies: ["cubica.core"],
    operations: ["random.dice.roll"],
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-system-v1alpha1-1",
    dependencies: ["cubica.core"],
    operations: ["system.schedule.register", "system.schedule.cancel"],
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-deck-v1alpha1-3",
    dependencies: ["cubica.random"],
    operations: ["deck.shuffle", "deck.draw"],
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-region-graph-v1alpha1-3",
    dependencies: ["cubica.random"],
    operations: ["graph.regions.route.plan", "graph.edge.split", "graph.entity.traverse", "graph.shortestPath"],
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.0",
    behaviorVersion: "mechanics-relation-v1alpha1-2",
    dependencies: ["cubica.core"],
    operations: ["relation.attach", "relation.detach"],
    algorithmVersions: {}
  }
];

/**
 * Fail during process startup when executable registration and the public
 * machine-readable catalog drift. This is intentionally stricter than a CI
 * lint: an incomplete catalog must never mint valid module artifact hashes.
 */
function assertOperationCatalogComplete(catalog, moduleDescriptors) {
  const catalogEntries = catalog.operations;
  const registered = new Map(moduleDescriptors.flatMap((descriptor) =>
    descriptor.operations.map((operation) => [operation, descriptor.moduleId])));
  const registeredIds = [...registered.keys()].sort();
  const catalogIds = Object.keys(catalogEntries).sort();
  if (JSON.stringify(registeredIds) !== JSON.stringify(catalogIds)) {
    throw new Error("Mechanics operation catalog does not exactly cover the registered operation set");
  }
  const mechanicsSchema = JSON.parse(fs.readFileSync(
    path.join(repoRoot, "docs", "architecture", "schemas", "mechanics-plan.schema.json"),
    "utf8"
  ));
  for (const [operation, moduleId] of registered.entries()) {
    const entry = catalogEntries[operation];
    if (entry.moduleId !== moduleId) {
      throw new Error(`Mechanics operation catalog assigns "${operation}" to the wrong module`);
    }
    const definition = decodeURIComponent(entry.schemaRef.split("#/$defs/")[1] || "");
    if (!definition || mechanicsSchema.$defs?.[definition] === undefined) {
      throw new Error(`Mechanics operation catalog has an unknown schemaRef for "${operation}"`);
    }
  }
}

assertOperationCatalogComplete(OPERATION_CATALOG, rawDescriptors);

const descriptors = rawDescriptors.map((descriptor) => Object.freeze({
  ...descriptor,
  dependencies: Object.freeze([...descriptor.dependencies]),
  operations: Object.freeze([...descriptor.operations]),
  algorithmVersions: Object.freeze({ ...descriptor.algorithmVersions }),
  artifactHash: hashModuleArtifact(descriptor, EXECUTION_CORPUS_HASH)
}));

const MODULE_REGISTRY = new Map(descriptors.map((descriptor) => [descriptor.moduleId, descriptor]));
const OPERATION_MODULES = new Map(
  descriptors.flatMap((descriptor) => descriptor.operations.map((operation) => [operation, descriptor.moduleId]))
);

function recommendedModuleLock(moduleIds = descriptors.map((descriptor) => descriptor.moduleId)) {
  return Object.fromEntries(moduleIds.map((moduleId) => {
    const descriptor = MODULE_REGISTRY.get(moduleId);
    if (!descriptor) throw new Error(`Unknown Mechanics IR module "${moduleId}"`);
    const lock = {
      moduleId: descriptor.moduleId,
      moduleVersion: descriptor.moduleVersion,
      artifactHash: descriptor.artifactHash
    };
    if (Object.keys(descriptor.algorithmVersions).length > 0) {
      lock.algorithmVersions = { ...descriptor.algorithmVersions };
    }
    return [moduleId, lock];
  }));
}

/**
 * Resolve the exact module set required by final lowered operations.
 *
 * Dependencies are descriptor data rather than compiler folklore. The DFS
 * therefore rejects a broken catalog (unknown dependency or cycle) and emits
 * locks in registry order, keeping independently compiled bundles byte-stable.
 */
function moduleIdsForOperations(operations) {
  const required = new Set();
  const visiting = new Set();
  const visited = new Set();

  function visit(moduleId, path = []) {
    if (visiting.has(moduleId)) {
      throw new Error(`Cyclic Mechanics IR module dependency: ${[...path, moduleId].join(" -> ")}`);
    }
    if (visited.has(moduleId)) return;
    const descriptor = MODULE_REGISTRY.get(moduleId);
    if (!descriptor) {
      throw new Error(`Unknown Mechanics IR module dependency "${moduleId}"`);
    }
    visiting.add(moduleId);
    for (const dependency of descriptor.dependencies) visit(dependency, [...path, moduleId]);
    visiting.delete(moduleId);
    visited.add(moduleId);
    required.add(moduleId);
  }

  for (const operation of operations) {
    const moduleId = OPERATION_MODULES.get(operation);
    if (!moduleId) throw new Error(`Unknown Mechanics IR operation "${operation}"`);
    visit(moduleId);
  }
  return descriptors.map((descriptor) => descriptor.moduleId).filter((moduleId) => required.has(moduleId));
}

function recommendedModuleLockForOperations(operations) {
  return recommendedModuleLock(moduleIdsForOperations(operations));
}

module.exports = {
  EXECUTION_CORPUS_FILES,
  EXECUTION_CORPUS_HASH,
  MAX_SESSION_RANDOM_STREAMS,
  MODULE_REGISTRY,
  OPERATION_CATALOG,
  OPERATION_MODULES,
  assertOperationCatalogComplete,
  hashMechanicsCorpus,
  hashModuleArtifact,
  moduleIdsForOperations,
  recommendedModuleLock,
  recommendedModuleLockForOperations
};
