/**
 * Authoritative road planning for declarative transport maps, version 3.
 *
 * The rule of the game is unchanged and is the reason this module exists: a
 * road between two points crosses as few regions as possible, and that number
 * — not its length — is what a game may charge for. Version 3 keeps the
 * navigation mesh and adds exact predicates plus unique boundary ownership.
 * See ADR-100.
 *
 * A road is planned in three steps:
 *
 * 1. **How many regions.** A breadth-first search over the region graph gives
 *    the smallest possible number of regions, and the set of regions that lie
 *    on at least one such shortest chain. This step is exact.
 * 2. **Which corridor.** Inside that set the regions are split into triangles
 *    and a shortest-path search picks a chain of triangles from start to goal.
 * 3. **Which line.** The line is pulled straight through that chain of
 *    triangles, which gives the exact shortest line inside it.
 *
 * The honest limit of the guarantee: step 1 is a true minimum and step 3 is a
 * true shortest line inside the chosen corridor, but step 2 chooses among
 * equally cheap corridors by a reproducible search rather than by proving which
 * one yields the globally shortest line. That is how movement over terrain is
 * planned everywhere it is planned, and it is acceptable here because neither
 * the price nor the legality of a road depends on its length — only its
 * appearance does. Claiming more would be untrue.
 *
 * The module fails closed. Returning an attractive but invalid road would
 * silently charge the wrong price, which is worse than refusing the action.
 */
import { isDeepStrictEqual } from "node:util";
import type {
  GameManifestCanonicalPoint,
  GameManifestTransportNetworkModel,
  GameManifestTransportRoadPlanning
} from "@cubica/contracts-manifest";
import { chargeGeometryWork } from "../geometryPredicates.ts";

import {
  type CanonicalRegion,
  type RegionCrossing,
  REGION_ROAD_BOUNDARY_POLICY,
  REGION_ROAD_PLANNING_ALGORITHM,
  REGION_ROAD_PLANNING_MODE,
  REGION_ROAD_TIE_BREAK,
  canonicalizeRoadPlanningRegions,
  codepointCompare,
  computeRegionRoadPlanningHash,
  cross,
  deriveRegionCrossings,
  distance,
  finitePoint,
  interpolate,
  pointInOrOnRegion,
  pointKey,
  pointNearlyEquals,
  subtract
} from "./regionRoadGeometry.ts";
import {
  type CorridorMesh,
  MAX_CORRIDOR_REGIONS,
  RegionMeshCache,
  buildCorridorMesh,
  triangleContains
} from "./navigationMesh.ts";
import { funnelPath, orientGates } from "./funnelPath.ts";

export {
  REGION_ROAD_BOUNDARY_POLICY,
  REGION_ROAD_PLANNING_ALGORITHM,
  REGION_ROAD_PLANNING_MODE,
  REGION_ROAD_TIE_BREAK
};

const EPSILON = 1e-9;
/** How many compiled maps are kept in memory; see `compileRegionRoadPlanning`. */
const MAX_COMPILED_MAPS = 4;

type Point = GameManifestCanonicalPoint;

export interface RegionRoadPassage {
  regionId: string;
  fromPointIndex: number;
  toPointIndex: number;
}

/** The planned road: its line, the regions it crosses, and where it crosses them. */
export interface RegionRoadCandidate {
  points: Array<Point>;
  regionSequence: Array<string>;
  passages: Array<RegionRoadPassage>;
}

export interface CompiledRegionRoadPlanning {
  planning: GameManifestTransportRoadPlanning;
  regions: Array<CanonicalRegion>;
  crossings: Array<RegionCrossing>;
  regionsById: Map<string, CanonicalRegion>;
  /** Which regions border which, derived from the crossings. */
  neighbours: Map<string, Array<string>>;
  mesh: RegionMeshCache;
}

/**
 * Deterministic resource hook used by the Mechanics executor.
 *
 * The planner keeps its own hard ceilings as a final defence, while this hook
 * makes its work visible to the transaction-wide budget.
 */
export interface RegionRoadPlannerWorkMeter {
  charge(units: number): void;
}

