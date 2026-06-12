import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EDITOR_AUTHORING_ASSISTANT_ID, getAssistantRecord } from "./agent-assistant-registry";
import { editorAgentToolCatalog, editorAgentToolNames, listEditorAgentToolDefinitions } from "./editor-agent-tool-catalog";

const editorAgentUiSourcePath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "components", "editor-agent-ui.tsx");

describe("editor agent tool catalog", () => {
  it("is the source for editor.authoring allowed tools", () => {
    const assistant = getAssistantRecord(EDITOR_AUTHORING_ASSISTANT_ID);

    expect(assistant?.allowedTools).toEqual(editorAgentToolNames);
  });

  it("keeps CopilotKit registered tools aligned with the Cubica catalog", () => {
    const source = readFileSync(editorAgentUiSourcePath, "utf8");

    for (const toolName of editorAgentToolNames) {
      expect(source).toContain(`getEditorAgentToolDefinition("${toolName}")`);
      if (toolName !== "editor.requestHumanApproval") {
        expect(source).toContain(`toCubicaToolResult("${toolName}"`);
      }
    }
    expect(source).not.toMatch(/name:\s*["']editor\./u);
  });

  it("assigns side-effect and audit policy to every editor tool", () => {
    for (const tool of listEditorAgentToolDefinitions()) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(["read-only", "human-approved", "system-approved"]).toContain(tool.sideEffectPolicy);
      expect(["none", "read", "mutating"]).toContain(tool.auditLevel);
    }
  });

  it("requires approval for every mutating editor tool", () => {
    const mutatingTools = listEditorAgentToolDefinitions().filter((tool) => tool.auditLevel === "mutating");

    expect(mutatingTools.map((tool) => tool.name).sort()).toEqual([
      "editor.applyChangeSet",
      "editor.saveSession",
      "editor.undoLastPatch"
    ]);
    expect(mutatingTools.every((tool) => tool.sideEffectPolicy === "human-approved" && tool.requiresApproval)).toBe(true);
  });

  it("does not allow ad-hoc editor tools outside the catalog", () => {
    expect(Object.keys(editorAgentToolCatalog).sort()).toEqual([...editorAgentToolNames].sort());
  });
});
