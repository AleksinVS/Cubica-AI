import { describe, expect, it } from "vitest";

import { projectUiComponentGeometryStyle } from "./ui-component-style";

describe("projectUiComponentGeometryStyle", () => {
  it("projects bounded dimensions and the canonical editor transform", () => {
    expect(projectUiComponentGeometryStyle({
      width: 320,
      height: "50%",
      transform: "translate(-12.5px, 24px) rotate(7.25deg)"
    })).toEqual({
      width: "320px",
      height: "50%",
      transform: "translate(-12.5px, 24px) rotate(7.25deg)"
    });
  });

  it("preserves supported authored units and drops unsafe or unreasonable values", () => {
    expect(projectUiComponentGeometryStyle({
      width: "12rem",
      height: "auto",
      transform: "url(https://example.test)"
    })).toEqual({ width: "12rem", height: "auto" });
    expect(projectUiComponentGeometryStyle({
      width: 0,
      height: "20000px",
      transform: "translate(100001px, 0px) rotate(0deg)"
    })).toBeUndefined();
  });

  it("rejects arbitrary CSS transform functions and unknown style keys", () => {
    expect(projectUiComponentGeometryStyle({
      transform: "translateX(10px) scale(2)",
      backgroundImage: "url(https://example.test/image.png)"
    })).toBeUndefined();
  });
});