const chargePlannerWork = (meter: RegionRoadPlannerWorkMeter | undefined, units: number): void => {
  if (units > 0) meter?.charge(units);
};

/* -------------------------------------------------------------------------- */
/* Compilation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Compiled maps are kept between requests, keyed by the checksum the package
 * published.
 *
 * Validating the first real author map and deriving its crossings takes about
 * three seconds — work that depends only on the map and produces the same
 * answer every time. Version 1 repeated it on every single planning request.
 * The cache is small and bounded because a running server serves few distinct
 * maps at once; the checksum is the right key precisely because two packages
 * with the same checksum are the same map by definition.
 */
const compiledByHash = new Map<string, CompiledRegionRoadPlanning>();

/** Validate and compile the immutable, schema-first planning contract. */
export const compileRegionRoadPlanning = (
  model: GameManifestTransportNetworkModel,
  workMeter?: RegionRoadPlannerWorkMeter
): CompiledRegionRoadPlanning => {
  const planning = model.roadPlanning;
  if (!planning) throw new Error("Transport network did not opt in to authoritative road planning");
  if (planning.mode !== REGION_ROAD_PLANNING_MODE ||
      planning.algorithmVersion !== REGION_ROAD_PLANNING_ALGORITHM ||
      planning.tieBreak !== REGION_ROAD_TIE_BREAK ||
      planning.boundaryPolicy !== REGION_ROAD_BOUNDARY_POLICY) {
    throw new Error("Transport network declares an unsupported road-planning contract");
  }
  const cached = compiledByHash.get(planning.geometryHash);
  if (cached && isDeepStrictEqual(cached.planning, planning)) {
    // The published hash is an assertion, not proof. Compare the complete
    // immutable geometry against the validated snapshot before reusing it so
    // a second model cannot borrow an earlier model's cache entry by copying
    // its claimed checksum.
    chargePlannerWork(workMeter, model.regions.reduce(
      (sum, region) => sum + region.polygon.length +
        (region.holes ?? []).reduce((holeSum, hole) => holeSum + hole.length, 0),
      model.regions.length
    ));
    if (!isDeepStrictEqual(cached.regions, model.regions)) {
      // Continue through ordinary canonicalization and checksum verification;
      // it will produce the precise mismatch without disturbing the valid LRU
      // entry already held under this claimed hash.
    } else {
    // Refresh insertion order so the bounded map evicts the least recently
    // used compiled geometry instead of the merely oldest inserted geometry.
      compiledByHash.delete(planning.geometryHash);
      compiledByHash.set(planning.geometryHash, cached);
      return cached;
    }
  }

  // A cache miss is the only request that performs immutable map validation.
  // The geometry layer charges each real scan before entering it; a linear
  // estimate here would underprice spatial prefilters and containment scans.
  const regions = canonicalizeRoadPlanningRegions(model.regions, workMeter);
  // Planned content is required to be compiler-canonical. Normalising silently
  // at runtime would make the advertised package checksum ambiguous.
  if (!isDeepStrictEqual(model.regions, regions)) {
    throw new Error("Road-planning regions must use compiler-canonical ordering");
  }
  const crossings = deriveRegionCrossings(regions, workMeter);
  const geometryHash = computeRegionRoadPlanningHash({
    algorithmVersion: planning.algorithmVersion,
    boundaryPolicy: planning.boundaryPolicy,
    regions,
    crossings
  });
  if (planning.geometryHash !== geometryHash) {
    throw new Error(`Road-planning geometry hash mismatch: expected ${geometryHash}`);
  }
  const neighbours = new Map<string, Array<string>>(regions.map((region) => [region.id, []]));
  for (const crossing of crossings) {
    const [left, right] = crossing.regionIds;
    neighbours.get(left)?.push(right);
    neighbours.get(right)?.push(left);
  }
  for (const [regionId, list] of neighbours) {
    neighbours.set(regionId, [...new Set(list)].sort(codepointCompare));
  }
  const compiled: CompiledRegionRoadPlanning = {
    planning,
    regions,
    crossings,
    regionsById: new Map(regions.map((region) => [region.id, region])),
    neighbours,
    mesh: new RegionMeshCache(regions, crossings)
  };
  if (compiledByHash.size >= MAX_COMPILED_MAPS) {
    const oldest = compiledByHash.keys().next();
    if (!oldest.done) compiledByHash.delete(oldest.value);
  }
  compiledByHash.set(geometryHash, compiled);
  return compiled;
};

