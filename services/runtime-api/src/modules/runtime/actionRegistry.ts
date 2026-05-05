import type { GameBundle } from "../content/manifestLoader.ts";
import type {
  RuntimeActionHandler,
  RuntimeActionRegistry
} from "@cubica/contracts-runtime";
import { getManifestActionDefinition, listManifestActionDefinitions } from "./manifestActions.ts";
import {
  createDeterministicHandler,
  resolveActionCapabilityFamily
} from "./deterministicHandlers.ts";

type RuntimeState = Record<string, unknown>;


const createRegistryMap = (bundle: GameBundle) => {
  const registry = new Map<string, RuntimeActionHandler<RuntimeState>>();

  for (const definition of listManifestActionDefinitions(bundle)) {
    if (definition.handlerType === "script") {
      const capabilityFamily = resolveActionCapabilityFamily(definition.capabilityFamily, definition.capability);
      registry.set(definition.actionId, createDeterministicHandler(capabilityFamily));
      continue;
    }

    if (definition.handlerType === "manifest-data") {
      const deterministic = definition.raw.deterministic;
      if (!deterministic || typeof deterministic !== "object") {
        // Skip manifest-data actions that lack deterministic metadata.
        // This keeps the runtime bounded and explicit.
        continue;
      }
      const capabilityFamily = resolveActionCapabilityFamily(definition.capabilityFamily, definition.capability);
      registry.set(definition.actionId, createDeterministicHandler(capabilityFamily, { mode: "manifest-action" }));
    }
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
