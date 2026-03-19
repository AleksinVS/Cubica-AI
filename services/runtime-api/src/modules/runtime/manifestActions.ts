import type { GameBundle } from "../content/manifestLoader.ts";
import type { RuntimeManifestActionDefinition } from "@cubica/contracts-runtime";

type ManifestActionsShape = Record<string, unknown>;

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

    return {
      actionId,
      handlerType: typeof action.handler_type === "string" ? action.handler_type : "unknown",
      functionName: typeof action.function === "string" ? action.function : undefined,
      raw: action
    };
  });
}

export function getManifestActionDefinition(bundle: GameBundle, actionId: string) {
  return listManifestActionDefinitions(bundle).find((definition) => definition.actionId === actionId) ?? null;
}
