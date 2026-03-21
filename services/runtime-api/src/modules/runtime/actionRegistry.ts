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

const SUPPORTED_MANIFEST_DATA_ACTIONS = new Set([
  "opening.info.i0.advance",
  "opening.info.i02.advance",
  "opening.info.i03.advance",
  "opening.info.i1.advance",
  "opening.info.i2.advance",
  "opening.info.i3.advance",
  "opening.info.i4.advance",
  "opening.info.i5.advance",
  "opening.info.i6.advance",
  "opening.card.3"
]);

const createRegistryMap = (bundle: GameBundle) => {
  const registry = new Map<string, RuntimeActionHandler<RuntimeState>>();

  for (const definition of listManifestActionDefinitions(bundle)) {
    if (definition.handlerType === "script") {
      const capabilityFamily = resolveActionCapabilityFamily(definition.capabilityFamily, definition.capability);
      registry.set(definition.actionId, createDeterministicHandler(capabilityFamily));
      continue;
    }

    if (
      definition.handlerType === "manifest-data" &&
      SUPPORTED_MANIFEST_DATA_ACTIONS.has(definition.actionId)
    ) {
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
