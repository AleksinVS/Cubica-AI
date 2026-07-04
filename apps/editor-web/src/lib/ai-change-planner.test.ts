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

  // Regression coverage for Finding 7b (add without test-guard).
  it("guards an add with a preceding test when the target field exists with a non-string value", () => {
    const result = planAiChangeSet({
      intent: {
        id: "intent-2",
        kind: "preview-prompt",
        prompt: "Поменяй текст на \"Далее\"",
        activeFilePath: "ui/web.authoring.json",
        targetPointers: ["/root/screens/0/root"],
        createdAt: "2026-05-28T00:00:00.000Z"
      },
      targets: [
        {
          filePath: "ui/web.authoring.json",
          pointer: "/root/screens/0/root",
          label: "Метка",
          // `text` already exists here, but as a NUMBER, not a string. None of the
          // preferred string-typed candidates (props/text, text, title, body, _label, name)
          // match, so the planner falls back to the `text` field. It must still detect that
          // this field is occupied and guard the write instead of silently overwriting it.
          value: {
            _type: "ui.Label",
            text: 42
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
          { op: "test", path: "/root/screens/0/root/text", value: 42 },
          { op: "replace", path: "/root/screens/0/root/text", value: "Далее" }
        ]
      }
    ]);
  });

  it("still emits a plain add with no test guard when the target field is genuinely absent", () => {
    const result = planAiChangeSet({
      intent: {
        id: "intent-3",
        kind: "preview-prompt",
        prompt: "Поменяй текст на \"Далее\"",
        activeFilePath: "ui/web.authoring.json",
        targetPointers: ["/root/screens/0/root"],
        createdAt: "2026-05-28T00:00:00.000Z"
      },
      targets: [
        {
          filePath: "ui/web.authoring.json",
          pointer: "/root/screens/0/root",
          label: "Пустой блок",
          // No candidate field exists at all here (not even as a non-string value), so the
          // previously-working "genuinely absent" path must keep emitting a bare `add` with
          // no test guard -- this proves the Finding 7b fix did not regress the happy path.
          value: {
            _type: "ui.Label"
          }
        }
      ],
      now: "2026-05-28T00:00:00.000Z"
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.changeSet.jsonPatches : []).toEqual([
      {
        filePath: "ui/web.authoring.json",
        operations: [{ op: "add", path: "/root/screens/0/root/text", value: "Далее" }]
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
