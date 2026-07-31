/**
 * The walkable surface of a road-planning map, expressed as triangles.
 *
 * A region is an arbitrary bent shape, so a straight line between two points of
 * it can leave it. Triangles do not have that problem: a straight line between
 * any two points of a triangle stays inside. Splitting every region into
 * triangles therefore turns "find the shortest line inside these shapes" into
 * "find a chain of triangles, then pull the line straight through it", which is
 * how movement over terrain is done in games generally. See ADR-100.
 *
 * Two decisions shape this module.
 *
 * **The triangles are not stored anywhere.** They are derived from the region
 * polygons whenever they are needed. Storing them would make every improvement
 * to the splitting rule a change of published data instead of a change of code.
 *
 * **They are derived one region at a time, on demand.** A single road crosses a
 * handful of regions out of the nine hundred on a real map, so splitting the
 * whole map to plan one road would be almost entirely wasted work. Regions are
 * split when a road first reaches them and the result is kept for later roads.
 *
 * Terms used here:
 *
 * - **conforming** — making the two sides of a shared border agree vertex for
 *   vertex. Two neighbouring regions may describe the same border with a
 *   different number of corners; unless the finer set of corners is copied into
 *   both, their triangles meet only partly and a road cannot be handed from one
 *   region to the next.
 * - **gate** — the edge two neighbouring triangles share. A road passes from one
 *   triangle to the next through a gate.
 */
import type { GameManifestCanonicalPoint } from "@cubica/contracts-manifest";

import {
  type CanonicalRegion,
  type RegionCrossing,
  distance,
  pointCompare,
  pointKey,
  pointOnSegment,
  regionRings
} from "./regionRoadGeometry.ts";
import { triangulatePolygon } from "./polygonTriangulation.ts";

type Point = GameManifestCanonicalPoint;

/**
 * Bounds on the work one road may cause. As elsewhere in this planner the
 * values are measured rather than guessed: the first real author map splits
 * into about 170 000 triangles in total, while a single road crosses at most
 * thirteen regions, so a corridor of a few thousand triangles is already far
 * above anything a real road needs.
 */
export const MAX_CORRIDOR_REGIONS = 512;
const MAX_CORRIDOR_TRIANGLES = 200_000;

/** One triangle of the walkable surface, together with the region that owns it. */
export interface MeshTriangle {
  regionId: string;
  points: [Point, Point, Point];
}

/**
 * The triangles of a set of regions, with the information about which triangles
 * are reachable from which, and through which gate.
 */
export interface CorridorMesh {
  triangles: Array<MeshTriangle>;
  /** For each triangle, its neighbours and the gate leading to each. */
  neighbours: Array<Array<{ to: number; gate: [Point, Point] }>>;
  /** Index of the triangles of each region inside `triangles`. */
  trianglesByRegion: Map<string, Array<number>>;
}

const undirectedEdgeKey = (first: Point, second: Point): string =>
  pointCompare(first, second) <= 0
    ? `${pointKey(first)}|${pointKey(second)}`
    : `${pointKey(second)}|${pointKey(first)}`;

/**
 * Copy a neighbour's extra border corners into this ring.
 *
 * Only corners that already exist in the neighbour are inserted — no new
 * coordinate is ever invented — so the two sides of every shared border end up
 * described by exactly the same points and their triangles meet exactly.
 */
const conformRing = (
  ring: ReadonlyArray<Point>,
  borderPoints: ReadonlyArray<Point>
): Array<Point> => {
  if (borderPoints.length === 0) return [...ring];
  const result: Array<Point> = [];
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index];
    const to = ring[(index + 1) % ring.length];
    result.push(from);
    const inserted = borderPoints
      .filter((point) =>
        pointKey(point) !== pointKey(from) &&
        pointKey(point) !== pointKey(to) &&
        pointOnSegment(point, from, to))
      .map((point) => ({ point, along: distance(from, point) }))
      .sort((left, right) => left.along - right.along || pointCompare(left.point, right.point));
    let previousKey = pointKey(from);
    for (const entry of inserted) {
      const key = pointKey(entry.point);
      if (key === previousKey) continue;
      result.push(entry.point);
      previousKey = key;
    }
  }
  return result;
};

/**
 * A map that can hand out the triangles of any of its regions, splitting each
 * region the first time it is asked for and remembering the result.
 */
export class RegionMeshCache {
  private readonly regionsById: Map<string, CanonicalRegion>;
  /** Every border corner that touches a region, from all of its crossings. */
  private readonly borderPointsByRegion: Map<string, Array<Point>>;
  private readonly triangulated = new Map<string, Array<[Point, Point, Point]>>();

  constructor(regions: ReadonlyArray<CanonicalRegion>, crossings: ReadonlyArray<RegionCrossing>) {
    this.regionsById = new Map(regions.map((region) => [region.id, region]));
    this.borderPointsByRegion = new Map(regions.map((region) => [region.id, []]));
    for (const crossing of crossings) {
      for (const regionId of crossing.regionIds) {
        const collected = this.borderPointsByRegion.get(regionId);
        if (!collected) {
          throw new Error(`Crossing "${crossing.id}" names region "${regionId}", which is not declared`);
        }
        collected.push(...crossing.chain);
      }
    }
  }

