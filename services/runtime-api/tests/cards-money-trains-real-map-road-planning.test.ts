/**
 * End-to-end proof that road planning (ADR-100) actually works on the real,
 * published map of «Карты, деньги, поезда» ("Cards, Money, Trains") — not on a
 * hand-drawn fixture small enough to verify by eye.
 *
 * Every other road-planning test in this directory (`road-planning-route.test.ts`,
 * `road-planning-geometry.test.ts`) uses tiny synthetic maps — squares and
 * strips whose correct answer a person can work out by hand. That is the right
 * tool for checking the *rule* the planner follows. It cannot prove the rule
 * survives contact with the real map: 917 author-confirmed regions with tens of
 * thousands of vertices (see `docs/architecture/adrs/100-region-road-planning-
 * navigation-mesh.md` §2), which is exactly the geometry that made the
 * previous algorithm version fail outright. This file is the missing proof:
 * it loads the game's own compiled manifest from disk, the same file the
 * running game serves to players, and asks the planner to build a road between
 * two of its real terminals.
 *
 * Three things are checked, matching the planner's own three-part guarantee
 * (ADR-100 §4.5):
 *
 * 1. a road is actually found (version 1 could not do this at all on this map);
 * 2. every paid stretch of the road really lies inside the region it is
 *    charged for — sampled along each stretch, not just at its two ends,
 *    because a straight line can leave a bent region between two points that
 *    are both inside it;
 * 3. consecutive regions in the road's sequence really share a border, so the
 *    road never silently "jumps" between two regions that do not touch.
 *
 * The cost of this proof is real and is not hidden: compiling the map (parsing
 * its 984 regions, validating them, and deriving the ~2 500 borders between
 * them) is measured in ADR-100 §4.4 at about 5 seconds, done once per process and
 * cached by the map's checksum afterwards. This file pays that cost itself
 * rather than assume some earlier test already warmed the cache, and reports
 * how long it took so a slow run is visible instead of silently absorbed by a
 * generous timeout.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type {
  GameManifestCanonicalPoint,
  GameManifestTransportNetworkModel
} from "@cubica/contracts-manifest";

import { pointInOrOnRegion } from "../src/modules/runtime/regionRoadGeometry.ts";
import {
  compileRegionRoadPlanning,
  planMinimumRegionRoad,
  resetCompiledRoadPlanningCache,
  type RegionRoadCandidate
} from "../src/modules/runtime/regionRoadPlanner.ts";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, "..", "..", "..");
const manifestPath = path.join(repoRoot, "games", "cards-money-trains", "game.manifest.json");

/** The real, published manifest — read fresh, not a fixture copy. */
const loadRealManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

type NetworkNode = { objectType: string; attributes: { position: GameManifestCanonicalPoint } };

/** A real terminal's position, read the same way the runtime itself would. */
const terminalPosition = (
  manifest: Record<string, unknown>,
  nodeId: string
): GameManifestCanonicalPoint => {
  const state = manifest.state as { public: { objects: { networkNodes: Record<string, NetworkNode> } } };
  const node = state.public.objects.networkNodes[nodeId];
  assert.ok(node, `manifest does not declare node "${nodeId}"`);
  return node.attributes.position;
};

const mainNetworkModel = (manifest: Record<string, unknown>): GameManifestTransportNetworkModel => {
  const networkModels = manifest.networkModels as Record<string, GameManifestTransportNetworkModel>;
  const model = networkModels.main;
  assert.ok(model, "manifest does not declare the main network model");
  assert.ok(model.roadPlanning, "main network model did not opt in to road planning (ADR-100)");
  return model;
};

/**
 * Every paid stretch of the road must really lie in the region it is charged
 * to. Checking only the two corner points of a stretch is not enough — a
 * straight line between two points inside a bent (non-convex) region can pass
 * outside it in between — so each stretch is walked in twenty steps.
 *
 * This is the same technique `road-planning-route.test.ts` uses on its tiny
 * fixture maps; repeated here (rather than imported) because that file's
 * helper is intentionally private to its own small-map fixtures, and this
 * file's whole point is to run the identical check against the real map
 * instead of a fixture.
 */
