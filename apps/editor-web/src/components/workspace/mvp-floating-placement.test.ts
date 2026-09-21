import { describe, expect, it } from "vitest";
import { placeLayerList, type FloatingRect, type LayerListPlacement } from "./mvp-floating-placement";

const bounds = { left: 0, top: 0, right: 800, bottom: 500 };
const size = { width: 172, height: 100 };

function overlaps(a: LayerListPlacement, b: FloatingRect): boolean {
  return a.x < b.x + b.width && a.x + a.maxWidth > b.x && a.y < b.y + b.height && a.y + a.maxHeight > b.y;
}

describe("placeLayerList", () => {
  it("places the list opposite the actual prompt side of the cursor", () => {
    const point = { x: 400, y: 220 };
    const rightPrompt = { x: 420, y: 210, width: 260, height: 180 };
    const leftPrompt = { x: 100, y: 210, width: 260, height: 180 };
    const leftList = placeLayerList(point, size, bounds, rightPrompt);
    const rightList = placeLayerList(point, size, bounds, leftPrompt);
    expect(leftList.x + leftList.maxWidth).toBeLessThan(point.x);
    expect(rightList.x).toBeGreaterThan(point.x);
    expect(overlaps(leftList, rightPrompt)).toBe(false);
    expect(overlaps(rightList, leftPrompt)).toBe(false);
  });

  it("moves vertically when clamping makes both horizontal sides overlap", () => {
    const narrowBounds = { left: 0, top: 0, right: 310, bottom: 500 };
    const point = { x: 154, y: 240 };
    const prompt = { x: 8, y: 245, width: 294, height: 130 };
    const list = placeLayerList(point, size, narrowBounds, prompt);
    expect(list.y + list.maxHeight).toBeLessThanOrEqual(point.y);
    expect(overlaps(list, prompt)).toBe(false);
    expect(list.x).toBeGreaterThanOrEqual(8);
    expect(list.x + list.maxWidth).toBeLessThanOrEqual(302);
  });

  it("responds to moved or resized prompt geometry while remaining within the preview", () => {
    const point = { x: 420, y: 220 };
    const first = placeLayerList(point, size, bounds, { x: 430, y: 180, width: 180, height: 150 });
    const moved = { x: 180, y: 180, width: 230, height: 150 };
    const second = placeLayerList(point, size, bounds, moved);
    expect(first.x + first.maxWidth).toBeLessThan(point.x);
    expect(second.x).toBeGreaterThan(point.x);
    expect(overlaps(second, moved)).toBe(false);
  });

  it("uses a deterministic fully visible least-overlap fallback when the prompt fills the corner", () => {
    const smallBounds = { left: 0, top: 0, right: 220, bottom: 140 };
    const prompt = { x: 0, y: 0, width: 220, height: 140 };
    const point = { x: 4, y: 4 };
    const first = placeLayerList(point, { width: 172, height: 100 }, smallBounds, prompt);
    expect(placeLayerList(point, { width: 172, height: 100 }, smallBounds, prompt)).toEqual(first);
    expect(first.x).toBeGreaterThanOrEqual(8);
    expect(first.y).toBeGreaterThanOrEqual(8);
    expect(first.x + first.maxWidth).toBeLessThanOrEqual(212);
    expect(first.y + first.maxHeight).toBeLessThanOrEqual(132);
  });

  it("shortens a scrollable list above a tall full-width prompt on a phone viewport", () => {
    const phone = { left: 0, top: 0, right: 390, bottom: 844 };
    const prompt = { x: 8, y: 120, width: 374, height: 620 };
    const point = { x: 194, y: 420 };
    const list = placeLayerList(point, { width: 172, height: 180 }, phone, prompt);
    expect(overlaps(list, prompt)).toBe(false);
    expect(list.y + list.maxHeight).toBeLessThanOrEqual(prompt.y - 8);
    expect(list.maxHeight).toBeGreaterThanOrEqual(36);
    expect(list.maxHeight).toBeLessThan(180);
    expect(list.maxWidth).toBe(172);
  });
});
