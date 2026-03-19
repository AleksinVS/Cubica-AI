import type { GameBundle } from "../content/manifestLoader.ts";
import type {
  RuntimeActionHandler,
  RuntimeActionRegistry
} from "@cubica/contracts-runtime";
import { getManifestActionDefinition, listManifestActionDefinitions } from "./manifestActions.ts";
import { createDeterministicHandler } from "./deterministicHandlers.ts";

type RuntimeState = Record<string, unknown>;

const createRegistryMap = (bundle: GameBundle) => {
  const registry = new Map<string, RuntimeActionHandler<RuntimeState>>();
  const deterministicHandler = createDeterministicHandler();

  for (const definition of listManifestActionDefinitions(bundle)) {
    if (definition.handlerType !== "script") {
      continue;
    }

    registry.set(definition.actionId, deterministicHandler);
  }

  return registry;
};

export function createRuntimeActionRegistry(bundle: GameBundle): RuntimeActionRegistry<RuntimeState> {
  const registry = createRegistryMap(bundle);

  return {
    get(actionId: string) {
      return registry.get(actionId);
    },
    has(actionId: string) {
      return registry.has(actionId);
    },
    list() {
      return [...registry.keys()];
    }
  };
}

export function getRegisteredActionDefinition(bundle: GameBundle, actionId: string) {
  return getManifestActionDefinition(bundle, actionId);
}
