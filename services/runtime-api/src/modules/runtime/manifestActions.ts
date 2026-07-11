import type { GameBundle } from "../content/manifestLoader.ts";
import type { GameManifestActionMap } from "@cubica/contracts-manifest";
import type { RuntimeManifestActionDefinition } from "@cubica/contracts-runtime";

type ManifestActionsShape = GameManifestActionMap | Record<string, unknown>;

const readActionsObject = (bundle: GameBundle): ManifestActionsShape => {
  const actions = bundle.manifest.actions;
  if (!actions || typeof actions !== "object" || Array.isArray(actions)) {
    return {};
  }

  return actions as ManifestActionsShape;
};

export function listManifestActionDefinitions(bundle: GameBundle): Array<RuntimeManifestActionDefinition> {
  return Object.entries(readActionsObject(bundle)).map(([actionId, raw]) => {
    const action = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const handlerType =
      typeof action.handlerType === "string"
        ? action.handlerType
        : typeof action.handler_type === "string"
          ? action.handler_type
          : "unknown";
    const functionName =
      typeof action.function === "string"
        ? action.function
        : typeof action.functionName === "string"
          ? action.functionName
          : undefined;
    const capabilityFamily =
      typeof action.capabilityFamily === "string"
        ? action.capabilityFamily
        : typeof action.capability_family === "string"
          ? action.capability_family
          : undefined;
    const capability =
      typeof action.capability === "string"
        ? action.capability
        : typeof action.capability_name === "string"
          ? action.capability_name
          : undefined;

    const templateId = typeof action.templateId === "string" ? action.templateId : undefined;
    const params = isObjectRecord(action.params) ? action.params : undefined;
    const paramsSchema = isObjectRecord(action.paramsSchema) ? action.paramsSchema : undefined;
    const allowedSessionRoles = Array.isArray(action.allowedSessionRoles)
      ? action.allowedSessionRoles.filter((role): role is "player" | "facilitator" | "assistant" | "observer" =>
          role === "player" || role === "facilitator" || role === "assistant" || role === "observer")
      : undefined;

    return {
      actionId,
      handlerType,
      capabilityFamily,
      capability,
      functionName,
      templateId,
      params,
      paramsSchema,
      allowedSessionRoles,
      raw: action
    };
  });
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function getManifestActionDefinition(bundle: GameBundle, actionId: string) {
  return listManifestActionDefinitions(bundle).find((definition) => definition.actionId === actionId) ?? null;
}
