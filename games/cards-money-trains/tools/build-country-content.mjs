#!/usr/bin/env node
/**
 * Link the author-confirmed country catalogue to numbered map terminals.
 *
 * The immutable PDF intake remains the only copy of each narrative. The
 * separate mapping fixture contains the author's terminal membership and
 * stable game-local country IDs. This generator joins those two declarative
 * sources into publishable game content and stores only the short `countryId`
 * on mutable network nodes.
 *
 * Country and region polygons are intentionally outside this transformation:
 * their vector classification still requires a human visual review.
 */

import assert from "node:assert/strict";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const scriptFile = fileURLToPath(import.meta.url);
const toolsRoot = path.dirname(scriptFile);
const gameRoot = path.resolve(toolsRoot, "..");
const fixtureRoot = path.join(gameRoot, "authoring", "fixtures");

const authoringPath = path.join(gameRoot, "authoring", "game.authoring.json");
const descriptionsPath = path.join(
  fixtureRoot,
  "country-descriptions.intake.json"
);
const descriptionsSchemaPath = path.join(
  fixtureRoot,
  "country-descriptions.intake.schema.json"
);
const mappingPath = path.join(fixtureRoot, "country-terminal-mapping.json");
const mappingSchemaPath = path.join(
  fixtureRoot,
  "country-terminal-mapping.schema.json"
);

const numberedTerminalIds = Array.from(
  { length: 23 },
  (_, index) => `terminal-${index + 1}`
);
const numberedTerminalSet = new Set(numberedTerminalIds);
const expectedSpecialNodeIds = new Set([
  "terminal-3-14",
  "waypoint-9-3-4"
]);

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

/**
 * Execute the JSON Schema source of truth before any semantic cross-check.
 *
 * Manual assertions below only compare identities across two independently
 * valid documents; they never replace structural validation.
 */
const validateWithSchema = (value, schema, label) => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error(
      `${label} does not match JSON Schema: ${ajv.errorsText(validate.errors)}`
    );
  }
};

/**
 * Join author-confirmed IDs with immutable extracted source narratives.
 *
 * The returned objects are safe manifest content. Source wrapping and review
 * metadata stay in the intake artifact and are not duplicated in runtime.
 */
const buildCountryCatalogue = (mapping, descriptions) => {
  const recordsById = new Map(
    descriptions.countryRecords.map((record) => [record.id, record])
  );
  const seenCountryIds = new Set();
  const seenSourceIds = new Set();
  const seenTerminalIds = new Set();

  const countries = mapping.countries.map((country) => {
    assert.ok(
      !seenCountryIds.has(country.countryId),
      `duplicate country id ${country.countryId}`
    );
    assert.ok(
      !seenSourceIds.has(country.sourceRecordId),
      `duplicate description record ${country.sourceRecordId}`
    );
    seenCountryIds.add(country.countryId);
    seenSourceIds.add(country.sourceRecordId);

    const source = recordsById.get(country.sourceRecordId);
    assert.ok(source, `missing description ${country.sourceRecordId}`);
    assert.equal(
      country.title,
      source.sourceTitle,
      `${country.countryId} title must match the author PDF`
    );

    const sourceTerminalIds = source.sourceTerminalLabels.map(
      (label) => `terminal-${label}`
    );
    assert.deepEqual(
      country.terminalIds,
      sourceTerminalIds,
      `${country.countryId} terminal order must match the author PDF`
    );
    for (const terminalId of country.terminalIds) {
      assert.ok(
        numberedTerminalSet.has(terminalId),
        `${country.countryId} uses unsupported terminal ${terminalId}`
      );
      assert.ok(
        !seenTerminalIds.has(terminalId),
        `${terminalId} belongs to more than one country`
      );
      seenTerminalIds.add(terminalId);
    }

    return {
      id: country.countryId,
      title: country.title,
      description: source.text,
      terminalIds: [...country.terminalIds]
    };
  });

  assert.equal(countries.length, 10, "exactly ten countries are required");
  assert.deepEqual(
    [...seenTerminalIds].sort(compareTerminalIds),
    numberedTerminalIds,
    "country mapping must cover terminals 1–23 exactly once"
  );
  assert.equal(
    seenSourceIds.size,
    descriptions.countryRecords.length,
    "every extracted description must be linked exactly once"
  );
  return countries;
};

const compareTerminalIds = (left, right) =>
  Number(left.slice("terminal-".length))
  - Number(right.slice("terminal-".length));

