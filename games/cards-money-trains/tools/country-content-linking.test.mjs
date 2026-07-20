/**
 * Focused proof for the author-confirmed country and terminal catalogue.
 *
 * The test checks the generated authoring and its two declarative inputs. It
 * does not treat the still-unreviewed vector line classification as geometry.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authoringPath,
  buildCountryCatalogue,
  buildCountryContentAuthoring,
  buildFromDisk,
  descriptionsPath,
  mappingPath
} from "./build-country-content.mjs";

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

const expectedCountryIds = [
  "cmt-country-proud",
  "cmt-country-north",
  "cmt-country-white",
  "cmt-country-central",
  "cmt-country-south-rorschach",
  "cmt-country-left",
  "cmt-country-lower",
  "cmt-country-subbelly",
  "cmt-country-ultra-right",
  "cmt-country-people"
];

test("mapping joins every immutable description and numbered terminal once", async () => {
  const [mapping, descriptions] = await Promise.all([
    readJson(mappingPath),
    readJson(descriptionsPath)
  ]);
  const countries = buildCountryCatalogue(mapping, descriptions);
  const terminalIds = countries.flatMap((country) => country.terminalIds);

  assert.deepEqual(
    countries.map((country) => country.id),
    expectedCountryIds
  );
  assert.equal(countries.length, descriptions.countryRecords.length);
  assert.equal(terminalIds.length, 23);
  assert.equal(new Set(terminalIds).size, 23);
  assert.ok(countries.every((country) => country.description.length > 0));
  assert.deepEqual(countries[0].terminalIds, []);
  assert.deepEqual(
    countries.find((country) => country.id === "cmt-country-white")?.terminalIds,
    ["terminal-5", "terminal-7"]
  );
});

test("generated authoring stores narratives as content and only country ids on nodes", async () => {
  const [actual, expected, mapping, descriptions] = await Promise.all([
    readJson(authoringPath),
    buildFromDisk(),
    readJson(mappingPath),
    readJson(descriptionsPath)
  ]);

  assert.deepEqual(actual, expected);
  assert.deepEqual(
    buildCountryContentAuthoring(actual, mapping, descriptions),
    actual,
    "the country transformation must be idempotent"
  );

  const root = actual.root;
  const countries = root.content.data.countries;
  assert.equal(countries.status, "author-confirmed-terminal-linking");
  assert.equal(countries.publishable, true);
  assert.equal(countries.polygonLinking, "pending-human-vector-review");
  assert.deepEqual(
    countries.countries.map((country) => country.id),
    expectedCountryIds
  );
  assert.ok(!root.config.runtimeBlockers.includes(
    "country and terminal content linking"
  ));
  assert.ok(root.config.runtimeBlockers.includes("canonical region polygons"));

  assert.deepEqual(
    root.mechanics.stateModel.collections.networkNodes.fields.countryId,
    {
      storage: { kind: "attribute", name: "countryId" },
      valueType: "core.optional-string",
      access: "read-only"
    }
  );

  const nodes = root.state.public.objects.networkNodes;
  assert.equal(nodes["terminal-1"].attributes.countryId, "cmt-country-central");
  assert.equal(nodes["terminal-5"].attributes.countryId, "cmt-country-white");
  assert.equal(nodes["terminal-23"].attributes.countryId, "cmt-country-south-rorschach");
  assert.equal(nodes["terminal-3-14"].attributes.countryId, null);
  assert.equal(nodes["waypoint-9-3-4"].attributes.countryId, null);

  const waypointLifecycleStep =
    root.mechanics.plans["construction.waypoint.build"].transaction.steps
      .find((step) => step.id === "mark-node-lifecycle");
  assert.equal(
    waypointLifecycleStep.patches.find(
      (patch) => patch.path?.[0] === "countryId"
    ),
    undefined
  );
});
