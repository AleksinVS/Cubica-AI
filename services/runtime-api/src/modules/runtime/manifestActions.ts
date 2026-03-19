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

    return {
      actionId,
      handlerType,
      functionName,
      raw: action
    };
  });
}

export function getManifestActionDefinition(bundle: GameBundle, actionId: string) {
  return listManifestActionDefinitions(bundle).find((definition) => definition.actionId === actionId) ?? null;
}
