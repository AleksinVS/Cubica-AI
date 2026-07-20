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
const { createMechanicsArtifactRegistry } = require("./mechanics-version-registry.cjs");

/**
 * Maximum number of independently persisted random-stream counters.
 *
 * Publication and runtime deliberately import this one value: otherwise a
 * bundle could pass the static checker and later fail only after enough named
 * streams had been used in a live session.
 */
const MAX_SESSION_RANDOM_STREAMS = 2_048;
/**
 * Maximum number of mutually exclusive members in one protected deck.
 *
 * Publication uses this same value for conservative scan-cost estimates and
 * runtime rejects larger persisted decks before any lifecycle operation.
 */
const MAX_DECK_ITEMS = 4_096;

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
const SHARED_KERNEL_VERSION = "mechanics-shared-kernel-v6";
/**
 * Shared trusted Mechanics corpus.
 *
 * Exact execution means more than runtime bytes: the selected JSON Schema,
 * semantic checker, validator and version resolver determine which program is
 * admitted. Until those pieces become physically module-specific, every
 * module artifact honestly includes this shared corpus and therefore changes
 * when a shared contract or admission rule changes.
 */
const SHARED_KERNEL_FILES = Object.freeze([
  "docs/architecture/schemas/mechanics-bootstrap.schema.json",
  "docs/architecture/schemas/mechanics-operation-catalog.json",
  "docs/architecture/schemas/mechanics-operation-catalog.schema.json",
  "docs/architecture/schemas/mechanics-plan.schema.json",
  "docs/architecture/schemas/game-intent.schema.json",
  "docs/architecture/schemas/game-manifest.schema.json",
  "scripts/manifest-tools/mechanics-canonicalize.cjs",
  "scripts/manifest-tools/mechanics-checker.cjs",
  "scripts/manifest-tools/mechanics-modules.cjs",
  "scripts/manifest-tools/mechanics-validator.cjs",
  "scripts/manifest-tools/mechanics-version-registry.cjs",
  "services/runtime-api/src/modules/content/manifestValidation.ts",
  "services/runtime-api/src/modules/errors.ts",
  "services/runtime-api/src/modules/mechanics/budget.ts",
  "services/runtime-api/src/modules/mechanics/canonicalOrder.ts",
  "services/runtime-api/src/modules/mechanics/errors.ts",
  "services/runtime-api/src/modules/mechanics/expressionEvaluator.ts",
  "services/runtime-api/src/modules/mechanics/mechanicsExecutor.ts",
  "services/runtime-api/src/modules/mechanics/stateModel.ts",
  "services/runtime-api/src/modules/mechanics/types.ts",
  "services/runtime-api/src/modules/runtime/regionRoadPlanner.ts"
]);

const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
const SHARED_VALIDATION_DEPENDENCIES = Object.freeze(Object.fromEntries(
  ["ajv", "ajv-errors", "ajv-formats"].map((packageName) => {
    const version = packageLock.packages?.[`node_modules/${packageName}`]?.version;
    if (typeof version !== "string") {
      throw new Error(`Exact shared Mechanics validation dependency "${packageName}" is not installed`);
    }
    return [packageName, version];
  })
));

/**
 * Module-owned executable sources.
 *
 * A few first-generation modules still share a physical handler file. Those
 * bytes therefore truthfully belong to both corpora until the handlers are
 * split. Only a change to a separate module-owned runtime file is isolated;
 * shared schema/checker/executor changes intentionally invalidate all module
 * artifacts.
 */
const MODULE_CORPUS_FILES = Object.freeze({
  "cubica.core": Object.freeze([
    "services/runtime-api/src/modules/mechanics/coreOperations.ts",
    "services/runtime-api/src/modules/mechanics/operationRegistry.ts"
  ]),
  "cubica.random": Object.freeze([
    "services/runtime-api/src/modules/mechanics/operationRegistry.ts",
    "services/runtime-api/src/modules/runtime/sessionRandom.ts"
  ]),
  "cubica.system": Object.freeze([
    "services/runtime-api/src/modules/mechanics/coreOperations.ts"
  ]),
  "cubica.deck": Object.freeze([
    "services/runtime-api/src/modules/mechanics/operationRegistry.ts",
    "services/runtime-api/src/modules/runtime/sessionRandom.ts"
  ]),
  "cubica.ordering": Object.freeze([
    "services/runtime-api/src/modules/mechanics/operationRegistry.ts",
    "services/runtime-api/src/modules/mechanics/orderingOperations.ts"
  ]),
  "cubica.graph": Object.freeze([
    "services/runtime-api/src/modules/content/canonicalJson.ts",
    "services/runtime-api/src/modules/mechanics/domainOperations.ts",
    "services/runtime-api/src/modules/mechanics/graphGeometry.ts",
    "services/runtime-api/src/modules/runtime/regionRoadPlanner.ts",
    "services/runtime-api/src/modules/runtime/sessionRandom.ts",
    "services/runtime-api/src/modules/runtime/transportRoadPreview.ts"
  ]),
  "cubica.relations": Object.freeze([
    "services/runtime-api/src/modules/mechanics/domainOperations.ts"
  ])
});