/* -------------------------------------------------------------------------- */
/* Step 1 — how many regions                                                   */
/* -------------------------------------------------------------------------- */

/** Distance in regions from a set of starting regions, over the region graph. */
const regionDistances = (
  compiled: CompiledRegionRoadPlanning,
  origins: ReadonlyArray<string>,
  excluded: ReadonlySet<string>,
  workMeter?: RegionRoadPlannerWorkMeter
): Map<string, number> => {
  const distances = new Map<string, number>();
  const queue: Array<string> = [];
  for (const origin of origins) {
    if (excluded.has(origin) || distances.has(origin)) continue;
    distances.set(origin, 1);
    queue.push(origin);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const next = (distances.get(current) as number) + 1;
    const list = compiled.neighbours.get(current) ?? [];
    chargePlannerWork(workMeter, list.length);
    for (const neighbour of list) {
      if (excluded.has(neighbour) || distances.has(neighbour)) continue;
      distances.set(neighbour, next);
      queue.push(neighbour);
    }
  }
  return distances;
};

interface MinimumCorridor {
  /** Smallest possible number of regions between the two endpoints. */
  regionCount: number;
  /** Regions lying on at least one chain of that length, with their depth. */
  depthByRegion: Map<string, number>;
  startRegions: Array<string>;
  endRegions: Set<string>;
}

/**
 * Find the smallest number of regions and everything that can lie on such a
 * chain.
 *
 * A region belongs to a shortest chain exactly when its distance from the start
 * plus its distance from the goal, counted in regions, adds up to the minimum.
 * Keeping the depth of each region lets the next step forbid sideways and
 * backwards moves, which is what guarantees that whatever line it finds crosses
 * exactly the minimum number of regions and not one more.
 */
const findMinimumCorridor = (options: {
  compiled: CompiledRegionRoadPlanning;
  from: Point;
  to: Point;
  excluded: ReadonlySet<string>;
  workMeter?: RegionRoadPlannerWorkMeter;
}): MinimumCorridor => {
  const ownerOf = (point: Point): string | undefined => {
    for (const region of options.compiled.regions) {
      chargePlannerWork(
        options.workMeter,
        region.polygon.length + (region.holes ?? []).reduce((sum, hole) => sum + hole.length, 0)
      );
      if (pointInOrOnRegion(point, region)) return region.id;
    }
    return undefined;
  };
  // Regions are compiler-sorted by id. The first membership is therefore the
  // unique owner required by `boundaryPolicy: lowest-region-id`; filtering
  // exclusions afterwards prevents an excluded lowest owner from silently
  // transferring its boundary to a higher id.
  const startOwner = ownerOf(options.from);
  const endOwner = ownerOf(options.to);
  const startRegions = startOwner && !options.excluded.has(startOwner) ? [startOwner] : [];
  const endRegions = endOwner && !options.excluded.has(endOwner) ? [endOwner] : [];
  if (startRegions.length === 0 || endRegions.length === 0) {
    throw new Error("Road endpoints must lie inside non-excluded declared regions");
  }
  const forward = regionDistances(options.compiled, startRegions, options.excluded, options.workMeter);
  const backward = regionDistances(options.compiled, endRegions, options.excluded, options.workMeter);
  const reachableEnds = endRegions.filter((regionId) => forward.has(regionId));
  if (reachableEnds.length === 0) throw new Error("No road route connects the selected regions");
  const regionCount = Math.min(...reachableEnds.map((regionId) => forward.get(regionId) as number));
  const depthByRegion = new Map<string, number>();
  for (const [regionId, depth] of forward) {
    const back = backward.get(regionId);
    if (back === undefined) continue;
    if (depth + back - 1 === regionCount) depthByRegion.set(regionId, depth);
  }
  if (depthByRegion.size > MAX_CORRIDOR_REGIONS) {
    throw new Error(
      `Road planning admits ${depthByRegion.size} regions on shortest chains, above the ${MAX_CORRIDOR_REGIONS} limit`
    );
  }
  return { regionCount, depthByRegion, startRegions, endRegions: new Set(endRegions) };
};