/**
 * Apply only country content and short node references to game authoring.
 *
 * This is deliberately idempotent and independent of the order in which
 * action generators were applied. Newly constructed waypoints omit the
 * optional reference until approved polygons can place them in a country
 * reliably.
 */
const buildCountryContentAuthoring = (
  sourceAuthoring,
  mapping,
  descriptions
) => {
  const authoring = structuredClone(sourceAuthoring);
  const root = authoring.root;
  const countries = buildCountryCatalogue(mapping, descriptions);
  const countryByTerminalId = new Map(
    countries.flatMap((country) =>
      country.terminalIds.map((terminalId) => [terminalId, country.id])
    )
  );

  const networkNodes = root.state.public.objects.networkNodes;
  const nodeFields = root.mechanics.stateModel.collections.networkNodes?.fields;
  assert.ok(networkNodes && typeof networkNodes === "object");
  assert.ok(nodeFields, "networkNodes collection is required");

  nodeFields.countryId = {
    storage: { kind: "attribute", name: "countryId" },
    valueType: "core.optional-string",
    access: "read-only"
  };

  for (const [nodeId, node] of Object.entries(networkNodes)) {
    const countryId = countryByTerminalId.get(nodeId) ?? null;
    if (numberedTerminalSet.has(nodeId)) {
      assert.ok(countryId, `${nodeId} has no confirmed country`);
    } else {
      assert.ok(
        expectedSpecialNodeIds.has(nodeId)
        || node.objectType === "transport.waypoint",
        `unexpected non-numbered network node ${nodeId}`
      );
    }
    node.attributes.countryId = countryId;
  }

  /*
   * `countryId` is immutable authored content. A dynamic waypoint cannot infer
   * a country before the region polygons are approved, so its optional field
   * stays absent. In particular, construction must not weaken the read-only
   * boundary merely to write an explicit `null`.
   */
  const waypointLifecycleStep =
    root.mechanics.plans["construction.waypoint.build"]?.transaction.steps
      .find((step) => step.id === "mark-node-lifecycle");
  if (waypointLifecycleStep) {
    const patches = waypointLifecycleStep.patches;
    assert.ok(Array.isArray(patches), "waypoint lifecycle patches are required");
    waypointLifecycleStep.patches = patches.filter(
      (patch) => patch.path?.[0] !== "countryId"
    );
  }

  root.content.data.countries = {
    status: "author-confirmed-terminal-linking",
    publishable: true,
    terminalLinking: "complete-numbered-terminals-1-through-23",
    polygonLinking: "pending-human-vector-review",
    countries
  };

  const blockers = new Set(root.config.runtimeBlockers);
  blockers.delete("country and terminal content linking");
  // The country catalogue does not make any unreviewed line into a polygon.
  blockers.add("canonical region polygons");
  root.config.runtimeBlockers = [...blockers];
  root.config.runtimeReady = false;

  return authoring;
};

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

const buildFromDisk = async () => {
  const [
    sourceAuthoring,
    mapping,
    mappingSchema,
    descriptions,
    descriptionsSchema
  ] = await Promise.all([
    readJson(authoringPath),
    readJson(mappingPath),
    readJson(mappingSchemaPath),
    readJson(descriptionsPath),
    readJson(descriptionsSchemaPath)
  ]);
  validateWithSchema(mapping, mappingSchema, "country-terminal mapping");
  validateWithSchema(
    descriptions,
    descriptionsSchema,
    "country-description intake"
  );
  return buildCountryContentAuthoring(
    sourceAuthoring,
    mapping,
    descriptions
  );
};

const writeAtomically = async (filePath, content) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

const run = async (argv) => {
  const checkOnly = argv.length === 1 && argv[0] === "--check";
  if (argv.length > (checkOnly ? 1 : 0)) {
    throw new Error("usage: build-country-content.mjs [--check]");
  }
  const sourceText = await readFile(authoringPath, "utf8");
  const builtText = serialize(await buildFromDisk());
  if (checkOnly) {
    assert.equal(
      sourceText,
      builtText,
      "country content authoring is stale; run build-country-content.mjs"
    );
  } else {
    await writeAtomically(authoringPath, builtText);
  }
  process.stdout.write(
    `cards-money-trains: ${checkOnly ? "verified" : "built"} author-confirmed country content\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  run(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}

export {
  authoringPath,
  buildCountryCatalogue,
  buildCountryContentAuthoring,
  buildFromDisk,
  descriptionsPath,
  mappingPath
};
