/**
 * Framework-independent geometry used by interactive board plugins.
 *
 * The helper translates a pointer position into `positionT`: normalized
 * distance along a saved polyline, where 0 is its start and 1 is its end. It
 * contains no transport or game rules and does not mutate the supplied data.
 */

export interface PolylineSelectionPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Return the nearest normalized position along a valid polyline.
 *
 * `null` means that the polyline has no measurable segment or contains unsafe
 * coordinates. Degenerate repeated points are ignored when other segments are
 * available.
 */
export function closestPositionTOnPolyline(
  point: PolylineSelectionPoint,
  polyline: readonly PolylineSelectionPoint[]
): number | null {
  if (!isFinitePoint(point) || polyline.length < 2 || !polyline.every(isFinitePoint)) {
    return null;
  }

  const segments: Array<{
    readonly from: PolylineSelectionPoint;
    readonly to: PolylineSelectionPoint;
    readonly length: number;
  }> = [];
  let totalLength = 0;

  for (let index = 1; index < polyline.length; index += 1) {
    const from = polyline[index - 1];
    const to = polyline[index];
    if (!from || !to) continue;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    segments.push({ from, to, length });
    totalLength += length;
  }

  if (totalLength === 0) return null;

  let traversedLength = 0;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;
  let nearestRouteLength = 0;

  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const rawT = ((point.x - segment.from.x) * dx + (point.y - segment.from.y) * dy)
      / (segment.length * segment.length);
    const segmentT = Math.min(1, Math.max(0, rawT));
    const nearestX = segment.from.x + dx * segmentT;
    const nearestY = segment.from.y + dy * segmentT;
    const distanceSquared = (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      nearestRouteLength = traversedLength + segment.length * segmentT;
    }
    traversedLength += segment.length;
  }

  return nearestRouteLength / totalLength;
}

const isFinitePoint = (point: PolylineSelectionPoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);
