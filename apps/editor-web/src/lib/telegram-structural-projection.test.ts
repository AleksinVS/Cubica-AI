/** Neutral contract tests for the Telegram structural projection. */
import { describe, expect, it } from "vitest";

import { projectTelegramAuthoringManifest } from "./telegram-structural-projection.ts";

const fixture = {
  _channel: "telegram",
  root: {
    entry_point: "main",
    screens: [{
      id: "main",
      title: "Нейтральный сценарий",
      root: {
        type: "screenComponent",
        children: [
          { id: "hint", type: "helperComponent", props: { text: "Выберите действие" } },
          { id: "continue", type: "buttonComponent", props: { caption: "Продолжить" }, actions: { onClick: { command: "advance" } } },
          { id: "future", type: "futureComponent", _label: "Будущий компонент" }
        ]
      }
    }]
  }
} as const;

describe("projectTelegramAuthoringManifest", () => {
  it("projects messages and inline actions with authoring source pointers", () => {
    const result = projectTelegramAuthoringManifest(fixture);

    expect(result.title).toBe("Нейтральный сценарий");
    expect(result.messages[0]).toMatchObject({
      id: "hint",
      kind: "helper",
      text: "Выберите действие",
      sourcePointer: "/root/screens/0/root/children/0"
    });
    expect(result.messages[0]?.actions[0]).toMatchObject({
      id: "continue",
      label: "Продолжить",
      command: "advance",
      sourcePointer: "/root/screens/0/root/children/1"
    });
  });

  it("keeps unknown components visible with their source pointer", () => {
    expect(projectTelegramAuthoringManifest(fixture).messages[1]).toMatchObject({
      id: "future",
      kind: "unknown",
      label: "Будущий компонент",
      sourcePointer: "/root/screens/0/root/children/2",
      componentType: "futureComponent"
    });
  });
});
