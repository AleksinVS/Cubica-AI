/**
 * Pure geometry helpers for confirmed board movement animations.
 *
 * These helpers know nothing about vehicles, legal routes or Phaser. Runtime
 * has already selected the route; the renderer only samples its public
 * polyline at a normalized visual progress.
 */

import type { CanonicalPoint } from "./board-state.ts";

const clampProgress = (value: number) =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/** Return the total Euclidean length of a public road polyline. */
export function polylineLength(points: readonly CanonicalPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/**
 * Sample a polyline by travelled distance rather than by segment number.
 *
 * Equal progress therefore means equal visual speed even when a server route
 * contains segments with very different lengths.
 */
export function pointAtPolylineProgress(
  points: readonly CanonicalPoint[],
  rawProgress: number
): CanonicalPoint | null {
  const first = points[0];
  if (!first) return null;
  const last = points.at(-1) ?? first;
  const progress = clampProgress(rawProgress);
  const total = polylineLength(points);
  if (total === 0 || progress === 0) return { ...first };
  if (progress === 1) return { ...last };

  const targetDistance = total * progress;
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength === 0) continue;
    if (travelled + segmentLength >= targetDistance) {
      const local = (targetDistance - travelled) / segmentLength;
      return {
        x: from.x + (to.x - from.x) * local,
        y: from.y + (to.y - from.y) * local
      };
    }
    travelled += segmentLength;
  }
  return { ...last };
}

/**
 * Return the visible prefix of a polyline at normalized travelled distance.
 *
 * Construction uses this for an explanatory route trace. The final road is
 * already present in the confirmed semantic layer; this helper only controls
 * how much of the temporary highlight is visible on the current frame.
 */
export function polylinePrefixAtProgress(
  points: readonly CanonicalPoint[],
  rawProgress: number
): readonly CanonicalPoint[] {
  const first = points[0];
  if (!first) return [];
  const progress = clampProgress(rawProgress);
  if (progress === 0) return [{ ...first }];
  if (progress === 1) return points.map((point) => ({ ...point }));

  const total = polylineLength(points);
  if (total === 0) return [{ ...first }];
  const targetDistance = total * progress;
  const prefix: CanonicalPoint[] = [{ ...first }];
  let travelled = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    if (!from || !to) continue;
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength === 0) continue;
    if (travelled + segmentLength >= targetDistance) {
      const local = (targetDistance - travelled) / segmentLength;
      prefix.push({
        x: from.x + (to.x - from.x) * local,
        y: from.y + (to.y - from.y) * local
      });
      return prefix;
    }
    prefix.push({ ...to });
    travelled += segmentLength;
  }
  return prefix;
}

/** Keep movement readable without making a long route block the facilitator. */
export function movementDurationMs(points: readonly CanonicalPoint[]): number {
  return Math.round(Math.min(900, Math.max(300, polylineLength(points) * 0.45)));
}