const assertPassagesStayInsideTheirRegions = (
  model: GameManifestTransportNetworkModel,
  road: RegionRoadCandidate
): void => {
  const byId = new Map(model.regions.map((region) => [region.id, region]));
  for (const passage of road.passages) {
    const region = byId.get(passage.regionId);
    assert.ok(region, `passage names region "${passage.regionId}", which the manifest does not declare`);
    for (let index = passage.fromPointIndex; index < passage.toPointIndex; index += 1) {
      const from = road.points[index];
      const to = road.points[index + 1];
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const sample = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        assert.ok(
          pointInOrOnRegion(sample, region as Parameters<typeof pointInOrOnRegion>[1]),
          `road leaves region "${passage.regionId}" it is charged for, at (${sample.x}, ${sample.y})`
        );
      }
    }
  }
  // The passages must also tile the road's own points exactly: no gap, no
  // overlap, starting at the first point and ending at the last.
  assert.equal(road.passages[0]?.fromPointIndex, 0);
  assert.equal(road.passages.at(-1)?.toPointIndex, road.points.length - 1);
  for (let index = 1; index < road.passages.length; index += 1) {
    assert.equal(
      road.passages[index].fromPointIndex,
      road.passages[index - 1].toPointIndex,
      "one stretch must begin exactly where the previous one ended"
    );
  }
};

/**
 * Consecutive regions in the road's sequence must really share a border — the
 * road must never appear to "jump" from one region straight into another that
 * does not touch it. `compileRegionRoadPlanning` derives exactly this
 * adjacency (`neighbours`, built from the same border crossings the published
 * checksum covers), so this check reuses that answer instead of re-deriving
 * borders a second time.
 */
const assertConsecutiveRegionsAreNeighbours = (
  model: GameManifestTransportNetworkModel,
  road: RegionRoadCandidate
): void => {
  const { neighbours } = compileRegionRoadPlanning(model);
  for (let index = 1; index < road.regionSequence.length; index += 1) {
    const previous = road.regionSequence[index - 1];
    const current = road.regionSequence[index];
    if (previous === current) continue;
    assert.ok(
      neighbours.get(previous)?.includes(current),
      `region "${previous}" and region "${current}" are consecutive in the road but do not share a border`
    );
  }
};

test("planning a road on the real author map finds one, and every stretch is honest", () => {
  const manifest = loadRealManifest();
  const model = mainNetworkModel(manifest);
  // Not a pinned count: the map has already been redrawn once (the first
  // partition held 917 areas; cutting the impassable terrain out of it raised
  // that to 984), and a literal here would only ever describe the map of the
  // day. What must hold of *any* published map is that it is a real partition
  // rather than a placeholder — the placeholder this replaced had 20 strips.
  assert.ok(
    model.regions.length > 100,
    `the published map must be a real partition, not a placeholder; got ${model.regions.length} regions`
  );

  // Start from a clean cache so the timing below is the real, first-in-process
  // cost of this map (ADR-100 §4.4), not a warm re-use left over from an
  // earlier test file sharing the same process.
  resetCompiledRoadPlanningCache();

  const from = terminalPosition(manifest, "terminal-20");
  const to = terminalPosition(manifest, "terminal-14");

  const firstCallStartedAt = performance.now();
  const { road: firstRoad } = planMinimumRegionRoad({ model, from, to });
  const firstCallMilliseconds = performance.now() - firstCallStartedAt;
  // Not a tight timeout: ADR-100 §4.4 measures the first call (map compile +
  // first corridor) at up to about 520 ms on top of the ~5 s one-time parse
  // and validation of the whole map, measured on a dedicated, idle machine.
  // Run as part of the full `services/runtime-api` suite (dozens of test
  // files, some running concurrently), this same call was measured taking
  // over 16 s under contention alone — CPU-time work, not a hang — so the
  // bound below is generous headroom for a shared, loaded CI machine, not a
  // target to shave close to. The point of this assertion is to catch a real
  // regression (e.g. the cache not being used, or a quadratic blow-up in the
  // map compile), not to enforce a specific millisecond budget on this map.
  assert.ok(
    firstCallMilliseconds < 60_000,
    `first road-planning call on the real map took ${firstCallMilliseconds.toFixed(1)} ms, ` +
    "far above the ~5 s one-time compile ADR-100 §4.4 measured on an idle machine"
  );
  process.stdout.write(
    `cards-money-trains-real-map-road-planning: first call (cold cache) took ${firstCallMilliseconds.toFixed(1)} ms\n`
  );

  assert.ok(firstRoad.regionSequence.length >= 1, "a road must cross at least one region");
  assert.ok(firstRoad.points.length >= 2, "a road must have at least a start and an end point");
  assertPassagesStayInsideTheirRegions(model, firstRoad);
  assertConsecutiveRegionsAreNeighbours(model, firstRoad);

  // A second, independent pair of real terminals, planned with the map already
  // compiled and cached. This both exercises a second corridor on the real
  // map and demonstrates the cache ADR-100 §4.4 relies on: it must be
  // markedly faster than the first, cold call above.
  const secondFrom = terminalPosition(manifest, "terminal-4");
  const secondTo = terminalPosition(manifest, "terminal-10");
  const secondCallStartedAt = performance.now();
  const { road: secondRoad } = planMinimumRegionRoad({ model, from: secondFrom, to: secondTo });
  const secondCallMilliseconds = performance.now() - secondCallStartedAt;
  process.stdout.write(
    `cards-money-trains-real-map-road-planning: second call (warm cache) took ${secondCallMilliseconds.toFixed(1)} ms\n`
  );
  assert.ok(
    secondCallMilliseconds < firstCallMilliseconds,
    "a warm-cache call must be faster than the cold call that compiled the whole map"
  );
  assertPassagesStayInsideTheirRegions(model, secondRoad);
  assertConsecutiveRegionsAreNeighbours(model, secondRoad);
});

