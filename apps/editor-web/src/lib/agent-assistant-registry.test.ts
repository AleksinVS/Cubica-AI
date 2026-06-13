import { describe, expect, it } from "vitest";

import {
  EDITOR_AUTHORING_ASSISTANT_ID,
  agentUiDependencyPolicy,
  assertAssistantToolAllowed,
  cubicaAssistantRegistry,
  getAssistantRecord,
  listImplementedAssistants
} from "./agent-assistant-registry";

describe("Cubica assistant registry", () => {
  it("declares editor.authoring with bounded mutating tools", () => {
    const assistant = getAssistantRecord(EDITOR_AUTHORING_ASSISTANT_ID);

    expect(assistant).toMatchObject({
      ownerApp: "apps/editor-web",
      sideEffectPolicy: "human-approved",
      auditLevel: "mutating",
      status: "implemented"
    });
    expect(assistant?.allowedTools).toContain("editor.planChangeSet");
    expect(assistant?.allowedTools).toContain("editor.proposePrototypeExtraction");
    expect(assistant?.allowedTools).toContain("editor.preparePrototypeChangeSet");
    expect(assistant?.allowedTools).toContain("editor.applyChangeSet");
    expect(assistant?.allowedContext).not.toContain("publicSessionState");
  });

  it("keeps only allowlisted tools callable per assistant", () => {
    expect(() => assertAssistantToolAllowed(EDITOR_AUTHORING_ASSISTANT_ID, "editor.planChangeSet")).not.toThrow();
    expect(() => assertAssistantToolAllowed(EDITOR_AUTHORING_ASSISTANT_ID, "editor.proposePrototypeExtraction")).not.toThrow();
    expect(() => assertAssistantToolAllowed(EDITOR_AUTHORING_ASSISTANT_ID, "editor.preparePrototypeChangeSet")).not.toThrow();
    expect(() => assertAssistantToolAllowed(EDITOR_AUTHORING_ASSISTANT_ID, "portal.searchCatalog")).toThrow(
      /not allowed/
    );
  });

  it("keeps future helpers documented but not implemented", () => {
    expect(listImplementedAssistants().map((assistant) => assistant.agentId)).toEqual([EDITOR_AUTHORING_ASSISTANT_ID]);
    expect(cubicaAssistantRegistry.filter((assistant) => assistant.status === "planned").length).toBeGreaterThanOrEqual(4);
  });

  it("pins CopilotKit and AG-UI together with telemetry disabled by default", () => {
    expect(agentUiDependencyPolicy).toMatchObject({
      copilotKitVersion: "1.59.5",
      agUiVersion: "0.0.53",
      telemetryDefault: "disabled",
      productionAuditRequired: true
    });
  });
});