/* -------------------------------------------------------------------------- */
/* Step 2 — which corridor                                                     */
/* -------------------------------------------------------------------------- */

const gateMidpoint = (gate: readonly [Point, Point]): Point => ({
  x: (gate[0].x + gate[1].x) / 2,
  y: (gate[0].y + gate[1].y) / 2
});

/**
 * Choose a chain of triangles from start to goal.
 *
 * The search measures a step by the distance between the middles of the gates
 * it passes through. That measure is not the length of the final line — the
 * line is pulled straight afterwards and is shorter — but it is monotone,
 * cheap, and orders corridors sensibly, which is all this step has to do. It is
 * the standard way of searching a triangulated surface.
 *
 * Exact ties are broken by the sequence of triangles reached, so that two
 * corridors of identical measured cost always resolve the same way.
 */
const findTriangleCorridor = (options: {
  mesh: CorridorMesh;
  depthByRegion: Map<string, number>;
  from: Point;
  to: Point;
  startTriangles: ReadonlyArray<number>;
  goalTriangles: ReadonlySet<number>;
  workMeter?: RegionRoadPlannerWorkMeter;
}): Array<number> => {
  const count = options.mesh.triangles.length;
  const best = new Array<number>(count).fill(Number.POSITIVE_INFINITY);
  const trace = new Array<string>(count).fill("");
  const previous = new Array<number>(count).fill(-1);
  const settled = new Array<boolean>(count).fill(false);
  const entryPoint = new Array<Point | undefined>(count).fill(undefined);
  const queue: Array<number> = [];
  for (const index of options.startTriangles) {
    best[index] = 0;
    trace[index] = String(index).padStart(8, "0");
    entryPoint[index] = options.from;
    queue.push(index);
  }
  chargePlannerWork(options.workMeter, count);

  for (;;) {
    let current = -1;
    chargeGeometryWork(options.workMeter, queue.length);
    for (const index of queue) {
      if (settled[index]) continue;
      if (current < 0 || best[index] < best[current] - EPSILON ||
          (Math.abs(best[index] - best[current]) <= EPSILON && trace[index] < trace[current])) {
        current = index;
      }
    }
    if (current < 0) break;
    settled[current] = true;
    if (options.goalTriangles.has(current)) {
      const chain: Array<number> = [];
      for (let cursor = current; cursor >= 0; cursor = previous[cursor]) chain.push(cursor);
      return chain.reverse();
    }
    const here = entryPoint[current] as Point;
    const currentRegion = options.mesh.triangles[current].regionId;
    const currentDepth = options.depthByRegion.get(currentRegion) as number;
    for (const step of options.mesh.neighbours[current]) {
      if (settled[step.to]) continue;
      const nextRegion = options.mesh.triangles[step.to].regionId;
      if (nextRegion !== currentRegion) {
        const nextDepth = options.depthByRegion.get(nextRegion);
        // Leaving a region is allowed only one step further from the start.
        // This is what keeps the number of regions crossed at the minimum.
        if (nextDepth !== currentDepth + 1) continue;
      }
      const middle = gateMidpoint(step.gate);
      const candidate = best[current] + distance(here, middle);
      const candidateTrace = `${trace[current]}|${String(step.to).padStart(8, "0")}`;
      if (candidate < best[step.to] - EPSILON ||
          (Math.abs(candidate - best[step.to]) <= EPSILON &&
            (trace[step.to] === "" || candidateTrace < trace[step.to]))) {
        if (!Number.isFinite(best[step.to])) queue.push(step.to);
        best[step.to] = candidate;
        trace[step.to] = candidateTrace;
        previous[step.to] = current;
        entryPoint[step.to] = middle;
      }
    }
    chargePlannerWork(options.workMeter, options.mesh.neighbours[current].length);
  }
  throw new Error("No geometrically valid minimum-region road exists");
};

/* -------------------------------------------------------------------------- */
/* Step 3 — the line, and where it changes region                              */
/* -------------------------------------------------------------------------- */

