/** Focused tests for normalized selection along a saved board polyline. */

import { describe, expect, it } from "vitest";

import { closestPositionTOnPolyline } from "./polyline-selection";

describe("closestPositionTOnPolyline", () => {
  it("uses cumulative route length across a bent polyline", () => {
    const positionT = closestPositionTOnPolyline(
      { x: 10, y: 5 },
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    );

    expect(positionT).toBeCloseTo(0.75, 8);
  });

  it("clamps to endpoints and ignores repeated points", () => {
    expect(closestPositionTOnPolyline(
      { x: -20, y: 0 },
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }]
    )).toBe(0);
    expect(closestPositionTOnPolyline(
      { x: 40, y: 0 },
      [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    )).toBe(1);
  });

  it("rejects a route without measurable safe geometry", () => {
    expect(closestPositionTOnPolyline({ x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBeNull();
    expect(closestPositionTOnPolyline(
      { x: 0, y: 0 },
      [{ x: 1, y: 1 }, { x: Number.NaN, y: 2 }]
    )).toBeNull();
  });
});
