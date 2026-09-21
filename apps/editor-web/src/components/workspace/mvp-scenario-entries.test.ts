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
        const selected = entries.find(entry => entry.source.pointer === `/root/content/data/${collection}/${id}`);
        expect(selected?.selector, `${collection}/${id} scene`).toBeDefined();
        expect(selected?.selector?.stepIndex, `${collection}/${id} timeline`).toEqual(expect.any(Number));
      }
    }
    expect(entries.length).toBeGreaterThanOrEqual(112);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(entries.length);
  });

  it("follows declared action references for flow steps and refuses ambiguous card ownership", () => {
    const json = { _definitions: { "game.Window": { _extends: "game.Content", screenId: "detail" } }, root: { logic: { flows: [{ steps: [{ id: "stage", screenId: "fallback", actionIds: ["continue"] }] }] }, content: { data: {
      windows: [{ _type: "game.Window", _label: "Window", id: "w", stepIndex: 3, advanceActionId: "continue" }],
      boards: [{ _type: "game.Board", _label: "One", screenId: "board", stepIndex: 4, cardIds: ["c"] }, { _type: "game.Board", _label: "Two", screenId: "board", stepIndex: 5, cardIds: ["c"] }],
      cards: [{ _type: "game.Card", _label: "Card", cardId: "c" }]
    } } } };
    const document = { filePath: "game.json", documentKind: "game", json } as EditorEntityProjectionDocument;
    const step = { entityId: "step", kind: "game-step", label: "Stage", primarySource: { filePath: "game.json", pointer: "/root/logic/flows/0/steps/0" } } as Parameters<typeof buildMvpScenarioEntries>[0][number];
    const entries = buildMvpScenarioEntries([step], [document]);
    expect(entries.find(entry => entry.id === "step")?.selector).toEqual({ screenId: "detail", stepIndex: 3, activeInfoId: "w" });
    expect(entries.find(entry => entry.source.pointer.endsWith("/cards/0"))?.selector).toBeUndefined();
  });

  it("uses source pointers for neutral authored content without treating nested style objects as windows", () => {
    const document = { filePath: "neutral.json", documentKind: "game", json: { root: { content: { deck: [{ _type: "game.Card", _label: "A", style: { color: "red" } }, { _type: "game.Card", _label: "B" }] } } } } as EditorEntityProjectionDocument;
    expect(buildMvpScenarioEntries([], [document]).map(entry => entry.source.pointer)).toEqual(["/root/content/deck/0", "/root/content/deck/1"]);
  });
});