  /** The triangles of one region, split on first use. */
  trianglesOf(regionId: string): Array<[Point, Point, Point]> {
    const known = this.triangulated.get(regionId);
    if (known) return known;
    const region = this.regionsById.get(regionId);
    if (!region) throw new Error(`Road-planning region "${regionId}" is not declared`);
    const borderPoints = this.borderPointsByRegion.get(regionId) ?? [];
    const rings = regionRings(region).map((ring) => conformRing(ring, borderPoints));
    const [outer, ...holes] = rings;
    let split;
    try {
      split = triangulatePolygon(outer, holes);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Road-planning region "${regionId}" cannot be split into triangles: ${reason}`);
    }
    const triangles = split.triangles.map((triangle): [Point, Point, Point] => [
      split.vertices[triangle.a],
      split.vertices[triangle.b],
      split.vertices[triangle.c]
    ]);
    // A triangle of zero area is three points on one line. It is not a piece of
    // surface, it is a crack: the road can be handed through it but has no room
    // inside it, and the shortest-path search then produces a line that visibly
    // detours to one of its far ends. Conforming makes points on one line
    // common — they are exactly what a neighbour's extra corners are — so this
    // has to be caught here rather than hoped against.
    for (const [a, b, c] of triangles) {
      const doubleArea = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const scale = Math.max(1, distance(a, b), distance(b, c), distance(c, a));
      if (Math.abs(doubleArea) <= 1e-9 * scale * scale) {
        throw new Error(
          `Road-planning region "${regionId}" split into a triangle of zero area at `
          + `(${a.x},${a.y}) (${b.x},${b.y}) (${c.x},${c.y})`
        );
      }
    }
    this.triangulated.set(regionId, triangles);
    return triangles;
  }
}

/**
 * Assemble the triangles of the named regions into one connected surface.
 *
 * Neighbouring triangles are found by looking for a shared edge, and the same
 * rule serves both cases: two triangles of one region meet along an edge they
 * both contain, and two triangles of different regions meet along a piece of
 * their shared border, which conforming has made identical on both sides. An
 * edge belonging to three triangles would mean the map is not a flat
 * subdivision after all, and is refused rather than silently halved.
 */
export const buildCorridorMesh = (
  cache: RegionMeshCache,
  regionIds: ReadonlyArray<string>
): CorridorMesh => {
  if (regionIds.length > MAX_CORRIDOR_REGIONS) {
    throw new Error(`Road planning supports corridors of at most ${MAX_CORRIDOR_REGIONS} regions`);
  }
  const triangles: Array<MeshTriangle> = [];
  const trianglesByRegion = new Map<string, Array<number>>();
  for (const regionId of regionIds) {
    const indices: Array<number> = [];
    for (const points of cache.trianglesOf(regionId)) {
      indices.push(triangles.length);
      triangles.push({ regionId, points });
      if (triangles.length > MAX_CORRIDOR_TRIANGLES) {
        throw new Error(`Road planning supports corridors of at most ${MAX_CORRIDOR_TRIANGLES} triangles`);
      }
    }
    trianglesByRegion.set(regionId, indices);
  }

  const byEdge = new Map<string, Array<{ triangle: number; gate: [Point, Point] }>>();
  triangles.forEach((triangle, index) => {
    for (let corner = 0; corner < 3; corner += 1) {
      const from = triangle.points[corner];
      const to = triangle.points[(corner + 1) % 3];
      const key = undirectedEdgeKey(from, to);
      byEdge.set(key, [...(byEdge.get(key) ?? []), { triangle: index, gate: [from, to] }]);
    }
  });

  const neighbours: Array<Array<{ to: number; gate: [Point, Point] }>> = triangles.map(() => []);
  for (const [key, incident] of byEdge) {
    if (incident.length === 1) continue;
    if (incident.length > 2) {
      throw new Error(`Road-planning surface has ${incident.length} triangles on edge ${key}`);
    }
    const [first, second] = incident;
    neighbours[first.triangle].push({ to: second.triangle, gate: first.gate });
    neighbours[second.triangle].push({ to: first.triangle, gate: second.gate });
  }
  // A fixed neighbour order keeps the later search reproducible without
  // depending on the order in which edges happened to be met.
  for (const list of neighbours) {
    list.sort((left, right) => left.to - right.to);
  }
  return { triangles, neighbours, trianglesByRegion };
};

/** Does this triangle contain the point, border included? */
export const triangleContains = (triangle: MeshTriangle, point: Point): boolean => {
  const [a, b, c] = triangle.points;
  const side = (from: Point, to: Point): number =>
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  const first = side(a, b);
  const second = side(b, c);
  const third = side(c, a);
  const tolerance = 1e-9 * Math.max(1, Math.abs(first), Math.abs(second), Math.abs(third));
  const negative = first < -tolerance || second < -tolerance || third < -tolerance;
  const positive = first > tolerance || second > tolerance || third > tolerance;
  return !(negative && positive);
};
