import { describe, expect, it } from "vitest";

import { planAiChangeSet } from "./ai-change-planner";

describe("AI ChangeSet planner baseline", () => {
  it("creates bounded JSON Patch operations for object text edits", () => {
    const result = planAiChangeSet({
      intent: {
        id: "intent-1",
        kind: "preview-prompt",
        prompt: "Поменяй текст на \"Продолжить\"",
        activeFilePath: "ui/web.authoring.json",
        targetPointers: ["/root/screens/0/root"],
        createdAt: "2026-05-28T00:00:00.000Z"
      },
      targets: [
        {
          filePath: "ui/web.authoring.json",
          pointer: "/root/screens/0/root",
          label: "Кнопка далее",
          value: {
            _type: "ui.Button",
            _label: "Кнопка далее",
            props: {
              text: "Далее"
            }
          }
        }
      ],
      now: "2026-05-28T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.changeSet.jsonPatches : []).toEqual([
      {
        filePath: "ui/web.authoring.json",
        operations: [
          { op: "test", path: "/root/screens/0/root/props/text", value: "Далее" },
          { op: "replace", path: "/root/screens/0/root/props/text", value: "Продолжить" }
        ]
      }
    ]);
  });

  it("rejects prompts that do not contain an extractable requested value", () => {
    const result = planAiChangeSet({
      intent: {
        id: "intent-1",
        kind: "preview-prompt",
        prompt: "Сделай лучше",
        activeFilePath: "game.authoring.json",
        targetPointers: ["/root"],
        createdAt: "2026-05-28T00:00:00.000Z"
      },
      targets: [
        {
          filePath: "game.authoring.json",
          pointer: "/root",
          value: { _type: "game.Game", _label: "Игра" }
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ source: "ai-planner", severity: "error" });
  });
});