/**
 * A point safely inside a region: the average of its outer-ring vertices.
 *
 * Good enough here and nowhere else: it is used only on two small, roughly
 * convex regions named below, and the test proves the point really is usable
 * by planning a road from it. A general "point inside any polygon" needs a
 * representative point, not an average, because the average of a bent shape's
 * vertices can fall outside the shape.
 */
const averageVertex = (
  model: GameManifestTransportNetworkModel,
  regionId: string
): GameManifestCanonicalPoint => {
  const region = model.regions.find((candidate) => candidate.id === regionId);
  assert.ok(region, `manifest does not declare region "${regionId}"`);
  const ring = region.polygon;
  const sum = ring.reduce(
    (total, point) => ({ x: total.x + point.x, y: total.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / ring.length, y: sum.y / ring.length };
};

/**
 * The author declared some terrain impassable — dark-brown patches drawn on the
 * map, plus the river joining two lakes — and the game publishes those regions
 * as `excludedRegionIds` (see games/cards-money-trains/annotations/README.md,
 * "Непроходимая местность и река"). A road must never be planned through them.
 *
 * The test would prove nothing if the terrain simply happened not to lie on the
 * way, so it states its own premise and checks it: the same two endpoints,
 * planned WITHOUT the exclusion, must really cross the barrier. If a future map
 * redraw moves the terrain elsewhere, this fails loudly on the premise instead
 * of quietly passing while testing nothing.
 *
 * The three region ids are pinned deliberately: `map-region-0921` is a piece of
 * impassable terrain, and the other two are its playable neighbours on opposite
 * sides of it. They were not chosen by eye — they were found by asking the
 * planner itself for a pair whose unrestricted road crosses terrain.
 */
test("a road is never planned through terrain the author declared impassable", () => {
  const manifest = loadRealManifest();
  const model = mainNetworkModel(manifest);
  const state = manifest.state as {
    public: { transportNetworks: { main: { excludedRegionIds: ReadonlyArray<string> } } };
  };
  const excludedRegionIds = state.public.transportNetworks.main.excludedRegionIds;
  assert.ok(
    excludedRegionIds.length > 0,
    "the published map is expected to declare impassable terrain"
  );
  const excluded = new Set(excludedRegionIds);
  assert.ok(excluded.has("map-region-0921"), "map-region-0921 is expected to be impassable terrain");

  const from = averageVertex(model, "map-region-0038");
  const to = averageVertex(model, "map-region-0919");

  // The premise: without the exclusion the shortest road really does cut
  // through the terrain barrier between these two regions.
  const { road: throughTerrain } = planMinimumRegionRoad({ model, from, to });
  const crossed = throughTerrain.regionSequence.filter((id) => excluded.has(id));
  assert.ok(
    crossed.length > 0,
    "premise broken: the unrestricted road no longer crosses impassable terrain, so this test would prove nothing"
  );

  // The guarantee: with the exclusion the planner finds a road that avoids the
  // terrain entirely — and it is still a real, honest road, not a shortcut that
  // leaves the regions it is charged for.
  const { road: detour } = planMinimumRegionRoad({ model, from, to, excludedRegionIds });
  const stillCrossed = detour.regionSequence.filter((id) => excluded.has(id));
  assert.deepEqual(
    stillCrossed,
    [],
    `the planned road passes through impassable terrain: ${stillCrossed.join(", ")}`
  );
  assertPassagesStayInsideTheirRegions(model, detour);
  assertConsecutiveRegionsAreNeighbours(model, detour);
});