const EXECUTION_CORPUS_FILES = Object.freeze([
  ...new Set([...SHARED_KERNEL_FILES, ...Object.values(MODULE_CORPUS_FILES).flat()])
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

const SHARED_KERNEL_HASH = hashMechanicsCorpus([
  ...SHARED_KERNEL_FILES.map((name) => ({
    name,
    bytes: fs.readFileSync(path.join(repoRoot, name))
  })),
  ...Object.entries(SHARED_VALIDATION_DEPENDENCIES).map(([name, version]) => ({
    name: `validation-dependency:${name}`,
    bytes: version
  }))
]);
const EXECUTION_CORPUS_HASH = hashMechanicsCorpus(EXECUTION_CORPUS_FILES.map((name) => ({
  name,
  bytes: fs.readFileSync(path.join(repoRoot, name))
})));

/** Bind a public module descriptor to the exact shared executable corpus. */
function hashModuleArtifact(descriptor, moduleCorpusHash, sharedKernel = undefined) {
  return mechanicsSha256({
    descriptor,
    moduleCorpusHash,
    ...(sharedKernel === undefined ? {} : { sharedKernel })
  });
}

const rawDescriptors = [
  {
    moduleId: "cubica.core",
    moduleVersion: "1.3.0",
    behaviorVersion: "mechanics-core-v1alpha1-5",
    dependencies: [],
    operations: [
      "core.assert",
      "core.entities.select",
      "core.entities.each",
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
    moduleVersion: "1.0.2",
    behaviorVersion: "mechanics-random-v1alpha1-3",
    dependencies: ["cubica.core"],
    operations: ["random.dice.roll"],
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.ordering",
    moduleVersion: "1.1.1",
    behaviorVersion: "mechanics-ordering-v2",
    dependencies: ["cubica.core", "cubica.random"],
    operations: ["core.entities.order"],
    algorithmVersions: {
      ordering: "lexicographic-bounded-v1",
      tieBreak: "canonical-groups-xoshiro128ss-v1"
    }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.2",
    behaviorVersion: "mechanics-system-v1alpha1-1",
    dependencies: ["cubica.core"],
    operations: ["system.schedule.register", "system.schedule.cancel"],
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.2.0",
    behaviorVersion: "mechanics-deck-v1alpha1-6",
    dependencies: ["cubica.random"],
    operations: ["deck.shuffle", "deck.draw", "deck.extract", "deck.return", "deck.insert"],
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "2.0.1",
    behaviorVersion: "mechanics-region-graph-v1alpha1-4",
    dependencies: ["cubica.random"],
    operations: [
      "graph.regions.route.plan",
      "graph.edge.position.inspect",
      "graph.edge.split",
      "graph.entity.traverse",
      "graph.shortestPath"
    ],
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1",
      edgePosition: "polyline-arc-length-v1",
      regionMembership: "closed-polygon-all-memberships-v1",
      geometryFingerprint: "canonical-json-sha256-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.2",
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
    if (entry.resultSchemaRef !== undefined) {
      const resultDefinition = decodeURIComponent(entry.resultSchemaRef.split("#/$defs/")[1] || "");
      if (!resultDefinition || mechanicsSchema.$defs?.[resultDefinition] === undefined) {
        throw new Error(`Mechanics operation catalog has an unknown resultSchemaRef for "${operation}"`);
      }
    }
  }
}

assertOperationCatalogComplete(OPERATION_CATALOG, rawDescriptors);

const descriptors = rawDescriptors.map((descriptor) => {
  const moduleCorpusFiles = MODULE_CORPUS_FILES[descriptor.moduleId];
  if (!moduleCorpusFiles) throw new Error(`No Mechanics corpus is declared for "${descriptor.moduleId}"`);
  const moduleCorpusHash = hashMechanicsCorpus(moduleCorpusFiles.map((name) => ({
    name,
    bytes: fs.readFileSync(path.join(repoRoot, name))
  })));
  return Object.freeze({
    ...descriptor,
    dependencies: Object.freeze([...descriptor.dependencies]),
    operations: Object.freeze([...descriptor.operations]),
    algorithmVersions: Object.freeze({ ...descriptor.algorithmVersions }),
    sharedKernelVersion: SHARED_KERNEL_VERSION,
    moduleCorpusHash,
    artifactHash: hashModuleArtifact(descriptor, moduleCorpusHash, {
      version: SHARED_KERNEL_VERSION,
      artifactHash: SHARED_KERNEL_HASH
    })
  });
});

const MODULE_REGISTRY = new Map(descriptors.map((descriptor) => [descriptor.moduleId, descriptor]));
const OPERATION_MODULES = new Map(
  descriptors.flatMap((descriptor) => descriptor.operations.map((operation) => [operation, descriptor.moduleId]))
);

const HISTORICAL_BLOCKED_LOCKS = Object.freeze({
  "cubica.core": "sha256:46e56ea9d1a07c054357de6a22880b3a3ec73c834a26687a4971d35f7794da94",
  "cubica.random": "sha256:5bfdc700b76856328c2a12c3d738863cbd0e8ff55aecb8be53e77c948e972351",
  "cubica.system": "sha256:9492a127d61191e816c3f7c8d041fb8b077e1d2d77ed19646d1d6b7acd1141ce",
  "cubica.deck": "sha256:91739710bce6b891ddd3bbd45cc9a0c4447d6a783f77340491fae484ed744844",
  "cubica.graph": "sha256:8bc9b701bc0395c4cfb2839c7d8bf081feaf89312f0d3c20bab1f693cc0e7947",
  "cubica.relations": "sha256:54c248012876a1aea5acb5719dc91fc715310cbf17e42944c0ec690ff23b41f0"
});

/**
 * Algorithm identities that accompanied the first pre-registry production
 * locks. They must not be borrowed from today's descriptor: adding a current
 * graph algorithm would otherwise make the exact historic triple disappear
 * from the archive registry.
 */
const HISTORICAL_BLOCKED_ALGORITHM_VERSIONS = Object.freeze({
  "cubica.core": {},
  "cubica.random": { randomStreams: "xoshiro128ss-streams-v1" },
  "cubica.ordering": {},
  "cubica.system": {},
  "cubica.deck": { shuffle: "fisher-yates-xoshiro128ss-streams-v1" },
  "cubica.graph": {
    regionPath: "region-segment-minimum-v1",
    randomTieBreak: "xoshiro128ss-streams-v1"
  },
  "cubica.relations": {}
});

/**
 * Exact module triples immediately before the proof-bound geometry contract.
 *
 * The shared admission corpus changes every current artifact hash even when a
 * module does not implement graph geometry itself. Those pre-release artifacts
 * are retained as explicit archive-only history, never as fallback executors.
 */
const PRE_GEOMETRY_BLOCKED_ARTIFACTS = Object.freeze([
  {
    moduleId: "cubica.core",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:96e3f1046a45410fdc9e3495b019bfcc8608cf37aad8ffaac1fdd8f6b7a2ca3a",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.random",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:4a903d31f4a71e06e1c22b0cd1404b0a1bfaa5c22dc491105e86279a90ac2b98",
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.ordering",
    moduleVersion: "1.0.0",
    artifactHash: "sha256:01deafefd6d24eaf578cb6275c14e463c838ebcaf7946d19c8ce1232aa4fe199",
    algorithmVersions: {
      ordering: "lexicographic-bounded-v1",
      tieBreak: "canonical-groups-xoshiro128ss-v1"
    }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:d479bf3c16a7984ddaaeb01e1a3cd6fcd9877bd38e67e22f189b5d37a7dbd969",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.1.0",
    artifactHash: "sha256:e6dac59cfb27af928b6de6df35221c7459edffc59a67f73c0a4488dffb9a3067",
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:49841eaf621404815799d2c243e0498bf2c995cc18770eef34f2a4687e9fedaa",
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:e857a97f2bfab0ade9156c200dc57aabb9922a700c880f72ad8fd0c24725832f",
    algorithmVersions: {}
  }
]);

/**
 * Exact module triples immediately before finite-number projections.
 *
 * The public type system and shared state reader changed together. Their
 * former source corpus is not shipped as an executor, so every exact triple is
 * retained only as recognised archive history with no fallback to new code.
 */
const PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS = Object.freeze([
  {
    moduleId: "cubica.core",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:91a123da98728d2e7dfbcf15c62d8e12234cdb170a9981315b5b4010373520c1",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.random",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:e3d9becf97fc9545ec8bbab33f8122a02a8d596f3465ca5f52e4027ff5c95d4f",
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.ordering",
    moduleVersion: "1.0.0",
    artifactHash: "sha256:c257879e46f0daff8a2d3cb4be0f28b1c6245fb9968876dcc8e9c372f737a7dc",
    algorithmVersions: {
      ordering: "lexicographic-bounded-v1",
      tieBreak: "canonical-groups-xoshiro128ss-v1"
    }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:50e2c082761c0d0850536f1d3096560a5ca1ae88944354ae2a7e7686c142fa00",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.1.0",
    artifactHash: "sha256:66c377834f9fae8d4fc1f91c859686798ef0fd51fe1fcff84de53e498bce2188",
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "2.0.0",
    artifactHash: "sha256:20d90114605c0c8e6826b9ce2f9d7f1e92e89230c13194f84a49dfd7060ef287",
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1",
      edgePosition: "polyline-arc-length-v1",
      regionMembership: "closed-polygon-all-memberships-v1",
      geometryFingerprint: "canonical-json-sha256-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.1",
    artifactHash: "sha256:b086e3fcd8a5480634c20e08e36a60b6ddb70207367ec7744716ea477420445a",
    algorithmVersions: {}
  }
]);

/**
 * Exact pre-set-add artifacts from the last v4 shared-kernel snapshot.
 *
 * Those sessions are explicitly pre-release and archive-only under ADR-086
 * and LEGACY-0072. Recording their exact identities as blocked preserves an
 * honest diagnostic without pretending that today's executor contains their
 * unavailable frozen schema/checker/runtime corpus.
 */
const PRE_SET_ADD_BLOCKED_ARTIFACTS = Object.freeze([
  {
    moduleId: "cubica.core",
    moduleVersion: "1.2.0",
    artifactHash: "sha256:f0a0a3d90cbf4063f6b2048292ebb00de340fe1e7651535912ba24369215f7b6",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.random",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:88986ff5cec4d76f5ef6dc295bb42dd7794b0926f2dec6e9a14f9412ca721087",
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.ordering",
    moduleVersion: "1.1.1",
    artifactHash: "sha256:6e6680bd4c665323ea1114c8819fa0a1ee3f1f6d112236e4bd31e60026981703",
    algorithmVersions: {
      ordering: "lexicographic-bounded-v1",
      tieBreak: "canonical-groups-xoshiro128ss-v1"
    }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:a8c52794dc2bebae9232d594d63878e2b578ddff12d6d69a6d0068236630da37",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.1.1",
    artifactHash: "sha256:5f51d185d28a3926f6b253320921fea1feacef6599a95147ce6ecb68fa2999e0",
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "2.0.1",
    artifactHash: "sha256:3edb4981fd1cff09a782750ac8a8e9b24b22db08b83a1468e9aedfbf6eaed1ff",
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1",
      edgePosition: "polyline-arc-length-v1",
      regionMembership: "closed-polygon-all-memberships-v1",
      geometryFingerprint: "canonical-json-sha256-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:2b20b13ea7547ba9454c8ddf737c7ccdca2a3409d3de137446c3f4bfcce6c6a1",
    algorithmVersions: {}
  }
]);

/**
 * Exact post-set-add artifacts immediately before bounded deck references.
 *
 * The shared schema and semantic checker belong to every current artifact
 * hash, so even modules without deck handlers receive a new exact identity.
 * The frozen v5 corpus is not shipped; these pre-release sessions remain
 * archive-only rather than being executed by a deceptively similar v6 body.
 */
const PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS = Object.freeze([
  {
    moduleId: "cubica.core",
    moduleVersion: "1.3.0",
    artifactHash: "sha256:e95f9b5abcb3041ef9e1e805401baccdd2fb9b41ae88347d22baaa9e338e823e",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.random",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:bca36412b8d83f0871f1b1aad39f5992b2ce3bb3a4e386672729f90185baef45",
    algorithmVersions: { randomStreams: "xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.ordering",
    moduleVersion: "1.1.1",
    artifactHash: "sha256:b320235ba1d035591e65bd23aa4fe0628cda242f437ecd0c3b1896010e42f7a4",
    algorithmVersions: {
      ordering: "lexicographic-bounded-v1",
      tieBreak: "canonical-groups-xoshiro128ss-v1"
    }
  },
  {
    moduleId: "cubica.system",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:b8c557e4696ccd57b28bfddb506e62d62d850693de5b371effbb81d51f519755",
    algorithmVersions: {}
  },
  {
    moduleId: "cubica.deck",
    moduleVersion: "1.1.1",
    artifactHash: "sha256:664b4248a930b6131fdd8d532b49a8521ccdeda9958885124a24e0d8095ec49a",
    algorithmVersions: { shuffle: "fisher-yates-xoshiro128ss-streams-v1" }
  },
  {
    moduleId: "cubica.graph",
    moduleVersion: "2.0.1",
    artifactHash: "sha256:b3de39d39c70dd67b38d36f720227d8437e05f12f3ad9b41561b41ecda11f05b",
    algorithmVersions: {
      regionPath: "region-segment-minimum-v1",
      randomTieBreak: "xoshiro128ss-streams-v1",
      edgePosition: "polyline-arc-length-v1",
      regionMembership: "closed-polygon-all-memberships-v1",
      geometryFingerprint: "canonical-json-sha256-v1"
    }
  },
  {
    moduleId: "cubica.relations",
    moduleVersion: "1.0.2",
    artifactHash: "sha256:e9c52dccd463c61bdf0c07202bb0f29421296bb15355999f28084a63e2dd6cd5",
    algorithmVersions: {}
  }
]);

/**
 * Production registry contains the exact current snapshot and recognises the
 * last pre-registry locks as blocked history. The latter are not executable:
 * their frozen source corpus was not retained, so pretending otherwise would
 * silently run a saved party with different rules.
 */
const MECHANICS_ARTIFACT_REGISTRY = createMechanicsArtifactRegistry([
  ...descriptors.map((descriptor) => ({
    ...descriptor,
    state: "available",
    validationProfileId: "mechanics-v1alpha1-current",
    executorProfileId: "mechanics-runtime-current"
  })),
  ...PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS.map((artifact) => ({
    ...artifact,
    state: "blocked",
    reason: "pre-parameterized-deck executable corpus is unavailable; dependent pre-release sessions are archive-only"
  })),
  ...PRE_SET_ADD_BLOCKED_ARTIFACTS.map((artifact) => ({
    ...artifact,
    state: "blocked",
    reason: "pre-set-add executable corpus is unavailable; dependent pre-release sessions are archive-only"
  })),
  ...PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS.map((artifact) => ({
    ...artifact,
    state: "blocked",
    reason: "pre-finite-number executable corpus is unavailable; dependent pre-release sessions are archive-only"
  })),
  ...PRE_GEOMETRY_BLOCKED_ARTIFACTS.map((artifact) => ({
    ...artifact,
    state: "blocked",
    reason: "pre-geometry executable corpus is unavailable; dependent pre-release sessions are archive-only"
  })),
  ...rawDescriptors.map((descriptor) => ({
    moduleId: descriptor.moduleId,
    moduleVersion: "1.0.0",
    artifactHash: HISTORICAL_BLOCKED_LOCKS[descriptor.moduleId],
    algorithmVersions: HISTORICAL_BLOCKED_ALGORITHM_VERSIONS[descriptor.moduleId] || {},
    state: "blocked",
    reason: "exact historical executable corpus is unavailable; dependent pre-release sessions are archive-only"
  })).filter((historic) =>
    typeof historic.artifactHash === "string" &&
    historic.artifactHash !== MODULE_REGISTRY?.get?.(historic.moduleId)?.artifactHash)
]);

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
  HISTORICAL_BLOCKED_LOCKS,
  PRE_GEOMETRY_BLOCKED_ARTIFACTS,
  MAX_DECK_ITEMS,
  MAX_SESSION_RANDOM_STREAMS,
  MECHANICS_ARTIFACT_REGISTRY,
  MODULE_CORPUS_FILES,
  MODULE_REGISTRY,
  OPERATION_CATALOG,
  OPERATION_MODULES,
  PRE_PARAMETERIZED_DECK_BLOCKED_ARTIFACTS,
  PRE_FINITE_NUMBER_BLOCKED_ARTIFACTS,
  SHARED_KERNEL_FILES,
  SHARED_KERNEL_HASH,
  SHARED_KERNEL_VERSION,
  SHARED_VALIDATION_DEPENDENCIES,
  PRE_SET_ADD_BLOCKED_ARTIFACTS,
  assertOperationCatalogComplete,
  hashMechanicsCorpus,
  hashModuleArtifact,
  moduleIdsForOperations,
  recommendedModuleLock,
  recommendedModuleLockForOperations
};