/** Where a segment of the road meets a gate, if it does. */
const segmentGateIntersection = (
  from: Point,
  to: Point,
  gate: readonly [Point, Point]
): Point | undefined => {
  const route = subtract(to, from);
  const edge = subtract(gate[1], gate[0]);
  const denominator = cross(route, edge);
  const offset = subtract(gate[0], from);
  if (Math.abs(denominator) > EPSILON) {
    const t = cross(offset, edge) / denominator;
    const u = cross(offset, route) / denominator;
    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return undefined;
    const clamped = Math.max(0, Math.min(1, t));
    return { x: from.x + route.x * clamped, y: from.y + route.y * clamped };
  }
  // The road runs along the gate. Its far end is the point at which it leaves,
  // so that is where the region changes.
  if (Math.abs(cross(route, offset)) > EPSILON) return undefined;
  return { ...to };
};

/**
 * Turn the pulled-straight line and its chain of triangles into the stored
 * result: a list of points, and for each region the stretch of that list that
 * lies inside it.
 *
 * The line is only bent where the corridor forces it, so the point at which it
 * leaves one region for the next is usually in the middle of a straight run and
 * is not yet a point of the line. Those points are inserted here, because a
 * stored road has to say exactly where each paid stretch begins and ends.
 */
const describePassages = (
  path: ReadonlyArray<Point>,
  mesh: CorridorMesh,
  corridor: ReadonlyArray<number>,
  regions: ReadonlyArray<CanonicalRegion>,
  excluded: ReadonlySet<string>,
  workMeter?: RegionRoadPlannerWorkMeter
): RegionRoadCandidate => {
  const borders: Array<{ regionId: string; gate: [Point, Point] }> = [];
  for (let index = 1; index < corridor.length; index += 1) {
    const previousRegion = mesh.triangles[corridor[index - 1]].regionId;
    const region = mesh.triangles[corridor[index]].regionId;
    if (region === previousRegion) continue;
    chargeGeometryWork(workMeter, mesh.neighbours[corridor[index - 1]].length);
    const step = mesh.neighbours[corridor[index - 1]].find((entry) => entry.to === corridor[index]);
    if (!step) throw new Error("Road corridor contains a step between triangles that do not meet");
    borders.push({ regionId: region, gate: step.gate });
  }

  const points: Array<Point> = [{ ...path[0] }];
  const boundaryIndices: Array<number> = [];
  let borderCursor = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = points[points.length - 1];
    const to = path[index];
    chargeGeometryWork(workMeter, borders.length - borderCursor);
    while (borderCursor < borders.length) {
      const meeting = segmentGateIntersection(from, to, borders[borderCursor].gate);
      if (!meeting) break;
      if (!pointNearlyEquals(meeting, points[points.length - 1])) points.push(meeting);
      boundaryIndices.push(points.length - 1);
      borderCursor += 1;
    }
    if (!pointNearlyEquals(to, points[points.length - 1])) points.push({ ...to });
  }
  // A border met exactly at the last point of the line, or one the line only
  // touches, still ends its region there.
  while (borderCursor < borders.length) {
    boundaryIndices.push(points.length - 1);
    borderCursor += 1;
  }

  const ownerOf = (point: Point): string | undefined => {
    for (const region of regions) {
      // Membership is real algorithmic work, not merely the size of its final
      // answer. Charge before each scan so a caller's budget can stop a large
      // map while the work is happening instead of after it has completed.
      chargePlannerWork(
        workMeter,
        region.polygon.length + (region.holes ?? []).reduce((sum, hole) => sum + hole.length, 0)
      );
      if (pointInOrOnRegion(point, region)) return region.id;
    }
    return undefined;
  };
  const segmentOwners = points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const owner = ownerOf(interpolate(from, to, 0.5));
    if (!owner || excluded.has(owner)) {
      throw new Error("A payable road segment has no non-excluded owning region");
    }
    return owner;
  });
  const regionSequence: Array<string> = [];
  const passages: Array<RegionRoadPassage> = [];
  for (let index = 0; index < segmentOwners.length; index += 1) {
    const owner = segmentOwners[index];
    const current = passages.at(-1);
    if (current?.regionId === owner) {
      current.toPointIndex = index + 1;
      continue;
    }
    regionSequence.push(owner);
    passages.push({ regionId: owner, fromPointIndex: index, toPointIndex: index + 1 });
  }
  return { points, regionSequence, passages };
};

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Plan the road between two points.
 *
 * The result is a single road, not a set of equally good ones: version 3 has
 * nothing left to decide by chance, so there is no candidate for a caller to
 * pick from and no random stream to consult.
 */
