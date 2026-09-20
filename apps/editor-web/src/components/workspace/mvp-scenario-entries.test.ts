import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EditorEntityProjectionDocument } from "@cubica/editor-engine";
import { buildMvpScenarioEntries } from "./mvp-scenario-entries";

describe("MVP scenario contents", () => {
  it("includes every Antarctica info, board and card beyond its flow steps", () => {
    const json = JSON.parse(readFileSync(path.resolve(process.cwd(), "../../games/antarctica/authoring/game.authoring.json"), "utf8"));
    const document = { filePath: "game.authoring.json", documentKind: "game", json } as EditorEntityProjectionDocument;
    const entries = buildMvpScenarioEntries([], [document]);
    for (const collection of ["infos", "boards", "cards"]) {
      const expected = Object.keys(json.root.content.data[collection]);
      for (const id of expected) {
        expect(entries.some(entry => entry.source.pointer === `/root/content/data/${collection}/${id}`), `${collection}/${id}`).toBe(true);
      }
    }
    expect(entries.length).toBeGreaterThanOrEqual(112);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
  });

  it("uses source pointers for neutral authored content without treating nested style objects as windows", () => {
    const document = { filePath: "neutral.json", documentKind: "game", json: { root: { content: { deck: [{ _type: "game.Card", _label: "A", style: { color: "red" } }, { _type: "game.Card", _label: "B" }] } } } } as EditorEntityProjectionDocument;
    expect(buildMvpScenarioEntries([], [document]).map(entry => entry.source.pointer)).toEqual(["/root/content/deck/0", "/root/content/deck/1"]);
  });
});
