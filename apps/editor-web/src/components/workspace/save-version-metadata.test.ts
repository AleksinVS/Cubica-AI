/** Deterministic Save metadata tests for assistant and manual-edit fallbacks. */
import { describe, expect, it } from "vitest";

import type { EditorDiffSummaryItem } from "@cubica/editor-engine";
import { buildSaveVersionMetadata } from "./save-version-metadata.ts";

describe("buildSaveVersionMetadata", () => {
  it("normalizes journal operations into bounded browser-safe facts", () => {
    const items: readonly EditorDiffSummaryItem[] = [{
      filePath: "games/demo/authoring/game.authoring.json",
      pointer: "/root/title",
      operation: "replace",
      before: "Старое",
      after: "Новое",
      description: "replace title"
    }];
    const metadata = buildSaveVersionMetadata(items[0]!.filePath, items);
    expect(metadata.proposedSummary).toBe("Изменений: 1 · файлов: 1");
    expect(metadata.changeFacts[0]).toMatchObject({ kind: "updated", source: "assistant", summary: "Изменено: /root/title" });
  });

  it("proposes a deterministic file summary when only manual edits exist", () => {
    expect(buildSaveVersionMetadata("games/demo/ui/web.authoring.json", []).proposedSummary).toBe("Обновлён web.authoring.json");
  });
});