export const planMinimumRegionRoad = (options: {
  model: GameManifestTransportNetworkModel;
  from: Point;
  to: Point;
  excludedRegionIds?: ReadonlyArray<string>;
  workMeter?: RegionRoadPlannerWorkMeter;
}): { compiled: CompiledRegionRoadPlanning; road: RegionRoadCandidate } => {
  const from = finitePoint(options.from, "Road origin");
  const to = finitePoint(options.to, "Road destination");
  if (pointNearlyEquals(from, to)) throw new Error("Road endpoints must have different positions");
  const compiled = compileRegionRoadPlanning(options.model, options.workMeter);
  const excluded = new Set(options.excludedRegionIds ?? []);
  for (const regionId of excluded) {
    if (typeof regionId !== "string" || !compiled.regionsById.has(regionId)) {
      throw new Error(`Excluded road-planning region "${String(regionId)}" is not declared`);
    }
  }

  const corridor = findMinimumCorridor({ compiled, from, to, excluded, workMeter: options.workMeter });
  const mesh = buildCorridorMesh(
    compiled.mesh,
    [...corridor.depthByRegion.keys()].sort(codepointCompare),
    options.workMeter
  );

  chargePlannerWork(
    options.workMeter,
    corridor.startRegions.length + corridor.endRegions.size + mesh.triangles.length
  );
  const startTriangles = corridor.startRegions
    .filter((regionId) => corridor.depthByRegion.get(regionId) === 1)
    .flatMap((regionId) => mesh.trianglesByRegion.get(regionId) ?? [])
    .filter((index) => triangleContains(mesh.triangles[index], from))
    .sort((left, right) => left - right);
  const goalTriangles = new Set(
    [...corridor.endRegions]
      .filter((regionId) => corridor.depthByRegion.get(regionId) === corridor.regionCount)
      .flatMap((regionId) => mesh.trianglesByRegion.get(regionId) ?? [])
      .filter((index) => triangleContains(mesh.triangles[index], to))
  );
  if (startTriangles.length === 0 || goalTriangles.size === 0) {
    throw new Error("Road endpoints do not fall inside the walkable surface of their regions");
  }

  const triangleChain = findTriangleCorridor({
    mesh,
    depthByRegion: corridor.depthByRegion,
    from,
    to,
    startTriangles,
    goalTriangles,
    workMeter: options.workMeter
  });

  const gates: Array<{ a: Point; b: Point }> = [];
  for (let index = 1; index < triangleChain.length; index += 1) {
    chargeGeometryWork(options.workMeter, mesh.neighbours[triangleChain[index - 1]].length);
    const step = mesh.neighbours[triangleChain[index - 1]].find((entry) => entry.to === triangleChain[index]);
    if (!step) throw new Error("Road corridor contains a step between triangles that do not meet");
    gates.push({ a: step.gate[0], b: step.gate[1] });
  }
  const line = funnelPath(from, to, orientGates(from, gates));
  const road = describePassages(
    line,
    mesh,
    triangleChain,
    compiled.regions,
    excluded,
    options.workMeter
  );
  chargePlannerWork(options.workMeter, road.points.length + road.regionSequence.length);
  return { compiled, road };
};

/** Exported for tests and tools that need the derived graph without a route. */
export { canonicalizeRoadPlanningRegions, computeRegionRoadPlanningHash, deriveRegionCrossings };
export type { CanonicalRegion, RegionCrossing };

/** Kept only so a test can start from a clean cache. */
export const resetCompiledRoadPlanningCache = (): void => {
  compiledByHash.clear();
};

/** Unused by the planner; retained so a caller can key an audit trail. */
export const regionRoadPlanningPointKey = pointKey;
