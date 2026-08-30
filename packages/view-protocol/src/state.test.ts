/**
 * RFC 7396 and RFC 6902 examples for the state-patch utilities.
 *
 * These tests live with the protocol rather than in a delivery channel: the
 * editor is the direct consumer and protocol behaviour must remain stable even
 * when no player-web test happens to exercise a particular patch operation.
 */
import { describe, expect, it } from "vitest";

import { applyJsonMergePatch, applyJsonPatch, type JsonValue } from "./state.ts";

describe("applyJsonMergePatch (RFC 7396)", () => {
  it("merges objects recursively, removes null members, and replaces arrays", () => {
    const target: JsonValue = {
      title: "before",
      settings: { enabled: true, stale: "remove me" },
      items: ["old"]
    };

    expect(
      applyJsonMergePatch(target, {
        title: "after",
        settings: { stale: null, retries: 2 },
        items: ["replacement"]
      })
    ).toEqual({
      title: "after",
      settings: { enabled: true, retries: 2 },
      items: ["replacement"]
    });
    expect(target).toEqual({
      title: "before",
      settings: { enabled: true, stale: "remove me" },
      items: ["old"]
    });
  });

  it("treats an object patch against a non-object target as an empty object", () => {
    expect(applyJsonMergePatch("previous", { retained: true })).toEqual({ retained: true });
    expect(applyJsonMergePatch({ retained: true }, null)).toBeNull();
  });
});

describe("applyJsonPatch (RFC 6902)", () => {
  it("applies add, remove, replace, move, copy, and test operations", () => {
    const target: JsonValue = {
      list: ["first", "third"],
      source: { label: "copied" },
      obsolete: true
    };

    expect(
      applyJsonPatch(target, [
        { op: "add", path: "/list/1", value: "second" },
        { op: "remove", path: "/obsolete" },
        { op: "replace", path: "/source/label", value: "replaced" },
        { op: "copy", from: "/source", path: "/copied" },
        { op: "move", from: "/list/0", path: "/list/2" },
        { op: "test", path: "/copied/label", value: "replaced" }
      ])
    ).toEqual({
      list: ["second", "third", "first"],
      source: { label: "replaced" },
      copied: { label: "replaced" }
    });
    expect(target).toEqual({
      list: ["first", "third"],
      source: { label: "copied" },
      obsolete: true
    });
  });

  it("supports an append token and rejects invalid array boundaries and tokens", () => {
    expect(applyJsonPatch(["first"], [{ op: "add", path: "/-", value: "last" }])).toEqual([
      "first",
      "last"
    ]);
    expect(applyJsonPatch(["first"], [{ op: "add", path: "/1", value: "last" }])).toEqual([
      "first",
      "last"
    ]);

    expect(() => applyJsonPatch(["first"], [{ op: "add", path: "/2", value: "past end" }])).toThrow(
      /index is invalid/u
    );
    expect(() => applyJsonPatch(["first"], [{ op: "replace", path: "/1", value: "past end" }])).toThrow(
      /out of bounds/u
    );
    expect(() => applyJsonPatch(["first"], [{ op: "remove", path: "/01" }])).toThrow(/out of bounds/u);
    expect(() => applyJsonPatch(["first"], [{ op: "test", path: "/", value: "first" }])).toThrow(
      /out of bounds/u
    );
  });

  it("can invert a middle-array insertion by removing the inserted index", () => {
    const before: JsonValue = ["first", "third"];
    const afterInsert = applyJsonPatch(before, [{ op: "add", path: "/1", value: "second" }]);

    expect(afterInsert).toEqual(["first", "second", "third"]);
    expect(applyJsonPatch(afterInsert, [{ op: "remove", path: "/1" }])).toEqual(before);
  });

  it("fails a test operation without applying later changes", () => {
    expect(() =>
      applyJsonPatch({ value: "current" }, [
        { op: "test", path: "/value", value: "stale" },
        { op: "replace", path: "/value", value: "new" }
      ])
    ).toThrow(/test failed/u);
  });
});
